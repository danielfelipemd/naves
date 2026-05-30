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
