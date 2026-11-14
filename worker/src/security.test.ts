import { describe, expect, it } from 'vitest';
import { SECURITY_HEADERS, withSecurityHeaders } from './security.js';

describe('security headers', () => {
  it('locks down scripts but allows Data Dragon images', () => {
    const csp = SECURITY_HEADERS['Content-Security-Policy']!;

    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain('https://ddragon.leagueoflegends.com');

    // Cloudflare Web Analytics: the injected beacon script and its
    // measurement endpoint must both pass CSP or every page logs a violation.
    expect(csp).toContain('https://static.cloudflareinsights.com');
    expect(csp).toContain('https://cloudflareinsights.com');

    // AdSense domains must not be allowed by the CSP.
    expect(csp).not.toMatch(
      /googlesyndication|googleadservices|doubleclick|adtrafficquality|googletagservices|adservice\.google/i,
    );

    // Inline JavaScript must not be allowed.
    const scriptSrc = csp.match(/script-src ([^;]+)/)?.[1] ?? '';
    expect(scriptSrc).not.toContain("'unsafe-inline'");
  });

  it('names no Permissions-Policy feature browsers do not recognize', () => {
    // browsing-topics never shipped broadly; Chrome logs "Unrecognized
    // feature" for it on every load.
    expect(SECURITY_HEADERS['Permissions-Policy']).not.toContain('browsing-topics');
    expect(SECURITY_HEADERS['Permissions-Policy']).toContain('camera=()');
  });

  it('sets HSTS and anti-sniffing headers', () => {
    expect(SECURITY_HEADERS['Strict-Transport-Security']).toContain('max-age=');
    expect(SECURITY_HEADERS['X-Content-Type-Options']).toBe('nosniff');
    expect(SECURITY_HEADERS['X-Frame-Options']).toBe('DENY');
  });

  it('merges headers onto a response without losing body or status', async () => {
    const res = withSecurityHeaders(new Response('hello', { status: 201 }));
    expect(res.status).toBe(201);
    expect(await res.text()).toBe('hello');
    expect(res.headers.get('Content-Security-Policy')).toBeTruthy();
  });
});
