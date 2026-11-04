import { supabaseAdmin } from '../db/supabase.js';

/**
 * Política de sesión: vive mientras la persona usa el sistema y se cierra tras
 * 1 hora sin actividad real. La hora la define la base
 * (`public.inactividad_maxima()`, migración 49); aquí no se repite.
 *
 * Por qué hace falta: GoTrue no caduca sesiones, y la que existe en
 * auth.sessions se mantiene viva sola porque el frontend renueva el token cada
 * 10 min con la pestaña abierta (medido: una sesión llevaba 935 h viva). Lo que
 * mide la actividad de la PERSONA es esto: cada petición que hace cuenta, salvo
 * las que llegan marcadas como segundo plano (`X-Naves-Segundo-Plano: 1`).
 *
 * También hace que cerrar una sesión sea efectivo de verdad. Antes el backend
 * solo validaba la firma y la expiración del JWT: con la sesión ya borrada en
 * GoTrue (cerrar sesión, cambio de clave, revocación), el access token seguía
 * valiendo hasta una hora más. Ahora deja de valer en, como mucho, un minuto.
 */

export type EstadoSesion = 'ok' | 'inexistente' | 'expirada';

/**
 * Cada sesión se comprueba en la base como mucho una vez por minuto. Entre
 * medias se da por buena y se acumula si hubo actividad, para escribirla en la
 * siguiente comprobación. El coste: una sesión cerrada sigue valiendo hasta 60 s
 * y la actividad se anota con hasta 60 s de retraso — el aviso del frontend va
 * 10 min antes de la hora, con margen de sobra.
 */
const RECHEQUEO_MS = 60 * 1000;
const MAX_ENTRADAS = 5000;

interface Entrada {
  comprobadaEn: number;
  actividadPendiente: boolean;
}

const cache = new Map<string, Entrada>();

function purgarSiLleno(ahora: number): void {
  if (cache.size < MAX_ENTRADAS) return;
  for (const [k, e] of cache) {
    if (ahora - e.comprobadaEn >= RECHEQUEO_MS) cache.delete(k);
  }
  if (cache.size >= MAX_ENTRADAS) cache.clear();
}

/**
 * @param contarActividad false para las consultas en segundo plano: comprueban
 *   que la sesión sigue viva, pero no la mantienen viva.
 * @param forzar ir a la base aunque se haya comprobado hace menos de un minuto
 *   (el latido de actividad y el botón "Seguir conectado").
 */
export async function comprobarSesion(
  sessionId: string,
  contarActividad: boolean,
  forzar = false,
): Promise<EstadoSesion> {
  const ahora = Date.now();
  const previa = cache.get(sessionId);

  if (!forzar && previa && ahora - previa.comprobadaEn < RECHEQUEO_MS) {
    if (contarActividad) previa.actividadPendiente = true;
    return 'ok';
  }

  const contar = contarActividad || !!previa?.actividadPendiente;
  try {
    const { data, error } = await supabaseAdmin.rpc('tocar_sesion', {
      p_session: sessionId,
      p_contar: contar,
    });
    if (error) throw new Error(error.message);

    if (data === 'ok') {
      purgarSiLleno(ahora);
      cache.set(sessionId, { comprobadaEn: ahora, actividadPendiente: false });
      return 'ok';
    }
    cache.delete(sessionId);
    return data === 'expirada' ? 'expirada' : 'inexistente';
  } catch (e) {
    // Un fallo consultando no es un "no": no se expulsa a nadie por un corte de
    // red o una base lenta. La petición sigue, y la próxima vuelve a comprobar.
    console.error(`[sesion] no se pudo comprobar ${sessionId}: ${(e as Error).message}`);
    return 'ok';
  }
}

/** Olvida lo que se sabe de una sesión (p. ej. tras cambiar la clave, que la borra). */
export function olvidarSesion(sessionId: string | undefined): void {
  if (sessionId) cache.delete(sessionId);
}
