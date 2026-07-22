import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, downloadFile } from '../../lib/api';
import { useAuth } from '../../auth/store';
import { formatBackendError } from '../../lib/errors';

interface Cohorte { id: string; etiqueta: string; activa: boolean; fecha_inicio?: string; }
interface Profesor { id: string; nombre_completo: string; areas_afinidad: string[]; }
interface Item {
  equipo_id: string; equipo_nombre: string | null;
  proyecto_id: string; proyecto_nombre: string;
  sector: string | null; ciiu: string | null; tipo: string | null;
  estado_seleccion: string;
  resumen: string;
  miembros: Array<{ nombre: string; posicion: number }>;
}
interface Asignacion { equipo_id: string; profesor_id: string; }

interface FilaResumen {
  numero: number;
  equipo_id: string;
  nombre_equipo: string | null;
  autores: string;
  proyectos: Array<{
    id: string;
    nombre: string;
    sector: string | null;
    tipo: string | null;
    ciiu: string | null;
    canvas_problema: string | null;
    canvas_solucion: string | null;
  }>;
  modalidad: 'business_plan' | 'caso' | 'proyecto_investigacion';
  buscando_socios: boolean | null;
  buscando_asociacion: boolean | null;
  profesor_asignado_id: string | null;
  profesor_asignado_nombre: string | null;
  director_asignado_nombre: string | null;
  comunicado: boolean;
  reunion_1: boolean;
  reunion_2: boolean;
}

// ---------------------------------------------------------------------------
// Lista viva de anteproyectos (GET /admin/anteproyectos?cohorte=). Trae TODOS
// los equipos de la cohorte, incluyendo borradores/no enviados, con su `estado`
// y el `id` del ANTEPROYECTO (necesario para enlazar al detalle). Se fusiona
// por equipo_id con el resumen operativo de la sábana.
// ---------------------------------------------------------------------------
type Modalidad = 'business_plan' | 'caso' | 'proyecto_investigacion';
interface AnteItem {
  id: string; // id del anteproyecto → enlace al detalle
  estado: string;
  fecha_envio: string | null;
  fecha_actualizacion: string;
  archivo_anteproyecto_path: string | null;
  archivo_avance_path: string | null;
  archivo_proyecto_final_path: string | null;
  anteproyecto_aprobado_at: string | null;
  equipos: {
    id: string; // equipo_id (clave de fusión)
    nombre_equipo: string | null;
    cohorte_id: string;
    tipo_trabajo_grado: Modalidad;
    miembros_equipo?: Array<{ posicion: number; participantes_lista: { nombre_completo: string } | null }>;
  };
  proyectos: Array<{ id: string; nombre: string; sector: string | null; estado_seleccion: string }>;
}

const ESTADO_LABELS: Record<string, string> = {
  borrador: 'Borrador',
  enviado: 'Enviado',
  entregado: 'Entregado',
  avance: 'Avance',
  revisado: 'Revisado',
  aprobado: 'Aprobado',
  proyecto_final: 'Proyecto final',
};

/**
 * Estado mostrado (mismo criterio que la lista simple de anteproyectos). Para
 * Business Plan usa el `estado` real (borrador → enviado → revisado → aprobado).
 * Para Caso/PI el `estado` se queda en "borrador"; la entrega real es la subida
 * del archivo, así que derivamos el estado de archivos + aprobación.
 */
