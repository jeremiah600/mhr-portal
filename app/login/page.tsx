'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const supabase = createClient()
    const { error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      setError(error.message)
      setLoading(false)
    } else {
      router.push('/dashboard')
      router.refresh()
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-900 to-blue-700">
      <div className="bg-white rounded-xl shadow-2xl p-8 w-full max-w-md">
        {/* Logo / Title */}
        <div className="text-center mb-8">
          <div className="text-4xl mb-3">📊</div>
          <h1 className="text-2xl font-bold text-gray-900">MHR Operations Portal</h1>
          <p className="text-gray-500 text-sm mt-1">Department Budget Planning</p>
        </div>

        {/* Form */}
        <form onSubmit={handleLogin} className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
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
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Password
            </label>
            <input
              type="password"
              required
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="input-field"
              placeholder="••••••••"
              autoComplete="current-password"
            />
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-md p-3 text-sm text-red-700">
              {error}
            </div>
          )}

          <button type="submit" disabled={loading} className="btn-primary w-full py-2.5">
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="text-center text-xs text-gray-400 mt-6">
          Contact your administrator if you need access.
        </p>
      </div>
    </div>
  )
}
