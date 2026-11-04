import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config.js';

const sinSesion = { auth: { autoRefreshToken: false, persistSession: false } };

// Cliente con SERVICE_ROLE — bypassa RLS, solo para operaciones admin desde backend.
// Es `let` porque elegirConexionSupabase() puede cambiarle la dirección. Los
// `import` de ESM son enlaces vivos, así que reasignarlo aquí lo cambia también
// para todos los módulos que ya lo importaron.
export let supabaseAdmin: SupabaseClient = createClient(config.supabase.internalUrl, config.supabase.serviceRoleKey, sinSesion);

// Crea cliente con el JWT del usuario (respeta RLS)
export function supabaseForUser(userJwt: string): SupabaseClient {
  return createClient(config.supabase.internalUrl, config.supabase.anonKey, {
    ...sinSesion,
    global: { headers: { Authorization: `Bearer ${userJwt}` } },
  });
}

/**
 * Dirección interna tal como viene del entorno. Se guarda aparte porque
 * `config.supabase.internalUrl` pasa a ser la que está EN USO, y al caer al
 * dominio público antes se perdía el valor configurado: sin él no había forma
 * de volver a intentar la red interna sin redesplegar.
 */
const INTERNA = config.supabase.internalUrl.replace(/\/$/, '');
const PUBLICA = config.supabase.url.replace(/\/$/, '');

/**
 * Intentos al arrancar antes de rendirse y salir por el dominio público.
 *
 * El presupuesto total manda: el puerto no se abre hasta que esto termina, y el
 * HEALTHCHECK del Dockerfile da `--start-period=10s`. Peor caso aquí:
 * 3 x 2 s de sonda + 2 x 1 s de espera = 8 s, con margen. En la práctica son
 * milisegundos, porque un nombre que no resuelve falla al instante.
 */
const INTENTOS_ARRANQUE = 3;
const ESPERA_ENTRE_INTENTOS_MS = 1000;
const TIEMPO_SONDA_MS = 2000;

/** Cada cuánto se reintenta la red interna una vez se cayó al dominio público. */
const REINTENTO_MS = 5 * 60 * 1000;

let reintento: NodeJS.Timeout | null = null;

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** ¿Responde Kong por la red interna? Devuelve el motivo si no. */
async function sondaInterna(): Promise<{ ok: true } | { ok: false; motivo: string }> {
  try {
    const r = await fetch(`${INTERNA}/auth/v1/health`, {
      headers: { apikey: config.supabase.anonKey },
      signal: AbortSignal.timeout(TIEMPO_SONDA_MS),
    });
    if (!r.ok) return { ok: false, motivo: `HTTP ${r.status}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, motivo: (e as Error).message };
  }
}

function usar(via: 'interna' | 'publica'): void {
  const url = via === 'interna' ? INTERNA : PUBLICA;
  config.supabase.internalUrl = url;
  config.supabase.via = via;
  supabaseAdmin = createClient(url, config.supabase.serviceRoleKey, sinSesion);
}

/**
 * Prueba la dirección interna de Supabase antes de abrir el puerto. Si no
 * responde, el backend sigue con el dominio público en vez de quedarse sin
 * base: funciona, pero es MUCHO más lento. Medido el 3-nov-2026 en producción:
 * una ida y vuelta a la base cuesta ~289 ms por el dominio público (653 ms de
 * un endpoint con consulta contra 364 ms de /api/health, que no la toca),
 * porque `bdnaves.netcloudnetworking.cloud` está tras Cloudflare y el tráfico
 * sale del VPS hasta Miami y vuelve a entrar. Por la red interna son
 * milisegundos de un dígito.
 *
 * Dos cosas que antes faltaban, y que son el motivo de este arreglo:
 *
 *  1. UN solo intento. El arranque del contenedor y el del stack de la base no
 *     están sincronizados: si la red interna no contesta en ese instante, se
 *     cae al dominio público.
 *  2. La decisión era PERMANENTE. Ese único fallo condenaba al backend al
 *     camino lento hasta el siguiente despliegue. Pasó de verdad: el 13-oct
 *     `/api/health` decía `interna`, el contenedor se recreó el 30-oct y
 *     desde entonces reportaba `publica` — cuatro días pagando el viaje a
 *     Cloudflare en cada consulta, sin que nada fallara ni avisara.
 *
 * Ahora se reintenta al arrancar y, si aun así se sale por el dominio público,
 * se vuelve a probar en segundo plano hasta que la red interna responda. Por
 * dónde está hablando se ve en GET /api/health → `supabase`.
 */
export async function elegirConexionSupabase(): Promise<void> {
  if (INTERNA === PUBLICA) { usar('publica'); return; }

  for (let i = 1; i <= INTENTOS_ARRANQUE; i++) {
    const r = await sondaInterna();
    if (r.ok) { usar('interna'); return; }
    console.error(`[supabase] intento ${i}/${INTENTOS_ARRANQUE}: la red interna (${INTERNA}) no respondió: ${r.motivo}`);
    if (i < INTENTOS_ARRANQUE) await espera(ESPERA_ENTRE_INTENTOS_MS);
  }

  console.error(`[supabase] sigo por el dominio público (${PUBLICA}). Reintento la red interna cada ${REINTENTO_MS / 60000} min.`);
  usar('publica');
  programarReintento();
}

/**
 * Reintento en segundo plano. `unref()` para que el temporizador no mantenga
 * vivo el proceso, y nunca lanza: esto no puede tumbar al backend.
 */
function programarReintento(): void {
  if (reintento) return;
  reintento = setInterval(() => {
    void (async () => {
      try {
        const r = await sondaInterna();
        if (!r.ok) return;
        usar('interna');
        if (reintento) { clearInterval(reintento); reintento = null; }
        console.log(`[supabase] la red interna (${INTERNA}) ya responde: cambio a ella.`);
      } catch { /* se reintenta en el siguiente ciclo */ }
    })();
  }, REINTENTO_MS);
  reintento.unref?.();
}
