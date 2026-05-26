import { Router } from 'express';
import multer from 'multer';
import ExcelJS from 'exceljs';
import { z } from 'zod';
import { supabaseAdmin } from '../db/supabase.js';
import { encryptPII, decryptPII, sha256Hex, syntheticEmailFromCedula } from '../auth/crypto.js';
import { requireAuth, requireRole, type AuthenticatedRequest } from '../auth/middleware.js';
import { buildAnteproyectoPDF } from '../services/pdf.js';
import { sendEmail } from '../services/email.js';
import { AREAS_AFINIDAD } from '../lib/areas.js';

const areaEnum = z.enum(AREAS_AFINIDAD);

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

router.use(requireAuth(), requireRole('super_admin'));

// =====================================================================
// PARTICIPANTES — cargar Excel + crear usuarios Auth
// =====================================================================
/**
 * POST /api/admin/participantes/cargar-excel
 * Multipart: cohorte_id (form), file (xlsx).
 * Columnas aceptadas (flexible, sin importar mayúsculas/acentos):
 *   - Nombre completo: "nombre_completo", "nombre completo", "full name"
 *     O bien la combinación "nombre" + "apellido" (se concatenan)
 *   - Cédula: "cedula", "cédula", "cc", "documento", "identificacion", "dni"
 *   - Email: "email", "correo", "correo electronico", "mail"
 */
