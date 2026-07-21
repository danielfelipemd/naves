// Función de diagnóstico temporal: prueba si Netlify puede escribir en JSONbin
const https = require('https');

const RESULTS_BIN = "6a302c5ada38895dfec4c6fa";
const BIN_KEY = "$2a$10$qBXsMcldU3zo7WzTazFhWeOrAvogSvSHw7bvSUBGWonD7zbLdj9hG";

exports.handler = async () => {
  const H = { 'content-type': 'application/json' };

  // 1) GET
  const getRes = await new Promise((resolve) => {
    const req = https.request(
      { hostname: 'api.jsonbin.io', path: `/v3/b/${RESULTS_BIN}/latest`, method: 'GET',
        headers: { 'X-Master-Key': BIN_KEY } },
      res => { let r = ''; res.on('data', c => r += c); res.on('end', () => resolve({ status: res.statusCode, body: r })); }
    );
    req.on('error', e => resolve({ error: String(e) }));
    req.end();
  });

  // 2) PUT
  const putBody = JSON.stringify({ jobs: { test_diagnostico: { ok: true, ts: Date.now() } } });
  const putRes = await new Promise((resolve) => {
    const req = https.request(
      { hostname: 'api.jsonbin.io', path: `/v3/b/${RESULTS_BIN}`, method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-Master-Key': BIN_KEY, 'Content-Length': Buffer.byteLength(putBody) } },
      res => { let r = ''; res.on('data', c => r += c); res.on('end', () => resolve({ status: res.statusCode, body: r })); }
    );
    req.on('error', e => resolve({ error: String(e) }));
    req.write(putBody);
    req.end();
  });

  return {
    statusCode: 200,
    headers: H,
    body: JSON.stringify({ get: getRes, put: putRes, node_version: process.version })
  };
};
