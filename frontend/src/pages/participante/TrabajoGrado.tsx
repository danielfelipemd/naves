import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Header } from '../../components/inalde/Header';
import { api } from '../../lib/api';
import { formatBackendError } from '../../lib/errors';

type Modalidad = 'business_plan' | 'caso' | 'proyecto_investigacion';
type TipoArchivo = 'anteproyecto' | 'proyecto-final';

interface Anteproyecto {
  id: string;
  equipo_id: string;
  estado: 'borrador' | 'enviado' | 'revisado' | 'aprobado';
  archivo_anteproyecto_path: string | null;
  archivo_anteproyecto_mime: string | null;
  archivo_anteproyecto_uploaded_at: string | null;
  archivo_anteproyecto_url?: string;
  archivo_proyecto_final_path: string | null;
  archivo_proyecto_final_mime: string | null;
  archivo_proyecto_final_uploaded_at: string | null;
  archivo_proyecto_final_url?: string;
  equipos: { id: string; tipo_trabajo_grado: Modalidad };
}

const MIME_ANTEPROYECTO_ACCEPT = '.pdf,application/pdf';
const MIME_PROYECTO_FINAL_ACCEPT =
  '.pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const TITULO_MODALIDAD: Record<Modalidad, string> = {
  business_plan: 'Business Plan NAVES',
  caso: 'Caso',
  proyecto_investigacion: 'Proyecto de Investigación',
};

function nombreArchivoDePath(path: string | null): string {
  if (!path) return '';
  const parts = path.split('/');
  return parts[parts.length - 1] ?? path;
}

function formatoFecha(iso: string | null): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return iso;
  }
}