function normalizeHeaderKey(s: unknown): string {
  return String(s ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // sin acentos
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}
const FULL_NAME_KEYS = new Set([
  'nombre_completo', 'nombres_completos', 'nombre_y_apellido', 'nombre_y_apellidos',
  'nombres_y_apellidos', 'full_name', 'fullname',
]);
const FIRST_NAME_KEYS = new Set(['nombre', 'nombres', 'first_name', 'firstname', 'primer_nombre']);
const LAST_NAME_KEYS = new Set(['apellido', 'apellidos', 'last_name', 'lastname', 'surname']);
const CEDULA_KEYS = new Set([
  'cedula', 'cc', 'documento', 'numero_documento', 'no_documento',
  'numero_de_documento', 'identificacion', 'id', 'dni', 'nuip', 'cedula_ciudadania',
]);
const EMAIL_KEYS = new Set(['email', 'correo', 'correo_electronico', 'e_mail', 'mail']);
function findCol(header: string[], keys: Set<string>): number {
  for (let i = 0; i < header.length; i++) {
    if (keys.has(header[i])) return i + 1;
  }
  return -1;
}

router.post('/participantes/cargar-excel', upload.single('file'), async (req: AuthenticatedRequest, res) => {
  const cohorteId = String(req.body?.cohorte_id ?? '').trim();
  if (!cohorteId) return res.status(400).json({ error: 'MISSING_COHORTE' });
  if (!req.file) return res.status(400).json({ error: 'MISSING_FILE' });

  const { data: coh } = await supabaseAdmin.from('cohortes').select('id').eq('id', cohorteId).maybeSingle();
  if (!coh) return res.status(404).json({ error: 'COHORTE_NOT_FOUND' });

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(new Uint8Array(req.file.buffer).buffer as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) return res.status(400).json({ error: 'EMPTY_WORKBOOK' });

  const header: string[] = [];
  ws.getRow(1).eachCell((c) => header.push(normalizeHeaderKey(c.value)));

  const fullCol  = findCol(header, FULL_NAME_KEYS);
  const firstCol = findCol(header, FIRST_NAME_KEYS);
  const lastCol  = findCol(header, LAST_NAME_KEYS);
  const cedulaCol = findCol(header, CEDULA_KEYS);
  const emailCol  = findCol(header, EMAIL_KEYS);

  if (fullCol < 0 && firstCol < 0 && lastCol < 0) {
    return res.status(400).json({
      error: 'MISSING_COLUMN', column: 'nombre',
      detail: 'No encontré una columna de nombre. Acepto "Nombre completo" o las dos columnas "Nombre" y "Apellido".',
      header_recibido: header,
    });
  }
  if (cedulaCol < 0) {
    return res.status(400).json({
      error: 'MISSING_COLUMN', column: 'cedula',
      detail: 'No encontré una columna de cédula. Acepto "Cedula", "CC", "Documento", "DNI", "Identificación".',
      header_recibido: header,
    });
  }
  if (emailCol < 0) {
    return res.status(400).json({
      error: 'MISSING_COLUMN', column: 'email',
      detail: 'No encontré una columna de email. Acepto "Email", "Correo", "Correo electrónico".',
      header_recibido: header,
    });
  }

  const supabaseUrl = process.env.SUPABASE_URL!;
  const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  let inserted = 0;
  const errors: Array<{ row: number; error: string }> = [];

  function cellStr(row: ExcelJS.Row, col: number): string {
    if (col < 0) return '';
    const v: any = row.getCell(col).value;
    if (v == null) return '';
    if (typeof v === 'object' && 'text' in v) return String(v.text ?? '').trim();
    if (typeof v === 'object' && 'result' in v) return String(v.result ?? '').trim();
    return String(v).trim();
  }

  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    try {
      let nombre: string;
      if (fullCol > 0) {
        nombre = cellStr(row, fullCol);
      } else {
        const first = cellStr(row, firstCol);
        const last  = cellStr(row, lastCol);
        nombre = [first, last].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
      }
      const cedula = cellStr(row, cedulaCol).replace(/[\s.\-]/g, '');
      const email = cellStr(row, emailCol).toLowerCase();
      if (!nombre || !cedula || !email) continue;

      const synth = syntheticEmailFromCedula(cedula);

      // 1) crear auth user via REST admin API
      let userId: string | null = null;
      const createResp = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
        method: 'POST',
        headers: {
          apikey: svcKey, Authorization: `Bearer ${svcKey}`, 'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: synth, password: 'TempCambiar2026!', email_confirm: true,
          app_metadata: { app_role: 'participante', cohorte_id: cohorteId },
        }),
      });
      if (createResp.ok) {
        userId = ((await createResp.json()) as any).id;
      } else {
        // ya existe → fetch list & find
        const listResp = await fetch(`${supabaseUrl}/auth/v1/admin/users?per_page=200`, {
          headers: { apikey: svcKey, Authorization: `Bearer ${svcKey}` },
        });
        const users = (((await listResp.json()) as any).users ?? []) as Array<{ id: string; email: string }>;
        userId = users.find((u) => u.email === synth)?.id ?? null;
      }

      // 2) upsert participantes_lista
      const { data: pRow } = await supabaseAdmin
        .from('participantes_lista')
        .upsert({
          cohorte_id: cohorteId,
          auth_user_id: userId,
          nombre_completo: nombre,
          cedula_encriptada: encryptPII(cedula),
          cedula_hash: sha256Hex(cedula),
          email_encriptado: encryptPII(email),
          email_hash: sha256Hex(email),
          estado: 'pendiente_activacion',
        }, { onConflict: 'cohorte_id,cedula_hash' })
        .select('id').single();

      // 3) actualizar metadata del auth user con participante_id
      if (userId && pRow) {
        await fetch(`${supabaseUrl}/auth/v1/admin/users/${userId}`, {
          method: 'PUT',
          headers: { apikey: svcKey, Authorization: `Bearer ${svcKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ app_metadata: { app_role: 'participante', cohorte_id: cohorteId, participante_id: pRow.id } }),
        });
      }

      inserted++;
    } catch (e) {
      errors.push({ row: r, error: (e as Error).message });
    }
  }

  res.json({ inserted, errors: errors.slice(0, 50), nota: 'Clave temporal: TempCambiar2026! — los participantes deben usar "primer ingreso" para definir su clave real.' });
});

// =====================================================================
// COHORTES
// =====================================================================
router.get('/cohortes', async (_req, res) => {
  const { data, error } = await supabaseAdmin
    .from('cohortes')
    .select('*')
    .order('id');
  if (error) return res.status(500).json({ error: error.message });

  // Contar participantes por cohorte y traer hitos
  const enriched = await Promise.all((data ?? []).map(async (c) => {
    const [{ count: pc }, { count: ec }, { data: hitos }] = await Promise.all([
      supabaseAdmin.from('participantes_lista').select('*', { count: 'exact', head: true }).eq('cohorte_id', c.id),
      supabaseAdmin.from('equipos').select('*', { count: 'exact', head: true }).eq('cohorte_id', c.id),
      supabaseAdmin.from('cohorte_hitos').select('posicion, nombre, fecha').eq('cohorte_id', c.id).order('posicion'),
    ]);
    return {
      ...c,
      participantes_count: pc ?? 0,
      equipos_count: ec ?? 0,
      hitos: hitos ?? [],
    };
  }));
  res.json(enriched);
});

const hitoSchema = z.object({
  posicion: z.number().int().min(1).max(11),
  fecha: z.string().date().nullable(),
});

const fechasSchema = z.object({
  fecha_limite_formacion_equipos: z.string().datetime().optional().nullable(),
  fecha_limite_entrega_anteproyecto: z.string().datetime().optional().nullable(),
  fecha_reunion_1: z.string().datetime().optional().nullable(),
  fecha_limite_seleccion_definitivo: z.string().datetime().optional().nullable(),
  activa: z.boolean().optional(),
  hitos: z.array(hitoSchema).max(11).optional(),
});
router.put('/cohortes/:id', async (req, res) => {
  const parsed = fechasSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'INVALID', details: parsed.error.issues });

  const { hitos, ...cohorteFields } = parsed.data;

  if (Object.keys(cohorteFields).length > 0) {
    const { error } = await supabaseAdmin.from('cohortes').update(cohorteFields).eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
  }

  if (hitos && hitos.length) {
    for (const h of hitos) {
      const { error } = await supabaseAdmin
        .from('cohorte_hitos')
        .update({ fecha: h.fecha })
        .eq('cohorte_id', req.params.id)
        .eq('posicion', h.posicion);
      if (error) return res.status(500).json({ error: error.message, paso: 'update hito', posicion: h.posicion });
    }
  }

  res.json({ ok: true });
});

// GET /api/admin/participantes — TODOS los participantes con su cohorte
router.get('/participantes', async (_req, res) => {
  const { data, error } = await supabaseAdmin
    .from('participantes_lista')
    .select(`
      id, auth_user_id, cohorte_id, nombre_completo, cedula_encriptada, email_encriptado,
      estado, fecha_creacion, tipo_trabajo_grado,
      miembros_equipo ( equipo_id )
    `)
    .order('nombre_completo');
  if (error) return res.status(500).json({ error: error.message });
  const out = (data ?? []).map((p: any) => {
    let cedula = '', email = '';
    try { cedula = decryptPII(p.cedula_encriptada); } catch { /* ignore */ }
    try { email = decryptPII(p.email_encriptado); } catch { /* ignore */ }
    const en_equipo = Array.isArray(p.miembros_equipo) && p.miembros_equipo.length > 0;
    return {
      id: p.id,
      auth_user_id: p.auth_user_id,
      cohorte_id: p.cohorte_id,
      nombre_completo: p.nombre_completo,
      cedula,
      email,
      estado: p.estado,
      tipo_trabajo_grado: p.tipo_trabajo_grado,
      en_equipo,
    };
  });
  res.json(out);
});

// GET /api/admin/cohortes/:id/participantes — listar para gestión (legacy, usado en flujo de carga)
router.get('/cohortes/:id/participantes', async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('participantes_lista')
    .select(`
      id, auth_user_id, nombre_completo, cedula_encriptada, email_encriptado,
      estado, fecha_creacion, tipo_trabajo_grado,
      miembros_equipo ( equipo_id )
    `)
    .eq('cohorte_id', req.params.id)
    .order('nombre_completo');
  if (error) return res.status(500).json({ error: error.message });
  // Descifrar para mostrar al admin + flag "en_equipo"
  const out = (data ?? []).map((p: any) => {
    let cedula = '', email = '';
    try { cedula = decryptPII(p.cedula_encriptada); } catch { /* ignore */ }
    try { email = decryptPII(p.email_encriptado); } catch { /* ignore */ }
    const en_equipo = Array.isArray(p.miembros_equipo) && p.miembros_equipo.length > 0;
    return {
      id: p.id,
      auth_user_id: p.auth_user_id,
      nombre_completo: p.nombre_completo,
      cedula,
      email,
      estado: p.estado,
      tipo_trabajo_grado: p.tipo_trabajo_grado,
      fecha_creacion: p.fecha_creacion,
      en_equipo,
    };
  });
  res.json(out);
});

// DELETE /api/admin/participantes/:id — borra participante + auth user
// Solo si NO está en ningún equipo y no es creador de ningún equipo
const updateParticipanteSchema = z.object({
  nombre_completo: z.string().min(2).max(150).optional(),
  cedula: z.string().min(6).max(20).regex(/^\d+$/).optional(),
  email: z.string().email().optional(),
});

router.put('/participantes/:id', async (req, res) => {
  const parsed = updateParticipanteSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'INVALID', details: parsed.error.issues });

  const { data: cur } = await supabaseAdmin
    .from('participantes_lista')
    .select('id, cohorte_id, auth_user_id, cedula_hash')
    .eq('id', req.params.id)
    .maybeSingle();
  if (!cur) return res.status(404).json({ error: 'NOT_FOUND' });

  const patch: any = {};
  if (parsed.data.nombre_completo) patch.nombre_completo = parsed.data.nombre_completo;
  if (parsed.data.email) {
    patch.email_encriptado = encryptPII(parsed.data.email.toLowerCase());
    patch.email_hash = sha256Hex(parsed.data.email.toLowerCase());
  }
  let nuevoSyntheticEmail: string | null = null;
  if (parsed.data.cedula) {
    const cedulaLimpia = parsed.data.cedula.replace(/[\s.\-]/g, '');
    const nuevoHash = sha256Hex(cedulaLimpia);
    if (nuevoHash !== cur.cedula_hash) {
      // Verificar que no exista otro participante con esa cédula en la misma cohorte
      const { data: dup } = await supabaseAdmin
        .from('participantes_lista')
        .select('id')
        .eq('cohorte_id', cur.cohorte_id)
        .eq('cedula_hash', nuevoHash)
        .neq('id', cur.id)
        .maybeSingle();
      if (dup) return res.status(409).json({ error: 'CEDULA_DUPLICADA' });
      patch.cedula_encriptada = encryptPII(cedulaLimpia);
      patch.cedula_hash = nuevoHash;
      nuevoSyntheticEmail = await syntheticEmailFromCedula(cedulaLimpia);
    }
  }

  if (Object.keys(patch).length === 0) return res.json({ ok: true, sin_cambios: true });

  const { error } = await supabaseAdmin
    .from('participantes_lista').update(patch).eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });

  // Si cambió la cédula, actualizar el email sintético en auth.users (es por lo que el participante loguea)
  if (nuevoSyntheticEmail && cur.auth_user_id) {
    const supabaseUrl = process.env.SUPABASE_URL!;
    const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    try {
      await fetch(`${supabaseUrl}/auth/v1/admin/users/${cur.auth_user_id}`, {
        method: 'PUT',
        headers: { apikey: svcKey, Authorization: `Bearer ${svcKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: nuevoSyntheticEmail, email_confirm: true }),
      });
    } catch { /* best effort */ }
  }
  res.json({ ok: true });
});

