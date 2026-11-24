import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../../lib/api';
import { formatBackendError } from '../../../lib/errors';
import { confirmar } from '../../../components/inalde/Dialogos';

// Actas de Grado — vista fiel del Acta v3 (dentro de /admin, sin Header propio).
// Renderiza el Formato de Acta Proyecto de Grado MBA (versión 3) con la cadena de
// firmas, la nota y las observaciones. Permite editar observaciones y fijar la nota.
//
// El super admin manda sobre el acta: pone él los datos que falten (jurados,
// fecha, proyecto, director, calificación del Caso), la abre antes de tiempo
// («Generar ahora») y la manda a firma cuando quiera («Enviar a firma»).

type Modalidad = 'business_plan' | 'caso' | 'proyecto_investigacion';
type Nota = 'aceptado' | 'rechazado' | null;
const ESCALA = ['A', 'B+', 'B', 'B-', 'C'] as const;
type Calificacion = (typeof ESCALA)[number];

interface Firma { rol: string; nombre: string; estado: string; fecha?: string | null; }
type Jurado = string | { nombre: string; email?: string };
interface Ajuste {
  nombre_proyecto?: string | null;
  fecha_sustentacion?: string | null;
  director_nombre?: string | null;
  director_email?: string | null;
  jurados?: { nombre: string; email?: string | null }[] | null;
  calificacion?: Calificacion | null;
  forzar?: boolean;
}
interface Acta {
  id: number;
  equipo_id: string | null;
  calificacion: Calificacion | null;
  ajuste_admin: Ajuste | null;
  cohorte_id: string;
  nombre_participante: string;
  nombre_proyecto: string;
  modalidad: Modalidad;
  fecha_sustentacion: string | null;
  lugar: string | null;
  director_nombre: string | null;
  jurados: Jurado[];
  nota: Nota;
  observaciones: string | null;
  director_mba_nombre: string | null;
  director_mba_cargo: string | null;
  firmas: Firma[];
  estado: string;
  faltan: string[];
}

const MODALIDADES: { key: Modalidad; label: string }[] = [
  { key: 'business_plan', label: 'Business Plan' },
  { key: 'caso', label: 'Caso' },
  { key: 'proyecto_investigacion', label: 'Proyecto de Investigación' },
];

function nombreJurado(j: Jurado): string {
  return typeof j === 'string' ? j : j.nombre;
}

/** AAAA-MM-DD de una fecha guardada, en hora de Bogotá, para un <input type="date">. */
function aInputFecha(f?: string | null): string {
  if (!f) return '';
  const d = new Date(f);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
}

function fmtFecha(f?: string | null): string {
  if (!f) return '—';
  const d = new Date(f);
  return isNaN(d.getTime()) ? f : d.toLocaleDateString('es-CO', { year: 'numeric', month: 'long', day: 'numeric' });
}

// Estado de una firma dentro del acta.
function FirmaEstado({ firma }: { firma?: Firma }) {
  if (firma && firma.estado === 'firmada') {
    return (
      <span className="text-xs text-green-700 font-semibold whitespace-nowrap">
        ✓ Firmada{firma.fecha ? ` · ${fmtFecha(firma.fecha)}` : ''}
      </span>
    );
  }
  return <span className="text-xs text-inalde-gray whitespace-nowrap">○ Pendiente</span>;
}

// Bloque de una línea de firma (nombre + cargo + estado).
function BloqueFirma({ titulo, nombre, cargo, firma }: { titulo: string; nombre?: string | null; cargo?: string | null; firma?: Firma }) {
  return (
    <div className="border-t-2 border-inalde-text pt-2 mt-8">
      <p className="text-[0.65rem] uppercase tracking-wider font-semibold text-inalde-gray">{titulo}</p>
      <div className="flex items-baseline justify-between gap-3 mt-1">
        <p className="font-primary font-bold text-sm text-inalde-text">{nombre || '—'}</p>
        <FirmaEstado firma={firma} />
      </div>
      {cargo && <p className="text-xs text-inalde-gray">{cargo}</p>}
    </div>
  );
}

