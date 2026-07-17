import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';

type Modalidad = 'business_plan' | 'caso' | 'proyecto_investigacion';

interface Cohorte { id: string; etiqueta: string; activa: boolean; fecha_inicio?: string; }
interface Item {
  id: string; estado: string; fecha_envio: string | null; fecha_actualizacion: string;
  archivo_anteproyecto_path: string | null;
  archivo_proyecto_final_path: string | null;
  anteproyecto_aprobado_at: string | null;
  equipos: {
    id: string;
    nombre_equipo: string | null;
    cohorte_id: string;
    tipo_trabajo_grado: Modalidad;
    miembros_equipo?: Array<{ posicion: number; participantes_lista: { nombre_completo: string } | null }>;
  };
  proyectos: Array<{ id: string; nombre: string; sector: string | null; estado_seleccion: string }>;
}

const MODALIDAD_LABEL: Record<string, string> = {
  business_plan: 'Business Plan',
  caso: 'Caso',
  proyecto_investigacion: 'Proyecto de investigación',
};

// Orden de presentación en la tabla: BP → Caso → Proyecto de investigación
const ORDEN_MODALIDAD: Record<string, number> = {
  business_plan: 0,
  caso: 1,
  proyecto_investigacion: 2,
};

const MODALIDAD_CLS: Record<string, string> = {
  business_plan: 'bg-inalde-red/10 text-inalde-red',
  caso: 'bg-inalde-gold/15 text-[#8a7530]',
  proyecto_investigacion: 'bg-blue-100 text-blue-800',
};

/**
 * Estado mostrado en la tabla. Para Business Plan usa el `estado` real del
 * anteproyecto (borrador → enviado → revisado → aprobado). Para Caso/PI el
 * `estado` se queda en "borrador" para siempre (no hay transición); la entrega
 * real es la subida del archivo, así que derivamos el estado de los archivos y
 * la aprobación para no mostrar "Borrador" cuando ya fue entregado.
 */
function estadoDisplay(it: Item): { key: string; label: string; cls: string } {
  const modalidad = it.equipos?.tipo_trabajo_grado;
  if (modalidad === 'caso' || modalidad === 'proyecto_investigacion') {
    if (it.archivo_proyecto_final_path) return { key: 'proyecto_final', label: 'Proyecto final', cls: 'text-inalde-red' };
    if (it.anteproyecto_aprobado_at) return { key: 'aprobado', label: 'Aprobado', cls: 'text-inalde-red' };
    if (it.archivo_anteproyecto_path) return { key: 'entregado', label: 'Entregado', cls: 'text-inalde-blue' };
    return { key: 'borrador', label: 'Borrador', cls: 'text-inalde-gold' };
  }
  const map: Record<string, { label: string; cls: string }> = {
    borrador: { label: 'Borrador', cls: 'text-inalde-gold' },
    enviado: { label: 'Enviado', cls: 'text-inalde-blue' },
    revisado: { label: 'Revisado', cls: 'text-inalde-red' },
    aprobado: { label: 'Aprobado', cls: 'text-inalde-red' },
  };
  const m = map[it.estado] ?? { label: it.estado, cls: 'text-inalde-gray' };
  return { key: it.estado, label: m.label, cls: m.cls };
}

const ESTADO_LABELS: Record<string, string> = {
  borrador: 'Borrador',
  enviado: 'Enviado',
  entregado: 'Entregado',
  revisado: 'Revisado',
  aprobado: 'Aprobado',
  proyecto_final: 'Proyecto final',
};

