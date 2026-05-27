import nodemailer from 'nodemailer';
import { config } from '../config.js';

let cached: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter | null {
  if (cached) return cached;
  if (!config.smtp.host) return null;
  cached = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.port === 465,
    auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.password } : undefined,
  });
  return cached;
}

export interface EmailAttachment {
  filename: string;
  content: Buffer;
  contentType?: string;
}

export async function sendEmail(
  to: string,
  subject: string,
  html: string,
  attachments?: EmailAttachment[],
): Promise<{ ok: boolean; reason?: string }> {
  const t = getTransporter();
  if (!t) {
    console.warn(`[email] SMTP not configured, would send to=${to} subject="${subject}"`);
    return { ok: false, reason: 'SMTP_NOT_CONFIGURED' };
  }
  await t.sendMail({
    from: config.smtp.from,
    to,
    subject,
    html,
    attachments: attachments?.map((a) => ({ filename: a.filename, content: a.content, contentType: a.contentType })),
  });
  return { ok: true };
}
