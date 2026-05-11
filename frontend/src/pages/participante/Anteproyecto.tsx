import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Header } from '../../components/inalde/Header';
import { CiiuPicker } from '../../components/inalde/CiiuPicker';
import { api } from '../../lib/api';

// ============== Catálogos (alineados con DOCUMENTACION_BACKEND.md) ==========
type Emocion = 'crear' | 'dinero' | 'problema' | 'autonomia';
type Preocupacion = 'financiera' | 'estres' | 'habilidades' | 'familia';
type Perfil = 'emprendedor' | 'directivo' | 'ambos';
type EstadoProyecto = 'idea' | 'investigacion' | 'prototipo' | 'validacion';
type Quiebra = 'si' | 'no' | 'na';

const EMOCIONES: Array<{ value: Emocion; label: string }> = [
  { value: 'crear',      label: 'Crear algo nuevo desde cero' },
  { value: 'dinero',     label: 'El potencial económico' },
  { value: 'problema',   label: 'Resolver un problema que me apasiona' },
  { value: 'autonomia',  label: 'La autonomía e independencia' },
];

const PREOCUPACIONES: Array<{ value: Preocupacion; label: string }> = [
  { value: 'financiera',  label: 'La incertidumbre financiera' },
  { value: 'estres',      label: 'El estrés y sobrecarga de trabajo' },
  { value: 'habilidades', label: 'No sé si tengo las habilidades necesarias' },
  { value: 'familia',     label: 'El impacto en mi familia' },
];

const PERFILES: Array<{ value: Perfil; label: string }> = [
  { value: 'emprendedor', label: 'Emprendedor (crear desde cero)' },
  { value: 'directivo',   label: 'Directivo (liderar estructuras existentes)' },
  { value: 'ambos',       label: 'Ambos por igual' },
];

const ESTADOS_PROYECTO: Array<{ value: EstadoProyecto; label: string }> = [
  { value: 'idea',          label: 'Solo idea' },
  { value: 'investigacion', label: 'Investigación de mercado' },
  { value: 'prototipo',     label: 'Prototipo' },
  { value: 'validacion',    label: 'Validación con clientes' },
];

