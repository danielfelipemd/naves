import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './auth/store';
import Login from './pages/auth/Login';
import Dashboard from './pages/Dashboard';
import MiEquipo from './pages/participante/MiEquipo';
import Anteproyecto from './pages/participante/Anteproyecto';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center text-inalde-gray">Cargando…</div>;
  if (!session) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  const init = useAuth((s) => s.init);
  useEffect(() => { init(); }, [init]);

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
        <Route path="/equipo" element={<ProtectedRoute><MiEquipo /></ProtectedRoute>} />
        <Route path="/anteproyecto" element={<ProtectedRoute><Anteproyecto /></ProtectedRoute>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
