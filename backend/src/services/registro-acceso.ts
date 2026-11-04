import type { Request } from 'express';
import { supabaseAdmin } from '../db/supabase.js';
import { ipCliente } from '../lib/ip-cliente.js';
import type { AppRole } from '../auth/middleware.js';

/**
 * Registro de accesos.
 *
 * El login NO pasa por el backend: el frontend llama directo a
 * `supabase.auth.signInWithPassword()`. Por eso el backend se entera de que
 * alguien entró en la primera llamada autenticada que hace el cliente, que
 * siempre es GET /api/auth/me.
 *
 * Aquí se hacen las dos cosas que antes no hacía nadie:
 *  1. Poner al día `ultimo_login` en profesores / participantes_lista (la
 *     columna existía desde el esquema inicial pero jamás se escribía).
 *  2. Dejar una fila en `auditoria` con el actor REAL. Los triggers de tabla
 *     no pueden: escriben con service_role y siempre caen en actor 'sistema'.
 *
 * Se llama sin await y nunca lanza: un fallo registrando no puede tumbar la
 * sesión de nadie.
 *
 * Un acceso = una SESIÓN, no una llamada. /auth/me no se pide solo al entrar:
 * supabase-js emite `SIGNED_IN` cada vez que la pestaña vuelve a estar visible
 * (`_recoverAndRefresh`), y el frontend lo atiende pidiendo el perfil. Contando
 * por usuario y ventana de tiempo, una pestaña abierta toda la tarde producía
 * una fila cada 30 minutos exactos — medido en producción: 229 de 363
 * intervalos del super admin eran de 1800 s al segundo, que es el ancho de la
 * ventana y no el ritmo de una persona.
 *
 * La clave correcta es `session_id`, que viene en el JWT de GoTrue: se mantiene
 * mientras el token se renueva y solo cambia cuando alguien se autentica de
 * nuevo. Así una sesión deja exactamente una fila, sobrevivan los F5 y los
 * cambios de pestaña que sean.
 */

/**
 * Respaldo para tokens sin `session_id` (firmas antiguas): se vuelve a contar
 * por usuario con ventana de tiempo, que es tosco pero no deja el acceso sin
 * registrar.
 */
const VENTANA_MS = 30 * 60 * 1000;

/** Última escritura por clave (sesión, o usuario en el respaldo). */
const ultimoRegistro = new Map<string, number>();

/** Evita que el Map crezca sin límite si pasan muchas sesiones distintas. */
const MAX_ENTRADAS = 5000;

/**
 * Las sesiones de GoTrue duran mucho más que 30 min, así que una entrada por
 * `session_id` tiene que vivir lo suficiente para cubrir la sesión completa;
 * si no, la misma sesión volvería a registrarse al caducar su entrada.
 */
const VIDA_ENTRADA_SESION_MS = 24 * 60 * 60 * 1000;

function yaRegistrado(clave: string, porSesion: boolean): boolean {
  const previo = ultimoRegistro.get(clave);
  const ahora = Date.now();
  const vida = porSesion ? VIDA_ENTRADA_SESION_MS : VENTANA_MS;
  if (previo && ahora - previo < vida) return true;

  if (ultimoRegistro.size >= MAX_ENTRADAS) {
    // Purga lo ya vencido con el criterio más laxo; si aún está lleno,
    // arranca de cero (perder el rastro en memoria solo duplica una fila).
    for (const [k, t] of ultimoRegistro) {
      if (ahora - t >= VIDA_ENTRADA_SESION_MS) ultimoRegistro.delete(k);
    }
    if (ultimoRegistro.size >= MAX_ENTRADAS) ultimoRegistro.clear();
  }
  ultimoRegistro.set(clave, ahora);
  return false;
}

export interface ActorAcceso {
  sub: string;
  role: AppRole;
  participanteId?: string;
  profesorId?: string;
  isSuperAdmin?: boolean;
  /** `session_id` del JWT. Sin él se cae al respaldo por usuario y ventana. */
  sessionId?: string;
}

export async function registrarAcceso(user: ActorAcceso, req: Request): Promise<void> {
  try {
    if (!user?.sub) return;
    const porSesion = !!user.sessionId;
    if (yaRegistrado(porSesion ? `s:${user.sessionId}` : `u:${user.sub}`, porSesion)) return;

    const ahora = new Date().toISOString();

    // 1) ultimo_login en la tabla que corresponda
    if (user.participanteId) {
      await supabaseAdmin
        .from('participantes_lista')
        .update({ ultimo_login: ahora })
        .eq('id', user.participanteId);
    } else if (user.profesorId) {
      await supabaseAdmin
        .from('profesores')
        .update({ ultimo_login: ahora })
        .eq('id', user.profesorId);
    }

    // 2) rastro en auditoría con el actor real
    const actorTipo = user.isSuperAdmin
      ? 'super_admin'
      : user.participanteId
        ? 'participante'
        : user.profesorId
          ? 'profesor'
          : 'sistema';

    await supabaseAdmin.from('auditoria').insert({
      actor_tipo: actorTipo,
      actor_id: user.participanteId ?? user.profesorId ?? null,
      accion: 'LOGIN',
      entidad_tipo: user.participanteId ? 'participantes_lista' : user.profesorId ? 'profesores' : null,
      entidad_id: user.participanteId ?? user.profesorId ?? null,
      detalles: { auth_user_id: user.sub, role: user.role, session_id: user.sessionId ?? null },
      ip: ipCliente(req),
      user_agent: (req.header('user-agent') ?? '').slice(0, 500) || null,
      timestamp: ahora,
    });
  } catch {
    // Registrar el acceso nunca puede romper la sesión del usuario.
  }
}
