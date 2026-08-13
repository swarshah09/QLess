import { Router, type NextFunction, type Request, type Response } from 'express';
import swaggerUi from 'swagger-ui-express';
import { openApiDocument } from '../docs/openapi';

const router = Router();

/** Machine-readable spec, for client generation. */
router.get('/openapi.json', (_req, res) => {
  res.json(openApiDocument);
});

/**
 * Swagger UI. Served with a relaxed CSP because Helmet's default
 * `script-src 'self'` blocks the inline bootstrap the UI needs; the scope is
 * limited to this route rather than weakening the whole app.
 */
router.use(
  '/',
  (_req: Request, res: Response, next: NextFunction) => {
    res.removeHeader('Content-Security-Policy');
    next();
  },
  swaggerUi.serve,
  swaggerUi.setup(openApiDocument, {
    customSiteTitle: 'QLess API',
    swaggerOptions: { persistAuthorization: true },
  }),
);

export default router;
