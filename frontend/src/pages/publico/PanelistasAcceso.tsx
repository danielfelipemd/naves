import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import Panelistas, { ClientePanelistasCtx, type ClientePanelistas } from '../admin/Panelistas';

// Acceso por enlace mágico de la asistente de programa al panel de Panelistas
// (sql/57). Sin cuenta ni clave: el enlace es el permiso, vale para UNA cohorte
// y hasta la fecha que fijó el super admin. Es el mismo panel del admin; solo
// cambia el cliente de la API, que manda el acceso en una cabecera.

const MOTIVO: Record<string, string> = {
  ACCESO_INVALIDO: 'Este enlace no existe o fue reemplazado por uno nuevo.',
  ACCESO_REVOCADO: 'Este acceso fue revocado.',
  ACCESO_VENCIDO: 'Este acceso ya venció.',
};
interface Yo { cohorte_id: string; cohorte: string; nombre: string | null; email: string; vence_at: string }

export default function PanelistasAcceso() {
  const { token = '' } = useParams();
  // Un cliente propio, sin la sesión ni los interceptores de la app: aquí no
  // hay sesión que renovar ni que cerrar.
  const cliente = useMemo<ClientePanelistas>(() => {
    const api = axios.create({ baseURL: '/api', timeout: 30000, headers: { 'X-Acceso-Panelistas': token } });
    const descargar = async (ruta: string, nombre: string) => {
      const r = await api.get(ruta, { responseType: 'blob' });
      const url = URL.createObjectURL(r.data);
      const a = document.createElement('a');
      a.href = url; a.download = nombre;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
    };
    return { api, descargar };
  }, [token]);
  const [yo, setYo] = useState<Yo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    cliente.api.get('/panelistas-acceso/yo')
      .then((r) => setYo(r.data))
      .catch((e) => {
        const codigo = e?.response?.data?.error as string | undefined;
        setError(MOTIVO[codigo ?? ''] ?? 'No pudimos abrir el panel. Revise su conexión y recargue la página.');
      });
  }, [cliente]);

  function renderContenido() {
    if (error) {
      return (
        <div role="alert" className="max-w-[680px] bg-white rounded-lg shadow-inalde-card p-6 border-l-4 border-inalde-red">
          <h1 className="font-primary font-bold text-lg mb-1">No pudimos abrir el panel de panelistas</h1>
          <p className="text-sm text-inalde-gray">{error}</p>
          <p className="text-sm text-inalde-gray mt-2">Pídale un enlace nuevo a la dirección del programa.</p>
        </div>
      );
    }
    if (!yo) return <p className="text-inalde-gray">Cargando…</p>;
    return (
      <ClientePanelistasCtx.Provider value={cliente}>
        <Panelistas acceso={{ cohorte: yo.cohorte_id, etiqueta: yo.cohorte }} />
      </ClientePanelistasCtx.Provider>
    );
  }

  return (
    <div className="min-h-screen bg-inalde-gray-bg/40">
      <header className="bg-inalde-text text-white py-5 px-4">
        <div className="max-w-[1800px] mx-auto flex flex-wrap items-end gap-x-6 gap-y-1">
          <div>
            <p className="text-[11px] uppercase tracking-[2px] text-white/60">Panel de panelistas · NAVES</p>
            <p className="text-lg font-primary font-bold">INALDE Business School — Executive MBA</p>
          </div>
          {yo && (
            <p className="text-sm text-white/70 sm:ml-auto">
              {yo.cohorte} · acceso de {yo.nombre || yo.email} · funciona hasta el{' '}
              {new Date(yo.vence_at).toLocaleString('es-CO', { timeZone: 'America/Bogota', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' })}
            </p>
          )}
        </div>
      </header>
      <main className="max-w-[1800px] mx-auto px-4 py-8">{renderContenido()}</main>
    </div>
  );
}
