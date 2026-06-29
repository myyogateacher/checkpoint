import { FaTimes } from 'react-icons/fa'
import type { ManagedUser } from '../types'
import { Dropdown } from './Dropdown'

// Pick multiple users by email — selected ones show as removable chips, with a
// dropdown to add the rest. Used for project approvers/releasers and elsewhere.
export function UserMultiSelect({
  users,
  selected,
  onChange,
  editable = true,
  placeholder = 'Add user…',
}: {
  users: ManagedUser[]
  selected: string[]
  onChange: (emails: string[]) => void
  editable?: boolean
  placeholder?: string
}) {
  const nameFor = (email: string) => users.find((u) => u.email === email)?.name ?? email

  return (
    <div className="space-y-2">
      {selected.length === 0 ? (
        <p className="text-sm text-slate-500">None selected.</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((email) => (
            <span
              key={email}
              className="inline-flex items-center gap-1.5 rounded-full border border-slate-200/70 bg-white/60 py-0.5 pl-2.5 pr-1 text-xs text-slate-700 dark:text-slate-200"
            >
              {nameFor(email)}
              {editable ? (
                <button
                  onClick={() => onChange(selected.filter((e) => e !== email))}
                  className="cursor-pointer rounded-full p-0.5 text-slate-400 hover:text-rose-500"
                  aria-label={`Remove ${email}`}
                >
                  <FaTimes size={9} />
                </button>
              ) : null}
            </span>
          ))}
        </div>
      )}

      {editable ? (
        <Dropdown
          value=""
          placeholder={placeholder}
          onChange={(email) => onChange([...selected, email])}
          menuMinWidth={260}
          options={users
            .filter((u) => !selected.includes(u.email))
            .map((u) => ({ value: u.email, label: u.name ?? u.email, hint: u.email }))}
        />
      ) : null}
    </div>
  )
}
