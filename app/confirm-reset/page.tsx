'use client'

import { useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
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

function ConfirmResetForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [status, setStatus] = useState<'idle' | 'verifying' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  const tokenHash = searchParams.get('token_hash')

  if (!tokenHash) {
    return (
      <div className="px-9 py-8 text-center">
        <div className="text-4xl mb-4">⚠️</div>
        <h2 className="text-xl font-bold text-gray-900 mb-2">Invalid link</h2>
        <p className="text-gray-500 text-sm mb-6">This password reset link is not valid. Please request a new one.</p>
        <Link href="/forgot-password" className="btn-primary block py-2.5 text-center">
          Request new reset link
        </Link>
        <Link href="/login" className="block mt-3 text-xs font-semibold hover:underline" style={{ color: '#316c7f' }}>
          Back to sign in
        </Link>
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="px-9 py-8 text-center">
        <div className="text-4xl mb-4">⚠️</div>
        <h2 className="text-xl font-bold text-gray-900 mb-2">Link expired</h2>
        <p className="text-gray-500 text-sm mb-6">{errorMsg}</p>
        <Link href="/forgot-password" className="btn-primary block py-2.5 text-center">
          Request new reset link
        </Link>
        <Link href="/login" className="block mt-3 text-xs font-semibold hover:underline" style={{ color: '#316c7f' }}>
          Back to sign in
        </Link>
      </div>
    )
  }

  async function handleConfirm() {
    setStatus('verifying')
    const supabase = createClient()
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash!,
      type: 'recovery',
    })
    if (error) {
      setErrorMsg(
        error.message.toLowerCase().includes('expired')
          ? 'This link has expired. Password reset links are valid for 1 hour.'
          : 'This link has already been used or is no longer valid. Please request a new one.'
      )
      setStatus('error')
    } else {
      router.push('/reset-password')
    }
  }

  return (
    <div className="px-9 py-8 text-center">
      <div className="text-4xl mb-4">🔑</div>
      <h2 className="text-xl font-bold text-gray-900 mb-2">Ready to reset your password</h2>
      <p className="text-gray-500 text-sm mb-8">
        Click the button below to continue. This link can only be used once.
      </p>
      <button
        onClick={handleConfirm}
        disabled={status === 'verifying'}
        className="btn-primary w-full py-3"
      >
        {status === 'verifying' ? 'Verifying…' : 'Reset My Password'}
      </button>
      <Link href="/login" className="block mt-4 text-xs font-semibold hover:underline" style={{ color: '#316c7f' }}>
        Back to sign in
      </Link>
    </div>
  )
}

export default function ConfirmResetPage() {
  return (
    <div className="min-h-screen flex items-center justify-center p-6" style={BG}>
      <div className="w-full max-w-md rounded-xl shadow-2xl overflow-hidden bg-white">
        <MHRHeader />
        <Suspense fallback={<div className="px-9 py-12 text-center text-gray-400 text-sm">Loading…</div>}>
          <ConfirmResetForm />
        </Suspense>
      </div>
    </div>
  )
}
