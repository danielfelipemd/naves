import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Header } from '../../components/inalde/Header';
import { api, downloadFile } from '../../lib/api';

interface Presentacion {
  en_equipo: boolean; programado?: boolean; evento?: string;
  proyecto?: string | null; sector?: string | null; autores?: string | null;
  fecha?: string; fecha_legible?: string; jornada?: number; slot?: number;
  hora_inicio?: string; hora_fin?: string;
}

export default function MiPresentacion() {
  const navigate = useNavigate();
  const [data, setData] = useState<Presentacion | null>(null);
  const [loading, setLoading] = useState(true);
  const [bajando, setBajando] = useState(false);

  useEffect(() => { (async () => {
    try {
      const { data } = await api.get('/proyectos-db/mi-presentacion');
      setData(data);
    } catch { setData({ en_equipo: false }); }
    finally { setLoading(false); }
  })(); }, []);

  async function agregarCalendario() {
    setBajando(true);
    try { await downloadFile('/proyectos-db/mi-presentacion/ics', 'mi-presentacion-naves.ics'); }
    finally { setBajando(false); }
  }

  if (loading) return <><Header /><main className="pt-36 text-center text-inalde-gray">Cargando…</main></>;

  return (
    <>
      <Header />
      <main className="pt-36 pb-16 px-4">
        <div className="max-w-[640px] mx-auto bg-white rounded-lg shadow-inalde-card p-5 sm:p-10">
          <div className="border-b-[3px] border-inalde-red pb-5 mb-8">
            <p className="section-subtitle mb-2">Evento de presentación</p>
            <h1 className="section-title">Mi presentación</h1>
          </div>

          {!data?.en_equipo ? (
            <p className="text-inalde-gray">Todavía no perteneces a un equipo, así que aún no hay una presentación asignada.</p>
          ) : !data.programado ? (
            <div className="rounded border-l-4 border-inalde-gold bg-inalde-gold/10 p-5">
              <p className="text-inalde-text font-semibold mb-1">Tu presentación aún no está programada</p>
              <p className="text-sm text-inalde-gray">Cuando la coordinación publique el calendario de {data.evento ?? 'NAVES'}, verás aquí la fecha, la jornada y la hora exacta de tu equipo, y podrás agregarla a tu calendario.</p>
              {data.proyecto && <p className="text-xs text-inalde-gray mt-3">Proyecto: <strong className="text-inalde-text">{data.proyecto}</strong></p>}
            </div>
          ) : (
            <>
              <div className="rounded border-l-4 border-inalde-red bg-inalde-red/5 p-5 mb-6">
                <p className="text-xs uppercase tracking-wider text-inalde-gray mb-1">{data.evento}</p>
                <p className="text-2xl font-primary font-bold text-inalde-text">{data.proyecto}</p>
                {data.sector && <p className="text-xs text-inalde-gold mt-1">{data.sector}</p>}
              </div>

              <div className="grid sm:grid-cols-2 gap-4 mb-6">
                <div className="rounded border border-inalde-gray-light p-4">
                  <p className="text-[10px] uppercase tracking-wider text-inalde-gray mb-1">Fecha</p>
                  <p className="font-semibold text-inalde-text capitalize">{data.fecha_legible}</p>
                </div>
                <div className="rounded border border-inalde-gray-light p-4">
                  <p className="text-[10px] uppercase tracking-wider text-inalde-gray mb-1">Hora</p>
                  <p className="font-semibold text-inalde-text font-mono">{data.hora_inicio} – {data.hora_fin}</p>
                </div>
                <div className="rounded border border-inalde-gray-light p-4">
                  <p className="text-[10px] uppercase tracking-wider text-inalde-gray mb-1">Jornada</p>
                  <p className="font-semibold text-inalde-text">Jornada {data.jornada}</p>
                </div>
                <div className="rounded border border-inalde-gray-light p-4">
                  <p className="text-[10px] uppercase tracking-wider text-inalde-gray mb-1">Orden de presentación</p>
                  <p className="font-semibold text-inalde-text">Slot {data.slot}</p>
                </div>
              </div>

              {data.autores && <p className="text-xs text-inalde-gray mb-6">Integrantes: {data.autores}</p>}

              <button onClick={agregarCalendario} disabled={bajando} className="btn-inalde-primary inline-flex disabled:opacity-60">
                {bajando ? 'Generando…' : <><span aria-hidden="true">🗓 </span>Agregar a mi calendario</>}
              </button>
              <p className="text-[11px] text-inalde-gray mt-2">Descarga un archivo <code>.ics</code> compatible con Google Calendar, Apple Calendar y Outlook. Incluye un recordatorio el día anterior.</p>
            </>
          )}

          <div className="mt-10 pt-6 border-t border-inalde-gray-light">
            <button onClick={() => navigate('/')} className="text-sm text-inalde-gray hover:text-inalde-text">← Dashboard</button>
          </div>
        </div>
      </main>
    </>
  );
}
