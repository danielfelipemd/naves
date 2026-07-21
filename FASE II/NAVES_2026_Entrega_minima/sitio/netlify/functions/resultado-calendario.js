// Función síncrona rápida: devuelve el resultado de una extracción por jobId.
// La página la consulta cada pocos segundos hasta que el estado sea "listo".

const RESULTS_BIN = "6a302c5ada38895dfec4c6fa";
const BIN_KEY = "$2a$10$qBXsMcldU3zo7WzTazFhWeOrAvogSvSHw7bvSUBGWonD7zbLdj9hG";
const BIN_URL = `https://api.jsonbin.io/v3/b/${RESULTS_BIN}`;

exports.handler = async (event) => {
  const H = { "content-type": "application/json" };
  const jobId = (event.queryStringParameters || {}).job;
  if (!jobId) return { statusCode: 400, headers: H, body: JSON.stringify({ error: "Falta el parámetro job" }) };
  try {
    const r = await fetch(BIN_URL + "/latest", { headers: { "X-Master-Key": BIN_KEY } });
    const j = await r.json();
    const job = (j.record && j.record.jobs && j.record.jobs[jobId]) || null;
    if (!job) return { statusCode: 200, headers: H, body: JSON.stringify({ estado: "pendiente" }) };
    return { statusCode: 200, headers: H, body: JSON.stringify({ estado: "listo", ...job }) };
  } catch (e) {
    return { statusCode: 502, headers: H, body: JSON.stringify({ error: "No se pudo leer el resultado: " + String(e) }) };
  }
};
