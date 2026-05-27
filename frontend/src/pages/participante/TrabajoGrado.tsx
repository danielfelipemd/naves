import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Header } from '../../components/inalde/Header';
import { api } from '../../lib/api';
import { formatBackendError } from '../../lib/errors';

type Modalidad = 'business_plan' | 'caso' | 'proyecto_investigacion';

interface Director {
  id: string;
  nombre_completo: string;
  areas_afinidad?: string[];
}

interface Anteproyecto {
  id: string;
  equipo_id: string;
  estado: 'borrador' | 'enviado' | 'revisado' | 'aprobado';
  archivo_anteproyecto_path: string | null;
  archivo_anteproyecto_mime: string | null;
  archivo_anteproyecto_uploaded_at: string | null;
  archivo_proyecto_final_path: string | null;
  archivo_proyecto_final_mime: string | null;
  archivo_proyecto_final_uploaded_at: string | null;
  anteproyecto_aprobado_at: string | null;
  equipos: {
    id: string;
    tipo_trabajo_grado: Modalidad;
    director_id: string | null;
    director?: { id: string; nombre_completo: string } | null;
  };
}

const MIME_ANTEPROYECTO_ACCEPT = '.pdf,application/pdf';
const MIME_PROYECTO_FINAL_ACCEPT =
  '.pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const MIME_ANTEPROYECTO_SET = new Set(['application/pdf']);
const MIME_PROYECTO_FINAL_SET = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

function aceptaMime(tipo: 'anteproyecto' | 'proyecto-final', file: File): boolean {
  const set = tipo === 'anteproyecto' ? MIME_ANTEPROYECTO_SET : MIME_PROYECTO_FINAL_SET;
  if (file.type) return set.has(file.type);
  // Fallback por extension si el SO no manda mime
  const ext = file.name.toLowerCase().split('.').pop();
  if (tipo === 'anteproyecto') return ext === 'pdf';
  return ext === 'pdf' || ext === 'doc' || ext === 'docx';
}

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

/** Zona de drag-and-drop sobre un input file nativo. */
function DropZone(props: {
  tipo: 'anteproyecto' | 'proyecto-final';
  accept: string;
  disabled: boolean;
  subiendoEste: boolean;
  onFile: (f: File) => void;
  inputRef: React.RefObject<HTMLInputElement>;
}) {
  const { tipo, accept, disabled, subiendoEste, onFile, inputRef } = props;
  const [drag, setDrag] = useState(false);
  const [errMime, setErrMime] = useState(false);

  function handleFiles(files: FileList | null) {
    const f = files?.[0];
    if (!f) return;
    if (!aceptaMime(tipo, f)) { setErrMime(true); return; }
    setErrMime(false);
    onFile(f);
  }

  return (
    <div
      onDragOver={(e) => { if (disabled) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        if (disabled) return;
        e.preventDefault();
        setDrag(false);
        handleFiles(e.dataTransfer.files);
      }}
      onClick={() => { if (!disabled) inputRef.current?.click(); }}
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      className={[
        'rounded border-2 border-dashed px-4 py-6 text-center transition select-none',
        disabled ? 'opacity-50 cursor-not-allowed bg-inalde-gray-bg/30 border-inalde-gray-light' : 'cursor-pointer hover:bg-inalde-gray-bg/40',
        drag ? 'border-inalde-red bg-red-50' : 'border-inalde-gray-light',
      ].join(' ')}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        disabled={disabled}
        onChange={(e) => handleFiles(e.target.files)}
        className="hidden"
      />
      <p className="text-sm text-inalde-text font-medium">
        {subiendoEste ? 'Cargando…' : 'Arrastra el archivo aquí o haz clic para seleccionarlo'}
      </p>
      <p className="text-xs text-inalde-gray mt-1">
        {tipo === 'anteproyecto' ? 'PDF · máximo 25 MB' : 'PDF o Word · máximo 25 MB'}
      </p>
      {errMime && (
        <p className="text-xs text-inalde-red mt-2">
          El tipo de archivo no es válido. {tipo === 'anteproyecto' ? 'Solo PDF.' : 'Solo PDF o Word.'}
        </p>
      )}
    </div>
  );
}

