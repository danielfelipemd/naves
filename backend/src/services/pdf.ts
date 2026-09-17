import PDFDocument from 'pdfkit';

// Maquetación. El contenido va sangrado bajo el número de sección; sin fijar
// esa sangría a mano, PDFKit la pierde en cada salto de página y la segunda
// hoja salía pegada al margen, con un aspecto distinto de la primera.
const MARGEN = 40;
const SANGRIA = 70;
// Aire entre el texto y el borde del recuadro de cada sección.
const PADDING = 8;

const INALDE_RED = '#e30613';
const INALDE_GOLD = '#9f885f';
const INALDE_GRAY = '#6b6b6b';
const INALDE_TEXT = '#1a1a1a';
const INALDE_BORDE = '#e8e8e8';

interface MiembroData {
  posicion: number;
  fue_emprendedor: boolean | null;
  perfil: string | null;
  participantes_lista: { nombre_completo: string };
}

interface ProyectoData {
  posicion: number;
  nombre: string;
  tipo: string | null;
  sector: string | null;
  ciiu: string | null;
  estado_seleccion: string;
  estado: string | null;
  canvas_cliente: string | null;
  canvas_problema: string | null;
  canvas_solucion: string | null;
  canvas_canales: string | null;
  canvas_relaciones: string | null;
  canvas_ingresos: string | null;
  canvas_recursos: string | null;
  canvas_actividades: string | null;
  canvas_socios: string | null;
  canvas_costos: string | null;
  fuentes_primarias: string | null;
  fuentes_secundarias: string | null;
  hitos: Array<{ posicion: number; descripcion: string; fecha_inicio: string; fecha_fin: string }>;
  // Contenido del proyecto definitivo (resumen y post de LinkedIn). Vive en
  // `proyecto_contenido`, aparte del Canvas, y hasta ahora no salía en el PDF:
  // un equipo que tenía resumen pero no había diligenciado el Canvas recibía un
  // documento en blanco.
  proyecto_contenido?: { resumen: string | null; linkedin: string | null } | Array<{ resumen: string | null; linkedin: string | null }> | null;
}

export interface AnteproyectoPdfData {
  estado: string;
  fecha_envio: string | null;
  equipos: {
    nombre_equipo: string | null;
    cohorte_id: string;
    miembros_equipo: MiembroData[];
  };
  proyectos: ProyectoData[];
}

function header(doc: PDFKit.PDFDocument, title: string, subtitle?: string) {
  doc.rect(0, 0, doc.page.width, 50).fill(INALDE_RED);
  doc.fillColor('white').font('Helvetica-Bold').fontSize(18).text('NAVES', 40, 18);
  doc.font('Helvetica').fontSize(9).text('INALDE Business School', 40, 36);
  doc.fillColor(INALDE_TEXT).font('Helvetica-Bold').fontSize(20).text(title, 40, 70);
  if (subtitle) {
    doc.fillColor(INALDE_GRAY).font('Helvetica').fontSize(10).text(subtitle, 40, 95);
  }
  doc.moveTo(40, subtitle ? 115 : 100).lineTo(doc.page.width - 40, subtitle ? 115 : 100).strokeColor(INALDE_RED).lineWidth(2).stroke();
  doc.moveDown();
  doc.x = SANGRIA;
  doc.y = subtitle ? 130 : 115;
  doc.fillColor(INALDE_TEXT);
}

/**
 * Salto de página que conserva la maquetación: repone la franja superior y
 * devuelve el cursor a la sangría del contenido. Usar SIEMPRE en vez de
 * `doc.addPage()` a secas.
 */
function nuevaPagina(doc: PDFKit.PDFDocument) {
  doc.addPage();
  doc.rect(0, 0, doc.page.width, 26).fill(INALDE_RED);
  doc.fillColor('white').font('Helvetica-Bold').fontSize(9).text('NAVES', MARGEN, 9);
  doc.fillColor(INALDE_TEXT);
  doc.x = SANGRIA;
  doc.y = 46;
}

/**
 * Recuadro alrededor de una sección.
 *
 * El marco NO se puede dibujar antes del contenido: no sabemos cuánto ocupará
 * ni en qué página terminará. Se abre guardando la posición, se escribe dentro
 * y al cerrar se dibuja el borde con la altura real. Si el contenido saltó de
 * página, se dibuja solo el tramo de la página donde empezó, así el recuadro
 * nunca deforma la maquetación ni deja un marco cruzando hojas.
 */
interface Recuadro { yInicio: number; paginaInicio: number }

