import ExcelJS from 'exceljs';

/** Normaliza un header de Excel: sin acentos, lowercase, snake_case. */
export function normalizeHeaderKey(s: unknown): string {
  return String(s ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** Encuentra la columna (1-based) que coincida con alguno de los keys aceptados. */
export function findCol(header: string[], keys: Set<string>): number {
  for (let i = 0; i < header.length; i++) {
    if (keys.has(header[i])) return i + 1;
  }
  return -1;
}

/** Lee una celda y devuelve string limpio, manejando fórmulas y rich text. */
export function cellStr(row: ExcelJS.Row, col: number): string {
  if (col < 0) return '';
  const v: any = row.getCell(col).value;
  if (v == null) return '';
  if (typeof v === 'object' && 'text' in v) return String(v.text ?? '').trim();
  if (typeof v === 'object' && 'result' in v) return String(v.result ?? '').trim();
  if (typeof v === 'object' && 'richText' in v) {
    return ((v.richText as Array<{ text: string }>) ?? []).map((r) => r.text).join('').trim();
  }
  return String(v).trim();
}

/** "Si", "Sí", "True", "1", "X" → true. Cualquier otra cosa → false. */
export function cellBool(row: ExcelJS.Row, col: number): boolean {
  const s = cellStr(row, col).toLowerCase();
  return s === 'si' || s === 'sí' || s === 'true' || s === '1' || s === 'x' || s === 'verdadero';
}

/** Split por comas o punto-y-coma, trim, filtra vacíos. */
export function cellList(row: ExcelJS.Row, col: number): string[] {
  return cellStr(row, col)
    .split(/[,;]/).map((s) => s.trim()).filter(Boolean);
}

// ============================================================================
// Construcción de plantillas Excel profesionales
// ============================================================================

const INALDE_RED = 'FFE30613';
const INALDE_GRAY_BG = 'FFF6F6F6';
const INALDE_DARK = 'FF1A1A1A';

export interface ColumnDef {
  header: string;
  /** Ancho en caracteres */
  width?: number;
  /** Comentario para el header (texto de ayuda) */
  comment?: string;
  /** Si true, aparece como `Header *` y nota en instrucciones */
  required?: boolean;
  /** Activa dropdown con estos valores (lista corta directa) */
  dropdownValues?: string[];
  /** Activa dropdown con valores en un rango de otra hoja (lista larga) */
  dropdownRange?: { sheet: string; range: string };
}

export interface TemplateOpts {
  /** Nombre de la hoja principal */
  sheetName: string;
  /** Título grande arriba (rojo INALDE) */
  titulo: string;
  /** Subtítulo (gris) */
  subtitulo?: string;
  /** Columnas en orden */
  columns: ColumnDef[];
  /** Filas de ejemplo */
  exampleRows: Array<Array<string | undefined>>;
  /** Catálogos a publicar en hojas adicionales (sirven como rangos de dropdowns) */
  catalogos?: Array<{ sheet: string; titulo: string; valores: string[] }>;
  /** Texto de instrucciones (multi-línea) */
  instrucciones?: string[];
  /** Cuántas filas vacías dejar con formato + dropdowns listos */
  filasReservadas?: number;
}

export async function buildTemplateXlsx(opts: TemplateOpts): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'INALDE Business School';
  wb.created = new Date();

  // === 1) Hojas de catálogos (van primero para que existan al referenciarlas)
  for (const cat of opts.catalogos ?? []) {
    const cws = wb.addWorksheet(cat.sheet, { state: 'visible' });
    cws.addRow([cat.titulo]).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: INALDE_RED } };
    cws.getRow(1).alignment = { vertical: 'middle', horizontal: 'left' };
    for (const v of cat.valores) cws.addRow([v]);
    cws.getColumn(1).width = Math.max(28, cat.titulo.length + 6);
  }

  // === 2) Hoja de instrucciones (si hay)
  if (opts.instrucciones && opts.instrucciones.length > 0) {
    const iws = wb.addWorksheet('Instrucciones');
    iws.addRow([`Instrucciones — ${opts.titulo}`]).font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
    iws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: INALDE_RED } };
    iws.getRow(1).height = 26;
    iws.getRow(1).alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    iws.addRow([]);
    for (const line of opts.instrucciones) {
      const row = iws.addRow([line]);
      row.alignment = { wrapText: true, vertical: 'top' };
      row.font = { color: { argb: INALDE_DARK }, size: 11 };
    }
    iws.getColumn(1).width = 90;
  }

  // === 3) Hoja principal
  const ws = wb.addWorksheet(opts.sheetName, {
    views: [{ state: 'frozen', ySplit: 2, xSplit: 0 }],
  });

  // Fila 1: título de la hoja
  ws.mergeCells(1, 1, 1, opts.columns.length);
  const titleCell = ws.getCell(1, 1);
  titleCell.value = opts.subtitulo ? `${opts.titulo}  —  ${opts.subtitulo}` : opts.titulo;
  titleCell.font = { bold: true, size: 13, color: { argb: 'FFFFFFFF' } };
  titleCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: INALDE_RED } };
  ws.getRow(1).height = 28;

  // Fila 2: encabezados
  const headerLabels = opts.columns.map((c) => c.required ? `${c.header} *` : c.header);
  ws.addRow(headerLabels);
  const headerRow = ws.getRow(2);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
  headerRow.height = 22;
  headerRow.alignment = { vertical: 'middle', horizontal: 'left', indent: 1, wrapText: true };
  headerRow.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: INALDE_RED } };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFFFFFFF' } },
      bottom: { style: 'medium', color: { argb: INALDE_DARK } },
      left: { style: 'thin', color: { argb: 'FFFFFFFF' } },
      right: { style: 'thin', color: { argb: 'FFFFFFFF' } },
    };
  });

  // Comentarios en cabeceras (si los hay)
  opts.columns.forEach((c, idx) => {
    if (c.comment) {
      const cell = ws.getCell(2, idx + 1);
      cell.note = { texts: [{ text: c.comment }] };
    }
  });

  // Anchos de columna
  opts.columns.forEach((c, idx) => {
    ws.getColumn(idx + 1).width = c.width ?? Math.max(c.header.length + 8, 22);
  });

  // === 4) Filas de ejemplo
  const firstDataRow = 3;
  opts.exampleRows.forEach((row) => {
    const excelRow = ws.addRow(row);
    excelRow.height = 20;
    excelRow.eachCell({ includeEmpty: true }, (cell) => {
      cell.font = { italic: true, color: { argb: 'FF666666' }, size: 11 };
      cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      cell.border = {
        bottom: { style: 'thin', color: { argb: 'FFDDDDDD' } },
        right: { style: 'thin', color: { argb: 'FFDDDDDD' } },
      };
    });
  });
  // Resaltar suavemente las filas de ejemplo
  for (let r = firstDataRow; r < firstDataRow + opts.exampleRows.length; r++) {
    for (let c = 1; c <= opts.columns.length; c++) {
      ws.getCell(r, c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: INALDE_GRAY_BG } };
    }
  }

  // === 5) Filas reservadas en blanco (con dropdowns ya configurados)
  const totalRowsConDropdown = (opts.filasReservadas ?? 40) + opts.exampleRows.length;
  for (let r = firstDataRow + opts.exampleRows.length; r < firstDataRow + totalRowsConDropdown; r++) {
    for (let c = 1; c <= opts.columns.length; c++) {
      const cell = ws.getCell(r, c);
      cell.border = {
        bottom: { style: 'hair', color: { argb: 'FFEEEEEE' } },
        right: { style: 'hair', color: { argb: 'FFEEEEEE' } },
      };
      cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    }
  }

  // === 6) Data validations (dropdowns) en todo el rango
  opts.columns.forEach((c, idx) => {
    const colLetter = colNumberToLetter(idx + 1);
    if (c.dropdownValues && c.dropdownValues.length > 0) {
      // Lista corta inline
      const formula = `"${c.dropdownValues.join(',')}"`;
      for (let r = firstDataRow; r < firstDataRow + totalRowsConDropdown; r++) {
        ws.getCell(`${colLetter}${r}`).dataValidation = {
          type: 'list',
          allowBlank: true,
          formulae: [formula],
          showErrorMessage: true,
          errorTitle: 'Valor inválido',
          error: `Selecciona uno de los valores del menú desplegable.`,
        };
      }
    } else if (c.dropdownRange) {
      // Lista en rango (catálogo en otra hoja). ExcelJS NO espera el "=" inicial
      // (lo agrega internamente). Y siempre envolvemos el nombre de la hoja en
      // comillas simples — es el formato canónico de Excel para hojas con
      // espacios/acentos/guiones y no daña nombres simples.
      const ref = `'${c.dropdownRange.sheet}'!${c.dropdownRange.range}`;
      for (let r = firstDataRow; r < firstDataRow + totalRowsConDropdown; r++) {
        ws.getCell(`${colLetter}${r}`).dataValidation = {
          type: 'list',
          allowBlank: true,
          formulae: [ref],
          showErrorMessage: true,
          errorTitle: 'Valor inválido',
          error: `Selecciona uno de los valores del menú desplegable (catálogo en la hoja "${c.dropdownRange.sheet}").`,
        };
      }
    }
  });

  // === 7) AutoFilter en los encabezados
  ws.autoFilter = {
    from: { row: 2, column: 1 },
    to: { row: 2, column: opts.columns.length },
  };

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}

function colNumberToLetter(n: number): string {
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - m) / 26);
  }
  return s;
}

export { ExcelJS };
