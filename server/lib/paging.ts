import { badRequest } from './http'

// Shared paging contract for list endpoints: `page` is 1-based, `page_size` is
// capped so a caller cannot ask for the whole table. Endpoints stay
// backwards-compatible — with neither param present they return their plain
// array as before, which is what `null` here signals.

export const DEFAULT_PAGE_SIZE = 25
export const MAX_PAGE_SIZE = 100

export interface PageParams {
  page: number
  pageSize: number
}

export function parsePageParams(params: URLSearchParams): PageParams | null {
  const rawPage = params.get('page')
  const rawSize = params.get('page_size')
  if (rawPage === null && rawSize === null) return null
  const page = rawPage === null ? 1 : Number(rawPage)
  if (!Number.isInteger(page) || page < 1) throw badRequest('page must be an integer >= 1.')
  const pageSize = rawSize === null ? DEFAULT_PAGE_SIZE : Number(rawSize)
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
    throw badRequest(`page_size must be an integer between 1 and ${MAX_PAGE_SIZE}.`)
  }
  return { page, pageSize }
}

// LIMIT/OFFSET cannot be placeholders in a prepared statement, so they are
// inlined — always as truncated integers, never as caller-supplied text.
export function limitClause(limit?: number, offset?: number): string {
  if (limit === undefined) return ''
  return ` LIMIT ${Math.trunc(limit)} OFFSET ${Math.trunc(offset ?? 0)}`
}

// Escape the LIKE metacharacters in a user's search term so a typed `%` matches
// a literal percent sign instead of everything. Pair with ESCAPE '\\' in the SQL.
export function likeTerm(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
}
