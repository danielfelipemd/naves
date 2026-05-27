import { Router } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../db/supabase.js';
import { requireAuth, requireRole, type AuthenticatedRequest } from '../auth/middleware.js';
import { encryptPII, decryptPII } from '../auth/crypto.js';

const router = Router();
router.use(requireAuth());

// === GET /api/directores/disponibles ========================================
// Lista publica para participantes: solo nombre + id. Sin email.
router.get('/disponibles', async (_req: AuthenticatedRequest, res) => {
  const { data, error } = await supabaseAdmin
    .from('directores')
    .select('id, nombre_completo, areas_afinidad')
    .eq('estado', 'activo')
    .order('nombre_completo');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data ?? []);
});

// === GET /api/directores (admin) ============================================
router.get('/', requireRole('super_admin'), async (_req: AuthenticatedRequest, res) => {
  const { data, error } = await supabaseAdmin
    .from('directores')
    .select('id, nombre_completo, email_encriptado, estado, areas_afinidad, created_at')
    .order('nombre_completo');
  if (error) return res.status(500).json({ error: error.message });
  const items = (data ?? []).map((d: any) => {
    let email = '';
    try { email = decryptPII(d.email_encriptado); } catch { email = ''; }
    return {
      id: d.id,
      nombre_completo: d.nombre_completo,
      email,
      estado: d.estado,
      areas_afinidad: d.areas_afinidad ?? [],
      created_at: d.created_at,
    };
  });
  res.json(items);
});

// === POST /api/directores (admin) ===========================================
const createSchema = z.object({
  nombre_completo: z.string().trim().min(2).max(150),
  email: z.string().trim().email().max(150),
  areas_afinidad: z.array(z.string().trim()).optional(),
});
router.post('/', requireRole('super_admin'), async (req: AuthenticatedRequest, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'INVALID', details: parsed.error.issues });

  const { data, error } = await supabaseAdmin
    .from('directores')
    .insert({
      nombre_completo: parsed.data.nombre_completo,
      email_encriptado: encryptPII(parsed.data.email.toLowerCase()),
      areas_afinidad: parsed.data.areas_afinidad ?? [],
    })
    .select('id')
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ id: data.id });
});

// === PUT /api/directores/:id (admin) ========================================
const updateSchema = z.object({
  nombre_completo: z.string().trim().min(2).max(150).optional(),
  email: z.string().trim().email().max(150).optional(),
  estado: z.enum(['activo', 'inactivo']).optional(),
  areas_afinidad: z.array(z.string().trim()).optional(),
});
router.put('/:id', requireRole('super_admin'), async (req: AuthenticatedRequest, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'INVALID', details: parsed.error.issues });

  const upd: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (parsed.data.nombre_completo) upd.nombre_completo = parsed.data.nombre_completo;
  if (parsed.data.email) upd.email_encriptado = encryptPII(parsed.data.email.toLowerCase());
  if (parsed.data.estado) upd.estado = parsed.data.estado;
  if (parsed.data.areas_afinidad) upd.areas_afinidad = parsed.data.areas_afinidad;

  const { error } = await supabaseAdmin.from('directores').update(upd).eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// === DELETE /api/directores/:id (admin) =====================================
router.delete('/:id', requireRole('super_admin'), async (req: AuthenticatedRequest, res) => {
  const { count } = await supabaseAdmin
    .from('equipos').select('id', { count: 'exact', head: true }).eq('director_id', req.params.id);
  if ((count ?? 0) > 0) {
    return res.status(409).json({ error: 'DIRECTOR_EN_USO', mensaje: 'Este director ya está asignado a uno o más equipos.' });
  }
  const { error } = await supabaseAdmin.from('directores').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

export default router;
