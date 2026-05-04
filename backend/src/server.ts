import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import { config } from './config.js';
import healthRouter from './routes/health.js';
import authRouter from './routes/auth.js';
import ciiuRouter from './routes/ciiu.js';
import adminRouter from './routes/admin.js';
import sabanaRouter from './routes/sabana.js';
import equiposRouter from './routes/equipos.js';
import participantesRouter from './routes/participantes.js';
import anteproyectosRouter from './routes/anteproyectos.js';
import seleccionRouter from './routes/seleccion.js';
import rolesRouter from './routes/roles.js';

const app = express();

app.use(helmet());
app.use(cors({
  origin: config.cors.origins.length ? config.cors.origins : true,
  credentials: true,
}));
app.use(express.json({ limit: '1mb' }));
app.use(morgan('combined'));

// Rate limiters
const authLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 30 });
const ciiuLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 200 });

app.use('/', healthRouter);
app.use('/api/auth', authLimiter, authRouter);
app.use('/api/ciiu', ciiuLimiter, ciiuRouter);
app.use('/api/admin', adminRouter);
app.use('/api/sabana', sabanaRouter);
app.use('/api/equipos', equiposRouter);
app.use('/api/participantes', participantesRouter);
app.use('/api/anteproyectos', anteproyectosRouter);
app.use('/api', seleccionRouter); // monta /equipos/:id/marcar-reunion-1, /equipos/:id/seleccionar-proyecto-definitivo, /proyectos/:id/solicitar-desarchivar, /admin/solicitudes-desarchivado/:id/(aprobar|rechazar)
app.use('/api/admin/roles', rolesRouter);

// 404 + error handlers
app.use((_req, res) => res.status(404).json({ error: 'NOT_FOUND' }));
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'INTERNAL', message: err.message });
});

app.listen(config.port, () => {
  console.log(`naves-backend listening on :${config.port} (${config.nodeEnv})`);
});
