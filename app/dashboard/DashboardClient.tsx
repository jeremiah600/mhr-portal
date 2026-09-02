'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient, SCENARIOS } from '@/lib/supabase'

// ─── Types ────────────────────────────────────────────────────────────────────

interface UserProfile {
  role: 'admin' | 'director'
  dept_code: string | null
}

interface AccountMeta {
  account_code: string
  description: string
}

interface LineItem {
  id: string
  account_code: string
  description: string
  employee_name: string
  vendor: string
  notes: string
  month: number
  amount: number
  status: 'draft' | 'submitted' | 'approved' | 'returned'
  submitted_at: string | null
  approved_by_jeremiah: boolean
  jeremiah_approved_at: string | null
  approved_by_joseph: boolean
  joseph_approved_at: string | null
  return_comment: string | null
}

interface WindowRow {
  id: string
  dept_code: string | null
  is_open: boolean
}

interface PendingItem extends LineItem {
  dept_code: string
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const LINE_SELECT = [
  'id', 'account_code', 'description', 'employee_name', 'vendor', 'notes',
  'month', 'amount', 'status', 'submitted_at',
  'approved_by_jeremiah', 'jeremiah_approved_at',
  'approved_by_joseph', 'joseph_approved_at', 'return_comment',
].join(', ')

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return n === 0 ? '—' : n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

function itemMonthTotal(items: LineItem[], account_code: string, month: number): number {
  return items
    .filter(i => i.account_code === account_code && i.month === month)
    .reduce((s, i) => s + i.amount, 0)
}

/** Returns true if a 2027 budget month is in the past relative to today */
function isPastMonth(month: number): boolean {
  const now = new Date()
  if (now.getFullYear() < 2027) return false
  if (now.getFullYear() > 2027) return true
  return month < now.getMonth() + 1
}

const emptyForm = () => ({
  description: '',
  employee_name: '',
  vendor: '',
  notes: '',
  entryType: 'once' as 'once' | 'recurring',
  month: 1,
  fromMonth: 1,
  toMonth: 12,
  amount: '',
})

const LS_KEY = (dept: string, code: string) => `mhr-form-${dept}-${code}`

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusBadge({ item }: { item: LineItem }) {
  if (item.status === 'approved') return (
    <span className="inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full"
      style={{ background: '#d1fae5', color: '#065f46' }}>✓ Approved</span>
  )
  if (item.status === 'returned') return (
    <span className="inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full"
      style={{ background: '#fee2e2', color: '#991b1b' }}
      title={item.return_comment ?? 'No comment provided'}>↩ Returned</span>
  )
  if (item.status === 'submitted') return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold whitespace-nowrap"
      style={{ color: '#6b7280' }}>
      <span style={{ color: item.approved_by_jeremiah ? '#059669' : '#d1d5db' }}>
        {item.approved_by_jeremiah ? '✓' : '⏳'} J.B.
      </span>
      <span style={{ color: '#e5e7eb' }}>·</span>
      <span style={{ color: item.approved_by_joseph ? '#059669' : '#d1d5db' }}>
        {item.approved_by_joseph ? '✓' : '⏳'} J.L.
      </span>
    </span>
  )
  return (
    <span className="inline-flex items-center text-xs font-semibold px-2 py-0.5 rounded-full"
      style={{ background: '#f3f4f6', color: '#9ca3af' }}>Draft</span>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const router = useRouter()
  const supabase = createClient()

  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [userEmail, setUserEmail] = useState('')
  const [userId, setUserId] = useState('')
  const [activeDept, setActiveDept] = useState<string>('')
  const [activeTab, setActiveTab] = useState<'input' | 'ref2026' | 'ref2025' | 'admin'>('input')

  const [deptNames, setDeptNames] = useState<Record<string, string>>({})
  const [accounts, setAccounts] = useState<AccountMeta[]>([])
  const [glDescriptions, setGlDescriptions] = useState<Record<string, string>>({})
  const [lineItems, setLineItems] = useState<LineItem[]>([])
  const [ref2026Items, setRef2026Items] = useState<LineItem[]>([])
  const [ref2025Items, setRef2025Items] = useState<LineItem[]>([])

  // Submission window state
  const [windowOpen, setWindowOpen] = useState(false)
  const [windows, setWindows] = useState<WindowRow[]>([])

  // Admin: pending approvals across all depts
  const [pendingItems, setPendingItems] = useState<PendingItem[]>([])
  const [returnComment, setReturnComment] = useState<Record<string, string>>({})
  const [returningId, setReturningId] = useState<string | null>(null)

  const [expandedAccounts, setExpandedAccounts] = useState<Set<string>>(new Set())
  const [expandedRef2026, setExpandedRef2026] = useState<Set<string>>(new Set())
  const [expandedRef2025, setExpandedRef2025] = useState<Set<string>>(new Set())
  const [addingTo, setAddingTo] = useState<string | null>(null)
  const [addForm, setAddForm] = useState(emptyForm())

  const [loading, setLoading] = useState(true)
  const [actionMsg, setActionMsg] = useState('')
  const [savingItem, setSavingItem] = useState(false)
  const [submittingId, setSubmittingId] = useState<string | null>(null)
  const [approvingId, setApprovingId] = useState<string | null>(null)
  const [togglingWindow, setTogglingWindow] = useState<string | null>(null)

  // ── Auto-save form to localStorage ────────────────────────────────────────

  useEffect(() => {
    if (addingTo && activeDept) {
      try { localStorage.setItem(LS_KEY(activeDept, addingTo), JSON.stringify(addForm)) } catch {}
    }
  }, [addForm, addingTo, activeDept])

  // ── Load profile + dept names ──────────────────────────────────────────────

  useEffect(() => {
    async function loadProfile() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }
      setUserEmail(user.email ?? '')
      setUserId(user.id)

      const { data: depts } = await supabase
        .from('departments')
        .select('dept_code, dept_name')
        .order('dept_code')
      const nameMap: Record<string, string> = {}
      for (const d of depts ?? []) nameMap[d.dept_code] = d.dept_name
      setDeptNames(nameMap)

      const { data: dept } = await supabase
        .from('user_departments')
        .select('role, dept_code')
        .eq('user_id', user.id)
        .single()

      if (!dept) { router.push('/login'); return }
      setProfile(dept as UserProfile)
      setActiveDept(dept.dept_code ?? Object.keys(nameMap)[0])
    }
    loadProfile()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Load submission windows ────────────────────────────────────────────────

  const loadWindows = useCallback(async () => {
    const { data } = await supabase
      .from('budget_submission_windows')
      .select('id, dept_code, is_open')
      .eq('scenario_id', SCENARIOS.DIRECTOR_2027)
    setWindows((data ?? []) as WindowRow[])
    return (data ?? []) as WindowRow[]
  }, [supabase])

  function windowIsOpen(dept: string, wins: WindowRow[]): boolean {
    const deptSpecific = wins.find(w => w.dept_code === dept)
    if (deptSpecific) return deptSpecific.is_open
    const global = wins.find(w => w.dept_code === null)
    return global?.is_open ?? false
  }

  // ── Load budget data ───────────────────────────────────────────────────────

  const loadBudgetData = useCallback(async (dept: string) => {
    setLoading(true)
    setActionMsg('')

    const [res2025, res2026, res2027, wins] = await Promise.all([
      supabase
        .from('budget_line_items')
        .select(LINE_SELECT)
        .eq('scenario_id', SCENARIOS.BI_2025)
        .eq('dept_code', dept)
        .order('account_code').order('created_at'),
      supabase
        .from('budget_line_items')
        .select(LINE_SELECT)
        .eq('scenario_id', SCENARIOS.BI_2026)
        .eq('dept_code', dept)
        .order('account_code').order('created_at'),
      supabase
        .from('budget_line_items')
        .select(LINE_SELECT)
        .eq('scenario_id', SCENARIOS.DIRECTOR_2027)
        .eq('dept_code', dept)
        .order('account_code').order('created_at'),
      loadWindows(),
    ])

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cast = (r: any): LineItem => ({
      id: r.id as string,
      account_code: r.account_code as string,
      description: r.description as string,
      employee_name: r.employee_name as string,
      vendor: r.vendor as string,
      notes: r.notes as string,
      month: r.month as number,
      amount: Number(r.amount),
      status: (r.status as LineItem['status']) ?? 'draft',
      submitted_at: r.submitted_at as string | null,
      approved_by_jeremiah: Boolean(r.approved_by_jeremiah),
      jeremiah_approved_at: r.jeremiah_approved_at as string | null,
      approved_by_joseph: Boolean(r.approved_by_joseph),
      joseph_approved_at: r.joseph_approved_at as string | null,
      return_comment: r.return_comment as string | null,
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const items2025 = ((res2025.data ?? []) as any[]).map(cast)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const items2026 = ((res2026.data ?? []) as any[]).map(cast)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const items2027 = ((res2027.data ?? []) as any[]).map(cast)

    const allCodes = [...new Set([...items2025, ...items2026, ...items2027].map(i => i.account_code))].sort()
    let glDesc: Record<string, string> = {}
    if (allCodes.length > 0) {
      const { data: glRows } = await supabase
        .from('gl_accounts').select('account_code, description').in('account_code', allCodes)
      for (const gl of glRows ?? []) glDesc[gl.account_code] = gl.description
    }

    const codes2026 = [...new Set(items2026.map(i => i.account_code))].sort()
    const accts: AccountMeta[] = codes2026.map(code => ({
      account_code: code,
      description: glDesc[code] ?? code,
    }))

    setRef2025Items(items2025)
    setRef2026Items(items2026)
    setLineItems(items2027)
    setAccounts(accts)
    setGlDescriptions(glDesc)
    setWindowOpen(windowIsOpen(dept, wins))
    setExpandedAccounts(new Set())
    setExpandedRef2025(new Set())
    setExpandedRef2026(new Set())
    setAddingTo(null)
    setLoading(false)
  }, [supabase, loadWindows])

  useEffect(() => {
    if (activeDept) loadBudgetData(activeDept)
  }, [activeDept, loadBudgetData])

  // ── Load pending items for admin ───────────────────────────────────────────

  const loadPendingItems = useCallback(async () => {
    const { data } = await supabase
      .from('budget_line_items')
      .select(`${LINE_SELECT}, dept_code`)
      .eq('scenario_id', SCENARIOS.DIRECTOR_2027)
      .eq('status', 'submitted')
      .order('submitted_at')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setPendingItems(((data ?? []) as any[]).map((r: any) => ({
      id: r.id as string,
      dept_code: r.dept_code as string,
      account_code: r.account_code as string,
      description: r.description as string,
      employee_name: r.employee_name as string,
      vendor: r.vendor as string,
      notes: r.notes as string,
      month: r.month as number,
      amount: Number(r.amount),
      status: 'submitted' as const,
      submitted_at: r.submitted_at as string | null,
      approved_by_jeremiah: Boolean(r.approved_by_jeremiah),
      jeremiah_approved_at: r.jeremiah_approved_at as string | null,
      approved_by_joseph: Boolean(r.approved_by_joseph),
      joseph_approved_at: r.joseph_approved_at as string | null,
      return_comment: r.return_comment as string | null,
    })))
  }, [supabase])

  useEffect(() => {
    if (profile?.role === 'admin' && activeTab === 'admin') loadPendingItems()
  }, [profile, activeTab, loadPendingItems])

  // ── Notify email helper ────────────────────────────────────────────────────

  async function sendNotify(type: string, payload: Record<string, unknown>) {
    try {
      await fetch('/api/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, ...payload }),
      })
    } catch { /* non-critical */ }
  }

  // ── Audit log helper ───────────────────────────────────────────────────────

  async function logAudit(action: string, lineItemId?: string, extra?: Record<string, unknown>) {
    await supabase.from('budget_audit_log').insert({
      user_id: userId,
      user_email: userEmail,
      action,
      scenario_id: SCENARIOS.DIRECTOR_2027,
      dept_code: activeDept,
      line_item_id: lineItemId ?? null,
      new_data: extra ?? null,
    })
  }

  // ── Toggle accordion ──────────────────────────────────────────────────────

  function toggleExpand(code: string) {
    setExpandedAccounts(prev => {
      const next = new Set(prev)
      if (next.has(code)) { next.delete(code); if (addingTo === code) setAddingTo(null) }
      else next.add(code)
      return next
    })
  }
  function toggleRef2026(code: string) {
    setExpandedRef2026(prev => { const n = new Set(prev); n.has(code) ? n.delete(code) : n.add(code); return n })
  }
  function toggleRef2025(code: string) {
    setExpandedRef2025(prev => { const n = new Set(prev); n.has(code) ? n.delete(code) : n.add(code); return n })
  }

  // ── Open add form (restore localStorage draft if any) ─────────────────────

  function openAddForm(code: string) {
    try {
      const saved = localStorage.getItem(LS_KEY(activeDept, code))
      setAddForm(saved ? JSON.parse(saved) : emptyForm())
    } catch { setAddForm(emptyForm()) }
    setAddingTo(code)
    setActionMsg('')
  }

  function clearForm(code?: string) {
    try { if (code) localStorage.removeItem(LS_KEY(activeDept, code)) } catch {}
    setAddingTo(null)
    setAddForm(emptyForm())
    setActionMsg('')
  }

  // ── Add line item ─────────────────────────────────────────────────────────

  async function handleAddItem(account_code: string) {
    if (!addForm.description.trim()) { setActionMsg('Description is required.'); return }
    const amt = Number(addForm.amount)
    if (!amt || amt <= 0) { setActionMsg('Enter a positive amount.'); return }

    setSavingItem(true)
    setActionMsg('')

    const base = {
      scenario_id: SCENARIOS.DIRECTOR_2027,
      dept_code: activeDept,
      account_code,
      description: addForm.description.trim(),
      employee_name: addForm.employee_name.trim(),
      vendor: addForm.vendor.trim(),
      notes: addForm.notes.trim(),
      amount: amt,
      status: 'draft',
    }

    if (addForm.entryType === 'recurring') {
      const from = Number(addForm.fromMonth)
      const to = Number(addForm.toMonth)
      if (from > to) { setActionMsg('Start month must be ≤ end month.'); setSavingItem(false); return }

      const payloads = []
      for (let m = from; m <= to; m++) {
        if (isPastMonth(m)) continue
        payloads.push({ ...base, month: m })
      }
      if (payloads.length === 0) { setActionMsg('All selected months are in the past.'); setSavingItem(false); return }

      const { data, error } = await supabase
        .from('budget_line_items').insert(payloads).select(LINE_SELECT)

      if (error) { setActionMsg(`Error: ${error.message}`) }
      else if (data) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const cast = (data as any[]).map((r: any) => ({
          ...r, amount: Number(r.amount), status: 'draft' as const,
          approved_by_jeremiah: false, approved_by_joseph: false,
          submitted_at: null, jeremiah_approved_at: null, joseph_approved_at: null, return_comment: null,
        }))
        setLineItems(prev => [...prev, ...cast])
        await logAudit('insert', undefined, { count: payloads.length, account_code })
        clearForm(account_code)
        setActionMsg(`✓ ${payloads.length} monthly item${payloads.length > 1 ? 's' : ''} saved.`)
      }
    } else {
      const month = Number(addForm.month)
      if (isPastMonth(month)) { setActionMsg('That month is in the past and cannot be edited.'); setSavingItem(false); return }

      const { data, error } = await supabase
        .from('budget_line_items').insert({ ...base, month }).select(LINE_SELECT).single()

      if (error) { setActionMsg(`Error: ${error.message}`) }
      else if (data) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const d = data as any
        const item = {
          ...d as LineItem, amount: Number(d.amount), status: 'draft' as const,
          approved_by_jeremiah: false, approved_by_joseph: false,
          submitted_at: null, jeremiah_approved_at: null, joseph_approved_at: null, return_comment: null,
        }
        setLineItems(prev => [...prev, item])
        await logAudit('insert', data.id, { account_code })
        clearForm(account_code)
        setActionMsg('✓ Item saved.')
      }
    }
    setSavingItem(false)
  }

