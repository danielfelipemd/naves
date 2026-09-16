import PDFDocument from 'pdfkit';
import fs from 'node:fs';
import path from 'node:path';

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
const FONDO = '#f7f7f7';
const ORO = '#9f885f';

// El logo va empaquetado con el backend (ver Dockerfile). Se lee una sola vez:
// el mismo PDF se genera decenas de veces al imprimir un lote.
let logoCache: Buffer | null | undefined;
function logo(): Buffer | null {
  if (logoCache !== undefined) return logoCache;
  for (const ruta of [
    path.resolve(process.cwd(), 'assets/inalde-logo.jpg'),
    path.resolve(process.cwd(), '../assets/inalde-logo.jpg'),
  ]) {
    try { logoCache = fs.readFileSync(ruta); return logoCache; } catch { /* siguiente */ }
  }
  // Sin logo el acta sigue siendo válida: se imprime igual, solo sin la marca.
  logoCache = null;
  return null;
}
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
  /** Trazo de la firma en data URI, para estamparlo sobre la línea. */
  imagen?: string | null;
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
  estado?: string | null;
  anulada_motivo?: string | null;
  anulada_en?: string | null;
}

/**
 * Marca de agua "ANULADA" cruzada sobre el acta. Se pinta AL FINAL, encima de
 * todo, para que una copia impresa antes de la anulación no pueda pasar por
 * válida. El motivo va al pie: quien la tenga en la mano sabe por qué.
 */
