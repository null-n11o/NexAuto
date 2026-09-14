import Image from 'next/image'
import { cn } from '@/lib/utils'

interface LogoProps {
  variant?: 'light' | 'dark'
  width?: number
  height?: number
  className?: string
  priority?: boolean
}

/**
 * Full NexAuto horizontal logo (mark + typography)
 * - 'light': for light backgrounds (black logo, #171717)
 * - 'dark': for dark backgrounds (inverted to white logo)
 */
export function NexAutoLogo({
  variant = 'light',
  width = 140,
  height,
  className,
  priority = false,
}: LogoProps) {
  // Original aspect ratio is 2172 x 724 (~3:1)
  const calculatedHeight = height ?? Math.round((width * 724) / 2172)

  return (
    <Image
      src="/brand/nexauto-logo.png"
      alt="NexAuto"
      width={width}
      height={calculatedHeight}
      priority={priority}
      className={cn(
        'h-auto w-auto object-contain',
        variant === 'dark' && 'brightness-0 invert',
        className
      )}
    />
  )
}

interface MarkProps {
  variant?: 'light' | 'dark'
  size?: number
  className?: string
  priority?: boolean
}

/**
 * NexAuto symbol mark only (square 1:1)
 * - 'light': for light backgrounds (black symbol)
 * - 'dark': for dark backgrounds (inverted to white symbol)
 */
export function NexAutoMark({
  variant = 'light',
  size = 32,
  className,
  priority = false,
}: MarkProps) {
  return (
    <Image
      src="/brand/nexauto-mark.png"
      alt="NexAuto"
      width={size}
      height={size}
      priority={priority}
      className={cn(
        'h-auto w-auto object-contain',
        variant === 'dark' && 'brightness-0 invert',
        className
      )}
    />
  )
}
