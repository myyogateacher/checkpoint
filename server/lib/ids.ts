// Prefixed, URL-safe ids so rows are self-describing in logs and URLs.
export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`
}