router.delete('/participantes/:id', async (req, res) => {
  const id = req.params.id;
  const [{ count: enEquipo }, { count: esCreador }] = await Promise.all([
    supabaseAdmin.from('miembros_equipo').select('id', { count: 'exact', head: true }).eq('participante_id', id),
    supabaseAdmin.from('equipos').select('id', { count: 'exact', head: true }).eq('creador_id', id),
  ]);
  if ((enEquipo ?? 0) > 0 || (esCreador ?? 0) > 0) {
    return res.status(409).json({
      error: 'PARTICIPANTE_EN_EQUIPO',
      en_equipo: enEquipo ?? 0,
      es_creador: esCreador ?? 0,
    });
  }
  // Auth user id
  const { data: p } = await supabaseAdmin
    .from('participantes_lista').select('auth_user_id').eq('id', id).maybeSingle();
  // Borrar participante (recovery_tokens cascadea solo)
  const { error } = await supabaseAdmin.from('participantes_lista').delete().eq('id', id);
  if (error) return res.status(500).json({ error: error.message });
  // Borrar auth user (best effort)
  if (p?.auth_user_id) {
    const supabaseUrl = process.env.SUPABASE_URL!;
    const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    try {
      await fetch(`${supabaseUrl}/auth/v1/admin/users/${p.auth_user_id}`, {
        method: 'DELETE',
        headers: { apikey: svcKey, Authorization: `Bearer ${svcKey}` },
      });
    } catch { /* ignore */ }
  }
  res.json({ ok: true });
});

