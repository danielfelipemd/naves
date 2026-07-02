import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../auth/store';
import { api } from '../../lib/api';

interface Cohorte { id: string; etiqueta: string; activa: boolean; participantes_count: number; equipos_count: number; }

interface Section {
  to: string;
  icon: string;
  title: string;
  desc: string;
  hint?: (data: { cohortes: Cohorte[]; profesores: number; antesEnviados: number; solicitudesPendientes: number }) => string;
}

const SECTIONS: Section[] = [
  {
    to: '/admin/cohortes', icon: '📅',
    title: 'Cohortes',
    desc: 'Configura las fechas del Scheduler de cada cohorte (formación de equipos, entrega del anteproyecto, Reunión 1, selección del definitivo).',
    hint: (d) => `${d.cohortes.filter(c => c.activa).length} de ${d.cohortes.length} activas`,
  },
  {
    to: '/admin/participantes', icon: '🎓',
    title: 'Cargar participantes',
    desc: 'Sube el Excel con la lista de participantes inscritos en una cohorte (nombre, cédula, email).',
    hint: (d) => `${d.cohortes.reduce((s, c) => s + c.participantes_count, 0)} participantes totales`,
  },
  {
    to: '/admin/profesores', icon: '👨‍🏫',
    title: 'Profesores',
    desc: 'Crea, edita o desactiva profesores. Configura su URL de booking y áreas de afinidad.',
    hint: (d) => `${d.profesores} registrados`,
  },
  {
    to: '/admin/directores', icon: '🎓',
    title: 'Directores',
    desc: 'Gestiona la lista de directores para Caso y Proyecto de Investigación. No ingresan al sistema; reciben notificaciones por correo.',
  },
  {
    to: '/admin/anteproyectos', icon: '📋',
    title: 'Anteproyectos',
    desc: 'Lista todos los anteproyectos con filtros por cohorte y estado. Entra al detalle de cada uno.',
    hint: (d) => `${d.antesEnviados} enviados`,
  },
  {
    to: '/admin/equipos', icon: '👥',
    title: 'Equipos',
    desc: 'Edita los miembros de los equipos ya creados. Agrega o quita participantes de cada equipo.',
  },
  {
    to: '/admin/sabana', icon: '📑',
    title: 'Sábana de proyectos',
    desc: 'Vista consolidada por cohorte para la reunión de asignación. Genera, sugiere asignaciones y comunica a los equipos.',
  },
  {
    to: '/admin/panelistas', icon: '🧑‍⚖️',
    title: 'Panelistas',
    desc: 'Evaluadores externos por cohorte: jornadas de presentación, confirmación de asistencia por link y logística (transporte y comidas).',
  },
  {
    to: '/admin/programacion', icon: '📅',
    title: 'Programación',
    desc: 'Asigna los proyectos a los slots de cada jornada: horarios calculados automáticamente, breaks por bloque y Excel de calificación para los panelistas.',
  },
  {
    to: '/admin/proyectos-db', icon: '🗂️',
    title: 'Base de datos de proyectos',
    desc: 'Vista interna de los proyectos de la cohorte con su horario de presentación, sector, autores, resumen y post de LinkedIn. Exporta a Excel (comunicaciones + programación).',
  },
  {
    to: '/admin/solicitudes', icon: '📨',
    title: 'Solicitudes de desarchivado',
    desc: 'Aprueba o rechaza solicitudes de los equipos para retomar proyectos archivados.',
    hint: (d) => d.solicitudesPendientes > 0 ? `⚠ ${d.solicitudesPendientes} pendientes` : 'sin pendientes',
  },
  {
    to: '/admin/auditoria', icon: '🔍',
    title: 'Auditoría',
    desc: 'Registro cronológico de eventos del sistema (cambios en equipos, anteproyectos, asignaciones).',
  },
  {
    to: '/admin/roles-permisos', icon: '🔐',
    title: 'Roles y permisos',
    desc: 'Crea roles personalizados, define qué puede hacer cada uno y asigna roles a profesores y participantes.',
  },
];

export default function Resumen() {
  const { nombre } = useAuth();
  const [data, setData] = useState({
    cohortes: [] as Cohorte[],
    profesores: 0,
    antesEnviados: 0,
    solicitudesPendientes: 0,
    loading: true,
  });

  useEffect(() => { (async () => {
    try {
      const [c, p, a, s] = await Promise.all([
        api.get('/admin/cohortes'),
        api.get('/admin/profesores'),
        api.get('/admin/anteproyectos'),
        api.get('/admin/solicitudes-desarchivado'),
      ]);
      setData({
        cohortes: c.data,
        profesores: p.data.length,
        antesEnviados: a.data.filter((x: any) => x.estado === 'enviado').length,
        solicitudesPendientes: s.data.filter((x: any) => x.estado === 'pendiente').length,
        loading: false,
      });
    } catch {
      setData((d) => ({ ...d, loading: false }));
    }
  })(); }, []);

  return (
    <>
      <div className="border-b-[3px] border-inalde-red pb-5 mb-8">
        <p className="section-subtitle mb-2">Panel administrativo</p>
        <h1 className="section-title">Selecciona qué quieres administrar</h1>
        <p className="text-sm text-inalde-gray mt-2">
          Sesión: <span className="text-inalde-text">{nombre ?? '—'}</span>
        </p>
      </div>

      {data.loading && <p className="text-inalde-gray text-sm mb-6">Cargando estadísticas…</p>}

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {SECTIONS.map((s) => {
          const hint = !data.loading && s.hint ? s.hint(data) : null;
          const highlight = hint?.startsWith('⚠');
          return (
            <Link
              key={s.to}
              to={s.to}
              className={`group flex flex-col gap-3 p-5 rounded border-2 transition
                ${highlight ? 'border-inalde-red bg-inalde-red/5' : 'border-inalde-gray-light hover:border-inalde-red'}
                hover:shadow-inalde-card-hover hover:-translate-y-0.5`}
            >
              <div className="flex items-start justify-between">
                <span className="text-3xl">{s.icon}</span>
                {hint && (
                  <span className={`text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded
                    ${highlight ? 'bg-inalde-red text-white' : 'bg-inalde-gray-bg text-inalde-gray'}`}>
                    {hint}
                  </span>
                )}
              </div>
              <h2 className="font-primary font-bold text-lg text-inalde-text">{s.title}</h2>
              <p className="text-sm text-inalde-gray leading-snug flex-1">{s.desc}</p>
              <span className="text-xs font-semibold tracking-wider uppercase text-inalde-red group-hover:text-inalde-red-hover">
                Entrar →
              </span>
            </Link>
          );
        })}
      </div>

      <div className="mt-10 pt-6 border-t border-inalde-gray-light">
        <Link to="/" className="text-xs text-inalde-gray hover:text-inalde-red">← Volver al dashboard general</Link>
      </div>
    </>
  );
}
