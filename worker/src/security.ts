/**
 * Security headers applied to every response the Worker emits: API JSON and
 * the static site served through the ASSETS binding.
 *
 * HTML responses receive a fresh CSP nonce. HTMLRewriter adds that nonce
 * to inline script elements so they are authorized by the CSP.
 *
 * - img-src allows the Data Dragon CDN and data: URIs.
 * - script-src allows first-party scripts, Cloudflare Web Analytics, and
 *   nonce-authorized inline scripts.
 * - style-src 'unsafe-inline' is retained because Astro can inline small
 *   critical CSS during production builds.
 */

const CF_INSIGHTS_SCRIPT = 'https://static.cloudflareinsights.com';
const CF_INSIGHTS_CONNECT = 'https://cloudflareinsights.com';

function buildCsp(nonce?: string): string {
  const nonceSource = nonce ? `'nonce-${nonce}' ` : '';

  return [
    "default-src 'self'",
    "base-uri 'self'",
    `img-src 'self' data: https://ddragon.leagueoflegends.com https://*.gstatic.com`,
    `script-src 'self' ${nonceSource}${CF_INSIGHTS_SCRIPT}`,
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    `connect-src 'self' https://ddragon.leagueoflegends.com ${CF_INSIGHTS_CONNECT}`,
    "frame-src 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    'upgrade-insecure-requests',
  ].join('; ');
}

function createNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

export const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy': buildCsp(),
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'X-Frame-Options': 'DENY',
};

/** Return a new Response with security headers applied. */
export function withSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  const contentType = headers.get('Content-Type') ?? '';
  const isHtml = contentType.toLowerCase().includes('text/html');

  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    headers.set(key, value);
  }

  if (!isHtml) {
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }

  const nonce = createNonce();

  headers.set('Content-Security-Policy', buildCsp(nonce));

  // Nonce-bearing HTML must not be reused from a cache.
  headers.set('Cache-Control', 'private, no-store');

  const nonceResponse = new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });

  return new HTMLRewriter()
    .on('script', {
      element(element) {
        // Add the nonce to inline scripts, not external script elements.
        if (!element.hasAttribute('src')) {
          element.setAttribute('nonce', nonce);
        }
      },
    })
    .transform(nonceResponse);
}
