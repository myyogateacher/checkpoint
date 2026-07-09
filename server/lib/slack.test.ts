import { describe, expect, test } from 'bun:test'
import { buildMigrationBlocks, buildThreadReplyBlocks, type MigrationBlockInput } from './slack'

const base: MigrationBlockInput = {
  label: ':large_yellow_circle: *Migration submitted for approval*',
  title: 'Add invoices index',
  description: null,
  envName: 'production',
  dbName: 'billing_main',
  releasers: '',
  verb: 'Submitted',
  actor: '<@U123>',
  url: 'https://cp.example.com/migrations/abc',
}

// Blocks are intentionally typed as unknown[] on the API; cast to inspect shape.
const build = (over: Partial<MigrationBlockInput> = {}) =>
  buildMigrationBlocks({ ...base, ...over }) as any[]

describe('buildMigrationBlocks', () => {
  test('heading section carries the label and bold title', () => {
    const [heading] = build()
    expect(heading.type).toBe('section')
    expect(heading.text.type).toBe('mrkdwn')
    expect(heading.text.text).toContain(base.label)
    expect(heading.text.text).toContain('*Add invoices index*')
  })

  test('fields hold Environment and Database, and omit Releasers when empty', () => {
    const blocks = build()
    expect(blocks[1].type).toBe('section')
    expect(blocks[1].fields).toHaveLength(2)
    expect(blocks[1].fields[0].text).toBe('*Environment:*\nproduction')
    expect(blocks[1].fields[1].text).toBe('*Database:*\nbilling_main')
  })

  test('Releasers field is added only when present', () => {
    const { fields } = build({ releasers: '<@U1>, <@U2>' })[1]
    expect(fields).toHaveLength(3)
    expect(fields[2].text).toBe('*Releasers:*\n<@U1>, <@U2>')
  })

  test('null environment renders an em dash', () => {
    expect(build({ envName: null })[1].fields[0].text).toBe('*Environment:*\n—')
  })

  test('description section appears only when non-empty', () => {
    const isDesc = (b: any) => b.type === 'section' && b.text?.text?.startsWith('*Description:*')
    expect(build().some(isDesc)).toBe(false)
    expect(build({ description: '  Adds an index  ' }).find(isDesc).text.text).toBe('*Description:*\nAdds an index')
  })

  test('long description is truncated under the Block Kit 3000-char limit', () => {
    const block = build({ description: 'x'.repeat(5000) }).find((b) => b.text?.text?.startsWith('*Description:*'))
    expect(block.text.text.length).toBeLessThanOrEqual('*Description:*\n'.length + 2900)
    expect(block.text.text.endsWith('…')).toBe(true)
  })

  test('context line has the verb, actor mention, and View link', () => {
    const blocks = build({ verb: 'Applied' })
    const context = blocks[blocks.length - 1]
    expect(context.type).toBe('context')
    expect(context.elements[0].text).toBe('Applied by <@U123> · <https://cp.example.com/migrations/abc|View migration>')
  })
})

describe('buildThreadReplyBlocks', () => {
  const reply = (over: Partial<{ heading: string; actor: string; url: string; error: string | null }> = {}) =>
    buildThreadReplyBlocks({ heading: ':white_check_mark: *Approved*', actor: '<@U9>', url: 'https://cp/m/1', ...over }) as any[]

  test('is a single one-liner section when there is no error', () => {
    const blocks = reply()
    expect(blocks).toHaveLength(1)
    expect(blocks[0].type).toBe('section')
    expect(blocks[0].text.text).toBe(':white_check_mark: *Approved* by <@U9> · <https://cp/m/1|View migration>')
  })

  test('appends a code block with the full error when present', () => {
    const blocks = reply({ heading: ':x: *Apply failed*', error: "Duplicate key name 'idx_cust'" })
    expect(blocks).toHaveLength(2)
    expect(blocks[0].text.text).toContain(':x: *Apply failed* by <@U9>')
    expect(blocks[1].text.text).toBe("```Duplicate key name 'idx_cust'```")
  })

  test('ignores a blank or null error', () => {
    expect(reply({ error: '   ' })).toHaveLength(1)
    expect(reply({ error: null })).toHaveLength(1)
  })

  test('truncates a very long error under the Block Kit limit', () => {
    const block = reply({ error: 'e'.repeat(5000) })[1]
    expect(block.text.text.length).toBeLessThanOrEqual('```'.length * 2 + 2800)
    expect(block.text.text.startsWith('```')).toBe(true)
    expect(block.text.text.endsWith('…```')).toBe(true)
  })
})
