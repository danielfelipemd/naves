import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import { config } from './config.js';
import healthRouter from './routes/health.js';
import authRouter from './routes/auth.js';
import ciiuRouter from './routes/ciiu.js';

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

// 404 + error handlers
app.use((_req, res) => res.status(404).json({ error: 'NOT_FOUND' }));
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'INTERNAL', message: err.message });
});

app.listen(config.port, () => {
  console.log(`naves-backend listening on :${config.port} (${config.nodeEnv})`);
});
