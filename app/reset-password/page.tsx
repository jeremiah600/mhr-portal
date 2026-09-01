'use client'
import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase'
function ResetPasswordForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [status, setStatus] = useState('exchanging')
  const [error, setError] = useState('')
  useEffect(() => {
    const code = searchParams.get('code')
    if (!code) { setError('No reset code found. Please request a new link.'); setStatus('error'); return }
    createClient().auth.exchangeCodeForSession(code).then(({ error }) => {
      if (error) { setError('This reset link has expired or already been used.'); setStatus('error') }
      else { setStatus('idle') }
    })
  }, [searchParams])
  async function handleReset(e: React.FormEvent) {
    e.preventDefault(); setError('')
    if (password !== confirm) { setError('Passwords do not match.'); return }
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return }
    setStatus('loading')
    const { error } = await createClient().auth.updateUser({ password })
    if (error) { setError(error.message); setStatus('idle') }
    else { setStatus('success'); setTimeout(() => router.push('/login'), 3000) }
  }
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-900 to-blue-700">
      <div className="bg-white rounded-xl shadow-2xl p-8 w-full max-w-md">
        <div className="text-center mb-8"><div className="text-4xl mb-3">📊</div><h1 className="text-2xl font-bold text-gray-900">Set new password</h1></div>
        {status === 'exchanging' && <p className="text-center text-gray-500 text-sm">Verifying reset link...</p>}
        {status === 'success' && <div className="text-center"><p className="text-lg font-semibold text-gray-900 mb-2">Password updated!</p><p className="text-gray-500 text-sm">Redirecting to sign in...</p></div>}
        {status === 'error' && <div className="text-center"><div className="bg-red-50 border border-red-200 rounded-md p-4 text-sm text-red-700 mb-4">{error}</div><Link href="/forgot-password" className="text-sm text-blue-600 hover:underline">Request a new reset link</Link></div>}
        {(status === 'idle' || status === 'loading') && (
          <form onSubmit={handleReset} className="space-y-5">
            <div><label className="block text-sm font-medium text-gray-700 mb-1">New password</label><input type="password" required value={password} onChange={e => setPassword(e.target.value)} className="input-field" placeholder="Min. 8 characters" autoComplete="new-password" /></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Confirm new password</label><input type="password" required value={confirm} onChange={e => setConfirm(e.target.value)} className="input-field" placeholder="Repeat your new password" autoComplete="new-password" /></div>
            {error && <div className="bg-red-50 border border-red-200 rounded-md p-3 text-sm text-red-700">{error}</div>}
            <button type="submit" disabled={status === 'loading'} className="btn-primary w-full py-2.5">{status === 'loading' ? 'Updating...' : 'Update password'}</button>
          </form>
        )}
      </div>
    </div>
  )
}
export default function ResetPasswordPage() {
  return (<Suspense fallback={<div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-900 to-blue-700"><div className="bg-white rounded-xl p-8 text-center"><p className="text-gray-500">Loading...</p></div></div>}><ResetPasswordForm /></Suspense>)
}