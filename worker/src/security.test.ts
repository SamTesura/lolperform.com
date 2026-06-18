import { describe, expect, it } from 'vitest';
import { SECURITY_HEADERS, withSecurityHeaders } from './security.js';

describe('security headers', () => {
  it('locks down scripts but allows Data Dragon images', () => {
    const csp = SECURITY_HEADERS['Content-Security-Policy']!;
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain('https://ddragon.leagueoflegends.com');
    expect(csp).not.toContain("script-src 'self' 'unsafe-inline'");
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
