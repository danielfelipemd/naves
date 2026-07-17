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

interface AssetState { cargado: boolean; url: string; nombre: string; }
type TipoAsset = 'one_pager' | 'logo' | 'modelo_financiero';

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
  fecha_limite_proyecto?: string | null;
  assets?: Record<TipoAsset, AssetState | null>;
  equipos: {
    id: string;
    tipo_trabajo_grado: Modalidad;
    director_id: string | null;
    proyecto_definitivo_id: string | null;
    director?: { id: string; nombre_completo: string } | null;
  };
}

// Material de apoyo del Business Plan que alimenta la programación de
// presentaciones. A diferencia de los entregables (PDF definitivo), estos SÍ se
// pueden reemplazar volviéndolos a subir.
const ASSET_CFG: Record<TipoAsset, { label: string; accept: string; hint: string; exts: string[]; mimes: Set<string> }> = {
  one_pager: {
    label: 'One pager',
    accept: '.pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp',
    hint: 'PDF o imagen (PNG, JPG, WebP)',
    exts: ['pdf', 'png', 'jpg', 'jpeg', 'webp'],
    mimes: new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/webp']),
  },
  logo: {
    label: 'Logo',
    accept: '.png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp',
    hint: 'PNG, JPG o WebP',
    exts: ['png', 'jpg', 'jpeg', 'webp'],
    mimes: new Set(['image/png', 'image/jpeg', 'image/webp']),
  },
  modelo_financiero: {
    label: 'Modelo financiero',
    accept: '.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel',
    hint: 'Excel (.xlsx o .xls)',
    exts: ['xlsx', 'xls'],
    mimes: new Set(['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel']),
  },
};

function aceptaAsset(tipo: TipoAsset, file: File): boolean {
  const cfg = ASSET_CFG[tipo];
  if (file.type) return cfg.mimes.has(file.type);
  return cfg.exts.includes(file.name.toLowerCase().split('.').pop() ?? '');
}

// Los dos entregables van en PDF, y solo PDF (el backend rechaza el resto).
const MIME_ANTEPROYECTO_ACCEPT = '.pdf,application/pdf';
const MIME_PROYECTO_FINAL_ACCEPT = '.pdf,application/pdf';

const MIME_PDF_SET = new Set(['application/pdf']);