// DELETE /api/admin/cohortes/:id — solo si no tiene participantes ni equipos
router.delete('/cohortes/:id', async (req, res) => {
  const id = req.params.id;
  const [p, e] = await Promise.all([
    supabaseAdmin.from('participantes_lista').select('id', { count: 'exact', head: true }).eq('cohorte_id', id),
    supabaseAdmin.from('equipos').select('id', { count: 'exact', head: true }).eq('cohorte_id', id),
  ]);
  if ((p.count ?? 0) > 0 || (e.count ?? 0) > 0) {
    return res.status(409).json({
      error: 'COHORTE_TIENE_DATOS',
      participantes: p.count ?? 0,
      equipos: e.count ?? 0,
    });
  }
  // Limpiar dependencias sin CASCADE (sabanas, asignaciones)
  await supabaseAdmin.from('asignaciones_profesor').delete().eq('cohorte_id', id);
  await supabaseAdmin.from('sabanas').delete().eq('cohorte_id', id);
  // cohorte_hitos tiene ON DELETE CASCADE
  const { error } = await supabaseAdmin.from('cohortes').delete().eq('id', id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// =====================================================================
// PROFESORES — CRUD
// =====================================================================
router.get('/profesores', async (_req, res) => {
  const { data, error } = await supabaseAdmin
    .from('profesores')
    .select('id, auth_user_id, nombre_completo, es_super_admin, activo, booking_url, areas_afinidad, ultimo_login, fecha_creacion')
    .order('nombre_completo');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data ?? []);
});

const createProfSchema = z.object({
  nombre_completo: z.string().min(2).max(150),
  email: z.string().email(),
  password: z.string().min(8).regex(/[A-Z]/).regex(/[a-z]/).regex(/\d/),
  es_super_admin: z.boolean().default(false),
  booking_url: z.string().url().optional().nullable(),
  areas_afinidad: z.array(areaEnum).default([]),
});
router.post('/profesores', async (req, res) => {
  const parsed = createProfSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'INVALID', details: parsed.error.issues });
  const { nombre_completo, email, password, es_super_admin, booking_url, areas_afinidad } = parsed.data;
  const supabaseUrl = process.env.SUPABASE_URL!;
  const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  // crear auth user
  const createResp = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: svcKey, Authorization: `Bearer ${svcKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, email_confirm: true, app_metadata: { app_role: 'profesor', es_super_admin } }),
  });
  if (!createResp.ok) {
    return res.status(400).json({ error: 'AUTH_USER_CREATE_FAILED', detail: await createResp.text() });
  }
  const authUser = (await createResp.json()) as { id: string };

  // insertar profesor
  const { data: prof, error } = await supabaseAdmin.from('profesores').insert({
    auth_user_id: authUser.id,
    nombre_completo,
    email_encriptado: encryptPII(email),
    email_hash: sha256Hex(email),
    es_super_admin,
    activo: true,
    booking_url: booking_url ?? null,
    areas_afinidad,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });

  // actualizar app_metadata con profesor_id
  await fetch(`${supabaseUrl}/auth/v1/admin/users/${authUser.id}`, {
    method: 'PUT',
    headers: { apikey: svcKey, Authorization: `Bearer ${svcKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_metadata: { app_role: 'profesor', es_super_admin, profesor_id: prof.id } }),
  });

  res.status(201).json({ profesor: prof });
});

