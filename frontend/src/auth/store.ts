import { create } from 'zustand';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { api } from '../lib/api';

type AppRole = 'participante' | 'profesor' | 'super_admin' | null;

interface AuthState {
  session: Session | null;
  user: User | null;
  role: AppRole;
  nombre: string | null;
  loading: boolean;
  requiereCambioClave: boolean;
  requierePerfil: boolean;
  init: () => Promise<void>;
  refreshEstado: () => Promise<void>;
  marcarActivado: () => void;
  signOut: () => Promise<void>;
}

function roleFromUser(user: User | null): AppRole {
  const r = user?.app_metadata?.app_role as string | undefined;
  if (r === 'participante' || r === 'profesor' || r === 'super_admin') return r;
  return null;
}

async function fetchMe(): Promise<{ requiereCambio: boolean; requierePerfil: boolean; nombre: string | null }> {
  try {
    const { data } = await api.get('/auth/me');
    return {
      requiereCambio: !!data?.requiere_cambio_clave,
      requierePerfil: !!data?.requiere_perfil,
      nombre: data?.nombre_completo ?? null,
    };
  } catch { return { requiereCambio: false, requierePerfil: false, nombre: null }; }
}

export const useAuth = create<AuthState>((set, get) => ({
  session: null,
  user: null,
  role: null,
  nombre: null,
  loading: true,
  requiereCambioClave: false,
  requierePerfil: false,

  init: async () => {
    const { data } = await supabase.auth.getSession();
    const user = data.session?.user ?? null;
    const role = roleFromUser(user);
    let me = { requiereCambio: false, requierePerfil: false, nombre: null as string | null };
    if (data.session) {
      me = await fetchMe();
    }
    set({
      session: data.session,
      user,
      role,
      nombre: me.nombre,
      requiereCambioClave: me.requiereCambio,
      requierePerfil: me.requierePerfil,
      loading: false,
    });
    supabase.auth.onAuthStateChange(async (_event, session) => {
      const u = session?.user ?? null;
      const r = roleFromUser(u);
      set({ session, user: u, role: r });
      if (session) {
        const fl = await fetchMe();
        set({ requiereCambioClave: fl.requiereCambio, requierePerfil: fl.requierePerfil, nombre: fl.nombre });
      } else {
        set({ requiereCambioClave: false, requierePerfil: false, nombre: null });
      }
    });

    // Renovacion proactiva del access token cada 10 min, mientras haya
    // sesion. El access token de Supabase vive 1h: si el auto-refresh
    // interno de supabase-js falla (pestaña suspendida, red intermitente,
    // etc.) el participante termina deslogueado a mitad de un formulario
    // largo. Forzando refreshSession periodicamente garantizamos que el
    // token siempre este fresco.
    if (typeof window !== 'undefined') {
      const REFRESH_INTERVAL_MS = 10 * 60 * 1000;
      window.setInterval(async () => {
        if (!get().session) return;
        try { await supabase.auth.refreshSession(); }
        catch { /* si falla, onAuthStateChange se encarga */ }
      }, REFRESH_INTERVAL_MS);
    }
  },

  refreshEstado: async () => {
    if (!get().session) return;
    const fl = await fetchMe();
    set({ requiereCambioClave: fl.requiereCambio, requierePerfil: fl.requierePerfil, nombre: fl.nombre });
  },

  marcarActivado: () => set({ requiereCambioClave: false }),

  signOut: async () => {
    // 'local' evita el roundtrip de red para revocar el token en el servidor.
    // Es mucho mas confiable: solo limpia el storage local. Si la red esta
    // mal, antes el signOut fallaba y el estado quedaba pegado.
    try { await supabase.auth.signOut({ scope: 'local' }); } catch { /* ignore */ }
    // Limpiar estado SIEMPRE, ocurra lo que ocurra arriba.
    set({ session: null, user: null, role: null, nombre: null, requiereCambioClave: false, requierePerfil: false });
    // Hard redirect: garantiza que se llega a /login independientemente del
    // arbol de rutas/estado actual (incluida la pantalla 'esperando').
    window.location.href = '/login';
  },
}));
