import axios from 'axios';
import { supabase } from './supabase';

const API_URL = (import.meta.env.VITE_API_URL as string) || '/api';

export const api = axios.create({
  baseURL: API_URL,
  timeout: 15000,
});

// Adjunta JWT del session de Supabase si existe
api.interceptors.request.use(async (cfg) => {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
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
