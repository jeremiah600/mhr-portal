'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  // Detect Supabase error hash (e.g. expired reset link redirects back here)
  useEffect(() => {
    const hash = window.location.hash
    if (hash.includes('error=access_denied') || hash.includes('otp_expired')) {
      setError('That password reset link has expired. Please request a new one using "Forgot password?" below.')
      window.history.replaceState(null, '', window.location.pathname)
    }
  }, [])

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const supabase = createClient()
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) { setError(error.message); setLoading(false) }
    else { router.push('/dashboard'); router.refresh() }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center p-6"
      style={{
        background: 'radial-gradient(ellipse at 20% 80%, rgba(123,198,200,.2) 0%, transparent 55%), radial-gradient(ellipse at 80% 10%, rgba(255,147,12,.08) 0%, transparent 50%), linear-gradient(155deg, #1e4757 0%, #316c7f 60%, #2d7f8a 100%)'
      }}
    >
      <div className="w-full max-w-md rounded-xl shadow-2xl overflow-hidden bg-white">
        {/* Card header */}
        <div
          className="px-9 pt-8 pb-7"
          style={{ background: 'linear-gradient(135deg, #1e4757 0%, #316c7f 100%)' }}
        >
          <div className="flex items-center gap-3 mb-5">
            {/* Logo icon */}
            <div className="flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: 'rgba(255,255,255,.14)' }}>
              <svg width="20" height="20" viewBox="0 0 22 22" fill="none">
                <rect x="1" y="5" width="20" height="14" rx="2" stroke="white" strokeWidth="1.5"/>
                <path d="M1 9h20" stroke="white" strokeWidth="1.5"/>
                <circle cx="5" cy="14" r="1.5" fill="white"/>
                <rect x="9" y="13" width="9" height="2" rx="1" fill="white" fillOpacity=".6"/>
              </svg>
            </div>
            <div>
              <div className="text-white font-extrabold text-lg leading-tight tracking-tight">My HR Pros</div>
              <div className="text-xs font-semibold tracking-widest uppercase" style={{ color: '#7bc6c8' }}>
                Operations Portal
              </div>
            </div>
          </div>
          <hr style={{ borderColor: 'rgba(255,255,255,.15)' }} />
        </div>

        {/* Card body */}
        <div className="px-9 py-8">
          <p className="text-sm font-semibold text-gray-700 mb-6">Sign in to your account</p>

          <form onSubmit={handleLogin} className="space-y-5">
            <div>
              <label className="block text-xs font-bold tracking-widest uppercase text-gray-500 mb-1.5">
                Email address
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="input-field"
                placeholder="you@myhrpros.com"
                autoComplete="email"
              />
            </div>

            <div>
              <label className="block text-xs font-bold tracking-widest uppercase text-gray-500 mb-1.5">
                Password
              </label>
              <input
                type="password"
                required
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="input-field"
                placeholder="enter password"
                autoComplete="current-password"
              />
              <div className="flex justify-end mt-1.5">
                <Link
                  href="/forgot-password"
                  className="text-xs font-semibold hover:underline"
                  style={{ color: '#316c7f' }}
                >
                  Forgot password?
                </Link>
              </div>
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 rounded p-3 text-sm text-red-700">
                {error}
              </div>
            )}

            <button type="submit" disabled={loading} className="btn-primary w-full py-3 text-sm">
              {loading ? 'Signing in…' : 'Sign In'}
            </button>
          </form>

          <p className="text-center text-xs text-gray-400 mt-6">
            Contact your administrator if you need access.
          </p>
        </div>
      </div>
    </div>
  )
}
