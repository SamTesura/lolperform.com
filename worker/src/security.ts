/**
 * Security headers applied to every response the Worker emits — both API JSON and
 * the static site served through the ASSETS binding.
 *
 * CSP notes:
 * - `script-src 'self'`: Astro ships island hydration as external module scripts;
 *   no inline scripts are allowed.
 * - `style-src 'self' 'unsafe-inline'`: Astro inlines small critical CSS. Inline
 *   styles are low risk; inline scripts are not, hence the asymmetry.
 * - `img-src` allows the Data Dragon CDN (champion/item art) and data: URIs.
 */
const CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "img-src 'self' https://ddragon.leagueoflegends.com data:",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "connect-src 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  'upgrade-insecure-requests',
].join('; ');

export const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy': CSP,
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), browsing-topics=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'X-Frame-Options': 'DENY',
};

/** Return a new Response with the security headers merged in. */
export function withSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) headers.set(k, v);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
