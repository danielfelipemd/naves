import { supabaseAdmin } from '../../db/supabase.js';

// =====================================================================
// AoL §11/§12 — Exportación por cohorte.
//
//  - generarReporteWord: reporte Word (docx) FIEL a la plantilla oficial
//    (9 secciones). Cifras EXACTAS de la base (prohibidos los "≈"). Prosa en
//    español; los nombres de LO/trait van en inglés en las tablas. Comparaciones
//    contra la última cohorte de la MISMA modalidad (de v_resumen).
//  - generarReporteExcel: paquete "DATOS BRUTOS" (xlsx) con las 5 hojas exactas.
//
// Carga diferida de `docx` y `exceljs` (dynamic import DENTRO de cada función):
// OBLIGATORIO por un fix de contenedor previo (no cargar al arrancar el server).
// =====================================================================

export interface CamposEditables {
  nota_contexto?: string;        // §3 [PROFESOR]
  lectura_impacto?: string;      // §6 [EDITABLE]
  acciones_siguiente?: string;   // §7 [PROFESOR]
}

// ---------------------------------------------------------------------
// Utilidades compartidas
// ---------------------------------------------------------------------

// Deriva el código AoL de la etiqueta de la cohorte de la plataforma.
//   "MBA INT 24-26" → { modalidad:'INT', codigoAol:'INT 2024-2026' }
//   "MBA FS 2022-2024" → { modalidad:'FS', codigoAol:'FS 2022-2024' }
export function derivarCodigoAol(etiqueta: string): { modalidad: 'INT' | 'FS'; codigoAol: string } {
  const modalidad: 'INT' | 'FS' = /\bINT\b/i.test(etiqueta) ? 'INT' : 'FS';
  const anios = etiqueta.match(/(\d{2,4})\s*[-–]\s*(\d{2,4})/);
  const to4 = (s: string) => (s.length === 2 ? 2000 + Number(s) : Number(s));
  const codigoAol = anios ? `${modalidad} ${to4(anios[1])}-${to4(anios[2])}` : etiqueta;
  return { modalidad, codigoAol };
}

// Resuelve la cohorte de la plataforma → etiqueta + código AoL.
export async function resolverCohorte(cohorteId: string): Promise<{ etiqueta: string; modalidad: 'INT' | 'FS'; codigoAol: string }> {
  const { data: coh } = await supabaseAdmin.from('cohortes').select('etiqueta').eq('id', cohorteId).maybeSingle();
  const etiqueta = (coh as any)?.etiqueta ?? cohorteId;
  return { etiqueta, ...derivarCodigoAol(etiqueta) };
}

// Año de fin de un código AoL ("INT 2024-2026" → 2026), para ordenar cohortes.
function anioFinDe(codigo: string): number {
  return Number((codigo.match(/(\d{4})\s*-\s*(\d{4})/) ?? [])[2] ?? 0);
}

const TARGET = 80; // % on standard objetivo por trait (institucional).

// Promedio de pct_on_standard de un conjunto de filas de v_resumen.
function promedio(filas: any[]): number | null {
  if (!filas.length) return null;
  return filas.reduce((s, r) => s + Number(r.pct_on_standard), 0) / filas.length;
}

