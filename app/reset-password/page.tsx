'use client'
import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase'

const BG = {
  background: 'radial-gradient(ellipse at 20% 80%, rgba(123,198,200,.2) 0%, transparent 55%), radial-gradient(ellipse at 80% 10%, rgba(255,147,12,.08) 0%, transparent 50%), linear-gradient(155deg, #1e4757 0%, #316c7f 60%, #2d7f8a 100%)'
}
const HEADER_BG = { background: 'linear-gradient(135deg, #1e4757 0%, #316c7f 100%)' }

function Logo() {
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
  const searchParams = useSearchParams()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [status, setStatus] = useState('exchanging')
  const [error, setError] = useState('')

  useEffect(() => {
    const supabase = createClient()
    const code       = searchParams.get('code')
    const tokenHash  = searchParams.get('token_hash')
    const type       = searchParams.get('type')

    if (code) {
      // PKCE flow
      supabase.auth.exchangeCodeForSession(code).then(({ error }) => {
        if (error) { setError('This reset link has expired or already been used.'); setStatus('error') }
        else { setStatus('idle') }
      })
    } else if (tokenHash && type) {
      // Email OTP / token_hash flow
      supabase.auth.verifyOtp({ token_hash: tokenHash, type: type as 'recovery' }).then(({ error }) => {
        if (error) { setError('This reset link has expired or already been used.'); setStatus('error') }
        else { setStatus('idle') }
      })
    } else {
      setError('No reset code found. Please request a new link.')
      setStatus('error')
    }
  }, [searchParams])

  async function handleReset(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (password !== confirm) { setError('Passwords do not match.'); return }
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return }
    setStatus('loading')
    const { error } = await createClient().auth.updateUser({ password })
    if (error) { setError(error.message); setStatus('idle') }
    else { setStatus('success'); setTimeout(() => router.push('/login'), 3000) }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6" style={BG}>
      <div className="w-full max-w-md rounded-xl shadow-2xl overflow-hidden bg-white">
        <Logo />
        <div className="px-9 py-8">
          {status === 'exchanging' && (
            <p className="text-center text-gray-500 text-sm py-4">Verifying reset link...</p>
          )}
          {status === 'success' && (
            <div className="text-center py-4">
              <div className="text-4xl mb-4">✅</div>
              <p className="text-lg font-bold text-gray-900 mb-2">Password updated!</p>
              <p className="text-gray-500 text-sm">Redirecting you to sign in...</p>
            </div>
          )}
          {status === 'error' && (
            <div className="text-center py-4">
              <div className="bg-red-50 border border-red-200 rounded p-4 text-sm text-red-700 mb-4">{error}</div>
              <Link href="/forgot-password" className="text-sm font-semibold hover:underline" style={{ color: '#316c7f' }}>Request a new reset link</Link>
            </div>
          )}
          {(status === 'idle' || status === 'loading') && (
            <>
              <p className="text-sm font-semibold text-gray-700 mb-1">Set new password</p>
              <p className="text-xs text-gray-400 mb-6">Choose a password at least 8 characters long.</p>
              <form onSubmit={handleReset} className="space-y-5">
                <div>
                  <label className="block text-xs font-bold tracking-widest uppercase text-gray-500 mb-1.5">New password</label>
                  <input type="password" required value={password} onChange={e => setPassword(e.target.value)} className="input-field" placeholder="Min. 8 characters" autoComplete="new-password" />
                </div>
                <div>
                  <label className="block text-xs font-bold tracking-widest uppercase text-gray-500 mb-1.5">Confirm password</label>
                  <input type="password" required value={confirm} onChange={e => setConfirm(e.target.value)} className="input-field" placeholder="Re-enter password" autoComplete="new-password" />
                </div>
                {error && <div className="bg-red-50 border border-red-200 rounded p-3 text-sm text-red-700">{error}</div>}
                <button type="submit" disabled={status === 'loading'} className="btn-primary w-full py-2.5">
                  {status === 'loading' ? 'Updating...' : 'Set new password'}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center p-6" style={BG}>
        <div className="w-full max-w-md rounded-xl shadow-2xl overflow-hidden bg-white">
          <Logo />
          <div className="px-9 py-8 text-center text-gray-500 text-sm">Loading...</div>
        </div>
      </div>
    }>
      <ResetPasswordForm />
    </Suspense>
  )
}
