import { supabaseAdmin } from '../db/supabase.js';

const BUCKET = 'trabajos-grado';

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

/** Descarga el archivo del bucket privado a un Buffer (para adjuntar en emails). */
export async function downloadTrabajoGradoFile(path: string): Promise<Buffer> {
  const { data, error } = await supabaseAdmin.storage.from(BUCKET).download(path);
  if (error || !data) throw error ?? new Error('NO_FILE');
  const arr = await data.arrayBuffer();
  return Buffer.from(arr);
}
