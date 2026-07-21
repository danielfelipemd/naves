import { supabaseAdmin } from '../../db/supabase.js';

// =====================================================================
// AoL §11 — Reporte por cohorte en Word (docx), sección por sección según
// plantilla-reporte-cohorte.md. Cifras exactas de la base (prohibidos los "≈").
// Los campos [EDITABLE]/[PROFESOR] se reciben del cliente (capturados en la UI).
// =====================================================================

export interface CamposEditables {
  nota_contexto?: string;        // §3 [PROFESOR]
  lectura_impacto?: string;      // §6 [EDITABLE]
  acciones_siguiente?: string;   // §7 [PROFESOR]
}

export async function generarReporteWord(cohorteId: string, campos: CamposEditables = {}): Promise<{ buffer: Buffer; filename: string }> {
  // Carga diferida de docx: solo al generar un reporte, no al arrancar el servidor.
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, AlignmentType } = await import('docx');
  const P = (text: string, opts: any = {}) => new Paragraph({ children: [new TextRun({ text, ...opts })], spacing: { after: 120 }, ...opts.paraOpts });
  const H = (text: string, level: any = HeadingLevel.HEADING_1) => new Paragraph({ text, heading: level, spacing: { before: 240, after: 120 } });
  const celda = (text: string, bold = false) => new TableCell({
    width: { size: 20, type: WidthType.PERCENTAGE },
    children: [new Paragraph({ children: [new TextRun({ text, bold })] })],
  });

  const { data: coh } = await supabaseAdmin.from('cohortes').select('etiqueta').eq('id', cohorteId).maybeSingle();
  const etiqueta = (coh as any)?.etiqueta ?? cohorteId;
  const modalidad = /\bINT\b/i.test(etiqueta) ? 'INT' : 'FS';
  const anios = etiqueta.match(/(\d{2,4})\s*[-–]\s*(\d{2,4})/);
  const to4 = (s: string) => (s.length === 2 ? 2000 + Number(s) : Number(s));
  const codigoAol = anios ? `${modalidad} ${to4(anios[1])}-${to4(anios[2])}` : etiqueta;

  const { data: resumen } = await supabaseAdmin.from('v_resumen').select('*').eq('cohorte', codigoAol).order('lo').order('criterio');
  const filas = (resumen ?? []) as any[];
  const { data: acciones } = await supabaseAdmin.from('accion_mejora').select('*').order('anio', { ascending: false });
  const { data: aacsb } = await supabaseAdmin.from('aacsb_tabla').select('*').order('id');

  const goalPct = filas.length ? (filas.reduce((s, r) => s + Number(r.pct_on_standard), 0) / filas.length) : null;
  const n = filas[0]?.n ?? 0;

  const kids: any[] = [];

  // 1. Encabezado [AUTO]
  kids.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'INALDE Business School — Executive MBA', bold: true, size: 28 })], spacing: { after: 60 } }));
  kids.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: `Assurance of Learning — Reporte AoL por cohorte`, size: 24 })], spacing: { after: 60 } }));
  kids.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: `Programa NAVES · Cohorte ${etiqueta} (${codigoAol})`, italics: true })], spacing: { after: 240 } }));

  // 2. Contexto y alcance [AUTO]
  kids.push(H('1. Contexto y alcance de la evaluación'));
  kids.push(P(`Competency Goal: Entrepreneurship (direct measure). Modalidad: ${modalidad}. Learners medidos (n): ${n}. On standard = puntaje ≥ 2 (escala 1-3). Target institucional: 80% de learners on standard por trait.`));

  // 3. Nota de contexto [PROFESOR]
  kids.push(H('2. Nota de contexto del período'));
  kids.push(P(campos.nota_contexto?.trim() || '[Pendiente: nota de contexto del período — la completa el profesor.]', { italics: !campos.nota_contexto }));

  // 4. Resultados del Competency Goal [AUTO]
  kids.push(H('3. Resultados del Competency Goal'));
  kids.push(P(goalPct != null
    ? `El goal Entrepreneurship alcanzó ${goalPct.toFixed(1)}% de learners on standard (promedio de los 6 traits), sobre n=${n}.`
    : 'Sin mediciones firmadas todavía para esta cohorte: el resultado se calculará al firmar las calificaciones.'));

  // 5. Resultados por LO y trait [AUTO]
  kids.push(H('4. Resultados por Learning Objective y trait'));
  if (filas.length) {
    const rows = [new TableRow({ children: [celda('LO', true), celda('Trait', true), celda('n', true), celda('% on standard', true), celda('Excede/Cumple/No', true)] })];
    for (const r of filas) {
      rows.push(new TableRow({ children: [
        celda(r.lo), celda(r.criterio), celda(String(r.n)),
        celda(`${Number(r.pct_on_standard).toFixed(1)}%`), celda(`${r.excede}/${r.cumple}/${r.no_cumple}`),
      ] }));
    }
    kids.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows }));
  } else {
    kids.push(P('(Tabla por trait: pendiente de firmas.)', { italics: true }));
  }

  // 6. Closing the loop [AUTO + EDITABLE]
  kids.push(H('5. Closing the loop — impacto de las acciones del período anterior'));
  kids.push(P(campos.lectura_impacto?.trim() || '[Borrador IA de la lectura de impacto — acción → trait/LO → delta. Editable por el profesor antes de generar.]', { italics: !campos.lectura_impacto }));

  // 7. Acciones para el siguiente ciclo [PROFESOR]
  kids.push(H('6. Acciones de mejora para el siguiente ciclo'));
  kids.push(P(campos.acciones_siguiente?.trim() || '[Pendiente: acciones de mejora — cada una exige trait + LO (o tipo proceso). Las define el profesor.]', { italics: !campos.acciones_siguiente }));
  if (acciones?.length) {
    kids.push(P('Acciones del período anterior (registro):', { bold: true }));
    for (const a of (acciones as any[]).slice(0, 20)) {
      kids.push(new Paragraph({ bullet: { level: 0 }, children: [new TextRun({ text: `[${a.anio} · ${a.cohorte_codigo} · ${a.tipo}] ${a.descripcion}` })] }));
    }
  }

  // 8. Anexo A — Tabla 5-1 AACSB [AUTO]
  kids.push(H('7. Anexo A — Tabla 5-1 AACSB (medidas directas)'));
  if (aacsb?.length) {
    for (const row of aacsb as any[]) {
      kids.push(P(JSON.stringify(row).slice(0, 400)));
    }
  } else {
    kids.push(P('(Sin filas históricas de la tabla AACSB.)', { italics: true }));
  }

  // 9. Anexo B — Nota metodológica [FIJO]
  kids.push(H('8. Anexo B — Nota metodológica'));
  kids.push(P('La medición NAVES es una direct measure del desempeño individual del learner sobre el trabajo de grado (Business Plan). Rúbrica de 6 traits agrupados en 2 learning objectives (LO1 Discover, LO2 Document), escala 1-3, on standard ≥ 2, target 80%. El calificador asiste con IA (sugerencia) y el profesor firma (decisión). Toda evidencia mostrada se verifica literalmente contra el documento (candado de citas).'));

  const doc = new Document({ sections: [{ children: kids }] });
  const buffer = await Packer.toBuffer(doc);
  const filename = `Reporte_AoL_${codigoAol.replace(/\s+/g, '_')}.docx`;
  return { buffer, filename };
}

