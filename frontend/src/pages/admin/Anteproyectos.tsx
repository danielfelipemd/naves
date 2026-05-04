import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';

interface Cohorte { id: string; etiqueta: string; }
interface Item {
  id: string; estado: string; fecha_envio: string | null; fecha_actualizacion: string;
  equipos: { id: string; nombre_equipo: string | null; cohorte_id: string };
  proyectos: Array<{ id: string; nombre: string; sector: string | null; estado_seleccion: string }>;
}

export default function AnteproyectosList() {
  const [cohortes, setCohortes] = useState<Cohorte[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [cohorte, setCohorte] = useState('');
  const [estado, setEstado] = useState('');
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => { (async () => {
    setCohortes((await api.get('/admin/cohortes')).data);
  })(); }, []);

  useEffect(() => { (async () => {
    setLoading(true);
    try {
      const params: any = {};
      if (cohorte) params.cohorte = cohorte;
      if (estado) params.estado = estado;
      setItems((await api.get('/admin/anteproyectos', { params })).data);
    } finally { setLoading(false); }
  })(); }, [cohorte, estado]);

  return (
    <>
      <div className="border-b-[3px] border-inalde-red pb-4 mb-6">
        <p className="section-subtitle mb-1">Administración</p>
        <h1 className="section-title">Anteproyectos</h1>
      </div>

      <div className="flex gap-3 mb-6">
        <select value={cohorte} onChange={(e) => setCohorte(e.target.value)} className="input-inalde !py-2">
          <option value="">Todas las cohortes</option>
          {cohortes.map((c) => <option key={c.id} value={c.id}>{c.etiqueta}</option>)}
        </select>
        <select value={estado} onChange={(e) => setEstado(e.target.value)} className="input-inalde !py-2">
          <option value="">Todos los estados</option>
          <option value="borrador">Borrador</option>
          <option value="enviado">Enviado</option>
          <option value="revisado">Revisado</option>
          <option value="aprobado">Aprobado</option>
        </select>
      </div>

      {loading ? <p className="text-inalde-gray">Cargando…</p> : (
        <table className="w-full text-sm border border-inalde-gray-light rounded overflow-hidden">
          <thead className="bg-inalde-gray-bg text-left">
            <tr>
              <th className="px-3 py-2 text-xs uppercase tracking-wider text-inalde-gray">Equipo</th>
              <th className="px-3 py-2 text-xs uppercase tracking-wider text-inalde-gray">Cohorte</th>
              <th className="px-3 py-2 text-xs uppercase tracking-wider text-inalde-gray">Proyectos</th>
              <th className="px-3 py-2 text-xs uppercase tracking-wider text-inalde-gray">Estado</th>
              <th className="px-3 py-2 text-xs uppercase tracking-wider text-inalde-gray">Última edición</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.id} className="border-t border-inalde-gray-light hover:bg-inalde-gray-bg/40 cursor-pointer"
                onClick={() => navigate(`/admin/anteproyectos/${it.id}`)}>
                <td className="px-3 py-2 font-medium">{it.equipos.nombre_equipo ?? '(sin nombre)'}</td>
                <td className="px-3 py-2 text-xs text-inalde-gray">{it.equipos.cohorte_id}</td>
                <td className="px-3 py-2 text-xs">
                  {it.proyectos.map((p) => (
                    <div key={p.id}>
                      <span className={p.estado_seleccion === 'definitivo' ? 'text-inalde-red font-semibold' : p.estado_seleccion === 'archivado' ? 'text-inalde-gray line-through' : ''}>
                        {p.nombre}
                      </span>
                    </div>
                  ))}
                </td>
                <td className="px-3 py-2">
                  <span className={`text-xs uppercase tracking-wider font-semibold ${
                    it.estado === 'borrador' ? 'text-inalde-gold'
                    : it.estado === 'enviado' ? 'text-inalde-blue'
                    : 'text-inalde-red'
                  }`}>{it.estado}</span>
                </td>
                <td className="px-3 py-2 text-xs text-inalde-gray">{new Date(it.fecha_actualizacion).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' })}</td>
              </tr>
            ))}
            {items.length === 0 && <tr><td colSpan={5} className="px-3 py-8 text-center text-inalde-gray">Sin anteproyectos</td></tr>}
          </tbody>
        </table>
      )}
    </>
  );
}