function estadoDisplay(it: AnteItem): { key: string; label: string; cls: string } {
  const modalidad = it.equipos?.tipo_trabajo_grado;
  if (modalidad === 'caso' || modalidad === 'proyecto_investigacion') {
    if (it.archivo_proyecto_final_path) return { key: 'proyecto_final', label: 'Proyecto final', cls: 'text-inalde-red' };
    if (it.archivo_avance_path) return { key: 'avance', label: 'Avance', cls: 'text-inalde-blue' };
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

/**
 * Adapta un anteproyecto de la lista viva al shape de FilaResumen para poder
 * pintarlo en la misma tabla operativa. Se usa SOLO para equipos que no están
 * en el snapshot de la sábana (borradores / no enviados): por eso no hay
 * profesor, flags, comunicado ni reuniones (esas acciones solo aplican a los
 * enviados) y los campos ricos del canvas (problema/solución, ciiu) no vienen
 * en la lista viva → quedan en null.
 */
function itemToFila(it: AnteItem): FilaResumen {
  const autores = (it.equipos.miembros_equipo ?? [])
    .slice()
    .sort((a, b) => (a.posicion ?? 0) - (b.posicion ?? 0))
    .map((m) => m.participantes_lista?.nombre_completo)
    .filter(Boolean)
    .join(', ');
  return {
    numero: 0,
    equipo_id: it.equipos.id,
    nombre_equipo: it.equipos.nombre_equipo,
    autores,
    proyectos: it.proyectos.map((p) => ({
      id: p.id,
      nombre: p.nombre,
      sector: p.sector,
      tipo: null,
      ciiu: null,
      canvas_problema: null,
      canvas_solucion: null,
    })),
    modalidad: it.equipos.tipo_trabajo_grado,
    buscando_socios: null,
    buscando_asociacion: null,
    profesor_asignado_id: null,
    profesor_asignado_nombre: null,
    director_asignado_nombre: null,
    comunicado: false,
    reunion_1: false,
    reunion_2: false,
  };
}

// Fila fusionada: la fila operativa (real o adaptada) + metadatos de la lista
// viva (si está enviada, id del anteproyecto para el enlace, y su estado).
type MergedFila = {
  fila: FilaResumen;
  enviado: boolean; // presente en el snapshot de la sábana → acciones habilitadas
  anteproyecto_id: string | null; // enlace al detalle
  estado: { key: string; label: string; cls: string } | null;
};

/** Pill SÍ / NO / — para celdas readonly */
function Pill({ value }: { value: boolean | null }) {
  if (value === true) return <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-inalde-red/10 text-inalde-red text-[11px] font-bold uppercase tracking-wider">SÍ</span>;
  if (value === false) return <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-inalde-gray-light/60 text-inalde-gray text-[11px] font-semibold uppercase tracking-wider">NO</span>;
  return <span className="text-inalde-gray italic">—</span>;
}

/** Pill de modalidad con color y full-name */
function ModalidadPill({ modalidad }: { modalidad: 'business_plan' | 'caso' | 'proyecto_investigacion' }) {
  const cfg = {
    business_plan:           { label: 'Business Plan',      cls: 'bg-inalde-red/10 text-inalde-red' },
    caso:                    { label: 'Caso',               cls: 'bg-inalde-gold/15 text-[#8a7530]' },
    proyecto_investigacion:  { label: 'Proy. Inv.', cls: 'bg-blue-100 text-blue-800' },
  } as const;
  const c = cfg[modalidad];
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider whitespace-nowrap ${c.cls}`}>
      {c.label}
    </span>
  );
}

export default function Anteproyectos() {
  const navigate = useNavigate();
  const role = useAuth((s) => s.role);
  const isSuperAdmin = useAuth((s) => (s.user?.app_metadata as any)?.es_super_admin === true) || role === 'super_admin';
  const miProfesorId = useAuth((s) => (s.user?.app_metadata as any)?.profesor_id as string | undefined);
  const [cohortes, setCohortes] = useState<Cohorte[]>([]);
  const [cohorte, setCohorte] = useState('');
  const [snapshot, setSnapshot] = useState<Item[]>([]);
  const [profesores, setProfesores] = useState<Profesor[]>([]);
  const [asignaciones, setAsignaciones] = useState<Record<string, string>>({}); // equipo_id → profesor_id
  const [estadoSabana, setEstadoSabana] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [comunicandoEquipo, setComunicandoEquipo] = useState<string | null>(null);
  const [marcandoReunion, setMarcandoReunion] = useState<string | null>(null);
  const [equipoABorrar, setEquipoABorrar] = useState<{ id: string; etiqueta: string } | null>(null);
  const [borrando, setBorrando] = useState(false);
  const pollRef = useRef<number | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [vista, setVista] = useState<'detalle' | 'resumen'>('resumen');
  const [resumen, setResumen] = useState<FilaResumen[]>([]);
  // Lista viva de anteproyectos (incluye borradores) — fusión por equipo_id.
  const [items, setItems] = useState<AnteItem[]>([]);
  const [loadingResumen, setLoadingResumen] = useState(false);
  const [errorResumen, setErrorResumen] = useState(false);
  const [filtroModalidad, setFiltroModalidad] = useState<'todas' | 'business_plan' | 'caso' | 'proyecto_investigacion'>('todas');
  const [filtroAsignacion, setFiltroAsignacion] = useState<'todas' | 'asignados' | 'no_asignados'>('todas');
  const [filtroComunicado, setFiltroComunicado] = useState<'todos' | 'comunicados' | 'pendientes'>('todos');
  const [filtroEstado, setFiltroEstado] = useState('');
  // El profesor ve toda la sábana; este filtro le deja aislar sus equipos.
  const [soloMios, setSoloMios] = useState(false);
  const [filtroBuscar, setFiltroBuscar] = useState('');

  useEffect(() => { (async () => {
    // Reintento defensivo: el backend a veces devuelve 502/504 intermitentes;
    // si la carga inicial de cohortes falla, el dropdown queda vacio para
    // siempre. Hacemos 3 intentos con 800ms de espera antes de rendirnos.
    async function getWithRetry<T>(path: string, attempts = 3): Promise<T | null> {
      for (let i = 0; i < attempts; i++) {
        try { return (await api.get(path)).data as T; }
        catch (e: any) {
          if (i < attempts - 1) await new Promise((r) => setTimeout(r, 800));
        }
      }
      return null;
    }
    const [cohData, profData] = await Promise.all([
      getWithRetry<Cohorte[]>('/admin/cohortes'),
      getWithRetry<any[]>('/admin/profesores'),
    ]);
    if (cohData) {
      const activas = cohData.filter((c) => c.activa)
        .sort((a, b) => (b.fecha_inicio ?? '').localeCompare(a.fecha_inicio ?? ''));
      setCohortes(activas);
      // Por defecto se abre en la cohorte activa (la más reciente).
      if (activas.length) setCohorte((prev) => prev || activas[0].id);
    }
    if (profData) setProfesores(profData.filter((p: any) => p.activo));
  })(); }, []);

  async function load() {
    if (!cohorte) return;
    setLoading(true); setMsg(null);
    try {
      const { data } = await api.get(`/sabana/${cohorte}`);
      setSnapshot(data?.snapshot ?? []);
      setEstadoSabana(data?.estado ?? null);
    } catch (e: any) {
      if (e?.response?.status === 404) {
        setSnapshot([]); setEstadoSabana(null);
      } else { setMsg({ kind: 'err', text: formatBackendError(e) }); }
    } finally { setLoading(false); }
  }

  useEffect(() => { load(); loadResumen(); loadItems(); }, [cohorte]);

  // Sincroniza el "Detalle por equipo" con las asignaciones persistidas de la
  // tabla resumen: si un equipo ya tiene profesor asignado, el dropdown del
  // detalle lo refleja. Conserva sugerencias locales aún no persistidas.
  useEffect(() => {
    setAsignaciones((prev) => {
      const next = { ...prev };
      for (const f of resumen) next[f.equipo_id] = f.profesor_asignado_id ?? prev[f.equipo_id] ?? '';
      return next;
    });
  }, [resumen]);

  async function loadResumen() {
    if (!cohorte) { setResumen([]); setErrorResumen(false); return; }
    setLoadingResumen(true); setErrorResumen(false);
    // La respuesta del resumen es grande y el backend puede ir lento/saturado.
    // Reintento defensivo (3 intentos, 800ms): sin esto, un fallo dejaba la
    // tabla "vacia" con el mensaje enganoso "no tiene proyectos cargados".
    for (let i = 0; i < 3; i++) {
      try {
        const { data } = await api.get(`/sabana/${cohorte}/resumen`);
        setResumen((data?.filas ?? []) as FilaResumen[]);
        setLoadingResumen(false);
        return;
      } catch {
        if (i < 2) { await new Promise((r) => setTimeout(r, 800)); continue; }
        setResumen([]); setErrorResumen(true);
      }
    }
    setLoadingResumen(false);
  }

  // Lista viva de anteproyectos de la cohorte (incluye borradores). Reintento
  // defensivo por los 502/504 intermitentes. Si falla, no bloqueamos la tabla:
  // se queda vacía y la fusión muestra solo lo del resumen.
  async function loadItems() {
    if (!cohorte) { setItems([]); return; }
    for (let i = 0; i < 3; i++) {
      try {
        const { data } = await api.get('/admin/anteproyectos', { params: { cohorte } });
        setItems((data ?? []) as AnteItem[]);
        return;
      } catch {
        if (i < 2) { await new Promise((r) => setTimeout(r, 800)); continue; }
        setItems([]);
      }
    }
  }

  // Edit-in-place de los flags (solo super_admin)
  async function actualizarFlag(equipo_id: string, campo: 'buscando_socios' | 'buscando_asociacion', valor: boolean | null) {
    const payload: Record<string, unknown> = {};
    if (campo === 'buscando_socios') payload.buscando_socios = valor;
    else payload.buscando_asociacion_otro_proyecto = valor;
    setResumen((prev) => prev.map((f) => f.equipo_id === equipo_id ? { ...f, [campo]: valor } : f));
    try {
      await api.patch(`/sabana/equipos/${equipo_id}`, payload);
    } catch (e: any) {
      setMsg({ kind: 'err', text: formatBackendError(e) });
      await loadResumen();
    }
  }

  // Borrado completo del equipo (solo super_admin): abre el modal de confirmación.
  function borrarEquipo(equipo_id: string, etiqueta: string) {
    setEquipoABorrar({ id: equipo_id, etiqueta });
  }
  async function confirmarBorrado() {
    if (!equipoABorrar) return;
    setBorrando(true);
    try {
      await api.delete(`/admin/equipos/${equipoABorrar.id}`);
      setResumen((prev) => prev.filter((f) => f.equipo_id !== equipoABorrar.id));
      setItems((prev) => prev.filter((it) => it.equipos.id !== equipoABorrar.id));
      setMsg({ kind: 'ok', text: 'Equipo borrado. Los participantes quedaron liberados.' });
      setEquipoABorrar(null);
    } catch (e: any) {
      setMsg({ kind: 'err', text: formatBackendError(e) });
    } finally { setBorrando(false); }
  }

  // Comunicar UN solo equipo (envía el correo de ese proyecto en serie).
  // El profesor registra que ya tuvo la Reunión 1 / 2 con el equipo. Optimista:
  // se pinta al instante y se revierte si el servidor la rechaza.
  async function marcarReunion(equipo_id: string, n: 1 | 2, marcada: boolean) {
    const campo = n === 1 ? 'reunion_1' : 'reunion_2';
    setMarcandoReunion(`${equipo_id}-${n}`); setMsg(null);
    setResumen((prev) => prev.map((f) => f.equipo_id === equipo_id ? { ...f, [campo]: marcada } : f));
    try {
      await api.patch(`/sabana/equipos/${equipo_id}/reunion`, { reunion: n, marcada });
    } catch (e: any) {
      setResumen((prev) => prev.map((f) => f.equipo_id === equipo_id ? { ...f, [campo]: !marcada } : f));
      setMsg({ kind: 'err', text: formatBackendError(e) });
    } finally { setMarcandoReunion(null); }
  }

  async function comunicarEquipo(equipo_id: string) {
    setComunicandoEquipo(equipo_id); setMsg(null);
    try {
      const { data } = await api.post(`/admin/sabanas/equipos/${equipo_id}/comunicar`, undefined, { timeout: 60000 });
      if (data?.comunicado) {
        setResumen((prev) => prev.map((f) => f.equipo_id === equipo_id ? { ...f, comunicado: true } : f));
        setMsg({ kind: 'ok', text: `Comunicado: ${data.emails_enviados ?? 0} correo(s) enviado(s) a los participantes.` });
      } else {
        setMsg({ kind: 'err', text: `No se pudo comunicar (fallaron ${data?.emails_fallados ?? 0} envío(s)). Intenta de nuevo.` });
      }
    } catch (e: any) {
      setMsg({ kind: 'err', text: formatBackendError(e) });
    } finally { setComunicandoEquipo(null); }
  }

  // Asignacion inline de profesor (solo super_admin, solo BP)
  async function asignarProfesor(equipo_id: string, profesor_id: string | null) {
    const prof = profesores.find((p) => p.id === profesor_id);
    setResumen((prev) => prev.map((f) => f.equipo_id === equipo_id
      ? { ...f, profesor_asignado_id: profesor_id, profesor_asignado_nombre: prof?.nombre_completo ?? null }
      : f));
    try {
      await api.patch(`/sabana/equipos/${equipo_id}`, { profesor_id });
    } catch (e: any) {
      setMsg({ kind: 'err', text: formatBackendError(e) });
      await loadResumen();
    }
  }

  async function generar() {
    setBusy(true); setMsg(null);
    try {
      await api.post(`/sabana/${cohorte}/generar`);
      await load();
      await loadResumen();
      setMsg({ kind: 'ok', text: 'Sábana generada con datos actuales.' });
    } catch (e: any) {
      setMsg({ kind: 'err', text: formatBackendError(e) });
    } finally { setBusy(false); }
  }

  async function sugerir() {
    setBusy(true); setMsg(null);
    try {
      const { data } = await api.post(`/sabana/${cohorte}/sugerir-asignacion`);
      const sugerencias: Array<{ equipo_id: string; top: Array<{ profesor_id: string; score: number }> }> = data.sugerencias ?? [];
      const newAsign = { ...asignaciones };
      for (const s of sugerencias) {
        if (s.top[0] && s.top[0].score > 0 && !newAsign[s.equipo_id]) {
          newAsign[s.equipo_id] = s.top[0].profesor_id;
        }
      }
      setAsignaciones(newAsign);
      setMsg({ kind: 'ok', text: 'Sugerencias aplicadas a equipos sin asignación previa.' });
    } catch (e: any) {
      setMsg({ kind: 'err', text: formatBackendError(e) });
    } finally { setBusy(false); }
  }

  async function guardarAsignaciones() {
    const list: Asignacion[] = Object.entries(asignaciones)
      .filter(([, pid]) => !!pid)
      .map(([equipo_id, profesor_id]) => ({ equipo_id, profesor_id }));
    if (!list.length) { setMsg({ kind: 'err', text: 'No hay asignaciones para guardar.' }); return; }

    setBusy(true); setMsg(null);
    try {
      await api.post(`/admin/sabanas/${cohorte}/asignar`, { asignaciones: list });
      setMsg({ kind: 'ok', text: `${list.length} asignaciones guardadas.` });
      await load();
    } catch (e: any) {
      setMsg({ kind: 'err', text: formatBackendError(e) });
    } finally { setBusy(false); }
  }

  async function comunicar() {
    if (!confirm('Se enviarán correos reales a los participantes de los proyectos con profesor asignado pendiente de notificar. Los correos salen en serie en segundo plano y cada fila se marca como "Comunicado" a medida que termina. ¿Continuar?')) return;
    setBusy(true); setMsg(null);
    try {
      const { data } = await api.post(`/admin/sabanas/${cohorte}/comunicar`, undefined, { timeout: 30000 });
      if (data?.nota) {
        setMsg({ kind: 'ok', text: data.nota });
      } else if (data?.iniciado) {
        setMsg({ kind: 'ok', text: data.mensaje ?? 'Comunicación iniciada. Los correos se envían en segundo plano.' });
        iniciarPollingComunicacion();
      }
    } catch (e: any) {
      setMsg({ kind: 'err', text: formatBackendError(e) });
    } finally { setBusy(false); }
  }

  // Refresco progresivo: mientras el backend envía en segundo plano, recargamos
  // el resumen en silencio (sin spinner) cada 5s; React solo re-renderiza las
  // filas cuyo estado "comunicado" cambió — así cada línea se actualiza sola.
  function iniciarPollingComunicacion() {
    if (pollRef.current) return;
    let ticks = 0;
    pollRef.current = window.setInterval(async () => {
      ticks++;
      try {
        const { data } = await api.get(`/sabana/${cohorte}/resumen`);
        const filas = (data?.filas ?? []) as FilaResumen[];
        setResumen(filas);
        const pendientes = filas.some((f) => f.profesor_asignado_id && !f.comunicado);
        if (!pendientes || ticks >= 84) { // hasta ~7 min
          if (pollRef.current) { window.clearInterval(pollRef.current); pollRef.current = null; }
          if (!pendientes) setMsg({ kind: 'ok', text: 'Comunicación completada: todos los equipos asignados quedaron comunicados.' });
        }
      } catch { /* reintenta en el próximo tick */ }
    }, 5000);
  }

  // Limpia el intervalo al desmontar.
  useEffect(() => () => { if (pollRef.current) window.clearInterval(pollRef.current); }, []);

  // Agrupar por equipo (vista Detalle / asignaciones — usa el snapshot)
  const equipos = snapshot.reduce((acc, item) => {
    if (!acc[item.equipo_id]) {
      acc[item.equipo_id] = { id: item.equipo_id, nombre: item.equipo_nombre, miembros: item.miembros, proyectos: [] };
    }
    acc[item.equipo_id].proyectos.push(item);
    return acc;
  }, {} as Record<string, { id: string; nombre: string | null; miembros: any[]; proyectos: Item[] }>);

  // === FUSIÓN por equipo_id =================================================
  // Enviados: filas reales del resumen de la sábana (acciones habilitadas) +
  //   metadatos de la lista viva (estado + id del anteproyecto para el enlace).
  // Borradores/no enviados: equipos que están en la lista viva pero NO en el
  //   resumen; se adaptan a FilaResumen y se muestran con acciones deshabilitadas.
  const itemsByEquipo = new Map(items.map((it) => [it.equipos.id, it]));
  const resumenIds = new Set(resumen.map((f) => f.equipo_id));
  const mergedRows: MergedFila[] = [
    ...resumen.map((f) => {
      const it = itemsByEquipo.get(f.equipo_id) ?? null;
      return { fila: f, enviado: true, anteproyecto_id: it?.id ?? null, estado: it ? estadoDisplay(it) : null };
    }),
    ...items
      .filter((it) => !resumenIds.has(it.equipos.id))
      .map((it) => ({ fila: itemToFila(it), enviado: false, anteproyecto_id: it.id, estado: estadoDisplay(it) })),
  ];

  return (
    <>
      <div className="border-b-[3px] border-inalde-red pb-4 mb-6">
        <p className="section-subtitle mb-1">Administración</p>
        <h1 className="section-title">Anteproyectos</h1>
        <p className="text-sm text-inalde-gray mt-2">Seguimiento y gestión de todos los anteproyectos de la cohorte. Consulta estado y detalle, asigna profesores y comunica.</p>
      </div>

      <div className="flex gap-3 mb-6 items-end">
        <div className="flex-1 max-w-sm">
          <label className="block font-primary font-semibold text-xs tracking-wider uppercase text-inalde-gray mb-1">Cohorte</label>
          <select value={cohorte} onChange={(e) => setCohorte(e.target.value)} className="input-inalde !py-2">
            <option value="">Selecciona…</option>
            {cohortes.map((c) => <option key={c.id} value={c.id}>{c.etiqueta}</option>)}
          </select>
        </div>
        {cohorte && (
          <>
            {/* Generar/Regenerar, Sugerir, Guardar y Comunicar son acciones de
                super_admin (el backend las restringe). El profesor solo lee y
                descarga PDF; por eso ocultamos esos botones para que no reciba
                un 403 al clickear. */}
            {isSuperAdmin && (
              <button onClick={generar} disabled={busy} className="btn-inalde-primary !py-2 !px-4 !text-xs">
                {snapshot.length ? 'Regenerar' : 'Generar sábana'}
              </button>
            )}
            {snapshot.length > 0 && (
              <>
                {isSuperAdmin && <button onClick={sugerir} disabled={busy} className="btn-inalde-ghost">Sugerir asignaciones</button>}
                {isSuperAdmin && <button onClick={guardarAsignaciones} disabled={busy} className="btn-inalde-secondary">Guardar asignaciones</button>}
                <button onClick={() => downloadFile(`/sabana/${cohorte}/pdf`, `sabana-${cohorte}.pdf`)} disabled={busy} className="btn-inalde-ghost">↓ PDF</button>
                {isSuperAdmin && <button onClick={comunicar} disabled={busy} className="btn-inalde-danger">Comunicar →</button>}
              </>
            )}
          </>
        )}
      </div>

      {estadoSabana && (
        <p className="text-xs text-inalde-gray mb-4">
          Estado de la sábana: <span className="font-semibold uppercase tracking-wider text-inalde-text">{estadoSabana}</span>
        </p>
      )}

      {msg && (
        <div className={`rounded border-l-4 px-4 py-3 text-sm mb-6 ${msg.kind === 'ok' ? 'border-inalde-blue bg-blue-50' : 'border-inalde-red bg-red-50'}`}>
          {msg.text}
        </div>
      )}

      {cohorte && (
        <div className="flex gap-2 mb-4 border-b border-inalde-gray-light">
          <button
            onClick={() => setVista('resumen')}
            className={`text-xs font-primary font-semibold uppercase tracking-wider px-3 py-2 -mb-px border-b-2 transition ${vista === 'resumen' ? 'border-inalde-red text-inalde-red' : 'border-transparent text-inalde-gray hover:text-inalde-text'}`}>
            Tabla resumen
          </button>
          <button
            onClick={() => setVista('detalle')}
            className={`text-xs font-primary font-semibold uppercase tracking-wider px-3 py-2 -mb-px border-b-2 transition ${vista === 'detalle' ? 'border-inalde-red text-inalde-red' : 'border-transparent text-inalde-gray hover:text-inalde-text'}`}>
            Detalle por equipo (asignaciones)
          </button>
        </div>
      )}

      {/* === Vista resumen: tabla operativa + estado + enlace al detalle === */}
      {vista === 'resumen' && cohorte ? (
        loadingResumen ? <p className="text-inalde-gray">Cargando resumen…</p> :
          errorResumen ? (
            <div className="rounded border-l-4 border-inalde-red bg-red-50 px-4 py-3 text-sm flex items-center justify-between gap-4">
              <span>No se pudo cargar la tabla resumen (el servidor no respondió). No significa que esté vacía.</span>
              <button onClick={() => loadResumen()} className="btn-inalde-ghost !py-1.5 !px-3 !text-xs whitespace-nowrap">Reintentar</button>
            </div>
          ) :
          mergedRows.length === 0 ? <p className="text-inalde-gray text-sm">Esta cohorte aún no tiene proyectos cargados.</p> : (() => {
            // Aplicar filtros
            // Un equipo está "asignado" si tiene profesor (BP) o director (caso/PI).
            const esAsignado = (f: FilaResumen) => !!(f.profesor_asignado_id || f.director_asignado_nombre);
            const q = filtroBuscar.trim().toLowerCase();
            const filtrados = mergedRows.filter((m) => {
              const f = m.fila;
              if (soloMios && f.profesor_asignado_id !== miProfesorId) return false;
              if (filtroModalidad !== 'todas' && f.modalidad !== filtroModalidad) return false;
              if (filtroEstado && m.estado?.key !== filtroEstado) return false;
              if (filtroAsignacion === 'asignados' && !esAsignado(f)) return false;
              if (filtroAsignacion === 'no_asignados' && esAsignado(f)) return false;
              if (filtroComunicado === 'comunicados' && !f.comunicado) return false;
              if (filtroComunicado === 'pendientes' && !(f.profesor_asignado_id && !f.comunicado)) return false;
              if (!q) return true;
              const hay = [
                f.autores,
                f.nombre_equipo ?? '',
                f.profesor_asignado_nombre ?? '',
                f.director_asignado_nombre ?? '',
                ...f.proyectos.map((p) => `${p.nombre} ${p.sector ?? ''}`),
              ].join(' ').toLowerCase();
              return hay.includes(q);
            }).sort((a, b) => {
              // Orden por modalidad: BP → Caso → Proyecto de investigación
              const ord: Record<string, number> = { business_plan: 0, caso: 1, proyecto_investigacion: 2 };
              return (ord[a.fila.modalidad] ?? 9) - (ord[b.fila.modalidad] ?? 9);
            });
            const filas = mergedRows.map((m) => m.fila);
            const contar = (mod: string) => filas.filter((f) => f.modalidad === mod).length;
            const totalBP = contar('business_plan');
            const totalCaso = contar('caso');
            const totalPI = contar('proyecto_investigacion');
            const totalAsignados = filas.filter(esAsignado).length;
            const totalNoAsignados = filas.length - totalAsignados;
            const totalComunicados = filas.filter((f) => f.comunicado).length;
            const totalPendientesComunicar = filas.filter((f) => f.profesor_asignado_id && !f.comunicado).length;
            // Estados presentes en los datos (para el filtro de estado)
            const estadosPresentes = new Set(mergedRows.map((m) => m.estado?.key).filter(Boolean) as string[]);
            const estadosDisponibles = Object.keys(ESTADO_LABELS).filter((k) => estadosPresentes.has(k));
            // Conteo de equipos asignados por profesor (para los chips informativos)
            // Avance de reuniones por profesor: cuántos de sus equipos ya tienen
            // marcada la Reunión 1 y la 2. Sale de contar las casillas de la
            // sábana, así que el indicador y la tabla nunca se contradicen.
            const porProfesor = filas.reduce((acc, f) => {
              const nom = f.profesor_asignado_nombre;
              if (!nom) return acc;
              const p = acc.get(nom) ?? { total: 0, r1: 0, r2: 0 };
              p.total++; if (f.reunion_1) p.r1++; if (f.reunion_2) p.r2++;
              acc.set(nom, p);
              return acc;
            }, new Map<string, { total: number; r1: number; r2: number }>());
            const pct = (n: number, t: number) => (t ? Math.round((n / t) * 100) : 0);
            return (
              <>
                {/* Barra de filtros */}
                <div className="flex flex-wrap items-center gap-2 mb-3">
                  {/* Solo para profesores: la sábana llega completa y este botón
                      la reduce a los equipos que tienen asignados. */}
                  {miProfesorId && (
                    <button
                      onClick={() => setSoloMios(!soloMios)}
                      aria-pressed={soloMios}
                      title={soloMios ? 'Estás viendo solo tus equipos. Toca para ver toda la cohorte.' : 'Ver solo los equipos que tienes asignados'}
                      className={`text-[11px] font-semibold uppercase tracking-wider px-3 py-1.5 rounded-full border transition ${soloMios
                        ? 'border-inalde-red bg-inalde-red text-white'
                        : 'border-inalde-gray-light text-inalde-gray hover:border-inalde-gray hover:text-inalde-text'}`}>
                      {soloMios ? '✓ ' : ''}Mis equipos · {filas.filter((f) => f.profesor_asignado_id === miProfesorId).length}
                    </button>
                  )}
                  <div className="flex gap-1">
                    {([
                      ['todas', `Todas · ${filas.length}`],
                      ['business_plan', `BP · ${totalBP}`],
                      ['caso', `Caso · ${totalCaso}`],
                      ['proyecto_investigacion', `PI · ${totalPI}`],
                    ] as const).map(([k, label]) => (
                      <button key={k}
                        onClick={() => setFiltroModalidad(k as any)}
                        className={`text-[11px] font-semibold uppercase tracking-wider px-3 py-1.5 rounded-full border transition ${filtroModalidad === k
                          ? 'border-inalde-red bg-inalde-red text-white'
                          : 'border-inalde-gray-light text-inalde-gray hover:border-inalde-gray hover:text-inalde-text'}`}>
                        {label}
                      </button>
                    ))}
                  </div>

                  <div className="w-px h-5 bg-inalde-gray-light" />

                  {/* Filtro por estado de asignación */}
                  <div className="flex gap-1">
                    {([
                      ['asignados', `Asignados · ${totalAsignados}`],
                      ['no_asignados', `No asignados · ${totalNoAsignados}`],
                    ] as const).map(([k, label]) => (
                      <button key={k}
                        onClick={() => setFiltroAsignacion(filtroAsignacion === k ? 'todas' : k)}
                        className={`text-[11px] font-semibold uppercase tracking-wider px-3 py-1.5 rounded-full border transition ${filtroAsignacion === k
                          ? 'border-inalde-red bg-inalde-red text-white'
                          : 'border-inalde-gray-light text-inalde-gray hover:border-inalde-gray hover:text-inalde-text'}`}>
                        {label}
                      </button>
                    ))}
                  </div>

                  <div className="w-px h-5 bg-inalde-gray-light" />

                  {/* Filtro por estado de comunicación (correo enviado) */}
                  <div className="flex gap-1">
                    {([
                      ['comunicados', `Comunicados · ${totalComunicados}`],
                      ['pendientes', `Sin comunicar · ${totalPendientesComunicar}`],
                    ] as const).map(([k, label]) => (
                      <button key={k}
                        onClick={() => setFiltroComunicado(filtroComunicado === k ? 'todos' : k)}
                        className={`text-[11px] font-semibold uppercase tracking-wider px-3 py-1.5 rounded-full border transition ${filtroComunicado === k
                          ? 'border-inalde-blue bg-inalde-blue text-white'
                          : 'border-inalde-gray-light text-inalde-gray hover:border-inalde-gray hover:text-inalde-text'}`}>
                        {label}
                      </button>
                    ))}
                  </div>

                  {estadosDisponibles.length > 0 && (
                    <>
                      <div className="w-px h-5 bg-inalde-gray-light" />
                      {/* Filtro por estado del anteproyecto (borrador/enviado/…) */}
                      <select
                        value={filtroEstado}
                        onChange={(e) => setFiltroEstado(e.target.value)}
                        title="Filtrar por estado"
                        className={`text-[11px] font-semibold uppercase tracking-wider px-3 py-1.5 rounded-full border bg-white cursor-pointer focus:outline-none ${filtroEstado
                          ? 'border-inalde-red text-inalde-red'
                          : 'border-inalde-gray-light text-inalde-gray'}`}>
                        <option value="">Estado ▾</option>
                        {estadosDisponibles.map((k) => <option key={k} value={k}>{ESTADO_LABELS[k]}</option>)}
                      </select>
                    </>
                  )}

                  <div className="flex-1 min-w-[200px] ml-auto">
                    <input type="text" placeholder="Buscar autor, proyecto, sector, profesor…"
                      value={filtroBuscar}
                      onChange={(e) => setFiltroBuscar(e.target.value)}
                      className="w-full text-sm border border-inalde-gray-light rounded px-3 py-1.5 focus:outline-none focus:border-inalde-red" />
                  </div>
                </div>

                {/* Conteo de equipos asignados por profesor */}
                {porProfesor.size > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 mb-3 -mt-1">
                    <span className="text-[10px] uppercase tracking-wider text-inalde-gray font-semibold mr-1">Asignados por profesor:</span>
                    {[...porProfesor.entries()].sort((a, b) => b[1].total - a[1].total).map(([nombre, p]) => (
                      <span key={nombre} className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-inalde-gold/15 text-[#8a7530] border border-inalde-gold/30 whitespace-nowrap"
                        title={`${nombre}: ${p.total} equipo(s) asignado(s). Reunión 1: ${p.r1} de ${p.total} (${pct(p.r1, p.total)}%). Reunión 2: ${p.r2} de ${p.total} (${pct(p.r2, p.total)}%).`}>
                        {nombre} · {p.total}
                        <span className="ml-1.5 text-inalde-gray font-normal">|</span>
                        <span className={`ml-1.5 ${p.r1 === p.total ? 'text-green-700' : ''}`}>R1 {p.r1}/{p.total} ({pct(p.r1, p.total)}%)</span>
                        <span className={`ml-1.5 ${p.r2 === p.total ? 'text-green-700' : ''}`}>R2 {p.r2}/{p.total} ({pct(p.r2, p.total)}%)</span>
                      </span>
                    ))}
                  </div>
                )}

                {/* Tabla */}
                <div className="rounded-lg border border-inalde-gray-light overflow-auto max-h-[72vh] shadow-inalde-card bg-white w-fit max-w-full">
                  <div>
                    <table className="text-sm border-collapse w-auto">
                      <thead>
                        <tr className="bg-gradient-to-b from-inalde-text to-[#2a2a2a]">
                          <th className="px-2.5 py-3 text-[11px] uppercase tracking-wider text-white/90 font-semibold text-left">#</th>
                          <th className="px-2.5 py-3 text-[11px] uppercase tracking-wider text-white/90 font-semibold text-left">Autores</th>
                          <th className="px-2.5 py-3 text-[11px] uppercase tracking-wider text-white/90 font-semibold text-left">Proyecto(s)</th>
                          <th className="px-2.5 py-3 text-[11px] uppercase tracking-wider text-white/90 font-semibold text-left">Sector</th>
                          <th className="px-2.5 py-3 text-[11px] uppercase tracking-wider text-white/90 font-semibold text-left">CIIU</th>
                          <th className="px-2.5 py-3 text-[11px] uppercase tracking-wider text-white/90 font-semibold text-left">Problema · Solución</th>
                          <th className="px-2.5 py-3 text-[11px] uppercase tracking-wider text-white/90 font-semibold text-center" title="¿Está buscando socios?">Socios</th>
                          <th className="px-2.5 py-3 text-[11px] uppercase tracking-wider text-white/90 font-semibold text-center" title="¿Busca asociación con otro proyecto?">Asoc.</th>
                          <th className="px-2.5 py-3 text-[11px] uppercase tracking-wider text-white/90 font-semibold text-left">Modalidad</th>
                          <th className="px-2.5 py-3 text-[11px] uppercase tracking-wider text-white/90 font-semibold text-left">Profesor / Director</th>
                          <th className="px-2.5 py-3 text-[11px] uppercase tracking-wider text-white/90 font-semibold text-left">Estado</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filtrados.length === 0 ? (
                          <tr>
                            <td colSpan={11} className="px-3 py-12 text-center text-inalde-gray italic">
                              No hay equipos que coincidan con el filtro.
                            </td>
                          </tr>
                        ) : filtrados.map((m, idx) => {
                          const f = m.fila;
                          const enviado = m.enviado;
                          return (
                          <tr key={f.equipo_id}
                            className={`border-t border-inalde-gray-light/60 align-top transition ${idx % 2 === 0 ? 'bg-white' : 'bg-inalde-gray-bg/40'} ${enviado ? '' : 'opacity-80'} hover:bg-inalde-red/5`}>
                            <td className="px-2.5 py-3 align-top">
                              <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-inalde-text text-white text-xs font-bold font-mono">
                                {idx + 1}
                              </span>
                              <div className="flex items-center gap-2 mt-2">
                                {isSuperAdmin && enviado && (
                                  <button
                                    onClick={() => borrarEquipo(f.equipo_id, f.nombre_equipo || f.autores || `equipo #${idx + 1}`)}
                                    title="Borrar equipo completo"
                                    className="text-inalde-gray hover:text-inalde-red transition text-sm leading-none">
                                    🗑
                                  </button>
                                )}
                                {enviado && f.modalidad === 'business_plan' && f.profesor_asignado_id && (
                                  f.comunicado ? (
                                    <span className="text-[10px] font-bold uppercase tracking-wider text-green-700 leading-none whitespace-nowrap" title="Correo de asignación ya enviado a los participantes">✉️ Comunicado</span>
                                  ) : isSuperAdmin ? (
                                    <button
                                      onClick={() => comunicarEquipo(f.equipo_id)}
                                      disabled={comunicandoEquipo === f.equipo_id}
                                      title="Enviar ahora el correo de asignación a este equipo"
                                      className="text-[10px] font-bold uppercase tracking-wider text-white bg-inalde-blue hover:bg-inalde-blue/90 rounded px-2 py-1 leading-none whitespace-nowrap disabled:opacity-50">
                                      {comunicandoEquipo === f.equipo_id ? 'Enviando…' : 'Comunicar'}
                                    </button>
                                  ) : (
                                    <span className="text-[10px] font-bold uppercase tracking-wider text-inalde-gold leading-none whitespace-nowrap" title="Aún no se ha enviado el correo de asignación">⏳ Sin comunicar</span>
                                  )
                                )}
                              </div>
                              {/* Reuniones: las marca el profesor del equipo (o el
                                  super_admin). Solo para equipos enviados. */}
                              <div className="mt-2 space-y-1">
                                {([1, 2] as const).map((n) => {
                                  const marcada = n === 1 ? f.reunion_1 : f.reunion_2;
                                  const puede = enviado && (isSuperAdmin || f.profesor_asignado_id === miProfesorId);
                                  return (
                                    <label key={n} className={`flex items-center gap-1.5 ${puede ? 'cursor-pointer' : 'cursor-default'}`}
                                      title={puede ? `Marcar que ya tuviste la Reunión ${n} con este equipo` : (enviado ? 'Solo el profesor asignado puede marcarla' : 'Disponible cuando el equipo envíe su anteproyecto')}>
                                      <input
                                        type="checkbox"
                                        checked={marcada}
                                        disabled={!puede || marcandoReunion === `${f.equipo_id}-${n}`}
                                        onChange={(e) => marcarReunion(f.equipo_id, n, e.target.checked)}
                                        className="accent-inalde-red w-3.5 h-3.5 disabled:opacity-40"
                                      />
                                      <span className={`text-[10px] font-bold uppercase tracking-wider leading-none whitespace-nowrap ${marcada ? 'text-inalde-red' : 'text-inalde-gray'}`}>
                                        Reunión {n}
                                      </span>
                                    </label>
                                  );
                                })}
                              </div>
                            </td>
                            <td className="px-2.5 py-3 align-top">
                              <div className="max-w-[210px] min-w-[140px]">
                                <p className="font-medium text-inalde-text break-words leading-snug" title={f.autores}>
                                  {f.autores || <span className="italic text-inalde-gray font-normal">—</span>}
                                </p>
                                {f.nombre_equipo && (
                                  <p className="text-[11px] text-inalde-gray uppercase tracking-wider mt-0.5 break-words" title={f.nombre_equipo}>
                                    {f.nombre_equipo}
                                  </p>
                                )}
                              </div>
                            </td>
                            <td className="px-2.5 py-3 align-top">
                              <div className="max-w-[240px] min-w-[150px]">
                                {f.proyectos.length > 1 ? (
                                  <div className="space-y-2">
                                    {f.proyectos.map((p, i) => (
                                      <div key={p.id || i} className="bg-inalde-gold/5 border-l-[3px] border-inalde-gold rounded-sm pl-2.5 py-1.5">
                                        <p className="text-[9px] uppercase tracking-wider text-inalde-gold font-bold mb-0.5">Proyecto {i + 1}</p>
                                        <p className="font-medium text-inalde-text leading-tight break-words" title={p.nombre}>{p.nombre}</p>
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <p className="font-medium text-inalde-text leading-snug break-words" title={f.proyectos[0]?.nombre}>
                                    {f.proyectos[0]?.nombre ?? <span className="italic text-inalde-gray font-normal">—</span>}
                                  </p>
                                )}
                              </div>
                            </td>
                            <td className="px-2.5 py-3 align-top text-inalde-gray text-xs">
                              <div className="max-w-[130px] break-words">
                                {f.proyectos.length > 1 ? (
                                  <div className="space-y-2">
                                    {f.proyectos.map((p, i) => (
                                      <div key={p.id || i} className="leading-tight">
                                        <span className="text-[9px] uppercase tracking-wider text-inalde-gold font-bold">P{i + 1}</span>{' '}
                                        {p.sector || <span className="italic">—</span>}
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  f.proyectos[0]?.sector ?? <span className="italic">—</span>
                                )}
                              </div>
                            </td>
                            <td className="px-2.5 py-3 align-top">
                              {f.proyectos.length > 1 ? (
                                <div className="space-y-2">
                                  {f.proyectos.map((p, i) => (
                                    <div key={p.id || i} className="leading-tight">
                                      <span className="text-[9px] uppercase tracking-wider text-inalde-gold font-bold">P{i + 1}</span>{' '}
                                      <span className="font-mono text-xs text-inalde-text">{p.ciiu || <span className="italic text-inalde-gray">—</span>}</span>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <span className="font-mono text-xs text-inalde-text">{f.proyectos[0]?.ciiu || <span className="italic text-inalde-gray">—</span>}</span>
                              )}
                            </td>
                            <td className="px-2.5 py-3 align-top text-xs">
                              <div className="max-w-[620px] min-w-[440px]">
                              {f.proyectos.length > 1 ? (
                                <div className="space-y-3">
                                  {f.proyectos.map((p, i) => (
                                    <div key={p.id || i} className="border-l-2 border-inalde-gold/40 pl-2">
                                      <p className="text-[9px] uppercase tracking-wider text-inalde-gold font-bold mb-1">Proyecto {i + 1}</p>
                                      {p.canvas_problema && (
                                        <p className="text-inalde-text leading-snug mb-1"><span className="text-[10px] uppercase tracking-wider text-inalde-gray font-semibold">Problema:</span> {p.canvas_problema}</p>
                                      )}
                                      {p.canvas_solucion && (
                                        <p className="text-inalde-text leading-snug"><span className="text-[10px] uppercase tracking-wider text-inalde-gray font-semibold">Solución:</span> {p.canvas_solucion}</p>
                                      )}
                                      {!p.canvas_problema && !p.canvas_solucion && <span className="italic text-inalde-gray">—</span>}
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                (() => {
                                  const p = f.proyectos[0];
                                  if (!p?.canvas_problema && !p?.canvas_solucion) return <span className="italic text-inalde-gray">—</span>;
                                  return (
                                    <div className="leading-snug">
                                      {p?.canvas_problema && (
                                        <p className="text-inalde-text mb-1"><span className="text-[10px] uppercase tracking-wider text-inalde-gray font-semibold">Problema:</span> {p.canvas_problema}</p>
                                      )}
                                      {p?.canvas_solucion && (
                                        <p className="text-inalde-text"><span className="text-[10px] uppercase tracking-wider text-inalde-gray font-semibold">Solución:</span> {p.canvas_solucion}</p>
                                      )}
                                    </div>
                                  );
                                })()
                              )}
                              </div>
                            </td>
                            <td className="px-2.5 py-3 text-center align-top">
                              {enviado && isSuperAdmin ? (
                                <select
                                  value={f.buscando_socios === null ? '' : f.buscando_socios ? 'si' : 'no'}
                                  onChange={(e) => { const v = e.target.value; actualizarFlag(f.equipo_id, 'buscando_socios', v === '' ? null : v === 'si'); }}
                                  className="border border-inalde-gray-light rounded px-1.5 py-1 text-xs bg-white hover:border-inalde-gray focus:outline-none focus:border-inalde-red focus:ring-1 focus:ring-inalde-red/30">
                                  <option value="">—</option>
                                  <option value="si">SÍ</option>
                                  <option value="no">NO</option>
                                </select>
                              ) : (
                                <Pill value={f.buscando_socios} />
                              )}
                            </td>
                            <td className="px-2.5 py-3 text-center align-top">
                              {enviado && isSuperAdmin ? (
                                <select
                                  value={f.buscando_asociacion === null ? '' : f.buscando_asociacion ? 'si' : 'no'}
                                  onChange={(e) => { const v = e.target.value; actualizarFlag(f.equipo_id, 'buscando_asociacion', v === '' ? null : v === 'si'); }}
                                  className="border border-inalde-gray-light rounded px-1.5 py-1 text-xs bg-white hover:border-inalde-gray focus:outline-none focus:border-inalde-red focus:ring-1 focus:ring-inalde-red/30">
                                  <option value="">—</option>
                                  <option value="si">SÍ</option>
                                  <option value="no">NO</option>
                                </select>
                              ) : (
                                <Pill value={f.buscando_asociacion} />
                              )}
                            </td>
                            <td className="px-2.5 py-3 align-top">
                              <ModalidadPill modalidad={f.modalidad} />
                              {f.modalidad === 'business_plan' && f.proyectos.some((p) => p.tipo === 'intraemprendimiento') && (
                                <p className="text-[9px] uppercase text-inalde-gold font-semibold mt-1 leading-tight break-words">Intraemprendimiento</p>
                              )}
                            </td>
                            <td className="px-2.5 py-3 align-top break-words">
                              <div className="max-w-[200px] min-w-[150px]">
                              {f.modalidad === 'business_plan' ? (
                                enviado && isSuperAdmin ? (
                                  <select
                                    value={f.profesor_asignado_id ?? ''}
                                    onChange={(e) => asignarProfesor(f.equipo_id, e.target.value || null)}
                                    className={`w-full border rounded px-2 py-1 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-inalde-red/30 transition ${f.profesor_asignado_id ? 'border-inalde-red/40 text-inalde-text font-medium' : 'border-inalde-gray-light text-inalde-gray'}`}>
                                    <option value="">— Sin asignar —</option>
                                    {profesores.map((p) => (
                                      <option key={p.id} value={p.id}>{p.nombre_completo}</option>
                                    ))}
                                  </select>
                                ) : (
                                  <span className="text-inalde-text text-xs font-medium">
                                    {f.profesor_asignado_nombre ?? <span className="italic text-inalde-gray font-normal">— Sin asignar —</span>}
                                  </span>
                                )
                              ) : (
                                <div className="text-xs">
                                  <p className="text-[10px] uppercase tracking-wider text-inalde-gold font-semibold">Director</p>
                                  <p className="text-inalde-text font-medium">
                                    {f.director_asignado_nombre ?? <span className="italic text-inalde-gray font-normal">— Sin director —</span>}
                                  </p>
                                </div>
                              )}
                              </div>
                            </td>
                            <td className="px-2.5 py-3 align-top">
                              <div className="min-w-[110px]">
                                {m.estado && (
                                  <span className={`text-xs uppercase tracking-wider font-semibold ${m.estado.cls}`}>{m.estado.label}</span>
                                )}
                                {!enviado && (
                                  <p className="text-[9px] uppercase tracking-wider text-inalde-gray mt-0.5">No enviado</p>
                                )}
                                {m.anteproyecto_id && (
                                  <button
                                    onClick={() => navigate(`/admin/anteproyectos/${m.anteproyecto_id}`)}
                                    className="block mt-1.5 text-[11px] font-semibold text-inalde-red hover:underline">
                                    Ver →
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div className="px-4 py-2 bg-inalde-gray-bg/60 border-t border-inalde-gray-light text-[11px] text-inalde-gray flex justify-between items-center">
                    <span>Mostrando <strong className="text-inalde-text">{filtrados.length}</strong> de {mergedRows.length} equipos</span>
                    <span className="hidden sm:inline">Click en “Ver →” para abrir el detalle · selectores editables (solo super_admin)</span>
                  </div>
                </div>
              </>
            );
          })()
      ) : null}

      {/* === Vista detalle: original (asignaciones por equipo) === */}
      {vista === 'detalle' && (
      loading ? <p className="text-inalde-gray">Cargando…</p> :
        Object.keys(equipos).length === 0 ? (
          cohorte && (
            <p className="text-inalde-gray text-sm">
              {snapshot.length === 0 && estadoSabana === null
                ? 'La sábana aún no ha sido generada para esta cohorte. Genera para construirla.'
                : 'No hay anteproyectos enviados en esta cohorte.'}
            </p>
          )
        ) : (
          <div className="space-y-3">
            {Object.values(equipos).map((eq) => (
              <div key={eq.id} className="border border-inalde-gray-light rounded p-4">
                <div className="flex justify-between items-start gap-4">
                  <div className="flex-1">
                    <h3 className="font-primary font-bold text-inalde-text">
                      {eq.miembros.sort((a, b) => a.posicion - b.posicion).map((m) => m.nombre).join(' · ') || '(sin participantes)'}
                    </h3>
                    <div className="mt-3 space-y-2">
                      {eq.proyectos.map((p) => (
                        <div key={p.proyecto_id} className="text-sm">
                          <p>
                            <span className={`font-semibold ${p.estado_seleccion === 'archivado' ? 'text-inalde-gray line-through' : 'text-inalde-text'}`}>
                              {p.proyecto_nombre}
                            </span>
                            {p.sector && <span className="text-xs text-inalde-gray ml-2">[{p.sector}]</span>}
                            {p.ciiu && <span className="font-mono text-xs text-inalde-gold ml-2">CIIU {p.ciiu}</span>}
                          </p>
                          <p className="text-xs text-inalde-gray leading-snug">{p.resumen || <em>(sin resumen)</em>}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="w-56">
                    <label className="block text-xs uppercase tracking-wider text-inalde-gray mb-1">Profesor asignado</label>
                    {isSuperAdmin ? (
                      <select
                        value={asignaciones[eq.id] ?? ''}
                        onChange={(e) => asignarProfesor(eq.id, e.target.value || null)}
                        className="input-inalde !py-1 !text-sm"
                      >
                        <option value="">— Sin asignar —</option>
                        {profesores.map((p) => <option key={p.id} value={p.id}>{p.nombre_completo}</option>)}
                      </select>
                    ) : (
                      <p className="text-sm text-inalde-text font-medium">
                        {profesores.find((p) => p.id === asignaciones[eq.id])?.nombre_completo ?? <span className="italic text-inalde-gray font-normal">— Sin asignar —</span>}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {/* Modal de confirmación de borrado (in-app, no el confirm del navegador) */}
      {equipoABorrar && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
          onClick={() => { if (!borrando) setEquipoABorrar(null); }}>
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start gap-3 mb-4">
              <div className="text-3xl">🗑️</div>
              <div>
                <h3 className="font-primary font-bold text-lg text-inalde-text">¿Borrar este proyecto por completo?</h3>
                <p className="text-sm text-inalde-gray mt-1"><strong className="text-inalde-text">{equipoABorrar.etiqueta}</strong></p>
              </div>
            </div>
            <p className="text-sm text-inalde-gray leading-relaxed mb-5">
              Se eliminará el equipo, su anteproyecto, proyectos e hitos y la asignación de profesor.
              Los participantes <strong>no se borran</strong>: vuelven al pool de la cohorte para reasignarse.
              Esta acción es <strong className="text-inalde-red">irreversible</strong>.
            </p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setEquipoABorrar(null)} disabled={borrando}
                className="px-4 py-2 rounded font-primary font-semibold text-xs uppercase tracking-wider border-2 border-inalde-gray-light text-inalde-gray hover:border-inalde-gray disabled:opacity-50">
                Cancelar
              </button>
              <button onClick={confirmarBorrado} disabled={borrando}
                className="px-4 py-2 rounded font-primary font-semibold text-xs uppercase tracking-wider bg-inalde-red text-white hover:bg-inalde-red/90 disabled:opacity-50">
                {borrando ? 'Borrando…' : 'Sí, borrar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
