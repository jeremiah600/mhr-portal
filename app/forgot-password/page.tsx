'use client'
import { useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase'
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState('idle')
  const [error, setError] = useState('')
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setStatus('loading'); setError('')
    const supabase = createClient()
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin + '/reset-password' })
    if (error) { setError(error.message); setStatus('error') } else { setStatus('sent') }
  }
  if (status === 'sent') return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-900 to-blue-700">
      <div className="bg-white rounded-xl shadow-2xl p-8 w-full max-w-md text-center">
        <div className="text-4xl mb-4">📧</div>
        <h2 className="text-xl font-bold text-gray-900 mb-2">Check your email</h2>
        <p className="text-gray-500 text-sm">We sent a reset link to <strong>{email}</strong>. Click it to set a new password.</p>
        <Link href="/login" className="block mt-6 text-sm text-blue-600 hover:underline">Back to sign in</Link>
      </div>
    </div>
  )
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-900 to-blue-700">
      <div className="bg-white rounded-xl shadow-2xl p-8 w-full max-w-md">
        <div className="text-center mb-8">
          <div className="text-4xl mb-3">📊</div>
          <h1 className="text-2xl font-bold text-gray-900">Reset your password</h1>
          <p className="text-gray-500 text-sm mt-1">Enter your email and we will send you a reset link</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email address</label>
            <input type="email" required value={email} onChange={e => setEmail(e.target.value)} className="input-field" placeholder="you@myhrpros.com" autoComplete="email" />
          </div>
          {status === 'error' && <div className="bg-red-50 border border-red-200 rounded-md p-3 text-sm text-red-700">{error}</div>}
          <button type="submit" disabled={status === 'loading'} className="btn-primary w-full py-2.5">{status === 'loading' ? 'Sending...' : 'Send reset link'}</button>
        </form>
        <p className="text-center mt-6"><Link href="/login" className="text-sm text-blue-600 hover:underline">Back to sign in</Link></p>
      </div>
    </div>
  )
}