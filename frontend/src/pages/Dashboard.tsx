import { Header } from '../components/inalde/Header';
import { useAuth } from '../auth/store';

export default function Dashboard() {
  const { user, role, signOut } = useAuth();

  const entregas = [
    {
      icon: '📋',
      title: 'Anteproyecto NAVES',
      desc: 'Primera etapa — Tu idea de negocio en síntesis',
      detalles: 'Problema · Cliente · Ingresos · Equipo · Cronograma',
      href: '/equipo',
      enabled: true,
    },
    {
      icon: '📊',
      title: 'Business Plan Final',
      desc: 'Segunda etapa — Tu plan de negocio completo',
      detalles: 'Mercado · Financiero · Operaciones · Riesgos',
      href: '#',
      enabled: false,
    },
  ];

  return (
    <>
      <Header />
      <main className="pt-36 pb-16 px-4">
        <div className="max-w-[900px] mx-auto bg-white rounded-lg shadow-inalde-card p-10">
          <div className="border-b-[3px] border-inalde-red pb-6 mb-8 flex items-start justify-between gap-4">
            <div>
              <h1 className="section-title mb-2">Entregas NAVES</h1>
              <p className="text-inalde-gray text-sm leading-relaxed">
                Selecciona la entrega de trabajo de grado que deseas completar.
              </p>
            </div>
            <button onClick={signOut} className="text-sm text-inalde-gray hover:text-inalde-red">
              Salir
            </button>
          </div>

          <div className="text-xs text-inalde-gray mb-8">
            Sesión: <span className="text-inalde-text">{user?.email}</span> · Rol:{' '}
            <span className="text-inalde-red font-semibold uppercase tracking-wider">{role}</span>
          </div>

          <div className="grid sm:grid-cols-2 gap-8">
            {entregas.map((e) => (
              <a
                key={e.title}
                href={e.enabled ? e.href : undefined}
                className={`card-inalde flex flex-col gap-4 text-center ${
                  e.enabled ? 'card-inalde-interactive' : 'opacity-60 pointer-events-none'
                }`}
              >
                <div className="text-5xl">{e.icon}</div>
                <h2 className="font-primary font-bold text-xl">{e.title}</h2>
                <p className="text-inalde-gray text-sm">{e.desc}</p>
                <p className="text-xs font-semibold tracking-wider text-inalde-gold">{e.detalles}</p>
                <div className="mt-auto">
                  {e.enabled ? (
                    <span className="btn-inalde-primary">Comenzar →</span>
                  ) : (
                    <span className="inline-block bg-inalde-gray-bg text-inalde-gray px-5 py-3 rounded-full text-xs font-semibold">
                      🔒 Próximamente
                    </span>
                  )}
                </div>
              </a>
            ))}
          </div>

          <p className="mt-12 pt-8 border-t border-inalde-gray-light text-center text-sm text-inalde-gray">
            <strong>Nota:</strong> El formulario de Anteproyecto es el primer hito del proceso NAVES.
            Una vez entregado, no podrá ser modificado.
          </p>
        </div>
      </main>
    </>
  );
}
