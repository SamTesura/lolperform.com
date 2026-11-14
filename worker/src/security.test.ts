import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SECURITY_HEADERS, withSecurityHeaders } from './security.js';

type MockElement = {
  hasAttribute(name: string): boolean;
  setAttribute(name: string, value: string): void;
};

type MockHandler = {
  element(element: MockElement): void;
};

/**
 * Minimal HTMLRewriter mock for testing nonce injection in Vitest.
 * Production uses Cloudflare's native HTMLRewriter implementation.
 */
class MockHTMLRewriter {
  private handlers: MockHandler[] = [];

  on(_selector: string, handler: MockHandler): this {
    this.handlers.push(handler);
    return this;
  }

  transform(response: Response): Response {
    const transformedBody = response.text().then((html) =>
      html.replace(/<script\b[^>]*>/gi, (tag) => {
        let updatedTag = tag;

        const element: MockElement = {
          hasAttribute(name) {
            return new RegExp(`\\b${name}\\s*=`, 'i').test(updatedTag);
          },

          setAttribute(name, value) {
            updatedTag = updatedTag.replace(/>$/, ` ${name}="${value}">`);
          },
        };

        for (const handler of this.handlers) {
          handler.element(element);
        }

        return updatedTag;
      }),
    );

    return new Response(
      new ReadableStream({
        async start(controller) {
          controller.enqueue(new TextEncoder().encode(await transformedBody));
          controller.close();
        },
      }),
      {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      },
    );
  }
}

describe('security headers', () => {
  beforeEach(() => {
    vi.stubGlobal('HTMLRewriter', MockHTMLRewriter as unknown as typeof HTMLRewriter);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

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

  it('adds a fresh matching nonce to inline HTML scripts', async () => {
    const createResponse = () =>
      withSecurityHeaders(
        new Response('<html><script>console.log("Astro runtime")</script></html>', {
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
          },
        }),
      );

    const first = createResponse();
    const second = createResponse();

    const firstCsp = first.headers.get('Content-Security-Policy') ?? '';
    const secondCsp = second.headers.get('Content-Security-Policy') ?? '';

    const firstNonce = firstCsp.match(/'nonce-([^']+)'/)?.[1];
    const secondNonce = secondCsp.match(/'nonce-([^']+)'/)?.[1];

    expect(firstNonce).toBeTruthy();
    expect(secondNonce).toBeTruthy();
    expect(firstNonce).not.toBe(secondNonce);

    const firstHtml = await first.text();

    expect(firstHtml).toContain(`nonce="${firstNonce}"`);
    expect(firstCsp).toContain(`'nonce-${firstNonce}'`);
    expect(first.headers.get('Cache-Control')).toBe('private, no-store');
  });

  it('does not modify external script elements', async () => {
    const response = withSecurityHeaders(
      new Response('<html><script src="/assets/app.js"></script></html>', {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
        },
      }),
    );

    const html = await response.text();

    expect(html).toContain('<script src="/assets/app.js">');
    expect(html).not.toContain('nonce=');
  });

  it('does not add a nonce to API JSON responses', async () => {
    const response = withSecurityHeaders(
      new Response('{"ok":true}', {
        headers: {
          'Content-Type': 'application/json',
        },
      }),
    );

    const csp = response.headers.get('Content-Security-Policy') ?? '';

    expect(csp).not.toContain("'nonce-");
    expect(response.headers.get('Cache-Control')).not.toBe('private, no-store');
    expect(await response.text()).toBe('{"ok":true}');
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
    const response = withSecurityHeaders(new Response('hello', { status: 201 }));

    expect(response.status).toBe(201);
    expect(await response.text()).toBe('hello');
    expect(response.headers.get('Content-Security-Policy')).toBeTruthy();
  });
});
