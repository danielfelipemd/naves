import { createHash } from 'node:crypto';
import ExcelJS from 'exceljs';
import { PDFParse } from 'pdf-parse';
import { supabaseAdmin } from '../../db/supabase.js';
import { downloadTrabajoGradoFile } from '../storage.js';
import { cargarCerebro, juzgar, type ResultadoJuicio } from './juicio.js';

// =====================================================================
// AoL §7 — Pipeline calificador. Flujo por trabajo:
//   7.2 quick screen (determinístico) → 7.3 extracción (LEER) →
//   7.4 juicio (JUZGAR, Claude) → 7.5 verificación R1 + R6 → guardar aol_analisis
// =====================================================================

export const hashArchivo = (b: Buffer) => createHash('sha256').update(b).digest('hex');

// Letra de columna Excel → número (A=1, B=2, …, AA=27).
function colNum(letras: string): number {
  let n = 0;
  for (const ch of letras.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

export interface QuickScreen {
  entrega_completa: boolean; paginas: number; paginas_ok: boolean;
  toc: boolean; declaracion_ia: boolean; formulas_visibles: boolean;
  balance_cuadra: boolean | null;
  compuertas_bloqueantes: string[];
}

interface PdfExtraido { paginas: number; textoCompleto: string; pages: Array<{ num: number; text: string }>; }

async function extraerPdf(buf: Buffer): Promise<PdfExtraido> {
  const parser = new PDFParse({ data: new Uint8Array(buf) });
  const r: any = await parser.getText();
  const pages = ((r.pages ?? []) as any[]).map((p) => ({ num: p.num ?? 0, text: String(p.text ?? '') }));
  return { paginas: r.total ?? pages.length, textoCompleto: String(r.text ?? ''), pages };
}

// --- 7.2 Quick screen (compuertas determinísticas, R2) --------------------
export async function quickScreen(paginas: number, textoBp: string, modeloXlsx: Buffer): Promise<QuickScreen> {
  const r: QuickScreen = {
    entrega_completa: true, paginas, paginas_ok: paginas <= 25, toc: false,
    declaracion_ia: false, formulas_visibles: false, balance_cuadra: null, compuertas_bloqueantes: [],
  };
  r.toc = /tabla de contenido|contenido|índice/i.test(textoBp.slice(0, 6000));
  r.declaracion_ia = /declaraci[oó]n de uso de (ia|inteligencia artificial)/i.test(textoBp);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(modeloXlsx as any);
  let nFormulas = 0, nValores = 0;
  wb.eachSheet((ws) => ws.eachRow((row) => row.eachCell((c) => {
    if ((c as any).formula) nFormulas++; else if (typeof c.value === 'number') nValores++;
  })));
  r.formulas_visibles = nFormulas > 20 && nFormulas / Math.max(1, nFormulas + nValores) > 0.15;

  // Balance: Activo − (Pasivo + Patrimonio) = 0 (CN-I-078).
  const hoja = wb.worksheets.find((w) => /balance|situaci[oó]n financiera/i.test(w.name));
  if (hoja) {
    const filaDe = (re: RegExp): number | null => {
      let n: number | null = null;
      hoja.eachRow((row, i) => { if (n == null && re.test(String(row.getCell(1).value ?? ''))) n = i; });
      return n;
    };
    const rActivo = filaDe(/total activo/i);
    const rPyp = filaDe(/pasivo\s*(y|\+|más)\s*patrimonio|total pasivo y patrimonio/i);
    if (rActivo && rPyp) {
      // Resuelve el valor de una celda evaluando fórmulas simples (SUM/±) cuando
      // el archivo no trae el resultado cacheado (modelos generados por librería).
      const val = (addrCol: number, addrRow: number, depth = 0): number => {
        if (depth > 20) return NaN;
        const v: any = hoja.getRow(addrRow).getCell(addrCol).value;
        if (v == null) return NaN;
        if (typeof v === 'number') return v;
        if (typeof v === 'object') {
          if (v.result != null) return Number(v.result);
          if (v.formula) return evalFormula(hoja, v.formula, depth + 1);
        }
        return Number(v);
      };
      const evalFormula = (ws: ExcelJS.Worksheet, f: string, depth: number): number => {
        let e = f.replace(/SUM\(([A-Z]+)(\d+):([A-Z]+)(\d+)\)/gi, (_m, c1, r1, _c2, r2) => {
          const col = colNum(c1); let s = 0;
          for (let rr = Number(r1); rr <= Number(r2); rr++) { const x = val(col, rr, depth + 1); if (!isNaN(x)) s += x; }
          return String(s);
        });
        e = e.replace(/([A-Z]+)(\d+)/g, (_m, c, rr) => String(val(colNum(c), Number(rr), depth + 1)));
        if (!/^[-+*/(). \d]+$/.test(e)) return NaN;
        try { return Function(`"use strict";return (${e})`)() as number; } catch { return NaN; }
      };
      // Comparar en cada columna con datos (2..N).
      let iguales: boolean | null = null;
      for (let c = 2; c <= 12; c++) {
        const a = val(c, rActivo); const p = val(c, rPyp);
        if (isNaN(a) || isNaN(p)) continue;
        const ok = Math.abs(a - p) < 1;
        iguales = iguales == null ? ok : iguales && ok;
      }
      r.balance_cuadra = iguales;
    }
  }

  if (!r.toc) r.compuertas_bloqueantes.push('Sin tabla de contenido');
  if (!r.formulas_visibles) r.compuertas_bloqueantes.push('Modelo financiero sin fórmulas visibles / no verificable');
  return r;
}

// --- 7.3 Extracción (LEER, R4): paquetes por trait ------------------------
// Anclas pragmáticas por trait para localizar las páginas de su fuente_ia.
const ANCLAS: Record<number, RegExp | null> = {
  1: /secci[oó]n 5|(^|\D)5\.1|mercado|oportunidad|competencia/i,
  2: /(^|\D)5\.2|TAM|SAM|SOM|dimensionamiento/i,
  3: /(^|\D)5\.[34]|(^|\D)6\.[1-4]|competidor|posicionamiento|cliente|plan comercial/i,
  4: null, // tabla de contenido completa: se usa el texto de índice + todas las secciones
  5: /secci[oó]n 8|(^|\D)8\.[1-7]|econ[oó]mic|financier|vpn|tir|flujo de caja|balance/i,
  6: /secci[oó]n 3|(^|\D)3\.[123]|canvas|concepto del negocio|oferta de valor/i,
};

function extraerExcelTexto(wb: ExcelJS.Workbook): string {
  const partes: string[] = [];
  for (const ws of wb.worksheets) {
    const filas: string[] = [];
    ws.eachRow((row, i) => {
      if (i > 60) return;
      const celdas: string[] = [];
      row.eachCell((c, col) => {
        const v = (c as any).formula ? c.result ?? c.value : c.value;
        const txt = v == null ? '' : String(typeof v === 'object' ? (v as any).result ?? '' : v).trim();
        if (txt) celdas.push(`${ws.name}!${String.fromCharCode(64 + col)}${i}=${txt}`);
      });
      if (celdas.length) filas.push(celdas.join('  '));
    });
    if (filas.length) partes.push(`--- Hoja ${ws.name} ---\n${filas.join('\n')}`);
  }
  return partes.join('\n\n').slice(0, 20000);
}

interface Trait { id: number; nombre_en: string; fuente_ia: string; }

function paquetesPorTrait(pages: Array<{ num: number; text: string }>, traits: Trait[], excelTexto: string): string {
  const bloques: string[] = [];
  for (const t of traits.sort((a, b) => a.id - b.id)) {
    const anc = ANCLAS[t.id];
    const rel = anc ? pages.filter((p) => anc.test(p.text)) : pages; // trait 4: todo el documento
    const extractos = rel.length
      ? rel.map((p) => `[p.${p.num}] ${p.text.replace(/\s+/g, ' ').trim()}`)
      : ['SECCIÓN NO ENCONTRADA'];
    let bloque = `=== TRAIT ${t.id} — ${t.nombre_en} ===\nLA IA CONSULTA: ${t.fuente_ia}\n${extractos.join('\n\n')}`;
    if (t.id === 5) bloque += `\n\n[MODELO FINANCIERO EN EXCEL]\n${excelTexto}`;
    bloques.push(bloque);
  }
  return bloques.join('\n\n').slice(0, 120000);
}

// --- 7.5 Verificación R1 (candado de citas) -------------------------------
const norm = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').toLowerCase().trim();

export function verificarR1(resultado: ResultadoJuicio, textoCompleto: string, extractoExcel: string): string[] {
  const fuente = norm(textoCompleto + ' ' + extractoExcel);
  const rechazados: string[] = [];
  for (const t of resultado.traits ?? []) {
    if (t.evidencia && !fuente.includes(norm(t.evidencia))) rechazados.push(`trait ${t.trait}`);
  }
  const chequeos = [...(resultado.modelo_financiero?.interna ?? []), ...(resultado.modelo_financiero?.coherencia_bp ?? [])];
  for (const c of chequeos) {
    if (c.estado !== 'NO_VERIFICABLE' && c.evidencia && !fuente.includes(norm(c.evidencia))) rechazados.push(`chequeo ${c.chequeo}`);
  }
  return rechazados;
}

// --- Orquestación ---------------------------------------------------------
export interface AnalisisResultado {
  quick: QuickScreen;
  resultado: ResultadoJuicio | null; // null si una compuerta bloqueó
  rechazados_r1: string[];
  version_cerebro: string;
  bp_pdf_hash: string;
  modelo_xlsx_hash: string;
}

// Corre el pipeline sobre buffers (usado por el endpoint y por el test de fixtures).
export async function analizarBuffers(bpPdf: Buffer, modeloXlsx: Buffer): Promise<AnalisisResultado> {
  const cerebro = await cargarCerebro();
  const bp_pdf_hash = hashArchivo(bpPdf);
  const modelo_xlsx_hash = hashArchivo(modeloXlsx);

  const pdf = await extraerPdf(bpPdf);
  const quick = await quickScreen(pdf.paginas, pdf.textoCompleto, modeloXlsx);

  // Compuerta bloqueante → no se califica (§7.2).
  if (quick.compuertas_bloqueantes.length) {
    return { quick, resultado: null, rechazados_r1: [], version_cerebro: cerebro.version, bp_pdf_hash, modelo_xlsx_hash };
  }

  const { data: traits } = await supabaseAdmin.from('criterio').select('id, nombre_en, fuente_ia').order('id');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(modeloXlsx as any);
  const excelTexto = extraerExcelTexto(wb);
  const paquetes = paquetesPorTrait(pdf.pages, (traits ?? []) as Trait[], excelTexto);

  let resultado = await juzgar(cerebro, quick, paquetes, excelTexto);
  // 7.5 R1 + rehacer una vez los ítems no verificados.
  let rechazados = verificarR1(resultado, pdf.textoCompleto, excelTexto);
  if (rechazados.length) {
    try {
      resultado = await juzgar(cerebro, quick, paquetes, excelTexto, rechazados);
      rechazados = verificarR1(resultado, pdf.textoCompleto, excelTexto);
    } catch { /* si el reintento falla, se conserva el primer resultado y sus rechazos */ }
  }
  // R6: los ítems que sigan rechazados se marcan confianza baja y sin evidencia (jamás mostrar cita no verificada).
  if (rechazados.length && resultado.traits) {
    for (const t of resultado.traits) {
      if (rechazados.includes(`trait ${t.trait}`)) { t.confianza = 'baja'; t.evidencia = ''; }
    }
  }
  return { quick, resultado, rechazados_r1: rechazados, version_cerebro: cerebro.version, bp_pdf_hash, modelo_xlsx_hash };
}

// Descarga los archivos del trabajo, corre el pipeline y guarda aol_analisis.
// Invalida (descarta) el análisis previo si cambió el hash de los archivos.
export async function analizarProyecto(proyectoId: string): Promise<{ analisis_id: number | null; quick: QuickScreen; bloqueado: boolean }> {
  // Resolver equipo/cohorte + rutas de los archivos. El BP.pdf vive en el
  // anteproyecto del equipo (proyectos.anteproyecto_id → anteproyectos).
  const { data: proy } = await supabaseAdmin
    .from('proyectos').select('id, nombre, anteproyecto_id').eq('id', proyectoId).maybeSingle();
  if (!(proy as any)?.anteproyecto_id) throw new Error('ENTREGA_INCOMPLETA: el proyecto no tiene anteproyecto asociado');
  const { data: ante } = await supabaseAdmin
    .from('anteproyectos').select('equipo_id, archivo_proyecto_final_path, equipos(cohorte_id)').eq('id', (proy as any).anteproyecto_id).maybeSingle();
  const bpPath = (ante as any)?.archivo_proyecto_final_path as string | null;
  const cohorteId = (ante as any)?.equipos?.cohorte_id ?? '';
  const { data: cont } = await supabaseAdmin
    .from('proyecto_contenido').select('modelo_financiero_path').eq('proyecto_id', proyectoId).maybeSingle();
  const modeloPath = (cont as any)?.modelo_financiero_path as string | null;
  if (!bpPath || !modeloPath) throw new Error('ENTREGA_INCOMPLETA: falta BP.pdf o modelo financiero .xlsx');

  const [bpPdf, modeloXlsx] = await Promise.all([downloadTrabajoGradoFile(bpPath), downloadTrabajoGradoFile(modeloPath)]);
  const out = await analizarBuffers(bpPdf, modeloXlsx);

  // Descartar análisis previos de este proyecto (re-entrega / re-análisis).
  await supabaseAdmin.from('aol_analisis').update({ estado: 'descartado' }).eq('proyecto_plataforma_id', proyectoId).eq('estado', 'sugerencia');

  const { data: ins, error } = await supabaseAdmin.from('aol_analisis').insert({
    proyecto_plataforma_id: proyectoId,
    cohorte_codigo: cohorteId,
    bp_pdf_hash: out.bp_pdf_hash,
    modelo_xlsx_hash: out.modelo_xlsx_hash,
    quick_screen: out.quick,
    resultado: out.resultado ?? { bloqueado: true, compuertas: out.quick.compuertas_bloqueantes },
    version_cerebro: out.version_cerebro,
    estado: 'sugerencia',
  }).select('id').maybeSingle();
  if (error) throw new Error('AOL_ANALISIS_DB: ' + error.message);

  return { analisis_id: (ins as any)?.id ?? null, quick: out.quick, bloqueado: out.resultado === null };
}
