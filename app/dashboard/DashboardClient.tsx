'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient, SCENARIOS, MONTHS, DEPT_NAMES } from '@/lib/supabase'

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

// key: `${account_code}|${month}`  value: amount string (empty = 0)
type CellMap = Record<string, string>

// ─── Helpers ──────────────────────────────────────────────────────────────────

function cellKey(account_code: string, month: number) {
  return `${account_code}|${month}`
}

function rowTotal(cells: CellMap, account_code: string): number {
  return Array.from({ length: 12 }, (_, i) => Number(cells[cellKey(account_code, i + 1)] || 0))
    .reduce((a, b) => a + b, 0)
}

// ─── Component ────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const router = useRouter()
  const supabase = createClient()

  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [userEmail, setUserEmail] = useState('')
  const [activeDept, setActiveDept] = useState<string>('')
  const [activeTab, setActiveTab] = useState<'input' | 'reference'>('input')

  const [accounts, setAccounts] = useState<AccountMeta[]>([])
  const [reference, setReference] = useState<CellMap>({})   // 2026 BI Budget
  const [inputs, setInputs] = useState<CellMap>({})          // 2027 Director Input
  const [dirty, setDirty] = useState<Set<string>>(new Set()) // changed account codes

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')

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
    setSaveMsg('')

    const { data: refRows } = await supabase
      .from('budget_lines')
      .select('account_code, is_code, month, amount')
      .eq('scenario_id', SCENARIOS.BI_2026)
      .eq('dept_code', dept)
      .order('account_code')

    const { data: inputRows } = await supabase
      .from('budget_lines')
      .select('account_code, month, amount')
      .eq('scenario_id', SCENARIOS.DIRECTOR_2027)
      .eq('dept_code', dept)
      .eq('source', 'DIRECTOR_INPUT')

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

    const inputMap: CellMap = {}
    for (const row of inputRows ?? []) {
      inputMap[cellKey(row.account_code, row.month)] = String(row.amount ?? 0)
    }

    setAccounts(Array.from(accountMap.values()))
    setReference(refMap)
    setInputs(inputMap)
    setDirty(new Set())
    setLoading(false)
  }, [supabase])

  useEffect(() => {
    if (activeDept) loadBudgetData(activeDept)
  }, [activeDept, loadBudgetData])

  // ── Cell change handler ────────────────────────────────────────────────────

  function handleCellChange(account_code: string, month: number, value: string) {
    const key = cellKey(account_code, month)
    setInputs(prev => ({ ...prev, [key]: value }))
    setDirty(prev => new Set(prev).add(account_code))
    setSaveMsg('')
  }

  // ── Save handler ───────────────────────────────────────────────────────────

  async function handleSave() {
    if (dirty.size === 0) { setSaveMsg('No changes to save.'); return }
    setSaving(true)
    setSaveMsg('')

    const rows = []
    for (const account_code of dirty) {
      const meta = accounts.find(a => a.account_code === account_code)
      if (!meta) continue
      for (let month = 1; month <= 12; month++) {
        const amount = Number(inputs[cellKey(account_code, month)] || 0)
        rows.push({
          scenario_id: SCENARIOS.DIRECTOR_2027,
          account_code,
          is_code: meta.is_code,
          dept_code: activeDept,
          year: 2027,
          month,
          original_amount: amount,
          amount,
          source: 'DIRECTOR_INPUT',
          status: 'draft',
        })
      }
    }

    const { error } = await supabase
      .from('budget_lines')
      .upsert(rows, {
        onConflict: 'scenario_id,account_code,dept_code,year,month',
        ignoreDuplicates: false,
      })

    if (error) {
      setSaveMsg(`Error: ${error.message}`)
    } else {
      setDirty(new Set())
      setSaveMsg(`✓ Saved ${rows.length} entries successfully.`)
    }
    setSaving(false)
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

  return (
    <div className="min-h-screen" style={{ background: '#f0f6f7' }}>
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <header
        className="sticky top-0 z-50 shadow-md"
        style={{ background: 'linear-gradient(135deg, #1e4757 0%, #316c7f 100%)' }}
      >
        <div className="max-w-screen-xl mx-auto px-6 py-0 flex items-center justify-between h-[60px]">
          <div className="flex items-center gap-3">
            {/* Logo icon */}
            <div
              className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ background: 'rgba(255,255,255,.13)' }}
            >
              <svg width="20" height="20" viewBox="0 0 22 22" fill="none">
                <rect x="1" y="5" width="20" height="14" rx="2" stroke="white" strokeWidth="1.5"/>
                <path d="M1 9h20" stroke="white" strokeWidth="1.5"/>
                <circle cx="5" cy="14" r="1.5" fill="white"/>
                <rect x="9" y="13" width="9" height="2" rx="1" fill="white" fillOpacity=".6"/>
              </svg>
            </div>
            <div>
              <h1 className="font-extrabold text-base text-white leading-tight tracking-tight">
                My HR Pros
              </h1>
              <p className="text-xs font-semibold tracking-widest uppercase" style={{ color: '#7bc6c8' }}>
                Operations Portal · Budget Planning
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-sm hidden sm:block" style={{ color: '#7bc6c8' }}>{userEmail}</span>
            {isAdmin && (
              <span
                className="text-xs font-extrabold px-2 py-0.5 rounded tracking-widest uppercase"
                style={{ background: '#ff930c', color: '#fff' }}
              >
                Admin
              </span>
            )}
            <button
              onClick={handleSignOut}
              className="text-sm font-semibold px-3 py-1.5 rounded transition-colors"
              style={{
                color: 'rgba(255,255,255,.85)',
                background: 'rgba(255,255,255,.12)',
                border: '1px solid rgba(255,255,255,.2)',
              }}
            >
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
                <label className="text-xs font-bold uppercase tracking-widest text-gray-500">
                  Department:
                </label>
                <select
                  value={activeDept}
                  onChange={e => setActiveDept(e.target.value)}
                  className="input-field w-auto"
                >
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

          {activeTab === 'input' && (
            <div className="flex items-center gap-3">
              {saveMsg && (
                <span className={`text-sm font-semibold ${saveMsg.startsWith('✓') ? 'text-green-600' : 'text-red-600'}`}>
                  {saveMsg}
                </span>
              )}
              {dirty.size > 0 && (
                <span className="text-xs font-semibold text-amber-600">
                  {dirty.size} unsaved change{dirty.size !== 1 ? 's' : ''}
                </span>
              )}
              <button onClick={handleSave} disabled={saving} className="btn-primary text-sm">
                {saving ? 'Saving…' : 'Save Budget'}
              </button>
            </div>
          )}
        </div>

        {/* ── Tabs ────────────────────────────────────────────────────────── */}
        <div
          className="flex gap-1 mb-4"
          style={{ borderBottom: '2px solid #e5e7eb' }}
        >
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
                borderBottom: activeTab === tab ? '2px solid #316c7f' : '2px solid transparent',
                cursor: 'pointer',
              }}
            >
              {tab === 'input' ? '2027 Budget Input' : '2026 Approved Budget (Reference)'}
            </button>
          ))}
        </div>

        {/* ── Budget Grid ─────────────────────────────────────────────────── */}
        {loading ? (
          <div className="flex items-center justify-center h-48">
            <div className="text-gray-400 text-sm">Loading budget data…</div>
          </div>
        ) : accounts.length === 0 ? (
          <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-400 text-sm">
            No budget lines found for this department.
          </div>
        ) : (
          <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-x-auto">
            <table className="min-w-full text-sm" style={{ fontVariantNumeric: 'tabular-nums' }}>
              <thead>
                <tr style={{ background: '#e8f4f6', borderBottom: '2px solid rgba(49,108,127,.18)' }}>
                  <th
                    className="text-left px-4 py-3 sticky left-0"
                    style={{ background: '#e8f4f6', fontSize: 11, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: '#316c7f' }}
                  >
                    GL Code
                  </th>
                  <th
                    className="text-left px-4 py-3 sticky left-36"
                    style={{ background: '#e8f4f6', fontSize: 11, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: '#316c7f', minWidth: 180 }}
                  >
                    Description
                  </th>
                  {MONTHS.map(m => (
                    <th
                      key={m}
                      className="text-right px-2 py-3"
                      style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: '#316c7f', width: 90 }}
                    >
                      {m}
                    </th>
                  ))}
                  <th
                    className="text-right px-4 py-3"
                    style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: '#316c7f', width: 110 }}
                  >
                    Total
                  </th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((acct, idx) => {
                  const cells = activeTab === 'input' ? inputs : reference
                  const isDirty = dirty.has(acct.account_code)
                  const total = rowTotal(cells, acct.account_code)

                  return (
                    <tr
                      key={acct.account_code}
                      className="border-b border-gray-100 transition-colors hover:bg-blue-50/30"
                      style={{
                        background: idx % 2 === 0 ? '#fff' : 'rgba(0,0,0,.018)',
                        boxShadow: isDirty ? 'inset 3px 0 0 #f59e0b' : undefined,
                      }}
                    >
                      <td className="px-4 py-2 sticky left-0 bg-inherit font-mono text-xs text-gray-500 font-semibold tracking-wide">
                        {acct.account_code}
                        {isDirty && <span className="ml-1 text-amber-400" style={{ fontSize: 8 }}>●</span>}
                      </td>
                      <td className="px-4 py-2 sticky left-36 bg-inherit text-gray-800">
                        {acct.description}
                      </td>
                      {Array.from({ length: 12 }, (_, i) => i + 1).map(month => {
                        const key = cellKey(acct.account_code, month)
                        const val = cells[key] ?? ''

                        return (
                          <td key={month} className="px-1 py-1">
                            {activeTab === 'input' ? (
                              <input
                                type="number"
                                step="0.01"
                                value={val === '0' ? '' : val}
                                onChange={e => handleCellChange(acct.account_code, month, e.target.value)}
                                className="budget-cell"
                                placeholder="—"
                              />
                            ) : (
                              <div className="text-right px-2 py-1 text-gray-600">
                                {val && Number(val) !== 0
                                  ? Number(val).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
                                  : <span className="text-gray-300">—</span>
                                }
                              </div>
                            )}
                          </td>
                        )
                      })}
                      <td className="px-4 py-2 text-right font-bold" style={{ color: '#316c7f' }}>
                        {total !== 0
                          ? total.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
                          : <span className="text-gray-300">—</span>
                        }
                      </td>
                    </tr>
                  )
                })}

                {/* Grand total row */}
                <tr
                  className="font-bold"
                  style={{ background: 'rgba(49,108,127,.08)', borderTop: '2px solid rgba(49,108,127,.25)' }}
                >
                  <td
                    colSpan={2}
                    className="px-4 py-3 sticky left-0"
                    style={{ background: 'rgba(49,108,127,.08)', color: '#316c7f', fontSize: 13, fontWeight: 800, letterSpacing: '.01em' }}
                  >
                    Total — {deptLabel}
                  </td>
                  {Array.from({ length: 12 }, (_, i) => i + 1).map(month => {
                    const cells = activeTab === 'input' ? inputs : reference
                    const colTotal = accounts.reduce((sum, acct) => {
                      return sum + Number(cells[cellKey(acct.account_code, month)] || 0)
                    }, 0)
                    return (
                      <td key={month} className="px-2 py-3 text-right" style={{ color: '#316c7f' }}>
                        {colTotal !== 0
                          ? colTotal.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
                          : <span className="text-gray-400">—</span>
                        }
                      </td>
                    )
                  })}
                  <td className="px-4 py-3 text-right" style={{ color: '#1e4757', fontSize: 13.5, fontWeight: 800 }}>
                    {accounts.reduce((sum, acct) => {
                      const cells = activeTab === 'input' ? inputs : reference
                      return sum + rowTotal(cells, acct.account_code)
                    }, 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {activeTab === 'input' && !loading && (
          <p className="text-xs text-gray-400 mt-3 leading-relaxed">
            Enter your 2027 monthly budget amounts for each GL account. Switch to the Reference tab to compare against your approved 2026 figures. Click <strong>Save Budget</strong> when done — you can return and revise at any time.
          </p>
        )}
      </main>
    </div>
  )
}
