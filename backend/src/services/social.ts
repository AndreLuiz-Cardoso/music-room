import { createHmac } from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import { config } from '../config';
import { ApiError, unauthorized } from '../errors';

export type Provider = 'google' | 'facebook';

export interface SocialIdentity {
  provider: Provider;
  providerId: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
  picture: string | null;
}

/** We verify provider tokens ourselves, and that they were issued for our app (no replay). */
export interface SocialVerifier {
  verify(provider: Provider, credential: string): Promise<SocialIdentity>;
}

export class ProviderVerifier implements SocialVerifier {
  private google = new OAuth2Client();

  async verify(provider: Provider, credential: string): Promise<SocialIdentity> {
    return provider === 'google' ? this.verifyGoogle(credential) : this.verifyFacebook(credential);
  }

  private async verifyGoogle(idToken: string): Promise<SocialIdentity> {
    if (config.google.clientIds.length === 0) {
      throw new ApiError(501, 'GOOGLE_NOT_CONFIGURED', 'Google sign-in is not configured on this server');
    }
    try {
      const ticket = await this.google.verifyIdToken({ idToken, audience: config.google.clientIds });
      const p = ticket.getPayload();
      if (!p?.sub) throw new Error('no subject');
      return {
        provider: 'google',
        providerId: p.sub,
        email: p.email ?? null,
        emailVerified: p.email_verified === true,
        name: p.name ?? null,
        picture: p.picture ?? null,
      };
    } catch {
      throw unauthorized('INVALID_SOCIAL_TOKEN', 'Invalid Google token');
    }
  }

  private async verifyFacebook(accessToken: string): Promise<SocialIdentity> {
    const { appId, appSecret } = config.facebook;
    if (!appId || !appSecret) {
      throw new ApiError(501, 'FACEBOOK_NOT_CONFIGURED', 'Facebook sign-in is not configured on this server');
    }
    const graph = 'https://graph.facebook.com/v19.0';
    const debug = await fetch(
      `${graph}/debug_token?input_token=${encodeURIComponent(accessToken)}&access_token=${appId}|${appSecret}`,
      { signal: AbortSignal.timeout(5000) },
    ).then((r) => r.json() as Promise<any>);
    if (!debug?.data?.is_valid || debug.data.app_id !== appId) {
      throw unauthorized('INVALID_SOCIAL_TOKEN', 'Invalid Facebook token');
    }
    const proof = createHmac('sha256', appSecret).update(accessToken).digest('hex');
    const me = await fetch(
      `${graph}/me?fields=id,name,email,picture.type(large)&access_token=${encodeURIComponent(accessToken)}&appsecret_proof=${proof}`,
      { signal: AbortSignal.timeout(5000) },
    ).then((r) => r.json() as Promise<any>);
    if (!me?.id) throw unauthorized('INVALID_SOCIAL_TOKEN', 'Invalid Facebook token');
    return {
      provider: 'facebook',
      providerId: String(me.id),
      email: me.email ?? null,
      // Facebook only exposes confirmed email addresses
      emailVerified: Boolean(me.email),
      name: me.name ?? null,
      picture: me.picture?.data?.url ?? null,
    };
  }
}
