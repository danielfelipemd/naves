import { config } from '../../config.js';
import { supabaseAdmin } from '../../db/supabase.js';

// =====================================================================
// AoL §7.4 — Juicio (JUZGAR) con Claude, salida estructurada.
//
// El cerebro se lee SIEMPRE de cerebro_documento (R5), nunca hardcodeado, y se
// cachea (cache_control ephemeral): es idéntico entre trabajos de una tanda.
// La salida se fuerza a esquema con tool-use forzado (equivalente de R3); junto
// con la verificación R1 (substring) hace imposible la evidencia inventada.
// =====================================================================

export interface Cerebro { version: string; calificador: string; aacsb: string; }

// R5: cargar el cerebro vigente de la base.
export async function cargarCerebro(): Promise<Cerebro> {
  const { data, error } = await supabaseAdmin
    .from('cerebro_documento').select('nombre, version, contenido_md').eq('vigente', true);
  if (error || !data?.length) throw new Error('Cerebro no disponible: ' + (error?.message ?? 'sin filas vigentes'));
  const doc = (n: string) => (data as any[]).find((d) => d.nombre === n);
  const cal = doc('cerebro-calificador-aol');
  const aacsb = doc('aacsb-2026-lenguaje-aol');
  if (!cal) throw new Error('Falta cerebro-calificador-aol vigente');
  return { version: cal.version, calificador: cal.contenido_md, aacsb: aacsb?.contenido_md ?? '' };
}

// Esquema de salida (§7.4). Se pasa como input_schema del tool forzado. El objeto
// `chequeo` se inlinea (sin $ref) por compatibilidad con la API de tools.
const CHEQUEO = {
  type: 'object', additionalProperties: false,
  required: ['chequeo', 'estado', 'evidencia', 'nota'],
  properties: {
    chequeo: { type: 'integer' },
    estado: { type: 'string', enum: ['OK', 'ALERTA', 'NO_VERIFICABLE'] },
    evidencia: { type: 'string' },
    nota: { type: 'string' },
  },
} as const;

const SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['traits', 'modelo_financiero', 'parrafo', 'total', 'on_standard'],
  properties: {
    traits: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['trait', 'puntaje', 'razon', 'evidencia', 'ubicacion', 'sugerencia', 'confianza'],
        properties: {
          trait: { type: 'integer', enum: [1, 2, 3, 4, 5, 6] },
          puntaje: { type: 'integer', enum: [1, 2, 3] },
          razon: { type: 'string' },
          evidencia: { type: 'string' },
          ubicacion: { type: 'string' },
          sugerencia: { type: 'string' },
          confianza: { type: 'string', enum: ['alta', 'media', 'baja'] },
        },
      },
    },
    modelo_financiero: {
      type: 'object', additionalProperties: false,
      required: ['interna', 'coherencia_bp'],
      properties: {
        interna: { type: 'array', items: CHEQUEO },
        coherencia_bp: { type: 'array', items: CHEQUEO },
      },
    },
    parrafo: { type: 'string' },
    total: { type: 'integer' },
    on_standard: { type: 'boolean' },
  },
} as const;

const HERRAMIENTA = 'entregar_calificacion';

export interface ResultadoJuicio {
  traits: Array<{ trait: number; puntaje: number; razon: string; evidencia: string; ubicacion: string; sugerencia: string; confianza: string }>;
  modelo_financiero: { interna: any[]; coherencia_bp: any[] };
  parrafo: string; total: number; on_standard: boolean;
}

export async function juzgar(
  cerebro: Cerebro,
  quick: unknown,
  paquetes: string,
  extractosExcel: string,
  reintentoCitas?: string[],
): Promise<ResultadoJuicio> {
  if (!config.anthropic.apiKey) throw new Error('IA_NO_CONFIGURADA');

  const instruccion =
`Califique este trabajo NAVES siguiendo EXACTAMENTE el cerebro del sistema (documento del system prompt, versión ${cerebro.version}).

REGLAS INQUEBRANTABLES:
- Solo puede usar lo que está en los extractos de abajo. Si algo no está, dígalo y baje el puntaje. NUNCA invente citas: cada campo "evidencia" debe ser una cita textual copiada carácter a carácter de los extractos.
- La "sugerencia" es obligatoria si el puntaje es 1 o 2 (cadena vacía "" si es 3).
- El "parrafo" sigue las reglas de la sección 7 del cerebro (5-8 frases, los 6 traits en orden, alertas del modelo financiero, cierre con total/18 y on/below standard, calificación siempre "sugerida").
${reintentoCitas?.length ? `\nSEGUNDA PASADA: estas evidencias NO se encontraron literalmente en los extractos y fueron rechazadas — rehágalas con una cita EXACTA del extracto o baje la confianza a "baja": ${reintentoCitas.join(', ')}.\n` : ''}
RESULTADO DEL QUICK SCREEN (determinístico, ya computado — no lo recalcule):
${JSON.stringify(quick)}

EXTRACTOS DEL BUSINESS PLAN POR TRAIT (con página de origen):
${paquetes}

EXTRACTOS DEL MODELO FINANCIERO (hoja!celda):
${extractosExcel}`;

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': config.anthropic.apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: config.anthropic.model,
      max_tokens: 16000,
      // El cerebro va SIEMPRE en contexto (R5) y se cachea entre trabajos.
      system: [{ type: 'text', text: cerebro.calificador, cache_control: { type: 'ephemeral' } }],
      tools: [{ name: HERRAMIENTA, description: 'Entrega la calificación estructurada del trabajo.', input_schema: SCHEMA }],
      tool_choice: { type: 'tool', name: HERRAMIENTA },
      messages: [{ role: 'user', content: instruccion }],
    }),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`IA_ERROR ${resp.status}: ${body.slice(0, 300)}`);
  }
  const data = (await resp.json()) as any;
  if (data?.stop_reason === 'refusal') throw new Error('Modelo declinó la solicitud');
  const bloque = (data?.content ?? []).find((b: any) => b.type === 'tool_use' && b.name === HERRAMIENTA);
  if (!bloque?.input) throw new Error('IA_RESPUESTA_VACIA');
  return bloque.input as ResultadoJuicio;
}
