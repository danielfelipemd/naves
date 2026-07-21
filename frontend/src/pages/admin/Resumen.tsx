import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../auth/store';
import { api } from '../../lib/api';

interface Cohorte { id: string; etiqueta: string; activa: boolean; participantes_count: number; equipos_count: number; }

interface HintData { cohortes: Cohorte[]; profesores: number; antesEnviados: number; }

interface Section {
  to: string;
  icon: string;
  title: string;
  desc: string;
  hint?: (data: HintData) => string;
}

interface Group {
  title: string;
  items: Section[];
}

// Panel administrativo reorganizado en 3 bloques (QA JMV 20-jul-2026):
// Admon Cohortes · Admon Profesores · Admon Sistema.
const GROUPS: Group[] = [
  {
    title: 'Admon Cohortes',
    items: [
      {
        to: '/admin/cohortes', icon: '📅',
        title: 'Configurar cohortes',
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
        to: '/admin/equipos', icon: '👥',
        title: 'Equipos',
        desc: 'Edita los miembros de los equipos ya creados. Agrega o quita participantes de cada equipo.',
      },
      {
        to: '/admin/anteproyectos', icon: '📋',
        title: 'Anteproyectos',
        desc: 'Lista todos los anteproyectos con filtros por cohorte y estado. Entra al detalle de cada uno.',
        hint: (d) => `${d.antesEnviados} enviados`,
      },
      {
        to: '/admin/sabana', icon: '📑',
        title: 'Sábana de anteproyectos',
        desc: 'Vista consolidada por cohorte para la reunión de asignación. Genera, sugiere asignaciones y comunica a los equipos.',
      },
      {
        to: '/admin/proyectos-db', icon: '🗂️',
        title: 'Trabajos de grado definitivos',
        desc: 'Vista interna de los proyectos definitivos de la cohorte con su horario de presentación, sector, autores, resumen y post de LinkedIn. Exporta a Excel (comunicaciones + programación).',
      },
      {
        to: '/admin/trabajos-sector', icon: '🗂️',
        title: 'Trabajos por sector (público)',
        desc: 'Vista de los trabajos definitivos agrupada por sector, protegida con clave para compartir. Marca proyectos confidenciales (sin descargas).',
      },
      {
        to: '/admin/dashboard-control', icon: '📊',
        title: 'Dashboard de control',
        desc: 'Panel de control de la cohorte: indicadores clave, avance del proceso (equipos, anteproyectos, reuniones, definitivos, programación), actas e informe, y caracterización por modalidad y perfil emprendedor.',
      },
      {
        to: '/admin/aol', icon: '🎓',
        title: 'AoL — Assurance of Learning',
        desc: 'Calificación AACSB de los Business Plan (competency goal Entrepreneurship): trabajos por calificar, análisis IA del calificador, rúbrica de 6 traits e informe de cohorte.',
      },
      {
        to: '/admin/actas', icon: '📜',
        title: 'Actas de grado',
        desc: 'Genera y administra las actas del Proyecto de Grado MBA (Formato v3): una por participante, cadena de firmas (BP y Caso/PI), firma en lote y microformularios de jurados.',
      },
      {
        to: '/admin/programacion', icon: '📆',
        title: 'Programación',
        desc: 'Asigna los proyectos a los slots de cada jornada: horarios calculados automáticamente, breaks por bloque y Excel de calificación para los panelistas.',
      },
    ],
  },
  {
    title: 'Admon Profesores',
    items: [
      {
        to: '/admin/profesores', icon: '👨‍🏫',
        title: 'Profesores NAVES',
        desc: 'Crea, edita o desactiva profesores. Configura su URL de booking y áreas de afinidad.',
        hint: (d) => `${d.profesores} registrados`,
      },
      {
        to: '/admin/directores', icon: '🎓',
        title: 'Directores de casos y P.I.',
        desc: 'Gestiona la lista de directores para Caso y Proyecto de Investigación. No ingresan al sistema; reciben notificaciones por correo.',
      },
      {
        to: '/admin/panelistas', icon: '🧑‍⚖️',
        title: 'Panelistas',
        desc: 'Evaluadores externos por cohorte: jornadas de presentación, confirmación de asistencia por link y logística (transporte y comidas).',
      },
    ],
  },
  {
    title: 'Admon Sistema',
    items: [
      {
        to: '/admin/roles-permisos', icon: '🔐',
        title: 'Roles y permisos',
        desc: 'Crea roles personalizados, define qué puede hacer cada uno y asigna roles a profesores y participantes.',
      },
      {
        to: '/admin/auditoria', icon: '🔍',
        title: 'Auditorías',
        desc: 'Registro cronológico de eventos del sistema (cambios en equipos, anteproyectos, asignaciones).',
      },
    ],
  },
];

export default function Resumen() {
  const { nombre } = useAuth();
  const [data, setData] = useState({
    cohortes: [] as Cohorte[],
    profesores: 0,
    antesEnviados: 0,
    loading: true,
  });

  useEffect(() => { (async () => {
    try {
      const [c, p, a] = await Promise.all([
        api.get('/admin/cohortes'),
        api.get('/admin/profesores'),
        api.get('/admin/anteproyectos'),
      ]);
      setData({
        cohortes: c.data,
        profesores: p.data.length,
        antesEnviados: a.data.filter((x: any) => x.estado === 'enviado').length,
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

      <div className="flex flex-col gap-10">
        {GROUPS.map((g) => (
          <section key={g.title}>
            <h2 className="font-primary font-bold text-sm uppercase tracking-widest text-inalde-red mb-4 pb-2 border-b border-inalde-gray-light">
              {g.title}
            </h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {g.items.map((s) => {
                const hint = !data.loading && s.hint ? s.hint(data) : null;
                return (
                  <Link
                    key={s.to}
                    to={s.to}
                    className="group flex flex-col gap-3 p-5 rounded border-2 transition
                      border-inalde-gray-light hover:border-inalde-red
                      hover:shadow-inalde-card-hover hover:-translate-y-0.5"
                  >
                    <div className="flex items-start justify-between">
                      <span className="text-3xl">{s.icon}</span>
                      {hint && (
                        <span className="text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded bg-inalde-gray-bg text-inalde-gray">
                          {hint}
                        </span>
                      )}
                    </div>
                    <h3 className="font-primary font-bold text-lg text-inalde-text">{s.title}</h3>
                    <p className="text-sm text-inalde-gray leading-snug flex-1">{s.desc}</p>
                    <span className="text-xs font-semibold tracking-wider uppercase text-inalde-red group-hover:text-inalde-red-hover">
                      Entrar →
                    </span>
                  </Link>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      <div className="mt-10 pt-6 border-t border-inalde-gray-light">
        <Link to="/" className="text-xs text-inalde-gray hover:text-inalde-red">← Volver al dashboard general</Link>
      </div>
    </>
  );
}
