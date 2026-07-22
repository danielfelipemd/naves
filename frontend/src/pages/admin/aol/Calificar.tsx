import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../../lib/api';
import { formatBackendError } from '../../../lib/errors';

// AoL — Fase 2: pantalla "Calificar" (§8). El Director revisa la sugerencia de la
// IA (quick screen + modelo financiero + rúbrica de 6 traits), ajusta los puntajes,
// edita el párrafo y firma la calificación. AdminLayout ya pone el <Header/> global,
// así que esta pantalla NO renderiza su propio Header (mismo patrón que Trabajos /
// DashboardControl).

// --- Tipos del endpoint GET /aol/calificar/:proyectoId ----------------------
interface Nivel { puntaje: 1 | 2 | 3; descripcion: string; }
interface Rubrica {
  id: 1 | 2 | 3 | 4 | 5 | 6;
  lo_id: 1 | 2;
  nombre_en: string;
  nombre_corto: string;
  fuente_ia: string;
  niveles: Nivel[];
}
interface Trait {
  trait: 1 | 2 | 3 | 4 | 5 | 6;
  puntaje: 1 | 2 | 3;
  razon: string;
  evidencia: string;
  ubicacion: string;
  sugerencia: string;
  confianza: 'alta' | 'media' | 'baja';
}
interface Chequeo {
  chequeo: number;
  estado: 'OK' | 'ALERTA' | 'NO_VERIFICABLE';
  evidencia: string;
  nota: string;
}
interface QuickScreen {
  paginas: number;
  paginas_ok: boolean;
  toc: boolean;
  declaracion_ia: boolean;
  formulas_visibles: boolean;
  balance_cuadra: boolean;
  compuertas_bloqueantes: string[];
}
interface Resultado {
  traits: Trait[];
  modelo_financiero: { interna: Chequeo[]; coherencia_bp: Chequeo[] };
  parrafo: string;
  total: number;
  on_standard: boolean;
}
interface Analisis {
  id: number;
  version_cerebro: string;
  quick_screen: QuickScreen;
  resultado: Resultado | null;
}
interface ModeloItem {
  id: number;
  dimension: 'A' | 'B' | string;
  orden: number;
  item: string;
  detalle: string;
}
interface Calificacion {
  puntajes: Record<string, number>;
  parrafo: string;
  total: number;
  on_standard: boolean;
  autor: string;
  firmado_en: string;
}
interface Data {
  proyecto_id: string;
  proyecto: string;
  cohorte: string;
  integrantes: string[];
  analisis: Analisis | null;
  rubrica: Rubrica[];
  modelo_financiero: ModeloItem[];
  calificacion: Calificacion | null;
}

const TRAITS_IDS = [1, 2, 3, 4, 5, 6] as const;
const ON_STANDARD_MIN = 12;

// Un trait exige revisión manual cuando la IA tiene confianza baja o no aportó
// evidencia: en esos casos NO se pre-selecciona su sugerencia.
function esRevisionObligatoria(t: Trait | undefined): boolean {
  if (!t) return true;
  return t.confianza === 'baja' || !t.evidencia || !t.evidencia.trim();
}

// ✓ / ✗ para el quick screen.
function CheckMark({ ok }: { ok: boolean }) {
  return (
    <span className={`font-bold ${ok ? 'text-green-700' : 'text-inalde-red'}`}>{ok ? '✓' : '✗'}</span>
  );
}

function QuickRow({ label, ok, valor }: { label: string; ok: boolean; valor?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 border-b border-inalde-gray-light last:border-b-0">
      <span className="text-sm text-inalde-text">{label}</span>
      <span className="flex items-center gap-2 text-sm text-inalde-gray tabular-nums">
        {valor && <span>{valor}</span>}
        <CheckMark ok={ok} />
      </span>
    </div>
  );
}

