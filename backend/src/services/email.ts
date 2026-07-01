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
  // IMPORTANTE: nunca lanzar. Antes un fallo de SMTP (rechazo de un correo,
  // límite de Zoho, timeout) lanzaba excepción y, en flujos masivos como
  // "Comunicar", abortaba TODO el envío sin marcar nada. Ahora devolvemos
  // {ok:false} y el llamador decide (contar fallo, reintentar luego).
  try {
    await t.sendMail({
      from: config.smtp.from,
      to,
      subject,
      html,
      attachments: attachments?.map((a) => ({ filename: a.filename, content: a.content, contentType: a.contentType })),
    });
    return { ok: true };
  } catch (e) {
    console.warn(`[email] envío falló to=${to} subject="${subject}":`, (e as Error).message);
    return { ok: false, reason: (e as Error).message };
  }
}
