import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Header } from '../../components/inalde/Header';
import { CiiuPicker } from '../../components/inalde/CiiuPicker';
import { api } from '../../lib/api';

type Emocion = 'crear' | 'dinero' | 'problema' | 'autonomia';
type Preocupacion = 'financiera' | 'estres' | 'habilidades' | 'familia';

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
  estado: 'idea' | 'investigacion' | 'prototipo' | 'validacion';
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
  quiebra: 'si' | 'no' | 'na';
  aprendizajes_quiebra: string;
  perfil: 'emprendedor' | 'directivo' | 'ambos';
  emociones: Emocion[];
  preocupaciones: Preocupacion[];
}

const EMOCIONES: { value: Emocion; label: string }[] = [
  { value: 'crear', label: 'Crear algo nuevo' },
  { value: 'dinero', label: 'Generar dinero / libertad financiera' },
  { value: 'problema', label: 'Resolver un problema social' },
  { value: 'autonomia', label: 'Autonomía / ser mi propio jefe' },
];
const PREOCUPACIONES: { value: Preocupacion; label: string }[] = [
  { value: 'financiera', label: 'Estabilidad financiera' },
  { value: 'estres', label: 'Estrés y carga de trabajo' },
  { value: 'habilidades', label: 'No tener las habilidades suficientes' },
  { value: 'familia', label: 'Tiempo con la familia' },
];

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
    hitos: [1, 2, 3, 4, 5].map((i) => emptyHito(i)),
  };
}

