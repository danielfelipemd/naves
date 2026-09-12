import { Link } from 'react-router-dom';
import { Header } from '../../components/inalde/Header';

/**
 * Descargar Documentos — pantalla del participante.
 *
 * Andamiaje inicial: la tarjeta ya está en el tablero y la ruta responde.
 * El contenido (qué documentos se listan y de dónde salen) está pendiente
 * de definir con el cliente.
 */
export default function DescargarDocumentos() {
  return (
    <>
      <Header />
      <main className="pt-36 pb-16 px-4">
        <div className="max-w-[900px] mx-auto">
          <div className="border-b-[3px] border-inalde-red pb-5 mb-8">
            <p className="section-subtitle mb-2">Trabajo de grado</p>
            <h1 className="section-title">Descargar Documentos</h1>
          </div>

          <div className="card-inalde p-8">
            <p className="text-inalde-gray text-sm">
              Esta sección estará disponible próximamente.
            </p>
          </div>

          <div className="mt-8">
            <Link to="/" className="text-sm font-semibold text-inalde-red hover:text-inalde-red-hover">
              ← Volver al tablero
            </Link>
          </div>
        </div>
      </main>
    </>
  );
}
