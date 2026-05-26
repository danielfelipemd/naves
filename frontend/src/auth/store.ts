import { create } from 'zustand';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { api } from '../lib/api';

type AppRole = 'participante' | 'profesor' | 'super_admin' | null;

interface AuthState {
  session: Session | null;
  user: User | null;
  role: AppRole;
  loading: boolean;
  requiereCambioClave: boolean;
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

async function fetchRequiereCambio(): Promise<boolean> {
  try {
    const { data } = await api.get('/auth/me');
    return !!data?.requiere_cambio_clave;
  } catch { return false; }
}

export const useAuth = create<AuthState>((set, get) => ({
  session: null,
  user: null,
  role: null,
  loading: true,
  requiereCambioClave: false,

  init: async () => {
    const { data } = await supabase.auth.getSession();
    const user = data.session?.user ?? null;
    const role = roleFromUser(user);
    let requiereCambioClave = false;
    if (data.session && role === 'participante') {
      requiereCambioClave = await fetchRequiereCambio();
    }
    set({
      session: data.session,
      user,
      role,
      requiereCambioClave,
      loading: false,
    });
    supabase.auth.onAuthStateChange(async (_event, session) => {
      const u = session?.user ?? null;
      const r = roleFromUser(u);
      set({ session, user: u, role: r });
      if (session && r === 'participante') {
        const rc = await fetchRequiereCambio();
        set({ requiereCambioClave: rc });
      } else {
        set({ requiereCambioClave: false });
      }
    });
  },

  refreshEstado: async () => {
    if (!get().session || get().role !== 'participante') return;
    set({ requiereCambioClave: await fetchRequiereCambio() });
  },

  marcarActivado: () => set({ requiereCambioClave: false }),

  signOut: async () => {
    await supabase.auth.signOut();
    set({ session: null, user: null, role: null, requiereCambioClave: false });
  },
}));