export default function TrabajoGrado() {
  const navigate = useNavigate();
  const [ant, setAnt] = useState<Anteproyecto | null>(null);
  const [tieneEquipo, setTieneEquipo] = useState<boolean | null>(null);
  const [cargando, setCargando] = useState(true);
  const [subiendo, setSubiendo] = useState<TipoArchivo | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inputAntRef = useRef<HTMLInputElement>(null);
  const inputFinalRef = useRef<HTMLInputElement>(null);

  async function cargar() {
    setCargando(true); setError(null);
    try {
      const { data } = await api.get('/anteproyectos/mi-anteproyecto');
      const a = data?.anteproyecto as Anteproyecto | null;
      setAnt(a);
      setTieneEquipo(!!a);
    } catch (e: any) {
      setError(formatBackendError(e));
      setTieneEquipo(null);
    } finally {
      setCargando(false);
    }
  }

  useEffect(() => { cargar(); }, []);

  async function subir(tipo: TipoArchivo, file: File) {
    if (!ant) return;
    setSubiendo(tipo); setError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      await api.post(`/anteproyectos/${ant.id}/archivo/${tipo}`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      await cargar();
    } catch (e: any) {
      setError(formatBackendError(e));
    } finally {
      setSubiendo(null);
      if (tipo === 'anteproyecto' && inputAntRef.current) inputAntRef.current.value = '';
      if (tipo === 'proyecto-final' && inputFinalRef.current) inputFinalRef.current.value = '';
    }
  }

  async function abrirArchivo(tipo: TipoArchivo) {
    if (!ant) return;
    try {
      const { data } = await api.get(`/anteproyectos/${ant.id}/archivo/${tipo}`);
      if (data?.url) window.open(data.url, '_blank', 'noopener,noreferrer');
    } catch (e: any) {
      setError(formatBackendError(e));
    }
  }

  async function enviarDefinitivo() {
    if (!ant) return;
    if (!confirm('Vas a enviar tu trabajo de grado de forma definitiva. ¿Confirmas?')) return;
    setEnviando(true); setError(null);
    try {
      await api.post(`/anteproyectos/${ant.id}/enviar`);
      await cargar();
    } catch (e: any) {
      setError(formatBackendError(e));
    } finally {
      setEnviando(false);
    }
  }

  if (cargando) {
    return <><Header /><main className="pt-36 text-center text-inalde-gray">Cargando…</main></>;
  }

  // Sin equipo: solo posible para business_plan (caso/PI auto-crean el equipo invisible).
  // Para BP enviamos al participante a la pantalla de formacion de equipo.
  if (!tieneEquipo) {
    return (
      <>
        <Header />
        <main className="pt-36 pb-16 px-4">
          <div className="max-w-[700px] mx-auto bg-white rounded-lg shadow-inalde-card p-5 sm:p-10">
            <div className="border-b-[3px] border-inalde-red pb-5 mb-8">
              <h1 className="section-title">Trabajo de grado</h1>
            </div>
            <p className="text-inalde-gray mb-6">
              Para el Business Plan necesitas formar tu equipo primero. Después podrás trabajar
              en el anteproyecto y el proyecto final.
            </p>
            <button onClick={() => navigate('/equipo')} className="btn-inalde-primary">
              Ir a Mi equipo →
            </button>
          </div>
        </main>
      </>
    );
  }

  const modalidad = ant?.equipos?.tipo_trabajo_grado;
  const bloqueado = !!ant && ant.estado !== 'borrador';
  const ambosSubidos = !!(ant?.archivo_anteproyecto_path && ant?.archivo_proyecto_final_path);

  return (
    <>
      <Header />
      <main className="pt-36 pb-16 px-4">
        <div className="max-w-[800px] mx-auto bg-white rounded-lg shadow-inalde-card p-5 sm:p-10">
          <div className="border-b-[3px] border-inalde-red pb-5 mb-8">
            <p className="section-subtitle mb-2">Trabajo de grado</p>
            <h1 className="section-title">
              {modalidad ? TITULO_MODALIDAD[modalidad] : 'Modalidad'}
            </h1>
          </div>

          {error && (
            <div className="rounded border-l-4 border-inalde-red bg-red-50 px-4 py-3 text-sm mb-6 whitespace-pre-line">
              {error}
            </div>
          )}

          {bloqueado && (
            <div className="rounded border-l-4 border-inalde-gold bg-amber-50 px-4 py-3 text-sm mb-6">
              Tu trabajo de grado está en estado <strong>{ant!.estado}</strong>. No se aceptan más cambios.
            </div>
          )}

          <p className="text-inalde-gray mb-8 text-sm">
            Sube los dos archivos: el <strong>anteproyecto</strong> en PDF y el <strong>proyecto final</strong> en
            PDF o Word. Tamaño máximo: 25 MB cada uno. Puedes reemplazarlos las veces que quieras hasta enviar.
          </p>

          {/* Bloque 1: Anteproyecto */}
          <div className="border border-inalde-gray-light rounded p-5 mb-5">
            <h2 className="font-primary font-bold text-base mb-2">Anteproyecto (PDF)</h2>
            {ant?.archivo_anteproyecto_path ? (
              <div className="text-sm text-inalde-gray mb-3">
                <p>
                  ✅ Subido el {formatoFecha(ant.archivo_anteproyecto_uploaded_at)} —{' '}
                  <span className="text-inalde-text">{nombreArchivoDePath(ant.archivo_anteproyecto_path)}</span>
                </p>
                <button
                  onClick={() => abrirArchivo('anteproyecto')}
                  className="text-inalde-red font-semibold hover:underline text-sm mt-1"
                >
                  Ver / descargar →
                </button>
              </div>
            ) : (
              <p className="text-sm text-inalde-gray italic mb-3">Aún no has subido el anteproyecto.</p>
            )}

            {!bloqueado && (
              <div className="flex items-center gap-3">
                <input
                  ref={inputAntRef}
                  type="file"
                  accept={MIME_ANTEPROYECTO_ACCEPT}
                  disabled={!!subiendo}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) subir('anteproyecto', f);
                  }}
                  className="text-sm"
                />
                {subiendo === 'anteproyecto' && <span className="text-xs text-inalde-gray">Subiendo…</span>}
              </div>
            )}
          </div>

          {/* Bloque 2: Proyecto final */}
          <div className="border border-inalde-gray-light rounded p-5 mb-8">
            <h2 className="font-primary font-bold text-base mb-2">Proyecto final (PDF o Word)</h2>
            {ant?.archivo_proyecto_final_path ? (
              <div className="text-sm text-inalde-gray mb-3">
                <p>
                  ✅ Subido el {formatoFecha(ant.archivo_proyecto_final_uploaded_at)} —{' '}
                  <span className="text-inalde-text">{nombreArchivoDePath(ant.archivo_proyecto_final_path)}</span>
                </p>
                <button
                  onClick={() => abrirArchivo('proyecto-final')}
                  className="text-inalde-red font-semibold hover:underline text-sm mt-1"
                >
                  Ver / descargar →
                </button>
              </div>
            ) : (
              <p className="text-sm text-inalde-gray italic mb-3">Aún no has subido el proyecto final.</p>
            )}

            {!bloqueado && (
              <div className="flex items-center gap-3">
                <input
                  ref={inputFinalRef}
                  type="file"
                  accept={MIME_PROYECTO_FINAL_ACCEPT}
                  disabled={!!subiendo}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) subir('proyecto-final', f);
                  }}
                  className="text-sm"
                />
                {subiendo === 'proyecto-final' && <span className="text-xs text-inalde-gray">Subiendo…</span>}
              </div>
            )}
          </div>

          <div className="flex justify-between items-center pt-6 border-t border-inalde-gray-light">
            <button onClick={() => navigate('/')} className="text-sm text-inalde-gray hover:text-inalde-text">
              ← Dashboard
            </button>
            {!bloqueado && (
              <button
                onClick={enviarDefinitivo}
                disabled={!ambosSubidos || enviando}
                className="btn-inalde-primary disabled:opacity-50"
              >
                {enviando ? 'Enviando…' : 'Enviar definitivo →'}
              </button>
            )}
          </div>
        </div>
      </main>
    </>
  );
}
