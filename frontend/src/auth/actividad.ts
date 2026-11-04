/**
 * Última actividad REAL de la persona, compartida entre pestañas.
 *
 * Política: la sesión se cierra tras 1 hora sin actividad. El valor que manda
 * es el de la base, `public.inactividad_maxima()` (migración 49): allí el
 * backend la hace cumplir. Aquí se repite solo para avisar antes; si cambia
 * allí, se cambia aquí.
 *
 * Va en localStorage y no en memoria porque la persona puede estar trabajando
 * en otra pestaña de NAVES: sin compartirlo, la pestaña quieta avisaría y
 * cerraría la sesión de alguien que está escribiendo en la de al lado.
 *
 * La marca va ATADA A LA SESIÓN (su session_id). Sin eso, la marca de una
 * sesión anterior sobrevivía a la siguiente: quien cerró el navegador sin
 * pulsar «Salir» y volvía al día siguiente iniciaba sesión bien y el aviso,
 * viendo 20 horas de inactividad, lo sacaba al instante. Se encontró probando
 * el primer ingreso de un participante en un navegador real.
 */

export const INACTIVIDAD_MAX_MS = 60 * 60 * 1000;

/** El aviso «¿Sigues ahí?» sale a los 50 minutos: 10 de margen para responder. */
export const AVISO_ANTES_MS = 10 * 60 * 1000;

const CLAVE = 'naves:ultima-actividad';

/** Nombre de la clave, para escuchar los cambios de otras pestañas. */
export const CLAVE_ACTIVIDAD = CLAVE;

/** El session_id va dentro del access token de GoTrue. */
export function sessionIdDeToken(token: string | null | undefined): string | null {
  if (!token) return null;
  try {
    const parte = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const sid = JSON.parse(atob(parte))?.session_id;
    return typeof sid === 'string' ? sid : null;
  } catch {
    return null;
  }
}

/**
 * Última actividad de ESTA sesión, o null si no hay marca o la que hay es de
 * otra sesión (que es lo mismo que empezar de cero).
 */
export function leerUltimaActividad(sessionId: string | null): number | null {
  try {
    const crudo = window.localStorage.getItem(CLAVE);
    if (!crudo) return null;
    const { s, t } = JSON.parse(crudo) as { s?: string | null; t?: number };
    if (!sessionId || s !== sessionId) return null;
    return typeof t === 'number' && Number.isFinite(t) && t > 0 ? t : null;
  } catch {
    // Formato viejo (solo el número) o basura: se trata como sin marca.
    return null;
  }
}

export function marcarActividad(sessionId: string | null, cuando: number = Date.now()): void {
  try {
    window.localStorage.setItem(CLAVE, JSON.stringify({ s: sessionId, t: cuando }));
  } catch { /* sin almacenamiento: el backend sigue mandando */ }
}

export function borrarActividad(): void {
  try { window.localStorage.removeItem(CLAVE); } catch { /* ignore */ }
}
