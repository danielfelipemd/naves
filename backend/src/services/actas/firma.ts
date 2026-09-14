import crypto from 'node:crypto';

// =====================================================================
// Firma electrónica propia de las actas.
//
// Marco legal: Ley 527/1999 y Decreto 2364/2012 dan a la firma electrónica
// simple el mismo valor que la manuscrita, siempre que (1) los datos de
// creación correspondan exclusivamente al firmante y (2) se pueda detectar
// cualquier alteración posterior. No exigen proveedor certificado.
//
// Cómo se cumple (2): cada firma incorpora el código de la anterior, así que
// alterar una rompe todas las siguientes y la verificación dice exactamente
// dónde. Pero la cadena SOLA no basta: quien tenga acceso a la base podría
// reescribir un registro y recalcular los códigos. Por eso cada eslabón se
// sella además con HMAC-SHA256 usando una clave que vive FUERA de la base
// (variable de entorno). Sin esa clave el sello no se puede rehacer.
// =====================================================================

/**
 * Clave del sello. Vive fuera de la base a propósito: es lo único que un
 * atacante con acceso a la base no tendría. Si falta, se deriva del secreto
 * de sesión para no dejar el sistema sin sello, pero conviene configurarla.
 */
function claveSello(): string {
  const k = process.env.ACTAS_FIRMA_SECRET || process.env.SUPABASE_JWT_SECRET || '';
  if (!k) throw new Error('ACTAS_FIRMA_SECRET no configurada');
  return k;
}

export interface DatosFirma {
  actaId: number | string;
  rol: string;
  nombre: string;
  /** Imagen de la firma en data URI (trazo, texto o archivo subido). */
  imagen?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}

export interface FirmaSellada {
  rol: string;
  nombre: string;
  estado: 'firmada';
  firmada_en: string;
  imagen?: string | null;
  ip: string | null;
  user_agent: string | null;
  /** Código de verificación de este eslabón. */
  hash: string;
  /** Código del eslabón anterior; ata esta firma a la cadena. */
  hash_anterior: string | null;
  /** Sello HMAC: impide rehacer la cadena sin la clave del servidor. */
  sello: string;
}

/** Texto canónico de la firma. El orden es fijo: de él depende el código. */
function canonico(d: DatosFirma, fechaISO: string, hashAnterior: string | null): string {
  return [
    `acta:${d.actaId}`,
    `rol:${d.rol}`,
    `nombre:${d.nombre}`,
    `fecha:${fechaISO}`,
    `ip:${d.ip ?? ''}`,
    `ua:${d.userAgent ?? ''}`,
    `img:${d.imagen ? crypto.createHash('sha256').update(d.imagen).digest('hex') : ''}`,
    `prev:${hashAnterior ?? 'GENESIS'}`,
  ].join('|');
}

/**
 * Sella una firma y la encadena a la anterior.
 *
 * La fecha la pone el servidor, nunca el cliente: si viniera del navegador,
 * el firmante podría antedatar su propia firma.
 */
export function firmar(d: DatosFirma, hashAnterior: string | null): FirmaSellada {
  const fechaISO = new Date().toISOString();
  const base = canonico(d, fechaISO, hashAnterior);
  const hash = crypto.createHash('sha256').update(base).digest('hex');
  const sello = crypto.createHmac('sha256', claveSello()).update(`${base}|${hash}`).digest('hex');
  return {
    rol: d.rol,
    nombre: d.nombre,
    estado: 'firmada',
    firmada_en: fechaISO,
    imagen: d.imagen ?? null,
    ip: d.ip ?? null,
    user_agent: d.userAgent ?? null,
    hash,
    hash_anterior: hashAnterior,
    sello,
  };
}

/** Código del último eslabón, para encadenar la firma siguiente. */
export function ultimoHash(firmas: any[]): string | null {
  const selladas = (firmas ?? []).filter((f) => f?.estado === 'firmada' && f?.hash);
  return selladas.length ? selladas[selladas.length - 1].hash : null;
}

export interface Verificacion {
  valida: boolean;
  firmas_verificadas: number;
  /** Primer eslabón que no cuadra; null si todo está bien. */
  rota_en: { rol: string; nombre: string; motivo: string } | null;
}

/**
 * Recorre la cadena y comprueba que nadie la tocó. Devuelve el PRIMER punto
 * donde se rompe, que es el dato útil para investigar.
 */
export function verificarCadena(actaId: number | string, firmas: any[]): Verificacion {
  const selladas = (firmas ?? []).filter((f) => f?.estado === 'firmada');
  let previo: string | null = null;
  let n = 0;

  for (const f of selladas) {
    // Una firma anterior al sellado (o sin sello) no se puede verificar.
    if (!f.hash || !f.sello) {
      return { valida: false, firmas_verificadas: n, rota_en: { rol: f.rol, nombre: f.nombre ?? '—', motivo: 'firma sin sello de integridad' } };
    }
    if ((f.hash_anterior ?? null) !== previo) {
      return { valida: false, firmas_verificadas: n, rota_en: { rol: f.rol, nombre: f.nombre ?? '—', motivo: 'la firma no enlaza con la anterior' } };
    }
    const base = canonico(
      { actaId, rol: f.rol, nombre: f.nombre ?? '', imagen: f.imagen ?? null, ip: f.ip ?? null, userAgent: f.user_agent ?? null },
      f.firmada_en, f.hash_anterior ?? null,
    );
    const hashEsperado = crypto.createHash('sha256').update(base).digest('hex');
    if (hashEsperado !== f.hash) {
      return { valida: false, firmas_verificadas: n, rota_en: { rol: f.rol, nombre: f.nombre ?? '—', motivo: 'los datos de la firma fueron alterados' } };
    }
    const selloEsperado = crypto.createHmac('sha256', claveSello()).update(`${base}|${f.hash}`).digest('hex');
    // Comparación en tiempo constante: evita filtrar el sello por el tiempo
    // que tarda en fallar la comparación.
    const ok = selloEsperado.length === f.sello.length
      && crypto.timingSafeEqual(Buffer.from(selloEsperado), Buffer.from(f.sello));
    if (!ok) {
      return { valida: false, firmas_verificadas: n, rota_en: { rol: f.rol, nombre: f.nombre ?? '—', motivo: 'el sello no corresponde: la cadena fue rehecha' } };
    }
    previo = f.hash;
    n++;
  }
  return { valida: true, firmas_verificadas: n, rota_en: null };
}
