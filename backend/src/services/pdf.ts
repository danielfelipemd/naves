import PDFDocument from 'pdfkit';

const INALDE_RED = '#e30613';
const INALDE_GOLD = '#9f885f';
const INALDE_GRAY = '#6b6b6b';
const INALDE_TEXT = '#1a1a1a';

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
  canvas_cliente_problema: string | null;
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
  doc.x = 40;
  doc.y = subtitle ? 130 : 115;
  doc.fillColor(INALDE_TEXT);
}

function section(doc: PDFKit.PDFDocument, num: number | null, title: string) {
  if (doc.y > doc.page.height - 100) doc.addPage();
  doc.moveDown(0.5);
  if (num !== null) {
    const y = doc.y;
    doc.circle(50, y + 8, 9).fill(INALDE_RED);
    doc.fillColor('white').font('Helvetica-Bold').fontSize(10).text(String(num), 47, y + 4);
    doc.fillColor(INALDE_TEXT).font('Helvetica-Bold').fontSize(13).text(title, 70, y + 1);
  } else {
    doc.fillColor(INALDE_GOLD).font('Helvetica-Bold').fontSize(10).text(title.toUpperCase(), { characterSpacing: 1.5 });
  }
  doc.moveDown(0.4);
  doc.fillColor(INALDE_TEXT);
}

function field(doc: PDFKit.PDFDocument, label: string, value: string | null | undefined) {
  if (!value) return;
  if (doc.y > doc.page.height - 80) doc.addPage();
  doc.fontSize(8).fillColor(INALDE_GRAY).font('Helvetica-Bold').text(label.toUpperCase(), { characterSpacing: 1 });
  doc.fontSize(10).fillColor(INALDE_TEXT).font('Helvetica').text(value, { width: doc.page.width - 80 });
  doc.moveDown(0.4);
}

function footer(doc: PDFKit.PDFDocument) {
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    doc.fontSize(8).fillColor(INALDE_GRAY).font('Helvetica')
      .text(`NAVES — INALDE Business School · página ${i + 1} de ${range.count}`,
        40, doc.page.height - 30, { align: 'center', width: doc.page.width - 80 });
  }
}

export function buildAnteproyectoPDF(data: AnteproyectoPdfData): Promise<Buffer> {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 40, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));

    header(doc, data.equipos.nombre_equipo ?? '(equipo sin nombre)',
      `Cohorte ${data.equipos.cohorte_id} · Estado: ${data.estado.toUpperCase()}` +
      (data.fecha_envio ? ` · Enviado: ${new Date(data.fecha_envio).toLocaleString('es-CO')}` : ''));

    section(doc, 1, 'Equipo emprendedor');
    for (const m of [...data.equipos.miembros_equipo].sort((a, b) => a.posicion - b.posicion)) {
      doc.fontSize(11).fillColor(INALDE_TEXT).font('Helvetica-Bold').text(`Miembro ${m.posicion}: ${m.participantes_lista.nombre_completo}`);
      const meta = [m.perfil, m.fue_emprendedor ? 'ya fue emprendedor' : 'sin experiencia previa'].filter(Boolean).join(' · ');
      doc.fontSize(9).fillColor(INALDE_GRAY).font('Helvetica').text(meta);
      doc.moveDown(0.3);
    }

    section(doc, 2, 'Proyectos');
    for (const p of [...data.proyectos].sort((a, b) => a.posicion - b.posicion)) {
      if (doc.y > doc.page.height - 200) doc.addPage();
      doc.moveDown(0.3);
      const yStart = doc.y;
      doc.fontSize(13).fillColor(INALDE_TEXT).font('Helvetica-Bold').text(`Proyecto ${p.posicion}: ${p.nombre}`);
      const tag = p.estado_seleccion === 'definitivo' ? 'DEFINITIVO'
                : p.estado_seleccion === 'archivado' ? 'ARCHIVADO' : 'pendiente';
      const tagColor = p.estado_seleccion === 'definitivo' ? INALDE_RED
                     : p.estado_seleccion === 'archivado' ? INALDE_GRAY : INALDE_GOLD;
      doc.fontSize(8).fillColor(tagColor).font('Helvetica-Bold').text(tag, { characterSpacing: 1 });
      doc.fontSize(9).fillColor(INALDE_GRAY).font('Helvetica')
        .text([p.tipo, p.sector, p.ciiu ? `CIIU ${p.ciiu}` : null, p.estado].filter(Boolean).join(' · '));
      doc.moveDown(0.4);

      section(doc, null, 'Canvas del negocio');
      field(doc, 'Cliente / problema', p.canvas_cliente_problema);
      field(doc, 'Canales',            p.canvas_canales);
      field(doc, 'Relaciones',         p.canvas_relaciones);
      field(doc, 'Ingresos',           p.canvas_ingresos);
      field(doc, 'Recursos',           p.canvas_recursos);
      field(doc, 'Actividades',        p.canvas_actividades);
      field(doc, 'Socios',             p.canvas_socios);
      field(doc, 'Costos',             p.canvas_costos);

      if (p.fuentes_primarias || p.fuentes_secundarias) {
        section(doc, null, 'Validación del mercado');
        field(doc, 'Fuentes primarias',   p.fuentes_primarias);
        field(doc, 'Fuentes secundarias', p.fuentes_secundarias);
      }

      if (p.hitos?.length) {
        section(doc, null, 'Cronograma');
        for (const h of [...p.hitos].sort((a, b) => a.posicion - b.posicion)) {
          if (doc.y > doc.page.height - 60) doc.addPage();
          doc.fontSize(9).fillColor(INALDE_TEXT).font('Helvetica')
            .text(`${h.posicion}. ${h.descripcion}`, { continued: true })
            .fillColor(INALDE_GRAY).text(`  (${h.fecha_inicio} → ${h.fecha_fin})`);
        }
      }
      doc.moveDown(0.6);
      void yStart;
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

    header(doc, `Sábana de proyectos`, `Cohorte ${cohorteId} · ${items.length} proyectos · Generado ${new Date().toLocaleString('es-CO')}`);

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
