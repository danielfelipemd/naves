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
    proyectos: number;
    anteproyectos_entregados: NTotal;
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

function pct(n: number, total: number): number {
  if (!total) return 0;
  return Math.round((n / total) * 100);
}

// --- Tarjeta KPI (número grande) -------------------------------------------
function KpiCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="card-inalde flex flex-col justify-between p-5">
      <p className="font-primary font-semibold text-xs tracking-wider uppercase text-inalde-gray">{label}</p>
      <p className="font-primary font-bold text-4xl text-inalde-text mt-2 leading-none">{value}</p>
      {sub && <p className="text-xs text-inalde-gray mt-1">{sub}</p>}
    </div>
  );
}

// --- Barra de avance del proceso (n/total + %) -----------------------------
// Semáforo por avance: paso cerrado (100%) en verde, en curso en rojo INALDE,
// sin empezar (0%) en gris. En un tablero de control interesa ver de un vistazo
// qué pasos ya cerraron; el largo de la barra refuerza el color (accesible).
function colorAvance(p: number): string {
  if (p >= 100) return '#1e7d34'; // verde — completado
  if (p <= 0) return '#9aa0a6'; // gris — sin empezar
  return '#d0021b'; // rojo INALDE — en curso
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
              <KpiCard label="Proyectos (equipos)" value={data.bloque1.proyectos} />
              <KpiCard
                label="Anteproyectos entregados"
                value={data.bloque1.anteproyectos_entregados.n}
                sub={`de ${data.bloque1.anteproyectos_entregados.total} equipos`}
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
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: '#1e7d34' }} />
                Completado
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: '#d0021b' }} />
                En curso
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: '#9aa0a6' }} />
                Sin empezar
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
                  <p className="font-primary font-bold text-base text-inalde-text mb-4">Perfil emprendedor</p>
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
