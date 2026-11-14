import { describe, expect, it } from 'vitest';
import { SECURITY_HEADERS, withSecurityHeaders } from './security.js';

describe('security headers', () => {
  it('locks down scripts but allows Data Dragon images', () => {
    const csp = SECURITY_HEADERS['Content-Security-Policy']!;

    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain('https://ddragon.leagueoflegends.com');
    expect(csp).toContain('https://static.cloudflareinsights.com');
    expect(csp).toContain('https://cloudflareinsights.com');

    // AdSense domains must not be allowed by the CSP.
    expect(csp).not.toMatch(
      /googlesyndication|googleadservices|doubleclick|adtrafficquality|googletagservices|adservice\.google/i,
    );

    const scriptSrc = csp.match(/script-src ([^;]+)/)?.[1] ?? '';
    expect(scriptSrc).not.toContain("'unsafe-inline'");
  });

  it('adds a fresh nonce to HTML responses', () => {
    const response = () =>
      withSecurityHeaders(
        new Response('<html></html>', {
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        }),
      );

    const first = response();
    const second = response();

    const firstCsp = first.headers.get('Content-Security-Policy') ?? '';
    const secondCsp = second.headers.get('Content-Security-Policy') ?? '';

    const firstNonce = firstCsp.match(/'nonce-([^']+)'/)?.[1];
    const secondNonce = secondCsp.match(/'nonce-([^']+)'/)?.[1];

    expect(firstNonce).toBeTruthy();
    expect(secondNonce).toBeTruthy();
    expect(firstNonce).not.toBe(secondNonce);
    expect(firstCsp).toContain(`'nonce-${firstNonce}'`);
    expect(first.headers.get('Cache-Control')).toBe('private, no-store');
  });

  it('does not add a nonce to API JSON responses', () => {
    const response = withSecurityHeaders(
      new Response('{"ok":true}', {
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const csp = response.headers.get('Content-Security-Policy') ?? '';

    expect(csp).not.toContain("'nonce-");
    expect(response.headers.get('Cache-Control')).not.toBe('private, no-store');
  });

  it('names no Permissions-Policy feature browsers do not recognize', () => {
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
