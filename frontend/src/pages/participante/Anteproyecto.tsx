import { useEffect, useMemo, useRef, useState } from 'react';

// Bloquea pegar y arrastrar texto en cualquier input. Por integridad académica.
const noPasteProps = {
  onPaste: (e: React.ClipboardEvent) => {
    e.preventDefault();
    alert('Por integridad académica, no se permite pegar texto. Escribe tu propia respuesta.');
  },
  onDrop: (e: React.DragEvent) => e.preventDefault(),
};
import { useNavigate } from 'react-router-dom';
import { Header } from '../../components/inalde/Header';
import { CiiuPicker } from '../../components/inalde/CiiuPicker';
import { api } from '../../lib/api';
import { formatBackendError } from '../../lib/errors';
import { AREAS_AFINIDAD } from '../../lib/areas';

// ============== Catálogos (alineados con DOCUMENTACION_BACKEND.md) ==========
type Emocion = 'crear' | 'dinero' | 'problema' | 'autonomia' | 'ninguna';
type Preocupacion = 'financiera' | 'estres' | 'habilidades' | 'familia' | 'ninguna';
type Perfil = 'emprendedor' | 'directivo' | 'ambos';
type EstadoProyecto = 'idea' | 'investigacion' | 'prototipo' | 'validacion' | 'funcionamiento';
type Quiebra = 'nunca_despego' | 'funcionamiento' | 'vendido' | 'quebro' | 'na';

const ESTADOS_PROYECTO: Array<{ value: EstadoProyecto; label: string }> = [
  { value: 'idea',           label: 'Solo idea' },
  { value: 'investigacion',  label: 'Investigación de mercado' },
  { value: 'prototipo',      label: 'Prototipo' },
  { value: 'validacion',     label: 'Validación con clientes' },
  { value: 'funcionamiento', label: 'Empresa en funcionamiento (Intraemprendimiento)' },
];

const CANVAS_FIELDS: Array<{ key: keyof Proyecto; label: string; placeholder: string; max: number }> = [
  { key: 'canvas_cliente',  label: 'Cliente',  placeholder: '¿Quién es tu cliente? Edad, sector, comportamiento, dónde está…', max: 1000 },
  { key: 'canvas_problema', label: 'Problema', placeholder: '¿Qué dolor o necesidad le resuelves? ¿Cómo lo soluciona hoy?', max: 1000 },
  { key: 'canvas_solucion', label: 'Solución', placeholder: '¿Qué ofreces? ¿Cómo lo resuelves de manera distinta o mejor?', max: 1000 },
  { key: 'canvas_canales',          label: 'Canales',                      placeholder: '¿App, web, presencial, redes sociales, partnerships?', max: 300 },
  { key: 'canvas_relaciones',       label: 'Relación con clientes',        placeholder: 'Soporte, comunidad, capacitación, ¿qué tipo de relación buscas?', max: 300 },
  { key: 'canvas_ingresos',         label: 'Modelo de ingresos',           placeholder: '¿Por producto, servicio, suscripción, comisiones, licencias?', max: 300 },
  { key: 'canvas_recursos',         label: 'Recursos clave',               placeholder: 'Tecnología, talento, dinero, partnerships, ¿qué es crítico?', max: 300 },
  { key: 'canvas_actividades',      label: 'Actividades clave',            placeholder: '¿Cuáles son las acciones principales para hacer funcionar tu negocio?', max: 300 },
  { key: 'canvas_socios',           label: 'Socios clave',                 placeholder: '¿Proveedores, distribuidores, complementadores, consultores?', max: 300 },
  { key: 'canvas_costos',           label: 'Estructura de costos',         placeholder: 'Desarrollo, marketing, operaciones, salarios, ¿cuáles son los gastos?', max: 300 },
];

// Hitos pre-definidos del plan de trabajo NAVES (cronograma del programa)
const PRESET_HITOS: Array<{ descripcion: string; fecha_fin: string }> = [
  { descripcion: 'Entrega Anteproyecto',                  fecha_fin: '2026-01-20' },
  { descripcion: 'Primera Reunión Obligatoria',           fecha_fin: '2026-02-13' },
  { descripcion: 'Diseño de Modelo Financiero',           fecha_fin: '2026-02-21' },
  { descripcion: 'Recolección de Información de Mercado', fecha_fin: '2026-03-14' },
  { descripcion: 'Cuantificación de la Oportunidad',      fecha_fin: '2026-03-21' },
  { descripcion: 'Definición de Modelo de Negocio',       fecha_fin: '2026-03-28' },
  { descripcion: 'Diseño de Plan de Marketing',           fecha_fin: '2026-04-11' },
  { descripcion: 'Segunda Reunión Obligatoria',           fecha_fin: '2026-04-17' },
  { descripcion: 'Cierre de Modelo Financiero',           fecha_fin: '2026-05-01' },
  { descripcion: 'Consolidación Documento Final',         fecha_fin: '2026-05-15' },
];
const PRESET_HITO_NAMES = new Set(PRESET_HITOS.map((h) => h.descripcion));
const MIN_HITOS = 5;

// =============== Tipos ====================================================
interface Hito {
  posicion: number;
  descripcion: string;
  fecha_inicio: string;
  fecha_fin: string;
}

interface Proyecto {
  posicion: number;
  nombre: string;
  tipo: 'emprendimiento' | 'intraemprendimiento';
  sector: string;
  ciiu: string;
  canvas_cliente: string;
  canvas_problema: string;
  canvas_solucion: string;
  canvas_canales: string;
  canvas_relaciones: string;
  canvas_ingresos: string;
  canvas_recursos: string;
  canvas_actividades: string;
  canvas_socios: string;
  canvas_costos: string;
  estado: EstadoProyecto;
  fuentes_primarias: string;
  fuentes_secundarias: string;
  hitos: Hito[];
}

interface MiembroForm {
  participante_id: string;
  posicion: number;
  nombre: string;
  fue_emprendedor: boolean;
  quiebra: Quiebra;
  aprendizajes_quiebra: string;
  perfil: Perfil;
  emociones: Emocion[];
  preocupaciones: Preocupacion[];
}

interface Cohorte {
  id: string;
  etiqueta: string;
  fecha_inicio: string;
  fecha_fin: string;
  fecha_limite_entrega_anteproyecto: string | null;
}

// =============== Helpers ===================================================
function emptyHito(posicion: number): Hito {
  return { posicion, descripcion: '', fecha_inicio: '', fecha_fin: '' };
}

function emptyProyecto(posicion: number): Proyecto {
  return {
    posicion, nombre: '', tipo: 'emprendimiento', sector: '', ciiu: '',
    canvas_cliente: '', canvas_problema: '', canvas_solucion: '',
    canvas_canales: '', canvas_relaciones: '',
    canvas_ingresos: '', canvas_recursos: '', canvas_actividades: '',
    canvas_socios: '', canvas_costos: '',
    estado: 'idea',
    fuentes_primarias: '', fuentes_secundarias: '',
    hitos: [emptyHito(1)],
  };
}