export default function TrabajoGrado() {
  const navigate = useNavigate();
  const [ant, setAnt] = useState<Anteproyecto | null>(null);
  const [tieneEquipo, setTieneEquipo] = useState<boolean | null>(null);
  const [modalidadParticipante, setModalidadParticipante] = useState<Modalidad | null>(null);
  const [cargando, setCargando] = useState(true);
  const [subiendo, setSubiendo] = useState<'anteproyecto' | 'proyecto-final' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [directores, setDirectores] = useState<Director[]>([]);
  const [directorSel, setDirectorSel] = useState<string>('');
  const [guardandoDirector, setGuardandoDirector] = useState(false);

  const inputAntRef = useRef<HTMLInputElement>(null);
  const inputFinalRef = useRef<HTMLInputElement>(null);
  // AbortController para cancelar el upload si el usuario decide salir
  // mientras se esta subiendo el archivo.
  const abortRef = useRef<AbortController | null>(null);

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

  // Cargar la modalidad del participante: necesaria para mostrar el mensaje correcto
  // cuando aun no tiene equipo (ant es null y por tanto no tenemos modalidad por esa via).
  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get('/participantes/mi-modalidad');
        setModalidadParticipante((data?.tipo_trabajo_grado as Modalidad | null) ?? null);
      } catch { /* ignore */ }
    })();
  }, []);

  // Cargar lista de directores solo si la modalidad lo requiere y no hay uno asignado
  useEffect(() => {
    const modalidad = ant?.equipos?.tipo_trabajo_grado;
    if (!modalidad || modalidad === 'business_plan') return;
    if (ant?.equipos?.director_id) return;
    (async () => {
      try {
        const { data } = await api.get('/directores/disponibles');
        setDirectores(data ?? []);
      } catch { /* ignore */ }
    })();
  }, [ant]);

  async function asignarDirector() {
    if (!ant || !directorSel) return;
    setGuardandoDirector(true); setError(null);
    try {
      await api.put(`/equipos/${ant.equipo_id}/director`, { director_id: directorSel });
      await cargar();
    } catch (e: any) {
      setError(formatBackendError(e));
    } finally { setGuardandoDirector(false); }
  }

  async function subir(tipo: 'anteproyecto' | 'proyecto-final', file: File) {
    if (!ant) return;
    setSubiendo(tipo); setError(null);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const fd = new FormData();
      fd.append('file', file);
      // timeout: 0 desactiva el limite por defecto de 15s; un anteproyecto
      // grande en conexion lenta tarda mas. signal permite cancelar.
      await api.post(`/anteproyectos/${ant.id}/archivo/${tipo}`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 0,
        signal: controller.signal,
      });
      await cargar();
    } catch (e: any) {
      // Si fue una cancelacion explicita (usuario salio durante la subida),
      // no mostramos error: la cancelacion es la accion esperada.
      if (e?.code === 'ERR_CANCELED' || e?.name === 'CanceledError') {
        // noop
      } else {
        setError(formatBackendError(e));
      }
    } finally {
      abortRef.current = null;
      setSubiendo(null);
      if (tipo === 'anteproyecto' && inputAntRef.current) inputAntRef.current.value = '';
      if (tipo === 'proyecto-final' && inputFinalRef.current) inputFinalRef.current.value = '';
    }
  }

  // Proteccion contra refresh/cierre mientras se sube un archivo.
  // beforeunload cubre F5, cerrar pestaña, cerrar navegador y clicks en
  // enlaces externos (incluido el <a href="/"> del logo en el Header).
  // El texto exacto del dialogo lo decide el navegador, no se puede
  // personalizar en navegadores modernos.
  // Para la navegacion interna del SPA usamos solo el `disabled` del boton
  // 'Volver al Dashboard' mas abajo, porque la app esta montada sobre
  // <BrowserRouter> (router legacy) y useBlocker requiere createBrowserRouter.
  useEffect(() => {
    if (!subiendo) return;
    function onBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
      // Requerido por compatibilidad con navegadores antiguos.
      e.returnValue = '';
    }
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [subiendo]);

  async function abrirArchivo(tipo: 'anteproyecto' | 'proyecto-final') {
    if (!ant) return;
    try {
      const { data } = await api.get(`/anteproyectos/${ant.id}/archivo/${tipo}`);
      if (data?.url) window.open(data.url, '_blank', 'noopener,noreferrer');
    } catch (e: any) {
      setError(formatBackendError(e));
    }
  }

  if (cargando) {
    return <><Header /><main className="pt-36 text-center text-inalde-gray">Cargando…</main></>;
  }

  // Sin equipo: cualquier modalidad puede llegar aquí. Adaptamos el mensaje y el título
  // a la modalidad del participante.
  if (!tieneEquipo) {
    const tituloPorModalidad: Record<Modalidad, string> = {
      business_plan: 'Business Plan NAVES',
      caso: 'Caso',
      proyecto_investigacion: 'Proyecto de Investigación',
    };
    const mensajePorModalidad: Record<Modalidad, { p1: string; p2: string }> = {
      business_plan: {
        p1: 'Para el Business Plan puedes crear tu grupo de 1 a 3 personas. Cada miembro debe haber elegido también la modalidad Business Plan.',
        p2: 'Una vez formes tu equipo, podrás trabajar en el anteproyecto y, luego, en el proyecto final.',
      },
      caso: {
        p1: 'Para la modalidad Caso puedes crear tu grupo de 1 a 3 personas. Cada miembro debe haber elegido también la modalidad Caso.',
        p2: 'Una vez formes tu equipo, podrás seleccionar a tu director y cargar el anteproyecto.',
      },
      proyecto_investigacion: {
        p1: 'Para Proyecto de Investigación puedes crear tu grupo de 1 a 3 personas. Cada miembro debe haber elegido también la modalidad Proyecto de Investigación.',
        p2: 'Una vez formes tu equipo, podrás seleccionar a tu director y cargar el anteproyecto.',
      },
    };
    const m = modalidadParticipante;
    const titulo = m ? tituloPorModalidad[m] : 'Trabajo de grado';
    const mensaje = m ? mensajePorModalidad[m] : null;

    return (
      <>
        <Header />
        <main className="pt-36 pb-16 px-4">
          <div className="max-w-[700px] mx-auto bg-white rounded-lg shadow-inalde-card p-5 sm:p-10">
            <div className="border-b-[3px] border-inalde-red pb-5 mb-8">
              {m && <p className="section-subtitle mb-2">Trabajo de grado</p>}
              <h1 className="section-title">{titulo}</h1>
            </div>
            {mensaje ? (
              <>
                <p className="text-inalde-gray mb-3">{mensaje.p1}</p>
                <p className="text-inalde-gray mb-6">{mensaje.p2}</p>
              </>
            ) : (
              <p className="text-inalde-gray mb-6">
                Primero elige tu modalidad y forma tu equipo. Después podrás continuar con tu trabajo de grado.
              </p>
            )}
            <button onClick={() => navigate(m ? '/equipo' : '/')} className="btn-inalde-primary">
              {m ? 'Ir a Mi equipo →' : 'Volver al inicio →'}
            </button>
          </div>
        </main>
      </>
    );
  }

  const modalidad = ant?.equipos?.tipo_trabajo_grado;
  const esCasoOPI = modalidad === 'caso' || modalidad === 'proyecto_investigacion';
  const directorAsignado = ant?.equipos?.director_id ?? null;
  const antSubido = !!ant?.archivo_anteproyecto_path;
  const aprobado = !!ant?.anteproyecto_aprobado_at;
  const finalSubido = !!ant?.archivo_proyecto_final_path;

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

          {/* === Selección de director (solo caso/PI) ====================== */}
          {esCasoOPI && !directorAsignado && (
            <div className="border-2 border-inalde-red rounded p-5 mb-8 bg-red-50/30">
              <h2 className="font-primary font-bold text-base mb-2">Selecciona tu director</h2>
              <p className="text-sm text-inalde-gray mb-4">
                Antes de cargar el anteproyecto, elige al director que acompañará tu trabajo de
                grado. Esta selección es <strong>definitiva</strong> y no se puede cambiar después.
              </p>
              {directores.length === 0 ? (
                <p className="text-sm text-inalde-gray italic">Cargando directores disponibles…</p>
              ) : (
                <>
                  <select
                    value={directorSel}
                    onChange={(e) => setDirectorSel(e.target.value)}
                    className="input-inalde w-full mb-3">
                    <option value="">Selecciona un director…</option>
                    {directores.map((d) => (
                      <option key={d.id} value={d.id}>{d.nombre_completo}</option>
                    ))}
                  </select>
                  <button
                    onClick={asignarDirector}
                    disabled={!directorSel || guardandoDirector}
                    className="btn-inalde-primary !py-2 !text-xs disabled:opacity-40 disabled:cursor-not-allowed">
                    {guardandoDirector ? 'Guardando…' : 'Confirmar director →'}
                  </button>
                </>
              )}
            </div>
          )}

          {esCasoOPI && directorAsignado && (
            <div className="border border-inalde-gray-light rounded p-4 mb-6 bg-inalde-gray-bg/40">
              <p className="text-xs uppercase tracking-wider text-inalde-gray mb-1">Tu director</p>
              <p className="font-medium text-inalde-text">
                {ant?.equipos?.director?.nombre_completo ?? 'Director asignado'}
              </p>
            </div>
          )}

          <p className="text-inalde-gray mb-8 text-sm">
            Carga el <strong>anteproyecto</strong> en PDF. Tamaño máximo: 25 MB.
          </p>

          {/* === Bloque 1: Anteproyecto =================================== */}
          <div className="border border-inalde-gray-light rounded p-5 mb-5">
            <h2 className="font-primary font-bold text-base mb-2">Anteproyecto (PDF)</h2>
            {antSubido ? (
              <div className="text-sm text-inalde-gray mb-3">
                <p>
                  ✅ Cargado el {formatoFecha(ant!.archivo_anteproyecto_uploaded_at)} —{' '}
                  <span className="text-inalde-text">{nombreArchivoDePath(ant!.archivo_anteproyecto_path)}</span>
                </p>
                <button
                  onClick={() => abrirArchivo('anteproyecto')}
                  className="text-inalde-red font-semibold hover:underline text-sm mt-1">
                  Ver / descargar →
                </button>
                <p className="text-xs text-inalde-gray italic mt-3">
                  Este archivo no se puede reemplazar.
                </p>
              </div>
            ) : (
              <>
                <p className="text-sm text-inalde-gray italic mb-3">
                  {esCasoOPI && !directorAsignado
                    ? 'Selecciona primero a tu director.'
                    : 'Aún no has cargado el anteproyecto.'}
                </p>
                <DropZone
                  tipo="anteproyecto"
                  accept={MIME_ANTEPROYECTO_ACCEPT}
                  disabled={!!subiendo || (esCasoOPI && !directorAsignado)}
                  subiendoEste={subiendo === 'anteproyecto'}
                  onFile={(f) => subir('anteproyecto', f)}
                  inputRef={inputAntRef}
                />
              </>
            )}
          </div>

          {/* === Bloque 2: Proyecto final ================================= */}
          <div className={`border rounded p-5 mb-8 ${aprobado ? 'border-inalde-gray-light' : 'border-inalde-gray-light bg-inalde-gray-bg/30'}`}>
            <div className="flex items-start justify-between gap-3 mb-2">
              <h2 className="font-primary font-bold text-base">Proyecto final (PDF o Word)</h2>
              {!aprobado && <span className="text-xs">🔒</span>}
            </div>

            {!aprobado && !finalSubido && (
              <div className="rounded border-l-4 border-inalde-gold bg-amber-50 px-4 py-3 text-xs text-inalde-text mb-3">
                Este paso queda <strong>bloqueado</strong> hasta la entrega final; estará disponible
                al final del proceso.
              </div>
            )}

            {finalSubido ? (
              <div className="text-sm text-inalde-gray mb-3">
                <p>
                  ✅ Cargado el {formatoFecha(ant!.archivo_proyecto_final_uploaded_at)} —{' '}
                  <span className="text-inalde-text">{nombreArchivoDePath(ant!.archivo_proyecto_final_path)}</span>
                </p>
                <button
                  onClick={() => abrirArchivo('proyecto-final')}
                  className="text-inalde-red font-semibold hover:underline text-sm mt-1">
                  Ver / descargar →
                </button>
                <p className="text-xs text-inalde-gray italic mt-3">
                  Este archivo no se puede reemplazar.
                </p>
              </div>
            ) : aprobado ? (
              <>
                <p className="text-sm text-inalde-gray italic mb-3">Aún no has cargado el proyecto final.</p>
                <DropZone
                  tipo="proyecto-final"
                  accept={MIME_PROYECTO_FINAL_ACCEPT}
                  disabled={!!subiendo}
                  subiendoEste={subiendo === 'proyecto-final'}
                  onFile={(f) => subir('proyecto-final', f)}
                  inputRef={inputFinalRef}
                />
              </>
            ) : (
              <p className="text-sm text-inalde-gray italic">Disponible al final del proceso.</p>
            )}
          </div>

          <div className="flex justify-between items-center pt-6 border-t border-inalde-gray-light">
            <button
              onClick={() => navigate('/')}
              disabled={!!subiendo}
              title={subiendo ? 'Espera a que termine la carga' : undefined}
              className="text-sm text-inalde-gray hover:text-inalde-text disabled:opacity-40 disabled:cursor-not-allowed">
              ← Dashboard
            </button>
            {subiendo && (
              <span className="text-xs text-inalde-gray italic">
                Subiendo archivo… no recargues ni salgas de esta pantalla.
              </span>
            )}
          </div>
        </div>
      </main>
    </>
  );
}
