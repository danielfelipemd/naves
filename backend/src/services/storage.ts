import jwt from 'jsonwebtoken';
import { supabaseAdmin } from '../db/supabase.js';
import { config } from '../config.js';

const BUCKET = 'trabajos-grado';
const ARCHIVO_TOKEN_TTL_SECONDS = 300;

export type TipoArchivoTrabajo = 'anteproyecto' | 'proyecto-final';

const MIME_TO_EXT: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/msword': 'doc',
};

export function extForMime(mime: string): string | null {
  return MIME_TO_EXT[mime] ?? null;
}

/**
 * Limpia un filename para usarlo como path en Supabase Storage: quita
 * diacríticos, reemplaza caracteres no seguros por '_', conserva extensión.
 */
function sanitizeFilename(name: string, fallbackExt: string): string {
  const raw = (name ?? '').trim() || `archivo.${fallbackExt}`;
  const lastDot = raw.lastIndexOf('.');
  const base = lastDot > 0 ? raw.slice(0, lastDot) : raw;
  const rawExt = lastDot > 0 ? raw.slice(lastDot + 1) : '';
  const safeBase = base
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // quita acentos
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[_.\-]+|[_.\-]+$/g, '')
    .slice(0, 100) || 'archivo';
  const safeExt = (rawExt || fallbackExt).replace(/[^a-zA-Z0-9]/g, '').slice(0, 10).toLowerCase() || fallbackExt;
  return `${safeBase}.${safeExt}`;
}

export function pathFor(equipoId: string, tipo: TipoArchivoTrabajo, originalFilename: string, mime: string): string {
  const ext = extForMime(mime);
  if (!ext) throw new Error('UNSUPPORTED_MIME');
  const safe = sanitizeFilename(originalFilename, ext);
  // Subcarpeta por tipo: distinguishes anteproyecto vs proyecto-final dentro
  // del bucket aun viendo varios equipos a la vez.
  return `${equipoId}/${tipo}/${safe}`;
}

export async function uploadTrabajoGradoFile(
  equipoId: string,
  tipo: TipoArchivoTrabajo,
  buffer: Buffer,
  mime: string,
  originalFilename: string,
): Promise<{ path: string; size: number }> {
  const path = pathFor(equipoId, tipo, originalFilename, mime);
  const { error } = await supabaseAdmin.storage.from(BUCKET).upload(path, buffer, {
    contentType: mime,
    upsert: true,
  });
  if (error) throw error;
  return { path, size: buffer.length };
}

export async function getSignedUrlTrabajoGrado(path: string, expiresIn = 300): Promise<string> {
  const { data, error } = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(path, expiresIn);
  if (error || !data?.signedUrl) throw error ?? new Error('NO_SIGNED_URL');
  return data.signedUrl;
}

export async function deleteTrabajoGradoFile(path: string): Promise<void> {
  const { error } = await supabaseAdmin.storage.from(BUCKET).remove([path]);
  if (error) throw error;
}

/**
 * Crea una URL en NUESTRO dominio para que el navegador pueda abrir el archivo
 * en una pestaña nueva sin exponer la URL firmada de Supabase Storage. La URL
 * incluye un JWT efimero (5 min) que firma el path; un endpoint publico de
 * proxy (/api/archivos/stream) valida ese token y hace stream del archivo
 * desde Supabase Storage al cliente.
 */
export function crearUrlProxyArchivo(path: string, mime: string | null | undefined): string {
  const token = jwt.sign(
    { p: path, m: mime ?? 'application/octet-stream' },
    config.supabase.jwtSecret,
    { algorithm: 'HS256', expiresIn: ARCHIVO_TOKEN_TTL_SECONDS },
  );
  return `/api/archivos/stream?t=${encodeURIComponent(token)}`;
}

/** Verifica un token emitido por `crearUrlProxyArchivo`. Lanza si invalido/expirado. */
export function verificarTokenArchivo(token: string): { path: string; mime: string } {
  const payload = jwt.verify(token, config.supabase.jwtSecret, {
    algorithms: ['HS256'],
  }) as jwt.JwtPayload;
  const path = payload.p as string | undefined;
  const mime = (payload.m as string | undefined) ?? 'application/octet-stream';
  if (!path) throw new Error('TOKEN_INVALIDO');
  return { path, mime };
}

/** Descarga el archivo del bucket privado a un Buffer (para adjuntar en emails). */
export async function downloadTrabajoGradoFile(path: string): Promise<Buffer> {
  const { data, error } = await supabaseAdmin.storage.from(BUCKET).download(path);
  if (error || !data) throw error ?? new Error('NO_FILE');
  const arr = await data.arrayBuffer();
  return Buffer.from(arr);
}
