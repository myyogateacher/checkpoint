// mysql2 returns DATETIME as JS Date and TINYINT(1) as number; normalize for JSON.
export function iso(d: Date | string | null | undefined): string | null {
  if (!d) return null
  return (d instanceof Date ? d : new Date(d)).toISOString()
}

export function bool(v: number | boolean | null | undefined): boolean {
  return !!v
}

// JSON columns: mysql2 parses them, but be defensive about string fallbacks.
export function asJson<T>(v: unknown, fallback: T): T {
  if (v == null) return fallback
  if (typeof v === 'string') {
    try {
      return JSON.parse(v) as T
    } catch {
      return fallback
    }
  }
  return v as T
}
