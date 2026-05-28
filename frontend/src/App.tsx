import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './auth/store';
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
  const { session, loading, requiereCambioClave, requierePerfil } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center text-inalde-gray">Cargando…</div>;
  if (!session) return <Navigate to="/login" replace />;
  if (requiereCambioClave) return <Navigate to="/cambiar-clave-inicial" replace />;
  if (requierePerfilOk && requierePerfil) return <Navigate to="/mi-perfil" replace />;
  return <>{children}</>;
}

function CambiarClaveRoute() {
  const { session, loading, requiereCambioClave } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center text-inalde-gray">Cargando…</div>;
  if (!session) return <Navigate to="/login" replace />;
  if (!requiereCambioClave) return <Navigate to="/" replace />;
  return <CambiarClaveInicial />;
}

function AdminRoute({ children }: { children: React.ReactNode }) {
  const { session, user, loading } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center text-inalde-gray">Cargando…</div>;
  if (!session) return <Navigate to="/login" replace />;
  const isAdmin = (user?.app_metadata as any)?.es_super_admin === true;
  if (!isAdmin) return <Navigate to="/" replace />;
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

        <Route path="/" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
        <Route path="/mi-perfil" element={<ProtectedRoute><MiPerfil /></ProtectedRoute>} />
        <Route path="/equipo" element={<ProtectedRoute requierePerfilOk><MiEquipo /></ProtectedRoute>} />
        <Route path="/anteproyecto" element={<ProtectedRoute requierePerfilOk><Anteproyecto /></ProtectedRoute>} />
        <Route path="/trabajo-grado" element={<ProtectedRoute><TrabajoGrado /></ProtectedRoute>} />
        <Route path="/seleccion" element={<ProtectedRoute requierePerfilOk><SeleccionDefinitivo /></ProtectedRoute>} />
        <Route path="/mi-profesor" element={<ProtectedRoute><MiProfesor /></ProtectedRoute>} />
        <Route path="/profesor/seleccionar-proyectos" element={<ProtectedRoute><ProfesorSeleccionarProyectos /></ProtectedRoute>} />

        <Route path="/admin" element={<AdminRoute><AdminLayout /></AdminRoute>}>
          <Route index element={<AdminResumen />} />
          <Route path="cohortes" element={<AdminCohortes />} />
          <Route path="participantes" element={<AdminParticipantes />} />
          <Route path="profesores" element={<AdminProfesores />} />
          <Route path="directores" element={<AdminDirectores />} />
          <Route path="anteproyectos" element={<AdminAnteproyectos />} />
          <Route path="anteproyectos/:id" element={<AdminAnteproyectoDetail />} />
          <Route path="equipos" element={<AdminEquipos />} />
          <Route path="sabana" element={<AdminSabana />} />
          <Route path="solicitudes" element={<AdminSolicitudes />} />
          <Route path="auditoria" element={<AdminAuditoria />} />
          <Route path="roles-permisos" element={<AdminRolesPermisos />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