interface JuradoForm { nombre: string; email: string }

/**
 * Lo que el super admin pone a mano. Se guarda como ajuste del acta y manda
 * sobre el cronograma y el microformulario del director.
 */
function EditarDatos({ acta, onGuardado, onCancelar }: { acta: Acta; onGuardado: (msg: string) => void; onCancelar: () => void }) {
  const esBP = acta.modalidad === 'business_plan';
  const esCaso = acta.modalidad === 'caso';
  const [proyecto, setProyecto] = useState(acta.nombre_proyecto ?? '');
  const [fecha, setFecha] = useState(aInputFecha(acta.fecha_sustentacion));
  const [director, setDirector] = useState(acta.director_nombre ?? '');
  const [directorEmail, setDirectorEmail] = useState(acta.ajuste_admin?.director_email ?? '');
  const [jurados, setJurados] = useState<JuradoForm[]>(() => {
    const base = acta.jurados.map((j) => (typeof j === 'string' ? { nombre: j, email: '' } : { nombre: j.nombre, email: j.email ?? '' }));
    return base.length ? base : [{ nombre: '', email: '' }, { nombre: '', email: '' }];
  });
  const [calificacion, setCalificacion] = useState<Calificacion | ''>(acta.calificacion ?? '');
  // Un Caso o un PI sustenta en equipo: lo normal es aplicar lo mismo a todos.
  const [aplicarEquipo, setAplicarEquipo] = useState(!esBP && !!acta.equipo_id);
  const [guardando, setGuardando] = useState(false);
  const [err, setErr] = useState('');

  const cambiarJurado = (i: number, campo: keyof JuradoForm, v: string) =>
    setJurados((js) => js.map((j, k) => (k === i ? { ...j, [campo]: v } : j)));

  async function guardar() {
    setGuardando(true); setErr('');
    const cuerpo: Record<string, unknown> = {
      nombre_proyecto: proyecto,
      fecha_sustentacion: fecha,
      director_nombre: director,
      aplicar_equipo: aplicarEquipo,
    };
    if (!esBP) {
      cuerpo.director_email = directorEmail;
      cuerpo.jurados = jurados.filter((j) => j.nombre.trim());
    }
    if (esCaso) cuerpo.calificacion = calificacion || null;
    try {
      let r;
      try {
        r = await api.post(`/actas/${acta.id}/ajustes`, cuerpo);
      } catch (e: any) {
        const d = e?.response?.data;
        if (d?.error !== 'TIENE_FIRMAS') throw e;
        // Cambiar un acta ya firmada deja esas firmas avalando un texto que
        // nadie firmó: se borran y se vuelve a firmar. Se pregunta antes.
        const ok = await confirmar({
          titulo: 'El acta ya tiene firmas',
          mensaje: `${d.mensaje}\n\n${(d.con_firmas ?? []).join(', ')}`,
          aceptar: 'Cambiar y volver a firmar',
          tono: 'peligro',
        });
        if (!ok) { setGuardando(false); return; }
        r = await api.post(`/actas/${acta.id}/ajustes`, { ...cuerpo, reiniciar_firmas: true });
      }
      const actas = (r.data as any)?.actas ?? [];
      const pendientes = actas.filter((a: any) => a.estado === 'faltan_datos');
      const reinicio = (r.data as any)?.firmas_reiniciadas ? ' Las firmas se borraron: hay que volver a enviarla.' : '';
      onGuardado(pendientes.length
        ? `Guardado en ${actas.length} acta${actas.length === 1 ? '' : 's'}. Aún falta: ${[...new Set(pendientes.flatMap((a: any) => a.faltan ?? []))].join(', ')}.${reinicio}`
        : `Guardado en ${actas.length} acta${actas.length === 1 ? '' : 's'}. Ya se puede enviar a firma.${reinicio}`);
    } catch (e) {
      setErr(formatBackendError(e));
    } finally {
      setGuardando(false);
    }
  }

  const etiqueta = 'block text-[0.65rem] uppercase tracking-wider font-semibold text-inalde-gray mb-1';
  return (
    <div className="card-inalde p-5 max-w-3xl mx-auto mb-6">
      <h2 className="font-primary font-bold text-sm uppercase tracking-widest text-inalde-red mb-1">Editar datos del acta</h2>
      <p className="text-xs text-inalde-gray mb-4">
        Lo que pongas aquí manda sobre el cronograma y sobre el formulario del director.
      </p>
      {err && <div className="mb-4 rounded border-l-4 border-inalde-red bg-red-50 px-4 py-3 text-sm whitespace-pre-wrap">{err}</div>}

      <div className="grid sm:grid-cols-2 gap-3 mb-3">
        <div className="sm:col-span-2">
          <label className={etiqueta}>Nombre del proyecto</label>
          <input className="input-inalde !py-2 !text-sm" value={proyecto} onChange={(e) => setProyecto(e.target.value)} />
        </div>
        <div>
          <label className={etiqueta}>Fecha de sustentación</label>
          <input type="date" className="input-inalde !py-2 !text-sm" value={fecha} onChange={(e) => setFecha(e.target.value)} />
        </div>
        <div>
          <label className={etiqueta}>{esBP ? 'Profesor NAVES' : 'Director del proyecto'}</label>
          <input className="input-inalde !py-2 !text-sm" value={director} onChange={(e) => setDirector(e.target.value)} />
        </div>
        {!esBP && (
          <div className="sm:col-span-2">
            <label className={etiqueta}>Correo del director (para su enlace de firma)</label>
            <input type="email" className="input-inalde !py-2 !text-sm" value={directorEmail} onChange={(e) => setDirectorEmail(e.target.value)}
              placeholder="Si lo dejas vacío se usa el de su ficha de director" />
          </div>
        )}
      </div>

      {!esBP && (
        <div className="mb-4">
          <label className={etiqueta}>Jurados</label>
          <div className="flex flex-col gap-2">
            {jurados.map((j, i) => (
              <div key={i} className="flex flex-wrap gap-2 items-center">
                <input className="input-inalde !py-2 !text-sm flex-1 min-w-[160px]" placeholder={`Jurado ${i + 1} — nombre`} value={j.nombre} onChange={(e) => cambiarJurado(i, 'nombre', e.target.value)} />
                <input type="email" className="input-inalde !py-2 !text-sm flex-1 min-w-[160px]" placeholder="correo" value={j.email} onChange={(e) => cambiarJurado(i, 'email', e.target.value)} />
                <button type="button" className="text-xs text-inalde-gray hover:text-inalde-red" onClick={() => setJurados((js) => js.filter((_, k) => k !== i))}>Quitar</button>
              </div>
            ))}
          </div>
          <button type="button" className="btn-inalde-ghost mt-2" onClick={() => setJurados((js) => [...js, { nombre: '', email: '' }])}>+ Agregar jurado</button>
          <p className="text-[11px] text-inalde-gray mt-1">El correo es a donde le llega su enlace para firmar.</p>
        </div>
      )}

      {esCaso && (
        <div className="mb-4">
          <label className={etiqueta}>Calificación</label>
          <div className="flex flex-wrap gap-2">
            {ESCALA.map((c) => (
              <button key={c} type="button" onClick={() => setCalificacion(c)}
                className={`min-w-[52px] px-3 py-2 rounded border-2 font-primary font-bold text-sm ${calificacion === c ? 'border-inalde-red bg-red-50 text-inalde-red' : 'border-inalde-gray-light text-inalde-text'}`}>
                {c}
              </button>
            ))}
          </div>
        </div>
      )}

      {!!acta.equipo_id && (
        <label className="flex items-center gap-2 text-sm text-inalde-text mb-4">
          <input type="checkbox" checked={aplicarEquipo} onChange={(e) => setAplicarEquipo(e.target.checked)} />
          Aplicar a todas las actas del equipo
        </label>
      )}

      <div className="flex flex-wrap gap-3">
        <button type="button" className="btn-inalde-primary" onClick={guardar} disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar datos'}</button>
        <button type="button" className="btn-inalde-ghost" onClick={onCancelar} disabled={guardando}>Cancelar</button>
      </div>
    </div>
  );
}

