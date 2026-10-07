import { afterEach, describe, expect, mock, test } from 'bun:test'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { KeyNode, Keyspace } from '../types'
import { KeyspaceTree, redisReadCommand } from './KeyspaceTree'

const node = (p: Partial<KeyNode> & Pick<KeyNode, 'name' | 'prefix'>): KeyNode => ({
  delimiter: '',
  count: 0,
  folders: [],
  keys: [],
  more_folders: 0,
  more_keys: 0,
  ...p,
})

// goserver:upgrade_to_annual_plan:<n> (two folder levels, 700 keys, 2 sampled),
// session/user|<n> (mixed delimiters) and a top-level key.
const KEYSPACE: Keyspace = {
  total_keys: 731,
  truncated: false,
  root: node({
    name: '',
    prefix: '',
    count: 731,
    folders: [
      node({
        name: 'goserver',
        delimiter: ':',
        prefix: 'goserver:',
        count: 700,
        folders: [
          node({
            name: 'upgrade_to_annual_plan',
            delimiter: ':',
            prefix: 'goserver:upgrade_to_annual_plan:',
            count: 700,
            keys: [
              { key: 'goserver:upgrade_to_annual_plan:1', type: 'string' },
              { key: 'goserver:upgrade_to_annual_plan:2', type: 'string' },
            ],
            more_keys: 698,
          }),
        ],
      }),
      node({
        name: 'session',
        delimiter: '/',
        prefix: 'session/',
        count: 30,
        folders: [node({ name: 'user', delimiter: '|', prefix: 'session/user|', count: 30, keys: [{ key: 'session/user|7', type: 'hash' }] })],
      }),
    ],
    keys: [{ key: 'plain key', type: 'list' }],
  }),
}

afterEach(cleanup)

describe('KeyspaceTree', () => {
  test('shows only top-level folders until a folder is clicked', () => {
    render(<KeyspaceTree keyspace={KEYSPACE} />)
    expect(screen.getByText('goserver')).toBeTruthy()
    expect(screen.getByText('session')).toBeTruthy()
    expect(screen.queryByText('upgrade_to_annual_plan')).toBeNull()

    fireEvent.click(screen.getByText('goserver'))
    expect(screen.getByText('upgrade_to_annual_plan')).toBeTruthy()
    // Still collapsed one level down.
    expect(screen.queryByText('1')).toBeNull()

    fireEvent.click(screen.getByText('upgrade_to_annual_plan'))
    expect(screen.getByText('1')).toBeTruthy()
    expect(screen.getByText('+698 more keys not listed')).toBeTruthy()

    // Clicking again collapses it.
    fireEvent.click(screen.getByText('goserver'))
    expect(screen.queryByText('upgrade_to_annual_plan')).toBeNull()
  })

  test('clicking a key hands back the leaf', () => {
    const onPick = mock(() => {})
    render(<KeyspaceTree keyspace={KEYSPACE} onPickKey={onPick} />)
    fireEvent.click(screen.getByText('session'))
    fireEvent.click(screen.getByText('user'))
    fireEvent.click(screen.getByText('7'))
    expect(onPick).toHaveBeenCalledWith({ key: 'session/user|7', type: 'hash' })
  })

  test('search flattens matching folders and keys', () => {
    render(<KeyspaceTree keyspace={KEYSPACE} query="user|" />)
    expect(screen.getByTitle('session/user|*')).toBeTruthy()
    expect(screen.queryByText('goserver')).toBeNull()
  })
})

describe('redisReadCommand', () => {
  test('picks the read command for the key type and quotes awkward keys', () => {
    expect(redisReadCommand({ key: 'a:b', type: 'string' })).toBe('GET a:b')
    expect(redisReadCommand({ key: 'h', type: 'hash' })).toBe('HGETALL h')
    expect(redisReadCommand({ key: 'plain key', type: 'list' })).toBe('LRANGE "plain key" 0 99')
    expect(redisReadCommand({ key: 'z', type: 'zset' })).toBe('ZRANGE z 0 99 WITHSCORES')
    expect(redisReadCommand({ key: 'x', type: null })).toBe('TYPE x')
  })
})
