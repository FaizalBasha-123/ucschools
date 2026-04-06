"use client"

import { useState, useMemo, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Trash2,
  RotateCcw,
  Search,
  AlertCircle,
  Clock,
  ArrowLeft,
  School as SchoolIcon,
  MapPin,
  Mail,
  User
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { useDeletedSchools, useRestoreSchool } from '@/hooks/useSchools'
import { ProfileDropdown } from '@/components/super-admin/ProfileDropdown'
import { PasswordPromptDialog } from '@/components/super-admin/PasswordPromptDialog'
import { useDebounce } from '@/hooks/useDebounce'
import { formatDistanceToNow, parseISO, differenceInHours } from 'date-fns'

export function SuperAdminTrashPanel({ embedded = false }: { embedded?: boolean }) {
  const { user, isLoading: authLoading } = useAuth()
  const router = useRouter()
  const [searchQuery, setSearchQuery] = useState('')
  const debouncedSearch = useDebounce(searchQuery, 300)
  const [restoreDialogOpen, setRestoreDialogOpen] = useState(false)
  const [selectedSchool, setSelectedSchool] = useState<{ id: string; name: string } | null>(null)

  const isSuperAdmin = user?.role === 'super_admin'
  const canLoad = isSuperAdmin && !authLoading

  const { data: deletedSchools = [], isLoading: isLoadingDeleted } = useDeletedSchools(canLoad)
  const restoreSchool = useRestoreSchool()

  // Redirect if not super admin
  useEffect(() => {
    if (authLoading || !user) return
    if (!isSuperAdmin) {
      router.push('/super-admin')
    }
  }, [authLoading, isSuperAdmin, router, user])

  // Filter deleted schools by search query
  const filteredSchools = useMemo(() => {
    if (!deletedSchools || !Array.isArray(deletedSchools)) return []
    return deletedSchools.filter(s =>
      s.name.toLowerCase().includes(debouncedSearch.toLowerCase()) ||
      s.contact_email?.toLowerCase().includes(debouncedSearch.toLowerCase()) ||
      s.deleted_by_name?.toLowerCase().includes(debouncedSearch.toLowerCase())
    )
  }, [deletedSchools, debouncedSearch])

  // Calculate hours remaining for a school
  const getHoursRemaining = (deletedAt: string) => {
    const deletedDate = parseISO(deletedAt)
    const hoursElapsed = differenceInHours(new Date(), deletedDate)
    return Math.max(0, 24 - hoursElapsed)
  }

  // Get urgency level for visual indicators
  const getUrgencyLevel = (hoursRemaining: number): 'critical' | 'warning' | 'normal' => {
    if (hoursRemaining <= 2) return 'critical'
    if (hoursRemaining <= 6) return 'warning'
    return 'normal'
  }

  const handleRestoreClick = (schoolId: string, schoolName: string) => {
    setSelectedSchool({ id: schoolId, name: schoolName })
    setRestoreDialogOpen(true)
  }

  const handleRestoreConfirm = async (password: string) => {
    if (!selectedSchool) return

    try {
      await restoreSchool.mutateAsync({
        schoolId: selectedSchool.id,
        password
      })
      toast.success('School Restored', {
        description: `${selectedSchool.name} has been successfully restored.`
      })
      setRestoreDialogOpen(false)
      setSelectedSchool(null)
    } catch (error: unknown) {
      // Error is handled by the hook, but we can show additional context
      if (error instanceof Error && error.message?.includes('24 hours')) {
        toast.error('Cannot Restore', {
          description: 'This school has passed the 24-hour recovery window and has been permanently deleted.'
        })
      }
      throw error // Re-throw to let PasswordPromptDialog handle it
    }
  }

  if (authLoading || !isSuperAdmin) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-background">
        <div className="text-center space-y-3">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto"></div>
        </div>
      </div>
    )
  }

  return (
    <div className={embedded ? "space-y-8" : "min-h-[100dvh] bg-background"}>
      {!embedded && (
        <header className="bg-card border-b border-border shadow-sm sticky top-0 z-50">
          <div className="container mx-auto px-3 sm:px-6 h-16 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-orange-600 rounded-lg">
                <Trash2 className="h-6 w-6 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold tracking-tight text-foreground">Trash Bin</h1>
                <p className="text-xs text-muted-foreground">Deleted Schools - 24 Hour Recovery Window</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="hidden md:flex items-center gap-2 px-3 py-1.5 bg-orange-800/50 rounded-full border border-orange-700/50 shadow-inner">
                <Trash2 className="h-4 w-4 text-orange-300" />
                <span className="text-sm font-medium text-orange-100">
                  {deletedSchools?.length || 0} {(deletedSchools?.length || 0) === 1 ? 'School' : 'Schools'}
                </span>
              </div>
              <ProfileDropdown />
            </div>
          </div>
        </header>
      )}

      <main className={embedded ? "space-y-8" : "container mx-auto px-3 sm:px-6 py-6 sm:py-8 space-y-6 sm:space-y-8"}>
        {/* Back Button and Info Alert */}
        <div className="flex flex-col gap-4">
          {!embedded && (
            <Button
              variant="ghost"
              onClick={() => router.push('/super-admin')}
              className="self-start"
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Dashboard
            </Button>
          )}

          <div className="bg-gradient-to-r from-orange-50 to-amber-50 dark:from-orange-950/30 dark:to-amber-950/30 border border-orange-200/50 dark:border-orange-800/50 rounded-2xl p-4 sm:p-6 shadow-sm">
            <div className="flex gap-4">
              <div className="h-10 w-10 shrink-0 rounded-full bg-orange-100 dark:bg-orange-900/50 flex items-center justify-center">
                <AlertCircle className="h-5 w-5 text-orange-600 dark:text-orange-400" />
              </div>
              <div className="space-y-1.5">
                <p className="text-base font-bold text-orange-900 dark:text-orange-100">
                  Recovery Window Information
                </p>
                <p className="text-sm text-orange-800 dark:text-orange-200 leading-relaxed max-w-3xl">
                  Deleted schools can be restored within a strict <span className="font-bold">24-hour</span> window. After this period,
                  they will be permanently eradicated from the system, including all associated data and
                  tenant schemas. <span className="font-semibold text-red-600 dark:text-red-400">This automated purge cannot be undone.</span>
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Search Bar */}
        {(deletedSchools?.length || 0) > 0 && (
          <div className="bg-card/60 backdrop-blur-xl rounded-2xl border border-border/60 p-4 shadow-sm flex items-center">
            <div className="relative w-full md:w-96">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input
                placeholder="Search deleted schools by name, email, or admin..."
                className="pl-9 h-11 bg-background/80 border-border rounded-xl focus-visible:ring-indigo-500 transition-shadow"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>
        )}

        {/* Loading State */}
        {isLoadingDeleted && (
          <div className="flex justify-center items-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
          </div>
        )}

        {/* Empty State */}
        {!isLoadingDeleted && (deletedSchools?.length || 0) === 0 && (
          <div className="flex flex-col items-center justify-center py-20 bg-card/40 backdrop-blur-xl rounded-3xl border border-border/50 shadow-sm text-center">
            <div className="h-20 w-20 rounded-full bg-emerald-50 dark:bg-emerald-500/10 flex items-center justify-center mb-6 shadow-inner">
              <SchoolIcon className="h-10 w-10 text-emerald-500" />
            </div>
            <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2">
              Trash Bin is Empty
            </h3>
            <p className="text-slate-500 max-w-md">
              No recently deleted schools found. Schools deleted within the last 24 hours will appear here for recovery.
            </p>
            {!embedded && (
              <Button
                onClick={() => router.push('/super-admin')}
                className="mt-8 bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl shadow-md h-11 px-6 transition-all"
              >
                <ArrowLeft className="mr-2 h-4 w-4" /> Back to Dashboard
              </Button>
            )}
          </div>
        )}

        {/* Deleted Schools Grid */}
        {!isLoadingDeleted && filteredSchools.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 sm:gap-6">
            {filteredSchools.map((school) => {
              const hoursRemaining = getHoursRemaining(school.deleted_at!)
              const urgency = getUrgencyLevel(hoursRemaining)
              const urgencyColors = {
                critical: {
                  border: 'border-red-300 dark:border-red-800/60 shadow-red-500/10',
                  bg: 'bg-gradient-to-b from-red-50 to-white dark:from-red-950/30 dark:to-slate-900/60',
                  badge: 'bg-red-100/80 text-red-700 dark:bg-red-900/40 dark:text-red-400 border border-red-200 dark:border-red-800/50',
                  icon: 'text-red-600 dark:text-red-400 bg-red-100 dark:bg-red-900/40',
                  button: 'bg-red-600 hover:bg-red-700 text-white shadow-md shadow-red-500/20 cursor-pointer'
                },
                warning: {
                  border: 'border-orange-300 dark:border-orange-800/60 shadow-orange-500/10',
                  bg: 'bg-gradient-to-b from-orange-50 to-white dark:from-orange-950/30 dark:to-slate-900/60',
                  badge: 'bg-orange-100/80 text-orange-700 dark:bg-orange-900/40 dark:text-orange-400 border border-orange-200 dark:border-orange-800/50',
                  icon: 'text-orange-600 dark:text-orange-400 bg-orange-100 dark:bg-orange-900/40',
                  button: 'bg-orange-600 hover:bg-orange-700 text-white shadow-md shadow-orange-500/20 cursor-pointer'
                },
                normal: {
                  border: 'border-blue-200 dark:border-blue-800/50 shadow-blue-500/5',
                  bg: 'bg-gradient-to-b from-slate-50 to-white dark:from-slate-800/30 dark:to-slate-900/60',
                  badge: 'bg-blue-100/80 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 border border-blue-200 dark:border-blue-800/50',
                  icon: 'text-blue-600 dark:text-blue-400 bg-blue-100 dark:bg-blue-900/40',
                  button: 'bg-card hover:bg-muted/40 text-foreground border border-border cursor-pointer transition-all'
                }
              }

              return (
                <div
                  key={school.id}
                  className={`group rounded-3xl border backdrop-blur-xl overflow-hidden hover:shadow-xl transition-all duration-300 ${urgencyColors[urgency].border} ${urgencyColors[urgency].bg}`}
                >
                  <div className="p-6">
                    <div className="flex items-start justify-between gap-3 mb-5">
                      <div className="flex items-center gap-4 min-w-0">
                        <div className={`h-12 w-12 shrink-0 rounded-2xl flex items-center justify-center shadow-inner ${urgencyColors[urgency].icon}`}>
                          <SchoolIcon className="h-6 w-6" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <h3 className="text-lg font-bold text-slate-900 dark:text-white truncate" title={school.name}>
                            {school.name}
                          </h3>
                          <p className="text-xs text-slate-500 dark:text-slate-400 font-medium uppercase tracking-wider mt-0.5">
                            ID: {school.id.slice(0, 8)}
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-4 mb-6">
                      <div className="space-y-2.5">
                        {school.address && (
                          <div className="flex items-center gap-3 text-sm text-slate-600 dark:text-slate-300">
                            <MapPin className="h-4 w-4 shrink-0 text-slate-400" />
                            <span className="truncate font-medium">{school.address}</span>
                          </div>
                        )}
                        {school.contact_email && (
                          <div className="flex items-center gap-3 text-sm text-slate-600 dark:text-slate-300">
                            <Mail className="h-4 w-4 shrink-0 text-slate-400" />
                            <span className="truncate font-medium">{school.contact_email}</span>
                          </div>
                        )}
                      </div>

                      <div className="h-px w-full bg-gradient-to-r from-transparent via-slate-200 dark:via-slate-700 to-transparent my-4"></div>

                      <div className="space-y-3">
                        <div className="flex items-center justify-between text-sm">
                          <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
                            <User className="h-4 w-4" />
                            <span>Deleted by:</span>
                          </div>
                          <span className="font-semibold text-slate-700 dark:text-slate-200 truncate max-w-[120px]" title={school.deleted_by_name || 'Unknown'}>{school.deleted_by_name || 'Unknown'}</span>
                        </div>

                        <div className="flex items-center justify-between text-sm">
                          <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
                            <Clock className="h-4 w-4" />
                            <span>Time left:</span>
                          </div>
                          <span className="font-semibold text-slate-700 dark:text-slate-200 text-right">
                            {formatDistanceToNow(parseISO(school.deleted_at!), { addSuffix: true })}
                          </span>
                        </div>

                        <div className="pt-2">
                          <div className={`w-full flex justify-between items-center py-2 px-3 rounded-xl ${urgencyColors[urgency].badge}`}>
                            <span className="text-xs font-bold uppercase tracking-wide">Recovery Window</span>
                            <span className="text-sm font-black font-mono">
                              {Math.floor(hoursRemaining)}h {Math.floor((hoursRemaining % 1) * 60)}m
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-3">
                      <Button
                        onClick={() => handleRestoreClick(school.id, school.name)}
                        disabled={restoreSchool.isPending}
                        className={`w-full h-11 rounded-xl text-sm font-bold ${urgencyColors[urgency].button}`}
                      >
                        <RotateCcw className={`mr-2 h-4 w-4 ${urgency === 'normal' ? 'text-blue-500' : ''}`} />
                        Restore School
                      </Button>

                      {urgency === 'critical' && (
                        <p className="text-xs text-red-600 dark:text-red-400 text-center font-bold animate-pulse">
                          ⚠️ Critical: Less than 2 hours remaining!
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* No Search Results */}
        {!isLoadingDeleted && (deletedSchools?.length || 0) > 0 && filteredSchools.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 bg-card/40 backdrop-blur-xl rounded-3xl border border-dashed border-border shadow-sm text-center">
            <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center mb-4 shadow-inner">
              <Search className="h-8 w-8 text-slate-400" />
            </div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-2">
              No schools match your search
            </h3>
            <p className="text-slate-500 max-w-sm">
              We couldn&apos;t find any deleted schools matching &quot;{searchQuery}&quot;. Try a different search term.
            </p>
          </div>
        )}
      </main>

      {/* Password Prompt Dialog for Restore */}
      <PasswordPromptDialog
        open={restoreDialogOpen}
        onOpenChange={setRestoreDialogOpen}
        onConfirm={handleRestoreConfirm}
        title="Restore School"
        description={`Enter your password to restore "${selectedSchool?.name}". All associated data will be restored.`}
        actionLabel="Restore School"
        actionVariant="default"
        warningMessage="This will restore the school and make it active again. All admins and data will be accessible."
      />
    </div>
  )
}

export default function TrashBinPage() {
  const router = useRouter()
  useEffect(() => {
    router.replace('/super-admin?tab=trash')
  }, [router])
  return null
}
