import { RedisClient } from 'bun'
import { HttpError } from '../http'
import type { ConnectionSecret } from '../../modules/databases.repo'
import type { Driver, QueryResult } from './types'

// Read-only Redis commands permitted through the read panel. The first token of
// the typed command must be in this set; everything that mutates state (SET,
// DEL, HSET, FLUSHDB, EVAL, …) is rejected before reaching the server.
const READ_COMMANDS = new Set([
  'PING', 'ECHO', 'TYPE', 'TTL', 'PTTL', 'EXISTS', 'DBSIZE', 'RANDOMKEY', 'KEYS', 'SCAN',
  'GET', 'GETRANGE', 'STRLEN', 'MGET', 'SUBSTR',
  'HGET', 'HMGET', 'HGETALL', 'HKEYS', 'HVALS', 'HLEN', 'HEXISTS', 'HSTRLEN', 'HSCAN',
  'LRANGE', 'LINDEX', 'LLEN', 'LPOS',
  'SMEMBERS', 'SISMEMBER', 'SMISMEMBER', 'SCARD', 'SRANDMEMBER', 'SSCAN', 'SINTER', 'SUNION', 'SDIFF',
  'ZRANGE', 'ZRANGEBYSCORE', 'ZREVRANGEBYSCORE', 'ZRANGEBYLEX', 'ZREVRANGE', 'ZSCORE', 'ZMSCORE',
  'ZCARD', 'ZCOUNT', 'ZRANK', 'ZREVRANK', 'ZSCAN', 'ZLEXCOUNT',
  'GETBIT', 'BITCOUNT', 'BITPOS', 'PFCOUNT',
  'GEOPOS', 'GEODIST', 'GEOHASH', 'GEOSEARCH',
  'XLEN', 'XRANGE', 'XREVRANGE',
])

// Split a command line into tokens, honouring single/double quotes so values
// with spaces (e.g. GET "my key") are passed as one argument.
function tokenize(input: string): string[] {
  const tokens: string[] = []
  const re = /"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|(\S+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(input)) !== null) {
    if (m[1] !== undefined) tokens.push(m[1].replace(/\\(.)/g, '$1'))
    else if (m[2] !== undefined) tokens.push(m[2].replace(/\\(.)/g, '$1'))
    else tokens.push(m[3])
  }
  return tokens
}

// Build a redis(s):// URL from the stored connection. The `database` field holds
// the integer DB index (0–15); non-numeric values are ignored (default DB 0).
function redisUrl(c: ConnectionSecret): string {
  const scheme = c.ssl ? 'rediss' : 'redis'
  const auth = c.username || c.password
    ? `${encodeURIComponent(c.username ?? '')}:${encodeURIComponent(c.password ?? '')}@`
    : ''
  const dbIdx = (c.database ?? '').trim()
  const path = /^\d+$/.test(dbIdx) ? `/${dbIdx}` : ''
  return `${scheme}://${auth}${c.host}:${c.port}${path}`
}

function makeClient(c: ConnectionSecret): RedisClient {
  return new RedisClient(redisUrl(c), {
    connectionTimeout: 8000,
    autoReconnect: false,
    enableOfflineQueue: false,
  })
}

function scalar(v: unknown): unknown {
  if (v === null || v === undefined) return null
  if (v instanceof Uint8Array) return new TextDecoder().decode(v)
  if (typeof v === 'object') return JSON.stringify(v)
  return v
}

// Map a Redis reply into the tabular QueryResult shape the read panel expects.
function toResult(command: string, reply: unknown, duration_ms: number): QueryResult {
  const cmd = command.toUpperCase()

  // Hash-style object reply (e.g. some clients return HGETALL as an object).
  if (reply !== null && typeof reply === 'object' && !Array.isArray(reply) && !(reply instanceof Uint8Array)) {
    const rows = Object.entries(reply as Record<string, unknown>).map(([field, value]) => ({ field, value: scalar(value) }))
    return { columns: ['field', 'value'], rows, row_count: rows.length, duration_ms }
  }

  if (Array.isArray(reply)) {
    // HGETALL over RESP comes back as a flat [field, value, …] array.
    if (cmd === 'HGETALL') {
      const rows: Record<string, unknown>[] = []
      for (let i = 0; i + 1 < reply.length; i += 2) rows.push({ field: scalar(reply[i]), value: scalar(reply[i + 1]) })
      return { columns: ['field', 'value'], rows, row_count: rows.length, duration_ms }
    }
    const rows = reply.map((v, i) => ({ '#': i, value: scalar(v) }))
    return { columns: ['#', 'value'], rows, row_count: rows.length, duration_ms }
  }

  // Scalar reply (string / number / nil).
  return { columns: ['value'], rows: [{ value: scalar(reply) }], row_count: 1, duration_ms }
}

// Driver for Redis. Schema-less and migration-less, so `introspect` and
// `applyStatements` are intentionally omitted — the facade reports a clear error
// if they're invoked for a Redis database.
export const redisDriver: Driver = {
  async testConnection(c) {
    const client = makeClient(c)
    const started = Date.now()
    try {
      await client.connect()
      await client.send('PING', [])
      return { latencyMs: Date.now() - started }
    } catch (err) {
      throw new HttpError(502, `Could not connect to ${c.host}:${c.port} — ${(err as Error).message}`)
    } finally {
      client.close()
    }
  },

  assertReadOnly(text) {
    const tokens = tokenize(text.trim())
    if (tokens.length === 0) throw new HttpError(400, 'Empty command.')
    const cmd = tokens[0].toUpperCase()
    if (!READ_COMMANDS.has(cmd)) {
      throw new HttpError(400, `Only read-only Redis commands are allowed (got "${cmd}").`)
    }
  },

  async runReadQuery(c, text, timeoutMs) {
    this.assertReadOnly(text)
    const [command, ...args] = tokenize(text.trim())
    const client = makeClient(c)
    try {
      await client.connect()
    } catch (err) {
      client.close()
      throw new HttpError(502, `Could not connect to ${c.host}:${c.port} — ${(err as Error).message}`)
    }
    const started = Date.now()
    try {
      // Bound the command: whichever settles first wins.
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new HttpError(400, `Command exceeded the ${Math.round(timeoutMs / 1000)}s timeout.`)), timeoutMs),
      )
      const reply = await Promise.race([client.send(command, args.map(String)), timeout])
      return toResult(command, reply, Date.now() - started)
    } catch (err) {
      if (err instanceof HttpError) throw err
      throw new HttpError(400, (err as Error).message)
    } finally {
      client.close()
    }
  },
}