function abrirRecuadro(doc: PDFKit.PDFDocument): Recuadro {
  doc.moveDown(0.3);
  return { yInicio: doc.y, paginaInicio: doc.bufferedPageRange().count };
}

function cerrarRecuadro(doc: PDFKit.PDFDocument, r: Recuadro) {
  const x = SANGRIA - PADDING;
  const ancho = doc.page.width - MARGEN - x;
  const yActual = doc.y;
  const mismaPagina = doc.bufferedPageRange().count === r.paginaInicio;

  if (mismaPagina) {
    const alto = yActual + PADDING - (r.yInicio - PADDING);
    if (alto > 0) {
      doc.save()
        .roundedRect(x, r.yInicio - PADDING, ancho, alto, 4)
        .strokeColor(INALDE_BORDE).lineWidth(0.75).stroke()
        .restore();
    }
  } else {
    // La sección se partió entre hojas: se enmarca el tramo de la página
    // actual, desde su cabecera hasta donde llegó el texto. El tramo de la
    // hoja anterior se queda sin cerrar por abajo, que es justo lo que
    // comunica la continuación.
    // Empieza bajo la franja NAVES (26 px) con aire, no pegado al borde.
    const yTope = 40;
    const alto = yActual + PADDING - yTope;
    if (alto > 0) {
      doc.save()
        .roundedRect(x, yTope, ancho, alto, 4)
        .strokeColor(INALDE_BORDE).lineWidth(0.75).stroke()
        .restore();
    }
  }

  // El cursor sigue donde terminó el texto: mover la y al pie de la página
  // forzaba un salto y el documento se llenaba de hojas a medias.
  doc.x = SANGRIA;
  doc.y = yActual + PADDING + 4;
}

function section(doc: PDFKit.PDFDocument, num: number | null, title: string) {
  if (doc.y > doc.page.height - 100) nuevaPagina(doc);
  doc.moveDown(0.5);
  if (num !== null) {
    const y = doc.y;
    doc.circle(50, y + 8, 9).fill(INALDE_RED);
    doc.fillColor('white').font('Helvetica-Bold').fontSize(10).text(String(num), 47, y + 4);
    doc.fillColor(INALDE_TEXT).font('Helvetica-Bold').fontSize(13).text(title, SANGRIA, y + 1);
  } else {
    doc.fillColor(INALDE_GOLD).font('Helvetica-Bold').fontSize(10).text(title.toUpperCase(), { characterSpacing: 1.5 });
  }
  doc.moveDown(0.4);
  doc.fillColor(INALDE_TEXT);
  // text(..., x, y) deja el cursor en esa x; sin esto las secciones numeradas
  // y las de subtítulo quedarían con sangrías distintas.
  doc.x = SANGRIA;
}

function field(doc: PDFKit.PDFDocument, label: string, value: string | null | undefined) {
  if (!value) return;
  if (doc.y > doc.page.height - 80) nuevaPagina(doc);
  const ancho = doc.page.width - SANGRIA - MARGEN;
  doc.x = SANGRIA;
  doc.fontSize(8).fillColor(INALDE_GRAY).font('Helvetica-Bold').text(label.toUpperCase(), { characterSpacing: 1, width: ancho });
  doc.x = SANGRIA;
  doc.fontSize(10).fillColor(INALDE_TEXT).font('Helvetica')
    .text(value, { width: ancho, align: 'justify' });
  doc.moveDown(0.4);
}

function footer(doc: PDFKit.PDFDocument) {
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    // El pie se dibuja DENTRO del margen inferior. Sin `lineBreak: false` +
    // `height`, PDFKit lo interpreta como texto que no cabe y añade una página
    // nueva por cada pie: el documento terminaba con tantas hojas en blanco
    // como páginas reales tenía.
    doc.fontSize(8).fillColor(INALDE_GRAY).font('Helvetica')
      .text(`NAVES — INALDE Business School · página ${i + 1} de ${range.count}`,
        MARGEN, doc.page.height - 28,
        { align: 'center', width: doc.page.width - MARGEN * 2, lineBreak: false, height: 12 });
  }
}

