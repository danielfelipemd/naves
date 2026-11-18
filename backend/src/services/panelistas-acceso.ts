import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { config } from '../config.js';
import { supabaseAdmin } from '../db/supabase.js';
import { decryptPII, encryptPII, sha256Hex } from '../auth/crypto.js';
import { requireAuth, requireRole, type AuthenticatedRequest } from '../auth/middleware.js';
import { FORMATO_TOKEN } from './panelistas-enlace.js';

// Acceso por enlace mágico al panel de Panelistas (sql/57). La asistente de
// programa entra sin cuenta y hace allí todo lo que hace el super admin, solo
// en la cohorte de su acceso y hasta la fecha que fije el super admin.
//
// El token viaja en la cabecera X-Acceso-Panelistas (no en la URL de la API):
// la página /panelistas-admin/<token> lo lee una vez y lo manda en cada llamada.

export const CABECERA_ACCESO = 'x-acceso-panelistas';

export function urlAccesoPanelistas(token: string): string {
  return `${config.frontendUrl}/panelistas-admin/${token}`;
}

export type EstadoAcceso = 'vigente' | 'vencido' | 'revocado';

export interface AccesoPanelistas {
  id: string;
  cohorte_id: string;
  nombre: string | null;
  email: string;
  vence_at: string;
  estado: EstadoAcceso;
  ultimo_uso_at: string | null;
  url: string | null;
}

function estadoDe(a: any): EstadoAcceso {
  if (a.revocado_at) return 'revocado';
  return new Date(a.vence_at).getTime() > Date.now() ? 'vigente' : 'vencido';
}

function aAcceso(a: any): AccesoPanelistas {
  let email = ''; try { email = decryptPII(a.email_encriptado); } catch { email = ''; }
  let url: string | null = null; try { url = urlAccesoPanelistas(decryptPII(a.token_cifrado)); } catch { url = null; }
  return { id: a.id, cohorte_id: a.cohorte_id, nombre: a.nombre, email, vence_at: a.vence_at, estado: estadoDe(a), ultimo_uso_at: a.ultimo_uso_at, url };
}

const COLS = 'id, cohorte_id, nombre, email_encriptado, token_cifrado, vence_at, revocado_at, ultimo_uso_at';

export async function crearAcceso(cohorteId: string, datos: { nombre: string | null; email: string; vence_at: string }, creadoPor: string | null): Promise<AccesoPanelistas> {
  const token = crypto.randomBytes(32).toString('base64url');
  const { data, error } = await supabaseAdmin.from('panelistas_acceso').insert({
    cohorte_id: cohorteId,
    nombre: datos.nombre,
    email_encriptado: encryptPII(datos.email),
    email_hash: sha256Hex(datos.email.toLowerCase()),
    token_hash: sha256Hex(token),
    token_cifrado: encryptPII(token),
    vence_at: datos.vence_at,
    creado_por: creadoPor,
  }).select(COLS).single();
  if (error || !data) throw new Error(error?.message ?? 'NO_SE_PUDO_CREAR');
  return aAcceso(data);
}

export async function accesosDeCohorte(cohorteId: string): Promise<AccesoPanelistas[]> {
  const { data } = await supabaseAdmin.from('panelistas_acceso').select(COLS)
    .eq('cohorte_id', cohorteId).order('creado_at', { ascending: false });
  return (data ?? []).map(aAcceso);
}

export async function accesoPorId(id: string): Promise<AccesoPanelistas | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data } = await supabaseAdmin.from('panelistas_acceso').select(COLS).eq('id', id).maybeSingle();
  return data ? aAcceso(data) : null;
}

export async function revocarAcceso(id: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin.from('panelistas_acceso')
    .update({ revocado_at: new Date().toISOString() }).eq('id', id).is('revocado_at', null).select('id');
  return !error && !!data?.length;
}

/** El acceso de un token, o null si no existe. No mira vencimiento: lo dice `estado`. */
export async function accesoDeToken(token: string): Promise<AccesoPanelistas | null> {
  if (!FORMATO_TOKEN.test(token)) return null;
  const { data } = await supabaseAdmin.from('panelistas_acceso').select(COLS).eq('token_hash', sha256Hex(token)).maybeSingle();
  return data ? aAcceso(data) : null;
}

/**
 * Guardián de las rutas del panel de Panelistas: deja pasar al super admin (con
 * su sesión) o a quien traiga un acceso vigente PARA ESA COHORTE. `cohorteDe`
 * dice de qué cohorte es lo que se pide (el parámetro de la ruta, o la cohorte
 * del panelista). Sin la cabecera, es exactamente el guardián de antes.
 */
export function adminOAcceso(cohorteDe: (req: Request) => Promise<string | null>) {
  const auth = requireAuth();
  const rol = requireRole('super_admin');
  return async (req: Request, res: Response, next: NextFunction) => {
    const token = req.header(CABECERA_ACCESO);
    if (!token) return auth(req as AuthenticatedRequest, res, (err?: unknown) => (err ? next(err) : rol(req as AuthenticatedRequest, res, next)));
    const a = await accesoDeToken(token);
    if (!a) return res.status(401).json({ error: 'ACCESO_INVALIDO' });
    if (a.estado === 'revocado') return res.status(401).json({ error: 'ACCESO_REVOCADO' });
    if (a.estado === 'vencido') return res.status(401).json({ error: 'ACCESO_VENCIDO' });
    const cohorte = await cohorteDe(req);
    if (!cohorte || cohorte !== a.cohorte_id) return res.status(403).json({ error: 'FUERA_DE_ALCANCE' });
    (req as any).accesoPanelistas = a;
    // Último uso, como mucho una escritura cada 5 minutos por acceso.
    if (!a.ultimo_uso_at || Date.now() - new Date(a.ultimo_uso_at).getTime() > 5 * 60_000) {
      void supabaseAdmin.from('panelistas_acceso').update({ ultimo_uso_at: new Date().toISOString() }).eq('id', a.id)
        .then(() => { /* informativo */ }, () => { /* informativo */ });
    }
    next();
  };
}

/** La cohorte del parámetro :cohorteId. */
export const cohorteDelParametro = async (req: Request) => (req.params.cohorteId as string) ?? null;
/** La cohorte del panelista del parámetro :id. */
export async function cohorteDelPanelista(req: Request): Promise<string | null> {
  if (!/^[0-9a-f-]{36}$/i.test(String(req.params.id ?? ''))) return null;
  const { data } = await supabaseAdmin.from('panelistas').select('cohorte_id').eq('id', req.params.id).maybeSingle();
  return (data as any)?.cohorte_id ?? null;
}
