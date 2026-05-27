import { Router } from 'express';
import multer from 'multer';
import ExcelJS from 'exceljs';
import { z } from 'zod';
import crypto from 'node:crypto';
import { supabaseAdmin } from '../db/supabase.js';
import { encryptPII, decryptPII, sha256Hex, syntheticEmailFromCedula } from '../auth/crypto.js';
import { requireAuth, requireRole, type AuthenticatedRequest } from '../auth/middleware.js';
import { buildAnteproyectoPDF } from '../services/pdf.js';
import { sendEmail } from '../services/email.js';
import { AREAS_AFINIDAD } from '../lib/areas.js';
import { normalizeHeaderKey, findCol, cellStr, cellBool, buildTemplateXlsx } from '../lib/excel.js';

const AREAS_LOWER = new Map<string, string>(AREAS_AFINIDAD.map((a) => [a.toLowerCase(), a]));
function matchAreas(raw: string[]): string[] {
  const out = new Set<string>();
  for (const r of raw) {
    const a = AREAS_LOWER.get(r.toLowerCase());
    if (a) out.add(a);
  }
  return Array.from(out);
}

function passwordAleatoria(len = 12): string {
  // Garantiza al menos una mayúscula, minúscula y número
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const digits = '23456789';
  const all = upper + lower + digits;
  const buf = crypto.randomBytes(len);
  const chars: string[] = [
    upper[buf[0] % upper.length],
    lower[buf[1] % lower.length],
    digits[buf[2] % digits.length],
  ];
  for (let i = 3; i < len; i++) chars.push(all[buf[i] % all.length]);
  // Mezclar
  for (let i = chars.length - 1; i > 0; i--) {
    const j = buf[i] % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

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
const PASSWORD_KEYS = new Set(['clave', 'contrasena', 'contrasenia', 'password', 'clave_inicial', 'clave_temporal']);
const BOOKING_KEYS = new Set(['booking_url', 'booking', 'agenda', 'calendly', 'url_agenda']);
const SUPERADMIN_KEYS = new Set(['admin', 'es_admin', 'administrador', 'es_administrador', 'super_admin']);
const AREAS_KEYS = new Set(['areas', 'areas_afinidad', 'afinidad', 'sectores', 'especialidad']);
const AREA_1_KEYS = new Set(['area_de_afinidad_1', 'area_afinidad_1', 'area_1', 'area_principal']);
const AREA_2_KEYS = new Set(['area_de_afinidad_2', 'area_afinidad_2', 'area_2', 'area_secundaria_1', 'area_secundaria']);
const AREA_3_KEYS = new Set(['area_de_afinidad_3', 'area_afinidad_3', 'area_3', 'area_secundaria_2']);

/** Lee áreas: primero busca 3 columnas separadas; si no existen, intenta una columna comma-separated (legacy). */
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
      //    Clave inicial = la cédula (el participante sera forzado a cambiarla al primer login)
      let userId: string | null = null;
      const createResp = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
        method: 'POST',
        headers: {
          apikey: svcKey, Authorization: `Bearer ${svcKey}`, 'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: synth, password: cedula, email_confirm: true,
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

  res.json({ inserted, errors: errors.slice(0, 50), nota: 'Clave inicial = número de cédula. El participante deberá crear su clave personal en el primer ingreso.' });
});

/**
 * POST /api/admin/participantes/reset-pendientes-a-cedula
 * Para todas las cuentas con estado='pendiente_activacion', resetea la clave a la cédula
 * y se asegura del estado pendiente. Útil para corregir cuentas legacy con clave distinta.
 */
router.post('/participantes/reset-pendientes-a-cedula', async (_req, res) => {
  const supabaseUrl = process.env.SUPABASE_URL!;
  const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const { data } = await supabaseAdmin
    .from('participantes_lista')
    .select('id, auth_user_id, cedula_encriptada')
    .eq('estado', 'pendiente_activacion');
  let actualizados = 0; const fallos: any[] = [];
  for (const p of data ?? []) {
    if (!p.auth_user_id) continue;
    let cedula = '';
    try { cedula = decryptPII(p.cedula_encriptada); } catch { fallos.push({ id: p.id, error: 'DECRYPT_FAILED' }); continue; }
    try {
      const r = await fetch(`${supabaseUrl}/auth/v1/admin/users/${p.auth_user_id}`, {
        method: 'PUT',
        headers: { apikey: svcKey, Authorization: `Bearer ${svcKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: cedula, email_confirm: true }),
      });
      if (r.ok) actualizados++;
      else fallos.push({ id: p.id, error: `AUTH_API_${r.status}`, detail: (await r.text()).slice(0, 100) });
    } catch (e: any) {
      fallos.push({ id: p.id, error: 'NETWORK', detail: e.message });
    }
  }
  res.json({ actualizados, total: data?.length ?? 0, fallos });
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
  posicion: z.number().int().min(1).max(13),
  fecha: z.string().date().nullable(),
});

const fechasSchema = z.object({
  fecha_limite_formacion_equipos: z.string().datetime().optional().nullable(),
  fecha_limite_entrega_anteproyecto: z.string().datetime().optional().nullable(),
  fecha_reunion_1: z.string().datetime().optional().nullable(),
  fecha_limite_seleccion_definitivo: z.string().datetime().optional().nullable(),
  activa: z.boolean().optional(),
  hitos: z.array(hitoSchema).max(13).optional(),
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

// =====================================================================
// COHORTES — plantilla Excel para cargar fechas masivamente
// =====================================================================

const FECHAS_OPERATIVAS: Array<{ key: string; label: string }> = [
  { key: 'fecha_limite_formacion_equipos',    label: 'Cierre formación de equipos' },
  { key: 'fecha_limite_entrega_anteproyecto', label: 'Cierre entrega anteproyecto' },
  { key: 'fecha_reunion_1',                   label: 'Reunión 1' },
  { key: 'fecha_limite_seleccion_definitivo', label: 'Cierre selección definitivo' },
];

const INALDE_RED_HEX = 'FFE30613';
const INALDE_GOLD_HEX = 'FFB89E5A';
const INALDE_GRAY_HEX = 'FFF6F6F6';

function fmtFechaCO(iso: string | null | undefined, conHora: boolean): string {
  if (!iso) return '';
  try {
    const d = new Date(iso.length === 10 ? iso + 'T12:00:00' : iso);
    return d.toLocaleString('es-CO', {
      timeZone: 'America/Bogota',
      year: 'numeric', month: '2-digit', day: '2-digit',
      ...(conHora ? { hour: '2-digit', minute: '2-digit', hour12: false } : {}),
    });
  } catch { return ''; }
}

router.get('/cohortes/:id/plantilla', async (req, res) => {
  const cohorteId = req.params.id;
  const [{ data: coh }, { data: hitos }] = await Promise.all([
    supabaseAdmin.from('cohortes').select('*').eq('id', cohorteId).maybeSingle(),
    supabaseAdmin.from('cohorte_hitos').select('posicion, nombre, fecha').eq('cohorte_id', cohorteId).order('posicion'),
  ]);
  if (!coh) return res.status(404).json({ error: 'COHORTE_NOT_FOUND' });

  const wb = new ExcelJS.Workbook();
  wb.creator = 'INALDE Business School';
  wb.created = new Date();

  // === Hoja 1: Instrucciones ===========================================
  const iws = wb.addWorksheet('Instrucciones');
  iws.mergeCells('A1:C1');
  iws.getCell('A1').value = `Plantilla de fechas — Cohorte ${(coh as any).etiqueta} (${cohorteId})`;
  iws.getCell('A1').font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
  iws.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: INALDE_RED_HEX } };
  iws.getCell('A1').alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  iws.getRow(1).height = 28;

  const lineas = [
    '',
    'Cómo llenar esta plantilla:',
    '',
    '1. Ve a la hoja "Fechas".',
    '2. En la columna "Nueva fecha", escribe la fecha que quieres aplicar al concepto correspondiente.',
    '   • Para las 4 primeras filas (Fechas operativas), incluye fecha + hora (formato: dd/mm/aaaa hh:mm).',
    '   • Para las 11 filas del Cronograma, solo escribe la fecha (formato: dd/mm/aaaa).',
    '3. Si dejas una celda vacía, esa fecha NO se modificará al cargar el archivo (se conserva la actual).',
    '4. Guarda el archivo (.xlsx) y súbelo desde la pantalla de edición de la cohorte.',
    '',
    'Atajos útiles dentro de Excel:',
    '• Ctrl + ;  →  Inserta la fecha de hoy en la celda.',
    '• Ctrl + Shift + ;  →  Inserta la hora actual.',
    '• Excel para Web suele mostrar un mini-calendario al hacer clic en la celda.',
    '',
    'Notas:',
    '• Las celdas de "Nueva fecha" tienen validación: si escribes algo que no sea una fecha, Excel te avisa.',
    '• La columna "Fecha actual" es solo informativa (no se valida al cargar).',
    '• Las fechas se interpretan en zona horaria America/Bogota.',
    '• Si Excel marca la celda como número, aplícale formato Fecha desde Inicio → Número.',
  ];
  for (const t of lineas) {
    const row = iws.addRow([t]);
    row.font = { size: 11, color: { argb: 'FF1A1A1A' } };
    row.alignment = { vertical: 'top', wrapText: true };
  }
  iws.getColumn(1).width = 100;

  // === Hoja 2: Fechas ===================================================
  const ws = wb.addWorksheet('Fechas', { views: [{ state: 'frozen', ySplit: 2 }] });
  ws.columns = [
    { key: 'concepto',  width: 42 },
    { key: 'actual',    width: 26 },
    { key: 'nueva',     width: 26 },
  ];

  // Fila 1: título
  ws.mergeCells('A1:C1');
  ws.getCell('A1').value = `Fechas — ${(coh as any).etiqueta} (${cohorteId})`;
  ws.getCell('A1').font = { bold: true, size: 13, color: { argb: 'FFFFFFFF' } };
  ws.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: INALDE_RED_HEX } };
  ws.getCell('A1').alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  ws.getRow(1).height = 28;

  // Fila 2: encabezados
  ws.addRow(['Concepto', 'Fecha actual', 'Nueva fecha']);
  const head = ws.getRow(2);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
  head.height = 22;
  head.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  head.eachCell((c) => {
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: INALDE_RED_HEX } };
    c.border = { bottom: { style: 'medium', color: { argb: 'FF1A1A1A' } } };
  });

  function addSectionRow(label: string) {
    const row = ws.addRow([label, '', '']);
    ws.mergeCells(`A${row.number}:C${row.number}`);
    row.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    row.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: INALDE_GOLD_HEX } };
    row.height = 20;
  }

  function addDataRow(concepto: string, actualIso: string | null | undefined, conHora: boolean) {
    const row = ws.addRow([concepto, fmtFechaCO(actualIso, conHora), '']);
    row.height = 20;
    row.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    row.getCell(1).font = { size: 11, color: { argb: 'FF1A1A1A' } };
    row.getCell(2).font = { size: 11, color: { argb: 'FF6B6B6B' } };
    const nueva = row.getCell(3);
    nueva.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: INALDE_GRAY_HEX } };
    nueva.numFmt = conHora ? 'dd/mm/yyyy hh:mm' : 'dd/mm/yyyy';
    nueva.border = { top: { style: 'thin', color: { argb: 'FFCCCCCC' } }, bottom: { style: 'thin', color: { argb: 'FFCCCCCC' } } };
    // Data validation tipo fecha: rango amplio 2020-2035 + tooltip de ayuda.
    // No es un 'datepicker' real (Excel no tiene uno nativo cross-platform),
    // pero da prompt al seleccionar la celda y rechaza texto invalido.
    nueva.dataValidation = {
      type: 'date',
      operator: 'between',
      formulae: [new Date(Date.UTC(2020, 0, 1)), new Date(Date.UTC(2035, 11, 31))],
      showInputMessage: true,
      promptTitle: 'Nueva fecha',
      prompt: conHora
        ? 'Escribe la fecha y hora (dd/mm/aaaa hh:mm). Atajo: Ctrl+; para hoy.'
        : 'Escribe la fecha (dd/mm/aaaa). Atajo: Ctrl+; para hoy.',
      showErrorMessage: true,
      errorStyle: 'warning',
      errorTitle: 'Formato inválido',
      error: 'Ingresa una fecha válida en formato dd/mm/aaaa.',
    };
  }

  // Sección 1: Fechas operativas
  addSectionRow('Fechas operativas (Business Plan) — incluir fecha + hora');
  for (const f of FECHAS_OPERATIVAS) {
    addDataRow(f.label, (coh as any)[f.key], true);
  }
  ws.addRow([]);

  // Sección 2: Cronograma
  addSectionRow('Cronograma — 13 hitos (solo fecha)');
  const hitosMap = new Map<number, { nombre: string; fecha: string | null }>(
    ((hitos as any[]) ?? []).map((h) => [h.posicion, { nombre: h.nombre, fecha: h.fecha }]),
  );
  for (let pos = 1; pos <= 13; pos++) {
    const h = hitosMap.get(pos);
    addDataRow(`${pos}. ${h?.nombre ?? `Hito ${pos}`}`, h?.fecha ?? null, false);
  }

  const buf = await wb.xlsx.writeBuffer();
  const filename = `plantilla-cohorte-${cohorteId}.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(Buffer.from(buf));
});

// === POST /api/admin/cohortes/:id/cargar-excel ===========================
const cohorteExcelUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

router.post('/cohortes/:id/cargar-excel', cohorteExcelUpload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'MISSING_FILE' });
  const cohorteId = req.params.id;
  const { data: coh } = await supabaseAdmin.from('cohortes').select('id').eq('id', cohorteId).maybeSingle();
  if (!coh) return res.status(404).json({ error: 'COHORTE_NOT_FOUND' });

  let wb: ExcelJS.Workbook;
  try {
    wb = new ExcelJS.Workbook();
    await wb.xlsx.load(req.file.buffer as any);
  } catch {
    return res.status(400).json({ error: 'INVALID_XLSX' });
  }

  const ws = wb.getWorksheet('Fechas');
  if (!ws) return res.status(400).json({ error: 'SHEET_NOT_FOUND', mensaje: 'El archivo no tiene la hoja "Fechas".' });

  function parseCellDate(cell: ExcelJS.Cell): Date | null {
    const v = cell.value;
    if (v == null || v === '') return null;
    if (v instanceof Date) return v;
    if (typeof v === 'number') {
      // Excel serial date
      const ms = (v - 25569) * 86400 * 1000;
      const d = new Date(ms);
      return isNaN(d.getTime()) ? null : d;
    }
    if (typeof v === 'string') {
      const s = v.trim();
      if (!s) return null;
      // dd/mm/yyyy [hh:mm]
      const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})(?:\s+(\d{1,2}):(\d{2}))?$/);
      if (m) {
        const [, dd, mm, yyyyRaw, hh, mi] = m;
        const yyyy = yyyyRaw.length === 2 ? 2000 + parseInt(yyyyRaw, 10) : parseInt(yyyyRaw, 10);
        // Construir en hora local Bogota: usamos toISOString despues
        const d = new Date(yyyy, parseInt(mm, 10) - 1, parseInt(dd, 10), hh ? parseInt(hh, 10) : 0, mi ? parseInt(mi, 10) : 0);
        return isNaN(d.getTime()) ? null : d;
      }
      const d = new Date(s);
      return isNaN(d.getTime()) ? null : d;
    }
    if (typeof v === 'object' && (v as any).text) {
      // RichText
      return null;
    }
    return null;
  }

  // Mapeo concepto (texto en columna A) -> destino
  const operativasByLabel = new Map(FECHAS_OPERATIVAS.map((f) => [f.label.toLowerCase(), f.key]));

  const operativasUpdate: Record<string, string | null> = {};
  const hitosUpdate: Array<{ posicion: number; fecha: string | null }> = [];

  let lastError: string | null = null;
  ws.eachRow((row) => {
    if (row.number <= 2) return; // titulo + header
    const concepto = String(row.getCell(1).value ?? '').trim();
    if (!concepto) return;
    const nueva = parseCellDate(row.getCell(3));
    if (nueva === null) return; // celda vacia o invalida -> no se toca

    const conceptoLower = concepto.toLowerCase();
    const opKey = operativasByLabel.get(conceptoLower);
    if (opKey) {
      operativasUpdate[opKey] = nueva.toISOString();
      return;
    }
    // Cronograma: "N. Nombre del hito"
    const m = concepto.match(/^(\d{1,2})\.\s*/);
    if (m) {
      const pos = parseInt(m[1], 10);
      if (pos >= 1 && pos <= 13) {
        // YYYY-MM-DD (sin hora) para cohorte_hitos.fecha (tipo date)
        const yyyy = nueva.getFullYear();
        const mm = String(nueva.getMonth() + 1).padStart(2, '0');
        const dd = String(nueva.getDate()).padStart(2, '0');
        hitosUpdate.push({ posicion: pos, fecha: `${yyyy}-${mm}-${dd}` });
        return;
      }
    }
    lastError = `Concepto no reconocido en fila ${row.number}: "${concepto}"`;
  });

  if (Object.keys(operativasUpdate).length === 0 && hitosUpdate.length === 0) {
    return res.status(400).json({ error: 'SIN_CAMBIOS', mensaje: 'No se encontraron fechas para aplicar en la columna "Nueva fecha".', detail: lastError });
  }

  if (Object.keys(operativasUpdate).length > 0) {
    const { error } = await supabaseAdmin.from('cohortes').update(operativasUpdate).eq('id', cohorteId);
    if (error) return res.status(500).json({ error: error.message });
  }
  for (const h of hitosUpdate) {
    const { error } = await supabaseAdmin
      .from('cohorte_hitos').update({ fecha: h.fecha }).eq('cohorte_id', cohorteId).eq('posicion', h.posicion);
    if (error) return res.status(500).json({ error: error.message, paso: `hito ${h.posicion}` });
  }

  res.json({
    ok: true,
    operativas_actualizadas: Object.keys(operativasUpdate).length,
    hitos_actualizados: hitosUpdate.length,
    nota: lastError ?? undefined,
  });
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

// POST /api/admin/participantes/bulk-delete — borra varios en una sola operacion
router.post('/participantes/bulk-delete', async (req, res) => {
  const idsParsed = z.object({ ids: z.array(z.string().uuid()).min(1).max(500) }).safeParse(req.body);
  if (!idsParsed.success) return res.status(400).json({ error: 'INVALID', details: idsParsed.error.issues });
  const supabaseUrl = process.env.SUPABASE_URL!;
  const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  let borrados = 0; const fallos: any[] = [];
  for (const id of idsParsed.data.ids) {
    const [{ count: enEq }, { count: esCre }] = await Promise.all([
      supabaseAdmin.from('miembros_equipo').select('id', { count: 'exact', head: true }).eq('participante_id', id),
      supabaseAdmin.from('equipos').select('id', { count: 'exact', head: true }).eq('creador_id', id),
    ]);
    if ((enEq ?? 0) > 0 || (esCre ?? 0) > 0) {
      fallos.push({ id, error: 'EN_EQUIPO' });
      continue;
    }
    const { data: p } = await supabaseAdmin.from('participantes_lista').select('auth_user_id').eq('id', id).maybeSingle();
    const { error } = await supabaseAdmin.from('participantes_lista').delete().eq('id', id);
    if (error) { fallos.push({ id, error: error.message }); continue; }
    if (p?.auth_user_id) {
      try {
        await fetch(`${supabaseUrl}/auth/v1/admin/users/${p.auth_user_id}`, {
          method: 'DELETE',
          headers: { apikey: svcKey, Authorization: `Bearer ${svcKey}` },
        });
      } catch { /* best effort */ }
    }
    borrados++;
  }
  res.json({ borrados, fallos });
});

// PUT /api/admin/participantes/:id/modalidad
// Cambia la modalidad de trabajo de grado de un participante (bypassa el trigger de inmutabilidad)
const cambiarModalidadSchema = z.object({
  modalidad: z.enum(['business_plan', 'caso', 'proyecto_investigacion']),
});
router.put('/participantes/:id/modalidad', async (req, res) => {
  const parsed = cambiarModalidadSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'INVALID', details: parsed.error.issues });
  const { error } = await supabaseAdmin.rpc('admin_set_modalidad', {
    p_id: req.params.id, p_modalidad: parsed.data.modalidad,
  });
  if (error) return res.status(500).json({ error: error.message });
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
    .select('id, auth_user_id, nombre_completo, email_encriptado, es_super_admin, activo, booking_url, areas_afinidad, ultimo_login, fecha_creacion')
    .order('nombre_completo');
  if (error) return res.status(500).json({ error: error.message });
  const out = (data ?? []).map((p: any) => {
    let email = '';
    try { email = p.email_encriptado ? decryptPII(p.email_encriptado) : ''; } catch { email = ''; }
    const { email_encriptado: _omit, ...rest } = p;
    return { ...rest, email };
  });
  res.json(out);
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

// =====================================================================
// PROFESORES — Plantilla Excel (profesional, con dropdowns)
// =====================================================================
router.get('/profesores/plantilla', async (_req, res) => {
  const totalCatalogo = AREAS_AFINIDAD.length;
  const rangoCatalogo = `$A$2:$A$${totalCatalogo + 1}`;

  const buf = await buildTemplateXlsx({
    sheetName: 'Profesores',
    titulo: 'Plantilla — Profesores',
    subtitulo: 'Programa MBA · INALDE Business School',
    instrucciones: [
      'Esta plantilla sirve para cargar profesores en lote al sistema de trabajos de grado.',
      '',
      'Cómo usarla:',
      '1. En la hoja "Profesores", llena una fila por cada profesor que vayas a cargar.',
      '2. Las columnas marcadas con * son obligatorias (Nombre completo y Email).',
      '3. Para "Es administrador" usa el menú desplegable: Sí / No.',
      '4. Para las áreas de afinidad usa los menús desplegables (1 principal + 2 opcionales). Si necesitas más, contacta al equipo técnico.',
      '5. Si dejas "Clave inicial" vacía, el sistema generará una clave aleatoria de 12 caracteres y te la mostrará al subir el archivo (cópiala: solo se muestra una vez).',
      '6. La columna "URL de booking" es opcional. Pega ahí el enlace de Calendly u otra plataforma de agenda del profesor.',
      '',
      'Notas:',
      '· Los emails deben ser válidos y únicos en el sistema.',
      '· Cada profesor recibirá un correo de bienvenida con sus credenciales (en una próxima versión).',
      '· Las áreas disponibles están en la hoja "Catálogo - Áreas".',
    ],
    catalogos: [{
      sheet: 'Catálogo - Áreas',
      titulo: 'Áreas de afinidad disponibles',
      valores: [...AREAS_AFINIDAD],
    }],
    columns: [
      { header: 'Nombre completo', width: 32, required: true, comment: 'Nombre y apellidos completos del profesor.' },
      { header: 'Email institucional', width: 34, required: true, comment: 'Correo institucional INALDE u otro. Será su usuario para ingresar al sistema.' },
      { header: 'Clave inicial', width: 22, comment: 'Opcional. Si la dejas en blanco, el sistema genera una al cargar el Excel.' },
      { header: 'URL de booking', width: 32, comment: 'Opcional. Enlace de Calendly u otra plataforma de agenda.' },
      { header: 'Es administrador', width: 18, comment: 'Sí = puede gestionar todo el sistema. No = solo es profesor.',
        dropdownValues: ['Sí', 'No'] },
      { header: 'Área de afinidad 1', width: 22, comment: 'Principal. Selecciona del menú desplegable.',
        dropdownRange: { sheet: 'Catálogo - Áreas', range: rangoCatalogo } },
      { header: 'Área de afinidad 2', width: 22, comment: 'Opcional. Selecciona del menú desplegable.',
        dropdownRange: { sheet: 'Catálogo - Áreas', range: rangoCatalogo } },
      { header: 'Área de afinidad 3', width: 22, comment: 'Opcional. Selecciona del menú desplegable.',
        dropdownRange: { sheet: 'Catálogo - Áreas', range: rangoCatalogo } },
    ],
    exampleRows: [
      ['Juan Pérez García', 'juan.perez@inalde.edu.co', '', 'https://calendly.com/jperez', 'No', AREAS_AFINIDAD[0], AREAS_AFINIDAD[1], ''],
      ['María Rodríguez Mejía', 'maria.rodriguez@inalde.edu.co', '', '', 'Sí', AREAS_AFINIDAD[2], '', ''],
    ],
    filasReservadas: 50,
  });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="plantilla-profesores.xlsx"');
  res.send(buf);
});

// =====================================================================
// PROFESORES — Cargar Excel
// =====================================================================
router.post('/profesores/cargar-excel', upload.single('file'), async (req: AuthenticatedRequest, res) => {
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
  const passwordCol = findCol(header, PASSWORD_KEYS);
  const bookingCol = findCol(header, BOOKING_KEYS);
  const superCol = findCol(header, SUPERADMIN_KEYS);
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

  const supabaseUrl = process.env.SUPABASE_URL!;
  const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  let inserted = 0;
  const errors: Array<{ row: number; error: string }> = [];
  const claves: Array<{ email: string; nombre: string; clave: string }> = [];

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

      const passwordExcel = cellStr(row, passwordCol);
      const password = passwordExcel || passwordAleatoria(12);
      const booking = cellStr(row, bookingCol) || null;
      const esAdmin = superCol > 0 ? cellBool(row, superCol) : false;
      const areas = matchAreas(
        leerAreas(row, { uno: area1Col, dos: area2Col, tres: area3Col, legacy: areasLegacyCol })
      );

      // Crear auth user
      const createResp = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
        method: 'POST',
        headers: { apikey: svcKey, Authorization: `Bearer ${svcKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, email_confirm: true, app_metadata: { app_role: 'profesor', es_super_admin: esAdmin } }),
      });
      if (!createResp.ok) {
        errors.push({ row: r, error: `Auth user no creado (probablemente ya existe): ${email}` });
        continue;
      }
      const authUser = (await createResp.json()) as { id: string };

      const { data: prof, error: e1 } = await supabaseAdmin.from('profesores').insert({
        auth_user_id: authUser.id,
        nombre_completo: nombre,
        email_encriptado: encryptPII(email),
        email_hash: sha256Hex(email),
        es_super_admin: esAdmin,
        activo: true,
        booking_url: booking,
        areas_afinidad: areas,
      }).select('id').single();
      if (e1) { errors.push({ row: r, error: e1.message }); continue; }

      await fetch(`${supabaseUrl}/auth/v1/admin/users/${authUser.id}`, {
        method: 'PUT',
        headers: { apikey: svcKey, Authorization: `Bearer ${svcKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ app_metadata: { app_role: 'profesor', es_super_admin: esAdmin, profesor_id: prof.id } }),
      });

      inserted++;
      // Si el admin no escribió la clave, devolverla para que pueda compartirla
      if (!passwordExcel) {
        claves.push({ email, nombre, clave: password });
      }
    } catch (e) {
      errors.push({ row: r, error: (e as Error).message });
    }
  }

  res.json({
    inserted,
    errors: errors.slice(0, 50),
    claves_generadas: claves,
    nota: claves.length > 0
      ? 'Se generaron claves aleatorias para los profesores sin "Clave inicial" en el Excel. Guárdalas: solo se muestran una vez.'
      : undefined,
  });
});

