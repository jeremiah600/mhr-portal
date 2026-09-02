import { createBrowserClient } from '@supabase/ssr'

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

// Scenario IDs — update when new budget years are created
export const SCENARIOS = {
  BI_2025: '8c7b874f-5ce2-481d-9ba5-19b4f7d2da3f',
  BI_2026: '2b5f937a-fce3-44e5-abc2-fb4b4540aab1',
  DIRECTOR_2027: 'e2295c80-9590-49dd-8241-a3951ccdb085',
} as const

export const MONTHS = [
  'Jan','Feb','Mar','Apr','May','Jun',
  'Jul','Aug','Sep','Oct','Nov','Dec'
]

export const DEPT_NAMES: Record<string, string> = {
  '100': 'Accounting',
  '200': 'Benefits',
  '350': 'Compliance',
  '450': 'Resource Center',
  '550': 'Client Services',
  '600': 'Executives',
  '800': 'Sales & Marketing',
  '900': 'Payroll',
  '950': 'IPT',
}