function marcaAgua(doc: PDFKit.PDFDocument, motivo?: string | null) {
  const { width: W, height: H } = doc.page;
  doc.save();
  doc.rotate(-32, { origin: [W / 2, H / 2] });
  doc.font('Helvetica-Bold').fontSize(94).fillColor('#e30613').opacity(0.16)
    .text('ANULADA', 0, H / 2 - 62, { width: W, align: 'center', characterSpacing: 5 });
  doc.restore();

  doc.save().opacity(1);
  doc.font('Helvetica-Bold').fontSize(8).fillColor('#e30613')
    .text(`ACTA ANULADA${motivo ? ` · ${motivo}` : ''}`, MARGEN, H - 62,
      { width: W - MARGEN * 2, align: 'center' });
  doc.restore();
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

/** Título de sección con banda de fondo: separa visualmente los bloques. */
function seccion(doc: PDFKit.PDFDocument, titulo: string) {
  const ancho = doc.page.width - MARGEN * 2;
  const y = doc.y;
  doc.rect(MARGEN, y, ancho, 15).fill(FONDO);
  doc.rect(MARGEN, y, 2.5, 15).fill(ROJO);
  doc.fillColor(TEXTO).font('Helvetica-Bold').fontSize(7.5)
    .text(titulo.toUpperCase(), MARGEN + 9, y + 4.5, { characterSpacing: 1.2, width: ancho - 18 });
  doc.y = y + 21;
  doc.x = MARGEN;
}

/** Bloque de firma: línea, nombre y cargo. Si está firmada, estampa el trazo. */
function bloqueFirma(
  doc: PDFKit.PDFDocument, x: number, anchoB: number,
  nombre: string | null, cargo: string | null, f?: FirmaActa,
) {
  const yTop = doc.y;
  // Espacio para el trazo, encima de la línea.
  if (f?.estado === 'firmada' && f.imagen && f.imagen.startsWith('data:image')) {
    try {
      const b64 = f.imagen.split(',')[1] ?? '';
      doc.image(Buffer.from(b64, 'base64'), x + 4, yTop, { fit: [anchoB - 8, 26], align: 'center' });
    } catch { /* una firma ilegible no debe impedir imprimir el acta */ }
  }
  const yLinea = yTop + 30;
  doc.moveTo(x, yLinea).lineTo(x + anchoB, yLinea).strokeColor(TEXTO).lineWidth(0.8).stroke();
  doc.fontSize(8.5).fillColor(TEXTO).font('Helvetica-Bold')
    .text(nombre || '—', x, yLinea + 4, { width: anchoB });
  if (cargo) {
    doc.fontSize(6.5).fillColor(GRIS).font('Helvetica')
      .text(cargo, x, doc.y, { width: anchoB });
  }
  if (f?.estado === 'firmada') {
    doc.fontSize(6).fillColor('#15803d').font('Helvetica')
      .text(`Firmada electrónicamente · ${fmtFechaHora(f.firmada_en ?? f.fecha)}`, x, doc.y + 1, { width: anchoB });
  }
  doc.x = MARGEN;
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
  const img = logo();
  if (img) {
    try { doc.image(img, MARGEN, 26, { fit: [96, 34] }); } catch { /* seguir sin logo */ }
  }
  const xTexto = img ? MARGEN + 108 : MARGEN;
  doc.fillColor(TEXTO).font('Helvetica-Bold').fontSize(9)
    .text('INALDE BUSINESS SCHOOL', xTexto, 30, { characterSpacing: 1.4 });
  doc.fillColor(GRIS).font('Helvetica').fontSize(6.5)
    .text('Universidad de La Sabana', xTexto, doc.y + 1);
  doc.fillColor(GRIS).font('Helvetica').fontSize(6.5)
    .text('Proceso Ejecución de Programas · Formato de Acta Proyecto de Grado MBA · Versión 3',
      xTexto, doc.y + 1);

  doc.moveTo(MARGEN, 68).lineTo(doc.page.width - MARGEN, 68).strokeColor(ROJO).lineWidth(2).stroke();

  // --- Título --------------------------------------------------------
  doc.y = 82;
  doc.fillColor(ORO).font('Helvetica-Bold').fontSize(7)
    .text('TRABAJO DE GRADO · MBA', MARGEN, doc.y, { width: ancho, align: 'center', characterSpacing: 2 });
  doc.fillColor(TEXTO).font('Helvetica-Bold').fontSize(14)
    .text('ACTA DE ENTREGA DE TRABAJO DE GRADO', MARGEN, doc.y + 3, { width: ancho, align: 'center' });
  doc.y += 16;

  // --- Modalidad -----------------------------------------------------
  seccion(doc, 'Modalidad de trabajo de grado');
  let x = MARGEN + 6;
  const yMod = doc.y;
  for (const [key, label] of MODALIDADES) {
    const marcada = a.modalidad === key;
    doc.rect(x, yMod, 9, 9).lineWidth(marcada ? 1.4 : 0.8).strokeColor(marcada ? ROJO : '#bdbdbd').stroke();
    if (marcada) doc.fillColor(ROJO).font('Helvetica-Bold').fontSize(8).text('X', x + 2.2, yMod + 1.2);
    doc.fillColor(marcada ? TEXTO : GRIS).font(marcada ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5)
      .text(label, x + 14, yMod + 1);
    x += 14 + doc.widthOfString(label) + 30;
  }
  doc.y = yMod + 20;
  doc.x = MARGEN;

  // --- Datos de la sustentación --------------------------------------
  seccion(doc, 'Datos de la sustentación');
  const mitad = (ancho - 24) / 2;
  const yFL = doc.y;
  campo(doc, 'Fecha de sustentación', fmtFecha(a.fecha_sustentacion), MARGEN, mitad);
  const yTrasFecha = doc.y;
  doc.y = yFL;
  campo(doc, 'Lugar', a.lugar || 'INALDE Business School', MARGEN + mitad + 24, mitad);
  doc.y = Math.max(yTrasFecha, doc.y);
  doc.x = MARGEN;

  campo(doc, 'Nombre del participante', a.nombre_participante || '—', MARGEN, ancho);
  campo(doc, 'Nombre del proyecto', a.nombre_proyecto || '—', MARGEN, ancho);

  // --- Tribunal ------------------------------------------------------
  seccion(doc, a.modalidad === 'business_plan' ? 'Evaluación' : 'Tribunal evaluador');
  campo(doc, a.modalidad === 'business_plan' ? 'Profesor NAVES' : 'Director del proyecto',
    a.director_nombre || '—', MARGEN, ancho);

  if (a.modalidad !== 'business_plan') {
    if (!a.jurados?.length) {
      doc.fontSize(8.5).fillColor(ROJO).font('Helvetica-Oblique')
        .text('Pendiente: aún no se han registrado los jurados.', MARGEN, doc.y, { width: ancho });
      doc.y += 10;
    } else {
      a.jurados.forEach((j, i) => campo(doc, `Jurado ${i + 1}`, nombreJurado(j), MARGEN, ancho));
    }
  }

  // --- Resultado ------------------------------------------------------
  seccion(doc, 'Resultado de la sustentación');
  const aceptado = a.nota === 'aceptado';
  const yR = doc.y;
  if (a.nota) {
    const etiqueta = aceptado ? 'ACEPTADO' : 'RECHAZADO';
    const anchoCaja = doc.widthOfString(etiqueta) + 26;
    doc.roundedRect(MARGEN, yR, anchoCaja, 20, 3)
      .fillAndStroke(aceptado ? '#f0fdf4' : '#fef2f2', aceptado ? '#15803d' : ROJO);
    doc.fillColor(aceptado ? '#15803d' : ROJO).font('Helvetica-Bold').fontSize(10)
      .text(etiqueta, MARGEN + 13, yR + 6, { characterSpacing: 1 });
  } else {
    doc.fillColor(GRIS).font('Helvetica-Oblique').fontSize(9)
      .text('Pendiente de registrar', MARGEN, yR + 4);
  }
  doc.y = yR + 28;
  doc.x = MARGEN;

  campo(doc, 'Observaciones', a.observaciones || 'Sin observaciones.', MARGEN, ancho);

  // --- Firmas ---------------------------------------------------------
  // Van al pie, como en el formato en papel: es lo último que se completa.
  const firmasEnActa: Array<[string, string | null, string | null, FirmaActa | undefined]> = [
    ['participante', a.nombre_participante, 'Participante · autor del trabajo de grado', firmaDe('participante')],
  ];
  if (a.modalidad === 'business_plan') {
    firmasEnActa.push(['profesor', a.director_nombre, 'Profesor NAVES', firmaDe('profesor')]);
  } else {
    firmasEnActa.push(['director_proyecto', a.director_nombre, 'Director del proyecto', firmaDe('director de proyecto', 'director_proyecto')]);
    (a.jurados ?? []).forEach((j, i) => {
      const n = nombreJurado(j);
      firmasEnActa.push([`jurado_${i}`, n, `Jurado ${i + 1}`, firmaDe(`jurado ${i + 1}`, n.toLowerCase())]);
    });
  }
  firmasEnActa.push(['director_mba', a.director_mba_nombre, a.director_mba_cargo || 'Director de Cohorte', firmaDe('director mba', 'director_mba')]);

  // Las firmas siguen al contenido en vez de anclarse al pie: empujarlas abajo
  // dejaba media hoja en blanco en las actas cortas (Business Plan).
  doc.y += 10;
  seccion(doc, 'Firmas');

  const anchoF = (ancho - 24) / 2;
  for (let i = 0; i < firmasEnActa.length; i += 2) {
    const yFila = doc.y;
    const [, n1, c1, f1] = firmasEnActa[i];
    bloqueFirma(doc, MARGEN, anchoF, n1, c1, f1);
    const yTras1 = doc.y;
    if (firmasEnActa[i + 1]) {
      doc.y = yFila;
      const [, n2, c2, f2] = firmasEnActa[i + 1];
      bloqueFirma(doc, MARGEN + anchoF + 24, anchoF, n2, c2, f2);
    }
    doc.y = Math.max(yTras1, doc.y) + 12;
  }
}

export function buildActaPDF(a: ActaPdfData): Promise<Buffer> {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: MARGEN, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));

    pintarActa(doc, a);
    // Encima del acta, antes de añadir la página de certificado.
    if (a.estado === 'anulada') marcaAgua(doc, a.anulada_motivo);

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
      if (a.estado === 'anulada') marcaAgua(doc, a.anulada_motivo);
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
