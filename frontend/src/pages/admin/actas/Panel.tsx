import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../../lib/api';
import { formatBackendError } from '../../../lib/errors';

// Actas de Grado — panel administrativo (dentro de /admin, sin Header propio).
// Una acta por participante (Formato Acta Proyecto de Grado MBA v3). El panel
// permite configurar el Director MBA, generar/enviar/archivar las actas, ver el
// avance de firmas y crear enlaces de microformulario para los directores de
// Caso / Proyecto de Investigación que aún no han fijado sus jurados.

type Modalidad = 'business_plan' | 'caso' | 'proyecto_investigacion';
type Estado =
  | 'faltan_datos'
  | 'generada'
  | 'enviada'
  | 'en_firmas_internas'
  | 'lista_para_cierre'
  | 'completa'
  | 'archivada';

interface FirmaResumen { rol: string; nombre: string; estado: string; }
interface Acta {
  id: string;
  nombre_participante: string;
  modalidad: Modalidad;
  nombre_proyecto: string;
  estado: Estado;
  firmas: FirmaResumen[];
  faltan: string[];
  proyecto_id?: string;
  equipo_id?: string;
}
interface Firmante { rol: string; nombre: string; total: number; firmadas: number; }
interface MicroPendiente { token: string; proyecto_id: string; director_nombre: string; }
interface Tiles {
  total: number;
  business_plan: number;
  caso: number;
  proyecto_investigacion: number;
  faltan_datos: number;
  firmadas_participante: number;
  firmas_internas_completas: number;
  completas: number;
}
interface Data {
  cohorte_id: string;
  etiqueta: string;
  director_mba: { nombre: string; cargo: string };
  tiles: Tiles;
  actas: Acta[];
  firmantes: Firmante[];
  microformularios_pendientes: MicroPendiente[];
  proveedor_firma: { nombre: string; es_stub: boolean };
}
interface Cohorte { id: string; etiqueta: string; activa: boolean; }

const MODALIDAD: Record<Modalidad, { corto: string; largo: string; pill: string }> = {
  business_plan: { corto: 'BP', largo: 'Business Plan', pill: 'bg-inalde-text text-white' },
  caso: { corto: 'Caso', largo: 'Caso', pill: 'bg-inalde-blue text-white' },
  proyecto_investigacion: { corto: 'PI', largo: 'Proyecto de Investigación', pill: 'bg-purple-700 text-white' },
};

const ESTADO: Record<Estado, { label: string; chip: string }> = {
  faltan_datos: { label: 'Faltan datos', chip: 'bg-red-100 text-inalde-red' },
  generada: { label: 'Generada', chip: 'bg-inalde-gray-bg text-inalde-gray' },
  enviada: { label: 'Enviada', chip: 'bg-blue-50 text-inalde-blue' },
  en_firmas_internas: { label: 'En firmas internas', chip: 'bg-amber-50 text-inalde-gold' },
  lista_para_cierre: { label: 'Lista para cierre', chip: 'bg-blue-100 text-inalde-blue' },
  completa: { label: 'Completa', chip: 'bg-green-100 text-green-800' },
  archivada: { label: 'Archivada', chip: 'bg-inalde-gray-light text-inalde-gray' },
};

function Tile({ label, valor, sub, acento }: { label: string; valor: number; sub?: string; acento?: boolean }) {
  return (
    <div className={`rounded-lg border-2 p-4 bg-white ${acento ? 'border-inalde-red' : 'border-inalde-gray-light'}`}>
      <p className="font-primary font-bold text-3xl text-inalde-text tabular-nums leading-none">{valor}</p>
      <p className="text-[0.7rem] uppercase tracking-wider font-semibold text-inalde-gray mt-2">{label}</p>
      {sub && <p className="text-[0.7rem] text-inalde-gray mt-1">{sub}</p>}
    </div>
  );
}

