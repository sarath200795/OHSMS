import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from './AuthContext'
import {
  subscribeExtinguishers,
  subscribeReports,
  subscribeOrgUsers,
  subscribeOrg,
  subscribeStats,
  subscribeAuditLogs,
  subscribeSignages,
  subscribeMockDrills,
  subscribeAeds,
  subscribeFas,
  subscribeFirstAid,
  subscribeStretchers,
  backfillDeletedAt,
  ensureOrgIndex,
} from '../lib/firestore'
import {
  fleetSummary,
  isToBeRefilled,
  isInProcess,
  isPhysicalDefect,
  isRefilledClosed,
  isDeleted,
} from '../lib/extinguisherLogic'
import { derivePhysicalDefectLog } from '../lib/defectReports'
import { aedCondition, fasCondition, stretcherCondition } from '../lib/assetLogic'
import { EXT_LOAD_CAP } from '../lib/firestore'
import { subscribeSites, incompleteReadNotice } from '../../../shared/org/orgData'
import { resolveAccessibleSites } from '../../../shared/auth/access'
import { useTodayKey } from '../../../shared/lib/useToday'
import { withSites } from '../lib/siteResolve'

const FleetContext = createContext(null)

/**
 * One set of real-time listeners for the whole authed app: extinguishers,
 * reports (approval queue), org users and the org document. Pages read derived
 * slices from here.
 */