// === DELETE /api/admin/profesores/:id ====================================
router.delete('/profesores/:id', async (req, res) => {
  const supabaseUrl = process.env.SUPABASE_URL!;
  const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const { data: prof } = await supabaseAdmin.from('profesores').select('auth_user_id').eq('id', req.params.id).maybeSingle();
  if (!prof) return res.status(404).json({ error: 'NOT_FOUND' });
  // Borrar asignaciones primero (FK)
  await supabaseAdmin.from('asignaciones_profesor').delete().eq('profesor_id', req.params.id);
  const { error } = await supabaseAdmin.from('profesores').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  if (prof.auth_user_id) {
    try {
      await fetch(`${supabaseUrl}/auth/v1/admin/users/${prof.auth_user_id}`, {
        method: 'DELETE', headers: { apikey: svcKey, Authorization: `Bearer ${svcKey}` },
      });
    } catch { /* best effort */ }
  }
  res.json({ ok: true });
});

// === POST /api/admin/profesores/bulk-delete ==============================
router.post('/profesores/bulk-delete', async (req, res) => {
  const parsed = z.object({ ids: z.array(z.string().uuid()).min(1).max(500) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'INVALID', details: parsed.error.issues });
  const supabaseUrl = process.env.SUPABASE_URL!;
  const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  let borrados = 0; const fallos: any[] = [];
  for (const id of parsed.data.ids) {
    const { data: prof } = await supabaseAdmin.from('profesores').select('auth_user_id, nombre_completo').eq('id', id).maybeSingle();
    if (!prof) { fallos.push({ id, error: 'NOT_FOUND' }); continue; }
    await supabaseAdmin.from('asignaciones_profesor').delete().eq('profesor_id', id);
    const { error } = await supabaseAdmin.from('profesores').delete().eq('id', id);
    if (error) { fallos.push({ id, nombre: prof.nombre_completo, error: error.message }); continue; }
    if (prof.auth_user_id) {
      try {
        await fetch(`${supabaseUrl}/auth/v1/admin/users/${prof.auth_user_id}`, {
          method: 'DELETE', headers: { apikey: svcKey, Authorization: `Bearer ${svcKey}` },
        });
      } catch { /* best effort */ }
    }
    borrados++;
  }
  res.json({ borrados, fallos });
});

