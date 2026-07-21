import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../../lib/api';

// AoL — Fase 2: pantalla "Dashboard" (§9). Vista de solo lectura del cierre AoL de
// la cohorte: KPI de cobertura, % on standard por trait de ESTA cohorte con meta 80 %,
// comparación contra la última cohorte de la misma modalidad, evolución histórica por
// LO, contraste FS vs INT y las acciones del período anterior. Sin librerías de charts:
// las barras y las series se dibujan con divs/CSS.

type Lo = 'LO1' | 'LO2';

interface Fila {
  cohorte: string;
  anio_medicion: number;
  criterio: string;
  lo: Lo;
  n: number;
  pct_on_standard: number;
  excede: number;
  cumple: number;
  no_cumple: number;
}

interface Kpis {
  equipos_bp: number;
  otras_modalidades: number;
  evaluados: number;
  poblacion_objeto: number;
  pct_evaluados: number;
}

interface Accion {
  anio: number;
  cohorte_codigo: string;
  descripcion: string;
  fuente: string;
  lo_id: number | null;
  criterio_id: number | null;
  tipo: string;
}

interface Data {
  cohorte_id: string;
  etiqueta: string;
  codigo_aol: string;
  modalidad: 'INT' | 'FS';
  kpis: Kpis;
  actual: Fila[];
  comparacion: { cohorte: string | null; filas: Fila[] };
  historico: Fila[];
  acciones: Accion[];
  conclusiones: unknown[];
}

interface Cohorte { id: string; etiqueta: string; activa: boolean; }

const TABS = [
  { key: 'trabajos', label: 'Trabajos', to: '/admin/aol', activo: false },
  { key: 'dashboard', label: 'Dashboard', to: '/admin/aol/dashboard', activo: true },
  { key: 'export', label: 'Export AACSB', to: '/admin/aol/export', activo: false },
];

const META = 80; // % on standard objetivo AACSB

function pct1(v: number) { return `${v.toFixed(1)}%`; }
function inferMod(cohorte: string): 'FS' | 'INT' { return /^fs/i.test((cohorte || '').trim()) ? 'FS' : 'INT'; }
function prom(filas: Fila[]): number {
  if (!filas.length) return 0;
  return filas.reduce((s, f) => s + f.pct_on_standard, 0) / filas.length;
}

// Barra horizontal de % on standard con la meta 80 % marcada (línea punteada).
function BarraStandard({ label, pct, n, sub }: { label: string; pct: number; n?: number; sub?: string }) {
  const bajoMeta = pct < META;
  return (
    <div className="mb-3">
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-[0.8rem] font-primary font-semibold text-inalde-text">{label}</span>
        <span className={`text-[0.8rem] font-primary font-bold ${bajoMeta ? 'text-inalde-red' : 'text-inalde-blue'}`}>
          {pct1(pct)}{typeof n === 'number' && <span className="text-inalde-gray font-normal"> · n={n}</span>}
        </span>
      </div>
      <div className="relative h-4 bg-inalde-gray-bg rounded-sm overflow-hidden">
        <div className="absolute inset-y-0 left-0 bg-inalde-blue rounded-sm transition-all" style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
        {/* Línea de meta 80 % */}
        <div className="absolute inset-y-0 border-l-2 border-dashed border-inalde-red" style={{ left: `${META}%` }} title="Meta 80 %" />
      </div>
      {sub && <p className="text-[10px] text-inalde-gray mt-0.5">{sub}</p>}
    </div>
  );
}

