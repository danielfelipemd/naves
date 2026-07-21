// Función síncrona: recibe el PDF en base64 desde el navegador,
// lo guarda en Netlify Blobs y devuelve la clave para que la función
// de fondo lo recupere sin necesidad de pasar el PDF completo en el body.

const { getStore } = require('@netlify/blobs');

exports.handler = async (event) => {
  const H = { 'content-type': 'application/json' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: H, body: '{}' };

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400, headers: H, body: JSON.stringify({ error: 'Body inválido' }) }; }

  const { jobId, pdf_base64 } = body;
  if (!jobId || !pdf_base64) return { statusCode: 400, headers: H, body: JSON.stringify({ error: 'Faltan jobId o pdf_base64' }) };

  try {
    const store = getStore('calendarios');
    const pdfBuffer = Buffer.from(pdf_base64, 'base64');
    const blobKey = `pdf_${jobId}`;
    await store.set(blobKey, pdfBuffer, { metadata: { jobId, uploadedAt: Date.now() } });
    return { statusCode: 200, headers: H, body: JSON.stringify({ ok: true, blobKey }) };
  } catch (e) {
    return { statusCode: 500, headers: H, body: JSON.stringify({ error: 'Error guardando PDF: ' + String(e) }) };
  }
};
