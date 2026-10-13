import 'dotenv/config';

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  nodeEnv: process.env.NODE_ENV ?? 'development',

  supabase: {
    // Dominio público: el que conocen los navegadores y el que firma los tokens.
    url: required('SUPABASE_URL'),
    // Por donde el backend le habla a Supabase. Debe ser la red interna de
    // Docker (http://naves_bd-kong-1:8000) para no salir a internet y volver.
    // Al arrancar se prueba (db/supabase.ts → elegirConexionSupabase); si no
    // responde, se usa `url` y `via` queda en 'publica'.
    internalUrl: process.env.SUPABASE_INTERNAL_URL?.trim() || required('SUPABASE_URL'),
    via: 'publica' as 'interna' | 'publica',
    anonKey: required('SUPABASE_ANON_KEY'),
    serviceRoleKey: required('SUPABASE_SERVICE_ROLE_KEY'),
    jwtSecret: required('SUPABASE_JWT_SECRET'),
  },

  pii: {
    encryptionKey: process.env.PII_ENCRYPTION_KEY ?? '',
  },

  cors: {
    origins: (process.env.CORS_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  },

  smtp: {
    host: process.env.SMTP_HOST ?? '',
    port: Number(process.env.SMTP_PORT ?? 587),
    user: process.env.SMTP_USER ?? '',
    password: process.env.SMTP_PASSWORD ?? '',
    from: process.env.SMTP_FROM ?? '',
  },

  email: {
    // Pausa entre correos de un envío masivo, para no chocar con los límites de Zoho.
    delayMs: Number(process.env.EMAIL_DELAY_MS ?? 600),
    // SOLO PRUEBAS: si tiene valor, todos los correos van a esta bandeja.
    redirectTo: (process.env.EMAIL_REDIRECT_TO ?? '').trim(),
  },

  actas: {
    // Sello de las actas firmadas. Vive fuera de la base a propósito: es lo
    // único que un atacante con acceso a la base no tendría.
    firmaSecret: process.env.ACTAS_FIRMA_SECRET || process.env.SUPABASE_JWT_SECRET || '',
  },

  // Dominio público de NAVES: base de TODOS los enlaces que salen por correo
  // (recuperación, avisos, botón «Ingresar al sistema»). Sin barra final,
  // porque todos los usos le pegan '/ruta'. El respaldo es el dominio de
  // producción: un enlace al servidor viejo o relativo no abre nada desde un buzón.
  frontendUrl: (process.env.FRONTEND_URL ?? '').trim().replace(/\/$/, '') || 'https://naves-inalde.com',

  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY ?? '',
    model: process.env.ANTHROPIC_MODEL ?? 'claude-opus-4-8',
  },
};
