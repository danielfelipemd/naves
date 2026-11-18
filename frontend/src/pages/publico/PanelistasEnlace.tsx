import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { Modal } from '../../components/inalde/Modal';
import { VisorArchivo } from '../../components/inalde/VisorArchivo';

// Enlace compartido de panelistas (sql/55). Lo que hacía el sitio alterno
// (navesfs.netlify.app/panelistas): la programación por bloques con logo,
// resumen y One Pager; «asistir a todas» o bloque por bloque; nombre, correo y
// logística. Sin sesión: el enlace es el permiso, y lo activa el super admin
// en Panelistas con fecha de vencimiento.

type Fila =
  | { tipo: 'actividad'; desc: string; hora_inicio: string; hora_fin: string }
  | {
      tipo: 'proyecto'; slot: number; hora_inicio: string; hora_fin: string;
      proyecto_id: string; proyecto: string; autores: string; resumen: string | null;
      tiene_logo: boolean; tiene_one_pager: boolean; one_pager_imagen: boolean;
    };
interface Bloque { numero: number; hora_inicio: string; hora_fin: string; primer_slot: number; ultimo_slot: number; presentaciones: number; filas: Fila[] }
interface Jornada { numero: number; fecha: string; fecha_legible: string; bloques: Bloque[] }
interface Datos { cohorte: string; evento_nombre: string; vence_at: string | null; jornadas: Jornada[] }

