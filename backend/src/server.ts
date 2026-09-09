import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import { config } from './config.js';
import healthRouter from './routes/health.js';
import authRouter from './routes/auth.js';
import ciiuRouter from './routes/ciiu.js';
import adminRouter from './routes/admin.js';
import sabanaRouter from './routes/sabana.js';
import equiposRouter from './routes/equipos.js';
import participantesRouter from './routes/participantes.js';
import anteproyectosRouter from './routes/anteproyectos.js';
import panelistasRouter from './routes/panelistas.js';
import programacionRouter from './routes/programacion.js';
import programacionInternaRouter from './routes/programacion-interna.js';
import proyectosDbRouter from './routes/proyectos-db.js';
import notificacionesRouter from './routes/notificaciones.js';
import trabajosGradoRouter from './routes/trabajos-grado.js';
import archivosProxyRouter from './routes/archivos-proxy.js';
import seleccionRouter from './routes/seleccion.js';
import rolesRouter from './routes/roles.js';
import cohortesRouter from './routes/cohortes.js';
import directoresRouter from './routes/directores.js';
import profesorConsultaRouter from './routes/profesor-consulta.js';
import trabajosSectorRouter from './routes/trabajos-sector.js';
import actasRouter from './routes/actas.js';
import dashboardControlRouter from './routes/dashboard-control.js';
import aolRouter from './routes/aol.js';

// === Red de seguridad del proceso ==========================================
// Operaciones best-effort (notificaciones por correo, updates fire-and-forget a
// Supabase) pueden RECHAZAR ante un blip de red. Sin estos handlers, una promesa
// rechazada sin catch mata el proceso Node (comportamiento por defecto >=15) y
// tumba TODO el backend (502 hasta que el contenedor reinicia). Logueamos el
// problema y mantenemos el proceso vivo en vez de caer en un crash-loop.
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
});

const app = express();

// Detrás del proxy de EasyPanel/Traefik. Sin esto req.ip es la IP del proxy:
// el registro de accesos guardaría siempre la misma IP y los rate limiters por
// IP tratarían a todos los usuarios como uno solo.
app.set('trust proxy', 1);

app.use(helmet());
app.use(cors({
  origin: config.cors.origins.length ? config.cors.origins : true,
  credentials: true,
}));
app.use(express.json({ limit: '1mb' }));
app.use(morgan('combined'));

// Rate limiters
// - sensitiveAuthLimiter: solo endpoints que NO requieren auth (anti fuerza bruta).
//   /verificar-cedula y /recovery son los unicos publicos -> 30/h por IP es razonable.
// - authLimiter: aplica a TODO el router de auth pero relajado (incluye /me que
//   se llama en cada navegacion). 600/h cubre uso intensivo de una cohorte
//   institucional desde el mismo WiFi (varios participantes compartiendo IP).
const sensitiveAuthLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 50 });
const authLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 600 });
const ciiuLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 1000 });

// Health: montado en '/' y tambien bajo '/api'. El '/api' importa porque el
// proxy solo enruta /api/* al backend (en '/' contesta el frontend con su HTML),
// y va ANTES del catch-all `app.use('/api', seleccionRouter)`, que aplica
// requireAuth global y devolvia MISSING_BEARER a los sondeos de monitoreo.
app.use('/', healthRouter);
app.use('/api', healthRouter);
// Proxy publico (auth via token efimero en query string) — antes de cualquier
// router con requireAuth para que no se aplique el middleware global de auth.
app.use('/api/archivos', archivosProxyRouter);
// La vista de trabajos por sector tiene una ruta PÚBLICA (/publico/:cohorteId,
// protegida por clave, no por sesión). Debe montarse ANTES del catch-all
// '/api' de seleccionRouter (que aplica requireAuth global); si no, un visitante
// sin sesión recibe MISSING_BEARER aunque tenga la clave. Sus rutas /admin/*
// llevan su propio requireAuth+super_admin.
app.use('/api/trabajos-sector', trabajosSectorRouter);
// Actas: el microformulario de jurados (/micro/:token) es PÚBLICO (sin login),
// por eso el router va antes del catch-all '/api' de seleccionRouter (que aplica
// requireAuth global). Sus rutas de administración llevan su propio auth.
app.use('/api/actas', actasRouter);
app.use('/api/auth/verificar-cedula', sensitiveAuthLimiter);
app.use('/api/auth/recovery', sensitiveAuthLimiter);
app.use('/api/auth', authLimiter, authRouter);
app.use('/api/ciiu', ciiuLimiter, ciiuRouter);
app.use('/api/admin', adminRouter);
app.use('/api/sabana', sabanaRouter);
app.use('/api/equipos', equiposRouter);
app.use('/api/participantes', participantesRouter);
app.use('/api/anteproyectos', anteproyectosRouter);
app.use('/api/panelistas', panelistasRouter);
app.use('/api/programacion', programacionRouter);
app.use('/api/programacion-interna', programacionInternaRouter);
app.use('/api/proyectos-db', proyectosDbRouter);
app.use('/api/notificaciones', notificacionesRouter);
app.use('/api/anteproyectos', trabajosGradoRouter);
app.use('/api', seleccionRouter); // monta /equipos/:id/marcar-reunion-1, /equipos/:id/seleccionar-proyecto-definitivo, /proyectos/:id/solicitar-desarchivar, /admin/solicitudes-desarchivado/:id/(aprobar|rechazar)
app.use('/api/admin/roles', rolesRouter);
app.use('/api/cohortes', cohortesRouter);
app.use('/api/directores', directoresRouter);
app.use('/api/profesor-consulta', profesorConsultaRouter);
app.use('/api/dashboard-control', dashboardControlRouter);
app.use('/api/aol', aolRouter);

// 404 + error handlers
app.use((_req, res) => res.status(404).json({ error: 'NOT_FOUND' }));
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  // Errores de subida (multer). Sin esto caian en el 500 generico y el usuario
  // veia "problema del lado del servidor" al mandar un PDF grande, en vez de
  // enterarse de que el archivo pesa demasiado.
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        error: 'FILE_TOO_LARGE',
        mensaje: 'El archivo supera el tamaño máximo permitido (25 MB). Comprime el PDF e inténtalo de nuevo.',
      });
    }
    return res.status(400).json({ error: 'UPLOAD_ERROR', mensaje: `No pudimos recibir el archivo (${err.code}).` });
  }
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'INTERNAL', message: err.message });
});

app.listen(config.port, () => {
  console.log(`naves-backend listening on :${config.port} (${config.nodeEnv})`);
});