// Reporte en Excel (§11.3). Mismas cifras exactas de la base, en hojas navegables.
export async function generarReporteExcel(cohorteId: string): Promise<{ buffer: Buffer; filename: string }> {
  const { default: ExcelJS } = await import('exceljs');
  const { data: coh } = await supabaseAdmin.from('cohortes').select('etiqueta').eq('id', cohorteId).maybeSingle();
  const etiqueta = (coh as any)?.etiqueta ?? cohorteId;
  const modalidad = /\bINT\b/i.test(etiqueta) ? 'INT' : 'FS';
  const anios = etiqueta.match(/(\d{2,4})\s*[-–]\s*(\d{2,4})/);
  const to4 = (s: string) => (s.length === 2 ? 2000 + Number(s) : Number(s));
  const codigoAol = anios ? `${modalidad} ${to4(anios[1])}-${to4(anios[2])}` : etiqueta;

  const [{ data: resumen }, { data: aacsb }, { data: concl }, { data: acciones }] = await Promise.all([
    supabaseAdmin.from('v_resumen').select('*').eq('cohorte', codigoAol).order('lo').order('criterio'),
    supabaseAdmin.from('aacsb_tabla').select('*').order('id'),
    supabaseAdmin.from('conclusion_ciclo').select('*').order('anio', { ascending: false }),
    supabaseAdmin.from('accion_mejora').select('*').order('anio', { ascending: false }),
  ]);

  const wb = new ExcelJS.Workbook();
  wb.creator = 'NAVES AoL';
  const hojaDe = (nombre: string, filas: any[]) => {
    const ws = wb.addWorksheet(nombre);
    if (!filas.length) { ws.addRow(['(sin datos)']); return; }
    const cols = Object.keys(filas[0]);
    ws.addRow(cols).font = { bold: true };
    for (const f of filas) ws.addRow(cols.map((c) => {
      const v = (f as any)[c];
      return v != null && typeof v === 'object' ? JSON.stringify(v) : v;
    }));
    ws.columns.forEach((c) => { c.width = 22; });
  };

  hojaDe('Resumen cohorte', (resumen ?? []) as any[]);
  hojaDe('Tabla 5-1 AACSB', (aacsb ?? []) as any[]);
  hojaDe('Historico ciclos', (concl ?? []) as any[]);
  hojaDe('Acciones de mejora', (acciones ?? []) as any[]);

  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  const filename = `Reporte_AoL_${codigoAol.replace(/\s+/g, '_')}.xlsx`;
  return { buffer, filename };
}
