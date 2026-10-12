import { Router } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../db/supabase.js';
import { requireAuth } from '../auth/middleware.js';
import { requirePermission, invalidateUserPermisos } from '../auth/permissions.js';
import { traerTodasLasFilas } from '../lib/traerTodasLasFilas.js';

const router = Router();

/** Todas las cuentas con un rol, sin el tope de 1000 filas de PostgREST. */
function usuariosDelRol(rolId: string) {
  return traerTodasLasFilas((desde, hasta) => supabaseAdmin.from('usuario_roles')
    .select('auth_user_id')
    .eq('rol_id', rolId)
    .order('auth_user_id')
    .range(desde, hasta),
  // Con un rol fijo, auth_user_id ya es único.
  (f: any) => f.auth_user_id);
}
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
    // Si esto falla en silencio queda un rol creado que NO otorga nada, y el
    // admin lo ve como correcto. Revertimos el rol para no dejarlo a medias.
    const { error: errPerm } = await supabaseAdmin.from('rol_permisos').insert(
      parsed.data.permisos.map((p) => ({ rol_id: rol.id, permiso_code: p })),
    );
    if (errPerm) {
      await supabaseAdmin.from('roles').delete().eq('id', rol.id);
      return res.status(500).json({ error: 'ROL_PERMISOS_FAILED', detail: errPerm.message });
    }
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
    const { error } = await supabaseAdmin.from('roles').update({ descripcion: parsed.data.descripcion }).eq('id', req.params.id);
    if (error) return res.status(500).json({ error: 'ROL_UPDATE_FAILED', detail: error.message });
  }
  if (parsed.data.permisos !== undefined) {
    // Reemplazar lista de permisos: es un borrar-y-reinsertar sobre PERMISOS.
    // Si el borrado pasa y el insert falla en silencio, el rol se queda SIN
    // permisos y todos sus usuarios pierden acceso creyendo el admin que
    // guardó. Si falla el borrado y pasa el insert, quedan vivos permisos que
    // el admin acaba de revocar. Verificamos ambos pasos.
    const { error: errDel } = await supabaseAdmin.from('rol_permisos').delete().eq('rol_id', req.params.id);
    if (errDel) return res.status(500).json({ error: 'ROL_PERMISOS_FAILED', paso: 'borrar', detail: errDel.message });
    if (parsed.data.permisos.length) {
      const { error: errIns } = await supabaseAdmin.from('rol_permisos').insert(
        parsed.data.permisos.map((p) => ({ rol_id: req.params.id, permiso_code: p })),
      );
      if (errIns) return res.status(500).json({ error: 'ROL_PERMISOS_FAILED', paso: 'insertar', detail: errIns.message });
    }
    // Invalidar cache de TODOS los usuarios con este rol (paginado: un rol
    // como «participante» crece con cada cohorte).
    const { data: users } = await usuariosDelRol(req.params.id);
    for (const u of users ?? []) invalidateUserPermisos(u.auth_user_id);
  }

  res.json({ ok: true });
});

