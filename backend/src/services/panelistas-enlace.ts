import crypto from 'node:crypto';
import { config } from '../config.js';
import { supabaseAdmin } from '../db/supabase.js';
import { decryptPII, encryptPII, sha256Hex } from '../auth/crypto.js';
import { escaletaDeCohorte, toHHMM, type Fila } from './escaleta.js';
import { mimeFromPath } from './storage.js';

// Enlace compartido de panelistas (sql/55). Reemplaza al sitio alterno
// (navesfs.netlify.app/panelistas): un solo enlace por cohorte, que el super
// admin activa, desactiva y deja vigente hasta una fecha. Lo usan dos rutas: la
// pública del panelista y la del admin, por eso vive aquí.

// 32 bytes aleatorios en base64url = 43 caracteres. Se valida la forma antes de
// tocar la base: una URL inventada no debe costar una consulta.
export const FORMATO_TOKEN = /^[A-Za-z0-9_-]{43}$/;

export function urlEnlacePanelistas(token: string): string {
  return `${config.frontendUrl}/panelistas/${token}`;
}

export type EstadoEnlace = 'vigente' | 'inactivo' | 'vencido';

export interface EnlacePanelistas {
  cohorte_id: string;
  url: string | null;   // null si el token guardado no se pudo descifrar: hay que regenerarlo
  activo: boolean;
  vence_at: string;
  estado: EstadoEnlace;
  avisar_a: string[];   // a quién avisar de cada confirmación (sql/56)
}

function estadoDe(activo: boolean, venceAt: string): EstadoEnlace {
  if (!activo) return 'inactivo';
  return new Date(venceAt).getTime() > Date.now() ? 'vigente' : 'vencido';
}

export async function enlaceDeCohorte(cohorteId: string): Promise<EnlacePanelistas | null> {
  const { data } = await supabaseAdmin.from('panelistas_enlace')
    .select('cohorte_id, token_cifrado, activo, vence_at, avisar_a').eq('cohorte_id', cohorteId).maybeSingle();
  if (!data) return null;
  const d = data as any;
  let url: string | null = null;
  try { url = urlEnlacePanelistas(decryptPII(d.token_cifrado)); } catch { url = null; }
  return { cohorte_id: d.cohorte_id, url, activo: d.activo, vence_at: d.vence_at, estado: estadoDe(d.activo, d.vence_at), avisar_a: d.avisar_a ?? [] };
}

/**
 * Crea o actualiza el enlace de una cohorte. El token se genera la primera vez
 * y al regenerar (el anterior deja de abrir al instante); cambiar activo o la
 * fecha no lo cambia, así el enlace que ya circula sigue siendo el mismo.
 */
export async function guardarEnlace(
  cohorteId: string, cambios: { activo: boolean; vence_at: string; avisar_a?: string[] }, regenerar = false,
): Promise<EnlacePanelistas> {
  const { data: actual } = await supabaseAdmin.from('panelistas_enlace')
    .select('cohorte_id').eq('cohorte_id', cohorteId).maybeSingle();
  const fila: Record<string, unknown> = {
    cohorte_id: cohorteId, activo: cambios.activo, vence_at: cambios.vence_at, actualizado_at: new Date().toISOString(),
  };
  if (cambios.avisar_a) fila.avisar_a = cambios.avisar_a;
  if (!actual || regenerar) {
    const token = crypto.randomBytes(32).toString('base64url');
    fila.token_hash = sha256Hex(token);
    fila.token_cifrado = encryptPII(token);
  }
  const { error } = actual
    ? await supabaseAdmin.from('panelistas_enlace').update(fila).eq('cohorte_id', cohorteId)
    : await supabaseAdmin.from('panelistas_enlace').insert(fila);
  if (error) throw new Error(error.message);
  const out = await enlaceDeCohorte(cohorteId);
  if (!out) throw new Error('ENLACE_NO_GUARDADO');
  return out;
}

/**
 * Guarda a quién avisar de cada confirmación. Se puede hacer antes de activar
 * el enlace: si la cohorte aún no tiene enlace, se crea desactivado (vence en
 * 10 días; la fecha real se elige al activarlo).
 */