// Mini-serie temporal por LO dibujada con segmentos <div> rotados (sin SVG ni librerías).
function MiniSerie({ titulo, puntos }: { titulo: string; puntos: { anio: number; pct: number }[] }) {
  const W = 240, H = 92, PAD = 6;
  const ordenados = [...puntos].sort((a, b) => a.anio - b.anio);
  const xs = (i: number) => ordenados.length <= 1 ? PAD : PAD + (i / (ordenados.length - 1)) * (W - 2 * PAD);
  const ys = (pct: number) => PAD + (1 - Math.min(100, Math.max(0, pct)) / 100) * (H - 2 * PAD);
  const metaY = ys(META);

  const segmentos: { left: number; top: number; len: number; ang: number }[] = [];
  for (let i = 0; i < ordenados.length - 1; i++) {
    const x1 = xs(i), y1 = ys(ordenados[i].pct), x2 = xs(i + 1), y2 = ys(ordenados[i + 1].pct);
    segmentos.push({ left: x1, top: y1, len: Math.hypot(x2 - x1, y2 - y1), ang: Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI });
  }

  return (
    <div className="mb-4">
      <p className="text-[0.8rem] font-primary font-semibold text-inalde-text mb-1.5">{titulo}</p>
      {ordenados.length === 0 ? (
        <p className="text-[11px] text-inalde-gray">Sin histórico.</p>
      ) : (
        <>
          <div className="relative bg-inalde-gray-bg rounded-sm" style={{ width: W, height: H, maxWidth: '100%' }}>
            {/* Meta 80 % punteada */}
            <div className="absolute left-0 right-0 border-t border-dashed border-inalde-red/70" style={{ top: metaY }} title="Meta 80 %" />
            {/* Segmentos de la línea */}
            {segmentos.map((s, i) => (
              <div key={i} className="absolute bg-inalde-blue"
                style={{ left: s.left, top: s.top, width: s.len, height: 2, transformOrigin: '0 50%', transform: `rotate(${s.ang}deg)` }} />
            ))}
            {/* Puntos */}
            {ordenados.map((p, i) => (
              <div key={i} className="absolute w-2 h-2 rounded-full bg-inalde-blue border border-white"
                style={{ left: xs(i) - 4, top: ys(p.pct) - 4 }} title={`${p.anio}: ${pct1(p.pct)}`} />
            ))}
          </div>
          <div className="flex justify-between mt-1" style={{ width: W, maxWidth: '100%' }}>
            {ordenados.map((p) => (
              <span key={p.anio} className="text-[9px] text-inalde-gray tabular-nums">{p.anio}</span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default function AolDashboard() {
  const [cohortes, setCohortes] = useState<Cohorte[]>([]);
  const [cohorte, setCohorte] = useState('');
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(false);
  const [impacto, setImpacto] = useState('');
  const [genImpacto, setGenImpacto] = useState(false);

  async function generarImpacto() {
    if (!cohorte) return;
    setGenImpacto(true);
    try { const r = await api.get(`/aol/dashboard/${cohorte}/lectura-impacto`); setImpacto(r.data.texto ?? ''); }
    catch { setImpacto('No se pudo generar la lectura de impacto. Inténtelo de nuevo.'); }
    finally { setGenImpacto(false); }
  }

  useEffect(() => { (async () => {
    try {
      const r = await api.get('/admin/cohortes');
      const activas = (r.data as Cohorte[]).filter((c) => c.activa);
      setCohortes(activas);
      if (activas[0]) setCohorte(activas[0].id);
    } catch { /* noop */ }
  })(); }, []);

  useEffect(() => { if (!cohorte) return; (async () => {
    setLoading(true); setData(null);
    try { const r = await api.get(`/aol/dashboard/${cohorte}`); setData(r.data); }
    catch { /* noop */ }
    finally { setLoading(false); }
  })(); }, [cohorte]);

  // ---- Derivados de la cohorte actual (Columna A) ----
  const actual = data?.actual ?? [];
  const compFilas = data?.comparacion.filas ?? [];

  const promLo = useMemo(() => ({
    LO1: prom(actual.filter((f) => f.lo === 'LO1')),
    LO2: prom(actual.filter((f) => f.lo === 'LO2')),
  }), [actual]);
  const promLoComp = useMemo(() => ({
    LO1: prom(compFilas.filter((f) => f.lo === 'LO1')),
    LO2: prom(compFilas.filter((f) => f.lo === 'LO2')),
  }), [compFilas]);

  // Comparación por trait (empareja por criterio).
  const deltas = useMemo(() => {
    const mapComp = new Map(compFilas.map((f) => [f.criterio, f.pct_on_standard]));
    return actual.map((f) => ({
      criterio: f.criterio,
      lo: f.lo,
      pct: f.pct_on_standard,
      base: mapComp.has(f.criterio) ? mapComp.get(f.criterio)! : null,
      delta: mapComp.has(f.criterio) ? f.pct_on_standard - mapComp.get(f.criterio)! : null,
    }));
  }, [actual, compFilas]);

  // ---- Histórico (Columna B) ----
  const historico = data?.historico ?? [];

  // Serie temporal por LO: promedio de % on standard por año.
  const serieLo = useMemo(() => {
    const build = (lo: Lo) => {
      const porAnio = new Map<number, Fila[]>();
      historico.filter((f) => f.lo === lo).forEach((f) => {
        const arr = porAnio.get(f.anio_medicion) ?? [];
        arr.push(f); porAnio.set(f.anio_medicion, arr);
      });
      return [...porAnio.entries()].map(([anio, filas]) => ({ anio, pct: prom(filas) }));
    };
    return { LO1: build('LO1'), LO2: build('LO2') };
  }, [historico]);

  // FS vs INT: promedio por trait y modalidad (modalidad inferida del prefijo del cohorte).
  const fsVsInt = useMemo(() => {
    const traits = [...new Set(historico.map((f) => f.criterio))];
    return traits.map((criterio) => {
      const dfs = historico.filter((f) => f.criterio === criterio && inferMod(f.cohorte) === 'FS');
      const dint = historico.filter((f) => f.criterio === criterio && inferMod(f.cohorte) === 'INT');
      return { criterio, fs: dfs.length ? prom(dfs) : null, int: dint.length ? prom(dint) : null };
    });
  }, [historico]);

  // ---- Acciones del período anterior ----
  const accionesTrait = (data?.acciones ?? []).filter((a) => a.tipo === 'trait');
  const accionesProceso = (data?.acciones ?? []).filter((a) => a.tipo !== 'trait');

  const k = data?.kpis;

  return (
    <>
      <div className="border-b-[3px] border-inalde-red pb-5 mb-6">
        <p className="section-subtitle mb-2">Assurance of Learning</p>
        <h1 className="section-title">Dashboard AoL</h1>
        {data && (
          <p className="text-sm text-inalde-gray mt-2">
            Cohorte <strong className="text-inalde-text">{data.etiqueta}</strong>
            {' · '}código AoL <strong className="text-inalde-blue">{data.codigo_aol}</strong>
            {' · '}modalidad {data.modalidad === 'FS' ? 'Fin de Semana' : 'Intensivo'}
          </p>
        )}
      </div>

      {/* Pestañas del módulo */}
      <div className="flex gap-1 mb-6 border-b border-inalde-gray-light">
        {TABS.map((t) => (
          <Link key={t.key} to={t.to}
            className={`px-4 py-2 text-sm font-primary font-semibold border-b-2 -mb-px ${
              t.activo ? 'border-inalde-red text-inalde-red' : 'border-transparent text-inalde-gray/60 hover:text-inalde-text'
            }`}>
            {t.label}
          </Link>
        ))}
      </div>

      {/* Selector de cohorte */}
      <div className="flex flex-wrap items-end gap-3 mb-6">
        <div className="max-w-xs flex-1">
          <label className="block font-primary font-semibold text-xs tracking-wider uppercase text-inalde-gray mb-1">Cohorte activa</label>
          <select value={cohorte} onChange={(e) => setCohorte(e.target.value)} className="input-inalde">
            {cohortes.map((c) => <option key={c.id} value={c.id}>{c.etiqueta}</option>)}
          </select>
        </div>
      </div>

      {loading && <p className="text-inalde-gray text-sm">Cargando…</p>}

      {data && !loading && k && (
        <>
          {/* Tiles KPI */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            <div className="card-inalde">
              <p className="text-[10px] uppercase tracking-wider font-semibold text-inalde-gray">Población objeto</p>
              <p className="text-3xl font-primary font-bold text-inalde-text mt-1">{k.equipos_bp}</p>
              <p className="text-[11px] text-inalde-gray mt-0.5">equipos con Business Plan</p>
            </div>
            <div className="card-inalde">
              <p className="text-[10px] uppercase tracking-wider font-semibold text-inalde-gray">Otras modalidades</p>
              <p className="text-3xl font-primary font-bold text-inalde-text mt-1">{k.otras_modalidades}</p>
              <p className="text-[11px] text-inalde-gray mt-0.5">fuera de Business Plan</p>
            </div>
            <div className="card-inalde">
              <p className="text-[10px] uppercase tracking-wider font-semibold text-inalde-gray">Evaluados</p>
              <p className="text-3xl font-primary font-bold text-inalde-text mt-1">{k.evaluados}</p>
              <p className="text-[11px] text-inalde-gray mt-0.5">equipos con firma AoL</p>
            </div>
            <div className="card-inalde border-l-4 border-inalde-blue">
              <p className="text-[10px] uppercase tracking-wider font-semibold text-inalde-gray">% evaluados</p>
              <p className="text-3xl font-primary font-bold text-inalde-blue mt-1">{pct1(k.pct_evaluados)}</p>
              <p className="text-[11px] text-inalde-gray mt-0.5">{k.evaluados} de {k.poblacion_objeto}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            {/* Columna A — Esta cohorte */}
            <div className="card-inalde">
              <h2 className="font-primary font-bold text-lg text-inalde-text mb-1">Esta cohorte</h2>
              <p className="text-[11px] text-inalde-gray mb-4">% on standard por trait · meta {META} % (línea punteada)</p>

              {actual.length === 0 ? (
                <p className="text-sm text-inalde-gray bg-inalde-gray-bg rounded-sm px-4 py-6 text-center">
                  Aún no hay calificaciones firmadas de esta cohorte.
                </p>
              ) : (
                <>
                  {actual.map((f) => (
                    <BarraStandard key={f.criterio} label={`${f.criterio}`} pct={f.pct_on_standard} n={f.n}
                      sub={`${f.lo} · excede ${f.excede} · cumple ${f.cumple} · no cumple ${f.no_cumple}`} />
                  ))}

                  {/* Comparación vs. última cohorte de la misma modalidad */}
                  <div className="mt-6 pt-4 border-t border-inalde-gray-light">
                    <p className="text-[0.8rem] font-primary font-semibold text-inalde-text mb-3">
                      Comparación vs. {data.comparacion.cohorte
                        ? <span className="text-inalde-blue">{data.comparacion.cohorte}</span>
                        : <span className="text-inalde-gray">(sin cohorte de referencia)</span>}
                    </p>
                    {data.comparacion.cohorte ? (
                      <>
                        <ul className="space-y-1.5">
                          {deltas.map((d) => (
                            <li key={d.criterio} className="flex items-center justify-between text-[0.8rem]">
                              <span className="text-inalde-gray">
                                <span className="text-[9px] uppercase tracking-wider font-semibold text-inalde-blue mr-1">{d.lo}</span>
                                {d.criterio}
                              </span>
                              {d.delta === null ? (
                                <span className="text-inalde-gray">—</span>
                              ) : (
                                <span className={`font-semibold tabular-nums ${d.delta >= 0 ? 'text-green-700' : 'text-inalde-red'}`}>
                                  {d.delta >= 0 ? '▲' : '▼'} {Math.abs(d.delta).toFixed(1)} pts
                                </span>
                              )}
                            </li>
                          ))}
                        </ul>
                        <div className="flex gap-6 mt-4 pt-3 border-t border-inalde-gray-light text-[0.8rem]">
                          {(['LO1', 'LO2'] as Lo[]).map((lo) => {
                            const dl = promLo[lo] - promLoComp[lo];
                            return (
                              <span key={lo} className="font-primary">
                                <strong className="text-inalde-text">{lo}: {pct1(promLo[lo])}</strong>
                                <span className={`ml-1 font-bold ${dl >= 0 ? 'text-green-700' : 'text-inalde-red'}`}>
                                  ({dl >= 0 ? '+' : ''}{dl.toFixed(1)})
                                </span>
                              </span>
                            );
                          })}
                        </div>
                      </>
                    ) : (
                      <p className="text-[11px] text-inalde-gray">No hay una cohorte previa de la misma modalidad para comparar.</p>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* Columna B — Histórico */}
            <div className="card-inalde">
              <h2 className="font-primary font-bold text-lg text-inalde-text mb-1">Histórico</h2>
              <p className="text-[11px] text-inalde-gray mb-4">Evolución del % on standard promedio por año · meta {META} %</p>

              <MiniSerie titulo="LO1 — % on standard por año" puntos={serieLo.LO1} />
              <MiniSerie titulo="LO2 — % on standard por año" puntos={serieLo.LO2} />

              {/* FS vs INT */}
              <div className="mt-6 pt-4 border-t border-inalde-gray-light">
                <p className="text-[0.8rem] font-primary font-semibold text-inalde-text mb-1">Fin de Semana vs. Intensivo</p>
                <div className="flex gap-3 mb-3 text-[10px] text-inalde-gray">
                  <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm bg-inalde-blue" /> FS</span>
                  <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm bg-inalde-gold" /> INT</span>
                </div>
                {fsVsInt.length === 0 ? (
                  <p className="text-[11px] text-inalde-gray">Sin datos históricos por modalidad.</p>
                ) : (
                  <div className="space-y-3">
                    {fsVsInt.map((t) => (
                      <div key={t.criterio}>
                        <p className="text-[0.8rem] font-primary font-semibold text-inalde-text mb-1">{t.criterio}</p>
                        {(['fs', 'int'] as const).map((m) => {
                          const val = t[m];
                          return (
                            <div key={m} className="flex items-center gap-2 mb-1">
                              <span className="text-[9px] uppercase w-6 text-inalde-gray">{m === 'fs' ? 'FS' : 'INT'}</span>
                              <div className="relative flex-1 h-3 bg-inalde-gray-bg rounded-sm overflow-hidden">
                                {val !== null && (
                                  <div className={`absolute inset-y-0 left-0 rounded-sm ${m === 'fs' ? 'bg-inalde-blue' : 'bg-inalde-gold'}`}
                                    style={{ width: `${Math.min(100, Math.max(0, val))}%` }} />
                                )}
                                <div className="absolute inset-y-0 border-l border-dashed border-inalde-red" style={{ left: `${META}%` }} />
                              </div>
                              <span className="text-[10px] tabular-nums text-inalde-gray w-12 text-right">
                                {val === null ? '—' : pct1(val)}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Sección inferior — Acciones del período anterior */}
          <div className="card-inalde mt-6">
            <h2 className="font-primary font-bold text-lg text-inalde-text mb-1">Acciones del período anterior</h2>
            <p className="text-[11px] text-inalde-gray mb-4">Cierre del ciclo AoL: acciones de mejora derivadas de la medición previa.</p>

            {(data.acciones ?? []).length === 0 ? (
              <p className="text-sm text-inalde-gray">No se registraron acciones en el período anterior.</p>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div>
                  <p className="text-[10px] uppercase tracking-wider font-semibold text-inalde-gray mb-2">Por trait</p>
                  {accionesTrait.length === 0 ? (
                    <p className="text-[11px] text-inalde-gray">Sin acciones por trait.</p>
                  ) : (
                    <ul className="space-y-2">
                      {accionesTrait.map((a, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <span className="shrink-0 mt-0.5 text-[9px] uppercase tracking-wider font-semibold text-inalde-blue bg-inalde-blue/10 rounded px-1.5 py-0.5">
                            LO{a.lo_id ?? '?'}·T{a.criterio_id ?? '?'}
                          </span>
                          <span className="text-[0.8rem] text-inalde-text">
                            {a.descripcion}
                            <span className="block text-[10px] text-inalde-gray mt-0.5">{a.cohorte_codigo} · {a.anio} · {a.fuente}</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider font-semibold text-inalde-gray mb-2">De proceso</p>
                  {accionesProceso.length === 0 ? (
                    <p className="text-[11px] text-inalde-gray">Sin acciones de proceso.</p>
                  ) : (
                    <ul className="space-y-2">
                      {accionesProceso.map((a, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <span className="shrink-0 mt-0.5 text-[9px] uppercase tracking-wider font-semibold text-inalde-gold bg-inalde-gold/10 rounded px-1.5 py-0.5">
                            Proceso
                          </span>
                          <span className="text-[0.8rem] text-inalde-text">
                            {a.descripcion}
                            <span className="block text-[10px] text-inalde-gray mt-0.5">{a.cohorte_codigo} · {a.anio} · {a.fuente}</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}

            {/* Lectura de impacto (borrador IA editable, closing the loop §9) */}
            <div className="mt-6 pt-5 border-t border-inalde-gray-light">
              <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
                <p className="text-[10px] uppercase tracking-wider font-semibold text-inalde-red">Lectura de impacto · borrador IA (editable)</p>
                <button onClick={generarImpacto} disabled={genImpacto}
                  className="font-primary font-bold text-[11px] uppercase tracking-wider border border-inalde-red text-inalde-red px-3 py-1.5 rounded hover:bg-inalde-red hover:text-white disabled:opacity-50">
                  {genImpacto ? 'Generando…' : impacto ? 'Regenerar' : 'Generar con IA'}
                </button>
              </div>
              <textarea
                value={impacto}
                onChange={(e) => setImpacto(e.target.value)}
                rows={6}
                placeholder="La IA interpreta el impacto de las acciones del ciclo anterior (acción → trait/LO → delta). Genera el borrador y edítalo."
                className="input-inalde w-full text-sm leading-relaxed"
              />
            </div>
          </div>
        </>
      )}
    </>
  );
}
