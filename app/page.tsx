import { redirect } from 'next/navigation'

// Root redirects to dashboard; middleware handles auth check
export default function Home() {
  redirect('/dashboard')
}
