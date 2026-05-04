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