function fmtFecha(iso: string): string {
  if (!iso) return '';
  return new Date(iso + (iso.length === 10 ? 'T12:00:00' : '')).toLocaleDateString('es-CO', {
    year: 'numeric', month: 'long', day: 'numeric',
  });
}

// =============== Componente principal ======================================
export default function Anteproyecto() {
  const navigate = useNavigate();
  const [anteId, setAnteId] = useState<string | null>(null);
  const [estado, setEstado] = useState<string>('borrador');
  const [equipoNombre, setEquipoNombre] = useState<string>('');
  // Sabana de proyectos: dos flags a nivel de equipo. NULL = no contestado.
  const [buscandoSocios, setBuscandoSocios] = useState<boolean | null>(null);
  const [buscandoAsociacion, setBuscandoAsociacion] = useState<boolean | null>(null);
  const [cohorte, setCohorte] = useState<Cohorte | null>(null);
  const [miembros, setMiembros] = useState<MiembroForm[]>([]);
  const [proyectos, setProyectos] = useState<Proyecto[]>([emptyProyecto(1)]);
  const [activeTab, setActiveTab] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [envioConfirmacion, setEnvioConfirmacion] = useState<{ fechaEnvio: string; autoDefinitivo: boolean } | null>(null);
  const [autoSaveEstado, setAutoSaveEstado] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [equipoId, setEquipoId] = useState<string | null>(null);
  const [localRecovered, setLocalRecovered] = useState(false);
  // Refs para serializar guardados (auto + manual) y prevenir races contra
  // el endpoint PUT que hace muchos delete/insert por debajo.
  const savingRef = useRef(false);
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const periodicSaveTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const localBackupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Ref que siempre apunta al buildPayload mas reciente. El setInterval del
  // periodic save (deps minimas para que el cronometro no se resetee) lee de
  // aqui en vez de capturar la closure inicial — si no, mandaria el state
  // del primer render (proyectos vacios) cada 30 s.
  const buildPayloadRef = useRef<() => unknown>(() => ({}));

  // Llave en localStorage para el borrador local del equipo. Sobrevive logout
  // y se restaura al volver a entrar si es mas reciente que lo del backend.
  function localKey(eqId: string) { return `naves-anteproyecto-draft-${eqId}`; }

  // ----- Carga inicial -----
  useEffect(() => { (async () => {
    setLoading(true);
    try {
      const eq = await api.get('/equipos/mi-equipo');
      if (!eq.data.equipo) { navigate('/equipo'); return; }
      const eqId = eq.data.equipo.id;
      setEquipoId(eqId);
      setEquipoNombre(eq.data.equipo.nombre_equipo ?? '');
      setBuscandoSocios(eq.data.equipo.buscando_socios ?? null);
      setBuscandoAsociacion(eq.data.equipo.buscando_asociacion_otro_proyecto ?? null);

      const ms: MiembroForm[] = eq.data.equipo.miembros_equipo
        .sort((a: any, b: any) => a.posicion - b.posicion)
        .map((m: any) => ({
          participante_id: m.participantes_lista.id,
          posicion: m.posicion,
          nombre: m.participantes_lista.nombre_completo,
          fue_emprendedor: m.fue_emprendedor ?? false,
          quiebra: (m.quiebra as Quiebra) ?? 'na',
          aprendizajes_quiebra: m.aprendizajes_quiebra ?? '',
          perfil: (m.perfil as Perfil) ?? 'emprendedor',
          emociones: [],
          preocupaciones: [],
        }));
      setMiembros(ms);

      const [ant, coh] = await Promise.all([
        api.get('/anteproyectos/mi-anteproyecto'),
        api.get('/cohortes/mi-cohorte'),
      ]);
      if (coh.data.cohorte) setCohorte(coh.data.cohorte);

      // Datos del backend
      let proyectosFromBackend: Proyecto[] | null = null;
      let backendUpdatedAt = '';
      if (ant.data.anteproyecto) {
        setAnteId(ant.data.anteproyecto.id);
        setEstado(ant.data.anteproyecto.estado);
        backendUpdatedAt = ant.data.anteproyecto.fecha_actualizacion ?? '';
        const ps: any[] = ant.data.anteproyecto.proyectos ?? [];
        if (ps.length) {
          const cleanProj = (p: any): Proyecto => {
            const base = emptyProyecto(p.posicion);
            const result: any = { ...base };
            for (const key of Object.keys(base)) {
              if (key === 'hitos') continue;
              const v = p[key];
              result[key] = (v === null || v === undefined) ? (base as any)[key] : v;
            }
            result.hitos = (p.hitos ?? []).length
              ? p.hitos.sort((a: any, b: any) => a.posicion - b.posicion)
              : base.hitos;
            return result as Proyecto;
          };
          proyectosFromBackend = ps.sort((a, b) => a.posicion - b.posicion).map(cleanProj);
        }
      }

      // Revisar copia local: si es mas reciente que el backend, restaurar.
      // Sobrevive logout / refresh / token expirado.
      try {
        const raw = window.localStorage.getItem(localKey(eqId));
        if (raw) {
          const local = JSON.parse(raw) as { savedAt: string; proyectos: Proyecto[]; buscandoSocios: boolean | null; buscandoAsociacion: boolean | null };
          const localIsNewer = !backendUpdatedAt || (local.savedAt && local.savedAt > backendUpdatedAt);
          if (localIsNewer && Array.isArray(local.proyectos) && local.proyectos.length > 0) {
            setProyectos(local.proyectos);
            if (local.buscandoSocios !== undefined) setBuscandoSocios(local.buscandoSocios);
            if (local.buscandoAsociacion !== undefined) setBuscandoAsociacion(local.buscandoAsociacion);
            setLocalRecovered(true);
          } else if (proyectosFromBackend) {
            setProyectos(proyectosFromBackend);
          }
        } else if (proyectosFromBackend) {
          setProyectos(proyectosFromBackend);
        }
      } catch {
        if (proyectosFromBackend) setProyectos(proyectosFromBackend);
      }
    } catch (e: any) {
      setMsg({ kind: 'err', text: formatBackendError(e) });
    } finally { setLoading(false); }
  })(); }, [navigate]);

  // ----- Mutadores -----
  const numProyectos = proyectos.length;
  function setNumProyectos(n: number) {
    if (n === numProyectos) return;
    const next = [...proyectos];
    while (next.length < n) next.push(emptyProyecto(next.length + 1));
    while (next.length > n) next.pop();
    setProyectos(next);
    if (activeTab >= n) setActiveTab(n - 1);
  }

  function updateProyecto(i: number, patch: Partial<Proyecto>) {
    setProyectos((p) => p.map((x, idx) => idx === i ? { ...x, ...patch } : x));
  }
  function updateHito(pi: number, hi: number, patch: Partial<Hito>) {
    setProyectos((p) => p.map((proj, idx) => {
      if (idx !== pi) return proj;
      const updatedHitos = proj.hitos.map((h, j) => j === hi ? { ...h, ...patch } : h);

      // Auto-grow: si se llenó la descripción del ÚLTIMO hito y hay margen (<10),
      // aparece un hito vacío extra para que el usuario lo siga llenando.
      const isLastHito = hi === proj.hitos.length - 1;
      const tieneDescripcion = ((patch.descripcion ?? proj.hitos[hi].descripcion) ?? '').trim().length > 0;
      const yaSeAutoExpandio = updatedHitos.length > proj.hitos.length;

      if (isLastHito && tieneDescripcion && updatedHitos.length < 10 && !yaSeAutoExpandio) {
        updatedHitos.push(emptyHito(updatedHitos.length + 1));
      }
      return { ...proj, hitos: updatedHitos };
    }));
  }
  function addHito(pi: number) {
    setProyectos((p) => p.map((proj, idx) =>
      idx === pi ? { ...proj, hitos: [...proj.hitos, emptyHito(proj.hitos.length + 1)] } : proj));
  }
  function removeHito(pi: number, hi: number) {
    setProyectos((p) => p.map((proj, idx) => {
      if (idx !== pi) return proj;
      const next = proj.hitos.filter((_, j) => j !== hi).map((h, j) => ({ ...h, posicion: j + 1 }));
      return { ...proj, hitos: next };
    }));
  }

  // ----- Progress (% de campos llenos) -----
  const progress = useMemo(() => {
    const s = (v: unknown) => (typeof v === 'string' ? v : '').trim();
    let done = 0, total = 0;
    for (const m of miembros) {
      total += 3; // perfil, emociones, preocupaciones
      if (m.perfil) done++;
      if (m.emociones?.length) done++;
      if (m.preocupaciones?.length) done++;
      if (m.fue_emprendedor) {
        total += 1;
        if (m.quiebra) done++;
      }
    }
    for (const p of proyectos) {
      total += 7; // nombre, sector, ciiu, estado, canvas_cliente, canvas_problema, canvas_solucion
      if (s(p.nombre)) done++;
      if (s(p.sector)) done++;
      if (s(p.ciiu)) done++;
      if (p.estado) done++;
      if (s(p.canvas_cliente)) done++;
      if (s(p.canvas_problema)) done++;
      if (s(p.canvas_solucion)) done++;
      // hitos validos
      total += 5;
      const hitosValidos = (p.hitos ?? []).filter((h) => h.descripcion && h.fecha_inicio && h.fecha_fin).length;
      done += Math.min(hitosValidos, 5);
    }
    return total ? Math.round((done / total) * 100) : 0;
  }, [miembros, proyectos]);

  // ----- Envío -----
  function buildPayload() {
    return {
      numero_miembros: miembros.length,
      numero_proyectos: proyectos.length,
      // Flags de sabana de proyectos (nivel equipo)
      buscando_socios: buscandoSocios,
      buscando_asociacion_otro_proyecto: buscandoAsociacion,
      miembros: miembros.map((m) => ({
        // El perfil emprendedor (perfil/emociones/preocupaciones/
        // fue_emprendedor) ya vive en miembros_equipo: se llena en /mi-perfil
        // y se copia al equipo automaticamente. Aqui solo enviamos identidad y
        // posicion para que el backend respete lo que ya hay en BD.
        participante_id: m.participante_id,
        posicion: m.posicion,
      })),
      proyectos: proyectos.map((p) => ({
        posicion: p.posicion, nombre: p.nombre, tipo: p.tipo,
        sector: p.sector || undefined, ciiu: p.ciiu || undefined,
        canvas_cliente: p.canvas_cliente, canvas_problema: p.canvas_problema, canvas_solucion: p.canvas_solucion,
        canvas_canales: p.canvas_canales,
        canvas_relaciones: p.canvas_relaciones, canvas_ingresos: p.canvas_ingresos,
        canvas_recursos: p.canvas_recursos, canvas_actividades: p.canvas_actividades,
        canvas_socios: p.canvas_socios, canvas_costos: p.canvas_costos,
        estado: p.estado,
        fuentes_primarias: p.fuentes_primarias, fuentes_secundarias: p.fuentes_secundarias,
        hitos: p.hitos.filter((h) => h.descripcion && h.fecha_inicio && h.fecha_fin),
      })),
    };
  }
  // Mantenemos el ref apuntando al buildPayload mas reciente despues de cada
  // render. El periodic save (setInterval) lo usa para evitar cerrar sobre el
  // state inicial.
  buildPayloadRef.current = buildPayload;

  function cancelAutoSaveTimer() {
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
  }

  // Auto-guardado del borrador: 3 segundos despues del ultimo cambio en el
  // formulario. Asi, si la sesion se cae mientras el participante llena
  // (los tokens de Supabase expiran cada hora), no se pierde el progreso.
  // Skip si ya hay un guardado (manual o auto) en vuelo -- evita race
  // contra los delete/insert internos del PUT que dejaban el endpoint
  // colgado cuando dos requests caian al mismo tiempo.
  // Debounce CORTO (1s) para que la copia al backend se sienta inmediata.
  useEffect(() => {
    if (!anteId || estado !== 'borrador' || loading) return;
    setAutoSaveEstado('idle');
    cancelAutoSaveTimer();
    autoSaveTimerRef.current = setTimeout(async () => {
      if (savingRef.current) return;
      savingRef.current = true;
      setAutoSaveEstado('saving');
      try {
        await api.put(`/anteproyectos/${anteId}`, buildPayload(), { timeout: 60000 });
        setAutoSaveEstado('saved');
        // Si el backend confirmo, podemos borrar la copia local de respaldo.
        if (equipoId) {
          try { window.localStorage.removeItem(localKey(equipoId)); } catch { /* ignore */ }
        }
      } catch {
        setAutoSaveEstado('error');
      } finally {
        savingRef.current = false;
      }
    }, 1000);
    return cancelAutoSaveTimer;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proyectos, miembros, anteId, estado, loading, equipoId, buscandoSocios, buscandoAsociacion]);

  // === Copia LOCAL (localStorage) — sobrevive logout / refresh / token expirado ===
  // Se escribe de manera SINCRONA en cada cambio del formulario. Si el backend
  // falla o la sesion se cae, el usuario al volver a entrar restaura este
  // backup automaticamente (ver useEffect de carga inicial).
  useEffect(() => {
    if (!equipoId || estado !== 'borrador' || loading) return;
    // Debounce minimo (250ms) solo para no martillar localStorage en cada
    // pulsacion. localStorage es sincrono y rapido, pero JSON.stringify de
    // proyectos grandes vale evitar en cada keystroke.
    if (localBackupTimerRef.current) clearTimeout(localBackupTimerRef.current);
    localBackupTimerRef.current = setTimeout(() => {
      try {
        const snapshot = {
          savedAt: new Date().toISOString(),
          proyectos,
          buscandoSocios,
          buscandoAsociacion,
        };
        window.localStorage.setItem(localKey(equipoId), JSON.stringify(snapshot));
      } catch { /* localStorage lleno / privado: best effort */ }
    }, 250);
    return () => {
      if (localBackupTimerRef.current) clearTimeout(localBackupTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proyectos, buscandoSocios, buscandoAsociacion, equipoId, estado, loading]);

  // === Guardado periodico FORZADO al backend (cada 30s) ============
  // Cubre el caso del usuario que tipea continuamente sin parar 30s.
  // El debounce de arriba se resetea con cada tecla; este intervalo dispara
  // si o si. Las deps son minimas a proposito (el cronometro no se reinicia
  // con cada keystroke); el payload se lee de buildPayloadRef.current() para
  // tomar siempre el state mas reciente sin recapturar la closure.
  useEffect(() => {
    if (!anteId || estado !== 'borrador' || loading) return;
    if (periodicSaveTimerRef.current) clearInterval(periodicSaveTimerRef.current);
    periodicSaveTimerRef.current = setInterval(async () => {
      if (savingRef.current) return;
      savingRef.current = true;
      setAutoSaveEstado('saving');
      try {
        await api.put(`/anteproyectos/${anteId}`, buildPayloadRef.current(), { timeout: 60000 });
        setAutoSaveEstado('saved');
        if (equipoId) {
          try { window.localStorage.removeItem(localKey(equipoId)); } catch { /* ignore */ }
        }
      } catch {
        setAutoSaveEstado('error');
      } finally {
        savingRef.current = false;
      }
    }, 30000);
    return () => {
      if (periodicSaveTimerRef.current) clearInterval(periodicSaveTimerRef.current);
    };
  }, [anteId, estado, loading, equipoId]);

  async function enviar() {
    if (!anteId) return;
    // Flags de sábana: el equipo debe contestar SI/NO antes de enviar.
    if (buscandoSocios === null) {
      setMsg({ kind: 'err', text: 'Indica si tu equipo está buscando socios (SÍ o NO) en la sección "Información del equipo".' });
      return;
    }
    if (buscandoAsociacion === null) {
      setMsg({ kind: 'err', text: 'Indica si tu equipo busca asociación con otro proyecto (SÍ o NO) en la sección "Información del equipo".' });
      return;
    }
    // Validar que TODOS los campos del formulario esten llenos. Lista
    // (campo, etiqueta visible) por proyecto.
    const CAMPOS_OBLIGATORIOS: Array<[keyof Proyecto, string]> = [
      ['nombre', 'Nombre del proyecto'],
      ['sector', 'Sector'],
      ['ciiu', 'CIIU'],
      ['estado', 'Estado del proyecto'],
      ['canvas_cliente', 'Cliente'],
      ['canvas_problema', 'Problema'],
      ['canvas_solucion', 'Solución'],
      ['canvas_canales', 'Canales'],
      ['canvas_relaciones', 'Relación con clientes'],
      ['canvas_ingresos', 'Modelo de ingresos'],
      ['canvas_recursos', 'Recursos clave'],
      ['canvas_actividades', 'Actividades clave'],
      ['canvas_socios', 'Socios clave'],
      ['canvas_costos', 'Estructura de costos'],
      ['fuentes_primarias', 'Fuentes primarias'],
      ['fuentes_secundarias', 'Fuentes secundarias'],
    ];
    for (const p of proyectos) {
      const nombreProyecto = p.nombre || `#${p.posicion}`;
      for (const [campo, label] of CAMPOS_OBLIGATORIOS) {
        const v = (p as any)[campo];
        if (!v || (typeof v === 'string' && !v.trim())) {
          setMsg({
            kind: 'err',
            text: `El proyecto "${nombreProyecto}" tiene el campo "${label}" sin completar. Llena todos los campos del formulario antes de enviar.`,
          });
          return;
        }
      }
    }
    // Validar que TODAS las filas de hitos esten completas. Si hay una fila
    // visible con algun campo vacio, no se puede enviar (antes el frontend
    // las filtraba silenciosamente y dejaba pasar el envio).
    for (const p of proyectos) {
      for (const h of p.hitos ?? []) {
        const faltan: string[] = [];
        if (!h.descripcion) faltan.push('descripcion');
        if (!h.fecha_inicio) faltan.push('fecha de inicio');
        if (!h.fecha_fin) faltan.push('fecha de fin');
        if (faltan.length) {
          setMsg({
            kind: 'err',
            text: `El hito #${h.posicion} del proyecto "${p.nombre || `#${p.posicion}`}" está incompleto (falta: ${faltan.join(', ')}). Complétalo o elimina la fila antes de enviar.`,
          });
          return;
        }
      }
      const validos = (p.hitos ?? []).filter((h) => h.descripcion && h.fecha_inicio && h.fecha_fin).length;
      if (validos < MIN_HITOS) {
        setMsg({ kind: 'err', text: `El proyecto "${p.nombre || `#${p.posicion}`}" tiene ${validos} hito(s) completo(s). Necesitas al menos ${MIN_HITOS} hitos con descripción, fecha de inicio y fecha de fin.` });
        return;
      }
      // Validar cronología: cada hito debe iniciar >= que el inicio del anterior y terminar >= que el fin del anterior
      const ordered = (p.hitos ?? []).filter((h) => h.descripcion && h.fecha_inicio && h.fecha_fin);
      for (let i = 1; i < ordered.length; i++) {
        const prev = ordered[i - 1];
        const cur = ordered[i];
        if (cur.fecha_inicio < prev.fecha_inicio) {
          setMsg({ kind: 'err', text: `El hito "${cur.descripcion}" no puede iniciar antes que el hito "${prev.descripcion}". Revisa el orden cronológico.` });
          return;
        }
        if (cur.fecha_fin < prev.fecha_fin) {
          setMsg({ kind: 'err', text: `El hito "${cur.descripcion}" no puede terminar antes que el hito "${prev.descripcion}". Revisa el orden cronológico.` });
          return;
        }
      }
    }
    if (!confirm('Una vez enviado el anteproyecto NO podrá modificarse. ¿Continuar?')) return;

    // El boton de enviar nunca se bloquea por el autoguardado. Si hay un
    // PUT en vuelo, no importa: el backend serializa por anteproyecto y la
    // ultima escritura gana — el PUT del envio siempre se hace inmediatamente
    // antes del POST /enviar, garantizando que el state del cliente queda
    // persistido. Si un autoguardado tardio llega despues del envio, el PUT
    // del backend lo rechaza con 409 (estado ya = enviado).
    cancelAutoSaveTimer();
    setBusy(true); setMsg(null);
    try {
      await api.put(`/anteproyectos/${anteId}`, buildPayload(), { timeout: 60000 });
      const r = await api.post(`/anteproyectos/${anteId}/enviar`, {}, { timeout: 60000 });
      setEstado('enviado');
      setEnvioConfirmacion({
        fechaEnvio: r.data?.fecha_envio ?? new Date().toISOString(),
        autoDefinitivo: !!r.data?.auto_definitivo,
      });
    } catch (e: any) {
      setMsg({ kind: 'err', text: formatBackendError(e) });
    } finally {
      setBusy(false);
      savingRef.current = false;
    }
  }

  const readOnly = estado !== 'borrador';

  if (loading) {
    return <><Header /><main className="pt-36 text-center text-inalde-gray">Cargando anteproyecto…</main></>;
  }

  return (
    <>
      <Header />

      {/* Modal de confirmación de envío */}
      {envioConfirmacion && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
            <div className="border-b-[3px] border-inalde-blue px-6 py-5 text-center">
              <div className="text-4xl mb-2">✅</div>
              <p className="section-subtitle mb-1">Envío confirmado</p>
              <h2 className="font-primary font-bold text-2xl text-inalde-text">¡Anteproyecto enviado!</h2>
            </div>
            <div className="px-6 py-5">
              <p className="text-sm text-inalde-text mb-4">
                Tu anteproyecto quedó registrado correctamente. Esta es la constancia del envío:
              </p>
              <div className="rounded border-l-4 border-inalde-blue bg-blue-50 px-4 py-3 mb-4">
                <p className="text-xs uppercase tracking-wider text-inalde-gray font-semibold mb-1">Fecha y hora de envío</p>
                <p className="text-lg font-bold text-inalde-text">
                  {new Date(envioConfirmacion.fechaEnvio).toLocaleString('es-CO', {
                    timeZone: 'America/Bogota',
                    day: 'numeric', month: 'long', year: 'numeric',
                    hour: '2-digit', minute: '2-digit', hour12: false,
                  })}
                </p>
              </div>
              <p className="text-xs text-inalde-gray">
                Se envió un correo de confirmación a todos los miembros del equipo. El anteproyecto queda bloqueado para edición.
              </p>
              {envioConfirmacion.autoDefinitivo ? (
                <p className="text-sm text-inalde-text mt-3">
                  Como tu equipo presentó un único proyecto, quedó marcado como <strong>definitivo</strong> automáticamente.
                </p>
              ) : (
                <p className="text-sm text-inalde-text mt-3">
                  Después de la Reunión 1 con tu profesor, deberás elegir el proyecto definitivo.
                </p>
              )}
            </div>
            <div className="px-6 py-4 border-t border-inalde-gray-light flex justify-end">
              <button onClick={() => setEnvioConfirmacion(null)} className="btn-inalde-primary !py-2 !px-5 !text-sm">
                Entendido
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Progress bar fija arriba */}
      <div className="fixed top-[140px] inset-x-0 z-40 px-4">
        <div className="max-w-[1100px] mx-auto h-1.5 bg-inalde-gray-light/80 backdrop-blur rounded-full overflow-hidden shadow">
          <div
            className="h-full bg-gradient-to-r from-inalde-red via-inalde-red-hover to-inalde-gold transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      <main className="pt-40 pb-16 px-4">
        <div className="max-w-[1100px] mx-auto bg-white rounded-lg shadow-inalde-card p-5 sm:p-10">
          <div className="border-b-[3px] border-inalde-red pb-5 mb-6">
            <p className="section-subtitle mb-2">Anteproyecto NAVES</p>
            <h1 className="section-title">
              {numProyectos === 1 ? 'Tu idea de negocio en síntesis' : `Tus ${numProyectos} ideas de negocio en síntesis`}
            </h1>
            <p className="text-sm text-inalde-gray mt-2 flex items-center gap-3 flex-wrap">
              <span>Equipo: <strong className="text-inalde-text">{equipoNombre || '(sin nombre)'}</strong></span>
              <span>·</span>
              <span>Estado:{' '}
                <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold uppercase tracking-wider ${
                  estado === 'borrador' ? 'bg-inalde-gold/10 text-inalde-gold' : 'bg-inalde-blue/10 text-inalde-blue'
                }`}>{estado}</span>
              </span>
              <span>·</span>
              <span>Progreso: <strong className="text-inalde-red">{progress}%</strong></span>
            </p>
          </div>

          {readOnly && (
            <div className="rounded border-l-4 border-inalde-blue bg-blue-50 px-4 py-3 text-sm mb-6">
              Este anteproyecto ya fue enviado. Sólo puede modificarse desde el panel de administración.
            </div>
          )}

          {localRecovered && !readOnly && (
            <div className="rounded border-l-4 border-inalde-gold bg-amber-50 px-4 py-3 text-sm mb-6 flex items-start gap-3">
              <span className="text-lg leading-none">🔄</span>
              <div className="flex-1">
                <p className="font-semibold text-inalde-text">Recuperamos tu progreso del intento anterior</p>
                <p className="text-inalde-gray mt-1">
                  Detectamos cambios guardados localmente que aún no se habían enviado al servidor. Los cargamos automáticamente para que no pierdas tu trabajo. Continúa donde quedaste y el sistema seguirá guardando.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setLocalRecovered(false)}
                aria-label="Cerrar aviso de recuperación"
                className="text-inalde-gray hover:text-inalde-red font-bold text-lg leading-none px-2"
              >
                ×
              </button>
            </div>
          )}

          {/* Datos del equipo (programa MBA + rango de fechas) */}
          {cohorte && (
            <div className="mb-8 grid sm:grid-cols-2 gap-4 p-4 rounded-lg bg-inalde-gray-bg/60 border-l-4 border-inalde-gold">
              <div>
                <p className="text-xs uppercase tracking-wider font-semibold text-inalde-gray mb-0.5">Programa MBA</p>
                <p className="font-primary font-bold text-inalde-text">{cohorte.etiqueta}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wider font-semibold text-inalde-gray mb-0.5">Rango del programa</p>
                <p className="text-sm text-inalde-text">
                  <span className="text-inalde-red font-semibold">{fmtFecha(cohorte.fecha_inicio)}</span>
                  <span className="text-inalde-gray mx-2">→</span>
                  <span className="text-inalde-red font-semibold">{fmtFecha(cohorte.fecha_fin)}</span>
                </p>
              </div>
              {cohorte.fecha_limite_entrega_anteproyecto && (
                <div className="sm:col-span-2 text-xs text-inalde-gray">
                  ⏰ Fecha límite para enviar este anteproyecto:{' '}
                  <strong className="text-inalde-text">
                    {new Date(cohorte.fecha_limite_entrega_anteproyecto).toLocaleString('es-CO', {
                      dateStyle: 'long', timeStyle: 'short',
                    })}
                  </strong>
                </div>
              )}
            </div>
          )}

          {/* ============ Sección 1: Información del equipo ============ */}
          <SectionHeader n={1} title="Información del equipo" />

          {miembros.map((m) => (
            <div key={m.participante_id}
              className="border border-inalde-gray-light border-l-[3px] border-l-inalde-blue rounded p-5 mb-4">
              <p className="text-xs font-primary font-bold tracking-wider uppercase text-inalde-blue mb-2">
                Miembro {m.posicion}
              </p>
              <p className="font-primary font-bold text-lg text-inalde-text">{m.nombre}</p>
            </div>
          ))}

          {/* === Estado del equipo (sábana de proyectos) === */}
          <div className="border border-inalde-gray-light border-l-[3px] border-l-inalde-gold rounded p-5 mt-6">
            <p className="text-xs font-primary font-bold tracking-wider uppercase text-inalde-gold mb-3">
              Estado del equipo
            </p>
            <div className="space-y-4">
              <div>
                <p className="text-sm font-medium text-inalde-text mb-2">
                  ¿Su equipo está buscando socios?
                </p>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="radio"
                      name="buscando-socios"
                      checked={buscandoSocios === true}
                      onChange={() => setBuscandoSocios(true)}
                      disabled={readOnly}
                      className="accent-inalde-red"
                    />
                    Sí
                  </label>
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="radio"
                      name="buscando-socios"
                      checked={buscandoSocios === false}
                      onChange={() => setBuscandoSocios(false)}
                      disabled={readOnly}
                      className="accent-inalde-red"
                    />
                    No
                  </label>
                </div>
              </div>
              <div>
                <p className="text-sm font-medium text-inalde-text mb-2">
                  ¿Su equipo busca asociación con otro proyecto?
                </p>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="radio"
                      name="buscando-asociacion"
                      checked={buscandoAsociacion === true}
                      onChange={() => setBuscandoAsociacion(true)}
                      disabled={readOnly}
                      className="accent-inalde-red"
                    />
                    Sí
                  </label>
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="radio"
                      name="buscando-asociacion"
                      checked={buscandoAsociacion === false}
                      onChange={() => setBuscandoAsociacion(false)}
                      disabled={readOnly}
                      className="accent-inalde-red"
                    />
                    No
                  </label>
                </div>
              </div>
            </div>
          </div>

          {/* ============ Sección 2: Tus proyectos ============ */}
          <div className="mt-12">
            <SectionHeader n={2} title={numProyectos === 1 ? 'Tu Anteproyecto' : 'Tus Anteproyectos'} />

            <p className="text-sm text-inalde-gray mb-6">
              {numProyectos === 1
                ? 'Describe tu idea de emprendimiento. Será el proyecto definitivo automáticamente al enviar.'
                : `Describe tus ${numProyectos} alternativas. Después de la Reunión 1 con tu profesor, elegirán uno como definitivo y los demás quedarán archivados.`}
            </p>

            <div className="mb-6">
              <label className="block font-primary font-semibold text-sm text-inalde-red mb-2">
                ¿Cuántos proyectos vas a presentar?
              </label>
              <div className="flex gap-2">
                {[1, 2].map((n) => (
                  <button key={n} type="button" disabled={readOnly}
                    onClick={() => setNumProyectos(n)}
                    className={`px-6 py-2 rounded font-primary font-semibold transition ${
                      numProyectos === n
                        ? 'bg-inalde-red text-white'
                        : 'bg-inalde-gray-bg text-inalde-gray hover:text-inalde-text'
                    } disabled:opacity-50`}>
                    {n}
                  </button>
                ))}
              </div>
            </div>

            {/* Tabs */}
            {numProyectos > 1 && (
              <div className="flex gap-1 border-b border-inalde-gray-light mb-6">
                {proyectos.map((_, i) => (
                  <button key={i} type="button"
                    onClick={() => setActiveTab(i)}
                    className={`px-4 py-2 font-primary font-semibold text-sm border-b-2 transition ${
                      activeTab === i
                        ? 'border-inalde-red text-inalde-red'
                        : 'border-transparent text-inalde-gray hover:text-inalde-text'
                    }`}>
                    Proyecto {i + 1}
                    {proyectos[i].nombre && (
                      <span className="ml-2 text-xs font-normal text-inalde-gray">· {proyectos[i].nombre.slice(0, 20)}{proyectos[i].nombre.length > 20 ? '…' : ''}</span>
                    )}
                  </button>
                ))}
              </div>
            )}

            <fieldset disabled={readOnly} key={activeTab}>
              <ProyectoForm
                proyecto={proyectos[activeTab]}
                onChange={(patch) => updateProyecto(activeTab, patch)}
                onUpdateHito={(hi, patch) => updateHito(activeTab, hi, patch)}
                onAddHito={() => addHito(activeTab)}
                onRemoveHito={(hi) => removeHito(activeTab, hi)}
              />
            </fieldset>
          </div>

          {msg && (
            <div className={`mt-8 rounded border-l-4 px-4 py-3 text-sm whitespace-pre-line ${
              msg.kind === 'ok' ? 'border-inalde-blue bg-blue-50' : 'border-inalde-red bg-red-50'
            }`}>{msg.text}</div>
          )}

          {!readOnly && (
            <div className="mt-10 pt-6 border-t border-inalde-gray-light flex justify-between flex-wrap gap-3">
              <button onClick={() => navigate('/')} className="text-sm text-inalde-gray hover:text-inalde-text">
                ← Dashboard
              </button>
              <div className="flex items-center gap-3">
                <span className="text-xs text-inalde-gray italic mr-1">
                  {autoSaveEstado === 'saving' && 'Guardando…'}
                  {autoSaveEstado === 'saved' && '✓ Guardado automáticamente'}
                  {autoSaveEstado === 'error' && '⚠ Reintentando guardar…'}
                </span>
                <button onClick={enviar} disabled={busy} className="btn-inalde-primary">
                  {busy ? 'Procesando…' : 'Enviar anteproyecto →'}
                </button>
              </div>
            </div>
          )}
        </div>
      </main>
    </>
  );
}

// =============== Sub-componentes ===========================================

function SectionHeader({ n, title }: { n: number; title: string }) {
  return (
    <div className="flex items-center gap-3 mb-3">
      <span className="w-9 h-9 rounded-full bg-inalde-red text-white flex items-center justify-center font-primary font-bold">
        {n}
      </span>
      <h2 className="font-primary font-bold text-xl text-inalde-text">{title}</h2>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  const safeLabel = (label ?? '').trim();
  const esPregunta = /^¿/.test(safeLabel) || /\?$/.test(safeLabel);
  return (
    <div className="mt-4">
      <label className={`block font-primary font-semibold mb-1 ${
        esPregunta
          ? 'text-sm text-inalde-red'
          : 'text-xs tracking-wider uppercase text-inalde-gray'
      }`}>
        {label}
      </label>
      {hint && <p className="text-xs text-inalde-gray italic mb-2">{hint}</p>}
      {children}
    </div>
  );
}

function RadioGroup({ value, onChange, options }: {
  value: string; onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <div className="flex flex-wrap gap-5 mt-1">
      {options.map((o) => (
        <label key={o.value} className="flex items-center gap-2 cursor-pointer text-sm">
          <input type="radio" checked={value === o.value} onChange={() => onChange(o.value)}
            className="h-4 w-4 accent-inalde-red" />
          <span>{o.label}</span>
        </label>
      ))}
    </div>
  );
}

function TextareaWithCounter({ value, onChange, max, rows = 3, placeholder }: {
  value: string; onChange: (v: string) => void; max: number; rows?: number; placeholder?: string;
}) {
  const taRef = useRef<HTMLTextAreaElement>(null);

  function insertBullet() {
    const ta = taRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const before = value.slice(0, start);
    const after = value.slice(end);
    const prefix = before.length === 0 || before.endsWith('\n') ? '' : '\n';
    const inserted = `${prefix}• `;
    const next = (before + inserted + after).slice(0, max);
    onChange(next);
    requestAnimationFrame(() => {
      const pos = before.length + inserted.length;
      ta.focus();
      ta.setSelectionRange(pos, pos);
    });
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== 'Enter') return;
    const ta = e.currentTarget;
    const pos = ta.selectionStart;
    const before = value.slice(0, pos);
    const lineStart = before.lastIndexOf('\n') + 1;
    const currentLine = before.slice(lineStart);
    const bulletMatch = currentLine.match(/^(\s*)(•\s|-\s)/);
    if (!bulletMatch) return;
    if (currentLine.trim() === bulletMatch[2].trim()) {
      e.preventDefault();
      const after = value.slice(pos);
      const next = value.slice(0, lineStart) + after;
      onChange(next);
      requestAnimationFrame(() => {
        ta.focus();
        ta.setSelectionRange(lineStart, lineStart);
      });
      return;
    }
    e.preventDefault();
    const after = value.slice(pos);
    const indent = bulletMatch[1] ?? '';
    const insert = `\n${indent}• `;
    const next = (before + insert + after).slice(0, max);
    onChange(next);
    requestAnimationFrame(() => {
      const newPos = before.length + insert.length;
      ta.focus();
      ta.setSelectionRange(newPos, newPos);
    });
  }

  return (
    <div>
      <textarea ref={taRef} value={value} maxLength={max} rows={rows} placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onPaste={(e) => { e.preventDefault(); alert('Por integridad académica, no se permite pegar texto. Escribe tu propia respuesta.'); }}
        onDrop={(e) => e.preventDefault()}
        className="input-inalde resize-none" />
      <div className="flex justify-between items-center mt-1 gap-3">
        <button type="button" onClick={insertBullet}
          className="text-xs text-inalde-gray hover:text-inalde-red transition">
          • Agregar viñeta
        </button>
        <span className="text-xs font-mono text-inalde-gray">
          {value.length} / {max}
        </span>
      </div>
    </div>
  );
}

function ProyectoForm({ proyecto, onChange, onUpdateHito, onAddHito, onRemoveHito }: {
  proyecto: Proyecto;
  onChange: (patch: Partial<Proyecto>) => void;
  onUpdateHito: (hi: number, patch: Partial<Hito>) => void;
  onAddHito: () => void;
  onRemoveHito: (hi: number) => void;
}) {
  // Hitos con descripcion fuera de los presets arrancan en modo manual
  const [manualHitos, setManualHitos] = useState<Set<number>>(() => {
    const s = new Set<number>();
    proyecto.hitos.forEach((h, i) => {
      if (h.descripcion && !PRESET_HITO_NAMES.has(h.descripcion)) s.add(i);
    });
    return s;
  });
  function setManual(hi: number, on: boolean) {
    setManualHitos((prev) => {
      const next = new Set(prev);
      if (on) next.add(hi); else next.delete(hi);
      return next;
    });
  }
  return (
    <>
      {/* Identificación */}
      <div className="grid sm:grid-cols-2 gap-4 mb-4">
        <Field label="Nombre del proyecto">
          <input type="text" value={proyecto.nombre} maxLength={150}
            onChange={(e) => onChange({ nombre: e.target.value })}
            placeholder="Ej: T-Health, Oviland, Vitalia"
            className="input-inalde" {...noPasteProps} />
        </Field>
        <Field label="Tipo">
          <select value={proyecto.tipo} className="input-inalde"
            onChange={(e) => onChange({ tipo: e.target.value as any })}>
            <option value="emprendimiento">Emprendimiento</option>
            <option value="intraemprendimiento">Intraemprendimiento</option>
          </select>
        </Field>
        <Field label="Sector">
          <select value={proyecto.sector} onChange={(e) => onChange({ sector: e.target.value })} className="input-inalde">
            <option value="">Selecciona un sector…</option>
            {AREAS_AFINIDAD.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </Field>
        <div className="sm:col-span-2">
          <Field label="Código CIIU (DANE Rev. 4 A.C. 2020)" hint="Haz click en el campo para ver todos los códigos. También puedes escribir para filtrar (ej: software, restaurante).">
            <CiiuPicker value={proyecto.ciiu} onChange={(c) => onChange({ ciiu: c })} />
          </Field>
        </div>
      </div>

      {/* Canvas del negocio */}
      <h3 className="mt-8 mb-2 font-primary font-bold text-base text-inalde-text">Canvas del negocio</h3>
      <p className="text-xs text-inalde-gray mb-4">
        Las piezas del Business Model Canvas. Sé lo más claro posible.
      </p>
      {/* Cliente/problema en ancho completo (es el más extenso, 500 chars), el resto en 2 columnas */}
      <div className="space-y-4 mb-8">
        {/* Primero el cliente/problema, ancho completo */}
        {CANVAS_FIELDS.slice(0, 1).map(({ key, label, placeholder, max }) => (
          <Field key={String(key)} label={label}>
            <TextareaWithCounter value={String(proyecto[key] ?? '')} rows={3} max={max} placeholder={placeholder}
              onChange={(v) => onChange({ [key]: v } as any)} />
          </Field>
        ))}
        {/* Los otros 7, en grid 2 columnas en md+ */}
        <div className="grid md:grid-cols-2 gap-x-5 gap-y-4">
          {CANVAS_FIELDS.slice(1).map(({ key, label, placeholder, max }) => (
            <Field key={String(key)} label={label}>
              <TextareaWithCounter value={String(proyecto[key] ?? '')} rows={3} max={max} placeholder={placeholder}
                onChange={(v) => onChange({ [key]: v } as any)} />
            </Field>
          ))}
        </div>
      </div>

      {/* Estado del proyecto (madurez) */}
      <h3 className="mt-8 mb-2 font-primary font-bold text-base text-inalde-text">Estado del proyecto</h3>
      <p className="text-sm text-inalde-red mb-3 font-primary font-semibold">¿En qué etapa está hoy?</p>
      <RadioGroup value={proyecto.estado} onChange={(v) => onChange({ estado: v as EstadoProyecto })}
        options={ESTADOS_PROYECTO} />

      {/* Validación del mercado */}
      <h3 className="mt-8 mb-2 font-primary font-bold text-base text-inalde-text">Validación del mercado</h3>
      <p className="text-sm text-inalde-red mb-4 font-primary font-semibold">¿Cómo planeas averiguar que este proyecto resuelve un problema real?</p>
      <div className="grid md:grid-cols-2 gap-x-5 gap-y-4 mb-8">
        <Field label="Fuentes primarias (entrevistas, encuestas, observación)">
          <TextareaWithCounter value={proyecto.fuentes_primarias} rows={3} max={300}
            placeholder=""
            onChange={(v) => onChange({ fuentes_primarias: v })} />
        </Field>
        <Field label="Fuentes secundarias (estudios, reportes, datos públicos)">
          <TextareaWithCounter value={proyecto.fuentes_secundarias} rows={3} max={300}
            placeholder=""
            onChange={(v) => onChange({ fuentes_secundarias: v })} />
        </Field>
      </div>

      {/* Cronograma */}
      <h3 className="mt-8 mb-2 font-primary font-bold text-base text-inalde-text">Cronograma</h3>
      <p className="text-sm text-inalde-text mb-4">
        Define entre <strong>{MIN_HITOS} y 10 hitos</strong> del proyecto con sus fechas estimadas.
        Puedes elegirlos del cronograma NAVES o agregar tus propios hitos manualmente.
      </p>
      <div className="space-y-3">
        {proyecto.hitos.map((h, hi) => {
          const matchesPreset = PRESET_HITO_NAMES.has(h.descripcion);
          const isManual = manualHitos.has(hi) || (h.descripcion !== '' && !matchesPreset);
          const dropdownValue = isManual ? '__custom__' : (matchesPreset ? h.descripcion : '');
          const otherDescs = new Set(proyecto.hitos.filter((_, oi) => oi !== hi).map((o) => o.descripcion));
          return (
          <div key={hi} className="flex flex-wrap sm:flex-nowrap items-end gap-3 p-4 rounded bg-inalde-gray-bg/40 border-l-[3px] border-inalde-gold">
            <div className="w-12 shrink-0 text-center pt-7 text-inalde-gray font-bold">#{h.posicion}</div>

            <div className="flex-1 min-w-[200px]">
              <Field label="Hito">
                {isManual ? (
                  <div className="flex gap-2 items-stretch">
                    <input type="text" value={h.descripcion} maxLength={100}
                      placeholder="Describe tu hito (ej. Validación con 20 clientes)"
                      autoFocus={!h.descripcion}
                      onChange={(e) => onUpdateHito(hi, { descripcion: e.target.value })}
                      className="input-inalde flex-1" {...noPasteProps} />
                    <button type="button"
                      onClick={() => { setManual(hi, false); onUpdateHito(hi, { descripcion: '', fecha_fin: '' }); }}
                      title="Elegir del cronograma NAVES"
                      className="text-xs text-inalde-gray hover:text-inalde-red px-3 border border-inalde-gray-light rounded">↩</button>
                  </div>
                ) : (
                  <select value={dropdownValue}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === '__custom__') {
                        setManual(hi, true);
                        onUpdateHito(hi, { descripcion: '', fecha_fin: '' });
                      } else if (v === '') {
                        onUpdateHito(hi, { descripcion: '', fecha_fin: '' });
                      } else {
                        const preset = PRESET_HITOS.find((p) => p.descripcion === v);
                        // Solo prellenamos la descripcion del hito; las fechas
                        // las llena el participante manualmente -- ningun item
                        // debe aparecer con fecha predeterminada.
                        if (preset) onUpdateHito(hi, { descripcion: preset.descripcion });
                      }
                    }}
                    className="input-inalde">
                    <option value="">Selecciona un hito…</option>
                    {PRESET_HITOS.map((p) => (
                      <option key={p.descripcion} value={p.descripcion} disabled={p.descripcion !== h.descripcion && otherDescs.has(p.descripcion)}>
                        {p.descripcion}
                      </option>
                    ))}
                    <option value="__custom__">+ Otro (manual)…</option>
                  </select>
                )}
              </Field>
            </div>

            {(() => {
              const prev = hi > 0 ? proyecto.hitos[hi - 1] : null;
              const minInicio = prev ? (prev.fecha_inicio || prev.fecha_fin || undefined) : undefined;
              const prevFin = prev?.fecha_fin || undefined;
              const minFin = [h.fecha_inicio, prevFin].filter(Boolean).sort().at(-1) || undefined;
              return (
                <>
                  <div className="w-full sm:w-44 shrink-0">
                    <Field label="Inicio">
                      <input type="date" value={h.fecha_inicio} min={minInicio}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (minInicio && v && v < minInicio) {
                            alert(`El hito #${h.posicion} no puede iniciar antes del hito #${h.posicion - 1} (${minInicio}).`);
                            return;
                          }
                          onUpdateHito(hi, { fecha_inicio: v });
                        }}
                        className="input-inalde" />
                    </Field>
                  </div>
                  <div className="w-full sm:w-44 shrink-0">
                    <Field label="Fin">
                      <input type="date" value={h.fecha_fin} min={minFin}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (minFin && v && v < minFin) {
                            alert(`La fecha fin del hito #${h.posicion} no puede ser anterior al hito previo ni a su propio inicio.`);
                            return;
                          }
                          onUpdateHito(hi, { fecha_fin: v });
                        }}
                        className="input-inalde" />
                    </Field>
                  </div>
                </>
              );
            })()}

            <div className="w-10 shrink-0 pt-7 text-center">
              {proyecto.hitos.length > MIN_HITOS && (
                <button type="button" onClick={() => { onRemoveHito(hi); setManual(hi, false); }}
                  title="Eliminar hito"
                  className="text-inalde-gray hover:text-inalde-red text-2xl leading-none transition">×</button>
              )}
            </div>
          </div>
          );
        })}
        {proyecto.hitos.length < 10 && (
          <button type="button" onClick={onAddHito}
            className="text-sm text-inalde-red hover:text-inalde-red-hover font-semibold mt-2 inline-flex items-center gap-1 px-3 py-2 rounded border border-inalde-red/30 hover:border-inalde-red transition">
            + Agregar hito manualmente
          </button>
        )}
      </div>
    </>
  );
}
