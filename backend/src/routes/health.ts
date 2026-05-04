import { Router } from 'express';
import { supabaseAdmin } from '../db/supabase.js';

const router = Router();

router.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'naves-backend', ts: new Date().toISOString() });
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