function aceptaMime(_tipo: 'anteproyecto' | 'proyecto-final', file: File): boolean {
  if (file.type) return MIME_PDF_SET.has(file.type);
  // Fallback por extension si el SO no manda mime
  return file.name.toLowerCase().split('.').pop() === 'pdf';
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

/** Zona de drag-and-drop sobre un input file nativo. Genérica: valida con la
 *  función que le pasen y muestra el hint/error correspondiente. */
function DropZone(props: {
  accept: string;
  hint: string;
  disabled: boolean;
  subiendoEste: boolean;
  validate: (f: File) => boolean;
  errMsg: string;
  onFile: (f: File) => void;
  inputRef: React.RefObject<HTMLInputElement>;
}) {
  const { accept, hint, disabled, subiendoEste, validate, errMsg, onFile, inputRef } = props;
  const [drag, setDrag] = useState(false);
  const [errMime, setErrMime] = useState(false);

  function handleFiles(files: FileList | null) {
    const f = files?.[0];
    if (!f) return;
    if (!validate(f)) { setErrMime(true); return; }
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
      <p className="text-xs text-inalde-gray mt-1">{hint} · máximo 25 MB</p>
      {errMime && (
        <p className="text-xs text-inalde-red mt-2">El tipo de archivo no es válido. {errMsg}</p>
      )}
    </div>
  );
}

/** Fila de carga de un asset (one pager / logo / modelo financiero). Se puede
 *  reemplazar: si ya hay archivo, muestra descargar + reemplazar. */
function AssetUploader(props: {
  tipo: TipoAsset;
  asset: AssetState | null;
  subiendo: boolean;
  disabled: boolean;
  onFile: (f: File) => void;
  onOpen: () => void;
  inputRef: React.RefObject<HTMLInputElement>;
}) {
  const cfg = ASSET_CFG[props.tipo];
  return (
    <div className="border border-inalde-gray-light rounded p-4 mb-3">
      <div className="flex items-center justify-between gap-2 mb-2">
        <h4 className="font-primary font-semibold text-sm text-inalde-text">{cfg.label}</h4>
        {props.asset?.cargado && <span className="text-xs text-inalde-gray">✓ Cargado</span>}
      </div>
      {props.asset?.cargado ? (
        <div className="text-sm text-inalde-gray">
          <p className="mb-1 break-all"><span aria-hidden="true">✅ </span><span className="text-inalde-text">{props.asset.nombre}</span></p>
          <button onClick={props.onOpen} className="text-inalde-red font-semibold hover:underline text-sm">Descargar →</button>
          <p className="text-xs text-inalde-gray italic mt-2">Este archivo no se puede reemplazar.</p>
        </div>
      ) : (
        <DropZone
          accept={cfg.accept}
          hint={cfg.hint}
          validate={(f) => aceptaAsset(props.tipo, f)}
          errMsg={`Formato permitido: ${cfg.hint}.`}
          disabled={props.disabled}
          subiendoEste={props.subiendo}
          onFile={props.onFile}
          inputRef={props.inputRef}
        />
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

  const [subiendoAsset, setSubiendoAsset] = useState<TipoAsset | null>(null);
  // Ficha activa (null = sigue el valor por defecto según el estado). Dos fichas:
  // 'anteproyecto' y 'proyecto'.
  const [ficha, setFicha] = useState<'anteproyecto' | 'proyecto' | null>(null);

  const inputAntRef = useRef<HTMLInputElement>(null);
  const inputFinalRef = useRef<HTMLInputElement>(null);
  const inputAssetRefs: Record<TipoAsset, React.RefObject<HTMLInputElement>> = {
    one_pager: useRef<HTMLInputElement>(null),
    logo: useRef<HTMLInputElement>(null),
    modelo_financiero: useRef<HTMLInputElement>(null),
  };
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
    // El proyecto final no se puede reemplazar: se confirma antes de subirlo.
    if (tipo === 'proyecto-final') {
      const ok = window.confirm(
        `Vas a cargar "${file.name}" como tu proyecto final.\n\n` +
        'Es DEFINITIVO: una vez cargado no podrás modificarlo ni reemplazarlo.\n\n' +
        '¿Confirmas que es la versión correcta?',
      );
      if (!ok) {
        if (inputFinalRef.current) inputFinalRef.current.value = '';
        return;
      }
    }
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

  // Assets del proyecto (one pager, logo, modelo financiero). Se pueden
  // reemplazar: volver a subir sobrescribe. Van a un endpoint distinto que los
  // cuelga del proyecto definitivo.
  async function subirAsset(tipo: TipoAsset, file: File) {
    if (!ant) return;
    setSubiendoAsset(tipo); setError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      await api.post(`/anteproyectos/${ant.id}/asset/${tipo}`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 0,
      });
      await cargar();
    } catch (e: any) {
      setError(formatBackendError(e));
    } finally {
      setSubiendoAsset(null);
      const ref = inputAssetRefs[tipo].current;
      if (ref) ref.value = '';
    }
  }

  async function abrirAsset(tipo: TipoAsset) {
    if (!ant) return;
    setError(null);
    try {
      const { data } = await api.get(`/anteproyectos/${ant.id}/asset/${tipo}`);
      if (!data?.url) { setError('No fue posible obtener el archivo. Inténtalo de nuevo.'); return; }
      const a = document.createElement('a');
      a.href = new URL(data.url, window.location.origin).href;
      a.download = '';
      a.rel = 'noopener noreferrer';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (e: any) {
      setError(formatBackendError(e));
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
    setError(null);
    try {
      const { data } = await api.get(`/anteproyectos/${ant.id}/archivo/${tipo}`);
      if (!data?.url) {
        setError('No fue posible obtener el archivo. Inténtalo de nuevo.');
        return;
      }
      // Programmatic <a download> click: dispara el dialogo 'Guardar como'
      // sin abrir pestañas nuevas. Cancelar la descarga deja todo limpio y
      // volver a hacer click vuelve a lanzar el dialogo. El backend manda
      // 'Content-Disposition: attachment' para garantizar el comportamiento.
      const absolute = new URL(data.url, window.location.origin).href;
      const a = document.createElement('a');
      a.href = absolute;
      a.download = ''; // el filename real lo manda el header del backend
      a.rel = 'noopener noreferrer';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
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
  const finalSubido = !!ant?.archivo_proyecto_final_path;

  // La carga del proyecto final se habilita distinto por modalidad:
  //  - caso/PI: al cargar su archivo de anteproyecto.
  //  - business plan: al elegirse el proyecto definitivo en la reunión.
  const proyectoHabilitado = esCasoOPI ? antSubido : !!ant?.equipos?.proyecto_definitivo_id;

  // Anteproyecto DILIGENCIADO: habilita la ficha de proyecto de grado.
  //  - BP: el formulario ya fue enviado (estado ≠ borrador).
  //  - caso/PI: el archivo de anteproyecto ya está cargado.
  const anteproyectoHecho = esCasoOPI ? antSubido : ant?.estado !== 'borrador';

  // Fecha límite del proyecto de grado (hito 10 de la cohorte). Vencida = no se
  // puede cargar ni el documento ni el material.
  const fechaLimite = ant?.fecha_limite_proyecto ?? null;
  const vencido = !!fechaLimite && new Date() > new Date(`${fechaLimite}T23:59:59-05:00`);
  const fechaLimiteTexto = fechaLimite
    ? new Date(`${fechaLimite}T12:00:00`).toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' })
    : null;

  // Ficha por defecto: si el anteproyecto ya está hecho, arrancamos en Proyecto
  // de grado (es el paso importante); si no, en Anteproyecto. El clic del usuario
  // manda por encima de este valor.
  const fichaActiva: 'anteproyecto' | 'proyecto' = ficha ?? (anteproyectoHecho ? 'proyecto' : 'anteproyecto');

  return (
    <>
      <Header />
      <main className="pt-36 pb-16 px-4">
        <div className="max-w-[860px] mx-auto">
          <div className="border-b-[3px] border-inalde-red pb-5 mb-6">
            <p className="section-subtitle mb-2">Trabajo de grado</p>
            <h1 className="section-title">{modalidad ? TITULO_MODALIDAD[modalidad] : 'Modalidad'}</h1>
          </div>

          {error && (
            <div className="rounded border-l-4 border-inalde-red bg-red-50 px-4 py-3 text-sm mb-6 whitespace-pre-line">
              {error}
            </div>
          )}

          {/* === Dos fichas: Anteproyecto (izq) · Proyecto de grado (der) === */}
          <div className="grid grid-cols-2 gap-3 sm:gap-4 mb-6">
            <button
              onClick={() => setFicha('anteproyecto')}
              className={`rounded-lg border-2 px-4 py-4 text-left transition ${
                fichaActiva === 'anteproyecto'
                  ? 'border-inalde-red bg-inalde-red/5'
                  : 'border-inalde-gray-light bg-white hover:border-inalde-gray'
              }`}
            >
              <span className="block text-[10px] uppercase tracking-widest text-inalde-gray mb-1">Paso 1</span>
              <span className="font-primary font-bold text-inalde-text flex items-center gap-2 flex-wrap">
                Anteproyecto
                {anteproyectoHecho && <span className="text-[10px] uppercase tracking-wider text-inalde-blue font-semibold">✓ Completado</span>}
              </span>
            </button>

            <button
              onClick={() => { if (anteproyectoHecho) setFicha('proyecto'); }}
              disabled={!anteproyectoHecho}
              aria-disabled={!anteproyectoHecho}
              title={!anteproyectoHecho ? 'Diligencia primero el anteproyecto' : undefined}
              className={`rounded-lg border-2 px-4 py-4 text-left transition ${
                !anteproyectoHecho
                  ? 'border-inalde-gray-light bg-inalde-gray-bg/40 opacity-60 cursor-not-allowed'
                  : fichaActiva === 'proyecto'
                    ? 'border-inalde-red bg-inalde-red shadow-inalde-card'
                    : 'border-inalde-red/50 bg-white hover:border-inalde-red'
              }`}
            >
              <span className={`block text-[10px] uppercase tracking-widest mb-1 font-semibold ${
                anteproyectoHecho && fichaActiva === 'proyecto' ? 'text-white/85' : 'text-inalde-red'
              }`}>
                Paso 2 · Entrega final
              </span>
              <span className={`font-primary font-extrabold flex items-center gap-2 flex-wrap ${
                anteproyectoHecho && fichaActiva === 'proyecto' ? 'text-white' : 'text-inalde-text'
              }`}>
                Proyecto de grado
                {!anteproyectoHecho && <span aria-hidden="true">🔒</span>}
              </span>
            </button>
          </div>

          <div className="bg-white rounded-lg shadow-inalde-card p-5 sm:p-8">
            {fichaActiva === 'anteproyecto' ? (
              /* ======================= FICHA ANTEPROYECTO ======================= */
              <>
                {esCasoOPI ? (
                  <>
                    {!directorAsignado && (
                      <div className="border-2 border-inalde-red rounded p-5 mb-6 bg-red-50/30">
                        <h2 className="font-primary font-bold text-base mb-2">Selecciona tu director</h2>
                        <p className="text-sm text-inalde-gray mb-4">
                          Antes de cargar el anteproyecto, elige al director que acompañará tu trabajo de
                          grado. Esta selección es <strong>definitiva</strong> y no se puede cambiar después.
                        </p>
                        {directores.length === 0 ? (
                          <p className="text-sm text-inalde-gray italic">Cargando directores disponibles…</p>
                        ) : (
                          <>
                            <select value={directorSel} onChange={(e) => setDirectorSel(e.target.value)} className="input-inalde w-full mb-3">
                              <option value="">Selecciona un director…</option>
                              {directores.map((d) => <option key={d.id} value={d.id}>{d.nombre_completo}</option>)}
                            </select>
                            <button onClick={asignarDirector} disabled={!directorSel || guardandoDirector}
                              className="btn-inalde-primary !py-2 !text-xs disabled:opacity-40 disabled:cursor-not-allowed">
                              {guardandoDirector ? 'Guardando…' : 'Confirmar director →'}
                            </button>
                          </>
                        )}
                      </div>
                    )}
                    {directorAsignado && (
                      <div className="border border-inalde-gray-light rounded p-4 mb-6 bg-inalde-gray-bg/40">
                        <p className="text-xs uppercase tracking-wider text-inalde-gray mb-1">Tu director</p>
                        <p className="font-medium text-inalde-text">{ant?.equipos?.director?.nombre_completo ?? 'Director asignado'}</p>
                      </div>
                    )}
                    <h2 className="font-primary font-bold text-base mb-3">Anteproyecto (PDF)</h2>
                    {antSubido ? (
                      <div className="text-sm text-inalde-gray">
                        <p>✅ Cargado el {formatoFecha(ant!.archivo_anteproyecto_uploaded_at)} — <span className="text-inalde-text">{nombreArchivoDePath(ant!.archivo_anteproyecto_path)}</span></p>
                        <button onClick={() => abrirArchivo('anteproyecto')} className="text-inalde-red font-semibold hover:underline text-sm mt-1">Descargar →</button>
                        <p className="text-xs text-inalde-gray italic mt-3">Este archivo no se puede reemplazar.</p>
                      </div>
                    ) : (
                      <>
                        <p className="text-sm text-inalde-gray italic mb-3">
                          {!directorAsignado ? 'Selecciona primero a tu director.' : 'Aún no has cargado el anteproyecto.'}
                        </p>
                        <DropZone
                          accept={MIME_ANTEPROYECTO_ACCEPT} hint="PDF"
                          validate={(f) => aceptaMime('anteproyecto', f)} errMsg="Solo PDF."
                          disabled={!!subiendo || !directorAsignado}
                          subiendoEste={subiendo === 'anteproyecto'}
                          onFile={(f) => subir('anteproyecto', f)} inputRef={inputAntRef}
                        />
                      </>
                    )}
                  </>
                ) : (
                  /* Business Plan: anteproyecto por formulario. */
                  <>
                    <h2 className="font-primary font-bold text-base mb-3">Anteproyecto</h2>
                    {anteproyectoHecho ? (
                      <div className="text-sm text-inalde-gray">
                        <p className="mb-2">✅ Tu anteproyecto ya fue enviado. Este paso está completo.</p>
                        <button onClick={() => navigate('/anteproyecto')} className="text-inalde-red font-semibold hover:underline text-sm">Ver mi anteproyecto →</button>
                      </div>
                    ) : (
                      <>
                        <p className="text-sm text-inalde-gray mb-3">
                          Todavía no has enviado tu anteproyecto. Complétalo primero: con eso se habilita el proyecto de grado.
                        </p>
                        <button onClick={() => navigate('/anteproyecto')} className="btn-inalde-primary !py-2 !px-4 !text-xs">Completar anteproyecto →</button>
                      </>
                    )}
                  </>
                )}
              </>
            ) : (
              /* ======================= FICHA PROYECTO DE GRADO ======================= */
              <>
                <div className="flex items-start gap-3 mb-2">
                  <div>
                    <p className="text-[10px] uppercase tracking-widest text-inalde-red font-semibold mb-1">Entrega final · una sola vez</p>
                    <h2 className="font-primary font-extrabold text-xl text-inalde-text">Proyecto de grado</h2>
                  </div>
                </div>
                <p className="text-sm text-inalde-gray mb-5">
                  Este es el entregable definitivo. El documento y su material se cargan <strong>una sola vez</strong> y no se pueden reemplazar. Revisa bien antes de subir.
                </p>

                {vencido ? (
                  <div className="rounded border-l-4 border-inalde-red bg-red-50 px-4 py-3 text-sm text-inalde-text mb-5">
                    <strong>La fecha límite de entrega ya pasó{fechaLimiteTexto ? ` (${fechaLimiteTexto})` : ''}.</strong> Ya no es posible cargar el proyecto de grado. Contacta a la coordinación del programa.
                  </div>
                ) : fechaLimiteTexto && (
                  <div className="rounded border-l-4 border-inalde-gold bg-inalde-gold/10 px-4 py-3 text-sm text-inalde-text mb-5">
                    Fecha límite de entrega: <strong>{fechaLimiteTexto}</strong>. Después de esa fecha no podrás cargar el proyecto de grado.
                  </div>
                )}

                {/* Gate: BP sin definitivo aún. */}
                {!proyectoHabilitado ? (
                  <div className="rounded border-l-4 border-inalde-gold bg-inalde-gray-bg px-4 py-3 text-sm text-inalde-text">
                    {esCasoOPI ? (
                      <>Este paso se habilita <strong>en cuanto cargues tu anteproyecto</strong>.</>
                    ) : (
                      <>
                        Se habilita <strong>cuando se elija tu proyecto definitivo</strong>, después de la Reunión 1 con tu profesor.
                        <button onClick={() => navigate('/seleccion')} className="block mt-2 text-inalde-red font-semibold hover:underline">
                          Ir a la selección del proyecto definitivo →
                        </button>
                      </>
                    )}
                  </div>
                ) : (
                  <>
                    {/* Documento definitivo */}
                    <div className="border-2 border-inalde-red/30 rounded-lg p-5 mb-6 bg-inalde-red/5">
                      <h3 className="font-primary font-bold text-base text-inalde-text mb-2">
                        {esCasoOPI ? 'Proyecto final (PDF)' : 'Documento del Business Plan (PDF)'}
                      </h3>
                      {finalSubido ? (
                        <div className="text-sm text-inalde-gray">
                          <p>✅ Cargado el {formatoFecha(ant!.archivo_proyecto_final_uploaded_at)} — <span className="text-inalde-text">{nombreArchivoDePath(ant!.archivo_proyecto_final_path)}</span></p>
                          <button onClick={() => abrirArchivo('proyecto-final')} className="text-inalde-red font-semibold hover:underline text-sm mt-1">Descargar →</button>
                          <p className="text-xs text-inalde-gray italic mt-3">Este archivo no se puede reemplazar.</p>
                        </div>
                      ) : vencido ? (
                        <p className="text-sm text-inalde-gray italic">La fecha de entrega ya pasó.</p>
                      ) : (
                        <>
                          <div className="rounded border-l-4 border-inalde-red bg-white px-4 py-3 text-xs text-inalde-text mb-3">
                            <strong>Atención:</strong> es <strong>definitivo</strong>. Una vez cargado <strong>no se puede modificar ni reemplazar</strong>.
                          </div>
                          <DropZone
                            accept={MIME_PROYECTO_FINAL_ACCEPT} hint="PDF"
                            validate={(f) => aceptaMime('proyecto-final', f)} errMsg="Solo PDF."
                            disabled={!!subiendo}
                            subiendoEste={subiendo === 'proyecto-final'}
                            onFile={(f) => subir('proyecto-final', f)} inputRef={inputFinalRef}
                          />
                        </>
                      )}
                    </div>

                    {/* Material (solo Business Plan) */}
                    {!esCasoOPI && (
                      <div>
                        <h3 className="font-primary font-semibold text-sm text-inalde-text mb-4">Material para la presentación</h3>
                        {(['one_pager', 'logo', 'modelo_financiero'] as const).map((t) => (
                          <AssetUploader
                            key={t}
                            tipo={t}
                            asset={ant?.assets?.[t] ?? null}
                            subiendo={subiendoAsset === t}
                            disabled={!!subiendoAsset || vencido}
                            onFile={(f) => subirAsset(t, f)}
                            onOpen={() => abrirAsset(t)}
                            inputRef={inputAssetRefs[t]}
                          />
                        ))}
                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </div>

          <div className="flex justify-between items-center pt-6 mt-2">
            <button
              onClick={() => navigate('/')}
              disabled={!!subiendo}
              title={subiendo ? 'Espera a que termine la carga' : undefined}
              className="text-sm text-inalde-gray hover:text-inalde-text disabled:opacity-40 disabled:cursor-not-allowed">
              ← Dashboard
            </button>
            {subiendo && (
              <span className="text-xs text-inalde-gray italic">Subiendo archivo… no recargues ni salgas de esta pantalla.</span>
            )}
          </div>
        </div>
      </main>
    </>
  );
}