  // ── Delete line item ──────────────────────────────────────────────────────

  async function handleDeleteItem(item: LineItem) {
    if (item.status !== 'draft') { setActionMsg('Only draft items can be deleted.'); return }
    if (isPastMonth(item.month)) { setActionMsg('Past-month items cannot be deleted.'); return }
    if (!confirm(`Delete "${item.description}" (${MONTH_NAMES[item.month - 1]})?`)) return

    const { error } = await supabase.from('budget_line_items').delete().eq('id', item.id)
    if (error) setActionMsg(`Error: ${error.message}`)
    else {
      setLineItems(prev => prev.filter(i => i.id !== item.id))
      await logAudit('delete', item.id, { description: item.description })
      setActionMsg('✓ Item deleted.')
    }
  }

  // ── Submit single item ────────────────────────────────────────────────────

  async function handleSubmitItem(item: LineItem) {
    if (!windowOpen) { setActionMsg('Submission window is currently closed.'); return }
    if (item.status !== 'draft' && item.status !== 'returned') return

    setSubmittingId(item.id)
    const { data, error } = await supabase
      .from('budget_line_items')
      .update({ status: 'submitted', submitted_at: new Date().toISOString(), return_comment: null })
      .eq('id', item.id)
      .select(LINE_SELECT)
      .single()

    if (error) { setActionMsg(`Error: ${error.message}`); setSubmittingId(null); return }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setLineItems(prev => prev.map(i => i.id === item.id ? { ...i, status: 'submitted', submitted_at: (data as any).submitted_at as string, return_comment: null } : i))
    await logAudit('submit', item.id)
    await sendNotify('submitted', {
      dept: deptNames[activeDept] ?? activeDept,
      description: item.description,
      account_code: item.account_code,
      month: MONTH_NAMES[item.month - 1],
      amount: item.amount,
      submittedBy: userEmail,
    })
    setActionMsg('✓ Submitted for approval.')
    setSubmittingId(null)
  }

