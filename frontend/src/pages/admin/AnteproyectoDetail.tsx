import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, downloadFile } from '../../lib/api';
import { formatBackendError } from '../../lib/errors';
import { BarraProgreso } from '../../components/inalde/BarraProgreso';

type Modalidad = 'business_plan' | 'caso' | 'proyecto_investigacion';

const MODALIDAD_LABEL: Record<Modalidad, string> = {
  business_plan: 'Business Plan',
  caso: 'Caso',
  proyecto_investigacion: 'Proyecto de Investigación',
};

export default function AnteproyectoDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  // Carga de documentos por el administrador, en nombre del equipo.
  const [subiendo, setSubiendo] = useState<string | null>(null);
  const [progreso, setProgreso] = useState<number | null>(null);

  async function load() {
    try { setData((await api.get(`/admin/anteproyectos/${id}`)).data); }
    catch (e: any) { setMsg({ kind: 'err', text: formatBackendError(e) }); }
  }
  useEffect(() => { load(); }, [id]);

  async function aprobar() {
    if (!data) return;
    if (!confirm('¿Aprobar este anteproyecto? El participante podrá cargar el proyecto final cuando se cumpla el cronograma.')) return;
    setBusy(true); setMsg(null);
    try {
      await api.post(`/anteproyectos/${data.id}/aprobar`);
      setMsg({ kind: 'ok', text: 'Anteproyecto aprobado. El participante ya puede cargar el proyecto final.' });
      await load();
    } catch (e: any) {
      setMsg({ kind: 'err', text: formatBackendError(e) });
    } finally { setBusy(false); }
  }

  /**
   * Sube un documento EN NOMBRE del equipo. Usa la ruta de administración, que
   * a diferencia de la del participante ignora las fechas límite del
   * cronograma y permite reemplazar un documento ya entregado. Cada carga
   * queda registrada en la auditoría.
   */
  async function subirPorElEquipo(tipo: 'anteproyecto' | 'avance' | 'proyecto-final', file: File) {
    const equipoId = data?.equipos?.id ?? data?.equipo_id;
    if (!equipoId) { setMsg({ kind: 'err', text: 'No pudimos identificar el equipo de este anteproyecto.' }); return; }
    const yaHay = tipo === 'anteproyecto' ? data.archivo_anteproyecto_path
                : tipo === 'avance' ? data.archivo_avance_path
                : data.archivo_proyecto_final_path;
    const etiqueta = tipo === 'proyecto-final' ? 'el proyecto final' : `el ${tipo}`;
    const aviso = yaHay
      ? `Ya hay un archivo cargado para ${etiqueta}. Si continúas lo reemplazarás y el anterior se perderá. ¿Seguir?`
      : `Vas a cargar ${etiqueta} en nombre del equipo, sin las restricciones de fecha del cronograma. ¿Seguir?`;
    if (!confirm(aviso)) return;

    setSubiendo(tipo); setProgreso(0); setMsg(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      await api.post(`/admin/equipos/${equipoId}/archivo/${tipo}`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 0,
        onUploadProgress: (ev) => {
          const total = ev.total ?? file.size;
          setProgreso(total ? Math.round((ev.loaded * 100) / total) : 100);
        },
      });
      setMsg({ kind: 'ok', text: yaHay ? 'Documento reemplazado. Queda registrado en la auditoría.' : 'Documento cargado. Queda registrado en la auditoría.' });
      await load();
    } catch (e: any) {
      setMsg({ kind: 'err', text: formatBackendError(e) });
    } finally {
      setSubiendo(null); setProgreso(null);
    }
  }

  async function abrirArchivo(tipo: 'anteproyecto' | 'avance' | 'proyecto-final') {
    if (!data) return;
    try {
      const r = await api.get(`/anteproyectos/${data.id}/archivo/${tipo}`);
      if (r.data?.url) window.open(r.data.url, '_blank', 'noopener,noreferrer');
    } catch (e: any) {
      setMsg({ kind: 'err', text: formatBackendError(e) });
    }
  }

  if (!data) return <p className="text-inalde-gray">Cargando…</p>;

  const modalidad: Modalidad = data.equipos?.tipo_trabajo_grado ?? 'business_plan';
  const esArchivos = modalidad === 'caso' || modalidad === 'proyecto_investigacion';

  return (
    <>
      <button onClick={() => navigate(-1)} className="text-sm text-inalde-gray hover:text-inalde-red mb-4">← Volver</button>

      <div className="border-b-[3px] border-inalde-red pb-4 mb-6 flex items-end justify-between gap-4">
        <div>
          <p className="section-subtitle mb-1">
            {MODALIDAD_LABEL[modalidad]} · {data.estado}
          </p>
          <h1 className="section-title">{data.equipos.nombre_equipo || data.proyectos?.[0]?.nombre || 'Anteproyecto'}</h1>
          <p className="text-xs text-inalde-gray mt-1">Cohorte {data.equipos.cohorte_id}</p>
        </div>
        {!esArchivos && (
          <button
            onClick={() => downloadFile(
              `/admin/anteproyectos/${data.id}/pdf`,
              `anteproyecto-${(data.equipos.nombre_equipo ?? 'equipo').replace(/[^a-zA-Z0-9]/g, '_')}.pdf`,
            )}
            className="btn-inalde-primary !py-2 !px-4 !text-xs whitespace-nowrap">
            ↓ Descargar PDF
          </button>
        )}
      </div>

      {msg && (
        <div className={`rounded border-l-4 px-4 py-3 text-sm mb-6 whitespace-pre-line ${msg.kind === 'ok' ? 'border-inalde-blue bg-blue-50' : 'border-inalde-red bg-red-50'}`}>
          {msg.text}
        </div>
      )}

      {esArchivos ? (
        <CasoPIView data={data} busy={busy} onAprobar={aprobar} onAbrirArchivo={abrirArchivo}
          subiendo={subiendo} progreso={progreso} onSubir={subirPorElEquipo} />
      ) : (
        <BusinessPlanView data={data} />
      )}
    </>
  );
}

