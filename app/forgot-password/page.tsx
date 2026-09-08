'use client'
import { useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState('idle')
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setStatus('loading')
    setError('')
    const supabase = createClient()
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + '/reset-password',
    })
    if (error) { setError(error.message); setStatus('error') }
    else { setStatus('sent') }
  }

  const BG = {
    background: 'radial-gradient(ellipse at 20% 80%, rgba(123,198,200,.2) 0%, transparent 55%), radial-gradient(ellipse at 80% 10%, rgba(255,147,12,.08) 0%, transparent 50%), linear-gradient(155deg, #1e4757 0%, #316c7f 60%, #2d7f8a 100%)'
  }
  const HEADER_BG = { background: 'linear-gradient(135deg, #1e4757 0%, #316c7f 100%)' }

  if (status === 'sent') return (
    <div className="min-h-screen flex items-center justify-center p-6" style={BG}>
      <div className="w-full max-w-md rounded-xl shadow-2xl overflow-hidden bg-white">
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
        <div className="px-9 py-8 text-center">
          <div className="text-4xl mb-4">📧</div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">Check your email</h2>
          <p className="text-gray-500 text-sm">We sent a reset link to <strong>{email}</strong>. Click it to set a new password.</p>
          <Link href="/login" className="block mt-6 text-sm font-semibold hover:underline" style={{ color: '#316c7f' }}>Back to sign in</Link>
        </div>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen flex items-center justify-center p-6" style={BG}>
      <div className="w-full max-w-md rounded-xl shadow-2xl overflow-hidden bg-white">
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
        <div className="px-9 py-8">
          <p className="text-sm font-semibold text-gray-700 mb-1">Reset your password</p>
          <p className="text-xs text-gray-400 mb-6">Enter your email and we'll send you a reset link.</p>
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-xs font-bold tracking-widest uppercase text-gray-500 mb-1.5">Email address</label>
              <input
                type="email" required value={email}
                onChange={e => setEmail(e.target.value)}
                className="input-field"
                placeholder="you@myhrpros.com"
                autoComplete="email"
              />
            </div>
            {status === 'error' && (
              <div className="bg-red-50 border border-red-200 rounded p-3 text-sm text-red-700">{error}</div>
            )}
            <button type="submit" disabled={status === 'loading'} className="btn-primary w-full py-2.5">
              {status === 'loading' ? 'Sending...' : 'Send reset link'}
            </button>
          </form>
          <p className="text-center mt-6">
            <Link href="/login" className="text-xs font-semibold hover:underline" style={{ color: '#316c7f' }}>Back to sign in</Link>
          </p>
        </div>
      </div>
    </div>
  )
}