router.delete('/:id', async (req, res) => {
  const { data: rol } = await supabaseAdmin.from('roles').select('es_sistema').eq('id', req.params.id).maybeSingle();
  if (!rol) return res.status(404).json({ error: 'NOT_FOUND' });
  if (rol.es_sistema) return res.status(403).json({ error: 'CANNOT_DELETE_SYSTEM_ROLE' });

  // Invalidar cache de usuarios afectados
  const { data: users } = await usuariosDelRol(req.params.id);
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
  // Antes se pedían los roles con .in('auth_user_id', <todas las cuentas>).
  // Con ~206 UUID la URL pasa de 8,2 KB y Kong/Cloudflare responde 414; como
  // nadie miraba `error`, la pantalla mostraba a TODOS sin ningún rol (hoy hay
  // 141 cuentas: con la próxima cohorte se llegaba). usuario_roles es una tabla
  // pequeña (10 filas el 12/10/2026): se lee entera, paginada, y se cruza en
  // memoria. Profesores y participantes también van paginados: recorren todas
  // las cohortes y crecen con cada una.
  const [profs, parts, ur] = await Promise.all([
    traerTodasLasFilas((desde, hasta) => supabaseAdmin.from('profesores')
      .select('id, auth_user_id, nombre_completo, activo')
      .order('nombre_completo').order('id')
      .range(desde, hasta)),
    traerTodasLasFilas((desde, hasta) => supabaseAdmin.from('participantes_lista')
      .select('id, auth_user_id, nombre_completo, cohorte_id, estado')
      .order('nombre_completo').order('id')
      .range(desde, hasta)),
    traerTodasLasFilas((desde, hasta) => supabaseAdmin.from('usuario_roles')
      .select('auth_user_id, rol_id, roles(id, nombre)')
      .order('auth_user_id').order('rol_id')
      .range(desde, hasta),
    // usuario_roles no tiene `id`: su clave es (auth_user_id, rol_id).
    (f: any) => `${f.auth_user_id}|${f.rol_id}`),
  ]);
  // Mejor un error claro que una lista de usuarios «sin roles» que invite a
  // reasignarlos.
  const fallo = profs.error ?? parts.error ?? ur.error;
  if (fallo) return res.status(500).json({ error: 'USUARIOS_ROLES_FAILED', detail: fallo.message });

  const rolesByUser = new Map<string, Array<{ id: string; nombre: string }>>();
  for (const row of (ur.data ?? []) as any[]) {
    if (!row.roles) continue;
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

  // Borrar-y-reinsertar sobre los ROLES de un usuario. Si el borrado pasa y el
  // insert falla en silencio, el usuario se queda SIN ningún rol (queda fuera).
  // Si el borrado falla y el insert pasa, sobreviven roles que el admin acaba
  // de quitar (p.ej. un super_admin revocado que sigue vivo). Verificar ambos.
  const { error: errDel } = await supabaseAdmin.from('usuario_roles').delete().eq('auth_user_id', parsed.data.auth_user_id);
  if (errDel) return res.status(500).json({ error: 'ROLES_ASIGNAR_FAILED', paso: 'borrar', detail: errDel.message });
  if (parsed.data.roles.length) {
    const { error: errIns } = await supabaseAdmin.from('usuario_roles').insert(
      parsed.data.roles.map((rol_id) => ({
        auth_user_id: parsed.data.auth_user_id,
        rol_id,
        asignado_por: req.user?.sub ?? null,
      })),
    );
    if (errIns) return res.status(500).json({ error: 'ROLES_ASIGNAR_FAILED', paso: 'insertar', detail: errIns.message });
  }
  invalidateUserPermisos(parsed.data.auth_user_id);
  res.json({ ok: true });
});

const bulkAssignSchema = z.object({
  auth_user_ids: z.array(z.string().uuid()).min(1).max(500),
  rol_id: z.string().uuid(),
});

router.post('/usuarios/asignar-bulk', async (req: any, res) => {
  const parsed = bulkAssignSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'INVALID', details: parsed.error.issues });

  const rows = parsed.data.auth_user_ids.map((auth_user_id) => ({
    auth_user_id,
    rol_id: parsed.data.rol_id,
    asignado_por: req.user?.sub ?? null,
  }));
  const { error } = await supabaseAdmin
    .from('usuario_roles')
    .upsert(rows, { onConflict: 'auth_user_id,rol_id', ignoreDuplicates: true });
  if (error) return res.status(500).json({ error: error.message });

  for (const id of parsed.data.auth_user_ids) invalidateUserPermisos(id);
  res.json({ ok: true, asignados: parsed.data.auth_user_ids.length });
});

const grantPermisoSchema = z.object({
  auth_user_id: z.string().uuid(),
  permiso_code: z.string(),
});

router.post('/usuarios/permiso-extra', async (req: any, res) => {
  const parsed = grantPermisoSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'INVALID' });
  // Si falla en silencio, el admin cree que otorgó el permiso y el usuario
  // sigue recibiendo 403 sin que nadie entienda por qué.
  const { error } = await supabaseAdmin.from('usuario_permisos').upsert({
    auth_user_id: parsed.data.auth_user_id,
    permiso_code: parsed.data.permiso_code,
    asignado_por: req.user?.sub ?? null,
  });
  if (error) return res.status(500).json({ error: 'PERMISO_GRANT_FAILED', detail: error.message });
  invalidateUserPermisos(parsed.data.auth_user_id);
  res.json({ ok: true });
});

router.delete('/usuarios/:auth_user_id/permisos/:code', async (req, res) => {
  // SEGURIDAD: si este borrado falla en silencio, el sistema "falla abierto":
  // el admin ve que revocó el permiso y el usuario lo conserva indefinidamente.
  const { error } = await supabaseAdmin.from('usuario_permisos').delete()
    .eq('auth_user_id', req.params.auth_user_id)
    .eq('permiso_code', req.params.code);
  if (error) return res.status(500).json({ error: 'PERMISO_REVOKE_FAILED', detail: error.message });
  invalidateUserPermisos(req.params.auth_user_id);
  res.json({ ok: true });
});

export default router;
