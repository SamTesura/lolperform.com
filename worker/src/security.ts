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
// Google AdSense requires its script/frame/img/connect domains to be allowlisted,
// and in practice needs 'unsafe-inline' for the scripts it injects. This is a
// deliberate tradeoff for monetization; the site renders no user-supplied HTML
// (all data is numeric/enum from our own D1, escaped by React), so the residual
// XSS surface is low. Everything non-ad stays tightly scoped.
const GOOGLE_ADS = 'https://*.googlesyndication.com https://*.googleadservices.com https://*.google.com https://*.doubleclick.net https://*.adtrafficquality.google';

// Cloudflare Web Analytics: the zone auto-injects its beacon script into HTML
// responses, and the beacon posts its measurements back to cloudflareinsights.
// Without both entries the console shows a CSP violation on every page load.
const CF_INSIGHTS_SCRIPT = 'https://static.cloudflareinsights.com';
const CF_INSIGHTS_CONNECT = 'https://cloudflareinsights.com';

const CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  `img-src 'self' data: https://ddragon.leagueoflegends.com https://*.gstatic.com ${GOOGLE_ADS}`,
  `script-src 'self' 'unsafe-inline' ${CF_INSIGHTS_SCRIPT} https://adservice.google.com https://*.googletagservices.com ${GOOGLE_ADS}`,
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  // Data Dragon in connect-src: the item tooltips fetch item.json (names +
  // short descriptions) client-side from the same read-only static CDN that
  // already serves all champion/item art.
  `connect-src 'self' https://ddragon.leagueoflegends.com ${CF_INSIGHTS_CONNECT} ${GOOGLE_ADS}`,
  `frame-src ${GOOGLE_ADS}`,
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
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) headers.set(k, v);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
