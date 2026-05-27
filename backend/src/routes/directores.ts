import { Router } from 'express';
import { z } from 'zod';
import multer from 'multer';
import { supabaseAdmin } from '../db/supabase.js';
import { requireAuth, requireRole, type AuthenticatedRequest } from '../auth/middleware.js';
import { encryptPII, decryptPII } from '../auth/crypto.js';
import { AREAS_AFINIDAD } from '../lib/areas.js';
import { normalizeHeaderKey, findCol, cellStr, buildTemplateXlsx, ExcelJS } from '../lib/excel.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
router.use(requireAuth());

const FULL_NAME_KEYS = new Set(['nombre_completo', 'nombres_completos', 'nombre_y_apellidos', 'nombres_y_apellidos', 'full_name', 'fullname']);
const FIRST_NAME_KEYS = new Set(['nombre', 'nombres', 'first_name', 'firstname', 'primer_nombre']);
const LAST_NAME_KEYS = new Set(['apellido', 'apellidos', 'last_name', 'lastname', 'surname']);
const EMAIL_KEYS = new Set(['email', 'correo', 'correo_electronico', 'e_mail', 'mail']);
const AREAS_KEYS = new Set(['areas', 'areas_afinidad', 'afinidad', 'sectores', 'especialidad']);
const AREA_1_KEYS = new Set(['area_de_afinidad_1', 'area_afinidad_1', 'area_1', 'area_principal']);
const AREA_2_KEYS = new Set(['area_de_afinidad_2', 'area_afinidad_2', 'area_2', 'area_secundaria_1', 'area_secundaria']);
const AREA_3_KEYS = new Set(['area_de_afinidad_3', 'area_afinidad_3', 'area_3', 'area_secundaria_2']);

function leerAreas(
  row: ExcelJS.Row,
  cols: { uno: number; dos: number; tres: number; legacy: number },
): string[] {
  const vals: string[] = [];
  for (const c of [cols.uno, cols.dos, cols.tres]) {
    if (c > 0) {
      const v = cellStr(row, c);
      if (v) vals.push(v);
    }
  }
  if (vals.length === 0 && cols.legacy > 0) {
    return cellStr(row, cols.legacy).split(/[,;]/).map((s) => s.trim()).filter(Boolean);
  }
  return vals;
}

const AREAS_LOWER = new Map<string, string>(AREAS_AFINIDAD.map((a) => [a.toLowerCase(), a]));
function matchAreas(raw: string[]): string[] {
  const out = new Set<string>();
  for (const r of raw) {
    const a = AREAS_LOWER.get(r.toLowerCase());
    if (a) out.add(a);
  }
  return Array.from(out);
}

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

