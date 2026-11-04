import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { config } from '../config.js';
import { comprobarSesion } from '../services/actividad-sesion.js';

// Roles de área (Programación Interna). Se guardan como app_role propio, y NO
// como 'profesor', a propósito: admin.ts deja pasar cualquier GET de un profesor
// a /api/admin/*, así que reetiquetarlos como profesor les abriría el panel.
// Con su propio app_role, requireRole('profesor'|'super_admin') los rechaza y su
// acceso depende solo del permiso programacion_interna.ver.
export type RolArea = 'marketing' | 'operaciones' | 'asistente_programa';
export type AppRole = 'participante' | 'profesor' | 'super_admin' | RolArea;

export interface AuthenticatedRequest extends Request {
  user?: {
    sub: string;
    role: AppRole;
    participanteId?: string;
    profesorId?: string;
    cohorteId?: string;
    equipoId?: string;
    isSuperAdmin?: boolean;
    /**
     * `session_id` del JWT de GoTrue: identifica la SESIÓN, no al usuario.
     * Se mantiene estable mientras el token se renueva y solo cambia cuando
     * la persona vuelve a autenticarse. Es la clave con la que el registro de
     * accesos distingue un ingreso real de una renovación.
     */
    sessionId?: string;
    rawJwt: string;
  };
}

// JWKS para tokens asimétricos (Supabase Cloud firma con ES256).
// Self-hosted legacy firmaba con HS256 (símetrico, JWT_SECRET).
let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
function getJwks() {
  if (!jwks) {
    const url = new URL(`${config.supabase.url.replace(/\/$/, '')}/auth/v1/.well-known/jwks.json`);
    jwks = createRemoteJWKSet(url);
  }
  return jwks;
}

async function verifyToken(token: string): Promise<Record<string, any>> {
  // Detectar el algoritmo del JWT por su header.
  const [headerB64] = token.split('.');
  let alg: string | undefined;
  try {
    const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8'));
    alg = header?.alg;
  } catch { /* ignore */ }

  if (alg && alg.startsWith('HS')) {
    // Token simétrico (HS256) — verificación con secret (compatibilidad legacy/self-hosted).
    return jwt.verify(token, config.supabase.jwtSecret) as Record<string, any>;
  }
  // Token asimétrico (ES256/RS256) — Supabase Cloud — verificación con JWKS remoto.
  const { payload } = await jwtVerify(token, getJwks(), {
    issuer: `${config.supabase.url.replace(/\/$/, '')}/auth/v1`,
  });
  return payload as Record<string, any>;
}

export function requireAuth() {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const auth = req.header('authorization') ?? '';
    const m = auth.match(/^Bearer\s+(.+)$/i);
    if (!m) return res.status(401).json({ error: 'MISSING_BEARER' });
    const token = m[1];
    try {
      const decoded = await verifyToken(token);
      const meta = decoded.app_metadata ?? {};
      req.user = {
        sub: decoded.sub as string,
        role: meta.app_role ?? 'participante',
        participanteId: meta.participante_id,
        profesorId: meta.profesor_id,
        cohorteId: meta.cohorte_id,
        equipoId: meta.equipo_id,
        isSuperAdmin: !!meta.es_super_admin,
        sessionId: typeof decoded.session_id === 'string' ? decoded.session_id : undefined,
        rawJwt: token,
      };
    } catch {
      return res.status(401).json({ error: 'INVALID_TOKEN' });
    }

    // Firma y expiración válidas no bastan: la sesión tiene que seguir viva y
    // con actividad en la última hora (ver services/actividad-sesion.ts). Va
    // fuera del try de arriba para que una sesión cerrada no se reporte como
    // token inválido: el frontend distingue los dos casos para explicárselo
    // a la persona.
    if (req.user.sessionId) {
      const segundoPlano = req.header('x-naves-segundo-plano') === '1';
      const estado = await comprobarSesion(req.user.sessionId, !segundoPlano);
      if (estado === 'expirada') return res.status(401).json({ error: 'SESION_EXPIRADA' });
      if (estado === 'inexistente') return res.status(401).json({ error: 'SESION_CERRADA' });
    }
    next();
  };
}

export function requireRole(...roles: AppRole[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: 'NOT_AUTHENTICATED' });
    if (!roles.includes(req.user.role) && !req.user.isSuperAdmin) {
      return res.status(403).json({ error: 'FORBIDDEN', required: roles });
    }
    next();
  };
}
