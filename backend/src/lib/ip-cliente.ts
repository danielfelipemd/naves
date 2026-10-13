import type { Request } from 'express';

/**
 * IP real de quien hace la petición. Un solo sitio para leerla: el límite de
 * intentos, el registro de accesos y la evidencia de las firmas la usan igual.
 *
 * Delante del backend hay TRES saltos: Cloudflare → Traefik (EasyPanel) →
 * nginx del frontend. Con `trust proxy 1`, `req.ip` es la IP de Traefik, la
 * misma para todos; por eso el límite de intentos contaba a toda la plataforma
 * como una sola persona (medido el 13/10/2026: el primer intento de una IP
 * nueva ya encontraba gastados 18 de 600).
 *
 * Cloudflare pone la IP real en `CF-Connecting-IP` y no deja que el navegador
 * la falsifique. Sin esa cabecera (alguien que llegue al servidor sin pasar por
 * Cloudflare) se usa el primer valor de `X-Forwarded-For` y, si tampoco hay,
 * la conexión.
 */
export function ipCliente(req: Request): string | null {
  const cf = req.header('cf-connecting-ip')?.trim();
  const fwd = req.header('x-forwarded-for')?.split(',')[0]?.trim();
  const ip = cf || fwd || req.socket?.remoteAddress || '';
  if (!ip) return null;
  // Postgres INET no acepta el prefijo IPv4-mapped de Node.
  const limpia = ip.replace(/^::ffff:/, '');
  return limpia === '::1' ? '127.0.0.1' : limpia;
}
