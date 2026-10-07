import { useMemo, useState } from 'react'
import { FaChevronDown, FaChevronRight, FaFolder, FaFolderOpen, FaKey } from 'react-icons/fa'
import type { KeyLeaf, KeyNode, Keyspace } from '../types'
import { formatRows } from '../lib/format'
import { Highlight } from './Highlight'

// Quote a key for the command line when it has spaces or quotes.
function quoteKey(key: string): string {
  return /[\s"']/.test(key) || key === '' ? `"${key.replace(/(["\\])/g, '\\$1')}"` : key
}

// The read command that best shows a key of the given Redis type.
export function redisReadCommand(leaf: KeyLeaf): string {
  const k = quoteKey(leaf.key)
  switch (leaf.type) {
    case 'string':
      return `GET ${k}`
    case 'hash':
      return `HGETALL ${k}`
    case 'list':
      return `LRANGE ${k} 0 99`
    case 'set':
      return `SMEMBERS ${k}`
    case 'zset':
      return `ZRANGE ${k} 0 99 WITHSCORES`
    case 'stream':
      return `XRANGE ${k} - + COUNT 100`
    default:
      return `TYPE ${k}`
  }
}

const TYPE_STYLES: Record<string, string> = {
  string: 'text-sky-600 dark:text-sky-400',
  hash: 'text-violet-600 dark:text-violet-400',
  list: 'text-emerald-600 dark:text-emerald-400',
  set: 'text-amber-600 dark:text-amber-400',
  zset: 'text-rose-600 dark:text-rose-400',
  stream: 'text-teal-600 dark:text-teal-400',
}

const MAX_SEARCH_RESULTS = 300

// Folder tree over a scanned Redis keyspace (see Keyspace). Folders only expand
// when clicked; everything renders from the stored snapshot, so browsing never
// touches the server. Clicking a key hands back its suggested read command.
export function KeyspaceTree({
  keyspace,
  query = '',
  compact = false,
  onPickKey,
}: {
  keyspace: Keyspace
  query?: string
  compact?: boolean
  onPickKey?: (leaf: KeyLeaf) => void
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const q = query.trim().toLowerCase()

  // Searching flattens the sampled keys and folder prefixes that match.
  const matches = useMemo(() => {
    if (!q) return null
    const folders: KeyNode[] = []
    const keys: KeyLeaf[] = []
    const walk = (n: KeyNode) => {
      if (folders.length + keys.length >= MAX_SEARCH_RESULTS) return
      if (n.prefix && n.prefix.toLowerCase().includes(q)) folders.push(n)
      for (const k of n.keys) if (k.key.toLowerCase().includes(q)) keys.push(k)
      n.folders.forEach(walk)
    }
    walk(keyspace.root)
    return { folders: folders.slice(0, MAX_SEARCH_RESULTS), keys: keys.slice(0, MAX_SEARCH_RESULTS) }
  }, [keyspace, q])

  const text = compact ? 'text-[12px]' : 'text-[13px]'
  const toggle = (prefix: string) => setOpen((prev) => ({ ...prev, [prefix]: !prev[prefix] }))

  const keyRow = (leaf: KeyLeaf, label: string) => (
      <li key={leaf.key}>
        <button
          onClick={() => onPickKey?.(leaf)}
          disabled={!onPickKey}
          title={onPickKey ? `${redisReadCommand(leaf)}` : leaf.key}
          className="flex w-full items-center gap-1.5 rounded px-1.5 py-0.5 text-left transition hover:bg-white/60 disabled:cursor-default disabled:hover:bg-transparent"
        >
          <FaKey size={8} className="shrink-0 text-slate-400" />
          <span className={`min-w-0 truncate font-mono ${text} text-slate-700 dark:text-slate-300`}>
            <Highlight text={label} query={q} />
          </span>
          {leaf.type ? (
            <span className={`ml-auto shrink-0 pl-1 font-mono text-[10px] ${TYPE_STYLES[leaf.type] ?? 'text-slate-400'}`}>
              {leaf.type}
            </span>
          ) : null}
        </button>
      </li>
    )

  const more = (n: number, what: string) =>
    n > 0 ? (
      <li key={`more-${what}`} className="px-1.5 py-0.5 text-[11px] italic text-slate-400">
        +{formatRows(n)} more {what} not listed
      </li>
    ) : null

  // `full` shows the whole prefix (search results) instead of the segment name.
  function folder(node: KeyNode, full = false) {
    const expanded = !!open[node.prefix]
    return (
      <li key={node.prefix}>
        <button
          onClick={() => toggle(node.prefix)}
          className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-0.5 text-left transition hover:bg-white/60"
          title={`${node.prefix}*`}
        >
          <span className="text-slate-400">{expanded ? <FaChevronDown size={9} /> : <FaChevronRight size={9} />}</span>
          {expanded ? (
            <FaFolderOpen size={11} className="shrink-0 text-amber-500" />
          ) : (
            <FaFolder size={11} className="shrink-0 text-amber-500" />
          )}
          <span className={`min-w-0 truncate font-mono ${text} text-slate-700 dark:text-slate-200`}>
            {full ? (
              <Highlight text={node.prefix} query={q} />
            ) : (
              <>
                {node.name || <span className="italic text-slate-400">(empty)</span>}
                <span className="text-slate-400">{node.delimiter}</span>
              </>
            )}
          </span>
          <span className="ml-auto shrink-0 pl-1 text-[10px] text-slate-400">{formatRows(node.count)}</span>
        </button>
        {expanded ? children(node) : null}
      </li>
    )
  }

  const children = (node: KeyNode, root = false) => (
    <ul className={root ? '' : 'ml-3 border-l border-slate-200/60 pl-1.5'}>
      {node.folders.map((f) => folder(f))}
      {more(node.more_folders, 'folders')}
      {node.keys.map((k) => keyRow(k, k.key.slice(node.prefix.length)))}
      {more(node.more_keys, 'keys')}
    </ul>
  )

  if (matches) {
    if (matches.folders.length === 0 && matches.keys.length === 0) {
      return <p className="px-1.5 py-2 text-xs text-slate-400">No scanned keys match.</p>
    }
    return (
      <ul>
        {matches.folders.map((f) => folder(f, true))}
        {matches.keys.map((k) => keyRow(k, k.key))}
      </ul>
    )
  }

  return children(keyspace.root, true)
}
