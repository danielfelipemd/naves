import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Header } from '../components/inalde/Header';
import { api, downloadFile } from '../lib/api';
import { useAuth, esRolArea } from '../auth/store';

// Programación Interna — la escaleta del evento y la logística de panelistas
// para marketing, operaciones y el asistente de programa. Solo lectura: aquí no
// se marca nada ni se edita nada, se consulta y se descarga.
//
// La otra programación de cara a panelistas es pública, con formulario de
// confirmación. Esta es la interna, y de ella salen los datos que aquella
// recoge.

interface Fila {
  tipo: string; slot: number | null;
  hora_inicio: string; hora_fin: string;
  titulo: string; autores: string; sector: string;
}
interface Panelista {
  nombre: string; email: string; confirmado: boolean;
  necesita_transporte: boolean; direccion_recogida: string | null; hora_recogida: string | null;
  almuerzo: boolean; desayuno: boolean;
}
interface Resumen {
  asisten: number; confirmados: number; sin_confirmar: number;
  transporte: number; almuerzos: number; desayunos: number;
}
interface Jornada {
  numero: number; fecha: string; fecha_legible: string;
  filas: Fila[]; panelistas: Panelista[]; resumen: Resumen;
}
interface Data {
  publicada: boolean; motivo?: string;
  evento_nombre?: string; cohorte?: string; jornadas: Jornada[];
}

const MOTIVOS: Record<string, string> = {
  SIN_COHORTE_ACTIVA: 'No hay ninguna cohorte activa en este momento.',
  NO_PUBLICADA: 'La coordinación todavía está armando la programación del evento.',
};

export default function ProgramacionInterna() {
  const navigate = useNavigate();
  const { role, signOut } = useAuth();
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [bajando, setBajando] = useState(false);

  useEffect(() => { (async () => {
    try {
      const { data } = await api.get('/programacion-interna');
      setData(data);
    } catch { setError(true); }
    finally { setLoading(false); }
  })(); }, []);

  async function descargar() {
    setBajando(true);
    try { await downloadFile('/programacion-interna/excel', 'programacion-interna-naves.xlsx'); }
    finally { setBajando(false); }
  }

  if (loading) return <><Header /><main className="pt-36 text-center text-inalde-gray">Cargando…</main></>;

  return (
    <>
      <Header />
      <main className="pt-32 pb-16 px-4">
        <div className="max-w-[1100px] mx-auto">
          <div className="border-b-[3px] border-inalde-red pb-5 mb-8 flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="section-subtitle mb-2">{data?.evento_nombre ?? 'NAVES'}{data?.cohorte ? ` · ${data.cohorte}` : ''}</p>
              <h1 className="section-title">Programación Interna</h1>
              <p className="text-sm text-inalde-gray mt-2">
                La programación del evento para marketing, operaciones y asistente de programa.
              </p>
            </div>
            {data?.publicada && (
              <button onClick={descargar} disabled={bajando} className="btn-inalde-primary !py-2 !px-4 !text-xs disabled:opacity-60">
                {bajando ? 'Generando…' : <><span aria-hidden="true">⬇ </span>Descargar Excel</>}
              </button>
            )}
          </div>

          {error ? (
            <div className="rounded border-l-4 border-inalde-red bg-inalde-red/5 p-5">
              <p className="text-inalde-text font-semibold mb-1">No pudimos cargar la programación</p>
              <p className="text-sm text-inalde-gray">Vuelve a intentarlo en un momento. Si sigue fallando, avisa a la coordinación del programa.</p>
            </div>
          ) : !data?.publicada ? (
            <div className="rounded border-l-4 border-inalde-gold bg-inalde-gold/10 p-5">
              <p className="text-inalde-text font-semibold mb-1">La programación aún no está publicada</p>
              <p className="text-sm text-inalde-gray">{MOTIVOS[data?.motivo ?? ''] ?? 'Todavía no hay una programación disponible.'} En cuanto la publique verás aquí la escaleta definitiva de cada jornada y los panelistas que asisten, con su transporte y sus comidas.</p>
            </div>
          ) : (
            <div className="space-y-10">
              {data.jornadas.map((j) => (
                <section key={j.numero}>
                  <h2 className="text-lg font-primary font-bold text-inalde-text mb-1">
                    Jornada {j.numero}
                  </h2>
                  <p className="text-sm text-inalde-gray capitalize mb-4">{j.fecha_legible}</p>

                  <Escaleta filas={j.filas} />
                  <Panelistas panelistas={j.panelistas} resumen={j.resumen} />
                </section>
              ))}
            </div>
          )}

          {/* Para el staff de área esta es la única pantalla del sistema: sin
              este botón no tendrían ninguna forma de cerrar sesión. El resto
              (super_admin) vuelve a su menú. */}
          <div className="mt-10 pt-6 border-t border-inalde-gray-light">
            {esRolArea(role) ? (
              <button onClick={() => signOut()} className="text-sm text-inalde-gray hover:text-inalde-text">Cerrar sesión</button>
            ) : (
              <button onClick={() => navigate('/')} className="text-sm text-inalde-gray hover:text-inalde-text">← Menú principal</button>
            )}
          </div>
        </div>
      </main>
    </>
  );
}

