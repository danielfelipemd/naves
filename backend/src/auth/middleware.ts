import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';

export interface AuthenticatedRequest extends Request {
  user?: {
    sub: string;
    role: 'participante' | 'profesor' | 'super_admin';
    participanteId?: string;
    profesorId?: string;
    cohorteId?: string;
    equipoId?: string;
    isSuperAdmin?: boolean;
    rawJwt: string;
  };
}

export function requireAuth() {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const auth = req.header('authorization') ?? '';
    const m = auth.match(/^Bearer\s+(.+)$/i);
    if (!m) return res.status(401).json({ error: 'MISSING_BEARER' });
    const token = m[1];
    try {
      const decoded = jwt.verify(token, config.supabase.jwtSecret) as any;
      const meta = decoded.app_metadata ?? {};
      req.user = {
        sub: decoded.sub,
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

export function requireRole(...roles: Array<'participante' | 'profesor' | 'super_admin'>) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: 'NOT_AUTHENTICATED' });
    if (!roles.includes(req.user.role) && !req.user.isSuperAdmin) {
      return res.status(403).json({ error: 'FORBIDDEN', required: roles });
    }
    next();
  };
}