export async function guardarAvisos(cohorteId: string, avisarA: string[]): Promise<EnlacePanelistas> {
  const actual = await enlaceDeCohorte(cohorteId);
  if (actual) return guardarEnlace(cohorteId, { activo: actual.activo, vence_at: actual.vence_at, avisar_a: avisarA });
  return guardarEnlace(cohorteId, { activo: false, vence_at: new Date(Date.now() + 10 * 86400000).toISOString(), avisar_a: avisarA });
}

/** La cohorte de un token y si todavía abre. null = el enlace no existe. */
export async function cohorteDeEnlace(token: string): Promise<{ cohorte_id: string; estado: EstadoEnlace; vence_at: string } | null> {
  if (!FORMATO_TOKEN.test(token)) return null;
  const { data } = await supabaseAdmin.from('panelistas_enlace')
    .select('cohorte_id, activo, vence_at').eq('token_hash', sha256Hex(token)).maybeSingle();
  if (!data) return null;
  const d = data as any;
  return { cohorte_id: d.cohorte_id, estado: estadoDe(d.activo, d.vence_at), vence_at: d.vence_at };
}

// ---------------------------------------------------------------------------
// La programación por bloques
// ---------------------------------------------------------------------------

export type FilaBloque =
  | { tipo: 'actividad'; desc: string; hora_inicio: string; hora_fin: string }
  | {
      tipo: 'proyecto'; slot: number; hora_inicio: string; hora_fin: string;
      proyecto_id: string; proyecto: string; autores: string; resumen: string | null;
      tiene_logo: boolean; tiene_one_pager: boolean;
      one_pager_imagen: boolean;   // algunos One Pager se subieron como JPG
    };

export interface BloqueProgramacion {
  numero: number;          // dentro de la jornada, desde 1
  hora_inicio: string;     // de la primera presentación
  hora_fin: string;        // de la última presentación
  primer_slot: number;
  ultimo_slot: number;
  presentaciones: number;
  filas: FilaBloque[];
}

export interface JornadaBloques {
  id: string;
  numero: number;
  fecha: string;
  fecha_legible: string;
  bloques: BloqueProgramacion[];
}

/**
 * Parte las filas de una jornada en bloques. Un bloque son las presentaciones
 * entre dos pausas (break o almuerzo), igual que en el Excel de la jornada: con
 * bloques de 5 y el almuerzo tras la 10, la jornada 1 de int-24-26 queda en 4.
 * La apertura (foto, introducción) va con el primer bloque, cada pausa con el
 * bloque que cierra y el cierre de la jornada con el último.
 */
export function partirEnBloques(filas: Fila[]): Fila[][] {
  const bloques: Fila[][] = [];
  let actual: Fila[] = [];
  for (const f of filas) {
    actual.push(f);
    if (f.tipo === 'break' || f.tipo === 'almuerzo') { bloques.push(actual); actual = []; }
  }
  if (actual.length) bloques.push(actual);
  return bloques.filter((b) => b.some((f) => f.tipo === 'proyecto'));
}

