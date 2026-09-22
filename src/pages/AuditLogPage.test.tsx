import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useSearchParams } from 'react-router-dom'
import type { AuditLogPage as AuditPage, Database, Environment, ManagedUser } from '../types'

// Every request the page issued, so a test can assert on the arguments rather than
// on rendered rows: the filters are server side, so what the page sends IS the
// behaviour. The rows it gets back are fixed.
let requests: Array<Record<string, unknown>> = []

const USERS = [
  { id: 'u_1', email: 'shweta@myt.com', name: 'Shweta', picture: null, role: 'admin', last_login_at: null, is_self: true },
  { id: 'u_2', email: 'ops@myt.com', name: 'Ops Rao', picture: null, role: 'viewer', last_login_at: null, is_self: false },
  // No name: an invited account that has never signed in. Its option must still be
  // selectable, and must still send the email.
  { id: 'u_3', email: 'new@myt.com', name: null, picture: null, role: 'editor', last_login_at: null, is_self: false },
] as ManagedUser[]

// "production" twice on purpose: environments are per project, so the picker has to
// collapse the name and the filter has to match on it.
const ENVIRONMENTS = [
  { id: 'env_core_prod', project_id: 'proj_core', name: 'production', color: 'rose', database_count: 1 },
  { id: 'env_core_stage', project_id: 'proj_core', name: 'staging', color: 'amber', database_count: 1 },
  { id: 'env_web_prod', project_id: 'proj_web', name: 'production', color: 'rose', database_count: 1 },
] as Environment[]

const DATABASES = [
  { id: 'db_shop', project_id: 'proj_core', environment_id: 'env_core_prod', name: 'shop' },
  { id: 'db_ledger', project_id: 'proj_core', environment_id: 'env_core_stage', name: 'ledger' },
  { id: 'db_cms', project_id: 'proj_web', environment_id: 'env_web_prod', name: 'cms' },
] as Database[]

const PAGE: AuditPage = {
  items: [
    {
      id: 'a1',
      actor_email: 'ops@myt.com',
      actor_name: 'Ops Rao',
      action: 'schema.sync',
      entity_type: 'database',
      entity_id: 'db_shop',
      entity_label: 'shop',
      summary: 'Pulled schema from shop',
      created_at: '2026-09-21T14:00:00.000Z',
    },
  ],
  total: 1,
  page: 1,
  page_size: 25,
  counts: { all: 1, system: 0, migration: 0, manual: 1 },
}

mock.module('../services/api', () => ({
  api: {
    getAuditLogsPage: async (opts: Record<string, unknown>) => {
      requests.push(opts)
      return PAGE
    },
    getUsers: async () => USERS,
    getAllEnvironments: async () => ENVIRONMENTS,
    getDatabases: async () => DATABASES,
  },
}))

// PageHeader reads the current org for its breadcrumb. Standing up the real
// OrgProvider would drag in AuthProvider and two more endpoints for a trail this
// suite never asserts on, so the collaborator is stubbed rather than the page
// rewritten to avoid it.
mock.module('../context/OrgContext', () => ({
  useOrg: () => ({ currentOrg: null, currentOrgId: null, orgs: [], loading: false, locked: false }),
}))

const { AuditLogPage } = await import('./AuditLogPage')

// The page keeps its filters in the URL so back and refresh keep position; this
// renders that URL so a test can assert it directly.
function QueryProbe() {
  const [params] = useSearchParams()
  return <output data-testid="qs">{params.toString()}</output>
}

