import { NavLink } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { LayoutDashboard, FileText, Sparkles, Phone } from 'lucide-react'

const MODES = [
  { to: '/board', label: 'Board', icon: LayoutDashboard, planned: false },
  { to: '/doc', label: 'Doc', icon: FileText, planned: false },
  { to: '/ai', label: 'AI', icon: Sparkles, planned: false },
  { to: '/call', label: 'Call', icon: Phone, planned: false },
]

export function ModeToggle() {
  return (
    <div className="flex items-center rounded-lg bg-neutral-100 p-0.5 border border-neutral-200">
      {MODES.map(({ to, label, icon: Icon, planned }) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) =>
            cn(
              'flex items-center gap-1.5 rounded-md px-3 py-1 text-sm font-medium transition-colors',
              isActive
                ? 'bg-white text-neutral-900 shadow-sm'
                : 'text-neutral-500 hover:text-neutral-800',
            )
          }
        >
          <Icon size={14} />
          {label}
          {planned && <span className="text-[9px] text-neutral-400 -mr-1">β</span>}
        </NavLink>
      ))}
    </div>
  )
}
