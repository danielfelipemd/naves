import { Router } from 'express';
import { supabaseAdmin } from '../db/supabase.js';
import { config } from '../config.js';

const router = Router();

router.get('/health', (_req, res) => {
  // `supabase` dice por dónde habla el backend con la base: 'interna' (red de
  // Docker, lo correcto) o 'publica' (respaldo si la interna no respondió).
  res.json({ status: 'ok', service: 'naves-backend', supabase: config.supabase.via, ts: new Date().toISOString() });
});

router.get('/health/deep', async (_req, res) => {
  const checks: Record<string, unknown> = { service: 'ok' };
  try {
    const { error } = await supabaseAdmin.from('cohortes').select('id').limit(1);
    checks.supabase = error ? { ok: false, error: error.message } : { ok: true };
  } catch (e) {
    checks.supabase = { ok: false, error: (e as Error).message };
  }
  res.json({ status: 'ok', checks, ts: new Date().toISOString() });
});

export default router;