function Escaleta({ filas }: { filas: Fila[] }) {
  return (
    <div className="bg-white rounded-lg shadow-inalde-card overflow-hidden mb-4">
      <div className="overflow-auto max-h-[72vh]">
        <table className="w-full text-sm">
          <caption className="sr-only">Escaleta de la jornada, actividad por actividad</caption>
          <thead>
            <tr className="bg-inalde-text text-white text-left">
              {['Slot', 'Inicio', 'Fin', 'Actividad / Proyecto', 'Autores', 'Sector'].map((h) => (
                <th key={h} scope="col" className="px-3 py-2 font-semibold text-xs uppercase tracking-wider">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filas.map((f, i) => {
              const esProy = f.tipo === 'proyecto';
              return (
                <tr key={i} className={esProy ? 'border-t border-inalde-gray-light' : 'border-t border-inalde-gray-light bg-inalde-gold/10'}>
                  <td className="px-3 py-2 text-center font-mono text-xs">{f.slot ?? ''}</td>
                  <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">{f.hora_inicio}</td>
                  <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">{f.hora_fin}</td>
                  <td className={esProy ? 'px-3 py-2 font-semibold text-inalde-text' : 'px-3 py-2 text-inalde-text'} colSpan={esProy ? 1 : 3}>
                    {f.titulo}
                  </td>
                  {esProy && <td className="px-3 py-2 text-inalde-gray text-xs">{f.autores}</td>}
                  {esProy && <td className="px-3 py-2 text-inalde-gold text-xs whitespace-nowrap">{f.sector}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Panelistas({ panelistas, resumen }: { panelistas: Panelista[]; resumen: Resumen }) {
  return (
    <div className="bg-white rounded-lg shadow-inalde-card overflow-hidden">
      <div className="px-4 py-3 border-b border-inalde-gray-light flex flex-wrap items-center gap-x-4 gap-y-1">
        <h3 className="text-sm font-semibold text-inalde-text">Panelistas y logística</h3>
        <p className="text-xs text-inalde-gray">
          Asisten {resumen.asisten} · sin confirmar {resumen.sin_confirmar} · transporte {resumen.transporte} · desayunos {resumen.desayunos} · almuerzos {resumen.almuerzos}
        </p>
      </div>
      {!panelistas.length ? (
        <p className="px-4 py-6 text-center text-sm text-inalde-gray">Todavía no hay panelistas asignados a esta jornada.</p>
      ) : (
        <div className="overflow-auto max-h-[72vh]">
          <table className="w-full text-sm">
            <caption className="sr-only">Panelistas de la jornada con su transporte y comidas</caption>
            <thead>
              <tr className="bg-inalde-gray-light/40 text-left">
                {['Panelista', 'Correo', 'Confirmado', 'Transporte', 'Recogida', 'Desayuno', 'Almuerzo'].map((h) => (
                  <th key={h} scope="col" className="px-3 py-2 font-semibold text-xs uppercase tracking-wider text-inalde-gray">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {panelistas.map((p, i) => (
                <tr key={i} className="border-t border-inalde-gray-light">
                  <td className="px-3 py-2 font-semibold text-inalde-text">{p.nombre}</td>
                  <td className="px-3 py-2 text-xs text-inalde-gray">{p.email || '—'}</td>
                  <td className="px-3 py-2 text-center text-xs">
                    {p.confirmado
                      ? <span className="text-inalde-gray">Sí</span>
                      : <span className="text-inalde-red font-semibold">No</span>}
                  </td>
                  <td className="px-3 py-2 text-center text-xs">{p.necesita_transporte ? 'Sí' : '—'}</td>
                  <td className="px-3 py-2 text-xs text-inalde-gray">
                    {p.necesita_transporte
                      ? <>{p.direccion_recogida || 'Sin dirección'}{p.hora_recogida && <span className="font-mono"> · {p.hora_recogida}</span>}</>
                      : '—'}
                  </td>
                  <td className="px-3 py-2 text-center text-xs">{p.desayuno ? 'Sí' : '—'}</td>
                  <td className="px-3 py-2 text-center text-xs">{p.almuerzo ? 'Sí' : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
