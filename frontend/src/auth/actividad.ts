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
 */

export const INACTIVIDAD_MAX_MS = 60 * 60 * 1000;

/** El aviso "¿Sigues ahí?" sale a los 50 minutos: 10 de margen para responder. */
export const AVISO_ANTES_MS = 10 * 60 * 1000;

const CLAVE = 'naves:ultima-actividad';

export function leerUltimaActividad(): number | null {
  try {
    const v = Number(window.localStorage.getItem(CLAVE));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

export function marcarActividad(cuando: number = Date.now()): void {
  try { window.localStorage.setItem(CLAVE, String(cuando)); } catch { /* sin almacenamiento: el backend sigue mandando */ }
}

export function borrarActividad(): void {
  try { window.localStorage.removeItem(CLAVE); } catch { /* ignore */ }
}

/** Nombre de la clave, para escuchar los cambios de otras pestañas. */
export const CLAVE_ACTIVIDAD = CLAVE;
