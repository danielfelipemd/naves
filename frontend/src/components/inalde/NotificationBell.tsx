import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAuth } from '../../auth/store';

interface Notif { id: string; tipo: string; titulo: string; cuerpo: string | null; enlace: string | null; leida: boolean; creada_at: string; }

export function NotificationBell() {
  const session = useAuth((s) => s.session);
  const navigate = useNavigate();
  const [abierto, setAbierto] = useState(false);
  const [items, setItems] = useState<Notif[]>([]);
  const [noLeidas, setNoLeidas] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  async function cargarContador() {
    try { setNoLeidas((await api.get('/notificaciones/contador')).data.no_leidas ?? 0); } catch { /* noop */ }
  }
  async function cargarLista() {
    try { const { data } = await api.get('/notificaciones'); setItems(data.items ?? []); setNoLeidas(data.no_leidas ?? 0); } catch { /* noop */ }
  }

  useEffect(() => {
    if (!session) return;
    cargarContador();
    const t = window.setInterval(cargarContador, 60000);
    return () => window.clearInterval(t);
  }, [session]);

  useEffect(() => {
    if (!abierto) return;
    function onClick(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setAbierto(false); }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [abierto]);

  function toggle() { const n = !abierto; setAbierto(n); if (n) cargarLista(); }

  async function abrir(n: Notif) {
    if (!n.leida) { try { await api.post(`/notificaciones/${n.id}/leer`); } catch { /* noop */ } }
    setAbierto(false);
    if (n.enlace) navigate(n.enlace);
    cargarContador();
  }

  async function marcarTodas() {
    try { await api.post('/notificaciones/leer-todas'); } catch { /* noop */ }
    setItems((prev) => prev.map((n) => ({ ...n, leida: true }))); setNoLeidas(0);
  }

  if (!session) return null;

  return (
    <div ref={ref} className="relative">
      <button onClick={toggle} className="relative p-2 rounded-full hover:bg-inalde-gray-bg transition-colors" aria-label="Notificaciones">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="text-inalde-text">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {noLeidas > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-inalde-red text-white text-[10px] font-bold flex items-center justify-center">{noLeidas > 9 ? '9+' : noLeidas}</span>
        )}
      </button>

      {abierto && (
        <div className="absolute right-0 mt-2 w-[330px] max-w-[85vw] bg-white rounded-lg shadow-inalde-card border border-inalde-gray-light overflow-hidden z-50">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-inalde-gray-light">
            <span className="font-primary font-bold text-sm text-inalde-text">Notificaciones</span>
            {items.some((n) => !n.leida) && <button onClick={marcarTodas} className="text-[11px] text-inalde-red font-semibold hover:underline">Marcar todas</button>}
          </div>
          <div className="max-h-[380px] overflow-y-auto">
            {items.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-inalde-gray">No tienes notificaciones.</p>
            ) : items.map((n) => (
              <button key={n.id} onClick={() => abrir(n)} className={`w-full text-left px-4 py-3 border-b border-inalde-gray-light/60 hover:bg-inalde-gray-bg/50 ${n.leida ? '' : 'bg-inalde-red/5'}`}>
                <div className="flex items-start gap-2">
                  {!n.leida && <span className="mt-1.5 w-2 h-2 rounded-full bg-inalde-red shrink-0" />}
                  <div className={n.leida ? 'pl-4' : ''}>
                    <p className="text-sm font-semibold text-inalde-text leading-snug">{n.titulo}</p>
                    {n.cuerpo && <p className="text-xs text-inalde-gray mt-0.5">{n.cuerpo}</p>}
                    <p className="text-[10px] text-inalde-gray/70 mt-1">{new Date(n.creada_at).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' })}</p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
