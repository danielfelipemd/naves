import { Router } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../db/supabase.js';
import { requireAuth } from '../auth/middleware.js';
import { requirePermission, invalidateUserPermisos } from '../auth/permissions.js';

const router = Router();
router.use(requireAuth(), requirePermission('roles.gestionar'));

// ===== Permisos disponibles (catálogo) ===========================
router.get('/permisos', async (_req, res) => {
  const { data, error } = await supabaseAdmin
    .from('permisos')
    .select('*')
    .order('categoria')
    .order('code');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data ?? []);
});

// ===== CRUD de roles =============================================
router.get('/', async (_req, res) => {
  const { data, error } = await supabaseAdmin
    .from('roles')
    .select('*, rol_permisos(permiso_code)')
    .order('es_sistema', { ascending: false })
    .order('nombre');
  if (error) return res.status(500).json({ error: error.message });
  // Transformar rol_permisos[] en permisos: string[]
  const out = (data ?? []).map((r: any) => ({
    ...r,
    permisos: (r.rol_permisos ?? []).map((rp: any) => rp.permiso_code),
    rol_permisos: undefined,
  }));
  res.json(out);
});

const createRoleSchema = z.object({
  nombre: z.string().min(2).max(60).regex(/^[a-z_][a-z0-9_]*$/, 'Solo minúsculas, números y guiones bajos'),
  descripcion: z.string().max(500).optional(),
  permisos: z.array(z.string()).default([]),
});

router.post('/', async (req, res) => {
  const parsed = createRoleSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'INVALID', details: parsed.error.issues });

  const { data: rol, error } = await supabaseAdmin
    .from('roles')
    .insert({ nombre: parsed.data.nombre, descripcion: parsed.data.descripcion ?? null, es_sistema: false })
    .select().single();
  if (error) return res.status(400).json({ error: error.message });

  if (parsed.data.permisos.length) {
    await supabaseAdmin.from('rol_permisos').insert(
      parsed.data.permisos.map((p) => ({ rol_id: rol.id, permiso_code: p })),
    );
  }
  res.status(201).json({ rol });
});

const updateRoleSchema = z.object({
  descripcion: z.string().max(500).nullable().optional(),
  permisos: z.array(z.string()).optional(),
});

router.put('/:id', async (req, res) => {
  const parsed = updateRoleSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'INVALID', details: parsed.error.issues });

  const { data: rol } = await supabaseAdmin.from('roles').select('id, es_sistema').eq('id', req.params.id).maybeSingle();
  if (!rol) return res.status(404).json({ error: 'NOT_FOUND' });

  if (parsed.data.descripcion !== undefined) {
    await supabaseAdmin.from('roles').update({ descripcion: parsed.data.descripcion }).eq('id', req.params.id);
  }
  if (parsed.data.permisos !== undefined) {
    // reemplazar lista de permisos
    await supabaseAdmin.from('rol_permisos').delete().eq('rol_id', req.params.id);
    if (parsed.data.permisos.length) {
      await supabaseAdmin.from('rol_permisos').insert(
        parsed.data.permisos.map((p) => ({ rol_id: req.params.id, permiso_code: p })),
      );
    }
    // Invalidar cache de TODOS los usuarios con este rol
    const { data: users } = await supabaseAdmin.from('usuario_roles').select('auth_user_id').eq('rol_id', req.params.id);
    for (const u of users ?? []) invalidateUserPermisos(u.auth_user_id);
  }

  res.json({ ok: true });
});