export function FleetProvider({ children }) {
  const { orgId, profile, isAdmin } = useAuth()
  const [extinguishers, setExtinguishers] = useState([])
  const [allSites, setAllSites] = useState([])
  const [reports, setReports] = useState([])
  const [users, setUsers] = useState([])
  const [org, setOrg] = useState(null)
  const [stats, setStats] = useState(null)
  const [auditLogs, setAuditLogs] = useState([])
  const [signages, setSignages] = useState([])
  const [mockDrills, setMockDrills] = useState([])
  const [aeds, setAeds] = useState([])
  const [fas, setFas] = useState([])
  const [firstAid, setFirstAid] = useState([])
  const [stretchers, setStretchers] = useState([])
  const [loading, setLoading] = useState(true)
  // Run the deletedAt backfill at most once per org per session.
  const backfilledRef = useRef(null)
  // Self-heal the public orgIndex entry at most once per org per session.
  const orgIndexedRef = useRef(null)

  useEffect(() => {
    if (!orgId) return
    setLoading(true)
    let ready = false
    const done = () => {
      if (!ready) {
        ready = true
        setLoading(false)
      }
    }
    const u1 = subscribeExtinguishers(orgId, (list) => {
      setExtinguishers(list)
      done()
      // One-time migration: make pre-soft-delete docs visible to the Repository's
      // server query (which filters deletedAt == null). Fire-and-forget; the
      // listener re-delivers the patched docs automatically.
      if (backfilledRef.current !== orgId && list.some((e) => e && e.deletedAt === undefined)) {
        backfilledRef.current = orgId
        backfillDeletedAt(orgId, list).catch((err) => {
          // eslint-disable-next-line no-console
          console.warn('[Fire Marshal] deletedAt backfill failed:', err?.message || err)
        })
      }
    })
    const u2 = subscribeReports(orgId, setReports)
    const u3 = subscribeOrgUsers(orgId, setUsers)
    const u4 = subscribeOrg(orgId, (o) => {
      setOrg(o)
      // Backfill the public orgIndex entry for orgs created before that feature,
      // so they appear in the signup dropdown. Once per org per session.
      if (o && o.name && orgIndexedRef.current !== orgId) {
        orgIndexedRef.current = orgId
        // Fire-and-forget self-heal; ignore failures (e.g. blocked in demo mode).
        ensureOrgIndex({ id: o.id || orgId, name: o.name }).catch(() => {})
      }
    })
    const u5 = subscribeStats(orgId, setStats)
    const u6 = subscribeAuditLogs(orgId, setAuditLogs)
    const u7 = subscribeSignages(orgId, setSignages)
    const u8 = subscribeMockDrills(orgId, setMockDrills)
    const u9 = subscribeAeds(orgId, setAeds)
    const u10 = subscribeFas(orgId, setFas)
    const u11 = subscribeSites(orgId, setAllSites)
    const u12 = subscribeFirstAid(orgId, setFirstAid)
    const u13 = subscribeStretchers(orgId, setStretchers)
    return () => {
      u1()
      u2()
      u3()
      u4()
      u5()
      u6()
      u7()
      u8()
      u9()
      u10()
      u11()
      u12()
      u13()
    }
  }, [orgId])

  // Sites the current user is permitted for (correlated Region/Entity/Site picker).
  const siteInventory = useMemo(
    () => resolveAccessibleSites(profile, allSites, { isAdmin }),
    [allSites, profile, isAdmin]
  )

  // The calendar day is a DEPENDENCY, not something read once. Every derived
  // state below — Refill Due, HPT overdue, the physical-defect count — is
  // computed here from `today`, and the memo only re-ran when the DATA changed.
  // A dashboard left on a wall therefore kept reporting yesterday's answer
  // until somebody edited an unrelated unit.
  const todayKey = useTodayKey()

  const value = useMemo(() => {
    const today = new Date()
    // Soft-deleted units live in the Recycle Bin only — exclude everywhere else.
    // Fill in center/region/entity from the site registry wherever a unit left
    // them blank. Units added by import, or before their site existed, carry
    // only a siteId — their rows showed an empty Entity and Center, which reads
    // as "never captured" when the site is known and one lookup away. Nothing is
    // written: the asset's own values always win, and the link-to-sites action
    // keeps its job of persisting them.
    const active = withSites(extinguishers.filter((e) => !isDeleted(e)), allSites)
    const deletedExtinguishers = extinguishers.filter((e) => isDeleted(e))
    const summary = fleetSummary(active, today)
    const defectLog = derivePhysicalDefectLog(reports, active)
    // Distinct site names (centerName) seen anywhere — used to populate the
    // site filters / datalists on the signage + mock-drill pages.
    const sites = Array.from(
      new Set(
        [
          ...active.map((e) => e.centerName),
          ...signages.map((s) => s.centerName),
          ...mockDrills.map((d) => d.centerName),
          ...aeds.map((a) => a.centerName),
          ...fas.map((a) => a.centerName),
          ...firstAid.map((r) => r.centerName),
          ...stretchers.map((a) => a.centerName),
        ].filter((c) => c && c.trim())
      )
    ).sort((a, b) => a.localeCompare(b))
    return {
      loading,
      org,
      stats,
      auditLogs,
      signages,
      mockDrills,
      aeds,
      fas,
      firstAid,
      stretchers,
      stretchersDue: stretchers.filter((a) => { const c = stretcherCondition(a, today); return c.due || c.expired }).length,
      aedsDue: aeds.filter((a) => { const c = aedCondition(a, today); return c.due || c.expired }).length,
      fasDue: fas.filter((a) => { const c = fasCondition(a, today); return c.due || c.expired }).length,
      sites,
      siteInventory,
      extinguishers: active,
      deletedExtinguishers,
      // True when the live load hit the cap (full set may be larger).
      capped: extinguishers.length >= EXT_LOAD_CAP,
      loadCap: EXT_LOAD_CAP,
      // Every capped register in this module, in the app's standard shape.
      //
      // `capped` above covers extinguishers alone, and the Dashboard's banner
      // said "the most recent 2 000 extinguishers" while the same page's AED,
      // FAS, signage, first aid, stretcher and drill figures were being
      // truncated in silence beside it. A caveat that names one short number of
      // several is worse than none: it reads as an assurance about the rest.
      incomplete: incompleteReadNotice({
        extinguishers: extinguishers.length >= EXT_LOAD_CAP ? 'capped' : 'ok',
        aeds: aeds.length >= EXT_LOAD_CAP ? 'capped' : 'ok',
        fas: fas.length >= EXT_LOAD_CAP ? 'capped' : 'ok',
        signages: signages.length >= EXT_LOAD_CAP ? 'capped' : 'ok',
        firstAid: firstAid.length >= EXT_LOAD_CAP ? 'capped' : 'ok',
        stretchers: stretchers.length >= EXT_LOAD_CAP ? 'capped' : 'ok',
        mockDrills: mockDrills.length >= EXT_LOAD_CAP ? 'capped' : 'ok',
        reports: reports.length >= EXT_LOAD_CAP ? 'capped' : 'ok',
      }, EXT_LOAD_CAP),
      reports,
      users,
      summary,
      pendingReports: reports.filter((r) => r.approvalStatus === 'pending'),
      pendingUsers: users.filter((u) => u.status === 'pending'),
      refillDue: active.filter((e) => isToBeRefilled(e, today)),
      inProcess: active.filter((e) => isInProcess(e)),
      physicalDefects: active.filter((e) => isPhysicalDefect(e)),
      closed: active.filter((e) => isRefilledClosed(e)),
      physicalOpen: defectLog.open,
      physicalClosed: defectLog.closed,
    }
  }, [extinguishers, reports, users, org, stats, auditLogs, signages, mockDrills, aeds, fas, firstAid, stretchers, allSites, siteInventory, loading, todayKey])

  return <FleetContext.Provider value={value}>{children}</FleetContext.Provider>
}

export function useFleet() {
  const ctx = useContext(FleetContext)
  if (!ctx) throw new Error('useFleet must be used within FleetProvider')
  return ctx
}
