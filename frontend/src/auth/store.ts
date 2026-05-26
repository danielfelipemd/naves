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

async function fetchAuthFlags(): Promise<{ requiereCambio: boolean; requierePerfil: boolean }> {
  try {
    const { data } = await api.get('/auth/me');
    return {
      requiereCambio: !!data?.requiere_cambio_clave,
      requierePerfil: !!data?.requiere_perfil,
    };
  } catch { return { requiereCambio: false, requierePerfil: false }; }
}

export const useAuth = create<AuthState>((set, get) => ({
  session: null,
  user: null,
  role: null,
  loading: true,
  requiereCambioClave: false,
  requierePerfil: false,

  init: async () => {
    const { data } = await supabase.auth.getSession();
    const user = data.session?.user ?? null;
    const role = roleFromUser(user);
    let flags = { requiereCambio: false, requierePerfil: false };
    if (data.session && role === 'participante') {
      flags = await fetchAuthFlags();
    }
    set({
      session: data.session,
      user,
      role,
      requiereCambioClave: flags.requiereCambio,
      requierePerfil: flags.requierePerfil,
      loading: false,
    });
    supabase.auth.onAuthStateChange(async (_event, session) => {
      const u = session?.user ?? null;
      const r = roleFromUser(u);
      set({ session, user: u, role: r });
      if (session && r === 'participante') {
        const fl = await fetchAuthFlags();
        set({ requiereCambioClave: fl.requiereCambio, requierePerfil: fl.requierePerfil });
      } else {
        set({ requiereCambioClave: false, requierePerfil: false });
      }
    });
  },

  refreshEstado: async () => {
    if (!get().session || get().role !== 'participante') return;
    const fl = await fetchAuthFlags();
    set({ requiereCambioClave: fl.requiereCambio, requierePerfil: fl.requierePerfil });
  },

  marcarActivado: () => set({ requiereCambioClave: false }),

  signOut: async () => {
    await supabase.auth.signOut();
    set({ session: null, user: null, role: null, requiereCambioClave: false, requierePerfil: false });
  },
}));
