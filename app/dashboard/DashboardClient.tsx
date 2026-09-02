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
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return n === 0
    ? '—'
    : n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

function itemMonthTotal(items: LineItem[], account_code: string, month: number): number {
  return items
    .filter(i => i.account_code === account_code && i.month === month)
    .reduce((s, i) => s + i.amount, 0)
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const emptyForm = () => ({
  description: '',
  employee_name: '',
  vendor: '',
  notes: '',
  entryType: 'once' as 'once' | 'recurring',
  month: new Date().getMonth() + 1,
  fromMonth: 1,
  toMonth: 12,
  amount: '',
})

// ─── Component ────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const router = useRouter()
  const supabase = createClient()

  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [userEmail, setUserEmail] = useState('')
  const [activeDept, setActiveDept] = useState<string>('')
  const [activeTab, setActiveTab] = useState<'input' | 'ref2026' | 'ref2025'>('input')

  // Dept names loaded live from DB
  const [deptNames, setDeptNames] = useState<Record<string, string>>({})

  const [accounts, setAccounts] = useState<AccountMeta[]>([])
  const [glDescriptions, setGlDescriptions] = useState<Record<string, string>>({})
  const [lineItems, setLineItems] = useState<LineItem[]>([])
  const [ref2026Items, setRef2026Items] = useState<LineItem[]>([])
  const [ref2025Items, setRef2025Items] = useState<LineItem[]>([])

  const [expandedAccounts, setExpandedAccounts] = useState<Set<string>>(new Set())
  const [expandedRef2026, setExpandedRef2026] = useState<Set<string>>(new Set())
  const [expandedRef2025, setExpandedRef2025] = useState<Set<string>>(new Set())
  const [addingTo, setAddingTo] = useState<string | null>(null)
  const [addForm, setAddForm] = useState(emptyForm())

  const [loading, setLoading] = useState(true)
  const [actionMsg, setActionMsg] = useState('')
  const [savingItem, setSavingItem] = useState(false)

  // ── Load user profile + dept names ────────────────────────────────────────

  useEffect(() => {
    async function loadProfile() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }
      setUserEmail(user.email ?? '')

      // Load dept names from DB (always up to date, no redeploy needed)
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

  // ── Load budget data when dept changes ────────────────────────────────────

  const loadBudgetData = useCallback(async (dept: string) => {
    setLoading(true)
    setActionMsg('')

    const [res2025, res2026, res2027] = await Promise.all([
      supabase
        .from('budget_line_items')
        .select('id, account_code, description, employee_name, vendor, notes, month, amount')
        .eq('scenario_id', SCENARIOS.BI_2025)
        .eq('dept_code', dept)
        .order('account_code')
        .order('created_at'),
      supabase
        .from('budget_line_items')
        .select('id, account_code, description, employee_name, vendor, notes, month, amount')
        .eq('scenario_id', SCENARIOS.BI_2026)
        .eq('dept_code', dept)
        .order('account_code')
        .order('created_at'),
      supabase
        .from('budget_line_items')
        .select('id, account_code, description, employee_name, vendor, notes, month, amount')
        .eq('scenario_id', SCENARIOS.DIRECTOR_2027)
        .eq('dept_code', dept)
        .order('account_code')
        .order('created_at'),
    ])

    const items2025 = (res2025.data ?? []).map(r => ({ ...r, amount: Number(r.amount) }))
    const items2026 = (res2026.data ?? []).map(r => ({ ...r, amount: Number(r.amount) }))
    const items2027 = (res2027.data ?? []).map(r => ({ ...r, amount: Number(r.amount) }))

    const allCodes = [...new Set([...items2025, ...items2026, ...items2027].map(i => i.account_code))].sort()
    let glDesc: Record<string, string> = {}
    if (allCodes.length > 0) {
      const { data: glRows } = await supabase
        .from('gl_accounts')
        .select('account_code, description')
        .in('account_code', allCodes)
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
    setExpandedAccounts(new Set())
    setExpandedRef2025(new Set())
    setExpandedRef2026(new Set())
    setAddingTo(null)
    setLoading(false)
  }, [supabase])

  useEffect(() => {
    if (activeDept) loadBudgetData(activeDept)
  }, [activeDept, loadBudgetData])

  // ── Toggle accordions ──────────────────────────────────────────────────────

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

  // ── Add line item (one-time or recurring) ─────────────────────────────────

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
    }

    if (addForm.entryType === 'recurring') {
      const from = Number(addForm.fromMonth)
      const to = Number(addForm.toMonth)
      if (from > to) { setActionMsg('Start month must be ≤ end month.'); setSavingItem(false); return }

      const payloads = []
      for (let m = from; m <= to; m++) payloads.push({ ...base, month: m })

      const { data, error } = await supabase
        .from('budget_line_items')
        .insert(payloads)
        .select('id, account_code, description, employee_name, vendor, notes, month, amount')

      if (error) {
        setActionMsg(`Error: ${error.message}`)
      } else if (data) {
        setLineItems(prev => [...prev, ...data.map(r => ({ ...r, amount: Number(r.amount) }))])
        setAddForm(emptyForm())
        setAddingTo(null)
        const count = to - from + 1
        setActionMsg(`✓ ${count} monthly item${count > 1 ? 's' : ''} saved (${MONTH_NAMES[from - 1]}–${MONTH_NAMES[to - 1]}).`)
      }
    } else {
      const { data, error } = await supabase
        .from('budget_line_items')
        .insert({ ...base, month: Number(addForm.month) })
        .select('id, account_code, description, employee_name, vendor, notes, month, amount')
        .single()

      if (error) {
        setActionMsg(`Error: ${error.message}`)
      } else if (data) {
        setLineItems(prev => [...prev, { ...data, amount: Number(data.amount) }])
        setAddForm(emptyForm())
        setAddingTo(null)
        setActionMsg('✓ Item saved.')
      }
    }
    setSavingItem(false)
  }

  // ── Delete line item ───────────────────────────────────────────────────────

  async function handleDeleteItem(id: string) {
    const { error } = await supabase.from('budget_line_items').delete().eq('id', id)
    if (error) setActionMsg(`Error: ${error.message}`)
    else { setLineItems(prev => prev.filter(i => i.id !== id)); setActionMsg('✓ Item deleted.') }
  }

  // ── Sign out ───────────────────────────────────────────────────────────────

  async function handleSignOut() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  // ── Read-only reference accordion renderer ─────────────────────────────────

  function renderRefAccordion(
    items: LineItem[],
    expandedSet: Set<string>,
    toggle: (code: string) => void,
    yearLabel: string,
  ) {
    const codes = [...new Set(items.map(i => i.account_code))].sort()
    if (codes.length === 0) {
      return (
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-400 text-sm">
          No {yearLabel} budget data found for this department.
        </div>
      )
    }
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
                <span className="font-semibold text-gray-800 flex-shrink-0 w-44 truncate text-sm">
                  {glDescriptions[code] ?? code}
                </span>
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
                  style={{ color: '#1e4757', fontVariantNumeric: 'tabular-nums' }}>
                  {fmt(acctTotal)}
                </span>
                <span className="flex-shrink-0 text-xs font-bold px-1.5 py-0.5 rounded-full ml-2"
                  style={{ background: 'rgba(49,108,127,.12)', color: '#316c7f' }}>
                  {acctItems.length}
                </span>
                <svg className="flex-shrink-0 ml-2 transition-transform"
                  style={{ transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)' }}
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
                          {['Description', 'Employee', 'Vendor', 'Month', 'Amount', 'Notes'].map(h => (
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
          <span className="font-extrabold text-sm" style={{ color: '#1e4757' }}>
            Total — {deptLabel} · {yearLabel}
          </span>
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

  // ── Render ─────────────────────────────────────────────────────────────────

  if (!profile) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#f0f6f7' }}>
        <div className="text-gray-400 text-sm">Loading…</div>
      </div>
    )
  }

  const deptLabel = deptNames[activeDept] ?? activeDept
  const isAdmin = profile.role === 'admin'

  const tabs: { key: 'input' | 'ref2026' | 'ref2025'; label: string }[] = [
    { key: 'input',   label: '2027 Budget Input' },
    { key: 'ref2026', label: '2026 Approved Budget' },
    { key: 'ref2025', label: '2025 Approved Budget' },
  ]

  // For the add form: recurring month count and total preview
  const recurringCount = Math.max(0, Number(addForm.toMonth) - Number(addForm.fromMonth) + 1)
  const recurringTotal = recurringCount * Number(addForm.amount || 0)

  return (
    <div className="min-h-screen" style={{ background: '#f0f6f7' }}>

      {/* ── Header ──────────────────────────────────────────────────────────── */}
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

        {/* ── Dept selector ───────────────────────────────────────────────── */}
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
              className="px-4 py-2.5 text-sm font-bold transition-colors"
              style={{
                borderBottom: `2px solid ${activeTab === tab.key ? '#316c7f' : 'transparent'}`,
                marginBottom: '-2px',
                color: activeTab === tab.key ? '#316c7f' : '#6b7280',
                background: 'transparent',
                border: 'none',
                borderBottomStyle: 'solid',
                borderBottomWidth: 2,
                borderBottomColor: activeTab === tab.key ? '#316c7f' : 'transparent',
                cursor: 'pointer',
              }}>
              {tab.label}
            </button>
          ))}
        </div>

        {/* ── Content ─────────────────────────────────────────────────────── */}
        {loading ? (
          <div className="flex items-center justify-center h-48">
            <div className="text-gray-400 text-sm">Loading budget data…</div>
          </div>

        ) : activeTab === 'ref2026' ? (
          renderRefAccordion(ref2026Items, expandedRef2026, toggleRef2026, '2026')

        ) : activeTab === 'ref2025' ? (
          renderRefAccordion(ref2025Items, expandedRef2025, toggleRef2025, '2025')

        ) : accounts.length === 0 ? (
          <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-400 text-sm">
            No budget lines found for this department.
          </div>

        ) : (
          /* ── Input Tab ───────────────────────────────────────────────── */
          <div className="space-y-3">
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

                  {/* Expanded content */}
                  {isExpanded && (
                    <div style={{ borderTop: '1px solid rgba(49,108,127,.15)' }}>

                      {/* Existing items */}
                      {acctItems.length > 0 && (
                        <div className="overflow-x-auto">
                          <table className="min-w-full text-sm">
                            <thead>
                              <tr style={{ background: '#f8fafb' }}>
                                {['Description', 'Employee', 'Vendor', 'Month', 'Amount', 'Notes', ''].map(h => (
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
                                  <td className="px-3 py-2">
                                    <button onClick={() => handleDeleteItem(item.id)}
                                      className="text-gray-300 hover:text-red-500 transition-colors" title="Delete item">
                                      <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
                                        <path d="M2 4h11M5 4V2.5h5V4M6 7v4M9 7v4M3 4l.7 8.5A1 1 0 004.7 13.5h5.6a1 1 0 001-.9L12 4"
                                          stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                                      </svg>
                                    </button>
                                  </td>
                                </tr>
                              ))}
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

                            {/* Common fields */}
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
                                <input type="text" placeholder="Optional notes"
                                  value={addForm.notes}
                                  onChange={e => setAddForm(f => ({ ...f, notes: e.target.value }))}
                                  className="input-field" style={{ width: 160 }} />
                              </div>

                              {/* One-time: single month */}
                              {addForm.entryType === 'once' && (
                                <div className="flex flex-col gap-1">
                                  <label className="text-xs font-semibold text-gray-500">Month <span style={{ color: '#ff930c' }}>*</span></label>
                                  <select value={addForm.month}
                                    onChange={e => setAddForm(f => ({ ...f, month: Number(e.target.value) }))}
                                    className="input-field" style={{ width: 110 }}>
                                    {MONTH_NAMES.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
                                  </select>
                                </div>
                              )}

                              {/* Recurring: from/to months */}
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
                                <button onClick={() => { setAddingTo(null); setAddForm(emptyForm()); setActionMsg('') }}
                                  className="text-sm px-4 py-2 rounded font-semibold transition-colors"
                                  style={{ background: '#f3f4f6', color: '#6b7280' }}>
                                  Cancel
                                </button>
                              </div>
                            </div>

                            {/* Recurring preview */}
                            {addForm.entryType === 'recurring' && Number(addForm.amount) > 0 && recurringCount > 0 && (
                              <div className="flex items-center gap-2 text-xs font-semibold rounded-md px-3 py-2 w-fit"
                                style={{ background: 'rgba(49,108,127,.08)', color: '#316c7f' }}>
                                <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                                  <path d="M6.5 1v2M6.5 10v2M1 6.5h2M10 6.5h2M2.8 2.8l1.4 1.4M8.8 8.8l1.4 1.4M2.8 10.2l1.4-1.4M8.8 4.2l1.4-1.4"
                                    stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                                </svg>
                                {recurringCount} month{recurringCount !== 1 ? 's' : ''} ×&nbsp;
                                ${Number(addForm.amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                &nbsp;=&nbsp;
                                <strong>${recurringTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} total</strong>
                              </div>
                            )}
                          </div>
                        ) : (
                          <button
                            onClick={() => { setAddingTo(acct.account_code); setAddForm(emptyForm()); setActionMsg('') }}
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
              Click any GL account to expand it. Use <strong>One-time</strong> for a single month, or <strong>Recurring monthly</strong> to spread a fixed amount across multiple months automatically.
            </p>
          </div>
        )}
      </main>
    </div>
  )
}
