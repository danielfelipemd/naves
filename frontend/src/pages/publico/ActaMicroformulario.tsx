import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../../lib/api';

// Microformulario PÚBLICO (sin sesión) para que el director de un proyecto de
// Caso / Proyecto de Investigación registre la fecha de sustentación, los jurados
// y el resultado. El backend valida el token. Header INALDE simple sin campana.

interface Data { director_nombre: string; proyecto: string; sugeridos_jurados: string[]; }
interface JuradoInput { nombre: string; email: string; }

const VACIO: JuradoInput = { nombre: '', email: '' };

export default function ActaMicroformulario() {
  const { token = '' } = useParams();
  const [data, setData] = useState<Data | null>(null);
  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState('');

  const [fecha, setFecha] = useState('');
  const [jurados, setJurados] = useState<JuradoInput[]>([{ ...VACIO }, { ...VACIO }, { ...VACIO }]);
  const [nota, setNota] = useState<'aceptado' | 'rechazado' | ''>('');
  const [enviando, setEnviando] = useState(false);
  const [errorEnvio, setErrorEnvio] = useState('');
  const [exito, setExito] = useState(false);

  useEffect(() => { (async () => {
    setCargando(true); setErrorCarga('');
    try {
      const r = await api.get(`/actas/micro/${encodeURIComponent(token)}`);
      setData(r.data as Data);
    } catch (e: any) {
      const code = e?.response?.status;
      const backend = e?.response?.data?.error;
      if (code === 404 || backend === 'ENLACE_NO_VALIDO') setErrorCarga('Este enlace no es válido. Verifica que lo copiaste completo o solicita uno nuevo a la asistente del programa.');
      else if (code === 409 || backend === 'YA_DILIGENCIADO') setErrorCarga('Este formulario ya fue diligenciado. Si necesitas corregir algún dato, contacta a la asistente del programa.');
      else if (code === 410 || backend === 'ENLACE_VENCIDO') setErrorCarga('Este enlace venció y ya no está disponible. Solicita uno nuevo a la asistente del programa.');
      else setErrorCarga('No pudimos abrir el formulario. Inténtalo de nuevo en unos minutos.');
    } finally {
      setCargando(false);
    }
  })(); }, [token]);

  function setJurado(i: number, patch: Partial<JuradoInput>) {
    setJurados((js) => js.map((j, idx) => (idx === i ? { ...j, ...patch } : j)));
  }

  // Jurado 1 y 2 obligatorios; el 3 es opcional.
  const juradosValidos =
    jurados[0].nombre.trim() && jurados[0].email.trim() &&
    jurados[1].nombre.trim() && jurados[1].email.trim();
  const formularioValido = !!fecha && !!juradosValidos && !!nota;

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (!formularioValido) return;
    setEnviando(true); setErrorEnvio('');
    try {
      const payload = {
        fecha_sustentacion: fecha,
        jurados: jurados
          .filter((j) => j.nombre.trim())
          .map((j) => ({ nombre: j.nombre.trim(), email: j.email.trim() })),
        nota,
      };
      await api.post(`/actas/micro/${encodeURIComponent(token)}`, payload);
      setExito(true);
    } catch (e: any) {
      const code = e?.response?.status;
      const backend = e?.response?.data?.error;
      if (code === 409 || backend === 'YA_DILIGENCIADO') setErrorEnvio('Este formulario ya fue diligenciado.');
      else if (code === 410 || backend === 'ENLACE_VENCIDO') setErrorEnvio('El enlace venció mientras diligenciabas el formulario.');
      else setErrorEnvio('No pudimos enviar el formulario. Revisa los datos e inténtalo de nuevo.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="min-h-screen bg-inalde-gray-bg/30">
      {/* Header INALDE simple (sin campana ni back: es público) */}
      <header className="bg-white border-b border-inalde-gray-light shadow-sm">
        <div className="bg-inalde-black px-4 sm:px-8 py-2">
          <p className="text-right text-white font-primary font-medium text-[10px] sm:text-xs tracking-wider uppercase">INALDE Business School</p>
        </div>
        <div className="flex items-center gap-3 sm:gap-6 max-w-[900px] mx-auto px-4 sm:px-8 py-3 sm:py-4">
          <img src="/inalde-logo.jpg" alt="INALDE Business School" className="h-10 sm:h-14 w-auto" />
          <div className="w-px h-9 sm:h-11 bg-inalde-gray-light" />
          <div>
            <p className="font-primary font-semibold text-[10px] sm:text-[0.7rem] tracking-widest uppercase text-inalde-gray mb-0.5">NAVES · Acta de Proyecto de Grado MBA</p>
            <p className="font-primary font-extrabold text-lg sm:text-xl tracking-tight leading-none text-inalde-text">Datos de sustentación</p>
          </div>
        </div>
      </header>

      <main className="max-w-[900px] mx-auto px-4 sm:px-8 py-10">
        {cargando && <p className="text-inalde-gray text-sm">Cargando…</p>}

        {!cargando && errorCarga && (
          <div className="max-w-lg mx-auto bg-white rounded-lg shadow-inalde-card p-6 sm:p-8 mt-6">
            <div className="rounded border-l-4 border-inalde-red bg-red-50 px-4 py-3 text-sm text-inalde-text">{errorCarga}</div>
          </div>
        )}

        {!cargando && !errorCarga && exito && (
          <div className="max-w-lg mx-auto bg-white rounded-lg shadow-inalde-card p-6 sm:p-8 mt-6 text-center">
            <p className="text-4xl mb-3">✓</p>
            <h1 className="font-primary font-extrabold text-xl text-inalde-text mb-2">Formulario enviado</h1>
            <p className="text-sm text-inalde-gray">Gracias. Registramos la fecha de sustentación, los jurados y el resultado. Ya puedes cerrar esta ventana.</p>
          </div>
        )}

        {!cargando && !errorCarga && !exito && data && (
          <div className="max-w-lg mx-auto bg-white rounded-lg shadow-inalde-card p-6 sm:p-8 mt-6">
            <div className="border-b-[3px] border-inalde-red pb-4 mb-6">
              <p className="section-subtitle mb-1">Director del proyecto</p>
              <h1 className="section-title">{data.director_nombre}</h1>
              <p className="text-sm text-inalde-gray mt-2">Proyecto: <strong className="text-inalde-text">{data.proyecto}</strong></p>
            </div>

            <form onSubmit={enviar} className="space-y-6">
              {/* Fecha */}
              <div>
                <label className="block text-[0.7rem] uppercase tracking-wider font-semibold text-inalde-gray mb-1">Fecha de sustentación *</label>
                <input type="date" className="input-inalde" value={fecha} onChange={(e) => setFecha(e.target.value)} required />
              </div>

              {/* Jurados */}
              <div>
                <p className="text-[0.7rem] uppercase tracking-wider font-semibold text-inalde-gray mb-1">Jurados</p>
                <p className="text-xs text-inalde-gray mb-3">Jurado 1 y 2 obligatorios; el 3 es opcional. Puedes elegir un jurado sugerido o escribir uno externo.</p>
                {[0, 1, 2].map((i) => (
                  <div key={i} className="mb-4 last:mb-0">
                    <p className="text-xs font-semibold text-inalde-text mb-1">Jurado {i + 1}{i < 2 ? ' *' : ' (opcional)'}</p>
                    <div className="grid sm:grid-cols-2 gap-2">
                      {data.sugeridos_jurados.length > 0 ? (
                        <input
                          list={`sugeridos-${i}`}
                          className="input-inalde !py-2 !text-sm"
                          placeholder="Nombre del jurado"
                          value={jurados[i].nombre}
                          onChange={(e) => setJurado(i, { nombre: e.target.value })}
                        />
                      ) : (
                        <input
                          className="input-inalde !py-2 !text-sm"
                          placeholder="Nombre del jurado"
                          value={jurados[i].nombre}
                          onChange={(e) => setJurado(i, { nombre: e.target.value })}
                        />
                      )}
                      <datalist id={`sugeridos-${i}`}>
                        {data.sugeridos_jurados.map((s) => <option key={s} value={s} />)}
                      </datalist>
                      <input
                        type="email"
                        className="input-inalde !py-2 !text-sm"
                        placeholder="Correo del jurado"
                        value={jurados[i].email}
                        onChange={(e) => setJurado(i, { email: e.target.value })}
                      />
                    </div>
                  </div>
                ))}
              </div>

              {/* Resultado */}
              <div>
                <label className="block text-[0.7rem] uppercase tracking-wider font-semibold text-inalde-gray mb-2">Resultado *</label>
                <div className="flex gap-3">
                  {(['aceptado', 'rechazado'] as const).map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setNota(v)}
                      className={`flex-1 rounded border-2 px-4 py-3 font-primary font-semibold uppercase tracking-wider text-sm transition-colors ${
                        nota === v
                          ? (v === 'aceptado' ? 'border-green-600 bg-green-50 text-green-800' : 'border-inalde-red bg-red-50 text-inalde-red')
                          : 'border-inalde-gray-light text-inalde-gray hover:border-inalde-blue'
                      }`}
                    >
                      {v === 'aceptado' ? 'Aceptado' : 'Rechazado'}
                    </button>
                  ))}
                </div>
              </div>

              {errorEnvio && <div className="rounded border-l-4 border-inalde-red bg-red-50 px-4 py-3 text-sm text-inalde-text">{errorEnvio}</div>}

              <button type="submit" className="btn-inalde-primary w-full" disabled={enviando || !formularioValido}>
                {enviando ? 'Enviando…' : 'Enviar datos de sustentación'}
              </button>
            </form>
          </div>
        )}
      </main>
    </div>
  );
}
