import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuth, esRolArea } from './auth/store';
import ProgramacionInterna from './pages/ProgramacionInterna';
import Login from './pages/auth/Login';
import Recovery from './pages/auth/Recovery';
import ResetPassword from './pages/auth/ResetPassword';
import CambiarClaveInicial from './pages/auth/CambiarClaveInicial';
import Dashboard from './pages/Dashboard';
import MiEquipo from './pages/participante/MiEquipo';
import MiPerfil from './pages/participante/MiPerfil';
import Anteproyecto from './pages/participante/Anteproyecto';
import TrabajoGrado from './pages/participante/TrabajoGrado';
import SeleccionDefinitivo from './pages/participante/SeleccionDefinitivo';
import MiProfesor from './pages/participante/MiProfesor';
import SabanaSocios from './pages/participante/SabanaSocios';
import MiPresentacion from './pages/participante/MiPresentacion';
import ConfirmarAsistencia from './pages/panelista/ConfirmarAsistencia';
import AdminPanelistas from './pages/admin/Panelistas';
import AdminProgramacion from './pages/admin/Programacion';
import AdminProyectosDB from './pages/admin/ProyectosDB';
import ProfesorSeleccionarProyectos from './pages/profesor/SeleccionarProyectos';
import AdminLayout from './pages/admin/AdminLayout';
import AdminResumen from './pages/admin/Resumen';
import AdminCohortes from './pages/admin/Cohortes';
import AdminParticipantes from './pages/admin/Participantes';
import AdminProfesores from './pages/admin/Profesores';
import AdminDirectores from './pages/admin/Directores';
import AdminAnteproyectos from './pages/admin/Anteproyectos';
import AdminEquipos from './pages/admin/Equipos';
import AdminAnteproyectoDetail from './pages/admin/AnteproyectoDetail';
import AdminSabana from './pages/admin/Sabana';
import AdminSolicitudes from './pages/admin/Solicitudes';
import AdminAuditoria from './pages/admin/Auditoria';
import AdminRolesPermisos from './pages/admin/RolesPermisos';

function ProtectedRoute({ children, requierePerfilOk = false }: { children: React.ReactNode; requierePerfilOk?: boolean }) {
  const { session, loading, role, requiereCambioClave, requierePerfil } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center text-inalde-gray">Cargando…</div>;
  if (!session) return <Navigate to="/login" replace />;
  if (requiereCambioClave) return <Navigate to="/cambiar-clave-inicial" replace />;
  // El staff de área no es participante: el dashboard y las pantallas de equipo
  // no significan nada para ellos. Su sistema es la Programación Interna.
  if (esRolArea(role)) return <Navigate to="/programacion-interna" replace />;
  if (requierePerfilOk && requierePerfil) return <Navigate to="/mi-perfil" replace />;
  return <>{children}</>;
}

// Programación Interna: el staff de área y, para poder verificar lo que publica,
// el super_admin. El backend manda igual (permiso programacion_interna.ver).
function ProgramacionInternaRoute() {
  const { session, loading, role } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center text-inalde-gray">Cargando…</div>;
  if (!session) return <Navigate to="/login" replace />;
  if (!esRolArea(role) && role !== 'super_admin') return <Navigate to="/" replace />;
  return <ProgramacionInterna />;
}

function CambiarClaveRoute() {
  const { session, loading, requiereCambioClave } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center text-inalde-gray">Cargando…</div>;
  if (!session) return <Navigate to="/login" replace />;
  if (!requiereCambioClave) return <Navigate to="/" replace />;
  return <CambiarClaveInicial />;
}

// Acceso al layout /admin: admite super_admin y profesor. Cada pantalla
// individual decide su propia restriccion via SuperAdminOnly (ver abajo).
function AdminRoute({ children }: { children: React.ReactNode }) {
  const { session, loading, role } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center text-inalde-gray">Cargando…</div>;
  if (!session) return <Navigate to="/login" replace />;
  if (role !== 'super_admin' && role !== 'profesor') return <Navigate to="/" replace />;
  return <>{children}</>;
}

