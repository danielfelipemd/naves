// FUNCIÓN DE FONDO: recibe el PDF en base64 en el body, lo procesa con Claude OPUS
// y guarda el resultado en JSONbin. La página consulta el resultado con resultado-calendario.
// Usa el módulo https nativo de Node (no depende de fetch).

const https = require('https');

const RESULTS_BIN = "6a302c5ada38895dfec4c6fa";
const BIN_KEY = "$2a$10$qBXsMcldU3zo7WzTazFhWeOrAvogSvSHw7bvSUBGWonD7zbLdj9hG";

function httpsRequest(hostname, path, method, headers, bodyStr) {
  return new Promise((resolve, reject) => {
    const opts = { hostname, path, method, headers: { ...headers } };
    if (bodyStr) opts.headers['Content-Length'] = Buffer.byteLength(bodyStr);
    const req = https.request(opts, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => resolve({ status: res.statusCode, body: raw }));
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

async function guardarResultado(jobId, payload) {
  try {
    const r = await httpsRequest('api.jsonbin.io', `/v3/b/${RESULTS_BIN}/latest`, 'GET', { 'X-Master-Key': BIN_KEY });
    const j = JSON.parse(r.body);
    const jobs = (j.record && j.record.jobs) ? j.record.jobs : {};
    jobs[jobId] = { ...payload, ts: Date.now() };
    const keys = Object.keys(jobs).sort((a, b) => (jobs[a].ts || 0) - (jobs[b].ts || 0));
    while (keys.length > 20) { delete jobs[keys.shift()]; }
    await httpsRequest('api.jsonbin.io', `/v3/b/${RESULTS_BIN}`, 'PUT',
      { 'Content-Type': 'application/json', 'X-Master-Key': BIN_KEY },
      JSON.stringify({ jobs }));
  } catch (e) { /* sin store, el polling expirará */ }
}

exports.handler = async (event) => {
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { body = {}; }
  const { jobId, pdf_base64, tipo, asistente, director } = body;
  if (!jobId || !pdf_base64) return { statusCode: 400 };

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    await guardarResultado(jobId, { ok: false, error: 'Falta ANTHROPIC_API_KEY en Netlify.' });
    return { statusCode: 202 };
  }

  const schema = {
    type: "object",
    properties: {
      tipo_detectado: { type: "string", enum: ["Intensivo", "Fin de Semana", "Desconocido"] },
      anio: { type: "string" },
      jornadas_clase: { type: "array", items: { type: "string" } },
      festivos: { type: "array", items: { type: "object", properties: { fecha: { type: "string" }, nombre: { type: "string" } }, required: ["fecha", "nombre"], additionalProperties: false } },
      semana_santa_lunes: { type: "string" },
      presentaciones: { type: "array", items: { type: "string" } },
      grado: { type: "string" },
      eventos: { type: "array", items: { type: "object", properties: { fecha: { type: "string" }, descripcion: { type: "string" } }, required: ["fecha", "descripcion"], additionalProperties: false } },
      notas: { type: "string" }
    },
    required: ["tipo_detectado", "anio", "jornadas_clase", "festivos", "semana_santa_lunes", "presentaciones", "grado", "eventos", "notas"],
    additionalProperties: false
  };

  const prompt = `Eres el asistente de coordinación del programa NAVES del Executive MBA de INALDE Business School.
Te paso el calendario académico de una cohorte (PDF con cuadrículas de meses y una leyenda de colores). El PDF puede contener VARIOS AÑOS — fíjate bien en a qué año pertenece cada mes.

Lee la LEYENDA del calendario para entender los colores (suele incluir: jornada regular de clase, día feriado nacional, tiempo exclusivo de trabajo de grado, Semana Internacional, Presentación NAVES, Grado, finalización de cuatrimestre).

Modalidades del MBA:
- "Fin de Semana": jornadas de clase en VIERNES y SÁBADOS; presentaciones NAVES en JUNIO.
- "Intensivo": jornadas de clase en LUNES, MARTES y MIÉRCOLES; presentaciones NAVES en NOVIEMBRE.

Extrae en formato ISO "YYYY-MM-DD", prestando MUCHA atención al AÑO correcto de cada celda:
1. tipo_detectado: modalidad según los días de clase.
2. anio: el año en que se hace el trabajo de grado y las presentaciones NAVES.
3. jornadas_clase: TODAS las fechas marcadas como jornada de clase. Sé exhaustivo.
4. festivos: fechas de feriado nacional con su nombre.
5. semana_santa_lunes: el lunes de la Semana Santa del año del trabajo de grado.
6. presentaciones: fechas marcadas explícitamente como "Presentación NAVES".
7. grado: la fecha marcada como "Grado".
8. eventos: otros eventos con etiqueta de texto explícita.
9. notas: ambigüedades o cosas a confirmar.

Reporta SOLO lo que está realmente marcado/escrito. Verifica el año de cada fecha contra el encabezado del bloque del calendario.${tipo ? ` El usuario indica modalidad: ${tipo}.` : ""}`;

  const requestBody = JSON.stringify({
    model: "claude-opus-4-8",
    max_tokens: 4096,
    tools: [{ name: "extraer_calendario", description: "Extrae toda la información estructurada del calendario académico del PDF.", input_schema: schema }],
    tool_choice: { type: "tool", name: "extraer_calendario" },
    messages: [{
      role: "user",
      content: [
        { type: "document", source: { type: "base64", media_type: "application/pdf", data: pdf_base64 } },
        { type: "text", text: prompt }
      ]
    }]
  });

  try {
    const resp = await httpsRequest('api.anthropic.com', '/v1/messages', 'POST', {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
      'anthropic-beta': 'pdfs-2024-09-25'
    }, requestBody);

    const data = JSON.parse(resp.body);
    if (resp.status !== 200) {
      const msg = (data && data.error && data.error.message) || `Error HTTP ${resp.status} de Claude`;
      await guardarResultado(jobId, { ok: false, error: msg });
      return { statusCode: 202 };
    }

    const toolBlock = (data.content || []).find(b => b.type === "tool_use");
    const datos = toolBlock ? toolBlock.input : {};
    await guardarResultado(jobId, { ok: true, datos, asistente: asistente || null, director: director || null, usage: data.usage || null });

  } catch (e) {
    await guardarResultado(jobId, { ok: false, error: 'Fallo al contactar la API: ' + String(e) });
  }

  return { statusCode: 202 };
};
