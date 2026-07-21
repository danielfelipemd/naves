import { config } from '../../config.js';
import { supabaseAdmin } from '../../db/supabase.js';
import { cargarCerebro } from './juicio.js';

// =====================================================================
// AoL §9/§6 — "Lectura de impacto" (closing the loop): borrador IA editable que
// interpreta el efecto de las acciones del ciclo anterior sobre los resultados,
// con la tríada acción → trait/LO → delta. Mismas reglas del párrafo del cerebro:
// sin hechos nuevos, retrocesos sin suavizar; un retroceso sin acción previa se
// propone como intervención del siguiente ciclo. El profesor lo edita.
// =====================================================================

export async function generarLecturaImpacto(cohorteId: string): Promise<string> {
  if (!config.anthropic.apiKey) throw new Error('IA_NO_CONFIGURADA');

  const { data: coh } = await supabaseAdmin.from('cohortes').select('etiqueta').eq('id', cohorteId).maybeSingle();
  const etiqueta = (coh as any)?.etiqueta ?? cohorteId;
  const modalidad = /\bINT\b/i.test(etiqueta) ? 'INT' : 'FS';

  const cerebro = await cargarCerebro();
  const [{ data: acciones }, { data: hist }] = await Promise.all([
    supabaseAdmin.from('accion_mejora').select('anio, descripcion, lo_id, criterio_id, tipo').order('anio', { ascending: false }).limit(20),
    supabaseAdmin.from('v_resumen').select('cohorte, anio_medicion, criterio, lo, pct_on_standard').order('anio_medicion'),
  ]);

  // Deltas por trait entre las dos cohortes más recientes de la modalidad.
  const filas = (hist ?? []) as any[];
  const cohortesMod = [...new Set(filas.filter((r) => r.cohorte.startsWith(modalidad)).map((r) => r.cohorte))]
    .sort((a, b) => Number((b.match(/(\d{4})\s*-\s*(\d{4})/) ?? [])[2] ?? 0) - Number((a.match(/(\d{4})\s*-\s*(\d{4})/) ?? [])[2] ?? 0));
  const [ultima, previa] = cohortesMod;
  const porTrait = (c: string) => Object.fromEntries(filas.filter((r) => r.cohorte === c).map((r) => [r.criterio, Number(r.pct_on_standard)]));
  const u = ultima ? porTrait(ultima) : {}; const p = previa ? porTrait(previa) : {};
  const deltas = Object.keys(u).map((trait) => ({
    trait, ultima: u[trait], previa: p[trait] ?? null,
    delta: p[trait] != null ? Number((u[trait] - p[trait]).toFixed(1)) : null,
  }));

  const accionesTxt = ((acciones ?? []) as any[])
    .map((a) => `- [${a.anio} · ${a.tipo}${a.lo_id ? ` · LO${a.lo_id}${a.criterio_id ? `·T${a.criterio_id}` : ''}` : ''}] ${a.descripcion}`)
    .join('\n');
  const deltasTxt = deltas
    .map((d) => `- ${d.trait}: ${ultima}=${d.ultima}%${d.delta != null ? ` vs ${previa}=${d.previa}% → ${d.delta >= 0 ? '▲' : '▼'} ${Math.abs(d.delta)} pp` : ' (sin comparación)'}`)
    .join('\n');

  const system = [
    cerebro.calificador,
    '\n\nAhora actúas en el DASHBOARD (closing the loop), no calificando un trabajo.',
  ].join('');
  const instruccion =
`Redacta la LECTURA DE IMPACTO del ciclo anterior para la cohorte ${etiqueta} (modalidad ${modalidad}), en español de Colombia, RAE, tono sobrio y sin emojis.

REGLAS:
- Sigue la tríada: acción del período anterior → trait/LO afectado → delta observado (en puntos porcentuales).
- Usa SOLO los datos de abajo. No inventes cifras ni hechos nuevos.
- No suavices los retrocesos (▼). Si hay un retroceso en un trait SIN una acción previa que lo explique, proponlo como intervención para el siguiente ciclo.
- 4 a 7 frases. Cierra con una lectura general del competency goal.

ACCIONES DE MEJORA DEL PERÍODO ANTERIOR:
${accionesTxt || '(sin acciones registradas)'}

DELTAS POR TRAIT (última cohorte de la modalidad vs. la previa):
${deltasTxt || '(sin datos de comparación)'}`;

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': config.anthropic.apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: config.anthropic.model,
      max_tokens: 1200,
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: instruccion }],
    }),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`IA_ERROR ${resp.status}: ${body.slice(0, 200)}`);
  }
  const data = (await resp.json()) as any;
  const bloque = (data?.content ?? []).find((b: any) => b.type === 'text');
  return (bloque?.text ?? '').trim();
}