const updateProfSchema = z.object({
  nombre_completo: z.string().min(2).max(150).optional(),
  es_super_admin: z.boolean().optional(),
  activo: z.boolean().optional(),
  booking_url: z.string().url().nullable().optional(),
  areas_afinidad: z.array(areaEnum).optional(),
});
router.put('/profesores/:id', async (req, res) => {
  const parsed = updateProfSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'INVALID', details: parsed.error.issues });
  const { data, error } = await supabaseAdmin.from('profesores').update(parsed.data).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ profesor: data });
});

// =====================================================================
// ANTEPROYECTOS — listar/detalle (todos)
// =====================================================================
router.get('/anteproyectos', async (req, res) => {
  const cohorte = String(req.query.cohorte ?? '').trim();
  const estado = String(req.query.estado ?? '').trim();

  let q = supabaseAdmin
    .from('anteproyectos')
    .select(`
      id, estado, fecha_envio, fecha_actualizacion,
      equipos!inner ( id, nombre_equipo, cohorte_id ),
      proyectos ( id, nombre, sector, estado_seleccion )
    `)
    .order('fecha_actualizacion', { ascending: false });

  if (cohorte) q = q.eq('equipos.cohorte_id', cohorte);
  if (estado) q = q.eq('estado', estado);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data ?? []);
});