// === POST /api/directores/bulk-delete (admin) ===============================
router.post('/bulk-delete', requireRole('super_admin'), async (req: AuthenticatedRequest, res) => {
  const parsed = z.object({ ids: z.array(z.string().uuid()).min(1).max(500) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'INVALID', details: parsed.error.issues });
  let borrados = 0; const fallos: any[] = [];
  for (const id of parsed.data.ids) {
    const { count } = await supabaseAdmin
      .from('equipos').select('id', { count: 'exact', head: true }).eq('director_id', id);
    if ((count ?? 0) > 0) { fallos.push({ id, error: 'DIRECTOR_EN_USO' }); continue; }
    const { error } = await supabaseAdmin.from('directores').delete().eq('id', id);
    if (error) { fallos.push({ id, error: error.message }); continue; }
    borrados++;
  }
  res.json({ borrados, fallos });
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

// === GET /api/directores/plantilla (admin) ==================================
router.get('/plantilla', requireRole('super_admin'), async (_req: AuthenticatedRequest, res) => {
  const totalCatalogo = AREAS_AFINIDAD.length;
  const rangoCatalogo = `$A$2:$A$${totalCatalogo + 1}`;

  const buf = await buildTemplateXlsx({
    sheetName: 'Directores',
    titulo: 'Plantilla — Directores',
    subtitulo: 'Programa MBA · INALDE Business School',
    instrucciones: [
      'Esta plantilla sirve para cargar directores en lote al sistema de trabajos de grado.',
      '',
      'Los directores acompañan los trabajos de grado en modalidad Caso y Proyecto de Investigación.',
      'NO ingresan a la plataforma; reciben notificaciones por correo cuando un equipo los selecciona',
      'y carga su anteproyecto.',
      '',
      'Cómo usarla:',
      '1. En la hoja "Directores", llena una fila por cada director que vayas a cargar.',
      '2. Las columnas marcadas con * son obligatorias (Nombre completo y Email).',
      '3. Para las áreas de afinidad usa los menús desplegables (hasta 3 áreas por director).',
      '4. Si un nombre ya existe en el sistema, esa fila se omite (no se duplica).',
      '',
      'Notas:',
      '· Los emails deben ser válidos. Se cifran al guardar (no quedan visibles en texto plano en la BD).',
      '· Las áreas disponibles están en la hoja "Catálogo - Áreas".',
    ],
    catalogos: [{
      sheet: 'Catálogo - Áreas',
      titulo: 'Áreas de afinidad disponibles',
      valores: [...AREAS_AFINIDAD],
    }],
    columns: [
      { header: 'Nombre completo', width: 32, required: true, comment: 'Nombre y apellidos completos del director.' },
      { header: 'Email institucional', width: 34, required: true, comment: 'Correo al que se enviarán las notificaciones (con el anteproyecto adjunto).' },
      { header: 'Área de afinidad 1', width: 22, comment: 'Principal. Selecciona del menú desplegable.',
        dropdownRange: { sheet: 'Catálogo - Áreas', range: rangoCatalogo } },
      { header: 'Área de afinidad 2', width: 22, comment: 'Opcional. Selecciona del menú desplegable.',
        dropdownRange: { sheet: 'Catálogo - Áreas', range: rangoCatalogo } },
      { header: 'Área de afinidad 3', width: 22, comment: 'Opcional. Selecciona del menú desplegable.',
        dropdownRange: { sheet: 'Catálogo - Áreas', range: rangoCatalogo } },
    ],
    exampleRows: [
      ['Carlos González Ramírez', 'carlos.gonzalez@inalde.edu.co', AREAS_AFINIDAD[0], AREAS_AFINIDAD[1], ''],
      ['Ana Martínez Quintero', 'ana.martinez@inalde.edu.co', AREAS_AFINIDAD[3], '', ''],
    ],
    filasReservadas: 50,
  });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="plantilla-directores.xlsx"');
  res.send(buf);
});

// === POST /api/directores/cargar-excel (admin) ==============================
router.post('/cargar-excel', requireRole('super_admin'), upload.single('file'), async (req: AuthenticatedRequest, res) => {
  if (!req.file) return res.status(400).json({ error: 'MISSING_FILE' });

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(new Uint8Array(req.file.buffer).buffer as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) return res.status(400).json({ error: 'EMPTY_WORKBOOK' });

  const header: string[] = [];
  ws.getRow(1).eachCell((c) => header.push(normalizeHeaderKey(c.value)));

  const fullCol = findCol(header, FULL_NAME_KEYS);
  const firstCol = findCol(header, FIRST_NAME_KEYS);
  const lastCol = findCol(header, LAST_NAME_KEYS);
  const emailCol = findCol(header, EMAIL_KEYS);
  const area1Col = findCol(header, AREA_1_KEYS);
  const area2Col = findCol(header, AREA_2_KEYS);
  const area3Col = findCol(header, AREA_3_KEYS);
  const areasLegacyCol = findCol(header, AREAS_KEYS);

  if (fullCol < 0 && firstCol < 0 && lastCol < 0) {
    return res.status(400).json({
      error: 'MISSING_COLUMN', column: 'nombre',
      detail: 'No encontré una columna de nombre. Acepto "Nombre completo" o "Nombre" + "Apellido".',
      header_recibido: header,
    });
  }
  if (emailCol < 0) {
    return res.status(400).json({
      error: 'MISSING_COLUMN', column: 'email',
      detail: 'No encontré una columna de email. Acepto "Email", "Correo".',
      header_recibido: header,
    });
  }

  let inserted = 0;
  let duplicados = 0;
  const errors: Array<{ row: number; error: string }> = [];

  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    try {
      let nombre: string;
      if (fullCol > 0) {
        nombre = cellStr(row, fullCol);
      } else {
        const first = cellStr(row, firstCol);
        const last = cellStr(row, lastCol);
        nombre = [first, last].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
      }
      const email = cellStr(row, emailCol).toLowerCase();
      if (!nombre || !email) continue;

      const areas = matchAreas(
        leerAreas(row, { uno: area1Col, dos: area2Col, tres: area3Col, legacy: areasLegacyCol })
      );

      // Comprobar duplicado por nombre (no hay email_hash en directores)
      const { data: dup } = await supabaseAdmin
        .from('directores').select('id').eq('nombre_completo', nombre).maybeSingle();
      if (dup) { duplicados++; continue; }

      const { error } = await supabaseAdmin.from('directores').insert({
        nombre_completo: nombre,
        email_encriptado: encryptPII(email),
        areas_afinidad: areas,
        estado: 'activo',
      });
      if (error) { errors.push({ row: r, error: error.message }); continue; }

      inserted++;
    } catch (e) {
      errors.push({ row: r, error: (e as Error).message });
    }
  }

  res.json({ inserted, duplicados, errors: errors.slice(0, 50) });
});

export default router;
