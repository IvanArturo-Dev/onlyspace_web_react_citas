import 'express-async-errors';
import express, { Application, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { router } from './routes';
import { errorMiddleware } from './middleware/error';
import { defaultRateLimit } from './middleware/rateLimit';

const app: Application = express();

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(defaultRateLimit);

// Logging
app.use(
  pinoHttp({
    // logger: {
    //   info: (msg) => console.info(msg),
    //   warn: (msg) => console.warn(msg),
    //   error: (msg) => console.error(msg),
    // },
    level: process.env.LOG_LEVEL || 'info',
  })
);

// Routes
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/v1', router);

// Error handling
app.use(errorMiddleware);

export default app;
