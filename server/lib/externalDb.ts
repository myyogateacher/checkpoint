import { HttpError } from './http'
import type { ConnectionSecret } from '../modules/databases.repo'
import { getDriver } from './drivers'
import type { QueryResult, TableDef } from './drivers/types'

export type { QueryResult, TableDef } from './drivers/types'

// Thin facade over the per-engine driver registry (server/lib/drivers). Each
// function resolves the engine's driver and delegates; engines without a driver
// return 501, and capabilities a driver doesn't implement (introspection,
// migrations) return a clear 400.

function driverOrThrow(engine: string) {
  const d = getDriver(engine)
  if (!d) throw new HttpError(501, `Live access for ${engine} is not implemented yet.`)
  return d
}

export function supportsLiveAccess(engine: string): boolean {
  return getDriver(engine) !== null
}

export function testConnection(engine: string, c: ConnectionSecret): Promise<{ latencyMs: number }> {
  return driverOrThrow(engine).testConnection(c)
}

export function introspect(engine: string, c: ConnectionSecret): Promise<TableDef[]> {
  const d = driverOrThrow(engine)
  if (!d.introspect) throw new HttpError(400, `${engine} does not support schema introspection.`)
  return d.introspect(c)
}

// Throws HttpError(400) if the text is not a single read-only statement/command.
export function assertReadOnly(engine: string, queryText: string): void {
  driverOrThrow(engine).assertReadOnly(queryText)
}

export function runReadQuery(engine: string, c: ConnectionSecret, queryText: string): Promise<QueryResult> {
  return driverOrThrow(engine).runReadQuery(c, queryText)
}

export function applyStatements(engine: string, c: ConnectionSecret, statements: string[]): Promise<void> {
  const d = driverOrThrow(engine)
  if (!d.applyStatements) throw new HttpError(400, `${engine} does not support migrations.`)
  return d.applyStatements(c, statements)
}
