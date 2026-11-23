// Copia de las actas firmadas.
//
// Cuando un acta queda con TODAS sus firmas (estado 'completa'), el sistema
// manda sola una copia en PDF a los correos configurados para su modalidad.
// Lo pidió Daniel el 23/11/2026 para las actas de Caso (coordinación), y que el
// super admin pueda cambiar esos correos desde el panel de Actas.
//
// Los correos viven en config_sistema, clave 'actas_copia_firmadas'
// (sql/62_config_copia_actas.sql). Una modalidad sin correos no manda copia.

import { supabaseAdmin } from '../../db/supabase.js';
import { sendEmail, type EmailAttachment } from '../email.js';
import { buildActaPDF } from './pdf-acta.js';

export const CLAVE_COPIAS = 'actas_copia_firmadas';
export const MODALIDADES = ['caso', 'business_plan', 'proyecto_investigacion'] as const;
export type ModalidadActa = (typeof MODALIDADES)[number];
export type CopiasConfig = Record<ModalidadActa, string[]>;

const ETIQUETA: Record<ModalidadActa, string> = {
  caso: 'Caso',
  business_plan: 'Business Plan',
  proyecto_investigacion: 'Proyecto de Investigación',
};

/** Máximo de correos por modalidad: evita que un error de pegado mande copias masivas. */
export const MAX_CORREOS = 10;
const RE_EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

const vacia = (): CopiasConfig => ({ caso: [], business_plan: [], proyecto_investigacion: [] });

/**
 * Valida y normaliza lo que manda el panel. Devuelve el error en español si
 * algún correo no sirve, para mostrarlo tal cual.
 */
export function normalizarCopias(entrada: unknown): { ok: true; valor: CopiasConfig } | { ok: false; mensaje: string } {
  const valor = vacia();
  const e = (entrada ?? {}) as Record<string, unknown>;
  for (const m of MODALIDADES) {
    const lista = e[m] ?? [];
    if (!Array.isArray(lista)) return { ok: false, mensaje: `${ETIQUETA[m]}: la lista de correos no es válida.` };
    const vistos = new Set<string>();
    for (const bruto of lista) {
      const correo = String(bruto ?? '').trim().toLowerCase();
      if (!correo) continue;
      if (!RE_EMAIL.test(correo)) return { ok: false, mensaje: `${ETIQUETA[m]}: «${correo}» no es un correo válido.` };
      // Una tilde o una ñ en el correo casi siempre es un error de tecleo y el
      // servidor de correo lo rechaza.
      if (/[^\x21-\x7e]/.test(correo)) return { ok: false, mensaje: `${ETIQUETA[m]}: «${correo}» tiene tildes o caracteres especiales. Escríbelo sin tildes.` };
      if (vistos.has(correo)) continue;
      vistos.add(correo);
      valor[m].push(correo);
    }
    if (valor[m].length > MAX_CORREOS) return { ok: false, mensaje: `${ETIQUETA[m]}: máximo ${MAX_CORREOS} correos.` };
  }
  return { ok: true, valor };
}

export async function leerCopias(): Promise<CopiasConfig> {
  const { data } = await supabaseAdmin.from('config_sistema').select('valor').eq('clave', CLAVE_COPIAS).maybeSingle();
  const r = normalizarCopias((data as any)?.valor);
  return r.ok ? r.valor : vacia();
}

export async function guardarCopias(valor: CopiasConfig, por: string): Promise<{ error?: string }> {
  const { error } = await supabaseAdmin.from('config_sistema').upsert({
    clave: CLAVE_COPIAS, valor, actualizado_por: por, actualizado_en: new Date().toISOString(),
  });
  return error ? { error: error.message } : {};
}

type Enviar = (to: string, subject: string, html: string, adj?: EmailAttachment[]) => Promise<{ ok: boolean; reason?: string }>;