  // ── Submit all draft items ────────────────────────────────────────────────

  async function handleSubmitAll() {
    if (!windowOpen) { setActionMsg('Submission window is currently closed.'); return }
    const drafts = lineItems.filter(i => i.status === 'draft' || i.status === 'returned')
    if (drafts.length === 0) { setActionMsg('No draft items to submit.'); return }
    if (!confirm(`Submit all ${drafts.length} draft item${drafts.length > 1 ? 's' : ''} for approval?`)) return

    setSavingItem(true)
    const ids = drafts.map(i => i.id)
    const { error } = await supabase
      .from('budget_line_items')
      .update({ status: 'submitted', submitted_at: new Date().toISOString(), return_comment: null })
      .in('id', ids)

    if (error) { setActionMsg(`Error: ${error.message}`); setSavingItem(false); return }
    setLineItems(prev => prev.map(i => ids.includes(i.id) ? { ...i, status: 'submitted', return_comment: null } : i))
    await logAudit('submit_all', undefined, { count: drafts.length })
    await sendNotify('submitted_all', {
      dept: deptNames[activeDept] ?? activeDept,
      count: drafts.length,
      submittedBy: userEmail,
    })
    setActionMsg(`✓ ${drafts.length} item${drafts.length > 1 ? 's' : ''} submitted for approval.`)
    setSavingItem(false)
  }

  // ── Admin: approve item ───────────────────────────────────────────────────

  async function handleApproveItem(item: PendingItem) {
    setApprovingId(item.id)
    const isJeremiah = userEmail === 'jbogdon@myhrpros.com'
    const isJoseph = userEmail === 'joseph@myhrpros.com'

    const updates: Record<string, unknown> = {}
    if (isJeremiah && !item.approved_by_jeremiah) {
      updates.approved_by_jeremiah = true
      updates.jeremiah_approved_at = new Date().toISOString()
    } else if (isJoseph && !item.approved_by_joseph) {
      updates.approved_by_joseph = true
      updates.joseph_approved_at = new Date().toISOString()
    } else {
      setActionMsg('Already approved by you.')
      setApprovingId(null)
      return
    }

    // Check if both will be approved after this update
    const bothApproved =
      (isJeremiah ? true : item.approved_by_jeremiah) &&
      (isJoseph   ? true : item.approved_by_joseph)

    if (bothApproved) updates.status = 'approved'

    const { error } = await supabase
      .from('budget_line_items').update(updates).eq('id', item.id)

    if (error) { setActionMsg(`Error: ${error.message}`); setApprovingId(null); return }

    setPendingItems(prev => {
      if (bothApproved) return prev.filter(i => i.id !== item.id)
      return prev.map(i => i.id === item.id ? { ...i, ...updates } : i)
    })

    await logAudit('approve', item.id, { approver: userEmail, fully_approved: bothApproved })

    if (bothApproved) {
      await sendNotify('approved', {
        dept: deptNames[item.dept_code] ?? item.dept_code,
        description: item.description,
        account_code: item.account_code,
        month: MONTH_NAMES[item.month - 1],
        amount: item.amount,
      })
      setActionMsg('✓ Fully approved and locked.')
    } else {
      setActionMsg('✓ Your approval recorded. Waiting for the other approver.')
    }
    setApprovingId(null)
  }

