import nodemailer from 'nodemailer';
import { config } from '../config';

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  send(mail: Mail): Promise<void>;
}

export class SmtpMailer implements Mailer {
  private transport = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.password } : undefined,
  });

  async send(mail: Mail): Promise<void> {
    await this.transport.sendMail({ from: config.smtp.from, ...mail });
  }
}

/** Development fallback when no SMTP server is configured: the mail is written to the log. */
export class ConsoleMailer implements Mailer {
  public readonly sent: Mail[] = [];

  constructor(private readonly log: (msg: string) => void = console.log) {}

  async send(mail: Mail): Promise<void> {
    this.sent.push(mail);
    this.log(`[mail] to=${mail.to} subject="${mail.subject}"\n${mail.text}`);
  }
}

export function createMailer(): Mailer {
  return config.smtp.host ? new SmtpMailer() : new ConsoleMailer();
}
