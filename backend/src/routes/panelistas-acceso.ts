import { Router } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../db/supabase.js';
import { requireAuth, requireRole, type AuthenticatedRequest } from '../auth/middleware.js';
import {
  CABECERA_ACCESO, accesoDeToken, accesoPorId, accesosDeCohorte, crearAcceso, revocarAcceso, type AccesoPanelistas,
} from '../services/panelistas-acceso.js';

// Accesos por enlace mágico al panel de Panelistas (sql/57). Crear y revocar
// es SOLO del super admin con su sesión: quien entra por un enlace no
// puede fabricar otros. Lo que la asistente puede hacer dentro del panel lo
// decide el guardián adminOAcceso de las rutas de panelistas.

const router = Router();
const soloAdmin = [requireAuth(), requireRole('super_admin')] as const;

async function etiquetaDe(cohorteId: string): Promise<string> {
  const { data } = await supabaseAdmin.from('cohortes').select('etiqueta').eq('id', cohorteId).maybeSingle();
  return (data as any)?.etiqueta ?? cohorteId;
}

async function auditar(req: AuthenticatedRequest, accion: string, detalles: Record<string, unknown>) {
  await supabaseAdmin.from('auditoria').insert({
    actor_tipo: 'super_admin', actor_id: req.user?.profesorId ?? null, accion,
    entidad_tipo: 'panelistas_acceso', entidad_id: (detalles.acceso_id as string) ?? null, detalles, timestamp: new Date().toISOString(),
  }).then(() => { /* el rastro no debe tumbar el cambio */ }, () => { /* idem */ });
}

// GET /api/panelistas-acceso/yo — la página de la asistente pregunta de qué es su acceso.
router.get('/yo', async (req, res) => {
  const a = await accesoDeToken(String(req.header(CABECERA_ACCESO) ?? ''));
  if (!a) return res.status(401).json({ error: 'ACCESO_INVALIDO' });
  if (a.estado === 'revocado') return res.status(401).json({ error: 'ACCESO_REVOCADO' });
  if (a.estado === 'vencido') return res.status(401).json({ error: 'ACCESO_VENCIDO', vence_at: a.vence_at });
  res.setHeader('Cache-Control', 'no-store');
  res.json({ cohorte_id: a.cohorte_id, cohorte: await etiquetaDe(a.cohorte_id), nombre: a.nombre, email: a.email, vence_at: a.vence_at });
});

// GET /api/panelistas-acceso/admin/:cohorteId — los accesos de la cohorte.
router.get('/admin/:cohorteId', ...soloAdmin, async (req, res) => {
  res.json({ accesos: await accesosDeCohorte(req.params.cohorteId) });
});

// POST /api/panelistas-acceso/admin/:cohorteId — crear y enviar por correo.
const crearSchema = z.object({
  nombre: z.string().trim().max(150).optional().nullable(),
  email: z.string().trim().toLowerCase().email().max(200),
  vence_at: z.string().datetime({ offset: true }),
});
router.post('/admin/:cohorteId', ...soloAdmin, async (req: AuthenticatedRequest, res) => {
  const parsed = crearSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: 'CORREO_INVALIDO', mensaje: 'Revisa el correo.' });
  if (new Date(parsed.data.vence_at).getTime() <= Date.now()) {
    return res.status(400).json({ error: 'VENCE_EN_EL_PASADO', mensaje: 'La fecha de vencimiento ya pasó: elige una fecha futura.' });
  }
  const { data: coh } = await supabaseAdmin.from('cohortes').select('id').eq('id', req.params.cohorteId).maybeSingle();
  if (!coh) return res.status(404).json({ error: 'COHORTE_NO_ENCONTRADA' });
  let a: AccesoPanelistas;
  try {
    a = await crearAcceso(req.params.cohorteId, { nombre: parsed.data.nombre || null, email: parsed.data.email, vence_at: parsed.data.vence_at }, req.user?.profesorId ?? null);
  } catch { return res.status(500).json({ error: 'NO_SE_PUDO_GUARDAR' }); }
  // No se envía por correo: el super admin lo copia y lo manda por el medio que
  // quiera (Daniel, 18/11/2026).
  await auditar(req, 'ADMIN_ACCESO_PANELISTAS_CREADO', { acceso_id: a.id, cohorte_id: a.cohorte_id, vence_at: a.vence_at });
  res.status(201).json({ acceso: a });
});

// DELETE /api/panelistas-acceso/admin/acceso/:id — revocar: deja de abrir al instante.
router.delete('/admin/acceso/:id', ...soloAdmin, async (req: AuthenticatedRequest, res) => {
  const a = await accesoPorId(req.params.id);
  if (!a) return res.status(404).json({ error: 'NO_ENCONTRADO' });
  await revocarAcceso(a.id);
  await auditar(req, 'ADMIN_ACCESO_PANELISTAS_REVOCADO', { acceso_id: a.id, cohorte_id: a.cohorte_id });
  res.json({ ok: true });
});

export default router;
