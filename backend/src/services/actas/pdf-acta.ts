import PDFDocument from 'pdfkit';

// =====================================================================
// PDF del Acta de Entrega de Trabajo de Grado (Formato MBA · Versión 3).
//
// Réplica del acta que se ve en pantalla, más una página de certificado con
// la cadena de firmas. Es el documento que la asistente imprime y archiva en
// papel, así que se mantiene a una página cuando cabe.
// =====================================================================

const ROJO = '#e30613';
const GRIS = '#6b6b6b';
const TEXTO = '#1a1a1a';
const LINEA = '#e8e8e8';
const MARGEN = 50;

export interface FirmaActa {
  rol: string;
  nombre: string | null;
  estado: string;
  firmada_en?: string | null;
  fecha?: string | null;
  // Sello de integridad (ver servicio de firma): permite verificar que el
  // acta no se alteró después de firmarse.
  hash?: string | null;
  sello?: string | null;
  ip?: string | null;
}

export interface ActaPdfData {
  id: number | string;
  modalidad: string;
  nombre_participante: string | null;
  nombre_proyecto: string | null;
  fecha_sustentacion: string | null;
  lugar: string | null;
  director_nombre: string | null;
  jurados: Array<{ nombre?: string } | string>;
  nota: string | null;
  observaciones: string | null;
  director_mba_nombre: string | null;
  director_mba_cargo: string | null;
  firmas: FirmaActa[];
}

const MODALIDADES: Array<[string, string]> = [
  ['business_plan', 'Business Plan'],
  ['caso', 'Caso'],
  ['proyecto_investigacion', 'Proyecto de Investigación'],
];

function fmtFecha(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('es-CO', { day: '2-digit', month: 'long', year: 'numeric' });
}

function fmtFechaHora(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' });
}

function nombreJurado(j: { nombre?: string } | string): string {
  return typeof j === 'string' ? j : (j?.nombre ?? '—');
}

/** Campo con su etiqueta encima y una línea debajo, como el formato en papel. */
function campo(doc: PDFKit.PDFDocument, etiqueta: string, valor: string, x: number, ancho: number) {
  const y = doc.y;
  doc.fontSize(7).fillColor(GRIS).font('Helvetica-Bold')
    .text(etiqueta.toUpperCase(), x, y, { characterSpacing: 0.8, width: ancho });
  doc.fontSize(10).fillColor(TEXTO).font('Helvetica')
    .text(valor || '—', x, doc.y + 1, { width: ancho });
  const yLinea = doc.y + 2;
  doc.moveTo(x, yLinea).lineTo(x + ancho, yLinea).strokeColor(LINEA).lineWidth(0.5).stroke();
  doc.y = yLinea + 8;
  doc.x = x;
}

/** Marca de firma al lado derecho de un campo. */
function marcaFirma(doc: PDFKit.PDFDocument, f: FirmaActa | undefined, yRef: number, anchoUtil: number) {
  if (!f || f.estado !== 'firmada') return;
  const txt = `✓ Firmada · ${fmtFechaHora(f.firmada_en ?? f.fecha)}`;
  doc.fontSize(7).fillColor('#15803d').font('Helvetica-Bold')
    .text(txt, MARGEN, yRef, { width: anchoUtil, align: 'right' });
}

/**
 * Pinta el acta en la página actual. Compartido por el PDF individual y por el
 * lote: así el documento que firma el profesor y el que imprime la asistente
 * son exactamente el mismo.
 */