router.get('/anteproyectos/:id', async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('anteproyectos')
    .select(`
      *,
      equipos (
        id, nombre_equipo, cohorte_id,
        miembros_equipo (
          posicion, fue_emprendedor, perfil,
          participantes_lista ( id, nombre_completo )
        )
      ),
      proyectos (
        *,
        hitos ( posicion, descripcion, fecha_inicio, fecha_fin )
      )
    `)
    .eq('id', req.params.id)
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'NOT_FOUND' });
  res.json(data);
});

// PDF del anteproyecto
router.get('/anteproyectos/:id/pdf', async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('anteproyectos')
    .select(`
      estado, fecha_envio,
      equipos ( nombre_equipo, cohorte_id,
        miembros_equipo ( posicion, fue_emprendedor, perfil,
          participantes_lista ( nombre_completo ) ) ),
      proyectos ( *, hitos ( posicion, descripcion, fecha_inicio, fecha_fin ) )
    `)
    .eq('id', req.params.id)
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'NOT_FOUND' });

  const pdf = await buildAnteproyectoPDF(data as any);
  const filename = `anteproyecto-${(data.equipos as any)?.nombre_equipo?.replace(/[^a-zA-Z0-9]/g, '_') ?? req.params.id.slice(0, 8)}.pdf`;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(pdf);
});

// =====================================================================
// SOLICITUDES DESARCHIVADO (listar pendientes)
// =====================================================================
router.get('/solicitudes-desarchivado', async (_req, res) => {
  const { data, error } = await supabaseAdmin
    .from('solicitudes_desarchivado')
    .select(`
      *,
      proyectos ( id, nombre, anteproyecto_id ),
      participantes_lista!solicitudes_desarchivado_solicitante_id_fkey ( nombre_completo )
    `)
    .order('fecha_solicitud', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data ?? []);
});

// =====================================================================
// AUDITORÍA (lectura)
// =====================================================================
router.get('/auditoria', async (req, res) => {
  const limit = Math.min(Number(req.query.limit ?? 100), 500);
  const accion = String(req.query.accion ?? '').trim();

  let q = supabaseAdmin
    .from('auditoria')
    .select('id, actor_tipo, actor_id, accion, entidad_tipo, entidad_id, ip, timestamp')
    .order('timestamp', { ascending: false })
    .limit(limit);
  if (accion) q = q.ilike('accion', `%${accion}%`);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data ?? []);
});

// =====================================================================
// SÁBANA — asignaciones profesor↔equipo + comunicar
// =====================================================================
const asignarSchema = z.object({
  asignaciones: z.array(z.object({
    equipo_id: z.string().uuid(),
    profesor_id: z.string().uuid(),
  })).min(1),
});

router.post('/sabanas/:cohorteId/asignar', async (req: AuthenticatedRequest, res) => {
  const parsed = asignarSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'INVALID', details: parsed.error.issues });

  const adminId = req.user!.profesorId;
  if (!adminId) return res.status(403).json({ error: 'NO_PROFESOR_ID' });

  const { cohorteId } = req.params;
  // upsert por equipo (un equipo solo puede tener un profesor)
  const rows = parsed.data.asignaciones.map((a) => ({
    equipo_id: a.equipo_id,
    profesor_id: a.profesor_id,
    cohorte_id: cohorteId,
    asignado_por: adminId,
  }));

  const { error } = await supabaseAdmin
    .from('asignaciones_profesor')
    .upsert(rows, { onConflict: 'equipo_id' });
  if (error) return res.status(500).json({ error: error.message });

  await supabaseAdmin
    .from('sabanas_proyectos')
    .upsert({ cohorte_id: cohorteId, estado: 'asignada', fecha_asignacion_completa: new Date().toISOString() },
      { onConflict: 'cohorte_id' });

  res.json({ ok: true, asignadas: rows.length });
});