const CANVAS_FIELDS: Array<{ key: keyof Proyecto; label: string; placeholder: string; max: number }> = [
  { key: 'canvas_cliente_problema', label: 'Cliente, problema y solución', placeholder: 'Cliente: ¿Quién es? Problema: ¿Qué le duele? Solución: ¿Cómo lo resuelves?', max: 500 },
  { key: 'canvas_canales',          label: 'Canales',                      placeholder: '¿App, web, presencial, redes sociales, partnerships?', max: 300 },
  { key: 'canvas_relaciones',       label: 'Relación con clientes',        placeholder: 'Soporte, comunidad, capacitación, ¿qué tipo de relación buscas?', max: 300 },
  { key: 'canvas_ingresos',         label: 'Modelo de ingresos',           placeholder: '¿Por producto, servicio, suscripción, comisiones, licencias?', max: 300 },
  { key: 'canvas_recursos',         label: 'Recursos clave',               placeholder: 'Tecnología, talento, dinero, partnerships, ¿qué es crítico?', max: 300 },
  { key: 'canvas_actividades',      label: 'Actividades clave',            placeholder: '¿Cuáles son las acciones principales para hacer funcionar tu negocio?', max: 300 },
  { key: 'canvas_socios',           label: 'Socios clave',                 placeholder: '¿Proveedores, distribuidores, complementadores, consultores?', max: 300 },
  { key: 'canvas_costos',           label: 'Estructura de costos',         placeholder: 'Desarrollo, marketing, operaciones, salarios, ¿cuáles son los gastos?', max: 300 },
];

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
  canvas_cliente_problema: string;
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
  celular: string;
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
    canvas_cliente_problema: '', canvas_canales: '', canvas_relaciones: '',
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
  const [cohorte, setCohorte] = useState<Cohorte | null>(null);
  const [miembros, setMiembros] = useState<MiembroForm[]>([]);
  const [proyectos, setProyectos] = useState<Proyecto[]>([emptyProyecto(1)]);
  const [activeTab, setActiveTab] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  // ----- Carga inicial -----
  useEffect(() => { (async () => {
    setLoading(true);
    try {
      const eq = await api.get('/equipos/mi-equipo');
      if (!eq.data.equipo) { navigate('/equipo'); return; }
      setEquipoNombre(eq.data.equipo.nombre_equipo ?? '');

      const ms: MiembroForm[] = eq.data.equipo.miembros_equipo
        .sort((a: any, b: any) => a.posicion - b.posicion)
        .map((m: any) => ({
          participante_id: m.participantes_lista.id,
          posicion: m.posicion,
          nombre: m.participantes_lista.nombre_completo,
          celular: '',
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

      if (ant.data.anteproyecto) {
        setAnteId(ant.data.anteproyecto.id);
        setEstado(ant.data.anteproyecto.estado);
        const ps: any[] = ant.data.anteproyecto.proyectos ?? [];
        if (ps.length) {
          setProyectos(ps.sort((a, b) => a.posicion - b.posicion).map((p) => ({
            ...emptyProyecto(p.posicion),
            ...p,
            hitos: (p.hitos ?? []).length
              ? p.hitos.sort((a: any, b: any) => a.posicion - b.posicion)
              : emptyProyecto(p.posicion).hitos,
          })));
        }
      }
    } catch (e: any) {
      setMsg({ kind: 'err', text: e?.response?.data?.error ?? e.message });
    } finally { setLoading(false); }
  })(); }, [navigate]);

  // ----- Mutadores -----
  function updateMiembro(i: number, patch: Partial<MiembroForm>) {
    setMiembros((m) => m.map((x, idx) => idx === i ? { ...x, ...patch } : x));
  }

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
      const tieneDescripcion = (patch.descripcion ?? proj.hitos[hi].descripcion).trim().length > 0;
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
    let done = 0, total = 0;
    for (const m of miembros) {
      total += 4; // celular, perfil, emociones, preocupaciones
      if (m.celular.trim()) done++;
      if (m.perfil) done++;
      if (m.emociones.length) done++;
      if (m.preocupaciones.length) done++;
      if (m.fue_emprendedor) {
        total += 1;
        if (m.quiebra) done++;
      }
    }
    for (const p of proyectos) {
      total += 5; // nombre, sector, ciiu, estado, canvas_cliente_problema
      if (p.nombre.trim()) done++;
      if (p.sector.trim()) done++;
      if (p.ciiu.trim()) done++;
      if (p.estado) done++;
      if (p.canvas_cliente_problema.trim()) done++;
      // hitos validos
      total += 5;
      const hitosValidos = p.hitos.filter((h) => h.descripcion && h.fecha_inicio && h.fecha_fin).length;
      done += Math.min(hitosValidos, 5);
    }
    return total ? Math.round((done / total) * 100) : 0;
  }, [miembros, proyectos]);

  // ----- Envío -----
  function buildPayload() {
    return {
      numero_miembros: miembros.length,
      numero_proyectos: proyectos.length,
      miembros: miembros.map((m) => ({
        participante_id: m.participante_id,
        posicion: m.posicion,
        celular: m.celular || undefined,
        fue_emprendedor: m.fue_emprendedor,
        quiebra: m.fue_emprendedor ? m.quiebra : undefined,
        aprendizajes_quiebra: m.fue_emprendedor && m.quiebra === 'si' ? m.aprendizajes_quiebra : undefined,
        perfil: m.perfil,
        emociones: m.emociones,
        preocupaciones: m.preocupaciones,
      })),
      proyectos: proyectos.map((p) => ({
        posicion: p.posicion, nombre: p.nombre, tipo: p.tipo,
        sector: p.sector || undefined, ciiu: p.ciiu || undefined,
        canvas_cliente_problema: p.canvas_cliente_problema, canvas_canales: p.canvas_canales,
        canvas_relaciones: p.canvas_relaciones, canvas_ingresos: p.canvas_ingresos,
        canvas_recursos: p.canvas_recursos, canvas_actividades: p.canvas_actividades,
        canvas_socios: p.canvas_socios, canvas_costos: p.canvas_costos,
        estado: p.estado,
        fuentes_primarias: p.fuentes_primarias, fuentes_secundarias: p.fuentes_secundarias,
        hitos: p.hitos.filter((h) => h.descripcion && h.fecha_inicio && h.fecha_fin),
      })),
    };
  }

  async function guardar() {
    if (!anteId) return;
    setBusy(true); setMsg(null);
    try {
      await api.put(`/anteproyectos/${anteId}`, buildPayload());
      setMsg({ kind: 'ok', text: 'Borrador guardado.' });
    } catch (e: any) {
      setMsg({ kind: 'err', text: JSON.stringify(e?.response?.data ?? e.message).slice(0, 300) });
    } finally { setBusy(false); }
  }

  async function enviar() {
    if (!anteId) return;
    if (!confirm('Una vez enviado el anteproyecto NO podrá modificarse. ¿Continuar?')) return;
    setBusy(true); setMsg(null);
    try {
      await api.put(`/anteproyectos/${anteId}`, buildPayload());
      const r = await api.post(`/anteproyectos/${anteId}/enviar`);
      setEstado('enviado');
      setMsg({ kind: 'ok', text: r.data.auto_definitivo
          ? 'Anteproyecto enviado. Tu único proyecto quedó marcado como definitivo.'
          : 'Anteproyecto enviado. Después de la Reunión 1 con tu profesor, deberás elegir el proyecto definitivo.' });
    } catch (e: any) {
      setMsg({ kind: 'err', text: JSON.stringify(e?.response?.data ?? e.message).slice(0, 300) });
    } finally { setBusy(false); }
  }

  const readOnly = estado !== 'borrador';
  const numMiembros = miembros.length;
  const labelProyecto = numProyectos > 1 ? 'proyectos' : 'proyecto';

  if (loading) {
    return <><Header /><main className="pt-36 text-center text-inalde-gray">Cargando anteproyecto…</main></>;
  }

  return (
    <>
      <Header />

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
        <div className="max-w-[1100px] mx-auto bg-white rounded-lg shadow-inalde-card p-10">
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

          {/* Datos del equipo (programa MBA + rango de fechas) */}
          {cohorte && (
            <div className="mb-8 grid sm:grid-cols-2 gap-4 p-4 rounded-lg bg-inalde-gray-bg/60 border-l-4 border-inalde-gold">
              <div>
                <p className="text-[10px] uppercase tracking-wider font-semibold text-inalde-gray mb-0.5">Programa MBA</p>
                <p className="font-primary font-bold text-inalde-text">{cohorte.etiqueta}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider font-semibold text-inalde-gray mb-0.5">Rango del programa</p>
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

          {/* ============ Sección 1: Equipo emprendedor ============ */}
          <SectionHeader n={1} title={`Información del ${numMiembros === 1 ? 'emprendedor' : 'equipo emprendedor'}`} />
          <p className="text-sm text-inalde-gray mb-6">
            {numMiembros === 1
              ? 'Cuéntanos sobre ti y tu perfil emprendedor. Esto nos ayuda a entender tu motivación.'
              : `Cuéntanos sobre cada uno de los ${numMiembros} miembros del equipo. Esto nos ayuda a entender la motivación colectiva.`}
          </p>

          {miembros.map((m, i) => (
            <fieldset key={m.participante_id} disabled={readOnly}
              className="border border-inalde-gray-light border-l-[3px] border-l-inalde-blue rounded p-5 mb-4">
              <legend className="px-2 text-xs font-primary font-bold tracking-wider uppercase text-inalde-blue">
                Miembro {m.posicion}
              </legend>

              {/* Datos personales (read-only, vienen de participantes_lista) */}
              <div className="mb-5 pb-5 border-b border-inalde-gray-light">
                <p className="text-[10px] uppercase tracking-wider font-semibold text-inalde-gray mb-1">Datos personales</p>
                <p className="font-primary font-bold text-lg text-inalde-text">{m.nombre}</p>
                <p className="text-xs text-inalde-gray mt-1 italic">
                  Cargado por el administrador desde la lista de la cohorte. Si hay un error, contacta al programa.
                </p>
              </div>

              {/* Contacto */}
              <div className="grid sm:grid-cols-2 gap-4">
                <Field label="Celular">
                  <input type="tel" value={m.celular} maxLength={20}
                    onChange={(e) => updateMiembro(i, { celular: e.target.value })}
                    placeholder="Ej: +573001234567" className="input-inalde" />
                </Field>
                <Field label="Rol con el que más te identificas">
                  <select value={m.perfil} className="input-inalde"
                    onChange={(e) => updateMiembro(i, { perfil: e.target.value as Perfil })}>
                    {PERFILES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                  </select>
                </Field>
              </div>

              {/* Perfil emprendedor */}
              <h4 className="mt-6 mb-3 font-primary font-bold text-sm tracking-wider uppercase text-inalde-text">
                Perfil emprendedor
              </h4>
              <Field label="¿Has sido emprendedor antes?">
                <RadioGroup value={String(m.fue_emprendedor)} onChange={(v) => updateMiembro(i, { fue_emprendedor: v === 'true' })}
                  options={[{ value: 'no', label: 'No' }, { value: 'true', label: 'Sí' }]} />
              </Field>

              {m.fue_emprendedor && (
                <div className="mt-4 p-4 rounded bg-inalde-gray-bg/60 border-l-4 border-inalde-gold">
                  <p className="text-xs uppercase tracking-wider font-bold text-inalde-red mb-3">Sobre tu emprendimiento anterior</p>
                  <Field label="¿Tu emprendimiento quebró?">
                    <RadioGroup value={m.quiebra} onChange={(v) => updateMiembro(i, { quiebra: v as Quiebra })}
                      options={[
                        { value: 'si', label: 'Sí' },
                        { value: 'no', label: 'No' },
                        { value: 'na', label: 'No aplica' },
                      ]} />
                  </Field>
                  {m.quiebra === 'si' && (
                    <div className="mt-3">
                      <Field label="¿Qué aprendiste?">
                        <TextareaWithCounter value={m.aprendizajes_quiebra} max={300} rows={3}
                          onChange={(v) => updateMiembro(i, { aprendizajes_quiebra: v })} />
                      </Field>
                    </div>
                  )}
                </div>
              )}

              <Field label="¿Qué te emociona del emprendimiento?" hint="Selecciona uno o varios">
                <CheckboxGroup options={EMOCIONES} value={m.emociones}
                  onChange={(v) => updateMiembro(i, { emociones: v })} />
              </Field>

              <Field label="¿Qué te preocupa?" hint="Selecciona uno o varios">
                <CheckboxGroup options={PREOCUPACIONES} value={m.preocupaciones}
                  onChange={(v) => updateMiembro(i, { preocupaciones: v })} />
              </Field>
            </fieldset>
          ))}

          {/* ============ Sección 2: Tus proyectos ============ */}
          <div className="mt-12">
            <SectionHeader n={2} title={numProyectos === 1 ? 'Tu proyecto' : 'Tus proyectos'} />

            <p className="text-sm text-inalde-gray mb-6">
              {numProyectos === 1
                ? 'Describe tu idea de emprendimiento. Será el proyecto definitivo automáticamente al enviar.'
                : `Describe tus ${numProyectos} alternativas. Después de la Reunión 1 con tu profesor, elegirán uno como definitivo y los demás quedarán archivados.`}
            </p>

            <div className="mb-6">
              <label className="block font-primary font-semibold text-xs tracking-wider uppercase text-inalde-red mb-2">
                ¿Cuántos {labelProyecto} vas a presentar?
              </label>
              <div className="flex gap-2">
                {[1, 2, 3].map((n) => (
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
            <div className={`mt-8 rounded border-l-4 px-4 py-3 text-sm ${
              msg.kind === 'ok' ? 'border-inalde-blue bg-blue-50' : 'border-inalde-red bg-red-50'
            }`}>{msg.text}</div>
          )}

          {!readOnly && (
            <div className="mt-10 pt-6 border-t border-inalde-gray-light flex justify-between flex-wrap gap-3">
              <button onClick={() => navigate('/')} className="text-sm text-inalde-gray hover:text-inalde-text">
                ← Dashboard
              </button>
              <div className="flex gap-3">
                <button onClick={guardar} disabled={busy}
                  className="px-6 py-3 rounded border-2 border-inalde-gray text-inalde-text font-primary font-semibold hover:border-inalde-red hover:text-inalde-red transition">
                  Guardar borrador
                </button>
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
  const esPregunta = /^¿/.test(label.trim()) || /\?$/.test(label.trim());
  return (
    <div className="mt-4">
      <label className={`block font-primary font-semibold text-xs tracking-wider uppercase mb-1 ${esPregunta ? 'text-inalde-red' : 'text-inalde-gray'}`}>
        {label}
      </label>
      {hint && <p className="text-[11px] text-inalde-gray italic mb-2">{hint}</p>}
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

function CheckboxGroup<T extends string>({ options, value, onChange }: {
  options: Array<{ value: T; label: string }>;
  value: T[];
  onChange: (v: T[]) => void;
}) {
  return (
    <div className="grid sm:grid-cols-2 gap-x-6 gap-y-2 mt-1">
      {options.map((o) => {
        const checked = value.includes(o.value);
        return (
          <label key={o.value} className="flex items-start gap-2 cursor-pointer text-sm py-1">
            <input type="checkbox" checked={checked}
              onChange={() => onChange(checked ? value.filter((v) => v !== o.value) : [...value, o.value])}
              className="mt-1 h-4 w-4 accent-inalde-red" />
            <span>{o.label}</span>
          </label>
        );
      })}
    </div>
  );
}

function TextareaWithCounter({ value, onChange, max, rows = 3, placeholder }: {
  value: string; onChange: (v: string) => void; max: number; rows?: number; placeholder?: string;
}) {
  return (
    <div className="relative">
      <textarea value={value} maxLength={max} rows={rows} placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="input-inalde resize-none" />
      <span className="absolute bottom-2 right-3 text-[10px] font-mono text-inalde-gray">
        {value.length} / {max}
      </span>
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
  return (
    <>
      {/* Identificación */}
      <div className="grid sm:grid-cols-2 gap-4 mb-4">
        <Field label="Nombre del proyecto">
          <input type="text" value={proyecto.nombre} maxLength={150}
            onChange={(e) => onChange({ nombre: e.target.value })}
            placeholder="Ej: T-Health, Oviland, Vitalia"
            className="input-inalde" />
        </Field>
        <Field label="Tipo">
          <select value={proyecto.tipo} className="input-inalde"
            onChange={(e) => onChange({ tipo: e.target.value as any })}>
            <option value="emprendimiento">Emprendimiento</option>
            <option value="intraemprendimiento">Intraemprendimiento</option>
          </select>
        </Field>
        <Field label="Sector">
          <input type="text" value={proyecto.sector} maxLength={100}
            onChange={(e) => onChange({ sector: e.target.value })}
            placeholder="Ej: Software, Salud, Logística"
            className="input-inalde" />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Código CIIU (DANE Rev. 4 A.C. 2020)" hint="Busca por código (ej: 6201) o por descripción (ej: software, restaurante)">
            <CiiuPicker value={proyecto.ciiu} onChange={(c) => onChange({ ciiu: c })} />
          </Field>
        </div>
      </div>

      {/* Canvas del negocio */}
      <h3 className="mt-8 mb-2 font-primary font-bold text-base text-inalde-text">Canvas del negocio</h3>
      <p className="text-xs text-inalde-gray mb-4">
        Las 8 piezas del Business Model Canvas. Sé concreto pero claro.
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
      <p className="text-xs text-inalde-red mb-3 font-semibold">¿En qué etapa está hoy?</p>
      <RadioGroup value={proyecto.estado} onChange={(v) => onChange({ estado: v as EstadoProyecto })}
        options={ESTADOS_PROYECTO} />

      {/* Validación del mercado */}
      <h3 className="mt-8 mb-2 font-primary font-bold text-base text-inalde-text">Validación del mercado</h3>
      <p className="text-xs text-inalde-red mb-4 font-semibold">¿Cómo sabes que este proyecto resuelve un problema real?</p>
      <div className="grid md:grid-cols-2 gap-x-5 gap-y-4 mb-8">
        <Field label="Fuentes primarias (entrevistas, encuestas, observación)">
          <TextareaWithCounter value={proyecto.fuentes_primarias} rows={3} max={300}
            placeholder="¿Con cuántas personas hablaste? ¿Qué descubriste?"
            onChange={(v) => onChange({ fuentes_primarias: v })} />
        </Field>
        <Field label="Fuentes secundarias (estudios, reportes, datos públicos)">
          <TextareaWithCounter value={proyecto.fuentes_secundarias} rows={3} max={300}
            placeholder="¿Qué reportes, datos del DANE, estudios sectoriales consultaste?"
            onChange={(v) => onChange({ fuentes_secundarias: v })} />
        </Field>
      </div>

      {/* Cronograma */}
      <h3 className="mt-8 mb-2 font-primary font-bold text-base text-inalde-text">Cronograma</h3>
      <p className="text-xs text-inalde-gray mb-4">
        Define entre <strong>5 y 10 hitos</strong> del proyecto con sus fechas estimadas.
        Los siguientes irán apareciendo a medida que llenes el actual.
      </p>
      <div className="space-y-3">
        {proyecto.hitos.map((h, hi) => (
          <div key={hi} className="flex items-end gap-3 p-4 rounded bg-inalde-gray-bg/40 border-l-[3px] border-inalde-gold">
            <div className="w-12 shrink-0 text-center pt-7 text-inalde-gray font-bold">#{h.posicion}</div>

            <div className="flex-1 min-w-0">
              <Field label="Hito">
                <input type="text" value={h.descripcion} maxLength={100}
                  placeholder="Ej: Validación de mercado, Prototipo MVP, Lanzamiento beta"
                  onChange={(e) => onUpdateHito(hi, { descripcion: e.target.value })}
                  className="input-inalde" />
              </Field>
            </div>

            <div className="w-44 shrink-0">
              <Field label="Inicio">
                <input type="date" value={h.fecha_inicio}
                  onChange={(e) => onUpdateHito(hi, { fecha_inicio: e.target.value })}
                  className="input-inalde" />
              </Field>
            </div>

            <div className="w-44 shrink-0">
              <Field label="Fin">
                <input type="date" value={h.fecha_fin} min={h.fecha_inicio || undefined}
                  onChange={(e) => onUpdateHito(hi, { fecha_fin: e.target.value })}
                  className="input-inalde" />
              </Field>
            </div>

            <div className="w-10 shrink-0 pt-7 text-center">
              {proyecto.hitos.length > 5 && (
                <button type="button" onClick={() => onRemoveHito(hi)}
                  title="Eliminar hito"
                  className="text-inalde-gray hover:text-inalde-red text-2xl leading-none transition">×</button>
              )}
            </div>
          </div>
        ))}
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
