import { useEffect, useState } from 'react';
import { api } from '../../lib/api';

interface Solicitud {
  id: string;
  motivo: string;
  estado: 'pendiente' | 'aprobada' | 'rechazada';
  fecha_solicitud: string;
  fecha_respuesta: string | null;
  respuesta_profesor: string | null;
  proyectos: { id: string; nombre: string };
  participantes_lista: { nombre_completo: string };
}

export default function Solicitudes() {
  const [items, setItems] = useState<Solicitud[]>([]);
  const [filter, setFilter] = useState<'pendiente' | 'todas'>('pendiente');
  const [respuesta, setRespuesta] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  async function load() {
    setItems((await api.get('/admin/solicitudes-desarchivado')).data);
  }
  useEffect(() => { load(); }, []);

  async function resolver(id: string, accion: 'aprobar' | 'rechazar') {
    setBusy(true); setMsg(null);
    try {
      await api.post(`/admin/solicitudes-desarchivado/${id}/${accion}`, { respuesta: respuesta[id] || undefined });
      setMsg({ kind: 'ok', text: `Solicitud ${accion === 'aprobar' ? 'aprobada' : 'rechazada'}.` });
      await load();
    } catch (e: any) {
      setMsg({ kind: 'err', text: e?.response?.data?.error ?? e.message });
    } finally { setBusy(false); }
  }

  const visibles = filter === 'pendiente' ? items.filter((s) => s.estado === 'pendiente') : items;

  return (
    <>
      <div className="border-b-[3px] border-inalde-red pb-4 mb-6">
        <p className="section-subtitle mb-1">Administración</p>
        <h1 className="section-title">Solicitudes de desarchivado</h1>
      </div>

      <div className="flex gap-2 mb-6">
        {(['pendiente', 'todas'] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-3 py-1 rounded text-xs font-primary font-semibold uppercase tracking-wider transition ${
              filter === f ? 'bg-inalde-red text-white' : 'bg-inalde-gray-bg text-inalde-gray hover:text-inalde-text'
            }`}>{f}</button>
        ))}
      </div>

      {msg && (
        <div className={`rounded border-l-4 px-4 py-3 text-sm mb-6 ${msg.kind === 'ok' ? 'border-inalde-blue bg-blue-50' : 'border-inalde-red bg-red-50'}`}>
          {msg.text}
        </div>
      )}

      {visibles.length === 0 ? <p className="text-inalde-gray text-sm">Sin solicitudes.</p> : (
        <div className="space-y-3">
          {visibles.map((s) => (
            <div key={s.id} className="border border-inalde-gray-light rounded p-4">
              <div className="flex justify-between items-start mb-2">
                <div>
                  <h3 className="font-primary font-bold">{s.proyectos.nombre}</h3>
                  <p className="text-xs text-inalde-gray">
                    Solicita {s.participantes_lista.nombre_completo} · {new Date(s.fecha_solicitud).toLocaleString('es-CO')}
                  </p>
                </div>
                <span className={`text-xs uppercase tracking-wider font-semibold ${
                  s.estado === 'pendiente' ? 'text-inalde-gold' :
                  s.estado === 'aprobada' ? 'text-inalde-blue' : 'text-inalde-gray'
                }`}>{s.estado}</span>
              </div>
              <p className="text-sm leading-relaxed bg-inalde-gray-bg/40 rounded px-3 py-2 mb-3">"{s.motivo}"</p>

              {s.estado === 'pendiente' && (
                <>
                  <textarea value={respuesta[s.id] ?? ''} onChange={(e) => setRespuesta({ ...respuesta, [s.id]: e.target.value })}
                    placeholder="Respuesta opcional al equipo…" rows={2} className="input-inalde !text-sm" />
                  <div className="flex gap-2 mt-2">
                    <button onClick={() => resolver(s.id, 'aprobar')} disabled={busy}
                      className="px-4 py-1.5 rounded bg-inalde-red text-white text-xs font-primary font-semibold uppercase tracking-wider hover:bg-inalde-red-hover">
                      Aprobar
                    </button>
                    <button onClick={() => resolver(s.id, 'rechazar')} disabled={busy}
                      className="px-4 py-1.5 rounded border border-inalde-gray text-inalde-gray text-xs font-primary font-semibold uppercase tracking-wider hover:border-inalde-red hover:text-inalde-red">
                      Rechazar
                    </button>
                  </div>
                </>
              )}
              {s.respuesta_profesor && (
                <p className="text-xs text-inalde-gray mt-2 italic">Respuesta: "{s.respuesta_profesor}"</p>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
