import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { config } from '../config.js';

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
        rawJwt: token,
      };
      next();
    } catch {
      return res.status(401).json({ error: 'INVALID_TOKEN' });
    }
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
