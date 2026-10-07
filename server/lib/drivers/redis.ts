import { RedisClient } from 'bun'
import net from 'node:net'
import tls from 'node:tls'
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

// Commands the read/write query panel still refuses: they wipe or reconfigure
// the whole server, or block/stream instead of returning a reply. Everything
// else (SET, DEL, HSET, EXPIRE, …) runs, since a Redis credential is
// inherently read/write.
const BLOCKED_COMMANDS = new Set([
  'FLUSHALL', 'FLUSHDB', 'SHUTDOWN', 'CONFIG', 'DEBUG', 'MONITOR', 'SYNC', 'PSYNC',
  'REPLICAOF', 'SLAVEOF', 'FAILOVER', 'CLUSTER', 'ACL', 'MODULE', 'SAVE', 'BGSAVE',
  'BGREWRITEAOF', 'SWAPDB', 'MIGRATE', 'CLIENT', 'SCRIPT', 'FUNCTION',
  'SUBSCRIBE', 'PSUBSCRIBE', 'SSUBSCRIBE', 'BLPOP', 'BRPOP', 'BLMOVE', 'BRPOPLPUSH',
  'BLMPOP', 'BZPOPMIN', 'BZPOPMAX', 'BZMPOP', 'WAIT', 'WAITAOF', 'MULTI', 'EXEC', 'SELECT', 'QUIT', 'RESET',
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
  // A username without a password can't authenticate, and an empty AUTH makes the
  // server drop the connection — so only send credentials when a password is set.
  const auth = c.password
    ? `${encodeURIComponent(c.username ?? '')}:${encodeURIComponent(c.password)}@`
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

// Bun's client reports every handshake failure (wrong TLS mode, bad password,
// unknown DB index) as a bare "Connection closed". Speak RESP over a raw socket
// to find out which, so the error tells the user what to change.
function probe(c: ConnectionSecret, useTls: boolean, commands: string[][]): Promise<string[] | Error> {
  return new Promise((resolve) => {
    const encode = (args: string[]) => `*${args.length}\r\n${args.map((a) => `$${Buffer.byteLength(a)}\r\n${a}\r\n`).join('')}`
    const replies: string[] = []
    let buf = ''
    const sock: net.Socket = useTls
      ? tls.connect({ host: c.host, port: c.port, servername: net.isIP(c.host) ? undefined : c.host, rejectUnauthorized: false })
      : net.connect({ host: c.host, port: c.port })
    const done = (r: string[] | Error) => { sock.destroy(); resolve(r) }
    sock.setTimeout(5000, () => done(replies.length ? replies : new Error('no reply')))
    sock.on('error', (err) => done(replies.length ? replies : err))
    sock.on('close', () => done(replies))
    sock.once(useTls ? 'secureConnect' : 'connect', () => sock.write(commands.map(encode).join('')))
    sock.on('data', (d) => {
      buf += d.toString('utf8')
      // Only the first line of each reply matters (+OK / -ERR … / +PONG).
      let i: number
      while ((i = buf.indexOf('\r\n')) !== -1) {
        const line = buf.slice(0, i)
        buf = buf.slice(i + 2)
        if (/^[+\-:]/.test(line)) replies.push(line)
        else if (line.startsWith('$') || line.startsWith('*')) replies.push(line)
        if (replies.length >= commands.length) return done(replies)
      }
    })
  })
}

const speaksRedis = (r: string[] | Error) => Array.isArray(r) && r.length > 0 && /^[+-]/.test(r[0])

async function diagnose(c: ConnectionSecret, original: string): Promise<string> {
  const where = `${c.host}:${c.port}`
  const plain = await probe(c, false, [['PING']])
  if (plain instanceof Error && /ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|ETIMEDOUT|ENETUNREACH/.test((plain as NodeJS.ErrnoException).code ?? plain.message)) {
    return `Could not reach ${where} — ${(plain as NodeJS.ErrnoException).code ?? plain.message}`
  }
  const plainOk = speaksRedis(plain)
  if (c.ssl && plainOk) return `${where} is not using TLS — turn off "Use TLS" and try again.`
  if (!c.ssl && !plainOk) {
    const secure = await probe(c, true, [['PING']])
    if (speaksRedis(secure)) return `${where} requires TLS — turn on "Use TLS" and try again.`
  }

  // Transport is right; check credentials, then the DB index.
  const cmds: string[][] = []
  if (c.password) cmds.push(c.username ? ['AUTH', c.username, c.password] : ['AUTH', c.password])
  const dbIdx = (c.database ?? '').trim()
  if (/^\d+$/.test(dbIdx)) cmds.push(['SELECT', dbIdx])
  cmds.push(['PING'])
  const r = await probe(c, c.ssl, cmds)
  if (Array.isArray(r)) {
    const err = r.find((l) => l.startsWith('-'))
    if (err) {
      const msg = err.slice(1)
      if (/^(WRONGPASS|NOAUTH)|invalid password|AUTH/i.test(msg)) return `Authentication failed on ${where} — check the username and password (${msg}).`
      if (/DB index/i.test(msg)) return `Invalid database index "${dbIdx}" on ${where} (${msg}).`
      return `${where} rejected the connection — ${msg}`
    }
  }
  return `Could not connect to ${where} — ${original}`
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

async function execute(c: ConnectionSecret, text: string, timeoutMs: number): Promise<QueryResult> {
  const [command, ...args] = tokenize(text.trim())
  const client = makeClient(c)
  try {
    await client.connect()
  } catch (err) {
    client.close()
    throw new HttpError(502, await diagnose(c, (err as Error).message))
  }
  const started = Date.now()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    // Bound the command: whichever settles first wins.
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new HttpError(400, `Command exceeded the ${Math.round(timeoutMs / 1000)}s timeout.`)), timeoutMs)
    })
    const reply = await Promise.race([client.send(command, args.map(String)), timeout])
    return toResult(command, reply, Date.now() - started)
  } catch (err) {
    if (err instanceof HttpError) throw err
    throw new HttpError(400, (err as Error).message)
  } finally {
    clearTimeout(timer)
    client.close()
  }
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
      throw new HttpError(502, await diagnose(c, (err as Error).message))
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
    return execute(c, text, timeoutMs)
  },

  async runCommand(c, text, timeoutMs) {
    const tokens = tokenize(text.trim())
    if (tokens.length === 0) throw new HttpError(400, 'Empty command.')
    const cmd = tokens[0].toUpperCase()
    if (BLOCKED_COMMANDS.has(cmd)) {
      throw new HttpError(400, `${cmd} isn't allowed from the query panel.`)
    }
    return execute(c, text, timeoutMs)
  },
}
