import { describe, expect, test } from 'bun:test'
import { localMidnight } from './format'

// The audit filter's date range is built from these: `from` is localMidnight(day)
// and `to` is localMidnight(day, 1), an exclusive bound. A day that does not roll
// over correctly silently drops the last day of every range that ends on a month
// or year boundary, which is the shape nobody notices until a month-end report.
// The suite runs in the runner's zone (UTC in CI), so the DST guarantee the Date
// constructor gives is not exercised here — only the calendar arithmetic is.
describe('localMidnight', () => {
  const parts = (iso: string | undefined) => {
    const d = new Date(iso!)
    return [d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes()]
  }

  test('a date with no offset is local midnight of that day', () => {
    expect(parts(localMidnight('2026-09-22'))).toEqual([2026, 9, 22, 0, 0])
  })

  test('+1 day rolls the month, the year and a leap day over', () => {
    expect(parts(localMidnight('2026-09-30', 1))).toEqual([2026, 10, 1, 0, 0])
    expect(parts(localMidnight('2026-12-31', 1))).toEqual([2027, 1, 1, 0, 0])
    expect(parts(localMidnight('2028-02-28', 1))).toEqual([2028, 2, 29, 0, 0])
  })

  test('an empty or malformed value is undefined, so the caller omits the bound', () => {
    for (const bad of ['', 'yesterday', '2026-09', 'not-a-date']) expect(localMidnight(bad)).toBeUndefined()
  })
})
