import { supabaseAdmin } from '../../db/supabase.js';
import { resolverCohorte, generarReporteWord, generarReporteExcel } from './export.js';

// =====================================================================
// AoL §12 — Archivo permanente del paquete por cohorte.
//
// Al cerrar la medición, el sistema deja el paquete completo en la carpeta de
// AoL (OneDrive vía Microsoft Graph). El paquete tiene 3 archivos:
//   1. Reporte AoL {cohorte}.docx        (generarReporteWord)
//   2. {cohorte} DATOS BRUTOS.xlsx       (generarReporteExcel)
//   3. {cohorte} trazabilidad.json       (versión cerebro/rúbrica, hashes,
//                                         autor y fecha de cada firma — R8)
//
// Si faltan credenciales de Graph o Graph falla: NO revienta — devuelve los 3
// buffers con via:'descarga' para que el frontend los ofrezca (fallback §12).
// Usa fetch nativo (Node 18+), sin SDK de Microsoft.
// =====================================================================

export interface ResultadoArchivo {
  archivado: boolean;
  via: 'onedrive' | 'descarga';
  detalle: string;
  archivos: { nombre: string; buffer: Buffer }[];
}

// --- Trazabilidad (R8): versión + hashes + firmas del ciclo -----------
async function construirTrazabilidad(cohorteId: string, codigoAol: string, etiqueta: string): Promise<Buffer> {
  const [{ data: califs }, { data: analisis }] = await Promise.all([
    supabaseAdmin.from('aol_calificacion')
      .select('proyecto_plataforma_id, autor, firmado_en, version_cerebro, version_rubrica, total, on_standard')
      .eq('cohorte_codigo', codigoAol),
    supabaseAdmin.from('aol_analisis')
      .select('proyecto_plataforma_id, bp_pdf_hash, modelo_xlsx_hash, version_cerebro, estado')
      .eq('cohorte_codigo', codigoAol),
  ]);
  const califList = (califs ?? []) as any[];
  const analisisList = (analisis ?? []) as any[];

  const versionCerebro = califList[0]?.version_cerebro ?? analisisList[0]?.version_cerebro ?? 'v1.0';
  const versionRubrica = califList[0]?.version_rubrica ?? 'v1.0';

  // Hashes de los archivos evaluados por proyecto (del análisis vigente).
  const hashesPorProyecto = analisisList.map((a) => ({
    proyecto_plataforma_id: a.proyecto_plataforma_id,
    bp_pdf_hash: a.bp_pdf_hash ?? null,
    modelo_xlsx_hash: a.modelo_xlsx_hash ?? null,
    estado_analisis: a.estado ?? null,
  }));

  // Firma por calificación (autor + fecha).
  const firmas = califList.map((c) => ({
    proyecto_plataforma_id: c.proyecto_plataforma_id,
    autor: c.autor ?? null,
    firmado_en: c.firmado_en ?? null,
    total: c.total ?? null,
    on_standard: c.on_standard ?? null,
  }));

  const traza = {
    cohorte: { id: cohorteId, etiqueta, codigo_aol: codigoAol },
    version_cerebro: versionCerebro,
    version_rubrica: versionRubrica,
    generado_en: new Date().toISOString(),
    hashes_archivos_evaluados: hashesPorProyecto,
    firmas,
  };
  return Buffer.from(JSON.stringify(traza, null, 2), 'utf-8');
}

// --- Token client_credentials de Microsoft Graph ----------------------
async function obtenerTokenGraph(tenant: string, clientId: string, clientSecret: string): Promise<string> {
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  });
  const resp = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!resp.ok) {
    const t = await resp.text().catch(() => '');
    throw new Error(`GRAPH_TOKEN ${resp.status}: ${t.slice(0, 200)}`);
  }
  const data = (await resp.json()) as any;
  if (!data?.access_token) throw new Error('GRAPH_TOKEN sin access_token');
  return data.access_token as string;
}

// --- Sube un archivo al OneDrive del usuario (PUT .../content) ---------
async function subirArchivo(token: string, user: string, ruta: string, buffer: Buffer): Promise<void> {
  const encoded = ruta.split('/').map(encodeURIComponent).join('/');
  const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(user)}/drive/root:/${encoded}:/content`;
  const resp = await fetch(url, {
    method: 'PUT',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/octet-stream' },
    // Node fetch acepta Buffer/Uint8Array como body binario.
    body: new Uint8Array(buffer),
  });
  if (!resp.ok) {
    const t = await resp.text().catch(() => '');
    throw new Error(`GRAPH_UPLOAD ${resp.status} (${ruta}): ${t.slice(0, 200)}`);
  }
}

// =====================================================================
// archivarPaqueteCohorte — genera los 3 archivos y los archiva (§12)
// =====================================================================
export async function archivarPaqueteCohorte(cohorteId: string): Promise<ResultadoArchivo> {
  const { etiqueta, codigoAol } = await resolverCohorte(cohorteId);

  // 1. Generar los 3 archivos del paquete.
  const [{ buffer: docx }, { buffer: xlsx }, trazaBuffer] = await Promise.all([
    generarReporteWord(cohorteId, {}),
    generarReporteExcel(cohorteId),
    construirTrazabilidad(cohorteId, codigoAol, etiqueta),
  ]);

  const archivos = [
    { nombre: `Reporte AoL ${codigoAol}.docx`, buffer: docx },
    { nombre: `${codigoAol} DATOS BRUTOS.xlsx`, buffer: xlsx },
    { nombre: `${codigoAol} trazabilidad.json`, buffer: trazaBuffer },
  ];

  // 2. ¿Hay credenciales de Graph? Si no, fallback a descarga.
  const tenant = process.env.MSGRAPH_TENANT_ID;
  const clientId = process.env.MSGRAPH_CLIENT_ID;
  const clientSecret = process.env.MSGRAPH_CLIENT_SECRET;
  const user = process.env.AOL_ONEDRIVE_USER;
  const base = process.env.AOL_ONEDRIVE_BASE;

  if (!tenant || !clientId || !clientSecret || !user || !base) {
    return {
      archivado: false,
      via: 'descarga',
      detalle: 'OneDrive no configurado (faltan credenciales MSGRAPH_*/AOL_ONEDRIVE_*): paquete disponible para descarga.',
      archivos,
    };
  }

  // 3. Subir a OneDrive. Cualquier fallo → fallback a descarga (no revienta).
  try {
    const token = await obtenerTokenGraph(tenant, clientId, clientSecret);
    const carpeta = `${base.replace(/\/+$/, '')}/${codigoAol}`;
    for (const a of archivos) {
      await subirArchivo(token, user, `${carpeta}/${a.nombre}`, a.buffer);
    }
    return {
      archivado: true,
      via: 'onedrive',
      detalle: `Paquete archivado en OneDrive: ${carpeta}/ (${archivos.length} archivos).`,
      archivos,
    };
  } catch (e: any) {
    return {
      archivado: false,
      via: 'descarga',
      detalle: `No se pudo archivar en OneDrive (${e?.message ?? 'error'}): paquete disponible para descarga.`,
      archivos,
    };
  }
}
