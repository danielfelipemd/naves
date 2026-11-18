import sharp from 'sharp';

// La IA (Anthropic) rechaza imágenes de más de 5 MB o de más de 8000 px por lado, y de
// todos modos reduce todo lo que pase de unos 1568 px. Un One Pager subido como foto gigante
// (Kryotec: 8,6 MB, 7000 × 3938) hacía fallar la generación con IA_ERROR 400.
// Aquí se achica a 2000 px por el lado largo y se recomprime: la IA lo lee igual.

const LADO_MAXIMO = 2000;
const BYTES_MAXIMOS = 3_500_000; // margen bajo los 5 MB (en base64 crece un tercio)

export async function achicarImagenParaIA(buf: Buffer, mediaType: string): Promise<{ buf: Buffer; mediaType: string }> {
  const meta = await sharp(buf, { failOn: 'none' }).metadata();
  const lado = Math.max(meta.width ?? 0, meta.height ?? 0);
  if (lado <= LADO_MAXIMO && buf.length <= BYTES_MAXIMOS) return { buf, mediaType };
  const salida = await sharp(buf, { failOn: 'none' })
    .rotate() // respeta la orientación EXIF de las fotos de celular
    .resize({ width: LADO_MAXIMO, height: LADO_MAXIMO, fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' }) // PNG con transparencia → fondo blanco
    .jpeg({ quality: 85, mozjpeg: true })
    .toBuffer();
  return { buf: salida, mediaType: 'image/jpeg' };
}
