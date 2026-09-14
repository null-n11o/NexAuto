'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { UserRole } from '@/types'

import { NexAutoLogo } from '@/components/brand/logo'

interface SidebarProps {
  role: UserRole
}

const navItems = [
  { href: '/posts', label: '投稿管理' },
  { href: '/accounts', label: 'アカウント' },
  { href: '/analytics', label: '分析' },
]

const adminNavItems = [
  { href: '/users', label: 'ユーザー管理' },
  { href: '/companies', label: '企業設定' },
]

export function Sidebar({ role }: SidebarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  const items = role === 'admin' ? [...navItems, ...adminNavItems] : navItems

  return (
    <aside className="w-56 bg-gray-900 text-white flex flex-col min-h-screen">
      <div className="px-4 py-5 border-b border-gray-700 flex items-center">
        <Link href="/posts" className="block focus:outline-none">
          <NexAutoLogo variant="dark" width={128} priority />
        </Link>
      </div>
      <nav className="flex-1 px-2 py-4 space-y-1">
        {items.map(({ href, label }) => {
          const active = pathname === href || pathname.startsWith(href + '/')
          return (
            <Link
              key={href}
              href={href}
              className={`block px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                active
                  ? 'bg-gray-700 text-white'
                  : 'text-gray-300 hover:bg-gray-700 hover:text-white'
              }`}
            >
              {label}
            </Link>
          )
        })}
      </nav>
      <div className="px-2 py-4 border-t border-gray-700">
        <button
          onClick={handleLogout}
          className="w-full px-3 py-2 rounded-md text-sm font-medium text-gray-300 hover:bg-gray-700 hover:text-white transition-colors text-left"
        >
          ログアウト
        </button>
      </div>
    </aside>
  )
}
