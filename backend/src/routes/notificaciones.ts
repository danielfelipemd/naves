import { Router } from 'express';
import { supabaseAdmin } from '../db/supabase.js';
import { requireAuth, type AuthenticatedRequest } from '../auth/middleware.js';

// Notificaciones dentro de la plataforma (Módulo E). Cada usuario ve las suyas
// (por su auth_user_id = sub del JWT).

const router = Router();
router.use(requireAuth());

// GET /api/notificaciones — mis notificaciones (máx 50) + conteo de no leídas
router.get('/', async (req: AuthenticatedRequest, res) => {
  const sub = req.user!.sub;
  const { data } = await supabaseAdmin
    .from('notificaciones')
    .select('id, tipo, titulo, cuerpo, enlace, leida, creada_at')
    .eq('destinatario_auth_id', sub)
    .order('creada_at', { ascending: false })
    .limit(50);
  const items = data ?? [];
  res.json({ items, no_leidas: items.filter((n: any) => !n.leida).length });
});

// GET /api/notificaciones/contador — solo el número de no leídas (para la campana)
router.get('/contador', async (req: AuthenticatedRequest, res) => {
  const sub = req.user!.sub;
  const { count } = await supabaseAdmin
    .from('notificaciones')
    .select('id', { count: 'exact', head: true })
    .eq('destinatario_auth_id', sub)
    .eq('leida', false);
  res.json({ no_leidas: count ?? 0 });
});

// POST /api/notificaciones/:id/leer — marcar una como leída (solo si es mía)
router.post('/:id/leer', async (req: AuthenticatedRequest, res) => {
  const sub = req.user!.sub;
  await supabaseAdmin.from('notificaciones').update({ leida: true }).eq('id', req.params.id).eq('destinatario_auth_id', sub);
  res.json({ ok: true });
});

// POST /api/notificaciones/leer-todas — marcar todas mías como leídas
router.post('/leer-todas', async (req: AuthenticatedRequest, res) => {
  const sub = req.user!.sub;
  await supabaseAdmin.from('notificaciones').update({ leida: true }).eq('destinatario_auth_id', sub).eq('leida', false);
  res.json({ ok: true });
});

export default router;
