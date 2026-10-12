import { Router } from 'express';
import { supabaseAdmin } from '../db/supabase.js';
import { requireAuth, type AuthenticatedRequest } from '../auth/middleware.js';

// Notificaciones dentro de la plataforma (Módulo E). Cada usuario ve las suyas
// (por su auth_user_id = sub del JWT).

const router = Router();
router.use(requireAuth());

// GET /api/notificaciones — mis notificaciones, de 50 en 50 (?pagina=2 trae las
// anteriores) + el conteo REAL de no leídas.
//
// Antes no_leidas se contaba sobre las 50 que se devolvían: con más avisos, al
// abrir la campana el número bajaba a 50 como mucho mientras /contador daba la
// cifra real. Ahora se cuenta en la base, igual que /contador.
const POR_PAGINA_NOTIF = 50;
router.get('/', async (req: AuthenticatedRequest, res) => {
  const sub = req.user!.sub;
  const pagina = Math.max(Math.floor(Number(req.query.pagina ?? 1)) || 1, 1);
  const inicio = (pagina - 1) * POR_PAGINA_NOTIF;
  const [lista, sinLeer] = await Promise.all([
    supabaseAdmin
      .from('notificaciones')
      .select('id, tipo, titulo, cuerpo, enlace, leida, creada_at', { count: 'exact' })
      .eq('destinatario_auth_id', sub)
      // El id desempata avisos creados en el mismo instante (p. ej. al publicar
      // la programación se crean muchos a la vez) para que ninguno se repita ni
      // se salte entre páginas.
      .order('creada_at', { ascending: false })
      .order('id', { ascending: false })
      .range(inicio, inicio + POR_PAGINA_NOTIF - 1),
    supabaseAdmin
      .from('notificaciones')
      .select('id', { count: 'exact', head: true })
      .eq('destinatario_auth_id', sub)
      .eq('leida', false),
  ]);
  const items = lista.data ?? [];
  const total = lista.count ?? items.length;
  res.json({
    items,
    no_leidas: sinLeer.count ?? items.filter((n: any) => !n.leida).length,
    total,
    hay_mas: inicio + items.length < total,
  });
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
