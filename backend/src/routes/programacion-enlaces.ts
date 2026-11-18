import { Router, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { z } from 'zod';
import { supabaseAdmin } from '../db/supabase.js';
import { requireAuth, requireRole, type AuthenticatedRequest } from '../auth/middleware.js';
import { ipCliente } from '../lib/ip-cliente.js';
import { downloadMiniatura, downloadTrabajoGradoFile, mimeFromPath } from '../services/storage.js';
import { proyectoEnProgramacion } from '../services/panelistas-enlace.js';
import {
  DIAS_MAXIMOS, PUBLICOS, crearEnlace, enlaceDeToken, enlacesDeCohorte, esPublico, programacionPublicadaAt,
  revocarEnlace, vistaProgramacion, type EnlaceProgramacion, type FilaVista,
} from '../services/programacion-enlaces.js';

// Enlaces mágicos de la programación por público (sql/58): asistentes (tabla
// para imprimir), marketing (con post y logo) y publicaciones (con One Pagers).
// El super admin los genera y los envía él; el sistema no manda correos.
//
// Igual que la Programación Interna, solo enseñan la programación PUBLICADA:
// un borrador se reordena y cambia de hora, y montar el evento o una pieza de
// comunicación sobre él sale mal. Antes de publicar, el enlace abre y lo dice.

const router = Router();
const soloAdmin = [requireAuth(), requireRole('super_admin')] as const;
const HORA = 60 * 60 * 1000;
const porIp = { windowMs: HORA, keyGenerator: (req: Request) => ipCliente(req) ?? 'sin-ip', standardHeaders: true, legacyHeaders: false };
const limiteLectura = rateLimit({ ...porIp, max: 600 });
const limiteArchivos = rateLimit({ ...porIp, max: 3000 });
const limiteDescargas = rateLimit({ ...porIp, max: 60 });

const EXT: Record<string, string> = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
function nombreArchivo(s: string): string {
  return s.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Proyecto';
}

async function enlaceVigente(req: Request, res: Response): Promise<EnlaceProgramacion | null> {
  const e = await enlaceDeToken(String(req.params.token ?? ''));
  if (!e) { res.status(404).json({ error: 'ENLACE_INVALIDO' }); return null; }
  if (e.estado === 'revocado') { res.status(410).json({ error: 'ENLACE_REVOCADO' }); return null; }
  if (e.estado === 'vencido') { res.status(410).json({ error: 'ENLACE_VENCIDO', vence_at: e.vence_at }); return null; }
  return e;
}
async function exigirPublicada(e: EnlaceProgramacion, res: Response): Promise<boolean> {
  if (await programacionPublicadaAt(e.cohorte_id)) return true;
  res.status(409).json({ error: 'PROGRAMACION_NO_PUBLICADA' });
  return false;
}
async function etiquetaDe(cohorteId: string): Promise<string> {
  const { data } = await supabaseAdmin.from('cohortes').select('etiqueta').eq('id', cohorteId).maybeSingle();
  return (data as any)?.etiqueta ?? cohorteId;
}

// =====================================================================
// PÚBLICO — quien tiene el enlace
// =====================================================================

// GET /api/programacion-enlaces/v/:token
router.get('/v/:token', limiteLectura, async (req, res) => {
  const e = await enlaceVigente(req, res);
  if (!e) return;
  const publicada = !!(await programacionPublicadaAt(e.cohorte_id));
  const vista = publicada ? await vistaProgramacion(e.cohorte_id, e.publico) : { evento_nombre: '', jornadas: [] };
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    publico: e.publico, publico_nombre: PUBLICOS[e.publico].nombre, ve: PUBLICOS[e.publico],
    nombre: e.nombre, cohorte: await etiquetaDe(e.cohorte_id), vence_at: e.vence_at,
    publicada, evento_nombre: vista.evento_nombre, jornadas: vista.jornadas,
  });
});