function pintarActa(doc: PDFKit.PDFDocument, a: ActaPdfData) {
  const ancho = doc.page.width - MARGEN * 2;
  const firmaDe = (...roles: string[]) =>
    a.firmas?.find((f) => roles.some((r) => (f.rol ?? '').toLowerCase().includes(r)));

  // --- Encabezado institucional -------------------------------------
  doc.rect(0, 0, doc.page.width, 4).fill(ROJO);
  doc.fillColor(TEXTO).font('Helvetica-Bold').fontSize(9)
    .text('INALDE BUSINESS SCHOOL', MARGEN, 28, { characterSpacing: 1.5 });
  doc.fillColor(GRIS).font('Helvetica').fontSize(7)
    .text('Proceso Ejecución de Programas · Formato de Acta Proyecto de Grado MBA · Versión 3', MARGEN, doc.y + 2);
  doc.moveTo(MARGEN, doc.y + 6).lineTo(doc.page.width - MARGEN, doc.y + 6).strokeColor(ROJO).lineWidth(2).stroke();

  doc.y += 18;
  doc.fillColor(TEXTO).font('Helvetica-Bold').fontSize(13)
    .text('ACTA DE ENTREGA DE TRABAJO DE GRADO', MARGEN, doc.y, { width: ancho, align: 'center', characterSpacing: 0.5 });
  doc.y += 14;

  // --- Modalidad (casilla marcada) ----------------------------------
  let x = MARGEN + 40;
  const yMod = doc.y;
  for (const [key, label] of MODALIDADES) {
    const marcada = a.modalidad === key;
    doc.rect(x, yMod, 9, 9).strokeColor(marcada ? ROJO : LINEA).lineWidth(1).stroke();
    if (marcada) doc.fillColor(ROJO).font('Helvetica-Bold').fontSize(8).text('X', x + 2, yMod + 1);
    doc.fillColor(marcada ? TEXTO : GRIS).font(marcada ? 'Helvetica-Bold' : 'Helvetica').fontSize(8)
      .text(label, x + 13, yMod + 1);
    x += 13 + doc.widthOfString(label) + 26;
  }
  doc.y = yMod + 22;
  doc.x = MARGEN;

  // --- Fecha y lugar (dos columnas) ---------------------------------
  const mitad = (ancho - 20) / 2;
  const yFL = doc.y;
  campo(doc, 'Fecha de sustentación', fmtFecha(a.fecha_sustentacion), MARGEN, mitad);
  const yTrasFecha = doc.y;
  doc.y = yFL;
  campo(doc, 'Lugar', a.lugar || 'INALDE Business School', MARGEN + mitad + 20, mitad);
  doc.y = Math.max(yTrasFecha, doc.y);
  doc.x = MARGEN;

  // --- Participante (con su marca de firma) -------------------------
  const yPart = doc.y;
  campo(doc, 'Nombre del participante', a.nombre_participante || '—', MARGEN, ancho);
  marcaFirma(doc, firmaDe('participante'), yPart + 9, ancho);

  campo(doc, 'Nombre del proyecto', a.nombre_proyecto || '—', MARGEN, ancho);

  const yDir = doc.y;
  campo(doc, 'Director del proyecto', a.director_nombre || '—', MARGEN, ancho);
  marcaFirma(doc, firmaDe('director de proyecto', 'director_proyecto', 'profesor'), yDir + 9, ancho);

  // --- Sustentación / jurados ---------------------------------------
  doc.fontSize(7).fillColor(GRIS).font('Helvetica-Bold')
    .text('SUSTENTACIÓN', MARGEN, doc.y, { characterSpacing: 0.8 });
  doc.y += 2;
  if (a.modalidad === 'business_plan') {
    doc.fontSize(9).fillColor(GRIS).font('Helvetica-Oblique')
      .text('Business Plan — sin jurados.', MARGEN, doc.y, { width: ancho });
    doc.y += 8;
  } else if (!a.jurados?.length) {
    doc.fontSize(9).fillColor(ROJO).font('Helvetica')
      .text('Pendiente: aún no se han registrado los jurados.', MARGEN, doc.y, { width: ancho });
    doc.y += 8;
  } else {
    a.jurados.forEach((j, i) => {
      const n = nombreJurado(j);
      const yJ = doc.y;
      doc.fontSize(10).fillColor(TEXTO).font('Helvetica')
        .text(`Jurado ${i + 1}: ${n}`, MARGEN, yJ, { width: ancho });
      marcaFirma(doc, firmaDe(`jurado ${i + 1}`, n.toLowerCase()), yJ, ancho);
      const yl = doc.y + 2;
      doc.moveTo(MARGEN, yl).lineTo(MARGEN + ancho, yl).strokeColor(LINEA).lineWidth(0.5).stroke();
      doc.y = yl + 6;
    });
  }
  doc.y += 6;

  // --- Resultado -----------------------------------------------------
  doc.fontSize(7).fillColor(GRIS).font('Helvetica-Bold')
    .text('NOTA / RESULTADO', MARGEN, doc.y, { characterSpacing: 0.8 });
  const aceptado = a.nota === 'aceptado';
  doc.fontSize(11).fillColor(a.nota ? (aceptado ? '#15803d' : ROJO) : GRIS).font('Helvetica-Bold')
    .text(a.nota ? (aceptado ? 'ACEPTADO' : 'RECHAZADO') : '—', MARGEN, doc.y + 2, { characterSpacing: 1 });
  doc.y += 10;

  // --- Observaciones --------------------------------------------------
  doc.fontSize(7).fillColor(GRIS).font('Helvetica-Bold')
    .text('OBSERVACIONES', MARGEN, doc.y, { characterSpacing: 0.8 });
  doc.fontSize(9).fillColor(TEXTO).font('Helvetica')
    .text(a.observaciones || '—', MARGEN, doc.y + 2, { width: ancho, align: 'justify' });
  doc.y += 10;

  // --- Cierre: Director MBA ------------------------------------------
  const yMba = doc.y;
  doc.moveTo(MARGEN, yMba).lineTo(MARGEN + 240, yMba).strokeColor(TEXTO).lineWidth(0.8).stroke();
  doc.fontSize(9).fillColor(TEXTO).font('Helvetica-Bold')
    .text(a.director_mba_nombre || '—', MARGEN, yMba + 4);
  doc.fontSize(7).fillColor(GRIS).font('Helvetica')
    .text(a.director_mba_cargo || 'Director MBA', MARGEN, doc.y);
  marcaFirma(doc, firmaDe('director mba', 'director_mba', 'mba'), yMba + 4, ancho);

}