// Estilos por estado de un chequeo del modelo financiero.
const ESTADO_STYLE: Record<Chequeo['estado'], { chip: string; label: string }> = {
  OK: { chip: 'bg-green-100 text-green-800', label: 'OK' },
  ALERTA: { chip: 'bg-red-100 text-inalde-red', label: 'Alerta' },
  NO_VERIFICABLE: { chip: 'bg-inalde-gray-bg text-inalde-gray', label: 'No verificable' },
};

export default function AolCalificar() {
  const { proyectoId } = useParams<{ proyectoId: string }>();
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [analizando, setAnalizando] = useState(false);
  const [firmando, setFirmando] = useState(false);
  const [okMsg, setOkMsg] = useState('');

  // Estado editable del profesor.
  const [selected, setSelected] = useState<Record<number, number>>({});
  const [parrafo, setParrafo] = useState('');
  const [editando, setEditando] = useState(false);

  const cargar = useCallback(async () => {
    if (!proyectoId) return;
    setLoading(true);
    setErr('');
    try {
      const r = await api.get(`/aol/calificar/${proyectoId}`);
      const d = r.data as Data;
      setData(d);
      if (d.calificacion) {
        // Ya calificado: precargar los puntajes firmados y quedar en solo lectura.
        const pre: Record<number, number> = {};
        for (const k of Object.keys(d.calificacion.puntajes)) pre[Number(k)] = d.calificacion.puntajes[k];
        setSelected(pre);
        setParrafo(d.calificacion.parrafo);
        setEditando(false);
      } else {
        setSelected({});
        setParrafo(d.analisis?.resultado?.parrafo ?? '');
        setEditando(true);
      }
    } catch (e: any) {
      setErr(formatBackendError(e));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [proyectoId]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const analisis = data?.analisis ?? null;
  const resultado = analisis?.resultado ?? null;

  // Índice de traits por número para cruces rápidos.
  const traitByNum = useMemo(() => {
    const m = new Map<number, Trait>();
    for (const t of resultado?.traits ?? []) m.set(t.trait, t);
    return m;
  }, [resultado]);

  const total = useMemo(
    () => TRAITS_IDS.reduce((acc, id) => acc + (selected[id] ?? 0), 0),
    [selected],
  );
  const seleccionCompleta = TRAITS_IDS.every((id) => !!selected[id]);
  const onStandard = total >= ON_STANDARD_MIN;

  async function analizarAhora() {
    if (!proyectoId) return;
    setAnalizando(true);
    setErr('');
    setOkMsg('');
    try {
      // El análisis corre en SEGUNDO PLANO en el backend (Opus + reintento R1 puede
      // tardar 1-2 min, más que el timeout HTTP). Disparamos y sondeamos el estado.
      await api.post(`/aol/analizar/${proyectoId}`, {});
      // Sondeo cada 3 s, hasta ~4 min (80 vueltas).
      for (let i = 0; i < 80; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        let estado = 'inactivo';
        let error: string | null = null;
        try {
          const { data } = await api.get(`/aol/analizar/${proyectoId}/estado`);
          estado = data?.estado ?? 'inactivo';
          error = data?.error ?? null;
        } catch {
          continue; // red intermitente: reintentamos en la próxima vuelta
        }
        if (estado === 'error') { setErr(error || 'El análisis falló.'); return; }
        // 'listo' o 'inactivo' (proceso reiniciado): recargamos y mostramos lo que haya.
        if (estado === 'listo' || estado === 'inactivo') { await cargar(); return; }
        // 'procesando' → seguimos sondeando.
      }
      setErr('El análisis está tardando más de lo esperado. Recarga la página en un momento.');
    } catch (e: any) {
      setErr(formatBackendError(e));
    } finally {
      setAnalizando(false);
    }
  }

  function aceptarSugerenciaIA() {
    const next: Record<number, number> = {};
    for (const id of TRAITS_IDS) {
      const t = traitByNum.get(id);
      if (t && !esRevisionObligatoria(t)) next[id] = t.puntaje;
    }
    setSelected(next);
  }

  async function firmar() {
    if (!proyectoId || !analisis || !resultado) return;
    if (!seleccionCompleta || !parrafo.trim()) return;
    setFirmando(true);
    setErr('');
    setOkMsg('');
    try {
      const puntajes: Record<string, number> = {};
      const sugerencia_ia: Record<string, number> = {};
      for (const id of TRAITS_IDS) {
        puntajes[String(id)] = selected[id];
        const t = traitByNum.get(id);
        if (t) sugerencia_ia[String(id)] = t.puntaje;
      }
      await api.post(`/aol/calificar/${proyectoId}/firmar`, {
        puntajes,
        parrafo: parrafo.trim(),
        analisis_id: analisis.id,
        version_cerebro: analisis.version_cerebro,
        sugerencia_ia,
      });
      setOkMsg('Calificación firmada correctamente.');
      await cargar();
    } catch (e: any) {
      setErr(formatBackendError(e));
    } finally {
      setFirmando(false);
    }
  }

  // --- Render -----------------------------------------------------------------
  if (loading) return <p className="text-inalde-gray text-sm">Cargando trabajo…</p>;

  if (err && !data) {
    return (
      <>
        <div className="mb-6 rounded border-l-4 border-inalde-red bg-red-50 px-4 py-3 text-sm whitespace-pre-wrap">
          {err}
        </div>
        <Link to="/admin/aol" className="text-xs text-inalde-gray hover:text-inalde-red">
          ← Volver a Trabajos por calificar
        </Link>
      </>
    );
  }

  if (!data) return null;

  return (
    <>
      {/* Encabezado */}
      <div className="border-b-[3px] border-inalde-red pb-5 mb-6">
        <p className="section-subtitle mb-2">Assurance of Learning · Calificar</p>
        <h1 className="section-title">{data.proyecto}</h1>
        <p className="text-sm text-inalde-gray mt-2">
          Cohorte <strong className="text-inalde-text">{data.cohorte}</strong>
          {data.integrantes.length > 0 && (
            <> · Integrantes: {data.integrantes.join(', ')}</>
          )}
        </p>
      </div>

      {err && (
        <div className="mb-6 rounded border-l-4 border-inalde-red bg-red-50 px-4 py-3 text-sm whitespace-pre-wrap">
          {err}
        </div>
      )}
      {okMsg && (
        <div className="mb-6 rounded border-l-4 border-green-600 bg-green-50 px-4 py-3 text-sm text-green-800">
          {okMsg}
        </div>
      )}

      {/* Banner de calificación ya firmada */}
      {data.calificacion && !editando && (
        <div className="mb-8 rounded-lg border-2 border-green-600 bg-green-50 px-5 py-4 flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="font-primary font-bold text-green-800">
              ✓ Calificado ({data.calificacion.total}/18 ·{' '}
              {data.calificacion.on_standard ? 'on standard' : 'below standard'})
            </p>
            <p className="text-sm text-green-800/80 mt-1">
              Firmado por {data.calificacion.autor}
              {data.calificacion.firmado_en && (
                <> · {new Date(data.calificacion.firmado_en).toLocaleString('es-CO')}</>
              )}
            </p>
          </div>
          <button type="button" className="btn-inalde-secondary" onClick={() => setEditando(true)}>
            Re-firmar
          </button>
        </div>
      )}

      {/* Caso 1: sin análisis IA */}
      {!analisis && (
        <div className="card-inalde flex flex-col items-start gap-4">
          <div className="rounded border-l-4 border-inalde-gold bg-amber-50 px-4 py-3 text-sm text-inalde-text w-full">
            Este trabajo aún no tiene análisis IA.
          </div>
          <button type="button" className="btn-inalde-primary" onClick={analizarAhora} disabled={analizando}>
            {analizando ? (
              <>
                <span className="inline-block h-4 w-4 rounded-full border-2 border-white/40 border-t-white animate-spin" />
                Analizando con IA… (puede tardar 1-2 min)
              </>
            ) : (
              'Analizar ahora'
            )}
          </button>
        </div>
      )}

      {/* Caso 2: compuerta bloqueante (análisis sin resultado) */}
      {analisis && !resultado && (
        <div className="rounded-lg border-2 border-inalde-red bg-red-50 p-6">
          <p className="font-primary font-bold text-inalde-red text-lg mb-3">No se puede calificar</p>
          <p className="text-sm text-inalde-text mb-3">
            El análisis IA detectó compuertas bloqueantes que impiden generar una sugerencia:
          </p>
          <ul className="list-disc list-inside flex flex-col gap-1 text-sm text-inalde-text">
            {analisis.quick_screen.compuertas_bloqueantes.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Caso 3: hay resultado → flujo completo de calificación */}
      {analisis && resultado && (
        <div className="flex flex-col gap-10 pb-28">
          {/* (a) Análisis IA del documento */}
          <section>
            <h2 className="font-primary font-bold text-sm uppercase tracking-widest text-inalde-red mb-4 pb-2 border-b border-inalde-gray-light">
              Análisis IA del documento
            </h2>
            <div className="card-inalde p-5">
              <div className="grid md:grid-cols-2 gap-x-8">
                <QuickRow
                  label="Páginas"
                  valor={String(analisis.quick_screen.paginas)}
                  ok={analisis.quick_screen.paginas_ok}
                />
                <QuickRow label="Tabla de contenido (TdC)" ok={analisis.quick_screen.toc} />
                <QuickRow label="Declaración de uso de IA" ok={analisis.quick_screen.declaracion_ia} />
                <QuickRow label="Fórmulas visibles" ok={analisis.quick_screen.formulas_visibles} />
                <QuickRow label="El balance cuadra" ok={analisis.quick_screen.balance_cuadra} />
              </div>
              <div className="mt-4 pt-3 border-t border-inalde-gray-light flex items-baseline justify-between">
                <span className="font-primary font-semibold text-sm uppercase tracking-wider text-inalde-gray">
                  Total sugerido por la IA
                </span>
                <span className="font-primary font-bold text-2xl text-inalde-text tabular-nums">
                  {resultado.total}
                  <span className="text-base text-inalde-gray">/18</span>
                </span>
              </div>
            </div>
          </section>

          {/* (b) Análisis del modelo financiero */}
          <section>
            <h2 className="font-primary font-bold text-sm uppercase tracking-widest text-inalde-red mb-4 pb-2 border-b border-inalde-gray-light">
              Análisis del modelo financiero
            </h2>
            <div className="grid lg:grid-cols-2 gap-5">
              <ModeloColumna
                titulo="Dimensión A · Consistencia interna"
                items={data.modelo_financiero.filter((m) => m.dimension === 'A')}
                chequeos={resultado.modelo_financiero.interna}
              />
              <ModeloColumna
                titulo="Dimensión B · Coherencia con el Business Plan"
                items={data.modelo_financiero.filter((m) => m.dimension === 'B')}
                chequeos={resultado.modelo_financiero.coherencia_bp}
              />
            </div>
          </section>

          {/* (c) Rúbrica */}
          <section>
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4 pb-2 border-b border-inalde-gray-light">
              <h2 className="font-primary font-bold text-sm uppercase tracking-widest text-inalde-red">
                Rúbrica de evaluación (6 traits)
              </h2>
              {editando && (
                <button type="button" className="btn-inalde-secondary" onClick={aceptarSugerenciaIA}>
                  Aceptar sugerencia IA
                </button>
              )}
            </div>

            {[1, 2].map((lo) => {
              const items = data.rubrica.filter((r) => r.lo_id === lo);
              if (items.length === 0) return null;
              return (
                <div key={lo} className="mb-8 last:mb-0">
                  <p className="font-primary font-semibold text-xs tracking-wider uppercase text-inalde-blue mb-3">
                    Learning Objective {lo} (LO{lo})
                  </p>
                  <div className="grid md:grid-cols-2 gap-5">
                    {items.map((r) => (
                      <RubricaCard
                        key={r.id}
                        rubrica={r}
                        trait={traitByNum.get(r.id)}
                        seleccionado={selected[r.id]}
                        editable={editando}
                        onSelect={(p) => setSelected((s) => ({ ...s, [r.id]: p }))}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </section>

          {/* (f) Párrafo de calificación */}
          <section>
            <h2 className="font-primary font-bold text-sm uppercase tracking-widest text-inalde-red mb-4 pb-2 border-b border-inalde-gray-light">
              Párrafo de calificación
            </h2>
            <textarea
              className="input-inalde min-h-[160px] resize-y"
              value={parrafo}
              onChange={(e) => setParrafo(e.target.value)}
              disabled={!editando}
              placeholder="Redacte el párrafo de retroalimentación para el equipo…"
            />
          </section>
        </div>
      )}

      {/* (e) Barra fija con el total y la firma */}
      {analisis && resultado && editando && (
        <div className="sticky bottom-0 -mx-4 sm:-mx-6 md:-mx-8 mt-6 border-t-2 border-inalde-gray-light bg-white/95 backdrop-blur px-4 sm:px-6 md:px-8 py-4 shadow-[0_-2px_8px_rgba(0,0,0,0.06)]">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-baseline gap-4">
              <span className="font-primary font-bold text-3xl text-inalde-text tabular-nums leading-none">
                {total}
                <span className="text-lg text-inalde-gray">/18</span>
              </span>
              <span
                className={`font-primary font-semibold text-xs uppercase tracking-wider px-3 py-1 rounded ${
                  onStandard ? 'bg-green-100 text-green-800' : 'bg-red-100 text-inalde-red'
                }`}
              >
                {onStandard ? 'On standard' : 'Below standard'}
              </span>
              {!seleccionCompleta && (
                <span className="text-xs text-inalde-gray">Faltan traits por seleccionar</span>
              )}
            </div>
            <button
              type="button"
              className="btn-inalde-primary"
              onClick={firmar}
              disabled={!seleccionCompleta || !parrafo.trim() || firmando}
            >
              {firmando ? (
                <>
                  <span className="inline-block h-4 w-4 rounded-full border-2 border-white/40 border-t-white animate-spin" />
                  Firmando…
                </>
              ) : (
                'Guardar calificación (firmar)'
              )}
            </button>
          </div>
        </div>
      )}

      <div className="mt-10 pt-6 border-t border-inalde-gray-light">
        <Link to="/admin/aol" className="text-xs text-inalde-gray hover:text-inalde-red">
          ← Volver a Trabajos por calificar
        </Link>
      </div>
    </>
  );
}

// --- Columna del modelo financiero -----------------------------------------
function ModeloColumna({
  titulo,
  items,
  chequeos,
}: {
  titulo: string;
  items: ModeloItem[];
  chequeos: Chequeo[];
}) {
  // El resultado cruza por índice `chequeo`: lo emparejamos con el texto base por
  // su `orden` (y como respaldo por `id`).
  const findChequeo = (item: ModeloItem): Chequeo | undefined =>
    chequeos.find((c) => c.chequeo === item.orden) ?? chequeos.find((c) => c.chequeo === item.id);

  return (
    <div className="card-inalde p-5">
      <p className="font-primary font-bold text-sm text-inalde-text mb-4">{titulo}</p>
      <div className="flex flex-col gap-3">
        {items
          .slice()
          .sort((a, b) => a.orden - b.orden)
          .map((item) => {
            const ch = findChequeo(item);
            const estado = ch?.estado ?? 'NO_VERIFICABLE';
            const st = ESTADO_STYLE[estado];
            return (
              <div key={item.id} className="border-b border-inalde-gray-light last:border-b-0 pb-3 last:pb-0">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-semibold text-inalde-text">{item.item}</p>
                  <span
                    className={`shrink-0 text-[9px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded ${st.chip}`}
                  >
                    {st.label}
                  </span>
                </div>
                {item.detalle && <p className="text-xs text-inalde-gray mt-0.5">{item.detalle}</p>}
                {ch?.evidencia && (
                  <p className="text-xs text-inalde-text mt-1">
                    <span className="text-inalde-gray">Evidencia:</span> {ch.evidencia}
                  </p>
                )}
                {ch?.nota && (
                  <p className="text-xs text-inalde-gray mt-0.5 italic">{ch.nota}</p>
                )}
              </div>
            );
          })}
      </div>
    </div>
  );
}

// --- Tarjeta de un trait de la rúbrica --------------------------------------
function RubricaCard({
  rubrica,
  trait,
  seleccionado,
  editable,
  onSelect,
}: {
  rubrica: Rubrica;
  trait: Trait | undefined;
  seleccionado: number | undefined;
  editable: boolean;
  onSelect: (p: number) => void;
}) {
  const revision = esRevisionObligatoria(trait);
  const sugerido = trait?.puntaje;

  return (
    <div className="card-inalde p-5 flex flex-col">
      <div className="flex items-start justify-between gap-2 mb-1">
        <div>
          <p className="font-primary font-bold text-base text-inalde-text">
            Trait {rubrica.id} · {rubrica.nombre_corto}
          </p>
          <p className="text-xs text-inalde-gray">{rubrica.nombre_en}</p>
        </div>
        {revision && trait && (
          <span className="shrink-0 text-[9px] uppercase tracking-wider font-bold px-2 py-0.5 rounded bg-red-100 text-inalde-red">
            Revisión obligatoria
          </span>
        )}
      </div>

      <p className="text-[11px] uppercase tracking-wider text-inalde-gray mt-2 mb-3">
        La IA consulta: <span className="text-inalde-text normal-case tracking-normal">{rubrica.fuente_ia}</span>
      </p>

      {/* Niveles clicables */}
      <div className="flex flex-col gap-2">
        {rubrica.niveles
          .slice()
          .sort((a, b) => a.puntaje - b.puntaje)
          .map((n) => {
            const activo = seleccionado === n.puntaje;
            const esSugerido = sugerido === n.puntaje;
            return (
              <button
                key={n.puntaje}
                type="button"
                disabled={!editable}
                onClick={() => editable && onSelect(n.puntaje)}
                className={`relative text-left rounded border-2 px-3 py-2 transition-colors ${
                  activo
                    ? 'border-inalde-red bg-red-50'
                    : 'border-inalde-gray-light bg-white hover:border-inalde-blue'
                } ${editable ? 'cursor-pointer' : 'cursor-default'}`}
              >
                <div className="flex items-start gap-2">
                  <span
                    className={`shrink-0 font-primary font-bold text-sm ${
                      activo ? 'text-inalde-red' : 'text-inalde-gray'
                    }`}
                  >
                    {n.puntaje}
                  </span>
                  <span className="text-xs text-inalde-text">{n.descripcion}</span>
                </div>
                {esSugerido && (
                  <span className="absolute -top-2 right-2 text-[8px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded bg-inalde-blue text-white">
                    IA sugiere
                  </span>
                )}
              </button>
            );
          })}
      </div>

      {/* Justificación de la IA */}
      {trait && (
        <div
          className={`mt-3 rounded px-3 py-2 text-xs ${
            revision ? 'bg-red-50 border border-red-200' : 'bg-inalde-gray-bg'
          }`}
        >
          <p
            className={`font-primary font-bold uppercase tracking-wider text-[10px] mb-1 ${
              revision ? 'text-inalde-red' : 'text-inalde-gray'
            }`}
          >
            Justificación IA · Sugiere {trait.puntaje}
            {revision && ' · Revisión obligatoria'}
          </p>
          <p className="text-inalde-text">{trait.razon}</p>
          {trait.evidencia && trait.evidencia.trim() && (
            <p className="text-inalde-gray mt-1">
              {trait.evidencia}
              {trait.ubicacion && <span className="italic"> «{trait.ubicacion}»</span>}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