const clave = (j: number, b: number) => `${j}-${b}`;
const MOTIVO: Record<string, string> = {
  ENLACE_INVALIDO: 'Este enlace no existe o fue reemplazado por uno nuevo.',
  ENLACE_INACTIVO: 'Este enlace está desactivado por el momento.',
  ENLACE_VENCIDO: 'El plazo para confirmar por este enlace ya terminó.',
};
// Qué le decimos al panelista si su confirmación no entra, por código y no por texto.
function mensajeDeConfirmacion(e: any): string {
  const codigo = e?.response?.data?.error as string | undefined;
  const st = e?.response?.status as number | undefined;
  if (codigo === 'BLOQUE_INEXISTENTE') return 'La programación cambió mientras elegía. Recargue la página y vuelva a marcar sus bloques.';
  if (codigo && MOTIVO[codigo]) return MOTIVO[codigo];
  if (st === 429) return 'Hubo demasiados intentos desde esta red. Espere unos minutos y vuelva a intentarlo.';
  if (st === 400) return 'Revise los datos: el nombre y el correo son obligatorios.';
  return 'No pudimos registrar su confirmación. Revise su conexión e inténtelo de nuevo.';
}
function venceLegible(iso: string) {
  return new Date(iso).toLocaleString('es-CO', { timeZone: 'America/Bogota', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' });
}

export default function PanelistasEnlace() {
  const { token = '' } = useParams();
  const base = `/api/panelistas-enlace/p/${token}`;
  const [datos, setDatos] = useState<Datos | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elegidos, setElegidos] = useState<Set<string>>(new Set());
  const [todas, setTodas] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [hecho, setHecho] = useState<string | null>(null);   // correo al que se envió la confirmación
  const [visor, setVisor] = useState<{ url: string; descarga: string; titulo: string; imagen: boolean } | null>(null);

  useEffect(() => {
    (async () => {
      try { setDatos((await api.get(`/panelistas-enlace/p/${token}`)).data); }
      catch (e: any) {
        const codigo = e?.response?.data?.error as string | undefined;
        setError(MOTIVO[codigo ?? ''] ?? 'No pudimos cargar la programación. Revise su conexión y recargue la página.');
      }
    })();
  }, [token]);

  const totales = useMemo(() => {
    const js = datos?.jornadas ?? [];
    return {
      jornadas: js.length,
      bloques: js.reduce((n, j) => n + j.bloques.length, 0),
      presentaciones: js.reduce((n, j) => n + j.bloques.reduce((m, b) => m + b.presentaciones, 0), 0),
    };
  }, [datos]);

  function alternar(j: number, b: number) {
    setTodas(false);
    setElegidos((s) => { const n = new Set(s); const k = clave(j, b); n.has(k) ? n.delete(k) : n.add(k); return n; });
  }
  function asistirATodas() { setTodas(true); setElegidos(new Set()); setConfirmando(true); }

  const nSeleccion = todas ? totales.bloques : elegidos.size;

  // El botón del One Pager va a la derecha en pantallas anchas y debajo del
  // resumen en el celular: a 390 px, a la derecha dejaba el resumen en ~170 px.
  function renderBotonOnePager(f: Extract<Fila, { tipo: 'proyecto' }>, clases: string) {
    return (
      <button onClick={() => setVisor({
        url: `${base}/archivo/${f.proyecto_id}/one-pager`,
        descarga: `${base}/archivo/${f.proyecto_id}/one-pager?descargar=1`,
        titulo: `One Pager · ${f.proyecto}`, imagen: f.one_pager_imagen,
      })}
        aria-label={`Ver el One Pager de ${f.proyecto}`}
        className={`${clases} font-primary font-bold text-[0.65rem] tracking-wider uppercase border border-inalde-red text-inalde-red px-2.5 py-1.5 rounded-[3px] hover:bg-inalde-red hover:text-white transition-colors whitespace-nowrap`}>
        ⬇ One Pager
      </button>
    );
  }

  // Qué se ve: el error, la carga, la confirmación hecha o la programación.
  function renderContenido() {
    if (error) return (
            <div role="alert" className="bg-white rounded-lg shadow-inalde-card p-6 border-l-4 border-inalde-red">
              <h1 className="font-primary font-bold text-lg mb-1">No pudimos abrir la programación</h1>
              <p className="text-sm text-inalde-gray">{error}</p>
              <p className="text-sm text-inalde-gray mt-2">Si cree que es un error, escríbale al coordinador del programa para que le comparta el enlace vigente.</p>
            </div>
    );
    if (!datos) return <p className="text-inalde-gray">Cargando la programación…</p>;
    if (hecho) return (
            <div role="status" className="bg-white rounded-lg shadow-inalde-card p-6 sm:p-8 border-l-4 border-inalde-blue">
              <h1 className="section-title mb-2">¡Confirmación recibida!</h1>
              <p className="text-sm text-inalde-text">Gracias. Le enviamos un correo a <strong>{hecho}</strong> con los bloques que eligió y su logística.</p>
              <p className="text-sm text-inalde-gray mt-2">Si algo cambia, vuelva a este mismo enlace y confirme de nuevo con el mismo correo.</p>
              <button onClick={() => { setHecho(null); setElegidos(new Set()); setTodas(false); }} className="btn-inalde-secondary !py-2 !px-4 !text-xs mt-4">Volver a la programación</button>
            </div>
    );
    return (
            <>
              <section className="bg-white rounded-lg shadow-inalde-card p-6 sm:p-8 mb-6">
                <div className="border-b-[3px] border-inalde-red pb-4 mb-4">
                  <p className="section-subtitle mb-1">Guía para panelistas</p>
                  <h1 className="section-title">Programación de presentaciones</h1>
                </div>
                <p className="text-sm text-inalde-text">Estimado panelista: a continuación encontrará los proyectos organizados por jornada y bloque. Puede revisar el resumen y abrir o descargar el One Pager de cada emprendimiento.</p>
                <p className="text-sm text-inalde-text mt-2">Para confirmar su asistencia, pulse <strong>«Quiero asistir a este bloque»</strong> en los bloques que le interesen y después <strong>«Confirmar asistencia»</strong>: le pediremos su nombre, su correo y su logística.</p>
                {datos.vence_at && <p className="text-xs text-inalde-gray mt-3">Este enlace funciona hasta el {venceLegible(datos.vence_at)}</p>}

                <div className="mt-5 flex flex-wrap gap-3 items-center">
                  <button onClick={asistirATodas} className="btn-inalde-primary !py-2.5 !px-5 !text-xs">✋ Quiero asistir a todas las jornadas</button>
                  <a href={`${base}/one-pagers.zip`} className="btn-inalde-secondary !py-2.5 !px-5 !text-xs">⬇ Descargar todos los One Pager (ZIP)</a>
                </div>
                <p className="text-xs text-inalde-gray mt-2">{totales.jornadas} jornada{totales.jornadas === 1 ? '' : 's'} · {totales.bloques} bloques · {totales.presentaciones} presentaciones</p>
              </section>

              {datos.jornadas.map((j) => (
                <section key={j.numero} className="mb-8">
                  <h2 className="font-primary font-extrabold text-inalde-text text-lg mb-3">
                    Jornada {j.numero} <span className="font-normal text-inalde-gray">· <span className="inline-block first-letter:uppercase">{j.fecha_legible}</span></span>
                  </h2>
                  {j.bloques.map((b) => {
                    const elegido = todas || elegidos.has(clave(j.numero, b.numero));
                    return (
                      <article key={b.numero} className={`bg-white rounded-lg shadow-inalde-card mb-4 overflow-hidden border-2 ${elegido ? 'border-inalde-blue' : 'border-transparent'}`}>
                        <div className="bg-inalde-text text-white px-5 py-3 flex flex-wrap items-center gap-x-4 gap-y-1">
                          <span className="font-primary font-extrabold tracking-widest uppercase text-sm text-inalde-red bg-white/5 border border-inalde-red/60 rounded px-2 py-0.5">Bloque {b.numero}</span>
                          <span className="font-mono text-sm">{b.hora_inicio} – {b.hora_fin}</span>
                          <span className="ml-auto text-[11px] uppercase tracking-wider text-white/60">{b.presentaciones} {b.presentaciones === 1 ? 'presentación' : 'presentaciones'}</span>
                        </div>
                        <ul>
                          {b.filas.map((f, i) => f.tipo === 'actividad' ? (
                            <li key={`a${i}`} className="bg-[#FFE066]/70 border-l-4 border-inalde-red px-4 py-2 text-sm">
                              <span className="font-mono font-semibold">{f.hora_inicio} – {f.hora_fin}</span> · <strong>{f.desc}</strong>
                            </li>
                          ) : (
                            <li key={f.proyecto_id} className="px-4 py-3 border-b border-inalde-gray-light last:border-b-0 flex gap-3 sm:gap-4">
                              <div className="w-10 shrink-0 text-center">
                                <div className="font-primary font-bold text-lg text-inalde-gray">{f.slot}</div>
                                <div className="text-[11px] font-mono text-inalde-gray">{f.hora_inicio}</div>
                              </div>
                              {f.tiene_logo ? (
                                <img src={`${base}/archivo/${f.proyecto_id}/miniatura`} alt={`Logo de ${f.proyecto}`} loading="lazy"
                                  className="hidden sm:block w-14 h-10 object-contain border border-inalde-gray-light rounded bg-white shrink-0" />
                              ) : <div className="hidden sm:block w-14 shrink-0" />}
                              <div className="flex-1 min-w-0">
                                <h3 className="font-primary font-bold text-inalde-text">{f.proyecto}</h3>
                                {f.autores && <p className="text-xs text-inalde-gray">{f.autores}</p>}
                                {f.resumen && <p className="text-sm text-inalde-text mt-1 leading-relaxed">{f.resumen}</p>}
                                {f.tiene_one_pager && renderBotonOnePager(f, 'sm:hidden inline-block mt-2')}
                              </div>
                              {f.tiene_one_pager && renderBotonOnePager(f, 'hidden sm:inline-block self-start shrink-0')}
                            </li>
                          ))}
                        </ul>
                        <div className="bg-inalde-gray-bg/60 px-5 py-3">
                          <button onClick={() => alternar(j.numero, b.numero)} aria-pressed={elegido}
                            className={`font-primary font-bold text-xs tracking-wider uppercase px-4 py-2.5 rounded transition-colors ${elegido ? 'bg-inalde-blue text-white' : 'bg-inalde-red text-white hover:bg-inalde-text'}`}>
                            {elegido ? '✓ Asistiré a este bloque · quitar' : '✋ Quiero asistir a este bloque'}
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </section>
              ))}
            </>
    );
  }


  return (
    <div className="min-h-screen bg-inalde-gray-bg/40 pb-28">
      <header className="bg-inalde-text text-white py-5 px-4">
        <div className="max-w-[960px] mx-auto">
          <p className="text-[11px] uppercase tracking-[2px] text-white/60">Panel de Evaluación · NAVES</p>
          <p className="text-lg font-primary font-bold">INALDE Business School — Executive MBA</p>
          {datos && <p className="text-sm text-white/70 mt-0.5">{datos.evento_nombre || 'Presentaciones NAVES'} · {datos.cohorte}</p>}
        </div>
      </header>

      <main className="max-w-[960px] mx-auto px-4 py-8">
        {renderContenido()}
      </main>

      {/* Barra fija con la selección: el panelista elige varios bloques y
          confirma una sola vez (en el alterno se confirmaba bloque por bloque,
          escribiendo nombre y correo cada vez). */}
      {datos && !hecho && !error && nSeleccion > 0 && !confirmando && (
        <div className="fixed bottom-0 inset-x-0 z-40 bg-white border-t-[3px] border-inalde-red shadow-[0_-4px_16px_rgba(0,0,0,0.12)]">
          <div className="max-w-[960px] mx-auto px-4 py-3 flex flex-wrap items-center gap-3">
            <p className="text-sm text-inalde-text"><strong>{todas ? 'Todas las jornadas' : `${nSeleccion} bloque${nSeleccion === 1 ? '' : 's'} seleccionado${nSeleccion === 1 ? '' : 's'}`}</strong></p>
            <button onClick={() => setConfirmando(true)} className="btn-inalde-primary !py-2.5 !px-5 !text-xs ml-auto">Confirmar asistencia →</button>
          </div>
        </div>
      )}

      {confirmando && datos && (
        <FormularioConfirmacion
          token={token} datos={datos} todas={todas} elegidos={elegidos}
          onClose={() => { setConfirmando(false); if (todas && !elegidos.size) setTodas(false); }}
          onHecho={(email) => { setConfirmando(false); setHecho(email); window.scrollTo({ top: 0, behavior: 'instant' }); }}
        />
      )}

      {visor && <VisorArchivo url={visor.url} urlDescarga={visor.descarga} imagen={visor.imagen} titulo={visor.titulo} onClose={() => setVisor(null)} />}
    </div>
  );
}

// ---- Confirmación: nombre, correo y logística en un solo paso ----
function FormularioConfirmacion({ token, datos, todas, elegidos, onClose, onHecho }: {
  token: string; datos: Datos; todas: boolean; elegidos: Set<string>;
  onClose: () => void; onHecho: (email: string) => void;
}) {
  // Los días que tocan: los de los bloques elegidos (o todos).
  const dias = datos.jornadas.filter((j) => todas || j.bloques.some((b) => elegidos.has(clave(j.numero, b.numero))));
  const [nombre, setNombre] = useState('');
  const [email, setEmail] = useState('');
  const [transporte, setTransporte] = useState<'si' | 'no' | ''>('');
  const [diasTransporte, setDiasTransporte] = useState<Record<string, boolean>>(() => Object.fromEntries(dias.map((d) => [d.fecha, true])));
  const [direccion, setDireccion] = useState('');
  const [hora, setHora] = useState('');
  // Ida y regreso se preguntan por separado (Daniel, 18/11/2026).
  const [ida, setIda] = useState(false);
  const [regreso, setRegreso] = useState(false);
  const [dirRegreso, setDirRegreso] = useState('');
  const [horaRegreso, setHoraRegreso] = useState('');
  // Sin marcar por defecto: el panelista confirma él si desayuna o almuerza
  // con INALDE (Daniel, 18/11/2026); de esto sale cuántos platos se piden.
  const [desayuno, setDesayuno] = useState<Record<string, boolean>>({});
  const [almuerzo, setAlmuerzo] = useState<Record<string, boolean>>({});
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  async function enviar() {
    setAviso(null);
    if (nombre.trim().length < 2) { setAviso('Escriba su nombre completo.'); return; }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) { setAviso('Escriba un correo válido: ahí le llegará la confirmación.'); return; }
    if (!transporte) { setAviso('Indique si necesita que lo recojamos.'); return; }
    if (transporte === 'si' && !ida && !regreso) { setAviso('Marque si necesita transporte de ida, de regreso o ambos.'); return; }
    if (transporte === 'si' && ida && !direccion.trim()) { setAviso('Escriba la dirección de recogida.'); return; }
    if (transporte === 'si' && regreso && !ida && !dirRegreso.trim()) { setAviso('Escriba a dónde lo llevamos de regreso.'); return; }
    setEnviando(true);
    const bloques = todas ? [] : [...elegidos].map((k) => { const [j, b] = k.split('-').map(Number); return { jornada: j, bloque: b }; });
    try {
      await api.post(`/panelistas-enlace/p/${token}/confirmar`, {
        nombre: nombre.trim(), email: email.trim(), todas, bloques,
        logistica: {
          necesita_transporte: transporte === 'si',
          transporte_ida: transporte === 'si' ? ida : null,
          transporte_regreso: transporte === 'si' ? regreso : null,
          direccion_recogida: transporte === 'si' && ida ? direccion.trim() : null,
          hora_recogida: transporte === 'si' && ida && hora ? hora : null,
          direccion_regreso: transporte === 'si' && regreso ? (dirRegreso.trim() || null) : null,
          hora_regreso: transporte === 'si' && regreso && horaRegreso ? horaRegreso : null,
          transporte_por_fecha: transporte === 'si' ? diasTransporte : {},
          desayuno_por_fecha: desayuno,
          almuerzo_por_fecha: almuerzo,
        },
      }, { timeout: 30000 });
      onHecho(email.trim());
    } catch (e: any) {
      setAviso(mensajeDeConfirmacion(e));
      setEnviando(false);
    }
  }

  const casilla = 'flex items-center gap-2 text-sm py-0.5';
  const etiqueta = 'block text-xs uppercase tracking-wider text-inalde-gray mb-1.5 font-semibold';
  return (
    <Modal open onClose={enviando ? () => {} : onClose} title="Confirmar asistencia" subtitle="Coordine su visita" size="md"
      footer={<>
        <button onClick={onClose} disabled={enviando} className="btn-inalde-secondary !py-2 !px-4 !text-xs">Cancelar</button>
        <button onClick={enviar} disabled={enviando} className="btn-inalde-primary !py-2 !px-4 !text-xs disabled:opacity-60">{enviando ? 'Enviando…' : 'Confirmar'}</button>
      </>}>
      <div className="space-y-5">
        <div className="rounded bg-inalde-gray-bg/60 px-3 py-2 text-sm">
          {todas ? <>Asistirá a <strong>todas las jornadas</strong>.</> : (
            <ul className="space-y-0.5">
              {datos.jornadas.flatMap((j) => j.bloques.filter((b) => elegidos.has(clave(j.numero, b.numero)))
                .map((b) => <li key={clave(j.numero, b.numero)}>Jornada {j.numero} · Bloque {b.numero} · <span className="font-mono">{b.hora_inicio}–{b.hora_fin}</span></li>))}
            </ul>
          )}
        </div>

        <div className="grid sm:grid-cols-2 gap-3">
          <label className="block"><span className={etiqueta}>Nombre completo *</span>
            <input value={nombre} onChange={(e) => setNombre(e.target.value)} autoComplete="name" className="input-inalde !py-2" /></label>
          <label className="block"><span className={etiqueta}>Correo electrónico *</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="su@correo.com" className="input-inalde !py-2" /></label>
        </div>

        <fieldset>
          <legend className={etiqueta}>¿Necesita transporte? *</legend>
          <label className={casilla}><input type="radio" name="transporte" checked={transporte === 'si'} onChange={() => setTransporte('si')} /> Sí, necesito transporte</label>
          <label className={casilla}><input type="radio" name="transporte" checked={transporte === 'no'} onChange={() => setTransporte('no')} /> No, iré por mi cuenta</label>
          {transporte === 'si' && (
            <div className="mt-2 pl-6 space-y-2">
              {dias.length > 1 && (
                <div>
                  <span className="text-xs text-inalde-gray">¿Para cuáles días?</span>
                  {dias.map((d) => (
                    <label key={d.fecha} className={casilla}><input type="checkbox" checked={diasTransporte[d.fecha] ?? true}
                      onChange={(e) => setDiasTransporte({ ...diasTransporte, [d.fecha]: e.target.checked })} />
                      <span className="inline-block first-letter:uppercase">{d.fecha_legible}</span></label>
                  ))}
                </div>
              )}
              <div className="rounded border border-inalde-gray-light p-2.5 space-y-2">
                <label className={casilla + ' font-medium'}><input type="checkbox" checked={ida} onChange={(e) => setIda(e.target.checked)} /> Ida: que lo recojamos y lo llevemos a INALDE</label>
                {ida && (
                  <div className="pl-6 space-y-2">
                    <input value={direccion} onChange={(e) => setDireccion(e.target.value)} aria-label="Dirección de recogida" placeholder="Dirección de recogida. Ej.: Cra 15 #85-32, Bogotá" className="input-inalde !py-2" />
                    <label className="flex flex-wrap items-center gap-2 text-sm">Hora de recogida <input type="time" value={hora} onChange={(e) => setHora(e.target.value)} className="input-inalde !w-auto !py-1.5" /></label>
                  </div>
                )}
              </div>
              <div className="rounded border border-inalde-gray-light p-2.5 space-y-2">
                <label className={casilla + ' font-medium'}><input type="checkbox" checked={regreso} onChange={(e) => setRegreso(e.target.checked)} /> Regreso: que lo llevemos de INALDE a su destino</label>
                {regreso && (
                  <div className="pl-6 space-y-2">
                    <input value={dirRegreso} onChange={(e) => setDirRegreso(e.target.value)} aria-label="Dirección de destino del regreso"
                      placeholder={ida ? 'Destino (si lo deja vacío, la misma dirección de recogida)' : 'Dirección de destino. Ej.: Cra 15 #85-32, Bogotá'} className="input-inalde !py-2" />
                    <label className="flex flex-wrap items-center gap-2 text-sm">Hora de regreso <input type="time" value={horaRegreso} onChange={(e) => setHoraRegreso(e.target.value)} className="input-inalde !w-auto !py-1.5" /></label>
                    <p className="text-xs text-inalde-gray">Si no indica hora, lo llevamos al terminar su última sesión.</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </fieldset>

        <div className="grid sm:grid-cols-2 gap-4">
          <fieldset>
            <legend className={etiqueta}>¿Desayuna con INALDE?</legend>
            {dias.map((d) => (
              <label key={d.fecha} className={casilla}><input type="checkbox" checked={!!desayuno[d.fecha]} onChange={(e) => setDesayuno({ ...desayuno, [d.fecha]: e.target.checked })} />
                <span className="inline-block first-letter:uppercase">{d.fecha_legible}</span></label>
            ))}
          </fieldset>
          <fieldset>
            <legend className={etiqueta}>¿Almuerza con INALDE?</legend>
            {dias.map((d) => (
              <label key={d.fecha} className={casilla}><input type="checkbox" checked={!!almuerzo[d.fecha]} onChange={(e) => setAlmuerzo({ ...almuerzo, [d.fecha]: e.target.checked })} />
                <span className="inline-block first-letter:uppercase">{d.fecha_legible}</span></label>
            ))}
          </fieldset>
        </div>
        <p className="text-xs text-inalde-gray -mt-2">Marque solo los días en que desayunará o almorzará con nosotros.</p>

        {aviso && <p role="alert" className="text-sm text-inalde-red">{aviso}</p>}
      </div>
    </Modal>
  );
}