export function buildAnteproyectoPDF(data: AnteproyectoPdfData): Promise<Buffer> {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 40, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));

    // El equipo no tiene nombre propio: el título del PDF es el nombre del
    // proyecto (o de los proyectos, si hay varias ideas).
    const tituloAnte =
      data.equipos.nombre_equipo
      ?? (data.proyectos.map((p) => (p.nombre ?? '').trim()).filter(Boolean).join(' · ')
          || data.equipos.miembros_equipo
              .slice()
              .sort((a, b) => a.posicion - b.posicion)
              .map((m) => m.participantes_lista.nombre_completo)
              .join(' · ')
          || 'Anteproyecto');
    header(doc, tituloAnte,
      `Cohorte ${data.equipos.cohorte_id} · Estado: ${data.estado.toUpperCase()}` +
      (data.fecha_envio ? ` · Enviado: ${new Date(data.fecha_envio).toLocaleString('es-CO')}` : ''));

    section(doc, 1, 'Equipo emprendedor');
    for (const m of [...data.equipos.miembros_equipo].sort((a, b) => a.posicion - b.posicion)) {
      if (doc.y > doc.page.height - 80) nuevaPagina(doc);
      doc.x = SANGRIA;
      doc.fontSize(11).fillColor(INALDE_TEXT).font('Helvetica-Bold').text(`Miembro ${m.posicion}: ${m.participantes_lista.nombre_completo}`);
      const meta = [m.perfil, m.fue_emprendedor ? 'ya fue emprendedor' : 'sin experiencia previa'].filter(Boolean).join(' · ');
      doc.x = SANGRIA;
      doc.fontSize(9).fillColor(INALDE_GRAY).font('Helvetica').text(meta);
      doc.moveDown(0.3);
    }

    section(doc, 2, 'Proyectos');
    for (const p of [...data.proyectos].sort((a, b) => a.posicion - b.posicion)) {
      if (doc.y > doc.page.height - 200) nuevaPagina(doc);
      doc.moveDown(0.3);
      doc.x = SANGRIA;
      doc.fontSize(13).fillColor(INALDE_TEXT).font('Helvetica-Bold').text(`Proyecto ${p.posicion}: ${p.nombre}`);
      const tag = p.estado_seleccion === 'definitivo' ? 'DEFINITIVO'
                : p.estado_seleccion === 'archivado' ? 'ARCHIVADO' : 'pendiente';
      const tagColor = p.estado_seleccion === 'definitivo' ? INALDE_RED
                     : p.estado_seleccion === 'archivado' ? INALDE_GRAY : INALDE_GOLD;
      doc.x = SANGRIA;
      doc.fontSize(8).fillColor(tagColor).font('Helvetica-Bold').text(tag, { characterSpacing: 1 });
      doc.x = SANGRIA;
      doc.fontSize(9).fillColor(INALDE_GRAY).font('Helvetica')
        .text([p.tipo, p.sector, p.ciiu ? `CIIU ${p.ciiu}` : null, p.estado].filter(Boolean).join(' · '));
      doc.moveDown(0.4);

      // Resumen del proyecto definitivo: es lo primero que interesa leer.
      const cont = Array.isArray(p.proyecto_contenido) ? p.proyecto_contenido[0] : p.proyecto_contenido;
      if (cont?.resumen || cont?.linkedin) {
        const rRes = abrirRecuadro(doc);
        section(doc, null, 'Resumen del proyecto');
        field(doc, 'Resumen', cont?.resumen);
        field(doc, 'Publicación LinkedIn', cont?.linkedin);
        cerrarRecuadro(doc, rRes);
      }

      const canvasVacio = ![
        p.canvas_cliente, p.canvas_problema, p.canvas_solucion, p.canvas_canales,
        p.canvas_relaciones, p.canvas_ingresos, p.canvas_recursos,
        p.canvas_actividades, p.canvas_socios, p.canvas_costos,
      ].some((v) => (v ?? '').trim());

      const rCanvas = abrirRecuadro(doc);
      section(doc, null, 'Canvas del negocio');
      if (canvasVacio) {
        // Sin este aviso el PDF terminaba en un título y una página en blanco:
        // el lector no sabía si era un fallo del sistema o un formulario a medias.
        doc.x = SANGRIA;
        doc.fontSize(10).fillColor(INALDE_GRAY).font('Helvetica-Oblique')
          .text('El equipo todavía no ha diligenciado el Canvas del negocio en el formulario del anteproyecto.',
            { width: doc.page.width - SANGRIA - MARGEN });
        doc.font('Helvetica').moveDown(0.4);
      }
      field(doc, 'Cliente',            p.canvas_cliente);
      field(doc, 'Problema',           p.canvas_problema);
      field(doc, 'Solución',           p.canvas_solucion);
      field(doc, 'Canales',            p.canvas_canales);
      field(doc, 'Relaciones',         p.canvas_relaciones);
      field(doc, 'Ingresos',           p.canvas_ingresos);
      field(doc, 'Recursos',           p.canvas_recursos);
      field(doc, 'Actividades',        p.canvas_actividades);
      field(doc, 'Socios',             p.canvas_socios);
      field(doc, 'Costos',             p.canvas_costos);
      cerrarRecuadro(doc, rCanvas);

      if (p.fuentes_primarias || p.fuentes_secundarias) {
        const rVal = abrirRecuadro(doc);
        section(doc, null, 'Validación del mercado');
        field(doc, 'Fuentes primarias',   p.fuentes_primarias);
        field(doc, 'Fuentes secundarias', p.fuentes_secundarias);
        cerrarRecuadro(doc, rVal);
      }

      if (p.hitos?.length) {
        const rCron = abrirRecuadro(doc);
        section(doc, null, 'Cronograma');
        for (const h of [...p.hitos].sort((a, b) => a.posicion - b.posicion)) {
          if (doc.y > doc.page.height - 60) nuevaPagina(doc);
          doc.x = SANGRIA;
          doc.fontSize(9).fillColor(INALDE_TEXT).font('Helvetica')
            .text(`${h.posicion}. ${h.descripcion}`, { continued: true })
            // La flecha tipográfica no existe en Helvetica y PDFKit la sustituye
            // por un glifo roto; un guion largo se ve bien y comunica lo mismo.
            .fillColor(INALDE_GRAY).text(`  (${h.fecha_inicio} - ${h.fecha_fin})`);
        }
        cerrarRecuadro(doc, rCron);
      }
      doc.moveDown(0.6);
    }

    footer(doc);
    doc.end();
  });
}

