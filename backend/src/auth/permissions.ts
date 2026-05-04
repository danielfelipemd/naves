import type { NextFunction, Response } from 'express';
import { supabaseAdmin } from '../db/supabase.js';
import type { AuthenticatedRequest } from './middleware.js';

// Cache muy simple: user_id → permisos[] con TTL 60s
const cache = new Map<string, { permisos: Set<string>; expiresAt: number }>();
const TTL_MS = 60_000;

export async function getUserPermisos(authUserId: string): Promise<Set<string>> {
  const now = Date.now();
  const hit = cache.get(authUserId);
  if (hit && hit.expiresAt > now) return hit.permisos;

  const { data } = await supabaseAdmin.rpc('permisos_del_usuario', { p_user: authUserId });
  const set = new Set<string>((data ?? []).map((r: any) => r.permiso_code));
  cache.set(authUserId, { permisos: set, expiresAt: now + TTL_MS });
  return set;
}

export function invalidateUserPermisos(authUserId: string) {
  cache.delete(authUserId);
}

export function requirePermission(...codes: string[]) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: 'NOT_AUTHENTICATED' });
    const permisos = await getUserPermisos(req.user.sub);
    const hasAny = codes.some((c) => permisos.has(c));
    if (!hasAny) {
      return res.status(403).json({ error: 'FORBIDDEN', required: codes });
    }
    next();
  };
}
