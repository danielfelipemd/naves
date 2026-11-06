// Qué formato tiene DE VERDAD un archivo subido, y si es uno de los que se
// aceptan en esa carga.
//
// No se decide por `req.file.mimetype`: ese tipo lo declara el navegador a
// partir de la extensión. Un Word renombrado a .pdf llega como
// application/pdf, y al revés, en un equipo sin Excel instalado un .xlsx bueno
// puede llegar como application/octet-stream. Se decide por la firma del
// archivo (sus primeros bytes), que no cambia al renombrarlo.
//
// Las reglas de cada carga se repiten en frontend/src/lib/formatos.ts para
// avisar antes de subir. Si se cambia una aquí, cambiarla allí también.

export type Formato = 'pdf' | 'png' | 'jpg' | 'webp' | 'xlsx' | 'xls';

const INFO: Record<Formato, { mime: string; extensiones: string[] }> = {
  pdf: { mime: 'application/pdf', extensiones: ['pdf'] },
  png: { mime: 'image/png', extensiones: ['png'] },
  jpg: { mime: 'image/jpeg', extensiones: ['jpg', 'jpeg'] },
  webp: { mime: 'image/webp', extensiones: ['webp'] },
  xlsx: { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', extensiones: ['xlsx'] },
  xls: { mime: 'application/vnd.ms-excel', extensiones: ['xls'] },
};

export interface ReglaFormato {
  formatos: Formato[];
  /** Cómo se le nombra al usuario lo que sí se acepta. */
  descripcion: string;
  /** Qué hacer si trae el formato de al lado (p. ej. un .xls donde va .xlsx). */
  sugerencia?: { siExtension: string[]; texto: string };
}

export type NombreRegla = 'documentoPdf' | 'onePager' | 'logo' | 'modeloFinanciero' | 'cargaExcel' | 'firma';

export const REGLAS: Record<NombreRegla, ReglaFormato> = {
  // Anteproyecto, avance y proyecto final: un Word se ve distinto en cada
  // equipo que lo abre, así que no sirve como versión de entrega.
  documentoPdf: { formatos: ['pdf'], descripcion: 'PDF' },
  onePager: { formatos: ['pdf', 'png', 'jpg', 'webp'], descripcion: 'PDF o imagen (PNG, JPG o WebP)' },
  logo: { formatos: ['png', 'jpg', 'webp'], descripcion: 'imagen PNG, JPG o WebP' },
  // El modelo editable, no una foto ni un PDF de él. Se guarda tal cual, así
  // que el .xls antiguo también sirve.
  modeloFinanciero: { formatos: ['xlsx', 'xls'], descripcion: 'Excel (.xlsx o .xls)' },
  // Las cargas masivas las lee exceljs, que solo entiende .xlsx.
  cargaExcel: {
    formatos: ['xlsx'],
    descripcion: 'Excel (.xlsx)',
    sugerencia: {
      siExtension: ['xls'],
      texto: 'Ábrelo en Excel y guárdalo como «Libro de Excel (.xlsx)».',
    },
  },
  // PDFKit, que imprime el acta, solo pinta PNG y JPG: cualquier otra imagen
  // dejaba el acta firmada sin el trazo.
  firma: { formatos: ['png', 'jpg'], descripcion: 'imagen PNG o JPG' },
};

const PDF = Buffer.from('%PDF-');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPG = Buffer.from([0xff, 0xd8, 0xff]);
const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const OLE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
// Un .xlsx es un ZIP como un .docx: lo distingue tener el libro dentro.
const LIBRO_XLSX = Buffer.from('xl/workbook');
// Un .xls es un contenedor OLE como un .doc: lo distingue su flujo «Workbook»
// (o «Book» en los muy antiguos), cuyo nombre va en UTF-16.
const LIBRO_XLS = [Buffer.from('Workbook', 'utf16le'), Buffer.from('Book', 'utf16le')];

function empiezaCon(buf: Buffer, firma: Buffer): boolean {
  return buf.length >= firma.length && buf.subarray(0, firma.length).equals(firma);
}

/** El formato real del archivo, o null si no es ninguno de los conocidos. */
export function detectarFormato(buf: Buffer): Formato | null {
  // Primero las firmas que van al principio exacto: son inequívocas.
  if (empiezaCon(buf, PNG)) return 'png';
  if (empiezaCon(buf, JPG)) return 'jpg';
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  if (empiezaCon(buf, ZIP)) return buf.includes(LIBRO_XLSX) ? 'xlsx' : null;   // un .docx o un .zip no
  if (empiezaCon(buf, OLE)) return LIBRO_XLS.some((n) => buf.includes(n)) ? 'xls' : null;   // un .doc no
  // La norma del PDF admite basura antes de la cabecera, dentro del primer KB.
  if (buf.subarray(0, 1024).includes(PDF)) return 'pdf';
  return null;
}

function extensionDe(nombre: string): string {
  const partes = nombre.toLowerCase().split('.');
  return partes.length > 1 ? partes[partes.length - 1] : '';
}

/** El mensaje que ve el usuario cuando el archivo no es del formato pedido. */
export function mensajeFormatoNoValido(regla: ReglaFormato, nombre: string): string {
  const ext = extensionDe(nombre);
  const quien = nombre ? `«${nombre}»` : 'El archivo';
  // La extensión es de las permitidas pero el contenido no: casi siempre es un
  // archivo al que se le cambió el nombre a mano.
  const extPermitida = regla.formatos.some((f) => INFO[f].extensiones.includes(ext));
  if (extPermitida) {
    return `Este no es el formato correcto: ${quien} se llama .${ext}, pero por dentro no lo es. `
      + `Ábrelo en el programa en que se hizo y guárdalo o expórtalo como ${regla.descripcion}.`;
  }
  return `Este no es el formato correcto: aquí solo se acepta ${regla.descripcion}`
    + `${ext ? ` y ${quien} es un archivo .${ext}` : ''}.`
    + (regla.sugerencia?.siExtension.includes(ext) ? ` ${regla.sugerencia.texto}` : '');
}

export type ResultadoFormato =
  | { ok: true; formato: Formato; mime: string }
  | { ok: false; mensaje: string };

/**
 * Comprueba un archivo recibido por multer contra la regla de su carga.
 * Si vale, devuelve el tipo canónico, que es el que hay que guardar (no el que
 * declaró el navegador).
 */
export function validarFormato(
  archivo: { buffer: Buffer; originalname?: string },
  regla: ReglaFormato,
): ResultadoFormato {
  const formato = detectarFormato(archivo.buffer);
  if (formato && regla.formatos.includes(formato)) return { ok: true, formato, mime: INFO[formato].mime };
  return { ok: false, mensaje: mensajeFormatoNoValido(regla, archivo.originalname ?? '') };
}

/** El cuerpo del 400 que se responde cuando el formato no vale. */
export function errorFormato(mensaje: string, regla: ReglaFormato) {
  return { error: 'FORMATO_NO_VALIDO', mensaje, permitidos: regla.formatos };
}

/**
 * Las firmas viajan como data URL dentro del JSON, no como archivo. Se comprueba
 * que lo que dice ser una imagen PNG o JPG lo sea de verdad.
 * Devuelve el mensaje de error, o null si vale.
 */
export function validarFirmaImagen(dataUrl: string): string | null {
  const m = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl);
  const formato = m ? detectarFormato(Buffer.from(m[2].slice(0, 64), 'base64')) : null;
  if (formato && REGLAS.firma.formatos.includes(formato)) return null;
  return `Este no es el formato correcto: la firma tiene que ser una ${REGLAS.firma.descripcion}.`;
}