export interface SabanaItem {
  equipo_id: string;
  equipo_nombre: string | null;
  proyecto_id: string;
  proyecto_nombre: string;
  sector: string | null;
  ciiu: string | null;
  tipo: string | null;
  estado_seleccion: string;
  resumen: string;
  miembros: Array<{ nombre: string; posicion: number }>;
}

export function buildSabanaPDF(cohorteId: string, items: SabanaItem[]): Promise<Buffer> {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ size: 'LETTER', layout: 'landscape', margin: 30, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));

    header(doc, `Anteproyectos de la cohorte`, `Cohorte ${cohorteId} · ${items.length} proyectos · Generado ${new Date().toLocaleString('es-CO')}`);

    // Agrupar por equipo
    const byTeam = items.reduce((acc, it) => {
      if (!acc[it.equipo_id]) acc[it.equipo_id] = { nombre: it.equipo_nombre, miembros: it.miembros, proyectos: [] };
      acc[it.equipo_id].proyectos.push(it);
      return acc;
    }, {} as Record<string, { nombre: string | null; miembros: SabanaItem['miembros']; proyectos: SabanaItem[] }>);

    for (const [, eq] of Object.entries(byTeam)) {
      if (doc.y > doc.page.height - 120) doc.addPage();
      doc.moveDown(0.3);
      doc.fontSize(12).fillColor(INALDE_TEXT).font('Helvetica-Bold').text(eq.nombre ?? '(equipo sin nombre)');
      doc.fontSize(9).fillColor(INALDE_GRAY).font('Helvetica')
        .text(eq.miembros.sort((a, b) => a.posicion - b.posicion).map((m) => m.nombre).join(' · '));
      doc.moveDown(0.3);

      for (const p of eq.proyectos) {
        if (doc.y > doc.page.height - 80) doc.addPage();
        const tagColor = p.estado_seleccion === 'definitivo' ? INALDE_RED
                       : p.estado_seleccion === 'archivado' ? INALDE_GRAY : INALDE_GOLD;
        doc.fontSize(10).fillColor(tagColor).font('Helvetica-Bold').text(`▸ ${p.proyecto_nombre}`, { continued: true });
        doc.fontSize(8).fillColor(INALDE_GRAY).font('Helvetica')
          .text(`  [${p.estado_seleccion}]${p.sector ? ' · ' + p.sector : ''}${p.ciiu ? ' · CIIU ' + p.ciiu : ''}`);
        if (p.resumen) {
          doc.fontSize(9).fillColor(INALDE_TEXT).font('Helvetica').text(p.resumen, { width: doc.page.width - 80, indent: 12 });
        }
        doc.moveDown(0.3);
      }
      doc.moveTo(30, doc.y).lineTo(doc.page.width - 30, doc.y).strokeColor('#e8e8e8').lineWidth(0.5).stroke();
      doc.moveDown(0.4);
    }

    footer(doc);
    doc.end();
  });
}
