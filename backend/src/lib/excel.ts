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

/** Genera un workbook con una sola hoja, headers en fila 1 + filas de ejemplo. */
export async function buildTemplateXlsx(
  sheetName: string,
  headers: string[],
  exampleRows: string[][],
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName);
  ws.addRow(headers);
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE30613' } };
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  for (const r of exampleRows) ws.addRow(r);
  ws.columns.forEach((col, i) => {
    const h = headers[i] ?? '';
    col.width = Math.max(h.length + 4, 22);
  });
  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}

export { ExcelJS };
