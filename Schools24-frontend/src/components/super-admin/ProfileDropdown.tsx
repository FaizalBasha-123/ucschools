"use client"

import { useAuth } from '@/contexts/AuthContext'
import { useRouter } from 'next/navigation'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { LogOut, Trash2 } from 'lucide-react'
import { getInitials } from '@/lib/utils'

export function ProfileDropdown() {
  const { user, logout } = useAuth()
  const router = useRouter()

  const handleLogout = () => {
    logout()
  }

  if (!user) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center gap-3 hover:opacity-80 transition-opacity focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-indigo-900 rounded-full">
          <div className="hidden md:flex flex-col items-end">
            <span className="text-sm font-medium text-white">
              {user.full_name || user.name}
            </span>
            <span className="text-xs text-indigo-300">
              {user.role === 'super_admin' ? 'Super Admin' : user.role}
            </span>
          </div>
          <Avatar className="h-9 w-9 cursor-pointer border-2 border-indigo-500">
            <AvatarImage src={user.profile_picture_url || undefined} alt={user.full_name || user.name} />
            <AvatarFallback className="bg-indigo-700 text-white text-sm font-semibold">
              {getInitials(user.full_name || user.name)}
            </AvatarFallback>
          </Avatar>
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>
          <div className="flex flex-col space-y-1">
            <p className="text-sm font-medium leading-none">{user.full_name || user.name}</p>
            <p className="text-xs leading-none text-muted-foreground">{user.email}</p>
          </div>
        </DropdownMenuLabel>

        <DropdownMenuSeparator />

        <DropdownMenuItem onClick={() => router.push('/super-admin?tab=trash')}>
          <Trash2 className="mr-2 h-4 w-4" />
          <span>Trash Bin</span>
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuItem onClick={handleLogout} className="text-red-600 dark:text-red-400">
          <LogOut className="mr-2 h-4 w-4" />
          <span>Logout</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
