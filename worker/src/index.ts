/**
 * lolperform.com edge Worker.
 *
 * P0 skeleton: serves the prebuilt static site via the ASSETS binding and a
 * health probe. The full `/api/v1/*` surface, input validation, D1/KV reads,
 * and the complete security-header set are added in P4.
 */

export interface Env {
  ASSETS: Fetcher;
}

/** Minimal security headers; the strict CSP + full set arrive in P4. */
function securityHeaders(): Record<string, string> {
  return {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'DENY',
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/api/health') {
      return Response.json(
        { status: 'ok', service: 'lolperform-worker' },
        { headers: securityHeaders() },
      );
    }

    // Everything else: serve a static asset from the built site.
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
