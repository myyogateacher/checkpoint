import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { FaCheck, FaCheckDouble, FaClock, FaCommentDots, FaPlay, FaPlus, FaTimes, FaUserCheck } from 'react-icons/fa'
import { api } from '../services/api'
import type { ManagedUser, Migration } from '../types'
import { useAuth } from '../context/AuthContext'
import { can, formatDate, relativeTime } from '../lib/format'
import { notify } from '../lib/toast'
import { PageHeader } from '../components/PageHeader'
import { EngineBadge, StatusBadge } from '../components/badges'
import { Dropdown } from '../components/Dropdown'
import { DateTimePicker } from '../components/DateTimePicker'
import { Button, Card, EmptyState, ErrorBanner, Modal, Spinner, TextArea } from '../components/ui'

const ACTION_TOAST: Record<string, string> = {
  submit: 'Migration submitted for approval',
  approve: 'Migration approved',
  reject: 'Migration rejected',
  apply: 'Migration applied to the database',
}

// Local datetime string (YYYY-MM-DDTHH:mm) for a datetime-local input's value/min.
function localDateTimeValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function MigrationDetailPage() {
  const { migrationId = '' } = useParams()
  const { user } = useAuth()
  const [migration, setMigration] = useState<Migration | null | undefined>(null)
  const [users, setUsers] = useState<ManagedUser[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [rejectOpen, setRejectOpen] = useState(false)
  const [rejectNote, setRejectNote] = useState('')
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const [scheduleAt, setScheduleAt] = useState('')
  const [commentBody, setCommentBody] = useState('')
  const [posting, setPosting] = useState(false)

  useEffect(() => {
    void api.getMigration(migrationId).then((m) => setMigration(m ?? undefined))
    void api.getUsers().then(setUsers)
  }, [migrationId])

  async function addReviewer(email: string) {
    if (!migration) return
    try {
      const updated = await api.setMigrationReviewers(migration.id, [...migration.reviewers, email])
      setMigration(updated)
      notify.success(`Added ${email} as a reviewer`)
    } catch (err) {
      notify.error(err instanceof Error ? err.message : 'Failed to add reviewer')
    }
  }

  async function removeReviewer(email: string) {
    if (!migration) return
    try {
      const updated = await api.setMigrationReviewers(
        migration.id,
        migration.reviewers.filter((r) => r !== email),
      )
      setMigration(updated)
      notify.success(`Removed ${email} as a reviewer`)
    } catch (err) {
      notify.error(err instanceof Error ? err.message : 'Failed to remove reviewer')
    }
  }

  async function postComment() {
    if (!migration || !commentBody.trim()) return
    setPosting(true)
    try {
      const updated = await api.addMigrationComment(migration.id, commentBody.trim())
      setMigration(updated)
      setCommentBody('')
    } catch (err) {
      notify.error(err instanceof Error ? err.message : 'Failed to add comment')
    } finally {
      setPosting(false)
    }
  }

  async function transition(action: 'submit' | 'approve' | 'reject' | 'apply', note?: string) {
    setBusy(true)
    setError(null)
    try {
      const updated = await api.transitionMigration(migrationId, action, note)
      setMigration(updated)
      setRejectOpen(false)
      setRejectNote('')
      notify.success(ACTION_TOAST[action] ?? 'Migration updated')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Action failed'
      setError(msg)
      notify.error(msg)
    } finally {
      setBusy(false)
    }
  }

  function openSchedule() {
    // Default to one hour from now, rounded down to the minute.
    const d = new Date(Date.now() + 60 * 60 * 1000)
    d.setSeconds(0, 0)
    setScheduleAt(localDateTimeValue(d))
    setScheduleOpen(true)
  }

  async function schedule() {
    if (!scheduleAt) return
    setBusy(true)
    setError(null)
    try {
      const updated = await api.scheduleMigration(migrationId, new Date(scheduleAt).toISOString())
      setMigration(updated)
      setScheduleOpen(false)
      setScheduleAt('')
      notify.success('Migration scheduled')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to schedule'
      setError(msg)
      notify.error(msg)
    } finally {
      setBusy(false)
    }
  }

  async function cancelSchedule() {
    setBusy(true)
    setError(null)
    try {
      const updated = await api.cancelMigrationSchedule(migrationId)
      setMigration(updated)
      notify.success('Schedule cancelled')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to cancel schedule'
      setError(msg)
      notify.error(msg)
    } finally {
      setBusy(false)
    }
  }

  if (migration === null) {
    return (
      <Card className="p-6">
        <Spinner label="Loading migration…" />
      </Card>
    )
  }
  if (migration === undefined) return <PageHeader title="Migration not found" />

  const isAuthor = migration.author_email === user?.email
  const canApprove = can(user?.role, 'approve')
  const canEdit = can(user?.role, 'edit')
  const email = user?.email ?? ''
  // Approve/reject: admins or a designated approver; apply: admins or a designated releaser.
  const canApproveMig = canApprove || migration.approvers.includes(email)
  const canApply = canApprove || migration.releasers.includes(email)
  // Hide the Approve button once this user has already approved (one vote each).
  const alreadyApproved = migration.events.some((e) => e.action === 'approve' && e.actor_email === email)
  // Distinct approvers so far, for the approval-progress indicator.
  const approvedBy = Array.from(new Set(migration.events.filter((e) => e.action === 'approve').map((e) => e.actor_email)))
  const showApprovalProgress = migration.status === 'pending_approval' || migration.status === 'approved' || migration.status === 'applied'
  const actions: React.ReactNode[] = []

  if (migration.status === 'draft' && (isAuthor || can(user?.role, 'edit'))) {
    actions.push(
      <Button key="submit" onClick={() => transition('submit')} loading={busy}>
        Submit for approval
      </Button>,
    )
  }
  if (migration.status === 'pending_approval' && canApproveMig) {
    actions.push(
      <Button key="reject" variant="danger" onClick={() => setRejectOpen(true)} disabled={busy}>
        <FaTimes size={11} /> Reject
      </Button>,
    )
    if (!alreadyApproved) {
      actions.push(
        <Button key="approve" onClick={() => transition('approve')} loading={busy}>
          <FaCheck size={11} /> Approve
        </Button>,
      )
    }
  }
  const isScheduled = migration.status === 'approved' && !!migration.scheduled_for
  if (migration.status === 'approved') {
    // Approvers/admins may reject an already-approved migration.
    if (canApproveMig) {
      actions.push(
        <Button key="reject" variant="danger" onClick={() => setRejectOpen(true)} disabled={busy}>
          <FaTimes size={11} /> Reject
        </Button>,
      )
    }
    if (canApply) {
      if (isScheduled) {
        actions.push(
          <Button key="cancel-schedule" variant="secondary" onClick={cancelSchedule} disabled={busy}>
            <FaTimes size={11} /> Cancel Schedule
          </Button>,
        )
      } else {
        actions.push(
          <Button key="schedule" variant="secondary" onClick={openSchedule} disabled={busy}>
            <FaClock size={11} /> Schedule Migration
          </Button>,
        )
      }
      actions.push(
        <Button key="apply" onClick={() => transition('apply')} loading={busy}>
          <FaPlay size={11} /> Apply Migration
        </Button>,
      )
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Migration"
        title={migration.title}
        description={migration.description ?? undefined}
        breadcrumbs={[
          { label: 'Migrations', to: '/migrations' },
          { label: migration.database_name, to: `/databases/${migration.database_id}/migrations` },
          { label: migration.title },
        ]}
        actions={actions.length ? <>{actions}</> : <StatusBadge status={migration.status} />}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {actions.length ? (
            <div className="flex items-center gap-2">
              <StatusBadge status={migration.status} />
            </div>
          ) : null}
          <ErrorBanner message={error} />

          <Card className="p-5">
            <h2 className="mb-3 text-sm font-semibold text-slate-800">
              Queries <span className="font-normal text-slate-400">({migration.queries.length})</span>
            </h2>
            <div className="space-y-3">
              {migration.queries.map((q) => (
                <div key={q.id} className="overflow-hidden rounded-xl border border-slate-200/60 bg-slate-900/95">
                  <div className="flex items-center justify-between border-b border-white/10 px-4 py-1.5 text-xs text-slate-400">
                    <span>Statement {q.order}</span>
                  </div>
                  <pre className="overflow-x-auto px-4 py-3 text-[13px] leading-relaxed text-slate-100">
                    <code>{q.sql}</code>
                  </pre>
                </div>
              ))}
            </div>
          </Card>

          <Card className="p-5">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-800">
              <FaCommentDots className="text-slate-400" />
              Comments <span className="font-normal text-slate-400">({migration.comments.length})</span>
            </h2>

            {migration.comments.length === 0 ? (
              <EmptyState title="No comments yet" hint="Start the discussion below." />
            ) : (
              <ol className="space-y-3">
                {migration.comments.map((c) => (
                  <li key={c.id} className="flex gap-3">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-xs font-semibold text-white">
                      {(c.author_name ?? c.author_email).charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1 rounded-xl border border-slate-200/60 bg-white/40 px-3 py-2">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-sm font-medium text-slate-800">{c.author_name ?? c.author_email}</span>
                        <span className="text-xs text-slate-400">{relativeTime(c.created_at)}</span>
                      </div>
                      <p className="mt-0.5 whitespace-pre-wrap text-sm text-slate-600 dark:text-slate-300">{c.body}</p>
                    </div>
                  </li>
                ))}
              </ol>
            )}

            <div className="mt-4 border-t border-slate-200/60 pt-3">
              <TextArea
                rows={3}
                value={commentBody}
                onChange={(e) => setCommentBody(e.target.value)}
                placeholder="Add a comment…"
              />
              <div className="mt-2 flex justify-end">
                <Button onClick={postComment} loading={posting} disabled={!commentBody.trim()}>
                  <FaPlus size={11} /> Comment
                </Button>
              </div>
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          <Card className="p-5">
            <h2 className="mb-3 text-sm font-semibold text-slate-800">Details</h2>
            <dl className="space-y-2 text-sm">
              <Meta label="Database">
                <span className="flex items-center gap-2">
                  <span className="font-mono text-[13px]">{migration.database_name}</span>
                  <EngineBadge engine={migration.engine} />
                </span>
              </Meta>
              <Meta label="Status">
                <StatusBadge status={migration.status} />
              </Meta>
              <Meta label="Author">{migration.author_email}</Meta>
              <Meta label="Created">{formatDate(migration.created_at)}</Meta>
              <Meta label="Approved by">{migration.approved_by ?? '—'}</Meta>
              {migration.scheduled_for ? (
                <>
                  <Meta label="Scheduled">{formatDate(migration.scheduled_for)}</Meta>
                  <Meta label="Scheduled by">{migration.scheduled_by ?? '—'}</Meta>
                </>
              ) : null}
              <Meta label="Applied">{formatDate(migration.applied_at)}</Meta>
            </dl>

            {showApprovalProgress ? (
              <div className="mt-4 border-t border-slate-200/60 pt-3">
                <div className="mb-2 flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-slate-400">
                  <span className="flex items-center gap-2">
                    <FaCheckDouble size={11} /> Approvals
                  </span>
                  <span className={approvedBy.length >= migration.required_approvals ? 'text-emerald-600' : 'text-slate-500'}>
                    {approvedBy.length} / {migration.required_approvals}
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200/70">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-blue-600 to-indigo-600 transition-all"
                    style={{ width: `${Math.min(100, (approvedBy.length / migration.required_approvals) * 100)}%` }}
                  />
                </div>
                {approvedBy.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {approvedBy.map((e) => {
                      const u = users.find((x) => x.email === e)
                      return (
                        <span
                          key={e}
                          className="inline-flex items-center gap-1 rounded-full border border-emerald-200/70 bg-emerald-50/80 px-2 py-0.5 text-xs text-emerald-700 dark:border-emerald-400/40 dark:bg-emerald-500/20 dark:text-emerald-200"
                        >
                          <FaCheck size={8} /> {u?.name ?? e}
                        </span>
                      )
                    })}
                  </div>
                ) : (
                  <p className="mt-2 text-sm text-slate-500">Awaiting approvals.</p>
                )}
              </div>
            ) : null}

            <div className="mt-4 border-t border-slate-200/60 pt-3">
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                <FaUserCheck size={11} /> Reviewers
              </div>
              {migration.reviewers.length === 0 ? (
                <p className="text-sm text-slate-500">No reviewers assigned.</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {migration.reviewers.map((email) => {
                    const u = users.find((x) => x.email === email)
                    return (
                      <span
                        key={email}
                        className="inline-flex items-center gap-1.5 rounded-full border border-slate-200/70 bg-white/60 py-0.5 pl-2 pr-1 text-xs text-slate-700 dark:text-slate-200"
                      >
                        {u?.name ?? email}
                        {canEdit ? (
                          <button
                            onClick={() => removeReviewer(email)}
                            className="cursor-pointer rounded-full p-0.5 text-slate-400 hover:text-rose-500"
                            aria-label={`Remove ${email}`}
                          >
                            <FaTimes size={9} />
                          </button>
                        ) : null}
                      </span>
                    )
                  })}
                </div>
              )}
              {canEdit ? (
                <div className="mt-2">
                  <Dropdown
                    value=""
                    placeholder="Add reviewer…"
                    onChange={addReviewer}
                    options={users
                      .filter((u) => u.email !== migration.author_email && !migration.reviewers.includes(u.email))
                      .map((u) => ({ value: u.email, label: u.name ?? u.email, hint: u.email }))}
                  />
                </div>
              ) : null}
            </div>
          </Card>

          <Card className="p-5">
            <h2 className="mb-3 text-sm font-semibold text-slate-800">Audit trail</h2>
            <ol className="space-y-3">
              {migration.events.map((ev, i) => (
                <li key={i} className="flex gap-3">
                  <div className="mt-1 flex flex-col items-center">
                    <span className="h-2 w-2 rounded-full bg-indigo-400" />
                    {i < migration.events.length - 1 ? <span className="mt-1 h-full w-px flex-1 bg-slate-200" /> : null}
                  </div>
                  <div className="pb-1">
                    <p className="text-sm text-slate-800">
                      <span className="font-medium capitalize">{ev.action}</span> by {ev.actor_email}
                    </p>
                    <p className="text-xs text-slate-500">{formatDate(ev.at)}</p>
                    {ev.note ? <p className="mt-0.5 text-xs text-slate-600">“{ev.note}”</p> : null}
                  </div>
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>

      <Modal
        open={rejectOpen}
        title="Reject migration"
        onClose={() => setRejectOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setRejectOpen(false)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => transition('reject', rejectNote)} loading={busy}>
              Reject migration
            </Button>
          </>
        }
      >
        <TextArea
          rows={3}
          value={rejectNote}
          onChange={(e) => setRejectNote(e.target.value)}
          placeholder="Reason for rejection (shared with the author)"
        />
      </Modal>

      <Modal
        open={scheduleOpen}
        title="Schedule migration"
        onClose={() => setScheduleOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setScheduleOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={schedule}
              loading={busy}
              disabled={!scheduleAt || new Date(scheduleAt).getTime() <= Date.now()}
            >
              <FaClock size={11} /> Schedule migration
            </Button>
          </>
        }
      >
        <div>
          <p className="mb-3 text-sm text-slate-600 dark:text-slate-300">
            The migration will be applied automatically at the selected date and time.
          </p>
          <DateTimePicker value={scheduleAt} onChange={setScheduleAt} min={new Date()} />
        </div>
      </Modal>
    </>
  )
}

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-right text-slate-800">{children}</dd>
    </div>
  )
}
