// Qué formato se acepta en cada carga, y la comprobación que se hace ANTES de
// subir, para que el usuario no espere a que suba un archivo de 20 MB y le
// digan después que no era el formato.
//
// Es la copia de backend/src/lib/formato-archivo.ts, que es quien decide de
// verdad (aquí cualquiera puede saltarse la comprobación). Si se cambia una
// regla allí, cambiarla aquí también.

export type Formato = 'pdf' | 'png' | 'jpg' | 'webp' | 'xlsx' | 'xls';

const INFO: Record<Formato, { mimes: string[]; extensiones: string[] }> = {
  pdf: { mimes: ['application/pdf'], extensiones: ['pdf'] },
  png: { mimes: ['image/png'], extensiones: ['png'] },
  jpg: { mimes: ['image/jpeg'], extensiones: ['jpg', 'jpeg'] },
  webp: { mimes: ['image/webp'], extensiones: ['webp'] },
  xlsx: { mimes: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'], extensiones: ['xlsx'] },
  xls: { mimes: ['application/vnd.ms-excel'], extensiones: ['xls'] },
};

export interface ReglaFormato {
  formatos: Formato[];
  /** Cómo se le nombra al usuario lo que sí se acepta. */
  descripcion: string;
  /** Qué hacer si trae el formato de al lado (p. ej. un .xls donde va .xlsx). */
  sugerencia?: { siExtension: string[]; texto: string };
}

export const FORMATOS = {
  documentoPdf: { formatos: ['pdf'], descripcion: 'PDF' },
  onePager: { formatos: ['pdf', 'png', 'jpg', 'webp'], descripcion: 'PDF o imagen (PNG, JPG o WebP)' },
  logo: { formatos: ['png', 'jpg', 'webp'], descripcion: 'imagen PNG, JPG o WebP' },
  modeloFinanciero: { formatos: ['xlsx', 'xls'], descripcion: 'Excel (.xlsx o .xls)' },
  cargaExcel: {
    formatos: ['xlsx'],
    descripcion: 'Excel (.xlsx)',
    sugerencia: {
      siExtension: ['xls'],
      texto: 'Ábrelo en Excel y guárdalo como «Libro de Excel (.xlsx)».',
    },
  },
  firma: { formatos: ['png', 'jpg'], descripcion: 'imagen PNG o JPG' },
} satisfies Record<string, ReglaFormato>;

/** Valor para el atributo `accept` del input: filtra el selector de archivos. */
export function acceptDe(regla: ReglaFormato): string {
  return regla.formatos
    .flatMap((f) => [...INFO[f].extensiones.map((e) => `.${e}`), ...INFO[f].mimes])
    .join(',');
}

function extensionDe(nombre: string): string {
  const partes = nombre.toLowerCase().split('.');
  return partes.length > 1 ? partes[partes.length - 1] : '';
}

/**
 * Qué familia de archivo es por sus primeros bytes. Un .xlsx y un .docx son
 * los dos un ZIP y aquí no se distinguen: eso lo hace el servidor.
 */
function familiaPorContenido(b: Uint8Array): 'pdf' | 'png' | 'jpg' | 'webp' | 'zip' | 'ole' | null {
  const empieza = (...firma: number[]) => firma.every((x, i) => b[i] === x);
  const ascii = (desde: number, hasta: number) => String.fromCharCode(...b.slice(desde, hasta));
  if (empieza(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'png';
  if (empieza(0xff, 0xd8, 0xff)) return 'jpg';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'webp';
  if (empieza(0x50, 0x4b, 0x03, 0x04)) return 'zip';
  if (empieza(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1)) return 'ole';
  // La norma del PDF admite basura antes de la cabecera, dentro del primer KB.
  if (ascii(0, b.length).includes('%PDF-')) return 'pdf';
  return null;
}

const FAMILIA: Record<Formato, ReturnType<typeof familiaPorContenido>> = {
  pdf: 'pdf', png: 'png', jpg: 'jpg', webp: 'webp', xlsx: 'zip', xls: 'ole',
};

/**
 * Revisa un archivo elegido por el usuario. Devuelve el mensaje que hay que
 * mostrarle, o null si el formato vale.
 *
 * Ante la duda deja pasar: si no se puede leer el archivo aquí, decide el
 * servidor, que también comprueba el contenido.
 */
export async function revisarFormato(file: File, regla: ReglaFormato): Promise<string | null> {
  const ext = extensionDe(file.name);
  const quien = `«${file.name}»`;
  const extPermitida = regla.formatos.some((f) => INFO[f].extensiones.includes(ext));
  if (!extPermitida) {
    return `Este no es el formato correcto: aquí solo se acepta ${regla.descripcion}`
      + `${ext ? ` y ${quien} es un archivo .${ext}` : ''}.`
      + (regla.sugerencia?.siExtension.includes(ext) ? ` ${regla.sugerencia.texto}` : '');
  }
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.slice(0, 1024).arrayBuffer());
  } catch {
    return null;
  }
  const familia = familiaPorContenido(bytes);
  if (regla.formatos.some((f) => FAMILIA[f] === familia)) return null;
  // La extensión es de las permitidas pero el contenido no: casi siempre es un
  // archivo al que se le cambió el nombre a mano.
  return `Este no es el formato correcto: ${quien} se llama .${ext}, pero por dentro no lo es. `
    + `Ábrelo en el programa en que se hizo y guárdalo o expórtalo como ${regla.descripcion}.`;
}
