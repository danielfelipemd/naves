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

export function pathFor(equipoId: string, tipo: TipoArchivoTrabajo, mime: string): string {
  const ext = extForMime(mime);
  if (!ext) throw new Error('UNSUPPORTED_MIME');
  return `${equipoId}/${tipo}.${ext}`;
}

export async function uploadTrabajoGradoFile(
  equipoId: string,
  tipo: TipoArchivoTrabajo,
  buffer: Buffer,
  mime: string,
): Promise<{ path: string; size: number }> {
  const path = pathFor(equipoId, tipo, mime);
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
