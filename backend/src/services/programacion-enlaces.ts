import crypto from 'node:crypto';
import { config } from '../config.js';
import { supabaseAdmin } from '../db/supabase.js';
import { decryptPII, encryptPII, sha256Hex } from '../auth/crypto.js';
import { escaletaDeCohorte, programacionPublicadaAt, toHHMM } from './escaleta.js';
import { mimeFromPath } from './storage.js';
import { FORMATO_TOKEN, partirEnBloques } from './panelistas-enlace.js';

// Enlaces mágicos de la programación por público (sql/58). Qué ve cada uno lo
// decide PUBLICOS, en un solo sitio: la ruta y la página lo leen de aquí.

export type Publico = 'asistentes' | 'marketing' | 'publicaciones';

export const PUBLICOS: Record<Publico, { nombre: string; resumen: boolean; linkedin: boolean; logo: boolean; onePager: boolean }> = {
  // Para imprimir y pegar en carteleras: todo menos post, logo y One Pager.
  asistentes: { nombre: 'Asistentes de programa', resumen: true, linkedin: false, logo: false, onePager: false },
  // Todo: resumen, post de LinkedIn y logo. El One Pager no (Daniel, 18/11).
  marketing: { nombre: 'Marketing y comunicaciones', resumen: true, linkedin: true, logo: true, onePager: false },
  // La programación con los One Pagers.
  publicaciones: { nombre: 'Publicaciones', resumen: true, linkedin: false, logo: false, onePager: true },
};
export const esPublico = (x: unknown): x is Publico => typeof x === 'string' && x in PUBLICOS;

// Duración máxima de un enlace (Daniel: «duración máxima de 10 días»).
export const DIAS_MAXIMOS = 10;

export function urlEnlaceProgramacion(token: string): string {
  return `${config.frontendUrl}/programacion/ver/${token}`;
}

export type EstadoEnlace = 'vigente' | 'vencido' | 'revocado';
export interface EnlaceProgramacion {
  id: string; cohorte_id: string; publico: Publico; nombre: string;
  vence_at: string; estado: EstadoEnlace; ultimo_uso_at: string | null; creado_at: string; url: string | null;
}

const COLS = 'id, cohorte_id, publico, nombre, token_cifrado, vence_at, revocado_at, ultimo_uso_at, creado_at';
function aEnlace(e: any): EnlaceProgramacion {
  let url: string | null = null; try { url = urlEnlaceProgramacion(decryptPII(e.token_cifrado)); } catch { url = null; }
  const estado: EstadoEnlace = e.revocado_at ? 'revocado' : (new Date(e.vence_at).getTime() > Date.now() ? 'vigente' : 'vencido');
  return { id: e.id, cohorte_id: e.cohorte_id, publico: e.publico, nombre: e.nombre, vence_at: e.vence_at, estado, ultimo_uso_at: e.ultimo_uso_at, creado_at: e.creado_at, url };
}

export async function crearEnlace(cohorteId: string, publico: Publico, nombre: string, venceAt: string, creadoPor: string | null): Promise<EnlaceProgramacion> {
  const token = crypto.randomBytes(32).toString('base64url');
  const { data, error } = await supabaseAdmin.from('programacion_enlaces').insert({
    cohorte_id: cohorteId, publico, nombre,
    token_hash: sha256Hex(token), token_cifrado: encryptPII(token),
    vence_at: venceAt, creado_por: creadoPor,
  }).select(COLS).single();
  if (error || !data) throw new Error(error?.message ?? 'NO_SE_PUDO_CREAR');
  return aEnlace(data);
}

export async function enlacesDeCohorte(cohorteId: string): Promise<EnlaceProgramacion[]> {
  const { data } = await supabaseAdmin.from('programacion_enlaces').select(COLS)
    .eq('cohorte_id', cohorteId).order('creado_at', { ascending: false });
  return (data ?? []).map(aEnlace);
}

export async function revocarEnlace(id: string): Promise<EnlaceProgramacion | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data } = await supabaseAdmin.from('programacion_enlaces')
    .update({ revocado_at: new Date().toISOString() }).eq('id', id).is('revocado_at', null).select(COLS);
  if (data?.length) return aEnlace(data[0]);
  const { data: ya } = await supabaseAdmin.from('programacion_enlaces').select(COLS).eq('id', id).maybeSingle();
  return ya ? aEnlace(ya) : null;
}

