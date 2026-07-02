import { config } from '../config.js';

// Cliente mínimo de Anthropic vía fetch nativo (sin SDK), mismo patrón que la
// función Netlify del prototipo (§5 de la doc técnica): x-api-key +
// anthropic-version. Devuelve el texto de la respuesta.

export function iaConfigurada(): boolean {
  return !!config.anthropic.apiKey;
}

interface ClaudeOpts { system?: string; maxTokens?: number; }

export async function llamarClaude(prompt: string, opts: ClaudeOpts = {}): Promise<string> {
  if (!config.anthropic.apiKey) throw new Error('IA_NO_CONFIGURADA');
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': config.anthropic.apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: config.anthropic.model,
      max_tokens: opts.maxTokens ?? 1024,
      ...(opts.system ? { system: opts.system } : {}),
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`IA_ERROR ${resp.status}: ${body.slice(0, 300)}`);
  }
  const data = (await resp.json()) as any;
  const text = (data?.content ?? []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('').trim();
  if (!text) throw new Error('IA_RESPUESTA_VACIA');
  return text;
}

// Extrae el primer objeto JSON de un texto (por si el modelo lo envuelve en prosa
// o en un bloque ```json).
export function extraerJSON(texto: string): any {
  const limpio = texto.replace(/```json\s*/gi, '').replace(/```/g, '').trim();
  try { return JSON.parse(limpio); } catch { /* buscar llaves */ }
  const i = limpio.indexOf('{'), j = limpio.lastIndexOf('}');
  if (i >= 0 && j > i) return JSON.parse(limpio.slice(i, j + 1));
  throw new Error('IA_JSON_INVALIDO');
}
