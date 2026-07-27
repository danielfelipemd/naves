import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { formatBackendError } from '../../lib/errors';

// Dashboard de control de cohorte (Comentario 15 QA, JMV 20-jul-2026).
// Solo lectura salvo el checkbox del informe. Sin librerías de charts: las
// barras se dibujan con divs/CSS. AdminLayout ya pone el <Header/> global, así
// que esta pantalla NO renderiza su propio Header (mismo patrón que Resumen /
// ProyectosDB).

interface Cohorte {
  id: string;
  etiqueta: string;
  activa: boolean;
}

interface NTotal {
  n: number;
  total: number;
}

interface Dashboard {
  cohorte: { id: string; etiqueta: string };
  bloque1: {
    participantes_activos: number;
    /** Solo equipos de Business Plan NAVES. */
    proyectos: number;
    /** Equipos de las tres modalidades (contexto del indicador anterior). */
    equipos_totales?: number;
    anteproyectos_entregados: NTotal & { por_modalidad?: Record<string, NTotal> };
    trabajos_definitivos_entregados: NTotal;
  };
  bloque2: Array<{ label: string; n: number; total: number }>;
  bloque3: {
    actas: { disponible: boolean; realizadas: number; enviadas: number; firmadas: number };
    informe_cohorte: { realizado: boolean };
  };
  bloque4: {
    trabajos_por_modalidad: Record<string, number>;
    participantes_por_modalidad: Record<string, number>;
    perfil_emprendedor: Record<string, number>;
    experiencia_previa?: Record<string, number>;
    desenlace_experiencia_previa?: Record<string, number>;
    emociones?: Record<string, number>;
    preocupaciones?: Record<string, number>;
  };
}

// Paleta validada por daltonismo (Comentario 15).
const MODALIDAD_COLOR: Record<string, string> = {
  business_plan: '#d0021b',
  caso: '#2e6db4',
  proyecto_investigacion: '#b07d2b',
};
const MODALIDAD_LABEL: Record<string, string> = {
  business_plan: 'Business Plan',
  caso: 'Caso',
  proyecto_investigacion: 'Proyecto de Investigación',
};
const MODALIDAD_ORDEN = ['business_plan', 'caso', 'proyecto_investigacion'];

const PERFIL_LABEL: Record<string, string> = {
  emprendedor: 'Emprendedor',
  directivo: 'Directivo',
  ambos: 'Ambos por igual',
  sin_responder: 'Sin responder',
};
const PERFIL_ORDEN = ['emprendedor', 'directivo', 'ambos', 'sin_responder'];

// Resto de variables del perfil emprendedor (mismas opciones del formulario).
const EXPERIENCIA_LABEL: Record<string, string> = {
  si: 'Sí, ya emprendió',
  no: 'No había emprendido',
  sin_responder: 'Sin responder',
};
const EXPERIENCIA_ORDEN = ['si', 'no', 'sin_responder'];

const DESENLACE_LABEL: Record<string, string> = {
  funcionamiento: 'Sigue en funcionamiento',
  vendido: 'Lo vendió',
  quebro: 'Quebró',
  nunca_despego: 'Nunca despegó',
  na: 'No aplica',
};
const DESENLACE_ORDEN = ['funcionamiento', 'vendido', 'quebro', 'nunca_despego', 'na'];

const EMOCIONES_LABEL: Record<string, string> = {
  crear: 'Crear algo propio',
  dinero: 'Ganar dinero',
  problema: 'Resolver un problema',
  autonomia: 'Tener autonomía',
  ninguna: 'Ninguna',
};
const EMOCIONES_ORDEN = ['crear', 'problema', 'autonomia', 'dinero', 'ninguna'];

const PREOCUPACIONES_LABEL: Record<string, string> = {
  financiera: 'Estabilidad financiera',
  estres: 'Estrés e incertidumbre',
  habilidades: 'Falta de habilidades',
  familia: 'Tiempo con la familia',
  ninguna: 'Ninguna',
};
const PREOCUPACIONES_ORDEN = ['financiera', 'estres', 'habilidades', 'familia', 'ninguna'];

