import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { formatBackendError } from '../../lib/errors';
import { LogisticaModal } from '../admin/Panelistas';

interface Jornada { id: string; numero: number; fecha: string; fecha_legible: string; dia: string; hora_inicio: string | null; hora_fin: string | null; }
interface PortalData {
  nombre: string; cohorte: string; asiste_todas: boolean; confirmado: boolean;
  jornadas: Jornada[]; logistica: any | null;
}

export default function ConfirmarAsistencia() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [data, setData] = useState<PortalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openForm, setOpenForm] = useState(false);
  const [confirmado, setConfirmado] = useState(false);

  async function load() {
    if (!token) { setError('Enlace inválido: falta el token.'); setLoading(false); return; }
    setLoading(true); setError(null);
    try {
      const { data } = await api.get(`/panelistas/portal/${token}`);
      setData(data); setConfirmado(!!data.confirmado);
    } catch (e: any) {
      setError(e?.response?.status === 404 ? 'Este enlace no es válido o ya expiró.' : formatBackendError(e));
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [token]);

  return (
    <div className="min-h-screen bg-inalde-gray-bg/40">
      <header className="bg-inalde-text text-white py-5 px-4">
        <div className="max-w-[680px] mx-auto">
          <p className="text-[11px] uppercase tracking-[2px] text-white/60">Panel de Evaluación · NAVES</p>
          <p className="text-lg font-primary font-bold">INALDE Business School — Executive MBA</p>
        </div>
      </header>

      <main className="max-w-[680px] mx-auto px-4 py-8">
        {loading ? <p className="text-inalde-gray">Cargando…</p> :
          error ? (
            <div role="alert" className="bg-white rounded-lg shadow-inalde-card p-6 border-l-4 border-inalde-red">
              <h1 className="font-primary font-bold text-lg mb-1">No pudimos abrir tu enlace</h1>
              <p className="text-sm text-inalde-gray">{error}</p>
              <p className="text-sm text-inalde-gray mt-2">Si crees que es un error, escríbele al coordinador del programa para que te reenvíe el enlace.</p>
            </div>
          ) : data && (
            <div className="bg-white rounded-lg shadow-inalde-card p-6 sm:p-8">
              <div className="border-b-[3px] border-inalde-red pb-4 mb-5">
                <p className="section-subtitle mb-1">Panelista · {data.cohorte}</p>
                <h1 className="section-title">Hola, {data.nombre}</h1>
                <p className="text-sm text-inalde-gray mt-2">
                  Te invitamos a evaluar las presentaciones de NAVES. Confirma tu asistencia e indica tu logística
                  (transporte y comidas) para las siguientes jornadas.
                </p>
              </div>

              {confirmado && (
                <div role="status" className="rounded border-l-4 border-inalde-blue bg-blue-50 px-4 py-3 text-sm mb-5">
                  <span aria-hidden="true">✓ </span>Ya registramos tu confirmación. Puedes actualizar tus datos cuando quieras con el botón de abajo.
                </div>
              )}

              <h2 className="text-xs font-primary font-semibold uppercase tracking-wider text-inalde-gray mb-2">Tus jornadas</h2>
              <div className="space-y-2 mb-6">
                {data.jornadas.map((j) => (
                  <div key={j.id} className="border border-inalde-gray-light rounded px-3 py-2 flex justify-between items-center">
                    <div><span className="font-medium text-inalde-text">Jornada {j.numero}</span> <span className="text-inalde-gray capitalize text-sm">· {j.fecha_legible}</span></div>
                    <span className="text-xs text-inalde-gray">{(j.hora_inicio ?? '').slice(0, 5) || ''}{j.hora_fin ? ` – ${(j.hora_fin).slice(0, 5)}` : ''}</span>
                  </div>
                ))}
                {data.jornadas.length === 0 && <p className="text-inalde-gray text-sm italic">Aún no hay jornadas asignadas.</p>}
              </div>

              <button onClick={() => setOpenForm(true)} className="btn-inalde-primary w-full sm:w-auto">
                {confirmado ? 'Actualizar mi confirmación y logística' : 'Confirmar mi asistencia y logística →'}
              </button>
              <p className="text-[11px] text-inalde-gray mt-3">Este es tu enlace personal; no lo compartas. INALDE Business School — Programa MBA.</p>
            </div>
          )}
      </main>

      {openForm && data && (
        <LogisticaModal
          panelista={{ token, nombre: data.nombre, asiste_todas: data.asiste_todas, jornadas: data.jornadas, logistica: data.logistica }}
          jornadas={data.jornadas as any}
          onClose={() => setOpenForm(false)}
          onSaved={() => { setOpenForm(false); setConfirmado(true); load(); }}
        />
      )}
    </div>
  );
}
