'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase'

const BG = {
  background: 'radial-gradient(ellipse at 20% 80%, rgba(123,198,200,.2) 0%, transparent 55%), radial-gradient(ellipse at 80% 10%, rgba(255,147,12,.08) 0%, transparent 50%), linear-gradient(155deg, #1e4757 0%, #316c7f 60%, #2d7f8a 100%)'
}
const HEADER_BG = { background: 'linear-gradient(135deg, #1e4757 0%, #316c7f 100%)' }

function MHRHeader() {
  return (
    <div className="px-9 pt-8 pb-7" style={HEADER_BG}>
      <div className="flex items-center gap-3 mb-5">
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
          <div className="text-xs font-semibold tracking-widest uppercase" style={{ color: '#7bc6c8' }}>Operations Portal</div>
        </div>
      </div>
      <hr style={{ borderColor: 'rgba(255,255,255,.15)' }} />
    </div>
  )
}

function ResetPasswordForm() {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)
  const [sessionReady, setSessionReady] = useState(false)
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    const supabase = createClient()

    // With implicit flow, Supabase detects the #access_token in the URL and fires
    // PASSWORD_RECOVERY via onAuthStateChange. Subscribe before checking session
    // so we don't miss the event.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' || (event === 'SIGNED_IN' && session)) {
        setSessionReady(true)
        setChecking(false)
      }
    })

    // Also check for an existing session (handles redirect from /auth/callback)
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        setSessionReady(true)
        setChecking(false)
      }
    })

    // Check for error param in URL hash (e.g. #error=access_denied)
    const hash = window.location.hash
    if (hash) {
      const params = new URLSearchParams(hash.slice(1))
      if (params.get('error')) {
        setError('This password reset link has expired or already been used. Please request a new one.')
        setChecking(false)
      }
    }

    // Timeout: if no session/event after 5 s, the link is likely invalid
    const timer = setTimeout(() => {
      setChecking(prev => {
        if (prev) {
          setError('This password reset link has expired or already been used. Please request a new one.')
          return false
        }
        return prev
      })
    }, 5000)

    return () => {
      subscription.unsubscribe()
      clearTimeout(timer)
    }
  }, [])

  async function handleReset(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }

    setLoading(true)
    const supabase = createClient()
    const { error } = await supabase.auth.updateUser({ password })

    if (error) {
      setError(error.message)
      setLoading(false)
    } else {
      setSuccess(true)
      setTimeout(() => router.push('/dashboard'), 2500)
    }
  }

  if (success) return (
    <div className="min-h-screen flex items-center justify-center p-6" style={BG}>
      <div className="w-full max-w-md rounded-xl shadow-2xl overflow-hidden bg-white">
        <MHRHeader />
        <div className="px-9 py-8 text-center">
          <div className="text-4xl mb-4">✅</div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">Password updated!</h2>
          <p className="text-gray-500 text-sm">Redirecting you to the dashboard…</p>
        </div>
      </div>
    </div>
  )

  if (!checking && !sessionReady && error) return (
    <div className="min-h-screen flex items-center justify-center p-6" style={BG}>
      <div className="w-full max-w-md rounded-xl shadow-2xl overflow-hidden bg-white">
        <MHRHeader />
        <div className="px-9 py-8 text-center">
          <div className="text-4xl mb-4">⚠️</div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">Link expired</h2>
          <p className="text-gray-500 text-sm mb-6">{error}</p>
          <Link href="/forgot-password" className="btn-primary block py-2.5 text-center">
            Request new reset link
          </Link>
          <Link href="/login" className="block mt-3 text-xs font-semibold hover:underline" style={{ color: '#316c7f' }}>
            Back to sign in
          </Link>
        </div>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen flex items-center justify-center p-6" style={BG}>
      <div className="w-full max-w-md rounded-xl shadow-2xl overflow-hidden bg-white">
        <MHRHeader />
        <div className="px-9 py-8">
          <p className="text-sm font-semibold text-gray-700 mb-1">Set new password</p>
          <p className="text-xs text-gray-400 mb-6">Choose a strong password for your account.</p>
          <form onSubmit={handleReset} className="space-y-5">
            <div>
              <label className="block text-xs font-bold tracking-widest uppercase text-gray-500 mb-1.5">
                New password
              </label>
              <input
                type="password" required value={password}
                onChange={e => setPassword(e.target.value)}
                className="input-field"
                placeholder="At least 8 characters"
                autoComplete="new-password"
              />
            </div>
            <div>
              <label className="block text-xs font-bold tracking-widest uppercase text-gray-500 mb-1.5">
                Confirm password
              </label>
              <input
                type="password" required value={confirm}
                onChange={e => setConfirm(e.target.value)}
                className="input-field"
                placeholder="••••••••"
                autoComplete="new-password"
              />
            </div>
            {error && (
              <div className="bg-red-50 border border-red-200 rounded p-3 text-sm text-red-700">{error}</div>
            )}
            <button
              type="submit"
              disabled={loading || !sessionReady}
              className="btn-primary w-full py-2.5"
            >
              {loading ? 'Updating…' : checking ? 'Verifying link…' : 'Update password'}
            </button>
          </form>
          <p className="text-center mt-6">
            <Link href="/login" className="text-xs font-semibold hover:underline" style={{ color: '#316c7f' }}>
              Back to sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordForm />
    </Suspense>
  )
}