// Wrapper para las pantallas /admin/* que son exclusivas de super_admin
// (cohortes, participantes, profesores, directores, equipos, auditoria,
// roles-permisos, resumen). El profesor que llegue aqui es rebotado al
// dashboard. Sabana, anteproyectos y solicitudes NO usan este wrapper
// porque tambien son accesibles para profesor (con filtros backend).
function SuperAdminOnly({ children }: { children: React.ReactNode }) {
  const { role } = useAuth();
  if (role !== 'super_admin') return <Navigate to="/" replace />;
  return <>{children}</>;
}

export default function App() {
  const init = useAuth((s) => s.init);
  useEffect(() => { init(); }, [init]);

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/recovery" element={<Recovery />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/cambiar-clave-inicial" element={<CambiarClaveRoute />} />
        <Route path="/panelista/confirmar" element={<ConfirmarAsistencia />} />

        <Route path="/" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
        <Route path="/mi-perfil" element={<ProtectedRoute><MiPerfil /></ProtectedRoute>} />
        <Route path="/equipo" element={<ProtectedRoute requierePerfilOk><MiEquipo /></ProtectedRoute>} />
        <Route path="/anteproyecto" element={<ProtectedRoute requierePerfilOk><Anteproyecto /></ProtectedRoute>} />
        <Route path="/trabajo-grado" element={<ProtectedRoute><TrabajoGrado /></ProtectedRoute>} />
        <Route path="/seleccion" element={<ProtectedRoute requierePerfilOk><SeleccionDefinitivo /></ProtectedRoute>} />
        <Route path="/mi-profesor" element={<ProtectedRoute><MiProfesor /></ProtectedRoute>} />
        <Route path="/sabana-proyectos" element={<ProtectedRoute><SabanaSocios /></ProtectedRoute>} />
        <Route path="/mi-presentacion" element={<ProtectedRoute><MiPresentacion /></ProtectedRoute>} />
        <Route path="/programacion-interna" element={<ProgramacionInternaRoute />} />
        <Route path="/profesor/seleccionar-proyectos" element={<ProtectedRoute><ProfesorSeleccionarProyectos /></ProtectedRoute>} />

        <Route path="/admin" element={<AdminRoute><AdminLayout /></AdminRoute>}>
          <Route index element={<SuperAdminOnly><AdminResumen /></SuperAdminOnly>} />
          <Route path="cohortes" element={<SuperAdminOnly><AdminCohortes /></SuperAdminOnly>} />
          <Route path="participantes" element={<SuperAdminOnly><AdminParticipantes /></SuperAdminOnly>} />
          <Route path="profesores" element={<SuperAdminOnly><AdminProfesores /></SuperAdminOnly>} />
          <Route path="directores" element={<SuperAdminOnly><AdminDirectores /></SuperAdminOnly>} />
          <Route path="anteproyectos" element={<AdminAnteproyectos />} />
          <Route path="anteproyectos/:id" element={<AdminAnteproyectoDetail />} />
          <Route path="equipos" element={<SuperAdminOnly><AdminEquipos /></SuperAdminOnly>} />
          <Route path="sabana" element={<AdminSabana />} />
          <Route path="panelistas" element={<SuperAdminOnly><AdminPanelistas /></SuperAdminOnly>} />
          <Route path="programacion" element={<SuperAdminOnly><AdminProgramacion /></SuperAdminOnly>} />
          <Route path="proyectos-db" element={<SuperAdminOnly><AdminProyectosDB /></SuperAdminOnly>} />
          <Route path="solicitudes" element={<AdminSolicitudes />} />
          <Route path="auditoria" element={<SuperAdminOnly><AdminAuditoria /></SuperAdminOnly>} />
          <Route path="roles-permisos" element={<SuperAdminOnly><AdminRolesPermisos /></SuperAdminOnly>} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
