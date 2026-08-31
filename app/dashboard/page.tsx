import dynamic from 'next/dynamic'

// Never render on the server — requires browser Supabase client + auth cookies
const DashboardClient = dynamic(() => import('./DashboardClient'), { ssr: false })

export default function DashboardPage() {
  return <DashboardClient />
}