function pct(n: number, total: number): number {
  if (!total) return 0;
  return Math.round((n / total) * 100);
}

// --- Tarjeta KPI (número grande) -------------------------------------------
// `desglose` agrega el detalle por modalidad dentro de la misma tarjeta: un
// solo número agregado de las tres modalidades no es interpretable.
function KpiCard({ label, value, sub, desglose }: {
  label: string;
  value: string | number;
  sub?: string;
  desglose?: Record<string, NTotal>;
}) {
  return (
    <div className="card-inalde flex flex-col justify-between p-5">
      <p className="font-primary font-semibold text-xs tracking-wider uppercase text-inalde-gray">{label}</p>
      <p className="font-primary font-bold text-4xl text-inalde-text mt-2 leading-none">{value}</p>
      {sub && <p className="text-xs text-inalde-gray mt-1">{sub}</p>}
      {desglose && (
        <ul className="mt-3 pt-3 border-t border-inalde-gray-light space-y-1">
          {MODALIDAD_ORDEN.filter((m) => desglose[m]).map((m) => (
            <li key={m} className="flex items-center justify-between gap-2 text-xs">
              <span className="flex items-center gap-1.5 text-inalde-gray truncate">
                <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: MODALIDAD_COLOR[m] }} />
                {MODALIDAD_LABEL[m]}
              </span>
              <span className="font-semibold text-inalde-text whitespace-nowrap">
                {desglose[m].n} <span className="text-inalde-gray font-normal">/ {desglose[m].total}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// --- Barra de avance del proceso (n/total + %) -----------------------------
// Semáforo por avance en tres tramos (meta = 100%): reparte 0–100 en tercios,
// equivalente a la escala 0–50 del criterio (0–16 rojo, 17–33 amarillo, 34–50
// verde). El largo de la barra refuerza el color (accesible).
function colorAvance(p: number): string {
  if (p >= 67) return '#2e9e3f'; // verde — 34–50 (67–100%)
  if (p >= 34) return '#f5b301'; // amarillo — 17–33 (34–66%)
  return '#d0021b'; // rojo — 0–16 (0–33%)
}
function ProgresoBar({ label, n, total }: { label: string; n: number; total: number }) {
  const p = pct(n, total);
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-sm text-inalde-text">{label}</span>
        <span className="text-xs text-inalde-gray tabular-nums">
          {n} / {total} · {p}%
        </span>
      </div>
      <div className="h-3 w-full rounded bg-inalde-gray-bg overflow-hidden">
        <div
          className="h-full rounded transition-all"
          style={{ width: `${p}%`, backgroundColor: colorAvance(p) }}
          role="progressbar"
          aria-valuenow={p}
          aria-valuemin={0}
          aria-valuemax={100}
        />
      </div>
    </div>
  );
}

// --- Barra categórica con color propio (modalidad / perfil) ----------------
function CategoriaBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const p = max ? Math.round((value / max) * 100) : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-sm text-inalde-text">{label}</span>
        <span className="text-xs text-inalde-gray tabular-nums">{value}</span>
      </div>
      <div className="h-3 w-full rounded bg-inalde-gray-bg overflow-hidden">
        <div className="h-full rounded transition-all" style={{ width: `${p}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}

// --- Tarjeta de gráfica de categorías (barras horizontales) ----------------
function GraficaCategorias({ titulo, subtitulo, datos, orden, etiquetas, color }: {
  titulo: string;
  subtitulo?: string;
  datos?: Record<string, number>;
  orden: string[];
  etiquetas: Record<string, string>;
  color: string;
}) {
  if (!datos) return null;
  const max = Math.max(1, ...orden.map((k) => datos[k] ?? 0));
  const hayDatos = orden.some((k) => (datos[k] ?? 0) > 0);
  return (
    <div className="card-inalde p-5">
      <p className="font-primary font-bold text-base text-inalde-text mb-1">{titulo}</p>
      {subtitulo && <p className="text-xs text-inalde-gray mb-4">{subtitulo}</p>}
      {hayDatos ? (
        <div className="flex flex-col gap-4">
          {orden.map((k) => (
            <CategoriaBar key={k} label={etiquetas[k] ?? k} value={datos[k] ?? 0} max={max} color={color} />
          ))}
        </div>
      ) : (
        <p className="text-sm text-inalde-gray italic">Sin datos registrados todavía.</p>
      )}
    </div>
  );
}

export default function DashboardControl() {
  const [cohortes, setCohortes] = useState<Cohorte[]>([]);
  const [cohorteId, setCohorteId] = useState('');
  const [data, setData] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [savingInforme, setSavingInforme] = useState(false);

  // Cargar cohortes activas y seleccionar la activa por defecto.
  useEffect(() => {
    (async () => {
      try {
        const activas = ((await api.get('/admin/cohortes')).data as Cohorte[]).filter((c) => c.activa);
        setCohortes(activas);
        if (activas.length) setCohorteId(activas[0].id);
      } catch (e: any) {
        setErr(formatBackendError(e));
      }
    })();
  }, []);

  // Cargar el dashboard cada vez que cambia la cohorte.
  useEffect(() => {
    if (!cohorteId) return;
    setLoading(true);
    setErr('');
    (async () => {
      try {
        setData((await api.get(`/dashboard-control/${cohorteId}`)).data as Dashboard);
      } catch (e: any) {
        setErr(formatBackendError(e));
        setData(null);
      } finally {
        setLoading(false);
      }
    })();
  }, [cohorteId]);

  async function toggleInforme(realizado: boolean) {
    if (!cohorteId || !data) return;
    setSavingInforme(true);
    setErr('');
    try {
      await api.post(`/dashboard-control/${cohorteId}/informe`, { realizado });
      setData({ ...data, bloque3: { ...data.bloque3, informe_cohorte: { realizado } } });
    } catch (e: any) {
      setErr(formatBackendError(e));
    } finally {
      setSavingInforme(false);
    }
  }

  const b4 = data?.bloque4;
  const maxTrabajos = b4 ? Math.max(1, ...MODALIDAD_ORDEN.map((k) => b4.trabajos_por_modalidad[k] ?? 0)) : 1;
  const maxParticipantes = b4 ? Math.max(1, ...MODALIDAD_ORDEN.map((k) => b4.participantes_por_modalidad[k] ?? 0)) : 1;
  const maxPerfil = b4 ? Math.max(1, ...PERFIL_ORDEN.map((k) => b4.perfil_emprendedor[k] ?? 0)) : 1;

  return (
    <>
      <div className="border-b-[3px] border-inalde-red pb-5 mb-8">
        <p className="section-subtitle mb-2">Admon Cohortes</p>
        <h1 className="section-title">Dashboard de control de cohorte</h1>
        <p className="text-sm text-inalde-gray mt-2">
          Avance del proceso, actas e informe y caracterización de la cohorte seleccionada.
        </p>
      </div>

      <div className="mb-8 flex flex-wrap items-center gap-3">
        <label className="font-primary font-semibold text-xs tracking-wider uppercase text-inalde-gray">
          Cohorte
        </label>
        <select
          value={cohorteId}
          onChange={(e) => setCohorteId(e.target.value)}
          className="input-inalde max-w-xs"
        >
          {cohortes.length === 0 && <option value="">Sin cohortes activas</option>}
          {cohortes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.etiqueta}
            </option>
          ))}
        </select>
      </div>

      {err && (
        <div className="mb-6 rounded border-l-4 border-inalde-red bg-red-50 px-4 py-3 text-sm whitespace-pre-wrap">
          {err}
        </div>
      )}

      {loading && <p className="text-inalde-gray text-sm">Cargando dashboard…</p>}

      {!loading && data && (
        <div className="flex flex-col gap-10">
          {/* Bloque 1 — KPIs */}
          <section>
            <h2 className="font-primary font-bold text-sm uppercase tracking-widest text-inalde-red mb-4 pb-2 border-b border-inalde-gray-light">
              Indicadores clave
            </h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
              <KpiCard label="Participantes activos" value={data.bloque1.participantes_activos} />
              <KpiCard
                label="Proyectos NAVES (equipos)"
                value={data.bloque1.proyectos}
                sub={data.bloque1.equipos_totales !== undefined
                  ? `solo Business Plan · ${data.bloque1.equipos_totales} equipos en total`
                  : 'solo Business Plan'}
              />
              <KpiCard
                label="Anteproyectos entregados"
                value={data.bloque1.anteproyectos_entregados.n}
                sub={`de ${data.bloque1.anteproyectos_entregados.total} equipos`}
                desglose={data.bloque1.anteproyectos_entregados.por_modalidad}
              />
              <KpiCard
                label="Trabajos definitivos entregados"
                value={data.bloque1.trabajos_definitivos_entregados.n}
                sub={`de ${data.bloque1.trabajos_definitivos_entregados.total} equipos`}
              />
            </div>
          </section>

          {/* Bloque 2 — Control del proceso */}
          <section>
            <h2 className="font-primary font-bold text-sm uppercase tracking-widest text-inalde-red mb-4 pb-2 border-b border-inalde-gray-light">
              Control del proceso
            </h2>
            <div className="flex flex-wrap items-center gap-4 mb-3 text-xs text-inalde-gray">
              <span className="font-semibold text-inalde-text">Cambia de color:</span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-3 h-3 rounded-full" style={{ backgroundColor: '#d0021b' }} />
                0–33%
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-3 h-3 rounded-full" style={{ backgroundColor: '#f5b301' }} />
                34–66%
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-3 h-3 rounded-full" style={{ backgroundColor: '#2e9e3f' }} />
                67–100%
              </span>
            </div>
            <div className="card-inalde p-5 flex flex-col gap-4">
              {data.bloque2.map((paso) => (
                <ProgresoBar key={paso.label} label={paso.label} n={paso.n} total={paso.total} />
              ))}
            </div>
          </section>

          {/* Bloque 3 — Actas e informe */}
          <section>
            <h2 className="font-primary font-bold text-sm uppercase tracking-widest text-inalde-red mb-4 pb-2 border-b border-inalde-gray-light">
              Actas e informe
            </h2>
            <div className="grid md:grid-cols-2 gap-5">
              <div className="card-inalde p-5">
                <p className="font-primary font-bold text-base text-inalde-text mb-3">Actas de grado</p>
                {data.bloque3.actas.disponible ? (
                  <div className="flex flex-col gap-2 text-sm text-inalde-text">
                    <span>Realizadas: {data.bloque3.actas.realizadas}</span>
                    <span>Enviadas: {data.bloque3.actas.enviadas}</span>
                    <span>Firmadas: {data.bloque3.actas.firmadas}</span>
                  </div>
                ) : (
                  <div className="rounded border-l-4 border-inalde-gold bg-amber-50 px-4 py-3 text-sm text-inalde-text">
                    El módulo de Actas de Grado aún no está disponible.
                  </div>
                )}
              </div>

              <div className="card-inalde p-5">
                <p className="font-primary font-bold text-base text-inalde-text mb-3">Informe de cohorte</p>
                <label className="flex items-center gap-3 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    className="accent-inalde-red w-4 h-4"
                    checked={data.bloque3.informe_cohorte.realizado}
                    disabled={savingInforme}
                    onChange={(e) => toggleInforme(e.target.checked)}
                  />
                  <span className="text-inalde-text">Informe de cohorte realizado</span>
                </label>
                <p className="text-xs text-inalde-gray mt-2">
                  {savingInforme
                    ? 'Guardando…'
                    : data.bloque3.informe_cohorte.realizado
                      ? 'Marcado como realizado.'
                      : 'Aún no marcado como realizado.'}
                </p>
              </div>
            </div>
          </section>

          {/* Bloque 4 — Caracterización */}
          {b4 && (
            <section>
              <h2 className="font-primary font-bold text-sm uppercase tracking-widest text-inalde-red mb-4 pb-2 border-b border-inalde-gray-light">
                Caracterización
              </h2>
              <div className="grid lg:grid-cols-3 gap-5">
                <div className="card-inalde p-5">
                  <p className="font-primary font-bold text-base text-inalde-text mb-4">Trabajos por modalidad</p>
                  <div className="flex flex-col gap-4">
                    {MODALIDAD_ORDEN.map((k) => (
                      <CategoriaBar
                        key={k}
                        label={MODALIDAD_LABEL[k]}
                        value={b4.trabajos_por_modalidad[k] ?? 0}
                        max={maxTrabajos}
                        color={MODALIDAD_COLOR[k]}
                      />
                    ))}
                  </div>
                </div>

                <div className="card-inalde p-5">
                  <p className="font-primary font-bold text-base text-inalde-text mb-4">Participantes por modalidad</p>
                  <div className="flex flex-col gap-4">
                    {MODALIDAD_ORDEN.map((k) => (
                      <CategoriaBar
                        key={k}
                        label={MODALIDAD_LABEL[k]}
                        value={b4.participantes_por_modalidad[k] ?? 0}
                        max={maxParticipantes}
                        color={MODALIDAD_COLOR[k]}
                      />
                    ))}
                  </div>
                </div>

                <div className="card-inalde p-5">
                  <p className="font-primary font-bold text-base text-inalde-text mb-1">Perfil emprendedor</p>
                  <p className="text-xs text-inalde-gray mb-4">Cómo se define cada participante</p>
                  <div className="flex flex-col gap-4">
                    {PERFIL_ORDEN.map((k) => (
                      <CategoriaBar
                        key={k}
                        label={PERFIL_LABEL[k]}
                        value={b4.perfil_emprendedor[k] ?? 0}
                        max={maxPerfil}
                        color="#e30613"
                      />
                    ))}
                  </div>
                </div>

                {/* Resto de preguntas del perfil emprendedor: la caracterización
                    no se agota en el rol declarado. */}
                <GraficaCategorias
                  titulo="Experiencia emprendedora previa"
                  subtitulo="¿Ya había emprendido antes del MBA?"
                  datos={b4.experiencia_previa}
                  orden={EXPERIENCIA_ORDEN}
                  etiquetas={EXPERIENCIA_LABEL}
                  color="#2e6db4"
                />

                <GraficaCategorias
                  titulo="Desenlace del emprendimiento previo"
                  subtitulo="Solo quienes ya habían emprendido"
                  datos={b4.desenlace_experiencia_previa}
                  orden={DESENLACE_ORDEN}
                  etiquetas={DESENLACE_LABEL}
                  color="#b07d2b"
                />

                <GraficaCategorias
                  titulo="Qué los motiva a emprender"
                  subtitulo="Selección múltiple: un participante puede elegir varias"
                  datos={b4.emociones}
                  orden={EMOCIONES_ORDEN}
                  etiquetas={EMOCIONES_LABEL}
                  color="#1f7a5a"
                />

                <GraficaCategorias
                  titulo="Qué les preocupa al emprender"
                  subtitulo="Selección múltiple: un participante puede elegir varias"
                  datos={b4.preocupaciones}
                  orden={PREOCUPACIONES_ORDEN}
                  etiquetas={PREOCUPACIONES_LABEL}
                  color="#6b4b9a"
                />
              </div>
            </section>
          )}
        </div>
      )}

      <div className="mt-10 pt-6 border-t border-inalde-gray-light">
        <Link to="/admin" className="text-xs text-inalde-gray hover:text-inalde-red">
          ← Volver al panel administrativo
        </Link>
      </div>
    </>
  );
}
