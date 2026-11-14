
/**
 * Security headers applied to every response the Worker emits: API JSON and the
 * static site served through the ASSETS binding.
 *
 * CSP:
 * - `img-src` allows the Data Dragon CDN (champion and item art) and data: URIs.
 * - `script-src` allows first-party scripts and the Cloudflare Web Analytics
 *   beacon. No inline JavaScript is permitted.
 * - `style-src 'unsafe-inline'` is retained because Astro can inline small
 *   critical CSS during production builds.
 */

// Cloudflare Web Analytics: the zone auto-injects its external beacon script
// into HTML responses, and the beacon posts its measurements to
// cloudflareinsights. Neither requires 'unsafe-inline' in script-src.
const CF_INSIGHTS_SCRIPT = 'https://static.cloudflareinsights.com';
const CF_INSIGHTS_CONNECT = 'https://cloudflareinsights.com';

const CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  `img-src 'self' data: https://ddragon.leagueoflegends.com https://*.gstatic.com`,
  `script-src 'self' ${CF_INSIGHTS_SCRIPT}`,
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  // Item tooltips fetch item.json (names and short descriptions) from the
  // Data Dragon CDN in the browser.
  `connect-src 'self' https://ddragon.leagueoflegends.com ${CF_INSIGHTS_CONNECT}`,
  // The site does not require embedded third-party frames.
  "frame-src 'none'",
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
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'X-Frame-Options': 'DENY',
};

/** Return a new Response with the security headers merged in. */
export function withSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);

  for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
    headers.set(k, v);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