router.post('/sabanas/:cohorteId/comunicar', async (req, res) => {
  const { cohorteId } = req.params;
  const ahora = new Date().toISOString();

  // 1. Traer todas las asignaciones de la cohorte con datos del profesor y los miembros del equipo
  const { data: asignaciones, error: errAsign } = await supabaseAdmin
    .from('asignaciones_profesor')
    .select(`
      id, equipo_id, profesor_id,
      profesores:profesores!inner ( nombre_completo, email_encriptado, booking_url, areas_afinidad ),
      equipos:equipos!inner (
        id, nombre_equipo, cohorte_id,
        miembros_equipo (
          participantes_lista ( id, nombre_completo, email_encriptado )
        )
      )
    `)
    .eq('cohorte_id', cohorteId);
  if (errAsign) return res.status(500).json({ error: errAsign.message });

  // 2. Por cada asignación, enviar correo a cada participante del equipo
  let emailsEnviados = 0;
  let emailsFallados = 0;
  const fallos: Array<{ destinatario: string; razon: string }> = [];

  for (const a of asignaciones ?? []) {
    const prof: any = a.profesores;
    const equipo: any = a.equipos;
    const profesorNombre = prof?.nombre_completo ?? 'tu profesor';
    const bookingLine = prof?.booking_url
      ? `<p style="margin:12pt 0">Agenda de tutoría del profesor: <a href="${prof.booking_url}">${prof.booking_url}</a></p>`
      : '';
    const areasLine = (prof?.areas_afinidad?.length ?? 0) > 0
      ? `<p style="margin:6pt 0;color:#6b6b6b;font-size:11pt"><strong>Áreas de afinidad:</strong> ${(prof.areas_afinidad as string[]).join(', ')}</p>`
      : '';

    const miembros = (equipo?.miembros_equipo ?? []) as Array<{ participantes_lista: any }>;
    for (const m of miembros) {
      const p = m.participantes_lista;
      if (!p?.email_encriptado) continue;
      let realEmail: string;
      try { realEmail = decryptPII(p.email_encriptado); }
      catch { emailsFallados++; fallos.push({ destinatario: p.nombre_completo ?? '?', razon: 'PII_DECRYPT_FAILED' }); continue; }

      const html = `
        <div style="font-family:Roboto,Arial,sans-serif;color:#1a1a1a;max-width:540px;margin:0 auto">
          <h2 style="color:#e30613;border-bottom:3px solid #e30613;padding-bottom:8pt;margin-bottom:14pt">
            Te asignaron profesor de trabajo de grado
          </h2>
          <p>Hola <strong>${p.nombre_completo}</strong>,</p>
          <p>El equipo <strong>${equipo?.nombre_equipo ?? '(sin nombre)'}</strong>
             tiene asignado el profesor <strong>${profesorNombre}</strong> para acompañar el trabajo de grado.</p>
          ${areasLine}
          ${bookingLine}
          <p style="margin-top:18pt">Próximos pasos:</p>
          <ul>
            <li>Coordinar la <strong>Reunión 1</strong> con tu profesor según el cronograma de la cohorte.</li>
            <li>Entrar a la plataforma para revisar el detalle: <a href="${process.env.FRONTEND_URL ?? 'https://naves-frontend.huem98.easypanel.host'}">NAVES</a></li>
          </ul>
          <p style="font-size:9pt;color:#6b6b6b;margin-top:24pt">
            NAVES — INALDE Business School · MBA<br>
            Este es un mensaje automático del sistema; por favor no respondas a este correo.
          </p>
        </div>`;

      const r = await sendEmail(realEmail, `Tu profesor de trabajo de grado: ${profesorNombre}`, html);
      if (r.ok) emailsEnviados++;
      else { emailsFallados++; fallos.push({ destinatario: p.nombre_completo, razon: r.reason ?? 'UNKNOWN' }); }
    }
  }

  // 3. Marcar como comunicada en BD (independiente del resultado de emails)
  await supabaseAdmin
    .from('sabanas_proyectos')
    .update({ estado: 'comunicada', fecha_comunicacion: ahora })
    .eq('cohorte_id', cohorteId);
  await supabaseAdmin
    .from('asignaciones_profesor')
    .update({ notificacion_enviada: true, fecha_notificacion: ahora })
    .eq('cohorte_id', cohorteId);

  res.json({
    ok: true,
    emails_enviados: emailsEnviados,
    emails_fallados: emailsFallados,
    fallos: fallos.slice(0, 20),
  });
});

export default router;