// GET /api/programacion-enlaces/v/:token/archivo/:proyectoId/:tipo
// Cada público pide solo lo suyo: marketing el logo, publicaciones el One Pager.
router.get('/v/:token/archivo/:proyectoId/:tipo', limiteArchivos, async (req, res) => {
  const e = await enlaceVigente(req, res);
  if (!e) return;
  const cfg = PUBLICOS[e.publico];
  const { proyectoId, tipo } = req.params;
  const permitido = (tipo === 'one-pager' && cfg.onePager) || ((tipo === 'logo' || tipo === 'miniatura') && cfg.logo);
  if (!permitido) return res.status(404).json({ error: 'NO_ENCONTRADO' });
  if (!(await exigirPublicada(e, res))) return;
  if (!(await proyectoEnProgramacion(e.cohorte_id, proyectoId))) return res.status(404).json({ error: 'NO_ENCONTRADO' });
  const [{ data: c }, { data: p }] = await Promise.all([
    supabaseAdmin.from('proyecto_contenido').select('one_pager_path, one_pager_url, logo_path, logo_url').eq('proyecto_id', proyectoId).maybeSingle(),
    supabaseAdmin.from('proyectos').select('nombre').eq('id', proyectoId).maybeSingle(),
  ]);
  const esOnePager = tipo === 'one-pager';
  const path: string | null = esOnePager ? (c as any)?.one_pager_path : (c as any)?.logo_path;
  const urlExterna: string | null = esOnePager ? (c as any)?.one_pager_url : (c as any)?.logo_url;
  if (!path) {
    if (urlExterna && /^https:\/\//i.test(urlExterna)) return res.redirect(302, urlExterna);
    return res.status(404).json({ error: 'NO_ENCONTRADO' });
  }
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (tipo === 'miniatura') {
    const m = await downloadMiniatura(path, 160);
    if (m) { res.setHeader('Content-Type', m.mime); res.setHeader('Cache-Control', 'private, max-age=600'); return res.send(m.buf); }
  }
  let buf: Buffer;
  try { buf = await downloadTrabajoGradoFile(path); } catch { return res.status(404).json({ error: 'ARCHIVO_NO_DISPONIBLE' }); }
  const mime = mimeFromPath(path);
  const nombre = `${esOnePager ? 'One Pager' : 'Logo'} - ${nombreArchivo((p as any)?.nombre ?? 'Proyecto')}.${EXT[mime] ?? 'bin'}`;
  res.setHeader('Content-Type', mime);
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Content-Disposition', `${req.query.descargar === '1' ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(nombre)}`);
  res.send(buf);
});

// GET /api/programacion-enlaces/v/:token/zip — publicaciones: todos los One
// Pager; marketing: todos los logos. Una carpeta por proyecto, en el orden de
// presentación. Sin comprimir: PDF, JPG y PNG ya vienen comprimidos.
router.get('/v/:token/zip', limiteDescargas, async (req, res) => {
  const e = await enlaceVigente(req, res);
  if (!e) return;
  const cfg = PUBLICOS[e.publico];
  if (!cfg.onePager && !cfg.logo) return res.status(404).json({ error: 'NO_ENCONTRADO' });
  if (!(await exigirPublicada(e, res))) return;
  const que = cfg.onePager ? 'One Pager' : 'Logo';
  const { jornadas } = await vistaProgramacion(e.cohorte_id, e.publico);
  const proys = jornadas.flatMap((j) => j.filas).filter((f): f is Extract<FilaVista, { tipo: 'proyecto' }> => f.tipo === 'proyecto');
  const { data: cont } = proys.length
    ? await supabaseAdmin.from('proyecto_contenido').select('proyecto_id, one_pager_path, logo_path').in('proyecto_id', proys.map((p) => p.proyecto_id))
    : { data: [] as any[] };
  const pathDe = new Map((cont ?? []).map((c: any) => [c.proyecto_id, (cfg.onePager ? c.one_pager_path : c.logo_path) as string | null]));
  const zip = new JSZip();
  const faltan: string[] = [];
  const ancho = String(Math.max(...proys.map((p) => p.slot), 1)).length;
  for (let i = 0; i < proys.length; i += 4) {
    await Promise.all(proys.slice(i, i + 4).map(async (p) => {
      const nombre = nombreArchivo(p.proyecto);
      const path = pathDe.get(p.proyecto_id);
      if (!path) { faltan.push(`${p.slot}. ${p.proyecto}`); return; }
      try {
        const buf = await downloadTrabajoGradoFile(path);
        zip.folder(`${String(p.slot).padStart(ancho, '0')} - ${nombre}`)!.file(`${que} - ${nombre}.${EXT[mimeFromPath(path)] ?? 'bin'}`, buf);
      } catch { faltan.push(`${p.slot}. ${p.proyecto}`); }
    }));
  }
  if (faltan.length) zip.file(`LEAME - ${que} que faltan.txt`, `Estos archivos no se pudieron incluir:\n\n${faltan.join('\n')}\n`);
  const archivo = `${que}s NAVES ${nombreArchivo(await etiquetaDe(e.cohorte_id))}.zip`;
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(archivo)}`);
  zip.generateNodeStream({ type: 'nodebuffer', streamFiles: true, compression: 'STORE' }).on('error', () => res.destroy()).pipe(res);
});

// GET /api/programacion-enlaces/v/:token/excel — la tabla del público, lista
// para imprimir: una hoja por jornada, horizontal, carta, ajustada al ancho y
// con los títulos de columna repetidos en cada página (como el Excel que
// pegan las asistentes en las carteleras).
router.get('/v/:token/excel', limiteDescargas, async (req, res) => {
  const e = await enlaceVigente(req, res);
  if (!e) return;
  if (!(await exigirPublicada(e, res))) return;
  const cfg = PUBLICOS[e.publico];
  const [{ evento_nombre, jornadas }, cohorte] = await Promise.all([vistaProgramacion(e.cohorte_id, e.publico), etiquetaDe(e.cohorte_id)]);

  const cols: Array<{ titulo: string; ancho: number; de: (f: Extract<FilaVista, { tipo: 'proyecto' }>) => string | number; izq?: boolean }> = [
    { titulo: 'Inicio', ancho: 9, de: (f) => f.hora_inicio },
    { titulo: 'Fin', ancho: 9, de: (f) => f.hora_fin },
    { titulo: 'Slot', ancho: 6, de: (f) => f.slot },
    { titulo: 'Bloque', ancho: 9, de: (f) => `Bloque ${f.bloque}` },
    { titulo: 'Proyecto', ancho: 30, de: (f) => f.proyecto, izq: true },
    { titulo: 'Autores', ancho: 34, de: (f) => f.autores, izq: true },
    { titulo: 'Sector', ancho: 20, de: (f) => f.sector, izq: true },
  ];
  if (cfg.resumen) cols.push({ titulo: 'Resumen', ancho: 60, de: (f) => f.resumen ?? '', izq: true });
  if (cfg.linkedin) cols.push({ titulo: 'Post LinkedIn', ancho: 70, de: (f) => f.linkedin ?? '', izq: true });

  const wb = new ExcelJS.Workbook();
  const NEGRO = 'FF1A1A1A', ROJO = 'FF8B1A1A', AMARILLO = 'FFFFF2CC', GRIS = 'FFBFBFBF';
  const borde = { top: { style: 'thin' as const, color: { argb: GRIS } }, left: { style: 'thin' as const, color: { argb: GRIS } }, bottom: { style: 'thin' as const, color: { argb: GRIS } }, right: { style: 'thin' as const, color: { argb: GRIS } } };
  const ultimaCol = String.fromCharCode(64 + cols.length);
  for (const j of jornadas) {
    const ws = wb.addWorksheet(`Jornada ${j.numero}`, {
      views: [{ state: 'frozen', ySplit: 4, showGridLines: false }],
      // Carta = 1 en el formato de Excel (OOXML); el enum de ExcelJS no la trae.
      pageSetup: { orientation: 'landscape', paperSize: 1 as unknown as ExcelJS.PaperSize, fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 } },
    });
    ws.pageSetup.printTitlesRow = '4:4';
    ws.columns = cols.map((c) => ({ width: c.ancho })) as any;
    const t1 = ws.addRow([`${evento_nombre || 'NAVES'} — Jornada de Presentaciones · Día ${j.numero}`]);
    ws.mergeCells(`A1:${ultimaCol}1`);
    t1.height = 26; t1.getCell(1).font = { bold: true, size: 15, color: { argb: 'FFFFFFFF' } };
    t1.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ROJO } }; t1.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
    const legible = j.fecha_legible.charAt(0).toUpperCase() + j.fecha_legible.slice(1);
    const t2 = ws.addRow([`${cohorte} · ${legible}`]);
    ws.mergeCells(`A2:${ultimaCol}2`);
    t2.getCell(1).font = { italic: true, size: 11, color: { argb: 'FFFFFFFF' } };
    t2.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ROJO } }; t2.getCell(1).alignment = { horizontal: 'center' };
    ws.addRow([]);
    const h = ws.addRow(cols.map((c) => c.titulo));
    h.height = 20;
    h.eachCell((c) => { c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NEGRO } }; c.alignment = { horizontal: 'center', vertical: 'middle' }; c.border = borde; });
    for (const f of j.filas) {
      if (f.tipo === 'actividad') {
        const r = ws.addRow([f.hora_inicio, f.hora_fin, f.desc]);
        ws.mergeCells(`C${r.number}:${ultimaCol}${r.number}`);
        r.eachCell({ includeEmpty: true }, (c) => { c.font = { bold: true }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8E8E8' } }; c.border = borde; c.alignment = { vertical: 'middle', horizontal: 'center' }; });
        r.getCell(3).alignment = { vertical: 'middle', horizontal: 'left' };
        continue;
      }
      const r = ws.addRow(cols.map((c) => c.de(f)));
      r.eachCell({ includeEmpty: true }, (c, n) => {
        c.border = borde; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AMARILLO } };
        c.alignment = { vertical: 'top', wrapText: true, horizontal: cols[n - 1]?.izq ? 'left' : 'center' };
      });
    }
  }
  const nombre = `Programacion NAVES ${nombreArchivo(cohorte)} - ${PUBLICOS[e.publico].nombre}.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(nombre)}`);
  await wb.xlsx.write(res);
  res.end();
});

// =====================================================================
// ADMIN — solo el super admin con su sesión
// =====================================================================

router.get('/admin/:cohorteId', ...soloAdmin, async (req, res) => {
  const [enlaces, publicada_at] = await Promise.all([enlacesDeCohorte(req.params.cohorteId), programacionPublicadaAt(req.params.cohorteId)]);
  res.json({ enlaces, publicada_at, dias_maximos: DIAS_MAXIMOS });
});

const crearSchema = z.object({
  publico: z.string().refine(esPublico),
  nombre: z.string().trim().min(2).max(150),
  vence_at: z.string().datetime({ offset: true }),
});
router.post('/admin/:cohorteId', ...soloAdmin, async (req: AuthenticatedRequest, res) => {
  const parsed = crearSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: 'INVALID', mensaje: 'Escribe para quién es el enlace y elige el público.' });
  const vence = new Date(parsed.data.vence_at).getTime();
  // Un minuto de holgura por la diferencia de reloj con el navegador.
  if (vence <= Date.now()) return res.status(400).json({ error: 'VENCE_EN_EL_PASADO' });
  if (vence > Date.now() + DIAS_MAXIMOS * 86400000 + 60_000) return res.status(400).json({ error: 'VENCE_DEMASIADO_TARDE', mensaje: `Un enlace dura como máximo ${DIAS_MAXIMOS} días.` });
  const { data: coh } = await supabaseAdmin.from('cohortes').select('id').eq('id', req.params.cohorteId).maybeSingle();
  if (!coh) return res.status(404).json({ error: 'COHORTE_NO_ENCONTRADA' });
  let enlace: EnlaceProgramacion;
  try { enlace = await crearEnlace(req.params.cohorteId, parsed.data.publico as any, parsed.data.nombre, parsed.data.vence_at, req.user?.profesorId ?? null); }
  catch { return res.status(500).json({ error: 'NO_SE_PUDO_GUARDAR' }); }
  await supabaseAdmin.from('auditoria').insert({
    actor_tipo: 'super_admin', actor_id: req.user?.profesorId ?? null, accion: 'ADMIN_ENLACE_PROGRAMACION_CREADO',
    entidad_tipo: 'programacion_enlaces', entidad_id: enlace.id,
    detalles: { cohorte_id: enlace.cohorte_id, publico: enlace.publico, nombre: enlace.nombre, vence_at: enlace.vence_at }, timestamp: new Date().toISOString(),
  }).then(() => { /* el rastro no debe tumbar el cambio */ }, () => { /* idem */ });
  res.status(201).json({ enlace });
});

router.delete('/admin/enlace/:id', ...soloAdmin, async (req: AuthenticatedRequest, res) => {
  const e = await revocarEnlace(req.params.id);
  if (!e) return res.status(404).json({ error: 'NO_ENCONTRADO' });
  await supabaseAdmin.from('auditoria').insert({
    actor_tipo: 'super_admin', actor_id: req.user?.profesorId ?? null, accion: 'ADMIN_ENLACE_PROGRAMACION_REVOCADO',
    entidad_tipo: 'programacion_enlaces', entidad_id: e.id, detalles: { cohorte_id: e.cohorte_id, publico: e.publico }, timestamp: new Date().toISOString(),
  }).then(() => { /* informativo */ }, () => { /* idem */ });
  res.json({ ok: true });
});

export default router;