// =====================================================================
// generarReporteWord — FIEL a la plantilla (9 secciones)
// =====================================================================
export async function generarReporteWord(cohorteId: string, campos: CamposEditables = {}): Promise<{ buffer: Buffer; filename: string }> {
  const {
    Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell,
    WidthType, AlignmentType, BorderStyle, Footer, PageNumber,
  } = await import('docx');

  const { etiqueta, modalidad, codigoAol } = await resolverCohorte(cohorteId);

  // --- Datos ---------------------------------------------------------
  const [
    { data: resumenActual }, { data: historico }, { data: criterios }, { data: los },
    { data: acciones }, { data: aacsb }, { data: califs },
  ] = await Promise.all([
    supabaseAdmin.from('v_resumen').select('*').eq('cohorte', codigoAol).order('lo').order('criterio'),
    supabaseAdmin.from('v_resumen').select('*').order('anio_medicion').order('lo').order('criterio'),
    supabaseAdmin.from('criterio').select('id, lo_id, orden, nombre_en, nombre_corto').order('id'),
    supabaseAdmin.from('learning_objective').select('id, codigo, nombre_en').order('id'),
    supabaseAdmin.from('accion_mejora').select('*').order('anio', { ascending: false }),
    supabaseAdmin.from('aacsb_tabla').select('*').order('id'),
    supabaseAdmin.from('aol_calificacion').select('version_cerebro, version_rubrica, firmado_en').eq('cohorte_codigo', codigoAol),
  ]);

  const filas = (resumenActual ?? []) as any[];
  const hist = (historico ?? []) as any[];
  const critList = (criterios ?? []) as any[];
  const loList = (los ?? []) as any[];
  const califList = (califs ?? []) as any[];

  // Mapas de traits: nombre_corto (el que trae v_resumen) → nombre_en (inglés).
  const nombreEnPorCorto = new Map(critList.map((c) => [c.nombre_corto, c.nombre_en ?? c.nombre_corto]));
  const enDe = (criterioCorto: string) => nombreEnPorCorto.get(criterioCorto) ?? criterioCorto;
  const nombreEnLo: Record<string, string> = {};
  for (const lo of loList) nombreEnLo[lo.codigo] = lo.nombre_en ?? lo.codigo;

  // Versión de cerebro/rúbrica: de una calificación firmada, o 'v1.0' (R8).
  const versionCerebro = califList[0]?.version_cerebro ?? 'v1.0';
  const versionRubrica = califList[0]?.version_rubrica ?? 'v1.0';

  // Mes/año de medición: de la firma más reciente, o el año fin del código.
  const firmas = califList.map((c) => c.firmado_en).filter(Boolean).sort();
  const fechaMedicion = firmas.length ? new Date(firmas[firmas.length - 1]) : null;
  const mesAnioMedicion = fechaMedicion
    ? fechaMedicion.toLocaleDateString('es-CO', { month: 'long', year: 'numeric' })
    : String(anioFinDe(codigoAol) || '');

  // Cohorte previa de la MISMA modalidad (de v_resumen), para comparaciones.
  const cohortesModalidad = [...new Set(hist.map((r) => r.cohorte))]
    .filter((c: string) => c.startsWith(modalidad) && c !== codigoAol)
    .sort((a, b) => anioFinDe(b) - anioFinDe(a));
  const cohortePrevia = cohortesModalidad[0] ?? null;
  const filasPrevia = cohortePrevia ? hist.filter((r) => r.cohorte === cohortePrevia) : [];
  const pctPreviaPorTrait = new Map(filasPrevia.map((r) => [r.criterio, Number(r.pct_on_standard)]));

  // Conteos de participantes por modalidad (equipos + miembros).
  const { data: equipos } = await supabaseAdmin
    .from('equipos')
    .select('tipo_trabajo_grado, miembros_equipo(id)')
    .eq('cohorte_id', cohorteId);
  const eqs = (equipos ?? []) as any[];
  const cuentaMiembros = (e: any) => (Array.isArray(e.miembros_equipo) ? e.miembros_equipo.length : 0);
  const nPorTipo = (tipo: string) => eqs.filter((e) => e.tipo_trabajo_grado === tipo).reduce((s, e) => s + cuentaMiembros(e), 0);
  const nTotal = eqs.reduce((s, e) => s + cuentaMiembros(e), 0);
  const nBp = nPorTipo('business_plan');
  const nCaso = nPorTipo('caso');
  const nPi = nPorTipo('proyecto_investigacion');
  const nOtras = nCaso + nPi;

  // N_eval: distintos estudiantes con medición en la cohorte AoL; fallback a
  // # de calificaciones firmadas. (v_resumen.n es el conteo de learners medidos.)
  const { data: aolCoh } = await supabaseAdmin.from('cohorte').select('id').eq('codigo', codigoAol).maybeSingle();
  const aolCohorteId = (aolCoh as any)?.id ?? null;
  let nEval = califList.length;
  if (aolCohorteId != null) {
    const { data: ests } = await supabaseAdmin.from('estudiante').select('id').eq('cohorte_id', aolCohorteId);
    const estIds = ((ests ?? []) as any[]).map((e) => e.id);
    if (estIds.length) {
      const { data: meds } = await supabaseAdmin.from('medicion').select('estudiante_id').in('estudiante_id', estIds);
      const distintos = new Set(((meds ?? []) as any[]).map((m) => m.estudiante_id));
      if (distintos.size) nEval = distintos.size;
    }
  }
  const pctEval = nBp ? Math.round((nEval / nBp) * 100) : 0;

  // % del goal y por LO (actual y previa).
  const n = filas.length ? Number(filas[0].n ?? 0) : 0;
  const goalActual = promedio(filas);
  const goalPrevia = promedio(filasPrevia);
  const lo1Actual = promedio(filas.filter((r) => r.lo === 'LO1'));
  const lo2Actual = promedio(filas.filter((r) => r.lo === 'LO2'));
  const lo1Previa = promedio(filasPrevia.filter((r) => r.lo === 'LO1'));
  const lo2Previa = promedio(filasPrevia.filter((r) => r.lo === 'LO2'));

  // --- Helpers de composición ---------------------------------------
  const B = { style: BorderStyle.SINGLE, size: 2, color: 'BFBFBF' } as const;
  const bordes = { top: B, bottom: B, left: B, right: B, insideHorizontal: B, insideVertical: B } as const;
  const pct1 = (v: number | null | undefined) => (v == null ? '—' : `${Number(v).toFixed(1)}%`);
  const ppDelta = (a: number | null | undefined, b: number | null | undefined) =>
    (a == null || b == null ? '—' : `${a - b >= 0 ? '+' : '−'}${Math.abs(a - b).toFixed(1)} pp`);

  const P = (text: string, opts: any = {}) =>
    new Paragraph({ children: [new TextRun({ text, bold: opts.bold, italics: opts.italics, size: opts.size })], spacing: { after: opts.after ?? 120 }, alignment: opts.alignment });
  const H = (text: string, level: any = HeadingLevel.HEADING_1) =>
    new Paragraph({ text, heading: level, spacing: { before: 240, after: 120 } });
  const celda = (text: string, bold = false, sombra = false) => new TableCell({
    shading: sombra ? { fill: 'F2F2F2' } : undefined,
    children: [new Paragraph({ children: [new TextRun({ text, bold })] })],
  });
  const tabla = (headers: string[], rows: string[][], marcados: boolean[] = []) => new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: bordes,
    rows: [
      new TableRow({ tableHeader: true, children: headers.map((h) => celda(h, true, true)) }),
      ...rows.map((r, i) => new TableRow({ children: r.map((c) => celda(c, marcados[i] === true)) })),
    ],
  });

  const kids: any[] = [];

  // --- 1. Encabezado [AUTO] -----------------------------------------
  kids.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 60 }, children: [
    new TextRun({ text: 'Reporte de Assurance of Learning — Competency Goal: Entrepreneurship', bold: true, size: 28 }),
  ] }));
  kids.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 60 }, children: [
    new TextRun({ text: `INALDE Business School — Executive MBA · Programa NAVES`, size: 22 }),
  ] }));
  kids.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 240 }, children: [
    new TextRun({ text: `MBA ${modalidad} ${etiqueta} · Medición: ${mesAnioMedicion}`, italics: true, size: 22 }),
  ] }));

  // --- 2. Contexto y alcance [AUTO] ---------------------------------
  kids.push(H('1. Contexto y alcance de la evaluación'));
  kids.push(P(
    `La cohorte ${etiqueta} (${codigoAol}) reúne ${nTotal} participantes. De ellos, ${nOtras} desarrollaron ` +
    `otras modalidades de trabajo de grado (${nCaso} Caso + ${nPi} Proyecto de Investigación) y quedan fuera de ` +
    `esta medición. La población objeto del Assurance of Learning son los ${nBp} participantes que desarrollaron ` +
    `su trabajo de grado como Business Plan, de los cuales se evaluaron ${nEval} (${pctEval}%). ` +
    `La medición es una direct measure del competency goal Entrepreneurship: cada learner es calificado sobre su ` +
    `Business Plan con la rúbrica oficial de 6 traits agrupados en 2 learning objectives, en escala 1-3. ` +
    `Un learner está on standard en un trait cuando obtiene puntaje ≥ 2. El target institucional es 80% de learners ` +
    `on standard por trait.`));

  // --- 3. Nota de contexto [PROFESOR] -------------------------------
  kids.push(H('2. Nota de contexto del período'));
  kids.push(P(campos.nota_contexto?.trim() || '[Pendiente: nota de contexto del período — la completa el profesor.]', { italics: !campos.nota_contexto?.trim() }));

  // --- 4. Resultados del Competency Goal [AUTO] ---------------------
  kids.push(H('3. Resultados del Competency Goal'));
  kids.push(P(goalActual != null
    ? `El competency goal Entrepreneurship alcanzó ${goalActual.toFixed(1)}% de learners on standard ` +
      `(promedio de los 6 traits), sobre n=${n} learners medidos${goalActual >= TARGET ? ', por encima del target de 80%.' : `, por debajo del target de 80% (${(TARGET - goalActual).toFixed(1)} pp).`}`
    : 'Sin mediciones firmadas todavía para esta cohorte: el resultado del goal se calculará al firmar las calificaciones.'));
  kids.push(tabla(
    ['Dimensión', `Cohorte previa${cohortePrevia ? ` (${cohortePrevia})` : ''}`, 'Actual', 'Variación pp'],
    [
      [`LO1 — ${nombreEnLo['LO1'] ?? 'Discover new business opportunities'}`, pct1(lo1Previa), pct1(lo1Actual), ppDelta(lo1Actual, lo1Previa)],
      [`LO2 — ${nombreEnLo['LO2'] ?? 'Document a business plan'}`, pct1(lo2Previa), pct1(lo2Actual), ppDelta(lo2Actual, lo2Previa)],
      ['Competency Goal (Entrepreneurship)', pct1(goalPrevia), pct1(goalActual), ppDelta(goalActual, goalPrevia)],
    ],
    [false, false, true],
  ));

  // --- 5. Resultados por LO y trait [AUTO] --------------------------
  kids.push(H('4. Resultados por Learning Objective y trait'));
  const bloqueLo = (lo: 'LO1' | 'LO2', titulo: string) => {
    kids.push(H(`4.${lo === 'LO1' ? '1' : '2'} ${lo} — ${titulo}`, HeadingLevel.HEADING_2));
    const filasLo = filas.filter((r) => r.lo === lo);
    if (!filasLo.length) { kids.push(P('(Tabla por trait: pendiente de firmas.)', { italics: true })); return; }
    const rows: string[][] = [];
    const marcados: boolean[] = [];
    for (const r of filasLo) {
      const actual = Number(r.pct_on_standard);
      const previa = pctPreviaPorTrait.get(r.criterio);
      const bajo = actual < TARGET;
      rows.push([
        enDe(r.criterio), pct1(actual), String(r.excede), String(r.cumple), String(r.no_cumple),
        previa != null ? ppDelta(actual, previa) : '—', bajo ? 'Sí (bajo target)' : 'No',
      ]);
      marcados.push(bajo);
    }
    kids.push(tabla(['Trait', '% on standard', 'Excede', 'Cumple', 'No cumple', 'Δ vs previa', '¿Bajo target 80%?'], rows, marcados));
  };
  bloqueLo('LO1', nombreEnLo['LO1'] ?? 'Be able to discover new business opportunities');
  bloqueLo('LO2', nombreEnLo['LO2'] ?? 'Be able to document a business plan');

  // --- 6. Closing the loop [AUTO + EDITABLE] ------------------------
  kids.push(H('5. Closing the loop — impacto de las acciones del período anterior'));
  const accionesList = (acciones ?? []) as any[];
  const critById = new Map(critList.map((c) => [c.id, c]));
  const loCodePorId = new Map(loList.map((l) => [l.id, l.codigo]));
  const nombreEnPorCritId = (id: any) => { const c = critById.get(id); return c ? (c.nombre_en ?? c.nombre_corto) : null; };
  // Δ pp de un trait = actual - previa (por nombre_corto).
  const deltaPorCritId = (id: any) => {
    const c = critById.get(id); if (!c) return null;
    const fa = filas.find((r) => r.criterio === c.nombre_corto);
    if (!fa) return null;
    const previa = pctPreviaPorTrait.get(c.nombre_corto);
    return previa != null ? Number(fa.pct_on_standard) - previa : null;
  };
  const accionesTrait = accionesList.filter((a) => a.tipo === 'trait');
  const accionesProceso = accionesList.filter((a) => a.tipo === 'proceso');
  if (accionesTrait.length) {
    kids.push(P('Acciones sobre traits (tríada acción → trait/LO → Δ pp):', { bold: true }));
    kids.push(tabla(
      ['Acción', 'Trait / LO', 'Δ pp'],
      accionesTrait.map((a) => {
        const en = nombreEnPorCritId(a.criterio_id);
        const loCode = a.lo_id != null ? loCodePorId.get(a.lo_id) : null;
        const traitLo = [en, loCode].filter(Boolean).join(' · ') || '—';
        const d = deltaPorCritId(a.criterio_id);
        return [`[${a.anio ?? ''}] ${a.descripcion ?? ''}`, traitLo, d == null ? '—' : `${d >= 0 ? '+' : '−'}${Math.abs(d).toFixed(1)} pp`];
      }),
    ));
  } else {
    kids.push(P('(Sin acciones de mejora sobre traits registradas para el período anterior.)', { italics: true }));
  }
  if (accionesProceso.length) {
    kids.push(P('Acciones de proceso (sin trait asociado):', { bold: true }));
    for (const a of accionesProceso) {
      kids.push(new Paragraph({ bullet: { level: 0 }, children: [new TextRun({ text: `[${a.anio ?? ''}] ${a.descripcion ?? ''}` })] }));
    }
  }
  kids.push(P('Lectura de impacto:', { bold: true }));
  kids.push(P(campos.lectura_impacto?.trim() || '[Borrador IA de la lectura de impacto — acción → trait/LO → delta. Editable por el profesor antes de generar.]', { italics: !campos.lectura_impacto?.trim() }));

  // --- 7. Acciones para el siguiente ciclo [PROFESOR] ---------------
  kids.push(H('6. Acciones de mejora para el siguiente ciclo'));
  kids.push(P(campos.acciones_siguiente?.trim() || '[Pendiente: acciones de mejora — cada una exige trait + LO (o tipo proceso). Las define el profesor.]', { italics: !campos.acciones_siguiente?.trim() }));

  // --- 8. Anexo A — Tabla 5-1 AACSB [AUTO] --------------------------
  kids.push(H('7. Anexo A — Tabla 5-1 AACSB (medidas directas)'));
  const traitsBajoTarget = (lo: 'LO1' | 'LO2') => filas.filter((r) => r.lo === lo && Number(r.pct_on_standard) < TARGET).map((r) => enDe(r.criterio));
  const intervencionLo = (lo: 'LO1' | 'LO2') => {
    const loId = loList.find((l) => l.codigo === lo)?.id;
    const descs = accionesList.filter((a) => a.lo_id === loId).map((a) => a.descripcion).filter(Boolean);
    return descs.length ? descs.join('; ') : '—';
  };
  const filaAacsbCiclo = (lo: 'LO1' | 'LO2', pct: number | null) => {
    const bajo = traitsBajoTarget(lo);
    return tabla(
      ['Campo (Tabla 5-1)', 'Contenido'],
      [
        ['Measure type', 'Direct'],
        ['Competency goal', 'Entrepreneurship'],
        ['Learning objective', `${lo} — ${nombreEnLo[lo] ?? (lo === 'LO1' ? 'Be able to discover new business opportunities' : 'Be able to document a business plan')}`],
        ['Form / How assessed', 'Rúbrica AoL de 6 traits (escala 1-3) sobre el Business Plan de grado y la presentación final'],
        ['Target', '80% of learners on standard (score ≥ 2) per trait'],
        ['Where assessed', 'Trabajo de grado NAVES (Business Plan) + presentación final del programa'],
        ['When assessed', `Al cierre de la medición ${mesAnioMedicion}`],
        ['Data results', pct != null ? `${pct.toFixed(1)}% on standard (n=${n})` : 'Pendiente de firmas'],
        ['Problem identified', bajo.length ? `Traits bajo target: ${bajo.join(', ')}` : 'Ningún trait bajo target'],
        ['Curricular intervention', intervencionLo(lo)],
        ['Loop status', pct != null && pct >= TARGET ? 'Loop closed — objective achieved' : 'Loop open — curricular interventions planned for next cycle'],
      ],
    );
  };
  kids.push(P(`Ciclo actual (${codigoAol}):`, { bold: true }));
  kids.push(filaAacsbCiclo('LO1', lo1Actual));
  kids.push(P('', { after: 60 }));
  kids.push(filaAacsbCiclo('LO2', lo2Actual));
  const aacsbHist = (aacsb ?? []) as any[];
  if (aacsbHist.length) {
    kids.push(P('Registro histórico (aacsb_tabla):', { bold: true, after: 60 }));
    kids.push(tabla(
      ['Año', 'Competencia', 'Medida', 'Target', 'Dónde', 'Cuándo', 'Resultados'],
      aacsbHist.map((r) => [
        String(r.anio ?? ''), String(r.competencia ?? ''), String(r.tipo_medida ?? ''),
        String(r.target ?? ''), String(r.where_assessed ?? ''), String(r.when_assessed ?? ''), String(r.resultados ?? ''),
      ]),
    ));
  }

  // --- 9. Anexo B — Nota metodológica [FIJO] ------------------------
  kids.push(H('8. Anexo B — Nota metodológica'));
  kids.push(P(
    'La medición NAVES es una direct measure del desempeño individual del learner sobre el trabajo de grado ' +
    '(Business Plan). La rúbrica tiene 6 traits agrupados en 2 learning objectives (LO1 — discover new business ' +
    'opportunities; LO2 — document a business plan), en escala 1-3, donde on standard = puntaje ≥ 2 y el target ' +
    'institucional es 80% de learners on standard por trait.'));
  kids.push(P(
    'Regla de evidencia (R1): todo puntaje se ancla a una cita textual localizable en el Business Plan o en el ' +
    'modelo financiero; si la evidencia esperada no aparece donde la estructura del BP indica, el puntaje baja y ' +
    'la ausencia se declara. Antes de calificar operan compuertas determinísticas (entrega completa, fórmulas ' +
    'visibles, cuadre del balance) y las fuentes normativas: rúbrica oficial, estructura del BP y CN-I-078.'));
  kids.push(P(
    'La IA sugiere y el profesor firma (R7): ninguna calificación queda en firme sin la firma humana. Cada ciclo ' +
    'conserva su trazabilidad (R8): versión del cerebro y de la rúbrica, hashes de los archivos evaluados, autor ' +
    'y fecha de cada calificación. La cohorte se mide una vez y el informe documenta el ciclo; el archivo ' +
    'permanente del paquete vive en la carpeta de AoL, independiente de la plataforma.'));

  // --- Documento con pie [AUTO] -------------------------------------
  const fechaGen = new Date().toLocaleDateString('es-CO', { day: '2-digit', month: 'long', year: 'numeric' });
  const footer = new Footer({ children: [new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({
      text: `AoL NAVES · Cerebro ${versionCerebro} · Rúbrica ${versionRubrica} · Generado el ${fechaGen} · Página `,
      size: 16, color: '808080',
    }), new TextRun({ children: [PageNumber.CURRENT], size: 16, color: '808080' })],
  })] });

  const doc = new Document({ sections: [{ footers: { default: footer }, children: kids }] });
  const buffer = await Packer.toBuffer(doc);
  const filename = `Reporte AoL ${codigoAol}.docx`;
  return { buffer, filename };
}

