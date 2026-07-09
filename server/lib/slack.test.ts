import { describe, expect, test } from 'bun:test'
import { buildMigrationBlocks, buildThreadReplyBlocks, type MigrationBlockInput } from './slack'

const base: MigrationBlockInput = {
  title: 'Testing',
  envName: 'Production',
  dbName: 'main_db',
  submittedBy: 'Harsha Hota',
  url: 'https://cp.example.com/migrations/abc',
}

// Blocks are intentionally typed as unknown[] on the API; cast to inspect shape.
const build = (over: Partial<MigrationBlockInput> = {}) =>
  buildMigrationBlocks({ ...base, ...over }) as any[]

describe('buildMigrationBlocks', () => {
  test('is a single markdown block', () => {
    const blocks = build()
    expect(blocks).toHaveLength(1)
    expect(blocks[0].type).toBe('markdown')
  })

  test('has a Title heading and the 4-column table with a View link column', () => {
    const md = build()[0].text as string
    expect(md).toContain('**Title:** Testing')
    expect(md).toContain('| Environment | Database | Submitted by | View |')
    expect(md).toContain('| Production | main_db | Harsha Hota | [View](https://cp.example.com/migrations/abc) |')
  })

  test('null environment renders an em dash cell', () => {
    expect(build({ envName: null })[0].text).toContain('| — | main_db | Harsha Hota | [View]')
  })

  test('escapes pipes and collapses newlines in cell values', () => {
    expect(build({ title: 'a | b\nc' })[0].text).toContain('**Title:** a \\| b c')
  })
})

type ReplyInput = Parameters<typeof buildThreadReplyBlocks>[0]
const reply = (over: Partial<ReplyInput> = {}) =>
  buildThreadReplyBlocks({ heading: ':white_check_mark: *Approved*', actor: '<@U9>', url: 'https://cp/m/1', ...over }) as any[]

describe('buildThreadReplyBlocks', () => {
  test('is a single one-liner when there is no note or error', () => {
    const blocks = reply()
    expect(blocks).toHaveLength(1)
    expect(blocks[0].type).toBe('section')
    expect(blocks[0].text.text).toBe(':white_check_mark: *Approved* by <@U9> · <https://cp/m/1|View migration>')
  })

  test('appends a Reason line for a rejection note', () => {
    const blocks = reply({ heading: ':no_entry_sign: *Rejected*', note: 'Not needed anymore' })
    expect(blocks).toHaveLength(1)
    expect(blocks[0].text.text).toContain(':no_entry_sign: *Rejected* by <@U9>')
    expect(blocks[0].text.text).toContain('\n*Reason:* Not needed anymore')
  })

  test('appends a code block for a failed-apply error', () => {
    const blocks = reply({ heading: ':x: *Apply failed*', error: "Duplicate key 'idx'" })
    expect(blocks).toHaveLength(2)
    expect(blocks[0].text.text).toContain(':x: *Apply failed* by <@U9>')
    expect(blocks[1].text.text).toBe("```Duplicate key 'idx'```")
  })

  test('ignores blank note and null error', () => {
    expect(reply({ note: '   ', error: null })).toHaveLength(1)
  })

  test('truncates a very long error under the Block Kit limit', () => {
    const block = reply({ error: 'e'.repeat(5000) })[1]
    expect(block.text.text.length).toBeLessThanOrEqual('```'.length * 2 + 2800)
    expect(block.text.text.startsWith('```')).toBe(true)
    expect(block.text.text.endsWith('…```')).toBe(true)
  })
})