router.delete('/:id', async (req, res) => {
  const { data: rol } = await supabaseAdmin.from('roles').select('es_sistema').eq('id', req.params.id).maybeSingle();
  if (!rol) return res.status(404).json({ error: 'NOT_FOUND' });
  if (rol.es_sistema) return res.status(403).json({ error: 'CANNOT_DELETE_SYSTEM_ROLE' });

  // Invalidar cache de usuarios afectados
  const { data: users } = await supabaseAdmin.from('usuario_roles').select('auth_user_id').eq('rol_id', req.params.id);
  for (const u of users ?? []) invalidateUserPermisos(u.auth_user_id);

  const { error } = await supabaseAdmin.from('roles').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// ===== Listado completo de usuarios del sistema =================
/**
 * GET /api/admin/roles/usuarios
 * Devuelve profesores y participantes con sus roles asignados.
 */
router.get('/usuarios', async (_req, res) => {
  const [profs, parts] = await Promise.all([
    supabaseAdmin.from('profesores').select('id, auth_user_id, nombre_completo, activo'),
    supabaseAdmin.from('participantes_lista').select('id, auth_user_id, nombre_completo, cohorte_id, estado'),
  ]);

  const allUserIds = [
    ...((profs.data ?? []).map((p) => p.auth_user_id)),
    ...((parts.data ?? []).map((p) => p.auth_user_id)),
  ].filter(Boolean) as string[];

  const { data: ur } = await supabaseAdmin.from('usuario_roles')
    .select('auth_user_id, roles(id, nombre)')
    .in('auth_user_id', allUserIds);

  const rolesByUser = new Map<string, Array<{ id: string; nombre: string }>>();
  for (const row of ur ?? []) {
    const list = rolesByUser.get(row.auth_user_id) ?? [];
    list.push(row.roles as any);
    rolesByUser.set(row.auth_user_id, list);
  }

  const profesores = (profs.data ?? []).filter((p) => p.auth_user_id).map((p) => ({
    tipo: 'profesor' as const,
    auth_user_id: p.auth_user_id,
    nombre_completo: p.nombre_completo,
    activo: p.activo,
    roles: rolesByUser.get(p.auth_user_id!) ?? [],
  }));
  const participantes = (parts.data ?? []).filter((p) => p.auth_user_id).map((p) => ({
    tipo: 'participante' as const,
    auth_user_id: p.auth_user_id,
    nombre_completo: p.nombre_completo,
    cohorte_id: p.cohorte_id,
    estado: p.estado,
    roles: rolesByUser.get(p.auth_user_id!) ?? [],
  }));

  res.json({ profesores, participantes });
});

// ===== Asignación de roles a usuarios ============================
router.get('/usuarios/:auth_user_id', async (req, res) => {
  const [{ data: roles }, { data: extras }] = await Promise.all([
    supabaseAdmin.from('usuario_roles').select('rol_id, roles(nombre, descripcion)').eq('auth_user_id', req.params.auth_user_id),
    supabaseAdmin.from('usuario_permisos').select('permiso_code').eq('auth_user_id', req.params.auth_user_id),
  ]);
  res.json({ roles: roles ?? [], permisos_extra: (extras ?? []).map((e: any) => e.permiso_code) });
});

const assignRolesSchema = z.object({
  auth_user_id: z.string().uuid(),
  roles: z.array(z.string().uuid()),
});

router.post('/usuarios/asignar', async (req: any, res) => {
  const parsed = assignRolesSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'INVALID', details: parsed.error.issues });

  await supabaseAdmin.from('usuario_roles').delete().eq('auth_user_id', parsed.data.auth_user_id);
  if (parsed.data.roles.length) {
    await supabaseAdmin.from('usuario_roles').insert(
      parsed.data.roles.map((rol_id) => ({
        auth_user_id: parsed.data.auth_user_id,
        rol_id,
        asignado_por: req.user?.sub ?? null,
      })),
    );
  }
  invalidateUserPermisos(parsed.data.auth_user_id);
  res.json({ ok: true });
});

const grantPermisoSchema = z.object({
  auth_user_id: z.string().uuid(),
  permiso_code: z.string(),
});

router.post('/usuarios/permiso-extra', async (req: any, res) => {
  const parsed = grantPermisoSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'INVALID' });
  await supabaseAdmin.from('usuario_permisos').upsert({
    auth_user_id: parsed.data.auth_user_id,
    permiso_code: parsed.data.permiso_code,
    asignado_por: req.user?.sub ?? null,
  });
  invalidateUserPermisos(parsed.data.auth_user_id);
  res.json({ ok: true });
});

router.delete('/usuarios/:auth_user_id/permisos/:code', async (req, res) => {
  await supabaseAdmin.from('usuario_permisos').delete()
    .eq('auth_user_id', req.params.auth_user_id)
    .eq('permiso_code', req.params.code);
  invalidateUserPermisos(req.params.auth_user_id);
  res.json({ ok: true });
});

export default router;
