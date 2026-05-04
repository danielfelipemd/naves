import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';

interface Cohorte { id: string; etiqueta: string; activa: boolean; participantes_count: number; equipos_count: number; }

export default function Resumen() {
  const [cohortes, setCohortes] = useState<Cohorte[]>([]);
  const [profesoresCount, setProfesoresCount] = useState(0);
  const [solicitudesPend, setSolicitudesPend] = useState(0);

  useEffect(() => { (async () => {
    try {
      const [c, p, s] = await Promise.all([
        api.get('/admin/cohortes'),
        api.get('/admin/profesores'),
        api.get('/admin/solicitudes-desarchivado'),
      ]);
      setCohortes(c.data);
      setProfesoresCount(p.data.length);
      setSolicitudesPend(s.data.filter((x: any) => x.estado === 'pendiente').length);
    } catch {}
  })(); }, []);

  return (
    <>
      <div className="border-b-[3px] border-inalde-red pb-4 mb-8">
        <p className="section-subtitle mb-1">Panel de administración</p>
        <h1 className="section-title">Resumen general</h1>
      </div>

      <div className="grid sm:grid-cols-3 gap-4 mb-8">
        <Stat label="Cohortes activas" value={cohortes.filter((c) => c.activa).length} hint="de 8 totales" />
        <Stat label="Profesores" value={profesoresCount} hint="incluidos super admins" />
        <Stat label="Solicitudes pendientes" value={solicitudesPend} hint="desarchivado de proyectos" highlight={solicitudesPend > 0} />
      </div>

      <h2 className="section-subtitle mb-3">Cohortes activas</h2>
      <table className="w-full text-sm border border-inalde-gray-light rounded overflow-hidden">
        <thead className="bg-inalde-gray-bg text-left">
          <tr>
            <th className="px-3 py-2 font-primary font-semibold uppercase tracking-wider text-xs text-inalde-gray">Cohorte</th>
            <th className="px-3 py-2 font-primary font-semibold uppercase tracking-wider text-xs text-inalde-gray">Participantes</th>
            <th className="px-3 py-2 font-primary font-semibold uppercase tracking-wider text-xs text-inalde-gray">Equipos</th>
            <th className="px-3 py-2 font-primary font-semibold uppercase tracking-wider text-xs text-inalde-gray">Estado</th>
          </tr>
        </thead>
        <tbody>
          {cohortes.map((c) => (
            <tr key={c.id} className="border-t border-inalde-gray-light">
              <td className="px-3 py-2"><Link to={`/admin/cohortes`} className="text-inalde-red hover:underline">{c.etiqueta}</Link></td>
              <td className="px-3 py-2">{c.participantes_count}</td>
              <td className="px-3 py-2">{c.equipos_count}</td>
              <td className="px-3 py-2">
                <span className={`text-xs uppercase tracking-wider font-semibold ${c.activa ? 'text-inalde-blue' : 'text-inalde-gray'}`}>
                  {c.activa ? 'Activa' : 'Inactiva'}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function Stat({ label, value, hint, highlight }: { label: string; value: number; hint?: string; highlight?: boolean }) {
  return (
    <div className={`rounded border-2 p-5 ${highlight ? 'border-inalde-red bg-inalde-red/5' : 'border-inalde-gray-light'}`}>
      <p className="font-primary font-semibold text-xs tracking-wider uppercase text-inalde-gray mb-1">{label}</p>
      <p className={`text-3xl font-primary font-bold ${highlight ? 'text-inalde-red' : 'text-inalde-text'}`}>{value}</p>
      {hint && <p className="text-xs text-inalde-gray mt-1">{hint}</p>}
    </div>
  );
}