// Fila para crear el enlace de microformulario de un acta Caso/PI sin jurados.
function MicroGenerarRow({ acta, cohorteId, onError }: { acta: Acta; cohorteId: string; onError: (m: string) => void }) {
  const [nombre, setNombre] = useState('');
  const [email, setEmail] = useState('');
  const [enlace, setEnlace] = useState('');
  const [generando, setGenerando] = useState(false);
  const [copiado, setCopiado] = useState(false);

  async function generar() {
    if (!nombre.trim() || !email.trim()) return;
    setGenerando(true);
    onError('');
    try {
      const r = await api.post('/actas/micro/generar', {
        cohorte_id: cohorteId,
        proyecto_id: acta.proyecto_id,
        equipo_id: acta.equipo_id,
        director_nombre: nombre.trim(),
        director_email: email.trim(),
      });
      setEnlace(r.data?.enlace ?? '');
    } catch (e) {
      onError(formatBackendError(e));
    } finally {
      setGenerando(false);
    }
  }

  async function copiar() {
    try { await navigator.clipboard.writeText(enlace); setCopiado(true); setTimeout(() => setCopiado(false), 1800); } catch { /* noop */ }
  }

  return (
    <div className="border-b border-inalde-gray-light py-3 last:border-b-0">
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <span className={`text-[9px] uppercase tracking-wider font-bold px-2 py-0.5 rounded ${MODALIDAD[acta.modalidad].pill}`}>
          {MODALIDAD[acta.modalidad].corto}
        </span>
        <span className="font-primary font-bold text-sm text-inalde-text">{acta.nombre_participante}</span>
        <span className="text-xs text-inalde-gray">· {acta.nombre_proyecto}</span>
      </div>
      {!enlace ? (
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex-1 min-w-[180px]">
            <label className="block text-[0.65rem] uppercase tracking-wider font-semibold text-inalde-gray mb-1">Director del proyecto</label>
            <input className="input-inalde !py-2 !text-sm" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nombre del director" />
          </div>
          <div className="flex-1 min-w-[180px]">
            <label className="block text-[0.65rem] uppercase tracking-wider font-semibold text-inalde-gray mb-1">Correo del director</label>
            <input className="input-inalde !py-2 !text-sm" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="correo@ejemplo.com" />
          </div>
          <button type="button" className="btn-inalde-secondary" onClick={generar} disabled={generando || !nombre.trim() || !email.trim()}>
            {generando ? 'Creando…' : 'Crear enlace microformulario'}
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2 rounded bg-inalde-gray-bg px-3 py-2">
          <code className="text-xs text-inalde-blue break-all flex-1 min-w-[200px]">{enlace}</code>
          <button type="button" className="btn-inalde-ghost" onClick={copiar}>{copiado ? '✓ Copiado' : 'Copiar'}</button>
        </div>
      )}
    </div>
  );
}