export default function AnteproyectosList() {
  const [cohortes, setCohortes] = useState<Cohorte[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [cohorte, setCohorte] = useState('');
  const [tipo, setTipo] = useState('');
  const [estado, setEstado] = useState('');
  const [sector, setSector] = useState('');
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => { (async () => {
    // Solo cohortes activas en el dropdown, la más reciente primero.
    const data = (await api.get('/admin/cohortes')).data as Cohorte[];
    const activas = data.filter((c) => c.activa)
      .sort((a, b) => (b.fecha_inicio ?? '').localeCompare(a.fecha_inicio ?? ''));
    setCohortes(activas);
    // Por defecto se abre en la cohorte activa (la más reciente), no en "Todas":
    // es la que el admin quiere ver al entrar. Puede cambiar a "Todas" si quiere.
    if (activas.length) setCohorte((prev) => prev || activas[0].id);
  })(); }, []);

  // La cohorte se filtra en el servidor; tipo y estado se filtran en el cliente
  // (el estado mostrado es derivado para Caso/PI, no coincide con el de la BD).
  useEffect(() => { (async () => {
    setLoading(true);
    try {
      const params: any = {};
      if (cohorte) params.cohorte = cohorte;
      setItems((await api.get('/admin/anteproyectos', { params })).data);
    } finally { setLoading(false); }
  })(); }, [cohorte]);

  const etiquetaCohorte = useMemo(() => {
    const m = new Map(cohortes.map((c) => [c.id, c.etiqueta]));
    return (id: string) => m.get(id) ?? id;
  }, [cohortes]);

  // Opciones de estado presentes en los datos cargados (relevantes, sin vacíos)
  const estadosDisponibles = useMemo(() => {
    const set = new Set(items.map((it) => estadoDisplay(it).key));
    return Object.keys(ESTADO_LABELS).filter((k) => set.has(k));
  }, [items]);

  // Sectores presentes en los proyectos cargados (para el filtro de la columna)
  const sectoresDisponibles = useMemo(() => {
    return [...new Set(items.flatMap((it) => it.proyectos.map((p) => p.sector).filter(Boolean) as string[]))].sort();
  }, [items]);

  const filtrados = useMemo(() => items.filter((it) => {
    if (tipo && it.equipos?.tipo_trabajo_grado !== tipo) return false;
    if (estado && estadoDisplay(it).key !== estado) return false;
    if (sector && !it.proyectos.some((p) => p.sector === sector)) return false;
    return true;
  }).sort((a, b) =>
    (ORDEN_MODALIDAD[a.equipos?.tipo_trabajo_grado] ?? 9) - (ORDEN_MODALIDAD[b.equipos?.tipo_trabajo_grado] ?? 9)
  ), [items, tipo, estado, sector]);

  return (
    <>
      <div className="border-b-[3px] border-inalde-red pb-4 mb-6">
        <p className="section-subtitle mb-1">Administración</p>
        <h1 className="section-title">Anteproyectos</h1>
      </div>

      <div className="flex flex-wrap gap-3 mb-6">
        <select value={cohorte} onChange={(e) => setCohorte(e.target.value)} className="input-inalde !py-2">
          <option value="">Todas las cohortes</option>
          {cohortes.map((c) => <option key={c.id} value={c.id}>{c.etiqueta}</option>)}
        </select>
      </div>

      {loading ? <p className="text-inalde-gray">Cargando…</p> : (
        <div className="border border-inalde-gray-light rounded overflow-x-auto">
        <table className="w-full text-sm min-w-[760px]">
          <thead className="bg-inalde-gray-bg text-left">
            <tr>
              <th className="px-3 py-2 text-xs uppercase tracking-wider text-inalde-gray">Integrantes</th>
              <th className="px-3 py-2 text-xs uppercase tracking-wider text-inalde-gray">Cohorte</th>
              <th className="px-3 py-2 text-xs uppercase tracking-wider text-inalde-gray">
                <select value={tipo} onChange={(e) => setTipo(e.target.value)} title="Filtrar por modalidad"
                  className={`bg-transparent text-xs uppercase tracking-wider font-semibold cursor-pointer focus:outline-none ${tipo ? 'text-inalde-red' : 'text-inalde-gray'}`}>
                  <option value="">Modalidad ▾</option>
                  <option value="business_plan">Business Plan</option>
                  <option value="caso">Caso</option>
                  <option value="proyecto_investigacion">Proy. investigación</option>
                </select>
              </th>
              <th className="px-3 py-2 text-xs uppercase tracking-wider text-inalde-gray">Proyectos</th>
              <th className="px-3 py-2 text-xs uppercase tracking-wider text-inalde-gray">
                <select value={sector} onChange={(e) => setSector(e.target.value)} title="Filtrar por sector"
                  className={`bg-transparent text-xs uppercase tracking-wider font-semibold cursor-pointer focus:outline-none ${sector ? 'text-inalde-red' : 'text-inalde-gray'}`}>
                  <option value="">Sector ▾</option>
                  {sectoresDisponibles.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </th>
              <th className="px-3 py-2 text-xs uppercase tracking-wider text-inalde-gray">
                <select value={estado} onChange={(e) => setEstado(e.target.value)} title="Filtrar por estado"
                  className={`bg-transparent text-xs uppercase tracking-wider font-semibold cursor-pointer focus:outline-none ${estado ? 'text-inalde-red' : 'text-inalde-gray'}`}>
                  <option value="">Estado ▾</option>
                  {estadosDisponibles.map((k) => <option key={k} value={k}>{ESTADO_LABELS[k]}</option>)}
                </select>
              </th>
            </tr>
          </thead>
          <tbody>
            {filtrados.map((it) => {
              const est = estadoDisplay(it);
              const modalidad = it.equipos?.tipo_trabajo_grado;
              return (
              <tr key={it.id} className="border-t border-inalde-gray-light hover:bg-inalde-gray-bg/40 cursor-pointer"
                onClick={() => navigate(`/admin/anteproyectos/${it.id}`)}>
                <td className="px-3 py-2">
                  {(() => {
                    const miembros = (it.equipos.miembros_equipo ?? [])
                      .slice()
                      .sort((a, b) => (a.posicion ?? 0) - (b.posicion ?? 0))
                      .map((m) => m.participantes_lista?.nombre_completo)
                      .filter(Boolean);
                    if (!miembros.length) return <em className="text-inalde-gray">sin integrantes</em>;
                    return (
                      <ul className="text-xs leading-snug space-y-0.5">
                        {miembros.map((n, i) => <li key={i}>{n}</li>)}
                      </ul>
                    );
                  })()}
                </td>
                <td className="px-3 py-2 text-xs text-inalde-gray">{etiquetaCohorte(it.equipos.cohorte_id)}</td>
                <td className="px-3 py-2">
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider whitespace-nowrap ${MODALIDAD_CLS[modalidad] ?? 'bg-inalde-gray-light text-inalde-gray'}`}>
                    {MODALIDAD_LABEL[modalidad] ?? modalidad}
                  </span>
                </td>
                <td className="px-3 py-2 text-xs">
                  {it.proyectos.map((p) => (
                    <div key={p.id}>
                      <span className={p.estado_seleccion === 'archivado' ? 'text-inalde-gray line-through' : 'text-inalde-text'}>
                        {p.nombre}
                      </span>
                    </div>
                  ))}
                </td>
                <td className="px-3 py-2 text-xs text-inalde-gray">
                  {it.proyectos.length
                    ? it.proyectos.map((p) => <div key={p.id}>{p.sector || <span className="italic">—</span>}</div>)
                    : <span className="italic">—</span>}
                </td>
                <td className="px-3 py-2">
                  <span className={`text-xs uppercase tracking-wider font-semibold ${est.cls}`}>{est.label}</span>
                </td>
              </tr>
              );
            })}
            {filtrados.length === 0 && <tr><td colSpan={6} className="px-3 py-8 text-center text-inalde-gray">Sin anteproyectos</td></tr>}
          </tbody>
        </table>
        </div>
      )}

      {!loading && items.length > 0 && (
        <p className="text-[11px] text-inalde-gray mt-2">
          Mostrando <strong className="text-inalde-text">{filtrados.length}</strong> de {items.length} anteproyectos
        </p>
      )}
    </>
  );
}
