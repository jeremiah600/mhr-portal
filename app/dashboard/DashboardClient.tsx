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

// ─── Component ────────────────────────────────────────────────────────────────

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

    // 1. Fetch 2026 reference (BI_BUDGET_2026)
    const { data: refRows } = await supabase
      .from('budget_lines')
      .select('account_code, is_code, month, amount')
      .eq('scenario_id', SCENARIOS.BI_2026)
      .eq('dept_code', dept)
      .order('account_code')

    // 2. Fetch existing 2027 director input
    const { data: inputRows } = await supabase
      .from('budget_lines')
      .select('account_code, month, amount')
      .eq('scenario_id', SCENARIOS.DIRECTOR_2027)
      .eq('dept_code', dept)
      .eq('source', 'DIRECTOR_INPUT')

    // 3. Build account list from reference data + try gl_accounts descriptions
    const accountMap = new Map<string, AccountMeta>()
    for (const row of refRows ?? []) {
      if (!accountMap.has(row.account_code)) {
        accountMap.set(row.account_code, {
          account_code: row.account_code,
          description: row.account_code, // fallback
          is_code: row.is_code,
        })
      }
    }

    // 4. Try to enrich with GL descriptions
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

    // 5. Build reference cell map
    const refMap: CellMap = {}
    for (const row of refRows ?? []) {
      refMap[cellKey(row.account_code, row.month)] = String(row.amount ?? 0)
    }

    // 6. Build input cell map (pre-fill from existing DIRECTOR_INPUT)
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
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-gray-400 text-sm">Loading…</div>
      </div>
    )
  }

  const deptLabel = DEPT_NAMES[activeDept] ?? activeDept
  const isAdmin = profile.role === 'admin'

  return (
    <div className="min-h-screen bg-gray-50">
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <header className="bg-blue-800 text-white shadow-md">
        <div className="max-w-screen-xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-2xl">📊</span>
            <div>
              <h1 className="font-bold text-lg leading-tight">MHR Operations Portal</h1>
              <p className="text-blue-200 text-xs">Budget Planning</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-blue-200 hidden sm:block">{userEmail}</span>
            {isAdmin && (
              <span className="bg-yellow-400 text-yellow-900 text-xs font-bold px-2 py-0.5 rounded">
                ADMIN
              </span>
            )}
            <button onClick={handleSignOut} className="btn-secondary text-sm py-1.5">
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-screen-xl mx-auto px-4 py-6">
        {/* ── Dept selector (admin only) ──────────────────────────────────── */}
        <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
          <div>
            {isAdmin ? (
              <div className="flex items-center gap-2">
                <label className="text-sm font-medium text-gray-700">Department:</label>
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
                <h2 className="text-xl font-bold text-gray-900">{deptLabel}</h2>
                <p className="text-sm text-gray-500">Department {activeDept}</p>
              </div>
            )}
          </div>

          {/* Save button — only shown on input tab */}
          {activeTab === 'input' && (
            <div className="flex items-center gap-3">
              {saveMsg && (
                <span className={`text-sm ${saveMsg.startsWith('✓') ? 'text-green-600' : 'text-red-600'}`}>
                  {saveMsg}
                </span>
              )}
              {dirty.size > 0 && (
                <span className="text-xs text-amber-600 font-medium">
                  {dirty.size} unsaved change{dirty.size !== 1 ? 's' : ''}
                </span>
              )}
              <button onClick={handleSave} disabled={saving} className="btn-primary">
                {saving ? 'Saving…' : 'Save Budget'}
              </button>
            </div>
          )}
        </div>

        {/* ── Tabs ────────────────────────────────────────────────────────── */}
        <div className="flex gap-1 mb-4 border-b border-gray-200">
          <button
            onClick={() => setActiveTab('input')}
            className={`px-4 py-2 text-sm font-medium rounded-t-md border border-b-0 transition-colors ${
              activeTab === 'input'
                ? 'bg-white border-gray-200 text-blue-700 -mb-px'
                : 'bg-gray-100 border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            2027 Budget Input
          </button>
          <button
            onClick={() => setActiveTab('reference')}
            className={`px-4 py-2 text-sm font-medium rounded-t-md border border-b-0 transition-colors ${
              activeTab === 'reference'
                ? 'bg-white border-gray-200 text-blue-700 -mb-px'
                : 'bg-gray-100 border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            2026 Approved Budget (Reference)
          </button>
        </div>

        {/* ── Budget Grid ─────────────────────────────────────────────────── */}
        {loading ? (
          <div className="flex items-center justify-center h-48">
            <div className="text-gray-400">Loading budget data…</div>
          </div>
        ) : accounts.length === 0 ? (
          <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-400">
            No budget lines found for this department.
          </div>
        ) : (
          <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="text-left px-4 py-3 font-semibold text-gray-700 w-36 sticky left-0 bg-gray-50">
                    GL Code
                  </th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-700 min-w-48 sticky left-36 bg-gray-50">
                    Description
                  </th>
                  {MONTHS.map(m => (
                    <th key={m} className="text-right px-2 py-3 font-semibold text-gray-700 w-24">
                      {m}
                    </th>
                  ))}
                  <th className="text-right px-3 py-3 font-semibold text-gray-700 w-28">
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
                      className={`border-b border-gray-100 ${
                        idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'
                      } ${isDirty ? 'ring-1 ring-inset ring-amber-200' : ''}`}
                    >
                      <td className="px-4 py-2 font-mono text-xs text-gray-600 sticky left-0 bg-inherit">
                        {acct.account_code}
                      </td>
                      <td className="px-4 py-2 text-gray-800 sticky left-36 bg-inherit">
                        {acct.description}
                        {isDirty && (
                          <span className="ml-2 text-xs text-amber-500">●</span>
                        )}
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
                      <td className="px-3 py-2 text-right font-semibold text-gray-900">
                        {total !== 0
                          ? total.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
                          : <span className="text-gray-300">—</span>
                        }
                      </td>
                    </tr>
                  )
                })}

                {/* Grand total row */}
                <tr className="bg-blue-50 border-t-2 border-blue-200 font-semibold">
                  <td colSpan={2} className="px-4 py-3 text-gray-800 sticky left-0 bg-blue-50">
                    Total
                  </td>
                  {Array.from({ length: 12 }, (_, i) => i + 1).map(month => {
                    const cells = activeTab === 'input' ? inputs : reference
                    const colTotal = accounts.reduce((sum, acct) => {
                      return sum + Number(cells[cellKey(acct.account_code, month)] || 0)
                    }, 0)
                    return (
                      <td key={month} className="px-2 py-3 text-right text-gray-800">
                        {colTotal !== 0
                          ? colTotal.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
                          : <span className="text-gray-400">—</span>
                        }
                      </td>
                    )
                  })}
                  <td className="px-3 py-3 text-right text-blue-800">
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

        {/* ── Helper note ─────────────────────────────────────────────────── */}
        {activeTab === 'input' && !loading && (
          <p className="text-xs text-gray-400 mt-3">
            Enter your 2027 monthly budget amounts for each GL account. Switch to the Reference tab to see your approved 2026 budget. Click <strong>Save Budget</strong> when done — you can return and revise at any time.
          </p>
        )}
      </main>
    </div>
  )
}