export default function Acta() {
  const { id } = useParams<{ id: string }>();
  const [acta, setActa] = useState<Acta | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [okMsg, setOkMsg] = useState('');

  const [obs, setObs] = useState('');
  const [guardandoObs, setGuardandoObs] = useState(false);
  const [guardandoNota, setGuardandoNota] = useState(false);
  const [editando, setEditando] = useState(false);
  const [accion, setAccion] = useState<'' | 'generar' | 'enviar'>('');
  const [enlaces, setEnlaces] = useState<any[] | null>(null);

  const cargar = useCallback(async () => {
    if (!id) return;
    setLoading(true); setErr('');
    try {
      const r = await api.get(`/actas/${id}`);
      const d = r.data as Acta;
      setActa(d);
      setObs(d.observaciones ?? '');
    } catch (e) {
      setErr(formatBackendError(e));
      setActa(null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { void cargar(); }, [cargar]);

  // Busca la firma por rol (coincidencia flexible).
  function firmaDe(...roles: string[]): Firma | undefined {
    if (!acta) return undefined;
    return acta.firmas.find((f) => roles.some((r) => f.rol.toLowerCase().includes(r)));
  }

  /**
   * La firma de UN jurado concreto. No vale buscar por rol: en un Caso o un PI
   * todos los jurados tienen `rol: 'jurado'`, así que el primero se llevaría la
   * firma de todos. Y "jurado 1" no es un rol de nada, así que antes ninguno
   * mostraba su firma aunque hubiera firmado. Se empareja por rol + nombre, que
   * es lo que distingue a una persona de otra (mismo arreglo que en el PDF).
   */
  function firmaDeJurado(nombre: string): Firma | undefined {
    if (!acta) return undefined;
    const n = nombre.trim().toLocaleLowerCase('es');
    return acta.firmas.find((f) => f.rol.toLowerCase().includes('jurado')
      && (f.nombre ?? '').trim().toLocaleLowerCase('es') === n);
  }

  async function guardarObs() {
    if (!id) return;
    setGuardandoObs(true); setErr(''); setOkMsg('');
    try {
      await api.post(`/actas/${id}`, { observaciones: obs });
      setOkMsg('Observaciones guardadas.');
      await cargar();
    } catch (e) {
      setErr(formatBackendError(e));
    } finally {
      setGuardandoObs(false);
    }
  }

  async function guardarNota(nota: Exclude<Nota, null>) {
    if (!id) return;
    setGuardandoNota(true); setErr(''); setOkMsg('');
    try {
      await api.post(`/actas/${id}`, { nota });
      setOkMsg('Resultado registrado.');
      await cargar();
    } catch (e) {
      setErr(formatBackendError(e));
    } finally {
      setGuardandoNota(false);
    }
  }

  async function guardarCalificacion(c: Calificacion) {
    if (!id) return;
    setGuardandoNota(true); setErr(''); setOkMsg('');
    try {
      await api.post(`/actas/${id}/ajustes`, { calificacion: c });
      setOkMsg(`Calificación ${c} registrada.`);
      await cargar();
    } catch (e: any) {
      if (e?.response?.data?.error === 'TIENE_FIRMAS') {
        setErr('El acta ya tiene firmas. Para cambiar la calificación usa «Editar datos»: te pedirá confirmar que se vuelva a firmar.');
      } else setErr(formatBackendError(e));
    } finally {
      setGuardandoNota(false);
    }
  }

  async function generarAhora() {
    if (!id) return;
    setAccion('generar'); setErr(''); setOkMsg('');
    try {
      await api.post(`/actas/${id}/generar`);
      setOkMsg('Acta generada. Ya se puede enviar a firma.');
    } catch (e) {
      setErr(formatBackendError(e));
    } finally {
      setAccion('');
      await cargar();
    }
  }

  async function enviarAFirma() {
    if (!id || !acta) return;
    const cierre = acta.estado === 'lista_para_cierre';
    const bp = acta.modalidad === 'business_plan';
    if (!(await confirmar({
      titulo: 'Enviar a firma',
      mensaje: bp
        ? 'Se enviará solo al participante un correo con su enlace para revisarla y firmarla. Al profesor y al Director de Cohorte se les manda en bloque.'
        : cierre
        ? 'Se enviará el enlace de firma del cierre al Director de Cohorte.'
        : 'Se enviará al participante y a cada firmante pendiente de esta acta (profesor o director y jurados) un correo con su enlace para revisarla y firmarla.',
      aceptar: 'Enviar',
    }))) return;
    setAccion('enviar'); setErr(''); setOkMsg(''); setEnlaces(null);
    try {
      const r = await api.post(`/actas/${id}/enviar`, {});
      const lista = (r.data as any)?.enlaces ?? [];
      setEnlaces(lista);
      setOkMsg(lista.length ? 'Acta enviada a firma.'
        : bp ? 'El participante ya firmó: no había a quién escribir. Al profesor y al Director de Cohorte se les manda en bloque.'
        : 'Acta enviada. No había firmantes pendientes a quién escribir en este paso.');
    } catch (e) {
      setErr(formatBackendError(e));
    } finally {
      setAccion('');
      await cargar();
    }
  }

  if (loading) return <p className="text-inalde-gray text-sm">Cargando acta…</p>;

  if (!acta) {
    return (
      <>
        {err && <div className="mb-6 rounded border-l-4 border-inalde-red bg-red-50 px-4 py-3 text-sm whitespace-pre-wrap">{err}</div>}
        <Link to="/admin/actas" className="text-xs text-inalde-gray hover:text-inalde-red">← Volver al panel</Link>
      </>
    );
  }

  const esBP = acta.modalidad === 'business_plan';
  const esCaso = acta.modalidad === 'caso';
  const cerrada = ['anulada', 'archivada'].includes(acta.estado);
  const puedeEnviar = !cerrada && !['faltan_datos', 'completa'].includes(acta.estado);

  return (
    <>
      <div className="flex items-center justify-between gap-4 mb-6">
        <Link to="/admin/actas" className="text-xs text-inalde-gray hover:text-inalde-red">← Volver al panel</Link>
        {acta.faltan.length > 0 && (
          <span className="text-[10px] uppercase tracking-wider font-semibold text-inalde-red">Faltan datos: {acta.faltan.join(', ')}</span>
        )}
      </div>

      {err && <div className="mb-6 rounded border-l-4 border-inalde-red bg-red-50 px-4 py-3 text-sm whitespace-pre-wrap">{err}</div>}
      {okMsg && <div className="mb-6 rounded border-l-4 border-green-600 bg-green-50 px-4 py-3 text-sm text-green-800">{okMsg}</div>}

      {/* Acciones del super admin sobre ESTA acta */}
      {!cerrada && (
        <div className="max-w-3xl mx-auto mb-6 flex flex-wrap gap-3">
          <button type="button" className="btn-inalde-secondary" onClick={() => setEditando((v) => !v)} disabled={!!accion}>
            {editando ? 'Cerrar edición' : '✏️ Editar datos'}
          </button>
          {acta.estado === 'faltan_datos' && (
            <button type="button" className="btn-inalde-secondary" onClick={() => { void generarAhora(); }} disabled={!!accion}>
              {accion === 'generar' ? 'Generando…' : 'Generar ahora'}
            </button>
          )}
          {puedeEnviar && (
            <button type="button" className="btn-inalde-primary" onClick={() => { void enviarAFirma(); }} disabled={!!accion}>
              {accion === 'enviar' ? 'Enviando…' : '✉️ Enviar a firma'}
            </button>
          )}
        </div>
      )}

      {enlaces && enlaces.length > 0 && (
        <div className="card-inalde p-4 max-w-3xl mx-auto mb-6">
          {enlaces.map((e, i) => (
            <div key={i} className="text-xs flex items-baseline justify-between gap-2">
              <span className="truncate"><strong>{e.nombre}</strong> <span className="text-inalde-gray">· {e.rol}</span></span>
              <span className={`whitespace-nowrap ${e.correo === 'enviado' ? 'text-green-700' : 'text-inalde-red'}`}>
                {e.correo === 'enviado' ? '✓ correo enviado' : (e.email ? `no enviado (${e.correo ?? 'error'})` : 'sin correo: ponlo en «Editar datos»')}
              </span>
            </div>
          ))}
        </div>
      )}

      {editando && (
        <EditarDatos
          acta={acta}
          onCancelar={() => setEditando(false)}
          onGuardado={(msg) => { setEditando(false); setOkMsg(msg); void cargar(); }}
        />
      )}

      {/* Hoja del acta v3 */}
      <div className="bg-white border-2 border-inalde-gray-light rounded-lg shadow-inalde-card max-w-3xl mx-auto">
        {/* Encabezado institucional */}
        <div className="border-b-[3px] border-inalde-red px-6 sm:px-10 py-5 flex items-center gap-4">
          <img src="/inalde-logo.jpg" alt="INALDE Business School" className="h-12 w-auto" />
          <div className="border-l border-inalde-gray-light pl-4">
            <p className="font-primary font-extrabold text-[0.7rem] tracking-widest uppercase text-inalde-text">INALDE Business School</p>
            <p className="text-[0.62rem] uppercase tracking-wider text-inalde-gray leading-tight mt-0.5">
              Proceso Ejecución de Programas · Formato de Acta Proyecto de Grado MBA · Versión 3
            </p>
          </div>
        </div>

        <div className="px-6 sm:px-10 py-8">
          <h1 className="font-primary font-extrabold text-lg text-center text-inalde-text uppercase tracking-wide mb-8">
            Acta de Evaluación — Sustentación Proyecto de Grado
          </h1>

          {/* Modalidad (checkbox X en la que aplica) */}
          <div className="flex flex-wrap gap-5 justify-center mb-8">
            {MODALIDADES.map((m) => {
              const marcada = acta.modalidad === m.key;
              return (
                <span key={m.key} className="inline-flex items-center gap-2 text-sm">
                  <span className={`inline-flex items-center justify-center w-5 h-5 border-2 font-bold ${marcada ? 'border-inalde-red text-inalde-red' : 'border-inalde-gray-light text-transparent'}`}>X</span>
                  <span className={marcada ? 'font-semibold text-inalde-text' : 'text-inalde-gray'}>{m.label}</span>
                </span>
              );
            })}
          </div>

          {/* Fecha y lugar */}
          <div className="grid sm:grid-cols-2 gap-4 mb-6">
            <div>
              <p className="text-[0.65rem] uppercase tracking-wider font-semibold text-inalde-gray">Fecha de sustentación</p>
              <p className="text-sm text-inalde-text border-b border-inalde-gray-light py-1">{fmtFecha(acta.fecha_sustentacion)}</p>
            </div>
            <div>
              <p className="text-[0.65rem] uppercase tracking-wider font-semibold text-inalde-gray">Lugar</p>
              <p className="text-sm text-inalde-text border-b border-inalde-gray-light py-1">{acta.lugar || '—'}</p>
            </div>
          </div>

          {/* Participante */}
          <div className="mb-6">
            <p className="text-[0.65rem] uppercase tracking-wider font-semibold text-inalde-gray">Nombre del participante</p>
            <div className="flex items-baseline justify-between gap-3 border-b border-inalde-gray-light py-1">
              <p className="text-sm font-semibold text-inalde-text">{acta.nombre_participante}</p>
              <FirmaEstado firma={firmaDe('participante')} />
            </div>
          </div>

          {/* Proyecto */}
          <div className="mb-6">
            <p className="text-[0.65rem] uppercase tracking-wider font-semibold text-inalde-gray">Nombre del proyecto</p>
            <p className="text-sm text-inalde-text border-b border-inalde-gray-light py-1">{acta.nombre_proyecto || '—'}</p>
          </div>

          {/* Director del proyecto */}
          <div className="mb-6">
            <p className="text-[0.65rem] uppercase tracking-wider font-semibold text-inalde-gray">Director del proyecto</p>
            <div className="flex items-baseline justify-between gap-3 border-b border-inalde-gray-light py-1">
              <p className="text-sm text-inalde-text">{acta.director_nombre || '—'}</p>
              <FirmaEstado firma={firmaDe('director de proyecto', 'director_proyecto', 'director del proyecto')} />
            </div>
          </div>

          {/* Sustentación / jurados */}
          <div className="mb-6">
            <p className="text-[0.65rem] uppercase tracking-wider font-semibold text-inalde-gray mb-2">Sustentación</p>
            {esBP ? (
              <p className="text-sm text-inalde-gray italic">Business Plan — sin jurados.</p>
            ) : acta.jurados.length === 0 ? (
              <p className="text-sm text-inalde-red">Pendiente: aún no se han registrado los jurados.</p>
            ) : (
              <div className="flex flex-col gap-1">
                {acta.jurados.map((j, i) => {
                  const nombre = nombreJurado(j);
                  return (
                    <div key={i} className="flex items-baseline justify-between gap-3 border-b border-inalde-gray-light py-1">
                      <p className="text-sm text-inalde-text">Jurado {i + 1}: {nombre}</p>
                      <FirmaEstado firma={firmaDeJurado(nombre)} />
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Nota */}
          <div className="mb-6">
            <p className="text-[0.65rem] uppercase tracking-wider font-semibold text-inalde-gray mb-1">{esCaso ? 'Calificación' : 'Nota / resultado'}</p>
            {esCaso ? (
              <div className="flex flex-wrap items-center gap-2">
                {ESCALA.map((c) => (
                  <button key={c} type="button" onClick={() => { void guardarCalificacion(c); }} disabled={guardandoNota || cerrada}
                    className={`min-w-[48px] px-3 py-1.5 rounded border-2 font-primary font-bold text-sm ${acta.calificacion === c ? 'border-inalde-red bg-red-50 text-inalde-red' : 'border-inalde-gray-light text-inalde-text hover:border-inalde-gray'}`}>
                    {c}
                  </button>
                ))}
                <span className="text-xs text-inalde-gray">
                  {acta.calificacion
                    ? (acta.nota === 'aceptado' ? 'Aprobado' : 'No aprobado')
                    : acta.nota ? `Registrado antes de la escala: ${acta.nota}` : 'Selecciona la calificación.'}
                </span>
              </div>
            ) : acta.nota ? (
              <span className={`inline-block text-sm font-primary font-bold uppercase tracking-wider px-3 py-1 rounded ${acta.nota === 'aceptado' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-inalde-red'}`}>
                {acta.nota === 'aceptado' ? 'Aceptado' : 'Rechazado'}
              </span>
            ) : (
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn-inalde-secondary" onClick={() => guardarNota('aceptado')} disabled={guardandoNota}>Aceptado</button>
                <button type="button" className="btn-inalde-ghost" onClick={() => guardarNota('rechazado')} disabled={guardandoNota}>Rechazado</button>
                <span className="text-xs text-inalde-gray self-center">Selecciona el resultado de la sustentación.</span>
              </div>
            )}
          </div>

          {/* Observaciones (editable) */}
          <div className="mb-8">
            <p className="text-[0.65rem] uppercase tracking-wider font-semibold text-inalde-gray mb-1">Observaciones</p>
            <textarea className="input-inalde min-h-[110px] resize-y !text-sm" value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Observaciones del jurado / director…" />
            <div className="mt-2">
              <button type="button" className="btn-inalde-secondary" onClick={guardarObs} disabled={guardandoObs || obs === (acta.observaciones ?? '')}>
                {guardandoObs ? 'Guardando…' : 'Guardar observaciones'}
              </button>
            </div>
          </div>

          {/* Cierre — Director de Cohorte */}
          <BloqueFirma
            titulo="Cierre — Director de Cohorte"
            nombre={acta.director_mba_nombre}
            cargo={acta.director_mba_cargo}
            firma={firmaDe('director mba', 'director_mba', 'mba')}
          />
        </div>
      </div>

      <div className="mt-8 text-center">
        <Link to="/admin/actas" className="text-xs text-inalde-gray hover:text-inalde-red">← Volver al panel</Link>
      </div>
    </>
  );
}
