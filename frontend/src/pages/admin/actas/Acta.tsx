import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../../lib/api';
import { formatBackendError } from '../../../lib/errors';

// Actas de Grado — vista fiel del Acta v3 (dentro de /admin, sin Header propio).
// Renderiza el Formato de Acta Proyecto de Grado MBA (versión 3) con la cadena de
// firmas, la nota y las observaciones. Permite editar observaciones y fijar la nota.

type Modalidad = 'business_plan' | 'caso' | 'proyecto_investigacion';
type Nota = 'aceptado' | 'rechazado' | null;

interface Firma { rol: string; nombre: string; estado: string; fecha?: string | null; }
type Jurado = string | { nombre: string; email?: string };
interface Acta {
  cohorte_id: string;
  nombre_participante: string;
  nombre_proyecto: string;
  modalidad: Modalidad;
  fecha_sustentacion: string | null;
  lugar: string | null;
  director_nombre: string | null;
  jurados: Jurado[];
  nota: Nota;
  observaciones: string | null;
  director_mba_nombre: string | null;
  director_mba_cargo: string | null;
  firmas: Firma[];
  estado: string;
  faltan: string[];
}

const MODALIDADES: { key: Modalidad; label: string }[] = [
  { key: 'business_plan', label: 'Business Plan' },
  { key: 'caso', label: 'Caso' },
  { key: 'proyecto_investigacion', label: 'Proyecto de Investigación' },
];

function nombreJurado(j: Jurado): string {
  return typeof j === 'string' ? j : j.nombre;
}

function fmtFecha(f?: string | null): string {
  if (!f) return '—';
  const d = new Date(f);
  return isNaN(d.getTime()) ? f : d.toLocaleDateString('es-CO', { year: 'numeric', month: 'long', day: 'numeric' });
}

// Estado de una firma dentro del acta.
function FirmaEstado({ firma }: { firma?: Firma }) {
  if (firma && firma.estado === 'firmada') {
    return (
      <span className="text-xs text-green-700 font-semibold whitespace-nowrap">
        ✓ Firmada{firma.fecha ? ` · ${fmtFecha(firma.fecha)}` : ''}
      </span>
    );
  }
  return <span className="text-xs text-inalde-gray whitespace-nowrap">○ Pendiente</span>;
}

// Bloque de una línea de firma (nombre + cargo + estado).
function BloqueFirma({ titulo, nombre, cargo, firma }: { titulo: string; nombre?: string | null; cargo?: string | null; firma?: Firma }) {
  return (
    <div className="border-t-2 border-inalde-text pt-2 mt-8">
      <p className="text-[0.65rem] uppercase tracking-wider font-semibold text-inalde-gray">{titulo}</p>
      <div className="flex items-baseline justify-between gap-3 mt-1">
        <p className="font-primary font-bold text-sm text-inalde-text">{nombre || '—'}</p>
        <FirmaEstado firma={firma} />
      </div>
      {cargo && <p className="text-xs text-inalde-gray">{cargo}</p>}
    </div>
  );
}

