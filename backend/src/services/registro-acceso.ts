import type { Request } from 'express';
import { supabaseAdmin } from '../db/supabase.js';
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
 */

/** Ventana para no reescribir en cada F5. Un acceso por usuario cada 30 min. */
const VENTANA_MS = 30 * 60 * 1000;

/** Última escritura por usuario, en memoria del proceso. */
const ultimoRegistro = new Map<string, number>();

/** Evita que el Map crezca sin límite si pasan muchos usuarios distintos. */
const MAX_ENTRADAS = 5000;

function yaRegistradoReciente(sub: string): boolean {
  const previo = ultimoRegistro.get(sub);
  const ahora = Date.now();
  if (previo && ahora - previo < VENTANA_MS) return true;

  if (ultimoRegistro.size >= MAX_ENTRADAS) {
    // Purga las entradas ya vencidas; si aún está lleno, arranca de cero.
    for (const [k, t] of ultimoRegistro) {
      if (ahora - t >= VENTANA_MS) ultimoRegistro.delete(k);
    }
    if (ultimoRegistro.size >= MAX_ENTRADAS) ultimoRegistro.clear();
  }
  ultimoRegistro.set(sub, ahora);
  return false;
}

/** IP del cliente respetando el proxy de EasyPanel/Traefik. */
function ipDe(req: Request): string | null {
  const fwd = req.header('x-forwarded-for');
  const ip = fwd ? fwd.split(',')[0]!.trim() : (req.socket?.remoteAddress ?? '');
  if (!ip) return null;
  // Postgres INET no acepta el prefijo IPv4-mapped de Node ni el puerto.
  const limpia = ip.replace(/^::ffff:/, '');
  return limpia === '::1' ? '127.0.0.1' : limpia;
}

export interface ActorAcceso {
  sub: string;
  role: AppRole;
  participanteId?: string;
  profesorId?: string;
  isSuperAdmin?: boolean;
}

export async function registrarAcceso(user: ActorAcceso, req: Request): Promise<void> {
  try {
    if (!user?.sub) return;
    if (yaRegistradoReciente(user.sub)) return;

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
      detalles: { auth_user_id: user.sub, role: user.role },
      ip: ipDe(req),
      user_agent: (req.header('user-agent') ?? '').slice(0, 500) || null,
      timestamp: ahora,
    });
  } catch {
    // Registrar el acceso nunca puede romper la sesión del usuario.
  }
}
