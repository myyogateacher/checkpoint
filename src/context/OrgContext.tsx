import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { api } from '../services/api'
import type { Organization } from '../types'
import { ORG_LOCKED } from '../lib/config'
import { useAuth } from './AuthContext'

interface OrgValue {
  orgs: Organization[]
  currentOrg: Organization | null
  currentOrgId: string | null
  loading: boolean
  locked: boolean
  setCurrentOrg: (id: string) => void
  refresh: () => Promise<Organization[]>
}

const OrgContext = createContext<OrgValue | null>(null)
const CURRENT_ORG_KEY = 'checkpoint.currentOrgId'

export function OrgProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [orgs, setOrgs] = useState<Organization[] | null>(null)
  const [currentOrgId, setCurrentOrgIdState] = useState<string | null>(() => localStorage.getItem(CURRENT_ORG_KEY))

  const refresh = useCallback(async () => {
    const list = await api.getOrganizations()
    setOrgs(list)
    return list
  }, [])

  useEffect(() => {
    if (!user) {
      setOrgs(null)
      return
    }
    void refresh()
  }, [user, refresh])

  // Keep the current org pointing at a real membership.
  useEffect(() => {
    if (!orgs) return
    if (orgs.length === 0) {
      setCurrentOrgIdState(null)
      return
    }
    if (!currentOrgId || !orgs.some((o) => o.id === currentOrgId)) {
      const next = orgs[0].id
      setCurrentOrgIdState(next)
      localStorage.setItem(CURRENT_ORG_KEY, next)
    }
  }, [orgs, currentOrgId])

  const setCurrentOrg = useCallback((id: string) => {
    setCurrentOrgIdState(id)
    localStorage.setItem(CURRENT_ORG_KEY, id)
  }, [])

  const currentOrg = orgs?.find((o) => o.id === currentOrgId) ?? null

  return (
    <OrgContext.Provider
      value={{
        orgs: orgs ?? [],
        currentOrg,
        currentOrgId: currentOrg?.id ?? null,
        loading: !!user && orgs === null,
        locked: ORG_LOCKED,
        setCurrentOrg,
        refresh,
      }}
    >
      {children}
    </OrgContext.Provider>
  )
}

export function useOrg(): OrgValue {
  const ctx = useContext(OrgContext)
  if (!ctx) throw new Error('useOrg must be used within OrgProvider')
  return ctx
}