  // ── Admin: return item ────────────────────────────────────────────────────

  async function handleReturnItem(item: PendingItem) {
    const comment = returnComment[item.id]?.trim()
    if (!comment) { setActionMsg('Add a comment before returning.'); return }
    setReturningId(item.id)

    const { error } = await supabase
      .from('budget_line_items')
      .update({
        status: 'returned',
        approved_by_jeremiah: false, jeremiah_approved_at: null,
        approved_by_joseph: false, joseph_approved_at: null,
        return_comment: comment,
      })
      .eq('id', item.id)

    if (error) { setActionMsg(`Error: ${error.message}`); setReturningId(null); return }
    setPendingItems(prev => prev.filter(i => i.id !== item.id))
    await logAudit('return', item.id, { comment })
    await sendNotify('returned', {
      dept: deptNames[item.dept_code] ?? item.dept_code,
      description: item.description,
      comment,
    })
    setReturnComment(c => { const n = { ...c }; delete n[item.id]; return n })
    setReturningId(null)
    setActionMsg('✓ Item returned to director with comment.')
  }

  // ── Admin: toggle submission window ──────────────────────────────────────

  async function handleToggleWindow(deptCode: string | null, open: boolean) {
    setTogglingWindow(deptCode ?? 'all')
    const existing = windows.find(w => w.dept_code === deptCode)

    if (existing) {
      await supabase.from('budget_submission_windows')
        .update({
          is_open: open,
          opened_by: open ? userId : null,
          opened_at: open ? new Date().toISOString() : null,
          closed_at: !open ? new Date().toISOString() : null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id)
    } else {
      await supabase.from('budget_submission_windows').insert({
        scenario_id: SCENARIOS.DIRECTOR_2027,
        dept_code: deptCode,
        is_open: open,
        opened_by: open ? userId : null,
        opened_at: open ? new Date().toISOString() : null,
      })
    }

    const newWindows = await loadWindows()
    setWindowOpen(windowIsOpen(activeDept, newWindows))
    await logAudit(open ? 'open_window' : 'close_window', undefined, { dept_code: deptCode })
    setTogglingWindow(null)
    setActionMsg(`✓ Submission window ${open ? 'opened' : 'closed'}${deptCode ? ` for ${deptNames[deptCode] ?? deptCode}` : ' for all departments'}.`)
  }

  // ── Sign out ───────────────────────────────────────────────────────────────

  async function handleSignOut() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  // ── Read-only reference accordion ─────────────────────────────────────────

  function renderRefAccordion(
    items: LineItem[],
    expandedSet: Set<string>,
    toggle: (code: string) => void,
    yearLabel: string,
  ) {
    const codes = [...new Set(items.map(i => i.account_code))].sort()
    if (codes.length === 0) return (
      <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-400 text-sm">
        No {yearLabel} budget data found for this department.
      </div>
    )
    const grandTotal = items.reduce((s, i) => s + i.amount, 0)
    const deptLabel = deptNames[activeDept] ?? activeDept
    return (
      <div className="space-y-3">
        {codes.map(code => {
          const acctItems = items.filter(i => i.account_code === code)
          const acctTotal = acctItems.reduce((s, i) => s + i.amount, 0)
          const isExpanded = expandedSet.has(code)
          return (
            <div key={code} className="bg-white rounded-lg border shadow-sm overflow-hidden"
              style={{ borderColor: isExpanded ? '#316c7f' : '#e5e7eb' }}>
              <button onClick={() => toggle(code)}
                className="w-full text-left px-4 py-3 flex items-center gap-3 transition-colors hover:bg-blue-50/40"
                style={{ background: isExpanded ? 'rgba(49,108,127,.05)' : 'white' }}>
                <span className="font-mono text-xs font-semibold text-gray-400 w-16 flex-shrink-0">{code}</span>
                <span className="font-semibold text-gray-800 flex-shrink-0 w-44 truncate text-sm">{glDescriptions[code] ?? code}</span>
                <span className="hidden lg:flex flex-1 items-center gap-0">
                  {Array.from({ length: 12 }, (_, i) => i + 1).map(month => {
                    const t = itemMonthTotal(acctItems, code, month)
                    return (
                      <span key={month} className="text-right text-xs w-[72px] flex-shrink-0"
                        style={{ color: t > 0 ? '#316c7f' : '#d1d5db', fontVariantNumeric: 'tabular-nums' }}>
                        {t > 0 ? t.toLocaleString('en-US', { maximumFractionDigits: 0 }) : '—'}
                      </span>
                    )
                  })}
                </span>
                <span className="ml-auto font-bold text-sm w-24 text-right flex-shrink-0"
                  style={{ color: '#1e4757', fontVariantNumeric: 'tabular-nums' }}>{fmt(acctTotal)}</span>
                <span className="flex-shrink-0 text-xs font-bold px-1.5 py-0.5 rounded-full ml-2"
                  style={{ background: 'rgba(49,108,127,.12)', color: '#316c7f' }}>{acctItems.length}</span>
                <svg className="flex-shrink-0 ml-2 transition-transform"
                  style={{ transform: isExpanded ? 'rotate(180deg)' : 'rotate(0)' }}
                  width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M4 6l4 4 4-4" stroke="#9ca3af" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
              </button>
              {isExpanded && (
                <div style={{ borderTop: '1px solid rgba(49,108,127,.15)' }}>
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead>
                        <tr style={{ background: '#f8fafb' }}>
                          {['Description','Employee','Vendor','Month','Amount','Notes'].map(h => (
                            <th key={h} className="text-left px-3 py-2 text-xs font-bold uppercase tracking-wider"
                              style={{ color: '#316c7f', whiteSpace: 'nowrap' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {acctItems.map((item, idx) => (
                          <tr key={item.id} className="border-t border-gray-100"
                            style={{ background: idx % 2 === 0 ? '#fff' : 'rgba(0,0,0,.015)' }}>
                            <td className="px-3 py-2 text-gray-800 font-medium max-w-[200px] truncate" title={item.description}>{item.description}</td>
                            <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{item.employee_name || <span className="text-gray-300">—</span>}</td>
                            <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{item.vendor || <span className="text-gray-300">—</span>}</td>
                            <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{MONTH_NAMES[item.month - 1]}</td>
                            <td className="px-3 py-2 text-right font-semibold whitespace-nowrap"
                              style={{ color: '#316c7f', fontVariantNumeric: 'tabular-nums' }}>
                              ${item.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </td>
                            <td className="px-3 py-2 text-gray-500 max-w-[180px] truncate" title={item.notes}>{item.notes || <span className="text-gray-300">—</span>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )
        })}
        <div className="bg-white rounded-lg border-2 shadow-sm px-4 py-3 flex items-center justify-between"
          style={{ borderColor: 'rgba(49,108,127,.25)', background: 'rgba(49,108,127,.04)' }}>
          <span className="font-extrabold text-sm" style={{ color: '#1e4757' }}>Total — {deptLabel} · {yearLabel}</span>
          <span className="font-extrabold text-base" style={{ color: '#316c7f', fontVariantNumeric: 'tabular-nums' }}>
            ${grandTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        </div>
        <p className="text-xs text-gray-400 mt-2">
          Read-only view of the {yearLabel} approved budget. Click any GL account to see individual line items.
        </p>
      </div>
    )
  }

  // ── Admin panel ───────────────────────────────────────────────────────────

  function renderAdminPanel() {
    const allDeptCodes = Object.keys(deptNames)
    return (
      <div className="space-y-8">

        {/* ── Window controls ── */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-extrabold text-sm uppercase tracking-widest" style={{ color: '#1e4757' }}>
              Submission Windows
            </h3>
            <div className="flex gap-2">
              <button onClick={() => handleToggleWindow(null, true)} disabled={!!togglingWindow}
                className="btn-primary text-xs px-3 py-1.5">
                {togglingWindow === 'all' ? '…' : 'Open All'}
              </button>
              <button onClick={() => handleToggleWindow(null, false)} disabled={!!togglingWindow}
                className="text-xs px-3 py-1.5 rounded font-semibold transition-colors"
                style={{ background: '#fee2e2', color: '#991b1b' }}>
                {togglingWindow === 'all' ? '…' : 'Close All'}
              </button>
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {allDeptCodes.map(code => {
              const isOpen = windowIsOpen(code, windows)
              const busy = togglingWindow === code
              return (
                <div key={code} className="bg-white rounded-lg border px-4 py-3 flex items-center justify-between shadow-sm"
                  style={{ borderColor: isOpen ? '#6ee7b7' : '#e5e7eb' }}>
                  <div>
                    <div className="font-semibold text-sm text-gray-800">{deptNames[code]}</div>
                    <div className="text-xs text-gray-400 font-mono">{code}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold px-2 py-0.5 rounded-full"
                      style={{ background: isOpen ? '#d1fae5' : '#f3f4f6', color: isOpen ? '#065f46' : '#9ca3af' }}>
                      {isOpen ? 'Open' : 'Closed'}
                    </span>
                    <button
                      onClick={() => handleToggleWindow(code, !isOpen)}
                      disabled={busy}
                      className="text-xs font-semibold px-2.5 py-1 rounded transition-colors"
                      style={{
                        background: isOpen ? '#fee2e2' : '#d1fae5',
                        color: isOpen ? '#991b1b' : '#065f46',
                        opacity: busy ? 0.5 : 1,
                      }}>
                      {busy ? '…' : isOpen ? 'Close' : 'Open'}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* ── Pending approvals ── */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <h3 className="font-extrabold text-sm uppercase tracking-widest" style={{ color: '#1e4757' }}>
              Pending Approvals
            </h3>
            {pendingItems.length > 0 && (
              <span className="text-xs font-bold px-2 py-0.5 rounded-full"
                style={{ background: '#ff930c', color: '#fff' }}>{pendingItems.length}</span>
            )}
          </div>

          {pendingItems.length === 0 ? (
            <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-400 text-sm">
              No items pending approval.
            </div>
          ) : (
            <div className="space-y-3">
              {pendingItems.map(item => {
                const isJeremiah = userEmail === 'jbogdon@myhrpros.com'
                const isJoseph = userEmail === 'joseph@myhrpros.com'
                const myApproved = isJeremiah ? item.approved_by_jeremiah : item.approved_by_joseph
                const busy = approvingId === item.id || returningId === item.id
                return (
                  <div key={item.id} className="bg-white rounded-lg border shadow-sm overflow-hidden"
                    style={{ borderColor: '#e5e7eb' }}>
                    <div className="px-4 py-3 flex flex-wrap items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-gray-800">{item.description}</span>
                          <span className="text-xs font-mono text-gray-400">{item.account_code}</span>
                          <span className="text-xs px-2 py-0.5 rounded font-semibold"
                            style={{ background: 'rgba(49,108,127,.1)', color: '#316c7f' }}>
                            {deptNames[item.dept_code] ?? item.dept_code}
                          </span>
                        </div>
                        <div className="mt-1 flex items-center gap-4 text-xs text-gray-500">
                          <span>{MONTH_NAMES[item.month - 1]} 2027</span>
                          <span className="font-semibold" style={{ color: '#316c7f', fontVariantNumeric: 'tabular-nums' }}>
                            ${item.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </span>
                          {item.employee_name && <span>👤 {item.employee_name}</span>}
                          {item.vendor && <span>🏢 {item.vendor}</span>}
                        </div>
                        <div className="mt-1.5 flex items-center gap-3 text-xs">
                          <span style={{ color: item.approved_by_jeremiah ? '#059669' : '#d1d5db' }}>
                            {item.approved_by_jeremiah ? '✓' : '⏳'} Jeremiah
                          </span>
                          <span style={{ color: item.approved_by_joseph ? '#059669' : '#d1d5db' }}>
                            {item.approved_by_joseph ? '✓' : '⏳'} Joseph
                          </span>
                        </div>
                      </div>
                      <div className="flex flex-col gap-2 items-end">
                        {!myApproved && (
                          <button onClick={() => handleApproveItem(item)} disabled={busy}
                            className="btn-primary text-xs px-3 py-1.5 whitespace-nowrap">
                            {busy ? '…' : '✓ Approve'}
                          </button>
                        )}
                        {myApproved && (
                          <span className="text-xs font-semibold" style={{ color: '#059669' }}>✓ You approved</span>
                        )}
                        <button
                          onClick={() => setReturningId(returningId === item.id ? null : item.id)}
                          disabled={busy}
                          className="text-xs font-semibold px-3 py-1.5 rounded transition-colors whitespace-nowrap"
                          style={{ background: '#fff7ed', color: '#c2410c', border: '1px solid #fed7aa' }}>
                          ↩ Return
                        </button>
                      </div>
                    </div>

                    {/* Return comment box */}
                    {returningId === item.id && (
                      <div className="px-4 py-3 flex gap-2 items-center" style={{ borderTop: '1px solid #fee2e2', background: '#fff7f7' }}>
                        <input
                          type="text"
                          placeholder="Reason for returning…"
                          value={returnComment[item.id] ?? ''}
                          onChange={e => setReturnComment(c => ({ ...c, [item.id]: e.target.value }))}
                          className="input-field flex-1 text-sm"
                        />
                        <button onClick={() => handleReturnItem(item)}
                          disabled={!returnComment[item.id]?.trim()}
                          className="text-xs font-bold px-3 py-1.5 rounded whitespace-nowrap"
                          style={{ background: '#dc2626', color: '#fff', opacity: !returnComment[item.id]?.trim() ? 0.5 : 1 }}>
                          Send Return
                        </button>
                        <button onClick={() => setReturningId(null)}
                          className="text-xs text-gray-400 px-2 py-1.5">Cancel</button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    )
  }

  // ── Render guard ──────────────────────────────────────────────────────────

  if (!profile) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#f0f6f7' }}>
        <div className="text-gray-400 text-sm">Loading…</div>
      </div>
    )
  }

  const deptLabel = deptNames[activeDept] ?? activeDept
  const isAdmin = profile.role === 'admin'
  const draftCount = lineItems.filter(i => i.status === 'draft' || i.status === 'returned').length

  const tabs = [
    { key: 'input'   as const, label: '2027 Budget Input' },
    { key: 'ref2026' as const, label: '2026 Approved' },
    { key: 'ref2025' as const, label: '2025 Approved' },
    ...(isAdmin ? [{ key: 'admin' as const, label: '⚙ Admin' }] : []),
  ]

  // Recurring preview
  const recurringCount = Math.max(0, Number(addForm.toMonth) - Number(addForm.fromMonth) + 1)
  const recurringTotal = recurringCount * Number(addForm.amount || 0)

  return (
    <div className="min-h-screen" style={{ background: '#f0f6f7' }}>

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-50 shadow-md"
        style={{ background: 'linear-gradient(135deg, #1e4757 0%, #316c7f 100%)' }}>
        <div className="max-w-screen-xl mx-auto px-6 py-0 flex items-center justify-between h-[60px]">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ background: 'rgba(255,255,255,.13)' }}>
              <svg width="20" height="20" viewBox="0 0 22 22" fill="none">
                <rect x="1" y="5" width="20" height="14" rx="2" stroke="white" strokeWidth="1.5"/>
                <path d="M1 9h20" stroke="white" strokeWidth="1.5"/>
                <circle cx="5" cy="14" r="1.5" fill="white"/>
                <rect x="9" y="13" width="9" height="2" rx="1" fill="white" fillOpacity=".6"/>
              </svg>
            </div>
            <div>
              <h1 className="font-extrabold text-base text-white leading-tight tracking-tight">My HR Pros</h1>
              <p className="text-xs font-semibold tracking-widest uppercase" style={{ color: '#7bc6c8' }}>
                Operations Portal · Budget Planning
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {/* Window open badge */}
            {activeTab === 'input' && !isAdmin && (
              <span className="hidden sm:flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-full"
                style={{ background: windowOpen ? 'rgba(110,231,183,.2)' : 'rgba(255,255,255,.1)', color: windowOpen ? '#6ee7b7' : 'rgba(255,255,255,.4)' }}>
                {windowOpen ? '● Window Open' : '● Window Closed'}
              </span>
            )}
            <span className="text-sm hidden sm:block" style={{ color: '#7bc6c8' }}>{userEmail}</span>
            {isAdmin && (
              <span className="text-xs font-extrabold px-2 py-0.5 rounded tracking-widest uppercase"
                style={{ background: '#ff930c', color: '#fff' }}>Admin</span>
            )}
            <button onClick={handleSignOut}
              className="text-sm font-semibold px-3 py-1.5 rounded transition-colors"
              style={{ color: 'rgba(255,255,255,.85)', background: 'rgba(255,255,255,.12)', border: '1px solid rgba(255,255,255,.2)' }}>
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-screen-xl mx-auto px-6 py-6">

        {/* ── Dept selector + action message ──────────────────────────────── */}
        <div className="flex flex-wrap items-center justify-between gap-4 mb-5">
          <div>
            {isAdmin ? (
              <div className="flex items-center gap-2">
                <label className="text-xs font-bold uppercase tracking-widest text-gray-500">Department:</label>
                <select value={activeDept} onChange={e => setActiveDept(e.target.value)} className="input-field w-auto">
                  {Object.entries(deptNames).map(([code, name]) => (
                    <option key={code} value={code}>{name} ({code})</option>
                  ))}
                </select>
              </div>
            ) : (
              <div>
                <h2 className="text-xl font-extrabold" style={{ color: '#316c7f' }}>{deptLabel}</h2>
                <p className="text-xs text-gray-500 mt-0.5">Department {activeDept}</p>
              </div>
            )}
          </div>
          {actionMsg && (
            <span className={`text-sm font-semibold ${actionMsg.startsWith('✓') ? 'text-green-600' : 'text-red-600'}`}>
              {actionMsg}
            </span>
          )}
        </div>

        {/* ── Tabs ────────────────────────────────────────────────────────── */}
        <div className="flex gap-1 mb-4" style={{ borderBottom: '2px solid #e5e7eb' }}>
          {tabs.map(tab => (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)}
              className="px-4 py-2.5 text-sm font-bold transition-colors relative"
              style={{
                marginBottom: '-2px',
                color: activeTab === tab.key ? '#316c7f' : '#6b7280',
                background: 'transparent',
                border: 'none',
                borderBottom: `2px solid ${activeTab === tab.key ? '#316c7f' : 'transparent'}`,
                cursor: 'pointer',
              }}>
              {tab.label}
              {tab.key === 'admin' && pendingItems.length > 0 && (
                <span className="absolute -top-1 -right-1 text-xs font-bold w-4 h-4 rounded-full flex items-center justify-center"
                  style={{ background: '#ff930c', color: '#fff', fontSize: 9 }}>{pendingItems.length}</span>
              )}
            </button>
          ))}
        </div>

        {/* ── Tab content ─────────────────────────────────────────────────── */}
        {loading ? (
          <div className="flex items-center justify-center h-48">
            <div className="text-gray-400 text-sm">Loading budget data…</div>
          </div>

        ) : activeTab === 'admin' ? renderAdminPanel()

        : activeTab === 'ref2026' ? renderRefAccordion(ref2026Items, expandedRef2026, toggleRef2026, '2026')

        : activeTab === 'ref2025' ? renderRefAccordion(ref2025Items, expandedRef2025, toggleRef2025, '2025')

        : accounts.length === 0 ? (
          <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-400 text-sm">
            No budget lines found for this department.
          </div>

        ) : (
          /* ── Input Tab ──────────────────────────────────────────────────── */
          <div className="space-y-3">

            {/* Submit All bar */}
            {windowOpen && draftCount > 0 && (
              <div className="bg-white rounded-lg border px-4 py-3 flex items-center justify-between shadow-sm"
                style={{ borderColor: '#fbbf24', background: '#fffbeb' }}>
                <div className="text-sm font-semibold" style={{ color: '#92400e' }}>
                  {draftCount} draft item{draftCount > 1 ? 's' : ''} ready to submit for approval
                </div>
                <button onClick={handleSubmitAll} disabled={savingItem}
                  className="btn-primary text-sm px-4 py-2">
                  {savingItem ? 'Submitting…' : `Submit All (${draftCount})`}
                </button>
              </div>
            )}

            {!windowOpen && !isAdmin && (
              <div className="bg-white rounded-lg border px-4 py-2.5 flex items-center gap-2 text-xs text-gray-500"
                style={{ borderColor: '#e5e7eb' }}>
                <span style={{ color: '#d1d5db' }}>●</span>
                Submission window is <strong>closed</strong>. You can save items, but cannot submit for approval until it's opened.
              </div>
            )}

            {/* Column headers */}
            <div className="hidden lg:grid text-xs font-bold uppercase tracking-widest text-gray-400 px-4"
              style={{ gridTemplateColumns: '220px 1fr repeat(12, 72px) 100px 36px' }}>
              <span>GL / Description</span>
              <span></span>
              {MONTH_NAMES.map(m => <span key={m} className="text-right">{m}</span>)}
              <span className="text-right">Total</span>
              <span></span>
            </div>

            {accounts.map(acct => {
              const isExpanded = expandedAccounts.has(acct.account_code)
              const acctItems = lineItems.filter(i => i.account_code === acct.account_code)
              const rowTotal = acctItems.reduce((s, i) => s + i.amount, 0)

              return (
                <div key={acct.account_code} className="bg-white rounded-lg border shadow-sm overflow-hidden"
                  style={{ borderColor: isExpanded ? '#316c7f' : '#e5e7eb' }}>

                  {/* Accordion header */}
                  <button onClick={() => toggleExpand(acct.account_code)}
                    className="w-full text-left px-4 py-3 flex items-center gap-3 transition-colors hover:bg-blue-50/40"
                    style={{ background: isExpanded ? 'rgba(49,108,127,.05)' : 'white' }}>
                    <span className="font-mono text-xs font-semibold text-gray-400 w-16 flex-shrink-0">
                      {acct.account_code}
                    </span>
                    <span className="font-semibold text-gray-800 flex-shrink-0 w-44 truncate text-sm">
                      {acct.description}
                    </span>
                    <span className="hidden lg:flex flex-1 items-center gap-0">
                      {Array.from({ length: 12 }, (_, i) => i + 1).map(month => {
                        const t = itemMonthTotal(lineItems, acct.account_code, month)
                        return (
                          <span key={month} className="text-right text-xs w-[72px] flex-shrink-0"
                            style={{ color: t > 0 ? '#316c7f' : '#d1d5db', fontVariantNumeric: 'tabular-nums' }}>
                            {t > 0 ? t.toLocaleString('en-US', { maximumFractionDigits: 0 }) : '—'}
                          </span>
                        )
                      })}
                    </span>
                    <span className="ml-auto font-bold text-sm w-24 text-right flex-shrink-0"
                      style={{ color: rowTotal > 0 ? '#1e4757' : '#9ca3af', fontVariantNumeric: 'tabular-nums' }}>
                      {rowTotal > 0 ? rowTotal.toLocaleString('en-US', { maximumFractionDigits: 0 }) : '—'}
                    </span>
                    {acctItems.length > 0 && (
                      <span className="flex-shrink-0 text-xs font-bold px-1.5 py-0.5 rounded-full ml-2"
                        style={{ background: 'rgba(49,108,127,.12)', color: '#316c7f' }}>
                        {acctItems.length}
                      </span>
                    )}
                    <svg className="flex-shrink-0 ml-2 transition-transform"
                      style={{ transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)' }}
                      width="16" height="16" viewBox="0 0 16 16" fill="none">
                      <path d="M4 6l4 4 4-4" stroke="#9ca3af" strokeWidth="1.5" strokeLinecap="round"/>
                    </svg>
                  </button>

                  {/* Expanded */}
                  {isExpanded && (
                    <div style={{ borderTop: '1px solid rgba(49,108,127,.15)' }}>
                      {acctItems.length > 0 && (
                        <div className="overflow-x-auto">
                          <table className="min-w-full text-sm">
                            <thead>
                              <tr style={{ background: '#f8fafb' }}>
                                {['Description','Employee','Vendor','Month','Amount','Notes','Status',''].map(h => (
                                  <th key={h} className="text-left px-3 py-2 text-xs font-bold uppercase tracking-wider"
                                    style={{ color: '#316c7f', whiteSpace: 'nowrap' }}>{h}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {acctItems.map((item, idx) => {
                                const past = isPastMonth(item.month)
                                const canDelete = item.status === 'draft' && !past
                                const canSubmit = windowOpen && (item.status === 'draft' || item.status === 'returned') && !past
                                const returned = item.status === 'returned'
                                return (
                                  <tr key={item.id} className="border-t border-gray-100"
                                    style={{
                                      background: returned ? '#fff7f7' : idx % 2 === 0 ? '#fff' : 'rgba(0,0,0,.015)',
                                    }}>
                                    <td className="px-3 py-2 text-gray-800 font-medium max-w-[180px] truncate" title={item.description}>
                                      {item.description}
                                      {returned && item.return_comment && (
                                        <div className="text-xs text-red-400 font-normal truncate" title={item.return_comment}>
                                          ↩ {item.return_comment}
                                        </div>
                                      )}
                                    </td>
                                    <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{item.employee_name || <span className="text-gray-300">—</span>}</td>
                                    <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{item.vendor || <span className="text-gray-300">—</span>}</td>
                                    <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{MONTH_NAMES[item.month - 1]}</td>
                                    <td className="px-3 py-2 text-right font-semibold whitespace-nowrap"
                                      style={{ color: '#316c7f', fontVariantNumeric: 'tabular-nums' }}>
                                      ${item.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    </td>
                                    <td className="px-3 py-2 text-gray-500 max-w-[140px] truncate" title={item.notes}>{item.notes || <span className="text-gray-300">—</span>}</td>
                                    <td className="px-3 py-2 whitespace-nowrap"><StatusBadge item={item} /></td>
                                    <td className="px-3 py-2 whitespace-nowrap">
                                      <div className="flex items-center gap-1.5">
                                        {canSubmit && (
                                          <button onClick={() => handleSubmitItem(item)}
                                            disabled={submittingId === item.id}
                                            className="text-xs font-bold px-2 py-0.5 rounded transition-colors whitespace-nowrap"
                                            style={{ background: 'rgba(49,108,127,.1)', color: '#316c7f' }}
                                            title="Submit for approval">
                                            {submittingId === item.id ? '…' : '↑ Submit'}
                                          </button>
                                        )}
                                        {canDelete && (
                                          <button onClick={() => handleDeleteItem(item)}
                                            className="text-gray-300 hover:text-red-500 transition-colors"
                                            title="Delete item">
                                            <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
                                              <path d="M2 4h11M5 4V2.5h5V4M6 7v4M9 7v4M3 4l.7 8.5A1 1 0 004.7 13.5h5.6a1 1 0 001-.9L12 4"
                                                stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                                            </svg>
                                          </button>
                                        )}
                                      </div>
                                    </td>
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}

                      {/* Add item form */}
                      <div className="px-4 py-3" style={{ background: '#fafcfc' }}>
                        {addingTo === acct.account_code ? (
                          <div className="space-y-3">
                            {/* Entry type toggle */}
                            <div className="flex items-center gap-1 p-1 rounded-lg w-fit"
                              style={{ background: '#f0f2f5', border: '1px solid #e5e7eb' }}>
                              {(['once', 'recurring'] as const).map(type => (
                                <button key={type}
                                  onClick={() => setAddForm(f => ({ ...f, entryType: type }))}
                                  className="px-3 py-1.5 rounded-md text-xs font-bold transition-all"
                                  style={{
                                    background: addForm.entryType === type ? '#316c7f' : 'transparent',
                                    color: addForm.entryType === type ? '#fff' : '#6b7280',
                                  }}>
                                  {type === 'once' ? '📅 One-time' : '🔁 Recurring monthly'}
                                </button>
                              ))}
                            </div>

                            {/* Draft auto-save notice */}
                            <p className="text-xs text-gray-400">
                              ✦ Your draft is auto-saved in this browser. It will be here if you leave and come back.
                            </p>

                            {/* Fields */}
                            <div className="flex flex-wrap gap-2 items-end">
                              <div className="flex flex-col gap-1">
                                <label className="text-xs font-semibold text-gray-500">Description <span style={{ color: '#ff930c' }}>*</span></label>
                                <input type="text" placeholder="e.g. Microsoft Office"
                                  value={addForm.description}
                                  onChange={e => setAddForm(f => ({ ...f, description: e.target.value }))}
                                  className="input-field" style={{ width: 200 }} autoFocus />
                              </div>
                              <div className="flex flex-col gap-1">
                                <label className="text-xs font-semibold text-gray-500">Employee</label>
                                <input type="text" placeholder="e.g. Megan"
                                  value={addForm.employee_name}
                                  onChange={e => setAddForm(f => ({ ...f, employee_name: e.target.value }))}
                                  className="input-field" style={{ width: 130 }} />
                              </div>
                              <div className="flex flex-col gap-1">
                                <label className="text-xs font-semibold text-gray-500">Vendor</label>
                                <input type="text" placeholder="e.g. Microsoft"
                                  value={addForm.vendor}
                                  onChange={e => setAddForm(f => ({ ...f, vendor: e.target.value }))}
                                  className="input-field" style={{ width: 140 }} />
                              </div>
                              <div className="flex flex-col gap-1">
                                <label className="text-xs font-semibold text-gray-500">Notes</label>
                                <input type="text" placeholder="Optional"
                                  value={addForm.notes}
                                  onChange={e => setAddForm(f => ({ ...f, notes: e.target.value }))}
                                  className="input-field" style={{ width: 150 }} />
                              </div>

                              {addForm.entryType === 'once' && (
                                <div className="flex flex-col gap-1">
                                  <label className="text-xs font-semibold text-gray-500">Month <span style={{ color: '#ff930c' }}>*</span></label>
                                  <select value={addForm.month}
                                    onChange={e => setAddForm(f => ({ ...f, month: Number(e.target.value) }))}
                                    className="input-field" style={{ width: 110 }}>
                                    {MONTH_NAMES.map((m, i) => (
                                      <option key={i} value={i + 1} disabled={isPastMonth(i + 1)}>
                                        {m}{isPastMonth(i + 1) ? ' (past)' : ''}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                              )}

                              {addForm.entryType === 'recurring' && (
                                <>
                                  <div className="flex flex-col gap-1">
                                    <label className="text-xs font-semibold text-gray-500">From <span style={{ color: '#ff930c' }}>*</span></label>
                                    <select value={addForm.fromMonth}
                                      onChange={e => setAddForm(f => ({ ...f, fromMonth: Number(e.target.value) }))}
                                      className="input-field" style={{ width: 100 }}>
                                      {MONTH_NAMES.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
                                    </select>
                                  </div>
                                  <div className="flex flex-col gap-1">
                                    <label className="text-xs font-semibold text-gray-500">To <span style={{ color: '#ff930c' }}>*</span></label>
                                    <select value={addForm.toMonth}
                                      onChange={e => setAddForm(f => ({ ...f, toMonth: Number(e.target.value) }))}
                                      className="input-field" style={{ width: 100 }}>
                                      {MONTH_NAMES.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
                                    </select>
                                  </div>
                                </>
                              )}

                              <div className="flex flex-col gap-1">
                                <label className="text-xs font-semibold text-gray-500">
                                  {addForm.entryType === 'recurring' ? 'Amount / month' : 'Amount'} <span style={{ color: '#ff930c' }}>*</span>
                                </label>
                                <input type="number" step="0.01" min="0" placeholder="0.00"
                                  value={addForm.amount}
                                  onChange={e => setAddForm(f => ({ ...f, amount: e.target.value }))}
                                  className="input-field" style={{ width: 110 }} />
                              </div>

                              <div className="flex gap-2 items-end pb-0.5">
                                <button onClick={() => handleAddItem(acct.account_code)} disabled={savingItem}
                                  className="btn-primary text-sm px-4 py-2">
                                  {savingItem ? 'Saving…' : 'Save'}
                                </button>
                                <button onClick={() => clearForm(acct.account_code)}
                                  className="text-sm px-4 py-2 rounded font-semibold transition-colors"
                                  style={{ background: '#f3f4f6', color: '#6b7280' }}>
                                  Cancel
                                </button>
                              </div>
                            </div>

                            {/* Recurring preview chip */}
                            {addForm.entryType === 'recurring' && Number(addForm.amount) > 0 && recurringCount > 0 && (
                              <div className="flex items-center gap-2 text-xs font-semibold rounded-md px-3 py-2 w-fit"
                                style={{ background: 'rgba(49,108,127,.08)', color: '#316c7f' }}>
                                🔁&nbsp;{recurringCount} month{recurringCount !== 1 ? 's' : ''} ×&nbsp;
                                ${Number(addForm.amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                &nbsp;=&nbsp;
                                <strong>${recurringTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} total</strong>
                              </div>
                            )}
                          </div>
                        ) : (
                          <button
                            onClick={() => { if (!isExpanded) toggleExpand(acct.account_code); openAddForm(acct.account_code) }}
                            className="text-sm font-semibold flex items-center gap-1.5 transition-colors"
                            style={{ color: '#316c7f' }}>
                            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                              <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.3"/>
                              <path d="M7 4v6M4 7h6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                            </svg>
                            Add Expense
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}

            {/* Grand total */}
            <div className="bg-white rounded-lg border-2 shadow-sm px-4 py-3 flex items-center justify-between"
              style={{ borderColor: 'rgba(49,108,127,.25)', background: 'rgba(49,108,127,.04)' }}>
              <span className="font-extrabold text-sm" style={{ color: '#1e4757' }}>Total — {deptLabel}</span>
              <div className="flex items-center gap-6">
                <span className="text-xs text-gray-500 font-semibold">
                  {lineItems.length} item{lineItems.length !== 1 ? 's' : ''} entered
                </span>
                <span className="font-extrabold text-base" style={{ color: '#316c7f', fontVariantNumeric: 'tabular-nums' }}>
                  ${lineItems.reduce((s, i) => s + i.amount, 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
            </div>
            <p className="text-xs text-gray-400 mt-2 leading-relaxed">
              Click any GL account to expand. Use <strong>One-time</strong> for a single month, or <strong>Recurring monthly</strong> to spread a fixed amount across multiple months automatically.
              Past months are locked. Items can only be submitted for approval when the window is open.
            </p>
          </div>
        )}
      </main>
    </div>
  )
}