export default function ActasPanel() {
  const [cohortes, setCohortes] = useState<Cohorte[]>([]);
  const [cohorte, setCohorte] = useState('');
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [okMsg, setOkMsg] = useState('');
  const [accion, setAccion] = useState('');

  // Config Director MBA (editable).
  const [mbaNombre, setMbaNombre] = useState('');
  const [mbaCargo, setMbaCargo] = useState('');
  const [guardandoMba, setGuardandoMba] = useState(false);

  useEffect(() => { (async () => {
    try {
      const r = await api.get('/admin/cohortes');
      const activas = (r.data as Cohorte[]).filter((c) => c.activa);
      setCohortes(activas);
      if (activas[0]) setCohorte(activas[0].id);
    } catch { /* noop */ }
  })(); }, []);

  const cargar = useCallback(async () => {
    if (!cohorte) return;
    setLoading(true); setErr(''); setData(null);
    try {
      const r = await api.get('/actas', { params: { cohorte_id: cohorte } });
      const d = r.data as Data;
      setData(d);
      setMbaNombre(d.director_mba?.nombre ?? '');
      setMbaCargo(d.director_mba?.cargo ?? '');
    } catch (e) {
      setErr(formatBackendError(e));
    } finally {
      setLoading(false);
    }
  }, [cohorte]);

  useEffect(() => { void cargar(); }, [cargar]);

  async function guardarMba() {
    if (!cohorte) return;
    setGuardandoMba(true); setErr(''); setOkMsg('');
    try {
      await api.post(`/actas/cohorte/${cohorte}/director-mba`, { nombre: mbaNombre.trim(), cargo: mbaCargo.trim() });
      setOkMsg('Director MBA actualizado.');
      await cargar();
    } catch (e) {
      setErr(formatBackendError(e));
    } finally {
      setGuardandoMba(false);
    }
  }

  async function correr(nombre: string, fn: () => Promise<void>, exito: string) {
    setAccion(nombre); setErr(''); setOkMsg('');
    try { await fn(); setOkMsg(exito); await cargar(); }
    catch (e) { setErr(formatBackendError(e)); }
    finally { setAccion(''); }
  }

  const generar = () => correr('generar', () => api.post(`/actas/generar/${cohorte}`).then(() => {}), 'Actas generadas/actualizadas.');
  const enviar = () => correr('enviar', () => api.post(`/actas/${cohorte}/enviar`).then(() => {}), 'Actas enviadas a firma.');
  const archivar = () => correr('archivar', () => api.post(`/actas/${cohorte}/archivar`).then(() => {}), 'Actas completas archivadas.');

  const pendientesJurados = data?.actas.filter((a) => a.modalidad !== 'business_plan' && a.estado === 'faltan_datos') ?? [];

  return (
    <>
      <div className="border-b-[3px] border-inalde-red pb-5 mb-6">
        <p className="section-subtitle mb-2">Actas de grado</p>
        <h1 className="section-title">Actas de Proyecto de Grado MBA</h1>
        <p className="text-sm text-inalde-gray mt-2">
          Una acta por participante (Formato v3). Genera las actas, configura el Director MBA, envíalas a firma y sigue el avance de la cadena de firmas.
        </p>
      </div>

      {/* Selector de cohorte */}
      <div className="flex flex-wrap items-end gap-3 mb-6">
        <div className="max-w-xs flex-1">
          <label className="block font-primary font-semibold text-xs tracking-wider uppercase text-inalde-gray mb-1">Cohorte activa</label>
          <select value={cohorte} onChange={(e) => setCohorte(e.target.value)} className="input-inalde">
            {cohortes.map((c) => <option key={c.id} value={c.id}>{c.etiqueta}</option>)}
          </select>
        </div>
        {data && <span className="text-sm text-inalde-gray"><strong className="text-inalde-red text-lg">{data.tiles.total}</strong> actas · {data.etiqueta}</span>}
      </div>

      {err && <div className="mb-6 rounded border-l-4 border-inalde-red bg-red-50 px-4 py-3 text-sm whitespace-pre-wrap">{err}</div>}
      {okMsg && <div className="mb-6 rounded border-l-4 border-green-600 bg-green-50 px-4 py-3 text-sm text-green-800">{okMsg}</div>}

      {loading && <p className="text-inalde-gray text-sm">Cargando…</p>}

      {data && (
        <div className="flex flex-col gap-8">
          {/* Aviso de proveedor de firma en modo simulación */}
          {data.proveedor_firma.es_stub && (
            <div className="rounded border-l-4 border-inalde-gold bg-amber-50 px-4 py-3 text-sm text-inalde-text">
              <strong>Proveedor de firma no configurado</strong> — flujo en modo simulación. Las firmas se registran en el sistema pero no se envían a un proveedor real ({data.proveedor_firma.nombre}).
            </div>
          )}

          {/* Tiles */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
            <Tile label="Total de actas" valor={data.tiles.total} sub={`BP ${data.tiles.business_plan} · Caso ${data.tiles.caso} · PI ${data.tiles.proyecto_investigacion}`} acento />
            <Tile label="Faltan datos" valor={data.tiles.faltan_datos} />
            <Tile label="Firmadas por participante" valor={data.tiles.firmadas_participante} />
            <Tile label="Firmas internas completas" valor={data.tiles.firmas_internas_completas} />
            <Tile label="Completas" valor={data.tiles.completas} />
          </div>

          {/* Acciones + Config Director MBA */}
          <div className="grid lg:grid-cols-2 gap-6">
            <div className="card-inalde p-5">
              <h2 className="font-primary font-bold text-sm uppercase tracking-widest text-inalde-red mb-4">Config Director MBA</h2>
              <p className="text-xs text-inalde-gray mb-4">Firma el cierre de todas las actas de la cohorte.</p>
              <div className="grid sm:grid-cols-2 gap-3 mb-3">
                <div>
                  <label className="block text-[0.65rem] uppercase tracking-wider font-semibold text-inalde-gray mb-1">Nombre</label>
                  <input className="input-inalde !py-2 !text-sm" value={mbaNombre} onChange={(e) => setMbaNombre(e.target.value)} placeholder="Nombre del Director MBA" />
                </div>
                <div>
                  <label className="block text-[0.65rem] uppercase tracking-wider font-semibold text-inalde-gray mb-1">Cargo</label>
                  <input className="input-inalde !py-2 !text-sm" value={mbaCargo} onChange={(e) => setMbaCargo(e.target.value)} placeholder="Director del MBA" />
                </div>
              </div>
              <button type="button" className="btn-inalde-secondary" onClick={guardarMba} disabled={guardandoMba || !mbaNombre.trim() || !mbaCargo.trim()}>
                {guardandoMba ? 'Guardando…' : 'Guardar Director MBA'}
              </button>
            </div>

            <div className="card-inalde p-5">
              <h2 className="font-primary font-bold text-sm uppercase tracking-widest text-inalde-red mb-4">Acciones de la cohorte</h2>
              <div className="flex flex-wrap gap-3">
                <button type="button" className="btn-inalde-primary" onClick={generar} disabled={!!accion}>
                  {accion === 'generar' ? 'Generando…' : 'Generar/actualizar actas'}
                </button>
                <button type="button" className="btn-inalde-secondary" onClick={enviar} disabled={!!accion}>
                  {accion === 'enviar' ? 'Enviando…' : 'Enviar a firma'}
                </button>
                <Link to="/admin/actas/lote" className="btn-inalde-secondary">Ir a firma en lote →</Link>
                <button type="button" className="btn-inalde-ghost" onClick={archivar} disabled={!!accion}>
                  {accion === 'archivar' ? 'Archivando…' : 'Archivar completas'}
                </button>
              </div>
            </div>
          </div>

          {/* Avance por firmante */}
          {data.firmantes.length > 0 && (
            <section>
              <h2 className="font-primary font-bold text-sm uppercase tracking-widest text-inalde-red mb-4 pb-2 border-b border-inalde-gray-light">Avance por firmante</h2>
              <div className="grid sm:grid-cols-2 gap-4">
                {data.firmantes.map((f, i) => {
                  const pct = f.total > 0 ? Math.round((f.firmadas / f.total) * 100) : 0;
                  return (
                    <div key={i} className="card-inalde p-4">
                      <div className="flex items-baseline justify-between gap-2 mb-2">
                        <div className="min-w-0">
                          <p className="text-[0.65rem] uppercase tracking-wider font-semibold text-inalde-gray">{f.rol}</p>
                          <p className="font-primary font-bold text-sm text-inalde-text truncate">{f.nombre}</p>
                        </div>
                        <span className="font-primary font-bold text-sm text-inalde-text tabular-nums shrink-0">{f.firmadas}/{f.total}</span>
                      </div>
                      <div className="h-2 rounded-full bg-inalde-gray-light overflow-hidden">
                        <div className="h-full bg-inalde-red transition-all" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* Tabla de actas */}
          <section>
            <h2 className="font-primary font-bold text-sm uppercase tracking-widest text-inalde-red mb-4 pb-2 border-b border-inalde-gray-light">Actas de la cohorte</h2>
            {data.actas.length === 0 ? (
              <p className="text-inalde-gray text-sm">Aún no hay actas. Usa «Generar/actualizar actas».</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[820px] border-collapse bg-white">
                  <thead>
                    <tr className="bg-inalde-text text-white">
                      {['Participante', 'Modalidad', 'Proyecto', 'Estado', 'Firmas', ''].map((h, i) => (
                        <th key={i} className="text-left font-primary font-bold text-[0.68rem] tracking-widest uppercase px-3 py-2.5 whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.actas.map((a) => {
                      const firmadas = a.firmas.filter((s) => s.estado === 'firmada').length;
                      return (
                        <tr key={a.id} className="border-b border-inalde-gray-light align-top">
                          <td className="px-3 py-3 font-primary font-bold text-sm text-inalde-text">{a.nombre_participante}</td>
                          <td className="px-3 py-3">
                            <span className={`inline-block text-[9px] uppercase tracking-wider font-bold px-2 py-0.5 rounded ${MODALIDAD[a.modalidad].pill}`} title={MODALIDAD[a.modalidad].largo}>
                              {MODALIDAD[a.modalidad].corto}
                            </span>
                          </td>
                          <td className="px-3 py-3 text-[0.8rem] text-inalde-gray max-w-[220px]">{a.nombre_proyecto || '—'}</td>
                          <td className="px-3 py-3">
                            <span className={`inline-block text-[9px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded ${ESTADO[a.estado].chip}`}>{ESTADO[a.estado].label}</span>
                            {a.faltan.length > 0 && (
                              <p className="text-[10px] text-inalde-red mt-1" title={a.faltan.join(', ')}>Falta: {a.faltan.join(', ')}</p>
                            )}
                          </td>
                          <td className="px-3 py-3 text-sm text-inalde-text tabular-nums">{firmadas}/{a.firmas.length}</td>
                          <td className="px-3 py-3 text-right whitespace-nowrap">
                            <Link to={`/admin/actas/${a.id}`} className="text-[10px] uppercase tracking-wider font-semibold text-inalde-red hover:text-inalde-red-hover">Ver acta →</Link>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Pendientes de datos — Caso/PI sin jurados */}
          {(pendientesJurados.length > 0 || data.microformularios_pendientes.length > 0) && (
            <section>
              <h2 className="font-primary font-bold text-sm uppercase tracking-widest text-inalde-red mb-4 pb-2 border-b border-inalde-gray-light">Pendientes de datos — Caso/PI sin jurados</h2>
              <p className="text-xs text-inalde-gray mb-4">Crea un enlace de microformulario para que el director del proyecto registre la fecha de sustentación, los jurados y el resultado.</p>

              {pendientesJurados.length > 0 && (
                <div className="card-inalde p-5 mb-5">
                  {pendientesJurados.map((a) => (
                    <MicroGenerarRow key={a.id} acta={a} cohorteId={cohorte} onError={setErr} />
                  ))}
                </div>
              )}

              {data.microformularios_pendientes.length > 0 && (
                <div>
                  <p className="text-[0.7rem] uppercase tracking-wider font-semibold text-inalde-gray mb-2">Microformularios ya enviados y pendientes de diligenciar</p>
                  <ul className="flex flex-col gap-1">
                    {data.microformularios_pendientes.map((m) => (
                      <li key={m.token} className="text-sm text-inalde-gray flex items-center gap-2">
                        <span className="text-inalde-blue">●</span>
                        {m.director_nombre} <span className="text-inalde-gray/70">· token {m.token.slice(0, 8)}…</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          )}
        </div>
      )}

      <div className="mt-10 pt-6 border-t border-inalde-gray-light">
        <Link to="/admin" className="text-xs text-inalde-gray hover:text-inalde-red">← Volver al panel administrativo</Link>
      </div>
    </>
  );
}