/** El enlace de un token (con su estado), o null si no existe. Anota el último uso cada 5 min como mucho. */
export async function enlaceDeToken(token: string): Promise<EnlaceProgramacion | null> {
  if (!FORMATO_TOKEN.test(token)) return null;
  const { data } = await supabaseAdmin.from('programacion_enlaces').select(COLS).eq('token_hash', sha256Hex(token)).maybeSingle();
  if (!data) return null;
  const e = aEnlace(data);
  if (e.estado === 'vigente' && (!e.ultimo_uso_at || Date.now() - new Date(e.ultimo_uso_at).getTime() > 5 * 60_000)) {
    void supabaseAdmin.from('programacion_enlaces').update({ ultimo_uso_at: new Date().toISOString() }).eq('id', e.id)
      .then(() => { /* informativo */ }, () => { /* informativo */ });
  }
  return e;
}

// ---------------------------------------------------------------------------
// La programación, recortada según el público
// ---------------------------------------------------------------------------

export type FilaVista =
  | { tipo: 'actividad'; desc: string; hora_inicio: string; hora_fin: string }
  | {
      tipo: 'proyecto'; slot: number; bloque: number; hora_inicio: string; hora_fin: string;
      proyecto_id: string; proyecto: string; autores: string; sector: string;
      resumen?: string | null; linkedin?: string | null;
      tiene_logo?: boolean; tiene_one_pager?: boolean; one_pager_imagen?: boolean;
    };
export interface JornadaVista { numero: number; fecha: string; fecha_legible: string; filas: FilaVista[] }

/**
 * La escaleta de la cohorte con SOLO las columnas de ese público: lo que no le
 * toca ni siquiera viaja (el post no llega al navegador de las asistentes).
 * El bloque es el mismo de la página de panelistas (presentaciones entre dos
 * pausas), como la columna «Bloque» del Excel de la jornada.
 */
export async function vistaProgramacion(cohorteId: string, publico: Publico): Promise<{ evento_nombre: string; jornadas: JornadaVista[] }> {
  const cfg = PUBLICOS[publico];
  const { evento_nombre, jornadas } = await escaletaDeCohorte(cohorteId);
  const ids = [...new Set(jornadas.flatMap((j) => j.filas).map((f) => f.proyecto_id).filter(Boolean) as string[])];
  const { data: cont } = ids.length
    ? await supabaseAdmin.from('proyecto_contenido').select('proyecto_id, resumen, linkedin, one_pager_path, one_pager_url, logo_path, logo_url').in('proyecto_id', ids)
    : { data: [] as any[] };
  const contDe = new Map((cont ?? []).map((c: any) => [c.proyecto_id, c]));

  return {
    evento_nombre,
    jornadas: jornadas.filter((j) => j.filas.some((f) => f.tipo === 'proyecto')).map((j) => {
      const bloqueDe = new Map<string, number>();
      partirEnBloques(j.filas).forEach((b, i) => b.forEach((f) => { if (f.proyecto_id) bloqueDe.set(f.proyecto_id, i + 1); }));
      return {
        numero: j.numero, fecha: j.fecha, fecha_legible: j.fecha_legible,
        filas: j.filas.map((f): FilaVista => {
          if (f.tipo !== 'proyecto') return { tipo: 'actividad', desc: f.desc ?? '', hora_inicio: toHHMM(f.ini), hora_fin: toHHMM(f.fin) };
          const c: any = contDe.get(f.proyecto_id ?? '') ?? {};
          const fila: FilaVista = {
            tipo: 'proyecto', slot: f.slot ?? 0, bloque: bloqueDe.get(f.proyecto_id ?? '') ?? 0,
            hora_inicio: toHHMM(f.ini), hora_fin: toHHMM(f.fin),
            proyecto_id: f.proyecto_id ?? '', proyecto: f.proyecto ?? '', autores: f.autores ?? '', sector: f.sector ?? '',
          };
          if (cfg.resumen) fila.resumen = c.resumen ?? null;
          if (cfg.linkedin) fila.linkedin = c.linkedin ?? null;
          if (cfg.logo) fila.tiene_logo = !!(c.logo_path || c.logo_url);
          if (cfg.onePager) {
            fila.tiene_one_pager = !!(c.one_pager_path || c.one_pager_url);
            fila.one_pager_imagen = !!c.one_pager_path && mimeFromPath(c.one_pager_path).startsWith('image/');
          }
          return fila;
        }),
      };
    }),
  };
}

export { programacionPublicadaAt };
