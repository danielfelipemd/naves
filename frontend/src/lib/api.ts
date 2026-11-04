import axios from 'axios';
import { getCachedToken } from '../auth/token';

const API_URL = (import.meta.env.VITE_API_URL as string) || '/api';

export const api = axios.create({
  baseURL: API_URL,
  timeout: 15000,
});

// Adjunta el JWT actual desde el cache sincrono. Antes haciamos
//   `await supabase.auth.getSession()`
// aqui en cada request, lo cual colgaba el frontend cuando Supabase Auth
// tenia latencia o estaba refrescando el token. Ahora el store de auth
// mantiene el cache vivo via onAuthStateChange + en el init().
api.interceptors.request.use((cfg) => {
  const token = getCachedToken();
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

/**
 * Para las consultas que la aplicación hace sola, sin que la persona haga nada:
 * la campana de avisos, el autoguardado, los sondeos de progreso. El backend
 * comprueba igual que la sesión siga viva, pero estas peticiones NO cuentan
 * como actividad. Si contaran, una pestaña abierta nunca expiraría.
 *
 *   api.get('/notificaciones/contador', enSegundoPlano)
 *   api.put(url, datos, { timeout: 60000, ...enSegundoPlano })
 */
export const enSegundoPlano = { headers: { 'X-Naves-Segundo-Plano': '1' } } as const;

export type MotivoCierre = 'inactividad' | 'cerrada';

let alCerrarSesion: ((motivo: MotivoCierre) => void) | null = null;

/** Lo registra el store de sesión: aquí no se importa para no crear un ciclo. */
export function registrarAlCerrarSesion(fn: (motivo: MotivoCierre) => void): void {
  alCerrarSesion = fn;
}

// El backend responde 401 SESION_EXPIRADA (1 hora sin actividad) o
// SESION_CERRADA (la sesión ya no existe: se cerró en otro lado, se cambió la
// clave). En los dos casos se sale al login explicando por qué, en vez de
// dejar la pantalla fallando petición tras petición.
api.interceptors.response.use(
  (r) => r,
  (err) => {
    const codigo = err?.response?.data?.error;
    if (err?.response?.status === 401 && (codigo === 'SESION_EXPIRADA' || codigo === 'SESION_CERRADA')) {
      alCerrarSesion?.(codigo === 'SESION_EXPIRADA' ? 'inactividad' : 'cerrada');
    }
    return Promise.reject(err);
  },
);

/** Descarga un blob desde una ruta autenticada y dispara el guardado en el navegador. */
export async function downloadFile(path: string, filename: string) {
  const resp = await api.get(path, { responseType: 'blob' });
  const url = URL.createObjectURL(resp.data);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
