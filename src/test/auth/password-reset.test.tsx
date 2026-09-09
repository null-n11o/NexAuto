import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const mockResetPasswordForEmail = vi.fn()
const mockUpdateUser = vi.fn()
const mockPush = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, refresh: vi.fn() }),
}))

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      resetPasswordForEmail: mockResetPasswordForEmail,
      updateUser: mockUpdateUser,
    },
  }),
}))

describe('password reset request page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockResetPasswordForEmail.mockResolvedValue({ error: null })
    mockUpdateUser.mockResolvedValue({ error: null })
  })

  it('sends a reset email with the reset page as the redirect target', async () => {
    const { default: ForgotPasswordPage } = await import('@/app/(auth)/forgot-password/page')
    render(<ForgotPasswordPage />)

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'user@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }))

    await waitFor(() => {
      expect(mockResetPasswordForEmail).toHaveBeenCalledWith('user@example.com', {
        redirectTo: `${window.location.origin}/reset-password`,
      })
    })
    expect(await screen.findByText(/If an account exists for that email/)).toBeInTheDocument()
  })

  it('shows the Supabase error when the reset email cannot be sent', async () => {
    mockResetPasswordForEmail.mockResolvedValueOnce({
      error: { message: 'Unable to send reset email' },
    })
    const { default: ForgotPasswordPage } = await import('@/app/(auth)/forgot-password/page')
    render(<ForgotPasswordPage />)

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'user@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }))

    expect(await screen.findByText('Unable to send reset email')).toBeInTheDocument()
  })
})

describe('password reset page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockResetPasswordForEmail.mockResolvedValue({ error: null })
    mockUpdateUser.mockResolvedValue({ error: null })
  })

  it('updates the password and confirms the reset', async () => {
    const { default: ResetPasswordPage } = await import('@/app/(auth)/reset-password/page')
    render(<ResetPasswordPage />)

    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'new-password-123' } })
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'new-password-123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Update password' }))

    await waitFor(() => {
      expect(mockUpdateUser).toHaveBeenCalledWith({ password: 'new-password-123' })
    })
    expect(await screen.findByText('Your password has been updated.')).toBeInTheDocument()
  })

  it('does not update the password when confirmation does not match', async () => {
    const { default: ResetPasswordPage } = await import('@/app/(auth)/reset-password/page')
    render(<ResetPasswordPage />)

    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'new-password-123' } })
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'different-password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Update password' }))

    expect(await screen.findByText('Passwords do not match.')).toBeInTheDocument()
    expect(mockUpdateUser).not.toHaveBeenCalled()
  })
})

describe('login page password reset link', () => {
  it('links to the password reset request page', async () => {
    const { default: LoginPage } = await import('@/app/(auth)/login/page')
    render(<LoginPage />)

    expect(screen.getByRole('link', { name: 'Forgot password?' })).toHaveAttribute(
      'href',
      '/forgot-password',
    )
  })
})