export function buildActaPDF(a: ActaPdfData): Promise<Buffer> {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: MARGEN, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));

    pintarActa(doc, a);

    const ancho = doc.page.width - MARGEN * 2;

    // --- Página de certificado de firmas -------------------------------
    // Va aparte para no robarle espacio al acta, que debe caber en una hoja.
    const conFirma = (a.firmas ?? []).filter((f) => f.estado === 'firmada');
    if (conFirma.length) {
      doc.addPage();
      doc.rect(0, 0, doc.page.width, 4).fill(ROJO);
      doc.fillColor(TEXTO).font('Helvetica-Bold').fontSize(11)
        .text('CERTIFICADO DE FIRMA ELECTRÓNICA', MARGEN, 34, { width: ancho, align: 'center' });
      doc.fontSize(7).fillColor(GRIS).font('Helvetica')
        .text(`Acta N.º ${a.id} · ${a.nombre_participante ?? ''}`, MARGEN, doc.y + 3, { width: ancho, align: 'center' });
      doc.y += 14;
      doc.fontSize(7.5).fillColor(GRIS).font('Helvetica')
        .text('Firma electrónica conforme a la Ley 527 de 1999 y el Decreto 2364 de 2012. '
            + 'Cada firma incorpora el código de la anterior: alterar cualquiera rompe la cadena y el sistema lo detecta.',
          MARGEN, doc.y, { width: ancho, align: 'justify' });
      doc.y += 10;

      for (const f of conFirma) {
        if (doc.y > doc.page.height - 110) doc.addPage();
        const yB = doc.y;
        doc.roundedRect(MARGEN, yB, ancho, 62, 3).strokeColor(LINEA).lineWidth(0.75).stroke();
        doc.fontSize(9).fillColor(TEXTO).font('Helvetica-Bold')
          .text(`${f.nombre ?? '—'}`, MARGEN + 10, yB + 8, { width: ancho - 20 });
        doc.fontSize(7).fillColor(GRIS).font('Helvetica')
          .text(`${f.rol.replace(/_/g, ' ')} · ${fmtFechaHora(f.firmada_en ?? f.fecha)}${f.ip ? ` · IP ${f.ip}` : ''}`,
            MARGEN + 10, doc.y + 1, { width: ancho - 20 });
        if (f.hash) {
          doc.fontSize(6).fillColor(GRIS).font('Courier')
            .text(`Código de verificación: ${f.hash}`, MARGEN + 10, doc.y + 3, { width: ancho - 20 });
        }
        doc.y = yB + 70;
      }
    }

    // --- Pie en todas las páginas --------------------------------------
    const rango = doc.bufferedPageRange();
    for (let i = 0; i < rango.count; i++) {
      doc.switchToPage(rango.start + i);
      doc.fontSize(7).fillColor(GRIS).font('Helvetica')
        .text(`INALDE Business School · Acta de Entrega de Trabajo de Grado · página ${i + 1} de ${rango.count}`,
          MARGEN, doc.page.height - 28,
          { align: 'center', width: doc.page.width - MARGEN * 2, lineBreak: false, height: 12 });
    }

    doc.end();
  });
}

