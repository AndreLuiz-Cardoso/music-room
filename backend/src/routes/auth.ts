import { Type, type FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import bcrypt from 'bcryptjs';
import type { TokenKind, User } from '@prisma/client';
import { config } from '../config';
import { prisma } from '../db';
import { ApiError, conflict, forbidden, tooManyRequests, unauthorized } from '../errors';
import { issueSession, randomToken, revokeAllSessions, revokeSession, rotateSession, sha256 } from '../auth/tokens';
import { Email, Message, Password, SessionResponse, errors } from '../schemas';
import type { Provider, SocialIdentity } from '../services/social';
import { toMe } from '../services/users';
import { HTML_CSP, messagePage, resetPasswordForm } from '../views';

const MAX_FAILED_LOGINS = 5;
const LOCK_MS = 15 * 60_000;
const VERIFY_TTL_MS = 24 * 3600_000;
const RESET_TTL_MS = 3600_000;

// Compared against when the email is unknown, so that response time does not reveal
// whether an account exists.
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', config.bcryptRounds);

const routes: FastifyPluginAsyncTypebox = async (app) => {
  const authLimit = { rateLimit: { max: config.rateLimit.auth, timeWindow: '1 minute' } };

  async function createOneTimeToken(userId: string, kind: TokenKind, ttlMs: number): Promise<string> {
    const token = randomToken();
    await prisma.oneTimeToken.create({
      data: { userId, kind, tokenHash: sha256(token), expiresAt: new Date(Date.now() + ttlMs) },
    });
    return token;
  }

  /** Marks a one-time token as used, atomically: two concurrent uses cannot both succeed. */
  async function consumeOneTimeToken(token: string, kind: TokenKind): Promise<string | null> {
    const stored = await prisma.oneTimeToken.findUnique({ where: { tokenHash: sha256(token) } });
    if (!stored || stored.kind !== kind || stored.expiresAt < new Date()) return null;
    const used = await prisma.oneTimeToken.updateMany({
      where: { id: stored.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    return used.count === 1 ? stored.userId : null;
  }

  async function sendVerificationMail(user: User) {
    const token = await createOneTimeToken(user.id, 'EMAIL_VERIFICATION', VERIFY_TTL_MS);
    await app.mailer.send({
      to: user.email,
      subject: 'Music Room - confirm your email',
      text: `Hello ${user.displayName},\n\nConfirm your email address by opening this link (valid 24h):\n${config.publicUrl}/auth/verify-email?token=${token}\n`,
    });
  }

  async function sessionFor(user: User) {
    return { ...(await issueSession(user.id)), user: toMe(user) };
  }

  async function verifyEmail(token: string): Promise<boolean> {
    const userId = await consumeOneTimeToken(token, 'EMAIL_VERIFICATION');
    if (!userId) return false;
    await prisma.user.update({ where: { id: userId }, data: { emailVerified: true } });
    return true;
  }

  async function resetPassword(token: string, password: string): Promise<boolean> {
    const userId = await consumeOneTimeToken(token, 'PASSWORD_RESET');
    if (!userId) return false;
    await prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash: await bcrypt.hash(password, config.bcryptRounds),
        // receiving the mail proves the ownership of the address
        emailVerified: true,
        failedLogins: 0,
        lockedUntil: null,
      },
    });
    await revokeAllSessions(userId);
    return true;
  }

  app.post(
    '/register',
    {
      config: authLimit,
      schema: {
        tags: ['auth'],
        security: [],
        summary: 'Create an account with email and password',
        description:
          'Always answers 201, even when the email is already used (an informative mail is then sent to the ' +
          'owner instead): the endpoint cannot be used to discover registered emails.',
        body: Type.Object({ email: Email, password: Password, displayName: Type.String({ minLength: 1, maxLength: 50 }) }),
        response: { 201: Message, ...errors(400, 429) },
      },
    },
    async (req, reply) => {
      const email = req.body.email.toLowerCase();
      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing) {
        await app.mailer.send({
          to: email,
          subject: 'Music Room - registration attempt',
          text: 'Someone tried to create an account with your email address, but you already have one.\nIf you forgot your password, use "Forgot password" in the application.\n',
        });
      } else {
        const user = await prisma.user.create({
          data: {
            email,
            displayName: req.body.displayName.trim(),
            passwordHash: await bcrypt.hash(req.body.password, config.bcryptRounds),
          },
        });
        await sendVerificationMail(user);
      }
      return reply.code(201).send({ message: 'Check your mailbox to confirm your email address.' });
    },
  );

  app.get(
    '/verify-email',
    { schema: { tags: ['auth'], security: [], summary: 'Email confirmation link (HTML page)', querystring: Type.Object({ token: Type.String() }) } },
    async (req, reply) => {
      const ok = await verifyEmail(req.query.token);
      reply.header('content-security-policy', HTML_CSP).type('text/html');
      return ok
        ? messagePage('Email confirmed', 'Your email is confirmed. You can now log in from the application.')
        : messagePage('Invalid link', 'This link is invalid, expired or was already used.');
    },
  );

  app.post(
    '/verify-email',
    {
      config: authLimit,
      schema: {
        tags: ['auth'],
        security: [],
        summary: 'Confirm an email with the token received by mail',
        body: Type.Object({ token: Type.String({ maxLength: 200 }) }),
        response: { 204: Type.Null(), ...errors(400) },
      },
    },
    async (req, reply) => {
      if (!(await verifyEmail(req.body.token))) throw new ApiError(400, 'INVALID_TOKEN', 'Invalid or expired token');
      return reply.code(204).send(null);
    },
  );

  app.post(
    '/resend-verification',
    {
      config: authLimit,
      schema: {
        tags: ['auth'],
        security: [],
        summary: 'Send the confirmation email again',
        body: Type.Object({ email: Email }),
        response: { 204: Type.Null() },
      },
    },
    async (req, reply) => {
      const user = await prisma.user.findUnique({ where: { email: req.body.email.toLowerCase() } });
      if (user && !user.emailVerified) await sendVerificationMail(user);
      return reply.code(204).send(null);
    },
  );

  app.post(
    '/login',
    {
      config: authLimit,
      schema: {
        tags: ['auth'],
        security: [],
        summary: 'Log in with email and password',
        description: `After ${MAX_FAILED_LOGINS} failed attempts the account is locked for 15 minutes.`,
        body: Type.Object({ email: Email, password: Type.String({ maxLength: 128 }) }),
        response: { 200: SessionResponse, ...errors(401, 403, 429) },
      },
    },
    async (req) => {
      const now = new Date();
      const user = await prisma.user.findUnique({ where: { email: req.body.email.toLowerCase() } });
      if (user?.lockedUntil && user.lockedUntil > now) {
        throw tooManyRequests('ACCOUNT_LOCKED', 'Too many failed attempts, try again later or reset your password');
      }
      const valid = await bcrypt.compare(req.body.password, user?.passwordHash ?? DUMMY_HASH);
      if (!user || !user.passwordHash || !valid) {
        if (user) {
          const failed = user.failedLogins + 1;
          await prisma.user.update({
            where: { id: user.id },
            data:
              failed >= MAX_FAILED_LOGINS
                ? { failedLogins: 0, lockedUntil: new Date(now.getTime() + LOCK_MS) }
                : { failedLogins: failed },
          });
        }
        throw unauthorized('INVALID_CREDENTIALS', 'Invalid email or password');
      }
      if (!user.emailVerified) throw forbidden('EMAIL_NOT_VERIFIED', 'Confirm your email address before logging in');
      const fresh = await prisma.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null } });
      return sessionFor(fresh);
    },
  );

  /**
   * Social login. Unknown identity + unknown email: account creation. Unknown identity +
   * known email: the identity is linked only if the provider certifies the email. If that
   * existing account was never confirmed, its password is dropped: someone may have
   * pre-registered the victim's address to take the account over later.
   */
  async function socialLogin(identity: SocialIdentity) {
    const byProvider = identity.provider === 'google' ? { googleId: identity.providerId } : { facebookId: identity.providerId };
    const linked = await prisma.user.findFirst({ where: byProvider });
    if (linked) return sessionFor(linked);

    if (!identity.email) {
      throw new ApiError(400, 'SOCIAL_EMAIL_REQUIRED', 'The provider did not share your email address');
    }
    const email = identity.email.toLowerCase();
    const existing = await prisma.user.findUnique({ where: { email } });
    if (!existing) {
      const user = await prisma.user.create({
        data: {
          email,
          emailVerified: identity.emailVerified,
          displayName: (identity.name ?? email.split('@')[0]).slice(0, 50),
          avatarUrl: identity.picture,
          ...byProvider,
        },
      });
      return sessionFor(user);
    }
    if (!identity.emailVerified) {
      throw conflict('ACCOUNT_EXISTS', 'An account already uses this email: log in and link the provider from your profile');
    }
    const user = await prisma.user.update({
      where: { id: existing.id },
      data: { ...byProvider, emailVerified: true, ...(existing.emailVerified ? {} : { passwordHash: null }) },
    });
    if (!existing.emailVerified) await revokeAllSessions(existing.id);
    return sessionFor(user);
  }

  const socialRoute = (provider: Provider, field: 'idToken' | 'accessToken', label: string) =>
    app.post(
      `/${provider}`,
      {
        config: authLimit,
        schema: {
          tags: ['auth'],
          security: [],
          summary: `Log in or sign up with ${label}`,
          body: Type.Object({ [field]: Type.String({ minLength: 10, maxLength: 4096 }) }),
          response: { 200: SessionResponse, ...errors(400, 401, 409, 501) },
        },
      },
      async (req) => {
        const credential = (req.body as Record<string, string>)[field];
        return socialLogin(await app.social.verify(provider, credential));
      },
    );
  socialRoute('google', 'idToken', 'a Google ID token');
  socialRoute('facebook', 'accessToken', 'a Facebook access token');

  app.post(
    '/refresh',
    {
      config: authLimit,
      schema: {
        tags: ['auth'],
        security: [],
        summary: 'Exchange a refresh token for a new session (rotation)',
        description: 'A refresh token is single use. Reusing one revokes the whole session (theft detection).',
        body: Type.Object({ refreshToken: Type.String({ maxLength: 200 }) }),
        response: { 200: SessionResponse, ...errors(401) },
      },
    },
    async (req) => {
      const { userId, session } = await rotateSession(req.body.refreshToken);
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) throw unauthorized();
      return { ...session, user: toMe(user) };
    },
  );

  app.post(
    '/logout',
    {
      schema: {
        tags: ['auth'],
        security: [],
        summary: 'Revoke a session',
        body: Type.Object({ refreshToken: Type.String({ maxLength: 200 }) }),
        response: { 204: Type.Null() },
      },
    },
    async (req, reply) => {
      await revokeSession(req.body.refreshToken);
      return reply.code(204).send(null);
    },
  );

  app.post(
    '/forgot-password',
    {
      config: authLimit,
      schema: {
        tags: ['auth'],
        security: [],
        summary: 'Send a password reset link by email',
        description: 'Always answers 204 so that it cannot be used to discover registered emails.',
        body: Type.Object({ email: Email }),
        response: { 204: Type.Null() },
      },
    },
    async (req, reply) => {
      const user = await prisma.user.findUnique({ where: { email: req.body.email.toLowerCase() } });
      if (user) {
        const token = await createOneTimeToken(user.id, 'PASSWORD_RESET', RESET_TTL_MS);
        await app.mailer.send({
          to: user.email,
          subject: 'Music Room - reset your password',
          text: `Open this link to choose a new password (valid 1 hour):\n${config.publicUrl}/auth/reset-password?token=${token}\n\nIf you did not ask for it, ignore this email.`,
        });
      }
      return reply.code(204).send(null);
    },
  );

  app.get(
    '/reset-password',
    { schema: { tags: ['auth'], security: [], summary: 'Password reset form (HTML page)', querystring: Type.Object({ token: Type.String() }) } },
    async (req, reply) => {
      reply.header('content-security-policy', HTML_CSP).type('text/html');
      return resetPasswordForm(req.query.token);
    },
  );

  app.post(
    '/reset-password',
    {
      config: authLimit,
      // Also accepts the HTML form; the password rule is checked by hand to re-display the form on error.
      schema: {
        tags: ['auth'],
        security: [],
        summary: 'Set a new password with a reset token',
        description:
          'Revokes every open session of the account. JSON: 204, or 400 {error: WEAK_PASSWORD | INVALID_TOKEN}. ' +
          'The HTML form of the email link posts here too and gets an HTML page back.',
        body: Type.Object({ token: Type.String({ maxLength: 200 }), password: Type.String({ maxLength: 128 }) }),
      },
    },
    async (req, reply) => {
      const isForm = req.headers['content-type']?.startsWith('application/x-www-form-urlencoded');
      const { token, password } = req.body;
      const strong = new RegExp(Password.pattern!).test(password) && password.length >= 8;
      const ok = strong && (await resetPassword(token, password));
      if (isForm) {
        reply.header('content-security-policy', HTML_CSP).type('text/html');
        if (!strong) return reply.code(400).send(resetPasswordForm(token, 'Password too weak.'));
        return ok
          ? messagePage('Password changed', 'You can now log in with your new password.')
          : reply.code(400).send(messagePage('Invalid link', 'This link is invalid, expired or was already used.'));
      }
      if (!strong) throw new ApiError(400, 'WEAK_PASSWORD', Password.description!);
      if (!ok) throw new ApiError(400, 'INVALID_TOKEN', 'Invalid or expired token');
      return reply.code(204).send(null);
    },
  );
};

export default routes;
