/**
 * Reemplazo único de los documentos de la entrega final del Business Plan.
 *
 * Regla (Daniel, 06/11/2026): si el participante sube el archivo equivocado,
 * puede reemplazar CADA documento una sola vez, desde la misma pantalla y en
 * cualquier sesión, hasta la fecha límite. Después queda definitivo. Solo
 * Business Plan; Caso y Proyecto de Investigación siguen sin reemplazo.
 *
 * El «una sola vez» se garantiza en la base, no en la pantalla: el reemplazo se
 * RESERVA con un UPDATE condicional (… where *_reemplazado_at is null) antes de
 * subir el archivo nuevo. Si llegan dos peticiones a la vez, la segunda
 * encuentra la marca puesta y no actualiza ninguna fila. Si la subida falla
 * después de reservar, la reserva se libera: un error de red no le gasta el
 * reemplazo a nadie.
 *
 * El archivo reemplazado no se borra: se copia a «reemplazados/» y su ruta
 * queda en *_path_anterior, como evidencia de lo que había.
 */
import { supabaseAdmin } from '../db/supabase.js';

const BUCKET = 'trabajos-grado';

export type TipoAssetReemplazo = 'one_pager' | 'logo' | 'modelo_financiero';

/** Reserva el reemplazo del PDF final. Devuelve la ruta del archivo que se va a
 *  reemplazar, o null si el reemplazo ya se usó (o no hay archivo). */
export async function reservarReemplazoProyectoFinal(anteproyectoId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('anteproyectos')
    .update({ archivo_proyecto_final_reemplazado_at: new Date().toISOString() })
    .eq('id', anteproyectoId)
    .is('archivo_proyecto_final_reemplazado_at', null)
    .not('archivo_proyecto_final_path', 'is', null)
    .select('archivo_proyecto_final_path');
  if (error) throw error;
  return (data?.[0] as any)?.archivo_proyecto_final_path ?? null;
}

export async function liberarReemplazoProyectoFinal(anteproyectoId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('anteproyectos')
    .update({ archivo_proyecto_final_reemplazado_at: null })
    .eq('id', anteproyectoId);
  if (error) console.error('[reemplazo] no se pudo liberar la reserva del PDF final:', error.message);
}

/** Igual que el PDF, para un documento de material (One Pager, logo, modelo). */
export async function reservarReemplazoAsset(proyectoId: string, tipo: TipoAssetReemplazo): Promise<string | null> {
  const colPath = `${tipo}_path`;
  const colMarca = `${tipo}_reemplazado_at`;
  const { data, error } = await supabaseAdmin
    .from('proyecto_contenido')
    .update({ [colMarca]: new Date().toISOString() })
    .eq('proyecto_id', proyectoId)
    .is(colMarca, null)
    .not(colPath, 'is', null)
    .select(colPath);
  if (error) throw error;
  return (data?.[0] as any)?.[colPath] ?? null;
}

export async function liberarReemplazoAsset(proyectoId: string, tipo: TipoAssetReemplazo): Promise<void> {
  const { error } = await supabaseAdmin
    .from('proyecto_contenido')
    .update({ [`${tipo}_reemplazado_at`]: null })
    .eq('proyecto_id', proyectoId);
  if (error) console.error(`[reemplazo] no se pudo liberar la reserva de ${tipo}:`, error.message);
}

/** Copia el archivo que se va a reemplazar a «<carpeta>/reemplazados/» y devuelve
 *  la ruta de la copia. Se hace ANTES de subir el nuevo: si tiene el mismo
 *  nombre, la subida (upsert) pisaría el original. */
export async function archivarCopia(ruta: string): Promise<string> {
  const corte = ruta.lastIndexOf('/');
  const carpeta = ruta.slice(0, corte);
  const nombre = ruta.slice(corte + 1);
  const sello = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '');   // 20261106T231500
  const destino = `${carpeta}/reemplazados/${sello}-${nombre}`;
  const { error } = await supabaseAdmin.storage.from(BUCKET).copy(ruta, destino);
  if (error) throw error;
  return destino;
}

/** Tras un reemplazo con otro nombre, el original ya tiene su copia en
 *  «reemplazados/»: se quita de su sitio para no dejar dos versiones vivas. */
export async function quitarOriginal(rutaAnterior: string, rutaNueva: string): Promise<void> {
  if (rutaAnterior === rutaNueva) return;
  const { error } = await supabaseAdmin.storage.from(BUCKET).remove([rutaAnterior]);
  if (error) console.error('[reemplazo] no se pudo quitar el archivo reemplazado de su sitio:', error.message);
}