/**
 * Varias actas en un solo PDF, una por página, para imprimir de una vez.
 *
 * Abre con una portada que dice qué contiene el lote: la carpeta física se
 * arma con esto, y sin portada nadie sabe qué hay dentro ni desde cuándo.
 */
export function buildLoteActasPDF(actas: ActaPdfData[]): Promise<Buffer> {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: MARGEN, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));

    const ancho = doc.page.width - MARGEN * 2;

    // --- Portada del lote ----------------------------------------------
    doc.rect(0, 0, doc.page.width, 4).fill(ROJO);
    doc.fillColor(TEXTO).font('Helvetica-Bold').fontSize(9)
      .text('INALDE BUSINESS SCHOOL', MARGEN, 34, { characterSpacing: 1.5 });
    doc.y += 40;
    doc.fillColor(TEXTO).font('Helvetica-Bold').fontSize(16)
      .text('ACTAS DE ENTREGA DE TRABAJO DE GRADO', MARGEN, doc.y, { width: ancho, align: 'center' });
    doc.y += 6;
    doc.fillColor(GRIS).font('Helvetica').fontSize(10)
      .text(`${actas.length} acta${actas.length === 1 ? '' : 's'} · firmadas y listas para archivar`,
        MARGEN, doc.y, { width: ancho, align: 'center' });
    doc.y += 4;
    doc.fillColor(GRIS).font('Helvetica').fontSize(8)
      .text(`Generado el ${new Date().toLocaleString('es-CO', { dateStyle: 'long', timeStyle: 'short' })}`,
        MARGEN, doc.y, { width: ancho, align: 'center' });

    doc.y += 24;
    doc.moveTo(MARGEN, doc.y).lineTo(doc.page.width - MARGEN, doc.y).strokeColor(LINEA).lineWidth(0.75).stroke();
    doc.y += 12;

    doc.fillColor(GRIS).font('Helvetica-Bold').fontSize(7)
      .text('CONTENIDO', MARGEN, doc.y, { characterSpacing: 1 });
    doc.y += 6;
    actas.forEach((a, i) => {
      if (doc.y > doc.page.height - 70) { doc.addPage(); doc.y = MARGEN; }
      doc.fillColor(TEXTO).font('Helvetica').fontSize(9)
        .text(`${i + 1}. ${a.nombre_participante ?? '—'}`, MARGEN, doc.y, { width: ancho - 120, continued: false });
      doc.fillColor(GRIS).fontSize(8)
        .text(`${a.nombre_proyecto ?? '—'}`, MARGEN + 14, doc.y, { width: ancho - 130 });
      doc.y += 3;
    });

    // --- Una página por acta -------------------------------------------
    for (const a of actas) {
      doc.addPage();
      pintarActa(doc, a);
    }

    // --- Pie con numeración global --------------------------------------
    const rango = doc.bufferedPageRange();
    for (let i = 0; i < rango.count; i++) {
      doc.switchToPage(rango.start + i);
      doc.fontSize(7).fillColor(GRIS).font('Helvetica')
        .text(`INALDE Business School · Actas de Entrega de Trabajo de Grado · página ${i + 1} de ${rango.count}`,
          MARGEN, doc.page.height - 28,
          { align: 'center', width: doc.page.width - MARGEN * 2, lineBreak: false, height: 12 });
    }

    doc.end();
  });
}
