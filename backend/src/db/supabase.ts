import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config.js';

const sinSesion = { auth: { autoRefreshToken: false, persistSession: false } };

// Cliente con SERVICE_ROLE — bypassa RLS, solo para operaciones admin desde backend.
// Es `let` porque elegirConexionSupabase() puede cambiarle la dirección al arrancar.
export let supabaseAdmin: SupabaseClient = createClient(config.supabase.internalUrl, config.supabase.serviceRoleKey, sinSesion);

// Crea cliente con el JWT del usuario (respeta RLS)
export function supabaseForUser(userJwt: string): SupabaseClient {
  return createClient(config.supabase.internalUrl, config.supabase.anonKey, {
    ...sinSesion,
    global: { headers: { Authorization: `Bearer ${userJwt}` } },
  });
}

/**
 * Prueba la dirección interna de Supabase antes de abrir el puerto. Si no
 * responde en 3 s, el backend sigue con el dominio público en vez de quedarse
 * sin base: es más lento (sale a Cloudflare y vuelve) pero funciona. Por dónde
 * quedó se ve en GET /api/health → `supabase`.
 */
export async function elegirConexionSupabase(): Promise<void> {
  const interna = config.supabase.internalUrl.replace(/\/$/, '');
  const publica = config.supabase.url.replace(/\/$/, '');
  if (interna === publica) { config.supabase.via = 'publica'; return; }
  try {
    const r = await fetch(`${interna}/auth/v1/health`, {
      headers: { apikey: config.supabase.anonKey },
      signal: AbortSignal.timeout(3000),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    config.supabase.via = 'interna';
  } catch (e) {
    console.error(`[supabase] la red interna (${interna}) no respondió: ${(e as Error).message}. Uso el dominio público.`);
    config.supabase.internalUrl = publica;
    config.supabase.via = 'publica';
    supabaseAdmin = createClient(publica, config.supabase.serviceRoleKey, sinSesion);
  }
}