function plantilla(a: any, modalidad: string, etiqueta: string): string {
  const fila = (k: string, v: string | null | undefined) => v
    ? `<tr><td style="padding:4px 12px 4px 0;color:#6b6b6b">${k}</td><td style="padding:4px 0"><strong>${v}</strong></td></tr>` : '';
  return `
  <div style="font-family:Helvetica,Arial,sans-serif;color:#1a1a1a;max-width:560px;margin:0 auto">
    <div style="border-bottom:3px solid #e30613;padding-bottom:12px;margin-bottom:24px">
      <div style="font-weight:700;letter-spacing:1.5px;font-size:13px">INALDE BUSINESS SCHOOL</div>
      <div style="color:#6b6b6b;font-size:11px;text-transform:uppercase;letter-spacing:1px">Trabajo de grado · MBA</div>
    </div>
    <p style="font-size:14px;line-height:1.6">
      El acta de <strong>${modalidad}</strong> quedó con todas sus firmas. Se adjunta la copia en PDF.
    </p>
    <table style="font-size:14px;border-collapse:collapse;margin:16px 0">
      ${fila('Participante', a.nombre_participante)}
      ${fila('Proyecto', a.nombre_proyecto)}
      ${fila('Calificación', a.calificacion)}
      ${fila('Cohorte', etiqueta)}
    </table>
    <p style="font-size:12px;color:#6b6b6b;border-top:1px solid #e8e8e8;padding-top:12px;margin-top:24px">
      Firma electrónica conforme a la Ley 527 de 1999 y el Decreto 2364 de 2012.
    </p>
  </div>`;
}

/**
 * Manda la copia del acta si está completa y su modalidad tiene correos
 * configurados. Nunca lanza: la firma ya quedó guardada y un fallo de correo
 * no debe deshacerla ni romper la respuesta al firmante.
 */
export async function enviarCopiaActaFirmada(
  actaId: number | string,
  enviar: Enviar = sendEmail,
): Promise<{ enviada: string[]; fallida: string[]; omitida?: string }> {
  try {
    const { data: a } = await supabaseAdmin.from('acta').select('*').eq('id', actaId).maybeSingle();
    if (!a) return { enviada: [], fallida: [], omitida: 'NO_ENCONTRADA' };
    if ((a as any).estado !== 'completa') return { enviada: [], fallida: [], omitida: 'NO_COMPLETA' };
    const modalidad = (a as any).modalidad as ModalidadActa;
    const destinos = (await leerCopias())[modalidad] ?? [];
    if (!destinos.length) return { enviada: [], fallida: [], omitida: 'SIN_CORREOS' };

    const { data: coh } = await supabaseAdmin.from('cohortes').select('etiqueta').eq('id', (a as any).cohorte_id).maybeSingle();
    const pdf = await buildActaPDF(a as any);
    const nombre = String((a as any).nombre_participante ?? actaId).normalize('NFD').replace(/[^a-zA-Z0-9]+/g, '_');
    const etq = ETIQUETA[modalidad] ?? modalidad;
    const asunto = `Acta de ${etq} firmada — ${(a as any).nombre_participante ?? `Acta ${actaId}`}`;
    const html = plantilla(a, etq, (coh as any)?.etiqueta ?? '');
    const adjunto = [{ filename: `acta-${modalidad}-${nombre}.pdf`, content: pdf, contentType: 'application/pdf' }];

    const enviada: string[] = [];
    const fallida: string[] = [];
    // Uno por uno: si un buzón rechaza, los demás igual reciben su copia.
    for (const dest of destinos) {
      const r = await enviar(dest, asunto, html, adjunto);
      (r.ok ? enviada : fallida).push(dest);
      if (!r.ok) console.error('[actas.copia] no se pudo enviar la copia del acta', actaId, 'a', dest, r.reason);
    }
    console.log('[actas.copia] acta', actaId, 'copia enviada a', enviada.join(', ') || '(nadie)');
    return { enviada, fallida };
  } catch (e) {
    console.error('[actas.copia] error con el acta', actaId, (e as Error).message);
    return { enviada: [], fallida: [], omitida: 'ERROR' };
  }
}
