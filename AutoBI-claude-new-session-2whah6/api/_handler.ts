import type { IncomingMessage, ServerResponse } from 'node:http';
import { aiMiddleware } from '../server/azureFoundry.js';
import { warehouseMiddleware } from '../server/warehouses.js';

/**
 * Vercel serverless entry points for the same server-side proxies the Vite
 * dev/preview server mounts. Secrets are read from the project's environment
 * variables at request time and never reach the browser bundle.
 * (Files starting with "_" are not deployed as routes themselves.)
 */
const notFound = (res: ServerResponse) => {
  res.statusCode = 404;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ error: 'Unknown route' }));
};

export const aiHandler = (req: IncomingMessage, res: ServerResponse) => aiMiddleware(process.env)(req, res, () => notFound(res));
export const warehouseHandler = (req: IncomingMessage, res: ServerResponse) => warehouseMiddleware(process.env)(req, res, () => notFound(res));