export async function programacionPorBloques(cohorteId: string): Promise<{ evento_nombre: string; jornadas: JornadaBloques[] }> {
  const [{ evento_nombre, jornadas }, { data: jRows }] = await Promise.all([
    escaletaDeCohorte(cohorteId),
    supabaseAdmin.from('jornadas').select('id, numero').eq('cohorte_id', cohorteId),
  ]);
  const idPorNumero = new Map((jRows ?? []).map((j: any) => [j.numero, j.id as string]));

  const ids = [...new Set(jornadas.flatMap((j) => j.filas).map((f) => f.proyecto_id).filter(Boolean) as string[])];
  const { data: cont } = ids.length
    ? await supabaseAdmin.from('proyecto_contenido')
        .select('proyecto_id, resumen, one_pager_path, one_pager_url, logo_path, logo_url').in('proyecto_id', ids)
    : { data: [] as any[] };
  const contDe = new Map((cont ?? []).map((c: any) => [c.proyecto_id, c]));

  const out: JornadaBloques[] = [];
  for (const j of jornadas) {
    const bloques = partirEnBloques(j.filas).map((filas, i): BloqueProgramacion => {
      const proys = filas.filter((f) => f.tipo === 'proyecto');
      return {
        numero: i + 1,
        hora_inicio: toHHMM(proys[0].ini),
        hora_fin: toHHMM(proys[proys.length - 1].fin),
        primer_slot: proys[0].slot ?? 0,
        ultimo_slot: proys[proys.length - 1].slot ?? 0,
        presentaciones: proys.length,
        filas: filas.map((f): FilaBloque => {
          if (f.tipo !== 'proyecto') return { tipo: 'actividad', desc: f.desc ?? '', hora_inicio: toHHMM(f.ini), hora_fin: toHHMM(f.fin) };
          const c: any = contDe.get(f.proyecto_id ?? '') ?? {};
          return {
            tipo: 'proyecto', slot: f.slot ?? 0, hora_inicio: toHHMM(f.ini), hora_fin: toHHMM(f.fin),
            proyecto_id: f.proyecto_id ?? '', proyecto: f.proyecto ?? '', autores: f.autores ?? '',
            resumen: c.resumen ?? null,
            tiene_logo: !!(c.logo_path || c.logo_url),
            tiene_one_pager: !!(c.one_pager_path || c.one_pager_url),
            one_pager_imagen: !!c.one_pager_path && mimeFromPath(c.one_pager_path).startsWith('image/'),
          };
        }),
      };
    });
    const id = idPorNumero.get(j.numero);
    if (!id || !bloques.length) continue;   // jornada sin presentaciones: nada que elegir
    out.push({ id, numero: j.numero, fecha: j.fecha, fecha_legible: j.fecha_legible, bloques });
  }
  return { evento_nombre, jornadas: out };
}

/**
 * Texto de lo que eligió un panelista, una línea por bloque. Lo usan el correo
 * de confirmación y el admin. Un bloque que ya no existe (la programación cambió
 * después de que lo eligiera) se dice, en vez de desaparecer en silencio.
 */
export function describirAsistencia(
  jornadas: JornadaBloques[], asisteTodas: boolean, elegidos: Array<{ jornada_id: string; bloque: number }>,
): string[] {
  if (asisteTodas) {
    return jornadas.map((j) => `Jornada ${j.numero} · ${j.fecha_legible} · todos los bloques (${j.bloques[0].hora_inicio}–${j.bloques[j.bloques.length - 1].hora_fin})`);
  }
  const lineas: string[] = [];
  for (const j of jornadas) {
    for (const b of j.bloques) {
      if (elegidos.some((e) => e.jornada_id === j.id && e.bloque === b.numero)) {
        lineas.push(`Jornada ${j.numero} · ${j.fecha_legible} · Bloque ${b.numero}, ${b.hora_inicio}–${b.hora_fin} (presentaciones ${b.primer_slot} a ${b.ultimo_slot})`);
      }
    }
  }
  const huerfanos = elegidos.filter((e) => !jornadas.some((j) => j.id === e.jornada_id && j.bloques.some((b) => b.numero === e.bloque)));
  for (const h of huerfanos) lineas.push(`Bloque ${h.bloque} de una jornada que cambió en la programación`);
  return lineas;
}

/**
 * ¿Este proyecto se presenta en la programación de la cohorte? Las rutas
 * públicas solo entregan archivos de proyectos programados (y no privados):
 * con el enlace no se puede pedir el One Pager de cualquier proyecto por su id.
 */
export async function proyectoEnProgramacion(cohorteId: string, proyectoId: string): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(proyectoId)) return false;
  const { data } = await supabaseAdmin.from('slot_presentacion')
    .select('proyecto_id, jornadas!inner(cohorte_id), proyectos!inner(privado)')
    .eq('proyecto_id', proyectoId).eq('jornadas.cohorte_id', cohorteId).eq('proyectos.privado', false)
    .limit(1);
  return !!data?.length;
}