// =====================================================================
// generarReporteExcel — paquete "DATOS BRUTOS" (5 hojas exactas)
// =====================================================================
export async function generarReporteExcel(cohorteId: string): Promise<{ buffer: Buffer; filename: string }> {
  const { default: ExcelJS } = await import('exceljs');

  const { codigoAol } = await resolverCohorte(cohorteId);

  // Cohorte AoL (histórica) para las mediciones/estudiantes/proyectos.
  const { data: aolCoh } = await supabaseAdmin.from('cohorte').select('id').eq('codigo', codigoAol).maybeSingle();
  const aolCohorteId = (aolCoh as any)?.id ?? null;

  const [{ data: resumen }, { data: criterios }, { data: los }] = await Promise.all([
    supabaseAdmin.from('v_resumen').select('*').eq('cohorte', codigoAol).order('lo').order('criterio'),
    supabaseAdmin.from('criterio').select('id, lo_id, nombre_en, nombre_corto').order('id'),
    supabaseAdmin.from('learning_objective').select('id, codigo').order('id'),
  ]);
  const critById = new Map(((criterios ?? []) as any[]).map((c) => [c.id, c]));
  const loCodeById = new Map(((los ?? []) as any[]).map((l) => [l.id, l.codigo]));

  // Estudiantes + proyectos + mediciones de la cohorte.
  let estudiantes: any[] = [];
  let mediciones: any[] = [];
  const proyectoById = new Map<any, string>();
  if (aolCohorteId != null) {
    const { data: ests } = await supabaseAdmin.from('estudiante')
      .select('id, nombre_completo, proyecto_id, nota_final').eq('cohorte_id', aolCohorteId).order('nombre_completo');
    estudiantes = (ests ?? []) as any[];
    const estIds = estudiantes.map((e) => e.id);
    const proyIds = [...new Set(estudiantes.map((e) => e.proyecto_id).filter((x) => x != null))];
    const [{ data: proys }, { data: meds }] = await Promise.all([
      proyIds.length ? supabaseAdmin.from('proyecto').select('id, titulo').in('id', proyIds) : Promise.resolve({ data: [] as any[] }),
      estIds.length ? supabaseAdmin.from('medicion').select('estudiante_id, criterio_id, puntaje').in('estudiante_id', estIds) : Promise.resolve({ data: [] as any[] }),
    ]);
    for (const p of (proys ?? []) as any[]) proyectoById.set(p.id, p.titulo);
    mediciones = (meds ?? []) as any[];
  }
  const estById = new Map(estudiantes.map((e) => [e.id, e]));

  // Párrafos + quick screen: calificaciones y análisis de la cohorte (plataforma).
  const [{ data: califs }, { data: analisis }] = await Promise.all([
    supabaseAdmin.from('aol_calificacion').select('proyecto_plataforma_id, parrafo, total, on_standard, autor, firmado_en').eq('cohorte_codigo', codigoAol),
    supabaseAdmin.from('aol_analisis').select('proyecto_plataforma_id, quick_screen, estado').eq('cohorte_codigo', codigoAol),
  ]);
  // Título del trabajo de la plataforma (proyectos) para las hojas de párrafos/quick.
  const plataProyIds = [...new Set([
    ...((califs ?? []) as any[]).map((c) => c.proyecto_plataforma_id),
    ...((analisis ?? []) as any[]).map((a) => a.proyecto_plataforma_id),
  ].filter(Boolean))];
  const tituloPlataforma = new Map<string, string>();
  if (plataProyIds.length) {
    const { data: pp } = await supabaseAdmin.from('proyectos').select('id, nombre').in('id', plataProyIds);
    for (const p of (pp ?? []) as any[]) tituloPlataforma.set(String(p.id), p.nombre);
  }

  // --- Construcción del workbook ------------------------------------
  const wb = new ExcelJS.Workbook();
  wb.creator = 'NAVES AoL';
  const hoja = (nombre: string, columnas: { header: string; key: string; width: number }[], filas: any[]) => {
    const ws = wb.addWorksheet(nombre);
    ws.columns = columnas;
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).alignment = { vertical: 'middle', wrapText: true };
    for (const f of filas) ws.addRow(f);
  };

  // Hoja Mediciones: una fila por estudiante × trait × puntaje.
  const filasMediciones = mediciones.map((m) => {
    const est = estById.get(m.estudiante_id);
    const crit = critById.get(m.criterio_id);
    return {
      estudiante: est?.nombre_completo ?? '',
      proyecto: est?.proyecto_id != null ? (proyectoById.get(est.proyecto_id) ?? '') : '',
      lo: crit ? (loCodeById.get(crit.lo_id) ?? '') : '',
      trait: crit ? (crit.nombre_en ?? crit.nombre_corto ?? '') : '',
      puntaje: m.puntaje != null ? Number(m.puntaje) : null,
      on_standard: m.puntaje != null ? (Number(m.puntaje) >= 2 ? 'Sí' : 'No') : '',
    };
  }).sort((a, b) => a.estudiante.localeCompare(b.estudiante) || a.trait.localeCompare(b.trait));
  hoja('Mediciones', [
    { header: 'Estudiante', key: 'estudiante', width: 32 },
    { header: 'Proyecto', key: 'proyecto', width: 40 },
    { header: 'LO', key: 'lo', width: 8 },
    { header: 'Trait', key: 'trait', width: 34 },
    { header: 'Puntaje', key: 'puntaje', width: 10 },
    { header: 'On standard', key: 'on_standard', width: 12 },
  ], filasMediciones);

  // Hoja Estudiantes: integrantes, proyecto, nota final del curso.
  hoja('Estudiantes', [
    { header: 'Estudiante', key: 'estudiante', width: 32 },
    { header: 'Proyecto', key: 'proyecto', width: 40 },
    { header: 'Nota final del curso', key: 'nota_final', width: 20 },
  ], estudiantes.map((e) => ({
    estudiante: e.nombre_completo ?? '',
    proyecto: e.proyecto_id != null ? (proyectoById.get(e.proyecto_id) ?? '') : '',
    nota_final: e.nota_final ?? '',
  })));

  // Hoja Resumen: % on standard y distribución por trait (v_resumen).
  hoja('Resumen', [
    { header: 'Cohorte', key: 'cohorte', width: 16 },
    { header: 'LO', key: 'lo', width: 8 },
    { header: 'Trait', key: 'criterio', width: 30 },
    { header: 'n', key: 'n', width: 8 },
    { header: '% on standard', key: 'pct_on_standard', width: 14 },
    { header: 'Excede', key: 'excede', width: 10 },
    { header: 'Cumple', key: 'cumple', width: 10 },
    { header: 'No cumple', key: 'no_cumple', width: 12 },
  ], ((resumen ?? []) as any[]).map((r) => ({
    cohorte: r.cohorte, lo: r.lo, criterio: r.criterio, n: r.n,
    pct_on_standard: Number(r.pct_on_standard), excede: r.excede, cumple: r.cumple, no_cumple: r.no_cumple,
  })));

  // Hoja Párrafos: el párrafo firmado de cada trabajo.
  hoja('Párrafos', [
    { header: 'Proyecto', key: 'proyecto', width: 40 },
    { header: 'Total', key: 'total', width: 10 },
    { header: 'On standard', key: 'on_standard', width: 12 },
    { header: 'Autor (firma)', key: 'autor', width: 28 },
    { header: 'Firmado en', key: 'firmado_en', width: 22 },
    { header: 'Párrafo', key: 'parrafo', width: 90 },
  ], ((califs ?? []) as any[]).map((c) => ({
    proyecto: tituloPlataforma.get(String(c.proyecto_plataforma_id)) ?? String(c.proyecto_plataforma_id),
    total: c.total, on_standard: c.on_standard ? 'Sí' : 'No', autor: c.autor ?? '',
    firmado_en: c.firmado_en ?? '', parrafo: c.parrafo ?? '',
  })));
  wb.getWorksheet('Párrafos')?.getColumn('parrafo').eachCell((cell) => { cell.alignment = { wrapText: true, vertical: 'top' }; });

  // Hoja Quick screen: resultado de compuertas por trabajo.
  hoja('Quick screen', [
    { header: 'Proyecto', key: 'proyecto', width: 40 },
    { header: 'Estado análisis', key: 'estado', width: 16 },
    { header: 'Quick screen', key: 'quick', width: 100 },
  ], ((analisis ?? []) as any[]).map((a) => ({
    proyecto: tituloPlataforma.get(String(a.proyecto_plataforma_id)) ?? String(a.proyecto_plataforma_id),
    estado: a.estado ?? '',
    quick: a.quick_screen != null ? JSON.stringify(a.quick_screen) : '',
  })));
  wb.getWorksheet('Quick screen')?.getColumn('quick').eachCell((cell) => { cell.alignment = { wrapText: true, vertical: 'top' }; });

  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  const filename = `${codigoAol} DATOS BRUTOS.xlsx`;
  return { buffer, filename };
}
