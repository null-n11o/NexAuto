'use client'

import { useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NexAutoLogo } from '@/components/brand/logo'

export default function ResetPasswordPage() {
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const supabase = createClient()

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setMessage(null)

    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }

    if (password !== confirmation) {
      setError('Passwords do not match.')
      return
    }

    setLoading(true)
    const { error: updateError } = await supabase.auth.updateUser({ password })

    if (updateError) {
      setError(updateError.message)
    } else {
      setMessage('Your password has been updated.')
    }
    setLoading(false)
  }

  return (
    <div className="w-full max-w-md bg-white rounded-lg shadow p-8">
      <div className="flex justify-center mb-6">
        <NexAutoLogo width={160} priority />
      </div>
      <h1 className="text-2xl font-bold mb-2">Choose a new password</h1>
      <p className="text-sm text-gray-600 mb-6">Enter a new password for your account.</p>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <Label htmlFor="new-password">New password</Label>
          <Input
            id="new-password"
            type="password"
            value={password}
            onChange={event => setPassword(event.target.value)}
            minLength={8}
            required
          />
        </div>
        <div>
          <Label htmlFor="confirm-new-password">Confirm new password</Label>
          <Input
            id="confirm-new-password"
            type="password"
            value={confirmation}
            onChange={event => setConfirmation(event.target.value)}
            minLength={8}
            required
          />
        </div>
        {error && <p className="text-red-500 text-sm">{error}</p>}
        {message && <p className="text-green-600 text-sm">{message}</p>}
        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? 'Updating...' : 'Update password'}
        </Button>
      </form>
      {message && (
        <p className="text-center text-sm mt-6">
          <Link href="/login" className="text-blue-600 hover:underline">
            Return to sign in
          </Link>
        </p>
      )}
    </div>
  )
}