const updateProfSchema = z.object({
  nombre_completo: z.string().min(2).max(150).optional(),
  email: z.string().email().optional(),
  password: z.string().min(8).regex(/[A-Z]/).regex(/[a-z]/).regex(/\d/).optional(),
  es_super_admin: z.boolean().optional(),
  activo: z.boolean().optional(),
  booking_url: z.string().url().nullable().optional(),
  areas_afinidad: z.array(areaEnum).optional(),
});
router.put('/profesores/:id', async (req, res) => {
  const parsed = updateProfSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'INVALID', details: parsed.error.issues });

  // Cargar auth_user_id antes de actualizar (lo necesitamos para email/password)
  const { data: cur } = await supabaseAdmin
    .from('profesores').select('id, auth_user_id').eq('id', req.params.id).maybeSingle();
  if (!cur) return res.status(404).json({ error: 'NOT_FOUND' });

  // Construir patch para la tabla profesores
  const { email, password, ...rest } = parsed.data;
  const patch: Record<string, unknown> = { ...rest };
  if (email !== undefined) {
    patch.email_encriptado = encryptPII(email.toLowerCase().trim());
    patch.email_hash = sha256Hex(email.toLowerCase().trim());
  }

  if (Object.keys(patch).length) {
    const { error } = await supabaseAdmin.from('profesores').update(patch).eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
  }

  // Sincronizar con Supabase Auth si cambio email, password o es_super_admin
  if (cur.auth_user_id && (email !== undefined || password !== undefined || parsed.data.es_super_admin !== undefined)) {
    const supabaseUrl = process.env.SUPABASE_URL!;
    const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const body: Record<string, unknown> = {};
    if (email !== undefined) { body.email = email.toLowerCase().trim(); body.email_confirm = true; }
    if (password !== undefined) body.password = password;
    if (parsed.data.es_super_admin !== undefined) {
      body.app_metadata = { app_role: 'profesor', profesor_id: cur.id, es_super_admin: parsed.data.es_super_admin };
    }
    const r = await fetch(`${supabaseUrl}/auth/v1/admin/users/${cur.auth_user_id}`, {
      method: 'PUT',
      headers: { apikey: svcKey, Authorization: `Bearer ${svcKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) return res.status(400).json({ error: 'AUTH_USER_UPDATE_FAILED', detail: (await r.text()).slice(0, 200) });
  }

  const { data: out } = await supabaseAdmin
    .from('profesores').select('id, nombre_completo, es_super_admin, activo, booking_url, areas_afinidad').eq('id', req.params.id).maybeSingle();
  res.json({ profesor: out });
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
      archivo_anteproyecto_path, archivo_proyecto_final_path,
      anteproyecto_aprobado_at,
      equipos!inner ( id, nombre_equipo, cohorte_id, tipo_trabajo_grado,
        director:directores ( id, nombre_completo ) ),
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
        id, nombre_equipo, cohorte_id, tipo_trabajo_grado, director_id,
        director:directores ( id, nombre_completo ),
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
      ? `<p style="margin:12pt 0">Agenda del profesor: <a href="${prof.booking_url}">${prof.booking_url}</a></p>`
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
          <p style="margin-top:18pt">Próximos pasos:</p>
          <p style="margin:6pt 0">
            Coordinar la <strong>Reunión 1</strong> con tu profesor según el cronograma de la cohorte.
            <strong>IMPORTANTE:</strong> solamente un miembro del equipo debe solicitar la cita
            (aunque todos asistirán).
          </p>
          ${bookingLine}
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
