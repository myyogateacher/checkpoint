import { useEffect, useMemo, useState } from 'react'
import { FaSearch } from 'react-icons/fa'
import { api } from '../services/api'
import type { DatabaseEngine } from '../types'
import { ENGINE_LABELS } from '../lib/format'
import { CATEGORY_LABELS, ENGINES, engineDot, type EngineCategory } from '../lib/engines'
import { RULE_ENGINES, type ValidationSection } from '../lib/validationRules'
import { notify } from '../lib/toast'
import { PageHeader } from '../components/PageHeader'
import { Button, Card, Spinner, TextInput } from '../components/ui'

const CATEGORY_ORDER: EngineCategory[] = ['relational', 'analytics', 'nosql']

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative h-5 w-9 shrink-0 cursor-pointer rounded-full transition ${
        checked ? 'bg-gradient-to-r from-blue-600 to-indigo-600' : 'bg-slate-300 dark:bg-slate-600'
      }`}
    >
      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${checked ? 'left-4' : 'left-0.5'}`} />
    </button>
  )
}

export function ValidationRulesPage() {
  const [engine, setEngine] = useState<DatabaseEngine>(RULE_ENGINES[0])
  const [sections, setSections] = useState<ValidationSection[] | null>(null)
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')

  // Engines that have rules, grouped by category and filtered by the search.
  const groups = useMemo(() => {
    const q = search.trim().toLowerCase()
    return CATEGORY_ORDER.map((cat) => ({
      category: cat,
      engines: RULE_ENGINES.filter(
        (e) => ENGINES[e].category === cat && (!q || ENGINE_LABELS[e].toLowerCase().includes(q)),
      ),
    })).filter((g) => g.engines.length > 0)
  }, [search])

  useEffect(() => {
    setSections(null)
    void api.getValidationRules(engine).then(setSections)
  }, [engine])

  function patchSection(sid: string, fn: (s: ValidationSection) => ValidationSection) {
    setSections((prev) => prev?.map((s) => (s.id === sid ? fn(s) : s)) ?? null)
  }
  function setRule(sid: string, rid: string, patch: Partial<ValidationSection['rules'][number]>) {
    patchSection(sid, (s) => ({ ...s, rules: s.rules.map((r) => (r.id === rid ? { ...r, ...patch } : r)) }))
  }

  async function save() {
    if (!sections) return
    setSaving(true)
    try {
      await api.saveValidationRules(engine, sections)
      notify.success(`Validation rules saved for ${ENGINE_LABELS[engine]}`)
    } catch (err) {
      notify.error(err instanceof Error ? err.message : 'Failed to save rules')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Governance"
        title="Validation Rules (Beta)"
        description="Rules enforced when a migration is created. Toggle sections or individual rules per database type."
        actions={
          <Button onClick={save} loading={saving} disabled={!sections}>
            Save changes
          </Button>
        }
      />

      <div className="flex flex-col gap-5 lg:flex-row">
        {/* Database picker — grouped, searchable list */}
        <Card className="shrink-0 p-3 lg:w-60 lg:self-start">
          <div className="relative mb-2">
            <FaSearch className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={11} />
            <TextInput
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search database type…"
              className="pl-8 text-sm"
            />
          </div>
          <div className="max-h-[60vh] space-y-3 overflow-y-auto lg:max-h-none">
            {groups.length === 0 ? (
              <p className="px-2 py-3 text-xs text-slate-400">No matches.</p>
            ) : (
              groups.map((g) => (
                <div key={g.category}>
                  <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                    {CATEGORY_LABELS[g.category]}
                  </p>
                  <div className="space-y-0.5">
                    {g.engines.map((e) => (
                      <button
                        key={e}
                        onClick={() => setEngine(e)}
                        className={`flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm transition ${
                          engine === e
                            ? 'bg-indigo-50 font-medium text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300'
                            : 'text-slate-700 hover:bg-white/70 dark:text-slate-200'
                        }`}
                      >
                        <span className={`h-2 w-2 shrink-0 rounded-full ${engineDot(e)}`} />
                        <span className="truncate">{ENGINE_LABELS[e]}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>

        {/* Rules for the selected engine */}
        <div className="min-w-0 flex-1">
          {sections === null ? (
            <Card className="p-6">
              <Spinner label="Loading rules…" />
            </Card>
          ) : (
            <div className="space-y-4">
              {sections.map((section) => (
            <Card key={section.id} className="overflow-hidden p-0">
              <div className="flex items-center justify-between gap-3 border-b border-slate-200/60 px-5 py-3">
                <h2 className="text-sm font-semibold text-slate-800">{section.title}</h2>
                <Toggle checked={section.enabled} onChange={(v) => patchSection(section.id, (s) => ({ ...s, enabled: v }))} />
              </div>
              <div className={`divide-y divide-slate-200/50 ${section.enabled ? '' : 'pointer-events-none opacity-50'}`}>
                {section.rules.map((rule) => (
                  <div key={rule.id} className="flex items-start gap-3 px-5 py-3">
                    <div className="pt-0.5">
                      <Toggle checked={rule.enabled} onChange={(v) => setRule(section.id, rule.id, { enabled: v })} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{rule.title}</p>
                      <p className="mt-0.5 text-xs text-slate-500">{rule.description}</p>
                      {rule.example ? (
                        <pre className="mt-2 overflow-x-auto rounded-lg border border-slate-200/60 bg-slate-900/95 px-3 py-2 text-[12px] leading-relaxed text-slate-100">
                          <code>{rule.example}</code>
                        </pre>
                      ) : null}
                      {rule.value ? (
                        <div className="mt-2 flex items-center gap-2">
                          <span className="text-xs text-slate-500">Value:</span>
                          <TextInput
                            value={rule.currentValue ?? rule.value.default}
                            onChange={(e) => setRule(section.id, rule.id, { currentValue: e.target.value })}
                            className="!w-28 !py-1 text-sm"
                          />
                          {rule.value.unit ? <span className="text-xs text-slate-400">{rule.value.unit}</span> : null}
                        </div>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
