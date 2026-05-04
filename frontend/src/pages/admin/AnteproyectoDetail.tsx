import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, downloadFile } from '../../lib/api';

export default function AnteproyectoDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<any>(null);

  useEffect(() => { (async () => {
    setData((await api.get(`/admin/anteproyectos/${id}`)).data);
  })(); }, [id]);

  if (!data) return <p className="text-inalde-gray">Cargando…</p>;

  return (
    <>
      <button onClick={() => navigate(-1)} className="text-sm text-inalde-gray hover:text-inalde-red mb-4">← Volver</button>

      <div className="border-b-[3px] border-inalde-red pb-4 mb-6 flex items-end justify-between gap-4">
        <div>
          <p className="section-subtitle mb-1">Anteproyecto · {data.estado}</p>
          <h1 className="section-title">{data.equipos.nombre_equipo ?? '(equipo sin nombre)'}</h1>
          <p className="text-xs text-inalde-gray mt-1">Cohorte {data.equipos.cohorte_id}</p>
        </div>
        <button
          onClick={() => downloadFile(
            `/admin/anteproyectos/${data.id}/pdf`,
            `anteproyecto-${(data.equipos.nombre_equipo ?? 'equipo').replace(/[^a-zA-Z0-9]/g, '_')}.pdf`
          )}
          className="btn-inalde-primary !py-2 !px-4 !text-xs whitespace-nowrap">
          ↓ Descargar PDF
        </button>
      </div>

      <h2 className="section-subtitle mb-3">Miembros</h2>
      <div className="space-y-2 mb-8">
        {data.equipos.miembros_equipo.sort((a: any, b: any) => a.posicion - b.posicion).map((m: any) => (
          <div key={m.posicion} className="flex items-center gap-3 text-sm">
            <span className="w-7 h-7 rounded-full bg-inalde-red text-white flex items-center justify-center font-primary font-bold text-xs">{m.posicion}</span>
            <span className="font-medium">{m.participantes_lista.nombre_completo}</span>
            {m.perfil && <span className="text-xs text-inalde-gold uppercase tracking-wider">{m.perfil}</span>}
            {m.fue_emprendedor && <span className="text-xs text-inalde-blue">ya fue emprendedor</span>}
          </div>
        ))}
      </div>

      <h2 className="section-subtitle mb-3">Proyectos</h2>
      <div className="space-y-6">
        {data.proyectos.sort((a: any, b: any) => a.posicion - b.posicion).map((p: any) => (
          <div key={p.id} className="border border-inalde-gray-light rounded p-5">
            <div className="flex items-start justify-between mb-3">
              <div>
                <h3 className="font-primary font-bold text-lg">{p.nombre}</h3>
                <p className="text-xs text-inalde-gray">
                  {p.tipo}{p.sector && ` · ${p.sector}`}{p.ciiu && ` · CIIU ${p.ciiu}`}
                </p>
              </div>
              <span className={`text-xs uppercase tracking-wider font-semibold ${
                p.estado_seleccion === 'definitivo' ? 'text-inalde-red' :
                p.estado_seleccion === 'archivado' ? 'text-inalde-gray' : 'text-inalde-gold'
              }`}>{p.estado_seleccion}</span>
            </div>
            <CanvasList p={p} />
            {p.hitos?.length > 0 && (
              <>
                <h4 className="text-xs font-semibold uppercase tracking-wider text-inalde-gray mt-4 mb-2">Cronograma</h4>
                <ol className="text-xs space-y-0.5 list-decimal pl-4">
                  {p.hitos.sort((a: any, b: any) => a.posicion - b.posicion).map((h: any, i: number) => (
                    <li key={i}>{h.descripcion} <span className="text-inalde-gray">({h.fecha_inicio} → {h.fecha_fin})</span></li>
                  ))}
                </ol>
              </>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

function CanvasList({ p }: { p: any }) {
  const fields: [string, string][] = [
    ['canvas_cliente_problema', 'Cliente / problema'],
    ['canvas_canales',          'Canales'],
    ['canvas_relaciones',       'Relación con clientes'],
    ['canvas_ingresos',         'Ingresos'],
    ['canvas_recursos',         'Recursos'],
    ['canvas_actividades',      'Actividades'],
    ['canvas_socios',           'Socios'],
    ['canvas_costos',           'Costos'],
  ];
  return (
    <div className="grid sm:grid-cols-2 gap-2 text-xs">
      {fields.map(([k, label]) => p[k] && (
        <div key={k} className="border-l-2 border-inalde-gray-light pl-2">
          <p className="text-inalde-gray uppercase tracking-wider text-[10px] mb-0.5">{label}</p>
          <p className="text-inalde-text">{p[k]}</p>
        </div>
      ))}
    </div>
  );
}
