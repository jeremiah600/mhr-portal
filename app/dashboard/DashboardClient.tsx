'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient, SCENARIOS, DEPT_NAMES } from '@/lib/supabase'

// ─── Types ────────────────────────────────────────────────────────────────────

interface UserProfile {
  role: 'admin' | 'director'
  dept_code: string | null
}

interface AccountMeta {
  account_code: string
  description: string
  is_code: number
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

type CellMap = Record<string, string> // for reference tab only

// ─── Helpers ──────────────────────────────────────────────────────────────────

function cellKey(account_code: string, month: number) {
  return `${account_code}|${month}`
}

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

function itemRowTotal(items: LineItem[], account_code: string): number {
  return items
    .filter(i => i.account_code === account_code)
    .reduce((s, i) => s + i.amount, 0)
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const emptyForm = () => ({
  description: '',
  employee_name: '',
  vendor: '',
  notes: '',
  month: new Date().getMonth() + 1,
  amount: '',
})

// ─── Component ────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const router = useRouter()
  const supabase = createClient()

  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [userEmail, setUserEmail] = useState('')
  const [activeDept, setActiveDept] = useState<string>('')
  const [activeTab, setActiveTab] = useState<'input' | 'reference'>('input')

  const [accounts, setAccounts] = useState<AccountMeta[]>([])
  const [reference, setReference] = useState<CellMap>({})
  const [lineItems, setLineItems] = useState<LineItem[]>([])
  const [expandedAccounts, setExpandedAccounts] = useState<Set<string>>(new Set())
  const [addingTo, setAddingTo] = useState<string | null>(null)
  const [addForm, setAddForm] = useState(emptyForm())

  const [loading, setLoading] = useState(true)
  const [actionMsg, setActionMsg] = useState('')
  const [savingItem, setSavingItem] = useState(false)

  // ── Load user profile ──────────────────────────────────────────────────────

  useEffect(() => {
    async function loadProfile() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }
      setUserEmail(user.email ?? '')

      const { data: dept } = await supabase
        .from('user_departments')
        .select('role, dept_code')
        .eq('user_id', user.id)
        .single()

      if (!dept) { router.push('/login'); return }
      setProfile(dept as UserProfile)
      setActiveDept(dept.dept_code ?? Object.keys(DEPT_NAMES)[0])
    }
    loadProfile()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Load budget data when dept changes ────────────────────────────────────

  const loadBudgetData = useCallback(async (dept: string) => {
    setLoading(true)
    setActionMsg('')

    // Reference data (2026 approved budget)
    const { data: refRows } = await supabase
      .from('budget_lines')
      .select('account_code, is_code, month, amount')
      .eq('scenario_id', SCENARIOS.BI_2026)
      .eq('dept_code', dept)
      .order('account_code')

    // Build account list from reference rows
    const accountMap = new Map<string, AccountMeta>()
    for (const row of refRows ?? []) {
      if (!accountMap.has(row.account_code)) {
        accountMap.set(row.account_code, {
          account_code: row.account_code,
          description: row.account_code,
          is_code: row.is_code,
        })
      }
    }

    if (accountMap.size > 0) {
      const codes = Array.from(accountMap.keys())
      const { data: glRows } = await supabase
        .from('gl_accounts')
        .select('account_code, description')
        .in('account_code', codes)
      for (const gl of glRows ?? []) {
        const meta = accountMap.get(gl.account_code)
        if (meta) meta.description = gl.description
      }
    }

    const refMap: CellMap = {}
    for (const row of refRows ?? []) {
      refMap[cellKey(row.account_code, row.month)] = String(row.amount ?? 0)
    }

    // 2027 line items
    const { data: itemRows } = await supabase
      .from('budget_line_items')
      .select('id, account_code, description, employee_name, vendor, notes, month, amount')
      .eq('scenario_id', SCENARIOS.DIRECTOR_2027)
      .eq('dept_code', dept)
      .order('account_code')
      .order('created_at')

    setAccounts(Array.from(accountMap.values()))
    setReference(refMap)
    setLineItems((itemRows ?? []).map(r => ({ ...r, amount: Number(r.amount) })))
    setExpandedAccounts(new Set())
    setAddingTo(null)
    setLoading(false)
  }, [supabase])

  useEffect(() => {
    if (activeDept) loadBudgetData(activeDept)
  }, [activeDept, loadBudgetData])

  // ── Toggle accordion ───────────────────────────────────────────────────────

  function toggleExpand(code: string) {
    setExpandedAccounts(prev => {
      const next = new Set(prev)
      if (next.has(code)) {
        next.delete(code)
        if (addingTo === code) setAddingTo(null)
      } else {
        next.add(code)
      }
      return next
    })
  }

  // ── Add line item ──────────────────────────────────────────────────────────

  async function handleAddItem(account_code: string) {
    if (!addForm.description.trim()) { setActionMsg('Description is required.'); return }
    const amt = Number(addForm.amount)
    if (!amt || amt <= 0) { setActionMsg('Enter a positive amount.'); return }

    setSavingItem(true)
    setActionMsg('')

    const payload = {
      scenario_id: SCENARIOS.DIRECTOR_2027,
      dept_code: activeDept,
      account_code,
      description: addForm.description.trim(),
      employee_name: addForm.employee_name.trim(),
      vendor: addForm.vendor.trim(),
      notes: addForm.notes.trim(),
      month: Number(addForm.month),
      amount: amt,
    }

    const { data, error } = await supabase
      .from('budget_line_items')
      .insert(payload)
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
    setSavingItem(false)
  }

  // ── Delete line item ───────────────────────────────────────────────────────

  async function handleDeleteItem(id: string) {
    const { error } = await supabase.from('budget_line_items').delete().eq('id', id)
    if (error) {
      setActionMsg(`Error: ${error.message}`)
    } else {
      setLineItems(prev => prev.filter(i => i.id !== id))
      setActionMsg('✓ Item deleted.')
    }
  }

  // ── Sign out ───────────────────────────────────────────────────────────────

  async function handleSignOut() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  if (!profile) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#f0f6f7' }}>
        <div className="text-gray-400 text-sm">Loading…</div>
      </div>
    )
  }

  const deptLabel = DEPT_NAMES[activeDept] ?? activeDept
  const isAdmin = profile.role === 'admin'

  // Column totals for reference tab grand total row
  function refColTotal(month: number) {
    return accounts.reduce((sum, acct) => sum + Number(reference[cellKey(acct.account_code, month)] || 0), 0)
  }

  return (
    <div className="min-h-screen" style={{ background: '#f0f6f7' }}>

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <header
        className="sticky top-0 z-50 shadow-md"
        style={{ background: 'linear-gradient(135deg, #1e4757 0%, #316c7f 100%)' }}
      >
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

        {/* ── Dept selector / toolbar ─────────────────────────────────────── */}
        <div className="flex flex-wrap items-center justify-between gap-4 mb-5">
          <div>
            {isAdmin ? (
              <div className="flex items-center gap-2">
                <label className="text-xs font-bold uppercase tracking-widest text-gray-500">Department:</label>
                <select value={activeDept} onChange={e => setActiveDept(e.target.value)} className="input-field w-auto">
                  {Object.entries(DEPT_NAMES).map(([code, name]) => (
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
          {(['input', 'reference'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className="px-4 py-2.5 text-sm font-bold transition-colors"
              style={{
                borderBottom: activeTab === tab ? '2px solid #316c7f' : '2px solid transparent',
                marginBottom: '-2px',
                color: activeTab === tab ? '#316c7f' : '#6b7280',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              {tab === 'input' ? '2027 Budget Input' : '2026 Approved Budget (Reference)'}
            </button>
          ))}
        </div>

        {/* ── Loading ─────────────────────────────────────────────────────── */}
        {loading ? (
          <div className="flex items-center justify-center h-48">
            <div className="text-gray-400 text-sm">Loading budget data…</div>
          </div>
        ) : accounts.length === 0 ? (
          <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-400 text-sm">
            No budget lines found for this department.
          </div>

        ) : activeTab === 'reference' ? (
          /* ── Reference Tab (read-only grid) ──────────────────────────── */
          <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-x-auto">
            <table className="min-w-full text-sm" style={{ fontVariantNumeric: 'tabular-nums' }}>
              <thead>
                <tr style={{ background: '#e8f4f6', borderBottom: '2px solid rgba(49,108,127,.18)' }}>
                  <th className="text-left px-4 py-3 sticky left-0"
                    style={{ background: '#e8f4f6', fontSize: 11, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: '#316c7f' }}>
                    GL Code
                  </th>
                  <th className="text-left px-4 py-3 sticky left-36"
                    style={{ background: '#e8f4f6', fontSize: 11, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: '#316c7f', minWidth: 200 }}>
                    Description
                  </th>
                  {MONTH_NAMES.map(m => (
                    <th key={m} className="text-right px-2 py-3"
                      style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: '#316c7f', width: 80 }}>
                      {m}
                    </th>
                  ))}
                  <th className="text-right px-4 py-3"
                    style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: '#316c7f', width: 110 }}>
                    Total
                  </th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((acct, idx) => {
                  const total = Array.from({ length: 12 }, (_, i) =>
                    Number(reference[cellKey(acct.account_code, i + 1)] || 0)
                  ).reduce((a, b) => a + b, 0)
                  return (
                    <tr key={acct.account_code} className="border-b border-gray-100"
                      style={{ background: idx % 2 === 0 ? '#fff' : 'rgba(0,0,0,.018)' }}>
                      <td className="px-4 py-2 sticky left-0 bg-inherit font-mono text-xs text-gray-500 font-semibold tracking-wide">
                        {acct.account_code}
                      </td>
                      <td className="px-4 py-2 sticky left-36 bg-inherit text-gray-800">{acct.description}</td>
                      {Array.from({ length: 12 }, (_, i) => i + 1).map(month => {
                        const val = reference[cellKey(acct.account_code, month)]
                        return (
                          <td key={month} className="px-2 py-2 text-right text-gray-600">
                            {val && Number(val) !== 0
                              ? Number(val).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
                              : <span className="text-gray-300">—</span>}
                          </td>
                        )
                      })}
                      <td className="px-4 py-2 text-right font-bold" style={{ color: '#316c7f' }}>
                        {total !== 0 ? fmt(total) : <span className="text-gray-300">—</span>}
                      </td>
                    </tr>
                  )
                })}
                <tr className="font-bold" style={{ background: 'rgba(49,108,127,.08)', borderTop: '2px solid rgba(49,108,127,.25)' }}>
                  <td colSpan={2} className="px-4 py-3 sticky left-0"
                    style={{ background: 'rgba(49,108,127,.08)', color: '#316c7f', fontSize: 13, fontWeight: 800 }}>
                    Total — {deptLabel}
                  </td>
                  {Array.from({ length: 12 }, (_, i) => i + 1).map(month => (
                    <td key={month} className="px-2 py-3 text-right" style={{ color: '#316c7f' }}>
                      {refColTotal(month) !== 0 ? fmt(refColTotal(month)) : <span className="text-gray-400">—</span>}
                    </td>
                  ))}
                  <td className="px-4 py-3 text-right" style={{ color: '#1e4757', fontSize: 13.5, fontWeight: 800 }}>
                    {fmt(accounts.reduce((sum, acct) =>
                      sum + Array.from({ length: 12 }, (_, i) => Number(reference[cellKey(acct.account_code, i + 1)] || 0)).reduce((a, b) => a + b, 0), 0))}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

        ) : (
          /* ── Input Tab (itemized accordion) ──────────────────────────── */
          <div className="space-y-3">
            {/* Column header bar */}
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

                  {/* ── Accordion header row ── */}
                  <button
                    onClick={() => toggleExpand(acct.account_code)}
                    className="w-full text-left px-4 py-3 flex items-center gap-3 transition-colors hover:bg-blue-50/40"
                    style={{ background: isExpanded ? 'rgba(49,108,127,.05)' : 'white' }}
                  >
                    {/* GL code */}
                    <span className="font-mono text-xs font-semibold text-gray-400 w-16 flex-shrink-0">
                      {acct.account_code}
                    </span>
                    {/* Description */}
                    <span className="font-semibold text-gray-800 flex-shrink-0 w-44 truncate text-sm">
                      {acct.description}
                    </span>
                    {/* Monthly totals - hidden on small screens */}
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
                    {/* Row total */}
                    <span className="ml-auto font-bold text-sm w-24 text-right flex-shrink-0"
                      style={{ color: rowTotal > 0 ? '#1e4757' : '#9ca3af', fontVariantNumeric: 'tabular-nums' }}>
                      {rowTotal > 0 ? rowTotal.toLocaleString('en-US', { maximumFractionDigits: 0 }) : '—'}
                    </span>
                    {/* Item count badge */}
                    {acctItems.length > 0 && (
                      <span className="flex-shrink-0 text-xs font-bold px-1.5 py-0.5 rounded-full ml-2"
                        style={{ background: 'rgba(49,108,127,.12)', color: '#316c7f' }}>
                        {acctItems.length}
                      </span>
                    )}
                    {/* Chevron */}
                    <svg className="flex-shrink-0 ml-2 transition-transform" style={{ transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)' }}
                      width="16" height="16" viewBox="0 0 16 16" fill="none">
                      <path d="M4 6l4 4 4-4" stroke="#9ca3af" strokeWidth="1.5" strokeLinecap="round"/>
                    </svg>
                  </button>

                  {/* ── Expanded content ── */}
                  {isExpanded && (
                    <div style={{ borderTop: '1px solid rgba(49,108,127,.15)' }}>

                      {/* Items table */}
                      {acctItems.length > 0 && (
                        <div className="overflow-x-auto">
                          <table className="min-w-full text-sm">
                            <thead>
                              <tr style={{ background: '#f8fafb' }}>
                                {['Description', 'Employee', 'Vendor', 'Month', 'Amount', 'Notes', ''].map(h => (
                                  <th key={h} className="text-left px-3 py-2 text-xs font-bold uppercase tracking-wider"
                                    style={{ color: '#316c7f', whiteSpace: 'nowrap' }}>
                                    {h}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {acctItems.map((item, idx) => (
                                <tr key={item.id} className="border-t border-gray-100"
                                  style={{ background: idx % 2 === 0 ? '#fff' : 'rgba(0,0,0,.015)' }}>
                                  <td className="px-3 py-2 text-gray-800 font-medium max-w-[200px] truncate"
                                    title={item.description}>{item.description}</td>
                                  <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{item.employee_name || <span className="text-gray-300">—</span>}</td>
                                  <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{item.vendor || <span className="text-gray-300">—</span>}</td>
                                  <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{MONTH_NAMES[item.month - 1]}</td>
                                  <td className="px-3 py-2 text-right font-semibold whitespace-nowrap"
                                    style={{ color: '#316c7f', fontVariantNumeric: 'tabular-nums' }}>
                                    ${item.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                  </td>
                                  <td className="px-3 py-2 text-gray-500 max-w-[180px] truncate"
                                    title={item.notes}>{item.notes || <span className="text-gray-300">—</span>}</td>
                                  <td className="px-3 py-2">
                                    <button
                                      onClick={() => handleDeleteItem(item.id)}
                                      className="text-gray-300 hover:text-red-500 transition-colors"
                                      title="Delete item"
                                    >
                                      <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
                                        <path d="M2 4h11M5 4V2.5h5V4M6 7v4M9 7v4M3 4l.7 8.5A1 1 0 004.7 13.5h5.6a1 1 0 001-.9L12 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
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
                          <div>
                            <div className="flex flex-wrap gap-2 items-end">
                              <div className="flex flex-col gap-1">
                                <label className="text-xs font-semibold text-gray-500">Description <span style={{ color: '#ff930c' }}>*</span></label>
                                <input
                                  type="text"
                                  placeholder="e.g. EA License renewal"
                                  value={addForm.description}
                                  onChange={e => setAddForm(f => ({ ...f, description: e.target.value }))}
                                  className="input-field"
                                  style={{ width: 200 }}
                                  autoFocus
                                />
                              </div>
                              <div className="flex flex-col gap-1">
                                <label className="text-xs font-semibold text-gray-500">Employee</label>
                                <input
                                  type="text"
                                  placeholder="e.g. Megan"
                                  value={addForm.employee_name}
                                  onChange={e => setAddForm(f => ({ ...f, employee_name: e.target.value }))}
                                  className="input-field"
                                  style={{ width: 140 }}
                                />
                              </div>
                              <div className="flex flex-col gap-1">
                                <label className="text-xs font-semibold text-gray-500">Vendor</label>
                                <input
                                  type="text"
                                  placeholder="e.g. State Board"
                                  value={addForm.vendor}
                                  onChange={e => setAddForm(f => ({ ...f, vendor: e.target.value }))}
                                  className="input-field"
                                  style={{ width: 150 }}
                                />
                              </div>
                              <div className="flex flex-col gap-1">
                                <label className="text-xs font-semibold text-gray-500">Month <span style={{ color: '#ff930c' }}>*</span></label>
                                <select
                                  value={addForm.month}
                                  onChange={e => setAddForm(f => ({ ...f, month: Number(e.target.value) }))}
                                  className="input-field"
                                  style={{ width: 110 }}
                                >
                                  {MONTH_NAMES.map((m, i) => (
                                    <option key={i} value={i + 1}>{m}</option>
                                  ))}
                                </select>
                              </div>
                              <div className="flex flex-col gap-1">
                                <label className="text-xs font-semibold text-gray-500">Amount <span style={{ color: '#ff930c' }}>*</span></label>
                                <input
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  placeholder="0.00"
                                  value={addForm.amount}
                                  onChange={e => setAddForm(f => ({ ...f, amount: e.target.value }))}
                                  className="input-field"
                                  style={{ width: 110 }}
                                />
                              </div>
                              <div className="flex flex-col gap-1">
                                <label className="text-xs font-semibold text-gray-500">Notes</label>
                                <input
                                  type="text"
                                  placeholder="Optional notes"
                                  value={addForm.notes}
                                  onChange={e => setAddForm(f => ({ ...f, notes: e.target.value }))}
                                  className="input-field"
                                  style={{ width: 180 }}
                                />
                              </div>
                              <div className="flex gap-2 items-end pb-0.5">
                                <button
                                  onClick={() => handleAddItem(acct.account_code)}
                                  disabled={savingItem}
                                  className="btn-primary text-sm px-4 py-2"
                                >
                                  {savingItem ? 'Saving…' : 'Save'}
                                </button>
                                <button
                                  onClick={() => { setAddingTo(null); setAddForm(emptyForm()); setActionMsg('') }}
                                  className="text-sm px-4 py-2 rounded font-semibold transition-colors"
                                  style={{ background: '#f3f4f6', color: '#6b7280' }}
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <button
                            onClick={() => { setAddingTo(acct.account_code); setAddForm(emptyForm()); setActionMsg('') }}
                            className="text-sm font-semibold flex items-center gap-1.5 transition-colors"
                            style={{ color: '#316c7f' }}
                          >
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

            {/* Grand total card */}
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
              Click any GL account to expand it and add individual expense items. Each item specifies what it is, who it's for, which vendor, and which month it falls in — the monthly totals auto-calculate. Switch to the Reference tab to compare against your 2026 approved figures.
            </p>
          </div>
        )}
      </main>
    </div>
  )
}
