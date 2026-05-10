import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './auth/store';
import Login from './pages/auth/Login';
import Recovery from './pages/auth/Recovery';
import ResetPassword from './pages/auth/ResetPassword';
import Dashboard from './pages/Dashboard';
import MiEquipo from './pages/participante/MiEquipo';
import Anteproyecto from './pages/participante/Anteproyecto';
import TrabajoGrado from './pages/participante/TrabajoGrado';
import SeleccionDefinitivo from './pages/participante/SeleccionDefinitivo';
import MiProfesor from './pages/participante/MiProfesor';
import AdminLayout from './pages/admin/AdminLayout';
import AdminResumen from './pages/admin/Resumen';
import AdminCohortes from './pages/admin/Cohortes';
import AdminParticipantes from './pages/admin/Participantes';
import AdminProfesores from './pages/admin/Profesores';
import AdminAnteproyectos from './pages/admin/Anteproyectos';
import AdminAnteproyectoDetail from './pages/admin/AnteproyectoDetail';
import AdminSabana from './pages/admin/Sabana';
import AdminSolicitudes from './pages/admin/Solicitudes';
import AdminAuditoria from './pages/admin/Auditoria';
import AdminRolesPermisos from './pages/admin/RolesPermisos';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center text-inalde-gray">Cargando…</div>;
  if (!session) return <Navigate to="/login" replace />;
  return <>{children}</>;
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

        <Route path="/" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
        <Route path="/equipo" element={<ProtectedRoute><MiEquipo /></ProtectedRoute>} />
        <Route path="/anteproyecto" element={<ProtectedRoute><Anteproyecto /></ProtectedRoute>} />
        <Route path="/trabajo-grado" element={<ProtectedRoute><TrabajoGrado /></ProtectedRoute>} />
        <Route path="/seleccion" element={<ProtectedRoute><SeleccionDefinitivo /></ProtectedRoute>} />
        <Route path="/mi-profesor" element={<ProtectedRoute><MiProfesor /></ProtectedRoute>} />

        <Route path="/admin" element={<AdminRoute><AdminLayout /></AdminRoute>}>
          <Route index element={<AdminResumen />} />
          <Route path="cohortes" element={<AdminCohortes />} />
          <Route path="participantes" element={<AdminParticipantes />} />
          <Route path="profesores" element={<AdminProfesores />} />
          <Route path="anteproyectos" element={<AdminAnteproyectos />} />
          <Route path="anteproyectos/:id" element={<AdminAnteproyectoDetail />} />
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