// =============================================================================
// Vista para Caso / Proyecto de Investigación
// =============================================================================
/**
 * Botón de carga del administrador para un documento del equipo.
 *
 * Va siempre con el aviso de que es una carga excepcional: se salta el
 * cronograma y sustituye lo que el equipo debía entregar por su cuenta.
 */
function CargaAdmin(props: {
  yaExiste: boolean;
  subiendo: boolean;
  progreso: number | null;
  onFile: (f: File) => void;
}) {
  const { yaExiste, subiendo, progreso, onFile } = props;
  return (
    <div className="mt-4 pt-4 border-t border-inalde-gray-light">
      {subiendo ? (
        <BarraProgreso porcentaje={progreso ?? 0} />
      ) : (
        <>
          <label className="inline-block text-[11px] font-semibold text-inalde-blue hover:underline cursor-pointer">
            {yaExiste ? '↻ Reemplazar por el equipo' : '↑ Cargar por el equipo'}
            <input
              type="file"
              accept="application/pdf"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }}
            />
          </label>
          <p className="text-[10px] text-inalde-gray mt-1 italic">
            Carga administrativa: no aplica la fecha límite del cronograma y queda en la auditoría.
          </p>
        </>
      )}
    </div>
  );
}

function CasoPIView({
  data, busy, onAprobar, onAbrirArchivo, subiendo, progreso, onSubir,
}: {
  data: any;
  busy: boolean;
  onAprobar: () => void;
  onAbrirArchivo: (tipo: 'anteproyecto' | 'avance' | 'proyecto-final') => void;
  subiendo: string | null;
  progreso: number | null;
  onSubir: (tipo: 'anteproyecto' | 'avance' | 'proyecto-final', f: File) => void;
}) {
  const director = data.equipos?.director;
  const miembro = data.equipos?.miembros_equipo?.[0]?.participantes_lista;
  const anteproyectoPath = data.archivo_anteproyecto_path as string | null;
  const avancePath = data.archivo_avance_path as string | null;
  const proyectoFinalPath = data.archivo_proyecto_final_path as string | null;
  const aprobadoAt = data.anteproyecto_aprobado_at as string | null;

  return (
    <>
      <h2 className="section-subtitle mb-3">Participante</h2>
      <p className="mb-6 text-inalde-text font-medium">
        {miembro?.nombre_completo ?? '—'}
      </p>

      <h2 className="section-subtitle mb-3">Director asignado</h2>
      <p className="mb-6 text-inalde-text">
        {director?.nombre_completo ?? <span className="italic text-inalde-gray">Aún no ha elegido director</span>}
      </p>

      {/* === Anteproyecto =================================================== */}
      <div className="border border-inalde-gray-light rounded p-5 mb-5">
        <div className="flex items-start justify-between gap-3 mb-2">
          <h3 className="font-primary font-bold text-base">Anteproyecto</h3>
          {aprobadoAt && <span className="text-xs uppercase tracking-wider text-inalde-blue font-semibold">✓ Aprobado</span>}
        </div>
        {anteproyectoPath ? (
          <>
            <p className="text-sm text-inalde-gray mb-2">
              Cargado el {new Date(data.archivo_anteproyecto_uploaded_at).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' })}
            </p>
            <button onClick={() => onAbrirArchivo('anteproyecto')}
              className="text-inalde-red font-semibold hover:underline text-sm">
              Ver / descargar →
            </button>
            {!aprobadoAt && (
              <div className="mt-5 pt-4 border-t border-inalde-gray-light">
                <p className="text-sm text-inalde-gray mb-3">
                  Al aprobar, el participante quedará habilitado para cargar el proyecto final
                  (sujeto al cronograma de la cohorte).
                </p>
                <button onClick={onAprobar} disabled={busy}
                  className="btn-inalde-primary !py-2 !px-4 !text-xs disabled:opacity-40">
                  {busy ? 'Aprobando…' : 'Aprobar anteproyecto →'}
                </button>
              </div>
            )}
            {aprobadoAt && (
              <p className="text-xs text-inalde-gray mt-3 italic">
                Aprobado el {new Date(aprobadoAt).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' })}
              </p>
            )}
          </>
        ) : (
          <p className="text-sm text-inalde-gray italic">El participante aún no ha cargado el anteproyecto.</p>
        )}
        <CargaAdmin yaExiste={!!anteproyectoPath} subiendo={subiendo === 'anteproyecto'} progreso={progreso}
          onFile={(f) => onSubir('anteproyecto', f)} />
      </div>

      {/* === Avance (entrega intermedia) ================================== */}
      <div className="border border-inalde-gray-light rounded p-5 mb-5">
        <h3 className="font-primary font-bold text-base mb-2">Avance <span className="text-xs font-normal text-inalde-gray">· entrega intermedia</span></h3>
        {avancePath ? (
          <>
            <p className="text-sm text-inalde-gray mb-2">
              Cargado el {new Date(data.archivo_avance_uploaded_at).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' })}
            </p>
            <button onClick={() => onAbrirArchivo('avance')}
              className="text-inalde-red font-semibold hover:underline text-sm">
              Ver / descargar →
            </button>
          </>
        ) : (
          <p className="text-sm text-inalde-gray italic">
            {anteproyectoPath
              ? 'El participante aún no ha cargado el avance.'
              : 'Bloqueado hasta que se cargue el anteproyecto.'}
          </p>
        )}
        <CargaAdmin yaExiste={!!avancePath} subiendo={subiendo === 'avance'} progreso={progreso}
          onFile={(f) => onSubir('avance', f)} />
      </div>

      {/* === Proyecto final ================================================ */}
      <div className="border border-inalde-gray-light rounded p-5 mb-6">
        <h3 className="font-primary font-bold text-base mb-2">Proyecto final</h3>
        {proyectoFinalPath ? (
          <>
            <p className="text-sm text-inalde-gray mb-2">
              Cargado el {new Date(data.archivo_proyecto_final_uploaded_at).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' })}
            </p>
            <button onClick={() => onAbrirArchivo('proyecto-final')}
              className="text-inalde-red font-semibold hover:underline text-sm">
              Ver / descargar →
            </button>
          </>
        ) : (
          <p className="text-sm text-inalde-gray italic">
            {avancePath
              ? 'El participante puede cargar el proyecto final (dentro del cronograma).'
              : 'Bloqueado hasta que el participante cargue su avance.'}
          </p>
        )}
        <CargaAdmin yaExiste={!!proyectoFinalPath} subiendo={subiendo === 'proyecto-final'} progreso={progreso}
          onFile={(f) => onSubir('proyecto-final', f)} />
      </div>
    </>
  );
}

// =============================================================================
// Vista para Business Plan (la original, intacta)
// =============================================================================
function BusinessPlanView({ data }: { data: any }) {
  return (
    <>
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
    ['canvas_cliente',  'Cliente'],
    ['canvas_problema', 'Problema'],
    ['canvas_solucion', 'Solución'],
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
