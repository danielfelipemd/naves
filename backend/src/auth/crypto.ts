import crypto from 'node:crypto';
import { config } from '../config.js';

// SHA-256 hash hex (para búsqueda determinística de cédulas/emails)
export function sha256Hex(input: string): string {
  return crypto.createHash('sha256').update(input.trim()).digest('hex');
}

// Email sintético determinístico desde cédula
export function syntheticEmailFromCedula(cedula: string): string {
  const clean = cedula.replace(/[\s.\-]/g, '');
  return `${sha256Hex(clean)}@naves.local`;
}

// AES-256-GCM para PII (cédula, email institucional real)
function getKey(): Buffer {
  const k = config.pii.encryptionKey;
  if (!k) throw new Error('PII_ENCRYPTION_KEY not set');
  // Aceptar hex (64 chars) o base64
  if (/^[a-f0-9]{64}$/i.test(k)) return Buffer.from(k, 'hex');
  const buf = Buffer.from(k, 'base64');
  if (buf.length !== 32) throw new Error('PII_ENCRYPTION_KEY must be 32 bytes (64 hex or 32-byte base64)');
  return buf;
}

export function encryptPII(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString('base64');
}

export function decryptPII(payload: string): string {
  const buf = Buffer.from(payload, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

// Generar token de recuperación (entrega plaintext, guarda hash en BD)
export function generateRecoveryToken(): { token: string; hash: string } {
  const token = crypto.randomBytes(32).toString('base64url');
  const hash = sha256Hex(token);
  return { token, hash };
}
