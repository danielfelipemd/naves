import { useEffect, useState } from 'react';
import { api } from '../../lib/api';

interface Cohorte {
  id: string;
  etiqueta: string;
  fecha_inicio: string;
  fecha_fin: string;
  fecha_limite_formacion_equipos: string | null;
  fecha_limite_entrega_anteproyecto: string | null;
  fecha_reunion_1: string | null;
  fecha_limite_seleccion_definitivo: string | null;
  activa: boolean;
  participantes_count: number;
  equipos_count: number;
}

const fechaFields = [
  ['fecha_limite_formacion_equipos',     'Cierre formación de equipos'],
  ['fecha_limite_entrega_anteproyecto',  'Cierre entrega anteproyecto'],
  ['fecha_reunion_1',                    'Reunión 1'],
  ['fecha_limite_seleccion_definitivo',  'Cierre selección definitivo'],
] as const;

function toLocal(iso: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
function toIso(local: string) {
  return local ? new Date(local).toISOString() : null;
}

export default function Cohortes() {
  const [cohortes, setCohortes] = useState<Cohorte[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Partial<Cohorte>>({});
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try { setCohortes((await api.get('/admin/cohortes')).data); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  function startEdit(c: Cohorte) {
    setEditing(c.id);
    setDraft({ ...c });
    setMsg(null);
  }

  async function save() {
    if (!editing) return;
    try {
      const payload: Record<string, any> = { activa: draft.activa };
      for (const [k] of fechaFields) {
        const v = (draft as any)[k];
        payload[k] = v ? new Date(v).toISOString() : null;
      }
      await api.put(`/admin/cohortes/${editing}`, payload);
      setMsg({ kind: 'ok', text: `Cohorte ${editing} actualizada.` });
      setEditing(null);
      await load();
    } catch (e: any) {
      setMsg({ kind: 'err', text: e?.response?.data?.error ?? e.message });
    }
  }

  return (
    <>
      <div className="border-b-[3px] border-inalde-red pb-4 mb-6">
        <p className="section-subtitle mb-1">Administración</p>
        <h1 className="section-title">Cohortes y fechas del Scheduler</h1>
        <p className="text-sm text-inalde-gray mt-2">Configura las fechas límite de cada cohorte. El frontend bloquea acciones cuando vencen.</p>
      </div>

      {msg && (
        <div className={`rounded border-l-4 px-4 py-3 text-sm mb-6 ${msg.kind === 'ok' ? 'border-inalde-blue bg-blue-50' : 'border-inalde-red bg-red-50'}`}>
          {msg.text}
        </div>
      )}

      {loading ? <p className="text-inalde-gray">Cargando…</p> : (
        <div className="space-y-4">
          {cohortes.map((c) => (
            <div key={c.id} className="border border-inalde-gray-light rounded">
              <div className="flex items-center justify-between p-4 bg-inalde-gray-bg">
                <div>
                  <h2 className="font-primary font-bold text-inalde-text">{c.etiqueta}</h2>
                  <p className="text-xs text-inalde-gray mt-1">
                    {c.id} · {c.participantes_count} participantes · {c.equipos_count} equipos
                    {' · '}<span className={c.activa ? 'text-inalde-blue' : 'text-inalde-gray'}>{c.activa ? 'activa' : 'inactiva'}</span>
                  </p>
                </div>
                {editing === c.id ? (
                  <div className="flex gap-2">
                    <button onClick={() => setEditing(null)} className="text-sm text-inalde-gray hover:text-inalde-text">Cancelar</button>
                    <button onClick={save} className="btn-inalde-primary !py-2 !px-4 !text-xs">Guardar</button>
                  </div>
                ) : (
                  <button onClick={() => startEdit(c)} className="text-sm font-semibold text-inalde-red hover:text-inalde-red-hover">Editar →</button>
                )}
              </div>

              {editing === c.id && (
                <div className="p-4 space-y-3 border-t border-inalde-gray-light">
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={!!draft.activa} onChange={(e) => setDraft({ ...draft, activa: e.target.checked })} />
                    Cohorte activa
                  </label>
                  {fechaFields.map(([k, label]) => (
                    <div key={k}>
                      <label className="block font-primary font-semibold text-xs tracking-wider uppercase text-inalde-gray mb-1">{label}</label>
                      <input type="datetime-local"
                        value={toLocal((draft as any)[k] ?? null)}
                        onChange={(e) => setDraft({ ...draft, [k]: toIso(e.target.value) } as any)}
                        className="input-inalde !py-2" />
                    </div>
                  ))}
                </div>
              )}

              {editing !== c.id && (
                <div className="grid sm:grid-cols-2 gap-2 p-4 text-xs">
                  {fechaFields.map(([k, label]) => {
                    const v = (c as any)[k];
                    return (
                      <div key={k} className="flex justify-between border-b border-inalde-gray-light/50 py-1">
                        <span className="text-inalde-gray">{label}</span>
                        <span className="text-inalde-text">{v ? new Date(v).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' }) : <span className="text-inalde-gray italic">no definida</span>}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
