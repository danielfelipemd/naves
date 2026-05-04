import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config.js';

// Cliente con SERVICE_ROLE — bypassa RLS, solo para operaciones admin desde backend
export const supabaseAdmin: SupabaseClient = createClient(
  config.supabase.internalUrl,
  config.supabase.serviceRoleKey,
  {
    auth: { autoRefreshToken: false, persistSession: false },
  },
);

// Crea cliente con el JWT del usuario (respeta RLS)
export function supabaseForUser(userJwt: string): SupabaseClient {
  return createClient(config.supabase.internalUrl, config.supabase.anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${userJwt}` } },
  });
}
