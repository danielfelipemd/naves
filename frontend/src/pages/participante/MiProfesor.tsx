import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Header } from '../../components/inalde/Header';
import { api } from '../../lib/api';
import { supabase } from '../../lib/supabase';

export default function MiProfesor() {
  const navigate = useNavigate();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { (async () => {
    try {
      const eq = await api.get('/equipos/mi-equipo');
      if (!eq.data.equipo) { navigate('/'); return; }
      // RLS permite ver la asignación de mi propio equipo
      const { data: arr } = await supabase
        .from('asignaciones_profesor')
        .select('*, profesores(nombre_completo, booking_url, areas_afinidad)')
        .eq('equipo_id', eq.data.equipo.id)
        .limit(1);
      setData(arr?.[0] ?? null);
    } catch {}
    finally { setLoading(false); }
  })(); }, [navigate]);

  if (loading) return <><Header /><main className="pt-36 text-center text-inalde-gray">Cargando…</main></>;

  return (
    <>
      <Header />
      <main className="pt-36 pb-16 px-4">
        <div className="max-w-[640px] mx-auto bg-white rounded-lg shadow-inalde-card p-10">
          <div className="border-b-[3px] border-inalde-red pb-5 mb-8">
            <p className="section-subtitle mb-2">Asignación</p>
            <h1 className="section-title">Mi profesor asignado</h1>
          </div>

          {!data ? (
            <p className="text-inalde-gray">
              Aún no se ha asignado profesor a tu equipo. La asignación se realiza después de que el super admin ejecuta la
              reunión de asignación de profesores con la sábana de proyectos.
            </p>
          ) : (
            <>
              <div className="rounded border-l-4 border-inalde-red bg-inalde-red/5 p-5 mb-6">
                <p className="text-xs uppercase tracking-wider text-inalde-gray mb-1">Profesor</p>
                <p className="text-2xl font-primary font-bold text-inalde-text">{data.profesores.nombre_completo}</p>
                {data.profesores.areas_afinidad?.length > 0 && (
                  <p className="text-xs text-inalde-gray mt-2">
                    Áreas: <span className="text-inalde-gold">{data.profesores.areas_afinidad.join(' · ')}</span>
                  </p>
                )}
              </div>

              {data.profesores.booking_url ? (
                <a href={data.profesores.booking_url} target="_blank" rel="noreferrer" className="btn-inalde-primary inline-flex">
                  Agendar reunión →
                </a>
              ) : (
                <p className="text-sm text-inalde-gray italic">El profesor aún no ha publicado su link de agenda.</p>
              )}

              <p className="text-xs text-inalde-gray mt-6">
                Asignación realizada el {new Date(data.fecha_asignacion).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' })}.
              </p>
            </>
          )}

          <div className="mt-10 pt-6 border-t border-inalde-gray-light">
            <button onClick={() => navigate('/')} className="text-sm text-inalde-gray hover:text-inalde-text">
              ← Dashboard
            </button>
          </div>
        </div>
      </main>
    </>
  );
}
