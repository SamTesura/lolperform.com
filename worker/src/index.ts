/**
 * lolperform.com edge Worker.
 *
 * Serves the prebuilt Astro site through the ASSETS binding and the read-only
 * `/api/v1/*` surface backed by D1 (+ KV cache). Every response carries the full
 * security-header set; every API query parameter is validated as an enum before
 * it can reach a prepared D1 statement.
 */
import { Router } from 'itty-router';
import type { Env } from './env.js';
import { error } from './http.js';
import { withSecurityHeaders } from './security.js';
import * as api from './api.js';

const router = Router();

router.get('/api/health', (request: Request, env: Env) => api.health(request, env));
router.get('/api/v1/meta', (request: Request, env: Env) => api.meta(request, env));
router.get('/api/v1/tierlist', (request: Request, env: Env) => api.tierlist(request, env));
router.get('/api/v1/champion/:id', (request: Request, env: Env) => api.champion(request, env));
router.get('/api/v1/counters', (request: Request, env: Env) => api.counters(request, env));
router.get('/api/v1/duos', (request: Request, env: Env) => api.duos(request, env));
router.all('/api/*', () => error(404, 'not found'));

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/api/')) {
      let response: Response;
      try {
        response = (await router.fetch(request, env, ctx)) ?? error(404, 'not found');
      } catch {
        response = error(500, 'internal error');
      }
      return withSecurityHeaders(response);
    }

    // Everything else: static site asset.
    const asset = await env.ASSETS.fetch(request);
    return withSecurityHeaders(asset);
  },
} satisfies ExportedHandler<Env>;
