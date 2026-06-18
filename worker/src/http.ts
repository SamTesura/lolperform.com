import type { z } from 'zod';

/** JSON response with sane defaults; cacheable unless overridden. */
export function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=300, s-maxage=600',
      ...init.headers,
    },
  });
}

export function error(status: number, message: string, extra?: unknown): Response {
  return json({ error: message, ...(extra ? { details: extra } : {}) }, { status });
}

/**
 * Validate URL search params against a Zod schema. Returns the parsed object or a
 * 400 Response. Only enum/typed fields pass — there is no free-form input path to
 * the database.
 */
export function parseQuery<T extends z.ZodType>(
  url: URL,
  schema: T,
): { ok: true; data: z.infer<T> } | { ok: false; response: Response } {
  const raw = Object.fromEntries(url.searchParams.entries());
  const result = schema.safeParse(raw);
  if (!result.success) {
    return {
      ok: false,
      response: error(400, 'invalid query parameters', result.error.flatten().fieldErrors),
    };
  }
  return { ok: true, data: result.data };
}
