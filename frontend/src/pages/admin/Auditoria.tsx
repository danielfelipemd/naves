import { useEffect, useState } from 'react';
import { api } from '../../lib/api';

interface Row {
  id: number;
  actor_tipo: string;
  actor_id: string | null;
  accion: string;
  entidad_tipo: string | null;
  entidad_id: string | null;
  ip: string | null;
  timestamp: string;
}

export default function Auditoria() {
  const [rows, setRows] = useState<Row[]>([]);
  const [accion, setAccion] = useState('');
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      setRows((await api.get('/admin/auditoria', { params: { accion: accion || undefined, limit: 200 } })).data);
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [accion]);

  return (
    <>
      <div className="border-b-[3px] border-inalde-red pb-4 mb-6">
        <p className="section-subtitle mb-1">Administración</p>
        <h1 className="section-title">Auditoría</h1>
        <p className="text-sm text-inalde-gray mt-2">Últimas acciones registradas en el sistema.</p>
      </div>

      <div className="mb-4">
        <input value={accion} onChange={(e) => setAccion(e.target.value)}
          placeholder="Filtra por acción (ej. INSERT, UPDATE, login)…"
          className="input-inalde !py-2 max-w-sm" />
      </div>

      {loading ? <p className="text-inalde-gray">Cargando…</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs border border-inalde-gray-light rounded">
            <thead className="bg-inalde-gray-bg text-left">
              <tr>
                <th className="px-2 py-2 uppercase tracking-wider text-inalde-gray">Cuándo</th>
                <th className="px-2 py-2 uppercase tracking-wider text-inalde-gray">Actor</th>
                <th className="px-2 py-2 uppercase tracking-wider text-inalde-gray">Acción</th>
                <th className="px-2 py-2 uppercase tracking-wider text-inalde-gray">Entidad</th>
                <th className="px-2 py-2 uppercase tracking-wider text-inalde-gray">IP</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-inalde-gray-light">
                  <td className="px-2 py-1.5 text-inalde-gray whitespace-nowrap">{new Date(r.timestamp).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'medium' })}</td>
                  <td className="px-2 py-1.5">
                    <span className="uppercase tracking-wider text-[10px] text-inalde-red font-semibold">{r.actor_tipo}</span>
                    {r.actor_id && <span className="ml-1 text-inalde-gray">{r.actor_id.slice(0, 8)}…</span>}
                  </td>
                  <td className="px-2 py-1.5 font-mono">{r.accion}</td>
                  <td className="px-2 py-1.5 text-inalde-gray">{r.entidad_tipo}{r.entidad_id ? ` ${r.entidad_id.slice(0, 8)}…` : ''}</td>
                  <td className="px-2 py-1.5 text-inalde-gray">{r.ip ?? '—'}</td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={5} className="px-2 py-8 text-center text-inalde-gray">Sin eventos</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