async function open(initial = '/audit') {
  const view = render(
    <MemoryRouter initialEntries={[initial]}>
      <Routes>
        <Route
          path="/audit"
          element={
            <>
              <AuditLogPage />
              <QueryProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  )
  // Both load effects (the option lists and the first page of rows) resolve on a
  // microtask right after this render. Flushing them inside act() here is what
  // keeps the run free of act() warnings: doing it at teardown is too late, the
  // updates have already landed by then.
  await act(async () => {})
  return view
}

const qs = () => new URLSearchParams(screen.getByTestId('qs').textContent ?? '')
const lastRequest = () => requests[requests.length - 1]

// Field wraps each Dropdown in a <label>, so the trigger's accessible name is the
// field label ("Actor"), while the menu's options are buttons named by their option
// label. Picking is therefore: open the field, click the option. fireEvent rather
// than .click() throughout, so React flushes the state update inside act().
async function pick(field: string, option: string | RegExp) {
  fireEvent.click(await screen.findByRole('button', { name: field }))
  fireEvent.click(await screen.findByRole('button', { name: option }))
  // Choosing rewrites the URL, which refires the request. Settle it inside act()
  // so its setState is not an unwrapped update; a suite that prints act() warnings
  // on every run is a suite whose output nobody reads.
  await act(async () => {})
}

// The option labels a field currently offers, which is what "the database picker
// narrows to the chosen environment" is actually about. The menu is portalled out
// of the page, so it is located from its own clear-the-filter entry and read back
// up; that entry is named in full because "All" alone also matches the category
// pill. Each option's label is its first inner span, the second being the hint.
async function optionsOf(field: string, clearEntry: string): Promise<string[]> {
  const trigger = await screen.findByRole('button', { name: field })
  fireEvent.click(trigger)
  const menu = (await screen.findByRole('button', { name: clearEntry })).parentElement!
  const labels = Array.from(menu.querySelectorAll('button')).map(
    (b) => b.querySelector('span > span')?.textContent ?? b.textContent ?? '',
  )
  fireEvent.click(trigger)
  return labels
}

describe('AuditLogPage sub-filters', () => {
  beforeEach(() => {
    requests = []
  })
  afterEach(cleanup)

  test('the request carries every sub-filter the user set', async () => {
    await open()
    await screen.findByRole('button', { name: 'Actor' })

    await pick('Actor', /Ops Rao/)
    await pick('Environment', 'production')
    await waitFor(() => expect(lastRequest()?.environment).toBe('production'))

    expect(lastRequest()).toMatchObject({ actor: 'ops@myt.com', environment: 'production' })
  })

  test('an actor with no name is still selectable and still sends the email', async () => {
    await open()
    await pick('Actor', 'new@myt.com')
    await waitFor(() => expect(lastRequest()?.actor).toBe('new@myt.com'))
  })

  test('the environment picker offers each name once, not once per project', async () => {
    await open()
    const labels = await optionsOf('Environment', 'All environments')
    expect(labels.filter((l) => l === 'production')).toHaveLength(1)
    expect(labels).toEqual(['All environments', 'production', 'staging'])
  })

  test('the database picker narrows to the chosen environment', async () => {
    await open()
    expect(await optionsOf('Database', 'All databases')).toEqual(['All databases', 'shop', 'ledger', 'cms'])

    await pick('Environment', 'staging')
    await waitFor(() => expect(qs().get('env')).toBe('staging'))
    // ledger is the only staging database; shop and cms are production.
    expect(await optionsOf('Database', 'All databases')).toEqual(['All databases', 'ledger'])
  })

  test('choosing an environment clears the database already selected', async () => {
    // A database from the previous environment is not in the new one, so leaving it
    // set would return nothing while both pickers still read as a valid selection.
    await open('/audit?db=db_shop')
    await waitFor(() => expect(lastRequest()?.database).toBe('db_shop'))

    await pick('Environment', 'staging')
    await waitFor(() => expect(qs().get('env')).toBe('staging'))
    expect(qs().get('db')).toBeNull()
    expect(lastRequest()?.database).toBeUndefined()
  })

  test('a date range sends local-midnight instants, with the end bound a day past the day picked', async () => {
    await open()
    const fromInput = (await screen.findByLabelText('From date')) as HTMLInputElement
    const toInput = screen.getByLabelText('To date') as HTMLInputElement

    fireEvent.change(fromInput, { target: { value: '2026-09-20' } })
    fireEvent.change(toInput, { target: { value: '2026-09-22' } })
    await waitFor(() => expect(lastRequest()?.to).toBeTruthy())

    // Asserted as calendar fields rather than a fixed UTC string, because the value
    // is correct relative to whatever zone the run happens to be in.
    const from = new Date(String(lastRequest()?.from))
    const to = new Date(String(lastRequest()?.to))
    expect([from.getFullYear(), from.getMonth() + 1, from.getDate(), from.getHours()]).toEqual([2026, 9, 20, 0])
    // 23rd, not the 22nd: the bound is exclusive, so the 22nd is fully inside it.
    expect([to.getFullYear(), to.getMonth() + 1, to.getDate(), to.getHours()]).toEqual([2026, 9, 23, 0])
  })

  test('a filter change resets to page 1', async () => {
    // Otherwise a narrower filter lands the reader on a page that no longer exists.
    await open('/audit?page=4')
    await waitFor(() => expect(lastRequest()?.page).toBe(4))

    await pick('Actor', /Ops Rao/)
    await waitFor(() => expect(lastRequest()?.actor).toBe('ops@myt.com'))
    expect(qs().get('page')).toBe('1')
    expect(lastRequest()?.page).toBe(1)
  })

  test('Clear filters drops every sub-filter and keeps the category pill', async () => {
    await open('/audit?category=manual&actor=ops%40myt.com&env=production&db=db_shop&from=2026-09-20&to=2026-09-22')
    await waitFor(() => expect(lastRequest()?.actor).toBe('ops@myt.com'))

    fireEvent.click(await screen.findByRole('button', { name: 'Clear filters' }))
    await waitFor(() => expect(lastRequest()?.actor).toBeUndefined())

    for (const key of ['actor', 'env', 'db', 'from', 'to']) expect(qs().get(key)).toBeNull()
    expect(qs().get('category')).toBe('manual')
    expect(lastRequest()?.category).toBe('manual')
  })

  test('Clear filters is offered only while a sub-filter is set', async () => {
    await open()
    await screen.findByRole('button', { name: 'Actor' })
    expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull()

    await pick('Actor', /Ops Rao/)
    expect(await screen.findByRole('button', { name: 'Clear filters' })).toBeTruthy()
  })
})