export default function Acta() {
  const { id } = useParams<{ id: string }>();
  const [acta, setActa] = useState<Acta | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [okMsg, setOkMsg] = useState('');

  const [obs, setObs] = useState('');
  const [guardandoObs, setGuardandoObs] = useState(false);
  const [guardandoNota, setGuardandoNota] = useState(false);

  const cargar = useCallback(async () => {
    if (!id) return;
    setLoading(true); setErr('');
    try {
      const r = await api.get(`/actas/${id}`);
      const d = r.data as Acta;
      setActa(d);
      setObs(d.observaciones ?? '');
    } catch (e) {
      setErr(formatBackendError(e));
      setActa(null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { void cargar(); }, [cargar]);

  // Busca la firma por rol (coincidencia flexible).
  function firmaDe(...roles: string[]): Firma | undefined {
    if (!acta) return undefined;
    return acta.firmas.find((f) => roles.some((r) => f.rol.toLowerCase().includes(r)));
  }

  async function guardarObs() {
    if (!id) return;
    setGuardandoObs(true); setErr(''); setOkMsg('');
    try {
      await api.post(`/actas/${id}`, { observaciones: obs });
      setOkMsg('Observaciones guardadas.');
      await cargar();
    } catch (e) {
      setErr(formatBackendError(e));
    } finally {
      setGuardandoObs(false);
    }
  }

  async function guardarNota(nota: Exclude<Nota, null>) {
    if (!id) return;
    setGuardandoNota(true); setErr(''); setOkMsg('');
    try {
      await api.post(`/actas/${id}`, { nota });
      setOkMsg('Resultado registrado.');
      await cargar();
    } catch (e) {
      setErr(formatBackendError(e));
    } finally {
      setGuardandoNota(false);
    }
  }

  if (loading) return <p className="text-inalde-gray text-sm">Cargando acta…</p>;

  if (!acta) {
    return (
      <>
        {err && <div className="mb-6 rounded border-l-4 border-inalde-red bg-red-50 px-4 py-3 text-sm whitespace-pre-wrap">{err}</div>}
        <Link to="/admin/actas" className="text-xs text-inalde-gray hover:text-inalde-red">← Volver al panel</Link>
      </>
    );
  }

  const esBP = acta.modalidad === 'business_plan';

  return (
    <>
      <div className="flex items-center justify-between gap-4 mb-6">
        <Link to="/admin/actas" className="text-xs text-inalde-gray hover:text-inalde-red">← Volver al panel</Link>
        {acta.faltan.length > 0 && (
          <span className="text-[10px] uppercase tracking-wider font-semibold text-inalde-red">Faltan datos: {acta.faltan.join(', ')}</span>
        )}
      </div>

      {err && <div className="mb-6 rounded border-l-4 border-inalde-red bg-red-50 px-4 py-3 text-sm whitespace-pre-wrap">{err}</div>}
      {okMsg && <div className="mb-6 rounded border-l-4 border-green-600 bg-green-50 px-4 py-3 text-sm text-green-800">{okMsg}</div>}

      {/* Hoja del acta v3 */}
      <div className="bg-white border-2 border-inalde-gray-light rounded-lg shadow-inalde-card max-w-3xl mx-auto">
        {/* Encabezado institucional */}
        <div className="border-b-[3px] border-inalde-red px-6 sm:px-10 py-5 flex items-center gap-4">
          <img src="/inalde-logo.jpg" alt="INALDE Business School" className="h-12 w-auto" />
          <div className="border-l border-inalde-gray-light pl-4">
            <p className="font-primary font-extrabold text-[0.7rem] tracking-widest uppercase text-inalde-text">INALDE Business School</p>
            <p className="text-[0.62rem] uppercase tracking-wider text-inalde-gray leading-tight mt-0.5">
              Proceso Ejecución de Programas · Formato de Acta Proyecto de Grado MBA · Versión 3
            </p>
          </div>
        </div>

        <div className="px-6 sm:px-10 py-8">
          <h1 className="font-primary font-extrabold text-lg text-center text-inalde-text uppercase tracking-wide mb-8">
            Acta de Evaluación — Sustentación Proyecto de Grado
          </h1>

          {/* Modalidad (checkbox X en la que aplica) */}
          <div className="flex flex-wrap gap-5 justify-center mb-8">
            {MODALIDADES.map((m) => {
              const marcada = acta.modalidad === m.key;
              return (
                <span key={m.key} className="inline-flex items-center gap-2 text-sm">
                  <span className={`inline-flex items-center justify-center w-5 h-5 border-2 font-bold ${marcada ? 'border-inalde-red text-inalde-red' : 'border-inalde-gray-light text-transparent'}`}>X</span>
                  <span className={marcada ? 'font-semibold text-inalde-text' : 'text-inalde-gray'}>{m.label}</span>
                </span>
              );
            })}
          </div>

          {/* Fecha y lugar */}
          <div className="grid sm:grid-cols-2 gap-4 mb-6">
            <div>
              <p className="text-[0.65rem] uppercase tracking-wider font-semibold text-inalde-gray">Fecha de sustentación</p>
              <p className="text-sm text-inalde-text border-b border-inalde-gray-light py-1">{fmtFecha(acta.fecha_sustentacion)}</p>
            </div>
            <div>
              <p className="text-[0.65rem] uppercase tracking-wider font-semibold text-inalde-gray">Lugar</p>
              <p className="text-sm text-inalde-text border-b border-inalde-gray-light py-1">{acta.lugar || '—'}</p>
            </div>
          </div>

          {/* Participante */}
          <div className="mb-6">
            <p className="text-[0.65rem] uppercase tracking-wider font-semibold text-inalde-gray">Nombre del participante</p>
            <div className="flex items-baseline justify-between gap-3 border-b border-inalde-gray-light py-1">
              <p className="text-sm font-semibold text-inalde-text">{acta.nombre_participante}</p>
              <FirmaEstado firma={firmaDe('participante')} />
            </div>
          </div>

          {/* Proyecto */}
          <div className="mb-6">
            <p className="text-[0.65rem] uppercase tracking-wider font-semibold text-inalde-gray">Nombre del proyecto</p>
            <p className="text-sm text-inalde-text border-b border-inalde-gray-light py-1">{acta.nombre_proyecto || '—'}</p>
          </div>

          {/* Director del proyecto */}
          <div className="mb-6">
            <p className="text-[0.65rem] uppercase tracking-wider font-semibold text-inalde-gray">Director del proyecto</p>
            <div className="flex items-baseline justify-between gap-3 border-b border-inalde-gray-light py-1">
              <p className="text-sm text-inalde-text">{acta.director_nombre || '—'}</p>
              <FirmaEstado firma={firmaDe('director de proyecto', 'director_proyecto', 'director del proyecto')} />
            </div>
          </div>

          {/* Sustentación / jurados */}
          <div className="mb-6">
            <p className="text-[0.65rem] uppercase tracking-wider font-semibold text-inalde-gray mb-2">Sustentación</p>
            {esBP ? (
              <p className="text-sm text-inalde-gray italic">Business Plan — sin jurados.</p>
            ) : acta.jurados.length === 0 ? (
              <p className="text-sm text-inalde-red">Pendiente: aún no se han registrado los jurados.</p>
            ) : (
              <div className="flex flex-col gap-1">
                {acta.jurados.map((j, i) => {
                  const nombre = nombreJurado(j);
                  return (
                    <div key={i} className="flex items-baseline justify-between gap-3 border-b border-inalde-gray-light py-1">
                      <p className="text-sm text-inalde-text">Jurado {i + 1}: {nombre}</p>
                      <FirmaEstado firma={firmaDe(`jurado ${i + 1}`, nombre.toLowerCase())} />
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Nota */}
          <div className="mb-6">
            <p className="text-[0.65rem] uppercase tracking-wider font-semibold text-inalde-gray mb-1">Nota / resultado</p>
            {acta.nota ? (
              <span className={`inline-block text-sm font-primary font-bold uppercase tracking-wider px-3 py-1 rounded ${acta.nota === 'aceptado' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-inalde-red'}`}>
                {acta.nota === 'aceptado' ? 'Aceptado' : 'Rechazado'}
              </span>
            ) : (
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn-inalde-secondary" onClick={() => guardarNota('aceptado')} disabled={guardandoNota}>Aceptado</button>
                <button type="button" className="btn-inalde-ghost" onClick={() => guardarNota('rechazado')} disabled={guardandoNota}>Rechazado</button>
                <span className="text-xs text-inalde-gray self-center">Selecciona el resultado de la sustentación.</span>
              </div>
            )}
          </div>

          {/* Observaciones (editable) */}
          <div className="mb-8">
            <p className="text-[0.65rem] uppercase tracking-wider font-semibold text-inalde-gray mb-1">Observaciones</p>
            <textarea className="input-inalde min-h-[110px] resize-y !text-sm" value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Observaciones del jurado / director…" />
            <div className="mt-2">
              <button type="button" className="btn-inalde-secondary" onClick={guardarObs} disabled={guardandoObs || obs === (acta.observaciones ?? '')}>
                {guardandoObs ? 'Guardando…' : 'Guardar observaciones'}
              </button>
            </div>
          </div>

          {/* Cierre — Director MBA */}
          <BloqueFirma
            titulo="Cierre — Director MBA"
            nombre={acta.director_mba_nombre}
            cargo={acta.director_mba_cargo}
            firma={firmaDe('director mba', 'director_mba', 'mba')}
          />
        </div>
      </div>

      <div className="mt-8 text-center">
        <Link to="/admin/actas" className="text-xs text-inalde-gray hover:text-inalde-red">← Volver al panel</Link>
      </div>
    </>
  );
}
