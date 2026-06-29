// A tiny, dependency-free HTTP layer over Bun.serve: a path-param router,
// JSON helpers, typed errors, and cookie utilities.

export type Params = Record<string, string>

export interface Ctx {
  req: Request
  url: URL
  params: Params
  query: URLSearchParams
  // Populated by the auth middleware.
  user?: import('../types').SessionUser
  sessionId?: string
}

export type Handler = (ctx: Ctx) => Promise<Response> | Response

// Thrown anywhere in a handler; converted to a JSON error response.
export class HttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export const badRequest = (m: string) => new HttpError(400, m)
export const unauthorized = (m = 'Not authenticated') => new HttpError(401, m)
export const forbidden = (m = 'Forbidden') => new HttpError(403, m)
export const notFound = (m = 'Not found') => new HttpError(404, m)

export function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(data === null ? null : JSON.stringify(data), {
    status: data === null ? 204 : (init.status ?? 200),
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  })
}

export async function readJson<T = Record<string, unknown>>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T
  } catch {
    throw badRequest('Invalid JSON body')
  }
}

// --- Cookies ---------------------------------------------------------------

export function parseCookies(req: Request): Record<string, string> {
  const header = req.headers.get('cookie') ?? ''
  const out: Record<string, string> = {}
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k) out[k] = decodeURIComponent(v.join('='))
  }
  return out
}

export function cookieHeader(
  name: string,
  value: string,
  opts: { maxAge?: number; secure?: boolean; sameSite?: 'Lax' | 'None' | 'Strict' } = {},
): string {
  const sameSite = opts.sameSite ?? 'Lax'
  // SameSite=None is only honored on Secure cookies, so force Secure when used.
  const secure = opts.secure || sameSite === 'None'
  const bits = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', `SameSite=${sameSite}`]
  if (secure) bits.push('Secure')
  if (opts.maxAge !== undefined) bits.push(`Max-Age=${opts.maxAge}`)
  return bits.join('; ')
}

// --- Router ----------------------------------------------------------------

interface Route {
  method: string
  // Path split into segments; `:name` denotes a param.
  segments: string[]
  handler: Handler
}

export class Router {
  private routes: Route[] = []

  add(method: string, path: string, handler: Handler) {
    this.routes.push({ method, segments: path.split('/').filter(Boolean), handler })
  }
  get(path: string, h: Handler) { this.add('GET', path, h) }
  post(path: string, h: Handler) { this.add('POST', path, h) }
  put(path: string, h: Handler) { this.add('PUT', path, h) }
  patch(path: string, h: Handler) { this.add('PATCH', path, h) }
  delete(path: string, h: Handler) { this.add('DELETE', path, h) }

  match(method: string, pathname: string): { handler: Handler; params: Params } | null {
    const segs = pathname.split('/').filter(Boolean)
    for (const r of this.routes) {
      if (r.method !== method || r.segments.length !== segs.length) continue
      const params: Params = {}
      let ok = true
      for (let i = 0; i < r.segments.length; i++) {
        const rs = r.segments[i]
        if (rs.startsWith(':')) params[rs.slice(1)] = decodeURIComponent(segs[i])
        else if (rs !== segs[i]) { ok = false; break }
      }
      if (ok) return { handler: r.handler, params }
    }
    return null
  }
}
