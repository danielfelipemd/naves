import { config } from '../config.js';

// =====================================================================
// Cliente multimodal de Claude para el pipeline de contenido de NAVES.
// Reusa el MISMO patrón que services/ai.ts (fetch nativo, x-api-key +
// anthropic-version, modelo de config), pero añade dos cosas que aquel
// no soporta y que el Comentario 12 de QA necesita:
//   1. Adjuntar el ONE-PAGER real como bloque `document` (PDF) o `image`
//      (png/jpg/webp) para que Claude lo lea, incluidas sus imágenes.
//   2. Salida estructurada {resumen, linkedin} forzada por json_schema
//      (vía tool use con tool_choice), en vez de parsear prosa.
// No introduce ningún SDK nuevo: es el mismo fetch a /v1/messages.
// =====================================================================

export type OnePagerKind = 'pdf' | 'imagen';

export interface OnePagerDoc {
  kind: OnePagerKind;
  /** MIME real: application/pdf | image/png | image/jpeg | image/webp */
  mediaType: string;
  /** Contenido del archivo en base64 (sin prefijo data:). */
  base64: string;
}

export interface ContenidoIA {
  resumen: string;
  linkedin: string;
}

// json_schema de la salida: exactamente las dos piezas que se guardan en
// proyecto_contenido (resumen, linkedin). Se fuerza con tool_choice.
const HERRAMIENTA = 'entregar_contenido';
const INPUT_SCHEMA = {
  type: 'object' as const,
  properties: {
    resumen: {
      type: 'string',
      description: 'El RESUMEN del proyecto en exactamente 2 frases, según el estilo indicado. Sin hashtags, sin autores, sin emojis.',
    },
    linkedin: {
      type: 'string',
      description: 'El POST de LinkedIn completo (autores + proyecto, cierre aspiracional y hashtags fijos al final), según el estilo indicado.',
    },
  },
  required: ['resumen', 'linkedin'],
  additionalProperties: false,
};

/**
 * Genera {resumen, linkedin} con Claude leyendo el one-pager real si se
 * adjunta (`documento`), o solo el texto de respaldo (`instruccion`) si no
 * lo hay. La salida viene forzada por json_schema (tool use).
 */
export async function generarContenidoOnePager(opts: {
  system: string;
  instruccion: string;
  documento?: OnePagerDoc | null;
  maxTokens?: number;
}): Promise<ContenidoIA> {
  if (!config.anthropic.apiKey) throw new Error('IA_NO_CONFIGURADA');

  const content: any[] = [];
  if (opts.documento) {
    const src = { type: 'base64', media_type: opts.documento.mediaType, data: opts.documento.base64 };
    content.push(
      opts.documento.kind === 'pdf'
        ? { type: 'document', source: src }
        : { type: 'image', source: src },
    );
  }
  content.push({ type: 'text', text: opts.instruccion });

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': config.anthropic.apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: config.anthropic.model,
      max_tokens: opts.maxTokens ?? 1500,
      system: opts.system,
      tools: [{
        name: HERRAMIENTA,
        description: 'Entrega el resumen y el post de LinkedIn ya redactados según el estilo pedido.',
        input_schema: INPUT_SCHEMA,
      }],
      tool_choice: { type: 'tool', name: HERRAMIENTA },
      messages: [{ role: 'user', content }],
    }),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`IA_ERROR ${resp.status}: ${body.slice(0, 300)}`);
  }
  const data = (await resp.json()) as any;
  const bloque = (data?.content ?? []).find((b: any) => b.type === 'tool_use' && b.name === HERRAMIENTA);
  const input = bloque?.input;
  if (!input || typeof input !== 'object') throw new Error('IA_RESPUESTA_VACIA');
  return {
    resumen: (input.resumen ?? '').toString().trim(),
    linkedin: (input.linkedin ?? '').toString().trim(),
  };
}