export default function Anteproyecto() {
  const navigate = useNavigate();
  const [anteId, setAnteId] = useState<string | null>(null);
  const [estado, setEstado] = useState<string>('borrador');
  const [miembros, setMiembros] = useState<MiembroForm[]>([]);
  const [proyectos, setProyectos] = useState<Proyecto[]>([emptyProyecto(1)]);
  const [activeTab, setActiveTab] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => { (async () => {
    setLoading(true);
    try {
      const eq = await api.get('/equipos/mi-equipo');
      if (!eq.data.equipo) {
        navigate('/equipo'); return;
      }
      const ms: MiembroForm[] = eq.data.equipo.miembros_equipo
        .sort((a: any, b: any) => a.posicion - b.posicion)
        .map((m: any) => ({
          participante_id: m.participantes_lista.id,
          posicion: m.posicion,
          nombre: m.participantes_lista.nombre_completo,
          celular: '',
          fue_emprendedor: m.fue_emprendedor ?? false,
          quiebra: (m.quiebra as any) ?? 'na',
          aprendizajes_quiebra: m.aprendizajes_quiebra ?? '',
          perfil: (m.perfil as any) ?? 'emprendedor',
          emociones: [],
          preocupaciones: [],
        }));
      setMiembros(ms);

      const ant = await api.get('/anteproyectos/mi-anteproyecto');
      if (ant.data.anteproyecto) {
        setAnteId(ant.data.anteproyecto.id);
        setEstado(ant.data.anteproyecto.estado);
        const ps: any[] = ant.data.anteproyecto.proyectos ?? [];
        if (ps.length) {
          setProyectos(ps.sort((a, b) => a.posicion - b.posicion).map((p) => ({
            ...emptyProyecto(p.posicion),
            ...p,
            hitos: (p.hitos ?? []).length ? p.hitos.sort((a: any, b: any) => a.posicion - b.posicion) : emptyProyecto(p.posicion).hitos,
          })));
        }
      }
    } catch (e: any) {
      setMsg({ kind: 'err', text: e?.response?.data?.error ?? e.message });
    } finally { setLoading(false); }
  })(); }, [navigate]);

  const numProyectos = proyectos.length;
  function setNumProyectos(n: number) {
    if (n === numProyectos) return;
    const next = [...proyectos];
    while (next.length < n) next.push(emptyProyecto(next.length + 1));
    while (next.length > n) next.pop();
    setProyectos(next);
    if (activeTab >= n) setActiveTab(n - 1);
  }

  function updateMiembro(i: number, patch: Partial<MiembroForm>) {
    setMiembros((m) => m.map((x, idx) => idx === i ? { ...x, ...patch } : x));
  }
  function updateProyecto(i: number, patch: Partial<Proyecto>) {
    setProyectos((p) => p.map((x, idx) => idx === i ? { ...x, ...patch } : x));
  }
  function updateHito(pi: number, hi: number, patch: Partial<Hito>) {
    setProyectos((p) => p.map((proj, idx) => {
      if (idx !== pi) return proj;
      return { ...proj, hitos: proj.hitos.map((h, j) => j === hi ? { ...h, ...patch } : h) };
    }));
  }
  function addHito(pi: number) {
    setProyectos((p) => p.map((proj, idx) => idx === pi
      ? { ...proj, hitos: [...proj.hitos, emptyHito(proj.hitos.length + 1)] }
      : proj));
  }
  function removeHito(pi: number, hi: number) {
    setProyectos((p) => p.map((proj, idx) => {
      if (idx !== pi) return proj;
      const next = proj.hitos.filter((_, j) => j !== hi).map((h, j) => ({ ...h, posicion: j + 1 }));
      return { ...proj, hitos: next };
    }));
  }

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
        aprendizajes_quiebra: m.fue_emprendedor ? m.aprendizajes_quiebra : undefined,
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
      setMsg({ kind: 'ok', text: r.data.auto_definitivo ? 'Anteproyecto enviado. Único proyecto marcado como definitivo.' : 'Anteproyecto enviado. Ahora espera la Reunión 1 con tu profesor para elegir el proyecto definitivo.' });
    } catch (e: any) {
      setMsg({ kind: 'err', text: JSON.stringify(e?.response?.data ?? e.message).slice(0, 300) });
    } finally { setBusy(false); }
  }

  const readOnly = estado !== 'borrador';

  if (loading) {
    return <><Header /><main className="pt-36 text-center text-inalde-gray">Cargando anteproyecto…</main></>;
  }

  return (
    <>
      <Header />
      <main className="pt-36 pb-16 px-4">
        <div className="max-w-[900px] mx-auto bg-white rounded-lg shadow-inalde-card p-10">
          <div className="border-b-[3px] border-inalde-red pb-5 mb-6">
            <p className="section-subtitle mb-2">Anteproyecto NAVES</p>
            <h1 className="section-title">
              Tu idea de negocio en síntesis
            </h1>
            <p className="text-sm text-inalde-gray mt-2">
              Estado:{' '}
              <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold uppercase tracking-wider ${
                estado === 'borrador' ? 'bg-inalde-gold/10 text-inalde-gold' : 'bg-inalde-red/10 text-inalde-red'
              }`}>{estado}</span>
            </p>
          </div>

          {readOnly && (
            <div className="rounded border-l-4 border-inalde-blue bg-blue-50 px-4 py-3 text-sm mb-6">
              Este anteproyecto ya fue enviado. Sólo puede modificarse desde el panel del super admin.
            </div>
          )}

          {/* Sección 1: Equipo */}
          <SectionHeader n={1} title="Equipo emprendedor" />
          {miembros.map((m, i) => (
            <fieldset key={m.participante_id} disabled={readOnly} className="border border-inalde-gray-light rounded p-5 mb-4">
              <legend className="px-2 text-sm font-primary font-semibold text-inalde-red">
                Miembro {m.posicion} · {m.nombre}
              </legend>
              <div className="grid sm:grid-cols-2 gap-4 mt-3">
                <Field label="Celular">
                  <input type="tel" value={m.celular} maxLength={20}
                    onChange={(e) => updateMiembro(i, { celular: e.target.value })}
                    placeholder="+57 300 000 0000" className="input-inalde" />
                </Field>
                <Field label="Perfil">
                  <select value={m.perfil} className="input-inalde"
                    onChange={(e) => updateMiembro(i, { perfil: e.target.value as any })}>
                    <option value="emprendedor">Emprendedor</option>
                    <option value="directivo">Directivo</option>
                    <option value="ambos">Ambos</option>
                  </select>
                </Field>
                <Field label="¿Has sido emprendedor antes?">
                  <select value={String(m.fue_emprendedor)} className="input-inalde"
                    onChange={(e) => updateMiembro(i, { fue_emprendedor: e.target.value === 'true' })}>
                    <option value="false">No</option>
                    <option value="true">Sí</option>
                  </select>
                </Field>
                {m.fue_emprendedor && (
                  <Field label="¿Tu emprendimiento quebró?">
                    <select value={m.quiebra} className="input-inalde"
                      onChange={(e) => updateMiembro(i, { quiebra: e.target.value as any })}>
                      <option value="no">No</option>
                      <option value="si">Sí</option>
                      <option value="na">N/A</option>
                    </select>
                  </Field>
                )}
              </div>
              {m.fue_emprendedor && m.quiebra === 'si' && (
                <Field label="¿Qué aprendiste?">
                  <textarea value={m.aprendizajes_quiebra} maxLength={300} rows={3}
                    onChange={(e) => updateMiembro(i, { aprendizajes_quiebra: e.target.value })}
                    className="input-inalde" />
                </Field>
              )}
              <Field label="¿Qué te emociona del emprendimiento? (selecciona uno o varios)">
                <Multiselect options={EMOCIONES} value={m.emociones} onChange={(v) => updateMiembro(i, { emociones: v })} />
              </Field>
              <Field label="¿Qué te preocupa?">
                <Multiselect options={PREOCUPACIONES} value={m.preocupaciones} onChange={(v) => updateMiembro(i, { preocupaciones: v })} />
              </Field>
            </fieldset>
          ))}

          {/* Sección 2: Proyectos */}
          <div className="mt-12">
            <SectionHeader n={2} title="Tus proyectos" />
            <div className="mb-6">
              <label className="block font-primary font-semibold text-xs tracking-wider uppercase text-inalde-gray mb-2">
                ¿Cuántos proyectos vas a presentar?
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
                <button onClick={guardar} disabled={busy} className="px-6 py-3 rounded border-2 border-inalde-gray text-inalde-text font-primary font-semibold hover:border-inalde-red hover:text-inalde-red transition">
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

function SectionHeader({ n, title }: { n: number; title: string }) {
  return (
    <div className="flex items-center gap-3 mb-6">
      <span className="w-9 h-9 rounded-full bg-inalde-red text-white flex items-center justify-center font-primary font-bold">
        {n}
      </span>
      <h2 className="font-primary font-bold text-xl text-inalde-text">{title}</h2>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block font-primary font-semibold text-xs tracking-wider uppercase text-inalde-gray mb-2">
        {label}
      </label>
      {children}
    </div>
  );
}

function Multiselect<T extends string>({ options, value, onChange }: {
  options: { value: T; label: string }[];
  value: T[];
  onChange: (v: T[]) => void;
}) {
  return (
    <div className="grid sm:grid-cols-2 gap-2">
      {options.map((o) => {
        const checked = value.includes(o.value);
        return (
          <button key={o.value} type="button"
            onClick={() => onChange(checked ? value.filter((v) => v !== o.value) : [...value, o.value])}
            className={`px-4 py-2 rounded border-2 text-sm text-left transition ${
              checked ? 'border-inalde-red bg-inalde-red/5 text-inalde-red font-semibold'
                      : 'border-inalde-gray-light text-inalde-text hover:border-inalde-gray'
            }`}>
            {o.label}
          </button>
        );
      })}
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
  const canvas: { key: keyof Proyecto; label: string }[] = useMemo(() => [
    { key: 'canvas_cliente_problema', label: 'Cliente y problema que resuelves' },
    { key: 'canvas_canales', label: 'Canales para llegar al cliente' },
    { key: 'canvas_relaciones', label: 'Relación con los clientes' },
    { key: 'canvas_ingresos', label: 'Modelo de ingresos' },
    { key: 'canvas_recursos', label: 'Recursos clave' },
    { key: 'canvas_actividades', label: 'Actividades clave' },
    { key: 'canvas_socios', label: 'Socios clave' },
    { key: 'canvas_costos', label: 'Estructura de costos' },
  ], []);

  return (
    <>
      <div className="grid sm:grid-cols-2 gap-4 mb-6">
        <Field label="Nombre del proyecto">
          <input type="text" value={proyecto.nombre} maxLength={150}
            onChange={(e) => onChange({ nombre: e.target.value })} className="input-inalde" />
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
            placeholder="Ej. Salud digital, EdTech, Logística" className="input-inalde" />
        </Field>
        <Field label="Estado del proyecto">
          <select value={proyecto.estado} className="input-inalde"
            onChange={(e) => onChange({ estado: e.target.value as any })}>
            <option value="idea">Idea</option>
            <option value="investigacion">Investigación</option>
            <option value="prototipo">Prototipo</option>
            <option value="validacion">Validación</option>
          </select>
        </Field>
        <div className="sm:col-span-2">
          <Field label="Código CIIU (DANE Rev. 4 A.C. 2020)">
            <CiiuPicker value={proyecto.ciiu} onChange={(c) => onChange({ ciiu: c })} />
          </Field>
        </div>
      </div>

      <h3 className="section-subtitle mb-3">Canvas del negocio</h3>
      <div className="space-y-4 mb-8">
        {canvas.map(({ key, label }) => (
          <Field key={key} label={label}>
            <textarea value={String(proyecto[key] ?? '')} rows={2}
              maxLength={key === 'canvas_cliente_problema' ? 500 : 300}
              onChange={(e) => onChange({ [key]: e.target.value } as any)}
              className="input-inalde" />
          </Field>
        ))}
      </div>

      <h3 className="section-subtitle mb-3">Validación del mercado</h3>
      <div className="space-y-4 mb-8">
        <Field label="Fuentes primarias (entrevistas, encuestas, observación)">
          <textarea value={proyecto.fuentes_primarias} rows={2} maxLength={300}
            onChange={(e) => onChange({ fuentes_primarias: e.target.value })}
            className="input-inalde" />
        </Field>
        <Field label="Fuentes secundarias (estudios, reportes, datos públicos)">
          <textarea value={proyecto.fuentes_secundarias} rows={2} maxLength={300}
            onChange={(e) => onChange({ fuentes_secundarias: e.target.value })}
            className="input-inalde" />
        </Field>
      </div>

      <h3 className="section-subtitle mb-3">Cronograma (5–10 hitos)</h3>
      <div className="space-y-3">
        {proyecto.hitos.map((h, hi) => (
          <div key={hi} className="grid grid-cols-12 gap-2 items-end">
            <div className="col-span-1 text-center pt-7 text-inalde-gray font-semibold">#{h.posicion}</div>
            <div className="col-span-5">
              <Field label="Hito">
                <input type="text" value={h.descripcion} maxLength={200}
                  onChange={(e) => onUpdateHito(hi, { descripcion: e.target.value })}
                  className="input-inalde" />
              </Field>
            </div>
            <div className="col-span-3">
              <Field label="Inicio">
                <input type="date" value={h.fecha_inicio}
                  onChange={(e) => onUpdateHito(hi, { fecha_inicio: e.target.value })}
                  className="input-inalde" />
              </Field>
            </div>
            <div className="col-span-2">
              <Field label="Fin">
                <input type="date" value={h.fecha_fin}
                  onChange={(e) => onUpdateHito(hi, { fecha_fin: e.target.value })}
                  className="input-inalde" />
              </Field>
            </div>
            <div className="col-span-1 pt-7">
              {proyecto.hitos.length > 5 && (
                <button type="button" onClick={() => onRemoveHito(hi)}
                  className="text-sm text-inalde-gray hover:text-inalde-red">×</button>
              )}
            </div>
          </div>
        ))}
        {proyecto.hitos.length < 10 && (
          <button type="button" onClick={onAddHito}
            className="text-sm text-inalde-red hover:text-inalde-red-hover font-semibold">
            + Agregar hito
          </button>
        )}
      </div>
    </>
  );
}
