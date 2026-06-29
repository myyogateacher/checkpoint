import type { Driver } from './types'
import { mysqlDriver } from './mysql'
import { redisDriver } from './redis'

// Engine → driver. Engines absent here have no live-access driver yet and the
// facade returns 501 for them. Add a new engine by implementing a Driver and
// registering it below.
const REGISTRY: Record<string, Driver> = {
  mysql: mysqlDriver,
  aurora_mysql: mysqlDriver,
  mariadb: mysqlDriver,
  tidb: mysqlDriver,
  starrocks: mysqlDriver,
  redis: redisDriver,
}

export function getDriver(engine: string): Driver | null {
  return REGISTRY[engine] ?? null
}
