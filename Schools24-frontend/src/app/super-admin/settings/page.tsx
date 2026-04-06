"use client"

import { useState, useEffect } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { useRouter, useSearchParams } from 'next/navigation'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { ArrowLeft, Loader2, Eye, EyeOff, Plus, Trash2, Lock, Unlock } from 'lucide-react'
import { getInitials } from '@/lib/utils'
import { useUpdateProfile, useChangePassword } from '@/hooks/useProfile'
import { useSuperAdmins, useCreateSuperAdmin, useDeleteSuperAdmin, useSuspendSuperAdmin, useUnsuspendSuperAdmin } from '@/hooks/useSuperAdmins'
import { PasswordPromptDialog } from '@/components/super-admin/PasswordPromptDialog'
import { toast } from 'sonner'

export function SuperAdminSettingsPanel({ embedded = false }: { embedded?: boolean }) {
  const { user, isLoading: authLoading, logout } = useAuth()
  const router = useRouter()
  const searchParams = useSearchParams()
  const rawTab = searchParams.get('tab') || 'profile'
  const initialTab = rawTab === 'profile' || rawTab === 'security' || rawTab === 'super-admins' ? rawTab : 'profile'
  const [activeTab, setActiveTab] = useState(initialTab)
  const updateProfile = useUpdateProfile()
  const changePassword = useChangePassword()
  const { data: superAdmins = [], isLoading: isSuperAdminsLoading } = useSuperAdmins(true)
  const createSuperAdmin = useCreateSuperAdmin()
  const deleteSuperAdmin = useDeleteSuperAdmin()
  const suspendSuperAdmin = useSuspendSuperAdmin()
  const unsuspendSuperAdmin = useUnsuspendSuperAdmin()

  // Profile form state
  const [profileData, setProfileData] = useState({
    full_name: '',
    phone: '',
  })

  // Password form state
  const [passwordData, setPasswordData] = useState({
    current_password: '',
    new_password: '',
    confirm_password: '',
  })
  const [showPasswords, setShowPasswords] = useState({
    current: false,
    new: false,
    confirm: false,
  })

  const [newSuperAdmin, setNewSuperAdmin] = useState({
    full_name: '',
    email: '',
    password: '',
    phone: '',
  })
  const [showNewAdminPassword, setShowNewAdminPassword] = useState(false)
  const [showCreatePasswordPrompt, setShowCreatePasswordPrompt] = useState(false)
  const [deleteConfirmation, setDeleteConfirmation] = useState<{ id: string; name: string } | null>(null)
  const [suspendConfirmation, setSuspendConfirmation] = useState<{ id: string; name: string; action: 'suspend' | 'unsuspend' } | null>(null)

  // Load user data into form
  useEffect(() => {
    if (user) {
      setProfileData({
        full_name: user.full_name || '',
        phone: user.phone || '',
      })
    }
  }, [user])

  useEffect(() => {
    setActiveTab(initialTab)
  }, [initialTab])

  // Redirect if not super admin
  useEffect(() => {
    if (!authLoading && user?.role !== 'super_admin') {
      router.push('/login')
    }
  }, [authLoading, user, router])

  const handleProfileUpdate = async (e: React.FormEvent) => {
    e.preventDefault()

    // Only send changed fields
    const updates: { full_name?: string; phone?: string } = {}
    if (profileData.full_name !== user?.full_name) updates.full_name = profileData.full_name
    if (profileData.phone !== user?.phone) updates.phone = profileData.phone

    if (Object.keys(updates).length === 0) {
      return // No changes
    }

    updateProfile.mutate(updates)
  }

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault()

    // Validate passwords match
    if (passwordData.new_password !== passwordData.confirm_password) {
      return
    }

    // Validate password strength
    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/
    if (!passwordRegex.test(passwordData.new_password)) {
      return
    }

    changePassword.mutate(
      {
        current_password: passwordData.current_password,
        new_password: passwordData.new_password,
      },
      {
        onSuccess: () => {
          setPasswordData({
            current_password: '',
            new_password: '',
            confirm_password: '',
          })
          // Log out after a short delay so the success toast is visible
          setTimeout(() => {
            logout()
          }, 1500)
        },
      }
    )
  }

  const handleCreateSuperAdmin = async (e: React.FormEvent) => {
    e.preventDefault()

    // Validate required fields
    if (!newSuperAdmin.full_name || !newSuperAdmin.email || !newSuperAdmin.password) {
      toast.error('All required fields must be filled')
      return
    }

    // Check if email already exists
    if (emailAlreadyExists) {
      toast.error('Email already exists')
      return
    }

    // Show password prompt for verification
    setShowCreatePasswordPrompt(true)
  }

  const handleCreateSuperAdminWithPassword = async (currentPassword: string) => {
    try {
      await createSuperAdmin.mutateAsync({
        full_name: newSuperAdmin.full_name,
        email: newSuperAdmin.email,
        password: newSuperAdmin.password,
        phone: newSuperAdmin.phone || undefined,
        current_password: currentPassword
      })

      toast.success('Super Admin Created', {
        description: `${newSuperAdmin.full_name} has been added as a super admin.`
      })

      setNewSuperAdmin({
        full_name: '',
        email: '',
        password: '',
        phone: '',
      })
      setShowNewAdminPassword(false)
      setShowCreatePasswordPrompt(false)
    } catch (error) {
      // Error handled by hook and PasswordPromptDialog
      throw error
    }
  }

  const handleDeleteSuperAdmin = (id: string, name: string) => {
    setDeleteConfirmation({ id, name })
  }

  const confirmDeleteSuperAdmin = async (password: string) => {
    if (!deleteConfirmation) return

    try {
      await deleteSuperAdmin.mutateAsync({
        id: deleteConfirmation.id,
        password
      })

      toast.success('Super Admin Deleted', {
        description: `${deleteConfirmation.name} has been removed from super admins.`
      })

      setDeleteConfirmation(null)
    } catch (error) {
      // Error handled by hook and PasswordPromptDialog
      throw error
    }
  }

  const handleSASuspendAction = (id: string, name: string, action: 'suspend' | 'unsuspend') => {
    setSuspendConfirmation({ id, name, action })
  }

  const confirmSASuspendAction = async (password: string) => {
    if (!suspendConfirmation) return

    try {
      if (suspendConfirmation.action === 'suspend') {
        await suspendSuperAdmin.mutateAsync({ id: suspendConfirmation.id, password })
        toast.success('Super Admin Suspended', {
          description: `${suspendConfirmation.name} has been suspended and cannot log in.`
        })
      } else {
        await unsuspendSuperAdmin.mutateAsync({ id: suspendConfirmation.id, password })
        toast.success('Suspension Removed', {
          description: `${suspendConfirmation.name} can now log in again.`
        })
      }
      setSuspendConfirmation(null)
    } catch (error) {
      throw error
    }
  }

  if (authLoading || !user) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  const passwordsMatch = passwordData.new_password === passwordData.confirm_password
  const isPasswordStrong = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/.test(
    passwordData.new_password
  )

  // Check if email already exists in super admins list
  const emailAlreadyExists = newSuperAdmin.email.trim() !== '' &&
    superAdmins.some(sa => sa.email.toLowerCase() === newSuperAdmin.email.toLowerCase())

  return (
    <div className={embedded ? "space-y-6" : "min-h-[100dvh] bg-background p-3 sm:p-4 md:p-6"}>
      <div className={embedded ? "space-y-6" : "max-w-4xl mx-auto space-y-6"}>
        {/* Header */}
        {!embedded && (
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => router.push('/super-admin')}
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-xl md:text-3xl font-bold text-slate-900 dark:text-white">Account Settings</h1>
              <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                Manage your profile and security settings
              </p>
            </div>
          </div>
        )}

        {/* Settings Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="flex w-full md:w-auto p-1 bg-muted/80 rounded-2xl border border-border/50 backdrop-blur-sm self-start max-w-xl mx-auto md:mx-0 overflow-x-auto">
            <TabsTrigger value="profile" className="flex-1 md:flex-none shrink-0 whitespace-nowrap rounded-xl data-[state=active]:bg-card data-[state=active]:shadow-sm data-[state=active]:text-indigo-600 dark:data-[state=active]:text-indigo-400 font-medium px-4 sm:px-6 py-2.5 transition-all">Profile</TabsTrigger>
            <TabsTrigger value="security" className="flex-1 md:flex-none shrink-0 whitespace-nowrap rounded-xl data-[state=active]:bg-card data-[state=active]:shadow-sm data-[state=active]:text-indigo-600 dark:data-[state=active]:text-indigo-400 font-medium px-4 sm:px-6 py-2.5 transition-all">Security</TabsTrigger>
            <TabsTrigger value="super-admins" className="flex-1 md:flex-none shrink-0 whitespace-nowrap rounded-xl data-[state=active]:bg-card data-[state=active]:shadow-sm data-[state=active]:text-indigo-600 dark:data-[state=active]:text-indigo-400 font-medium px-4 sm:px-6 py-2.5 transition-all">Super Admins</TabsTrigger>
          </TabsList>

          {/* Profile Tab */}
          <TabsContent value="profile" className="m-0 focus-visible:outline-none focus-visible:ring-0">
            <div className="bg-card/60 backdrop-blur-xl rounded-2xl border border-border/60 overflow-hidden shadow-sm">
              <div className="p-6 md:p-8 border-b border-border">
                <h2 className="text-xl font-bold flex items-center gap-2 text-slate-900 dark:text-white">
                  Profile Information
                </h2>
                <p className="text-slate-500 mt-1">Update your personal information and contact details.</p>
              </div>
              <form onSubmit={handleProfileUpdate}>
                <div className="p-6 md:p-8 space-y-6">
                  {/* Full Name */}
                  <div className="grid gap-2">
                    <Label htmlFor="full_name" className="text-slate-700 dark:text-slate-300 font-medium">Full Name <span className="text-rose-500">*</span></Label>
                    <Input
                      id="full_name"
                      type="text"
                      required
                      value={profileData.full_name}
                      onChange={(e) => setProfileData({ ...profileData, full_name: e.target.value })}
                      className="h-11 bg-muted/30 rounded-xl"
                    />
                  </div>

                  {/* Email & Phone */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="grid gap-2">
                      <Label htmlFor="email" className="text-slate-700 dark:text-slate-300 font-medium">Email Address</Label>
                      <Input id="email" type="email" value={user.email} disabled className="h-11 bg-muted/50 text-muted-foreground rounded-xl border-dashed" />
                      <p className="text-xs text-slate-500">Email cannot be changed directly.</p>
                    </div>

                    <div className="grid gap-2">
                      <Label htmlFor="phone" className="text-slate-700 dark:text-slate-300 font-medium">Phone Number</Label>
                      <Input
                        id="phone"
                        type="tel"
                        inputMode="numeric"
                        maxLength={10}
                        placeholder="10-digit mobile number"
                        value={profileData.phone}
                        onChange={(e) => setProfileData({ ...profileData, phone: e.target.value.replace(/\D/g, '').slice(0, 10) })}
                        className="h-11 bg-muted/30 rounded-xl"
                      />
                    </div>
                  </div>
                </div>
                <div className="p-6 md:px-8 border-t border-border bg-muted/20 flex justify-end">
                  <Button type="submit" disabled={updateProfile.isPending || (profileData.full_name === user.full_name && profileData.phone === user.phone)} className="bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white shadow-md shadow-indigo-500/20 rounded-xl px-8 h-11 transition-all">
                    {updateProfile.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : "Save Changes"}
                  </Button>
                </div>
              </form>
            </div>
          </TabsContent>

          {/* Security Tab */}
          <TabsContent value="security" className="m-0 focus-visible:outline-none focus-visible:ring-0">
            <div className="bg-card/60 backdrop-blur-xl rounded-2xl border border-border/60 overflow-hidden shadow-sm">
              <div className="p-6 md:p-8 border-b border-border">
                <h2 className="text-xl font-bold flex items-center gap-2 text-slate-900 dark:text-white">
                  Change Password
                </h2>
                <p className="text-slate-500 mt-1">Update your password to keep your account secure.</p>
              </div>
              <form onSubmit={handlePasswordChange}>
                <div className="p-6 md:p-8 space-y-6">
                  {/* Current Password */}
                  <div className="grid gap-2">
                    <Label htmlFor="current_password" className="text-slate-700 dark:text-slate-300 font-medium">Current Password <span className="text-rose-500">*</span></Label>
                    <div className="relative">
                      <Input
                        id="current_password"
                        type={showPasswords.current ? 'text' : 'password'}
                        required
                        minLength={8}
                        value={passwordData.current_password}
                        onChange={(e) =>
                          setPasswordData({ ...passwordData, current_password: e.target.value })
                        }
                        className="h-11 bg-muted/30 rounded-xl"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setShowPasswords({ ...showPasswords, current: !showPasswords.current })
                        }
                        className="absolute right-3 top-1/2 -translate-y-1/2 p-1 hover:bg-muted rounded-md transition-colors"
                        aria-label={showPasswords.current ? "Hide password" : "Show password"}
                      >
                        {showPasswords.current ? <EyeOff className="h-4 w-4 text-slate-400" /> : <Eye className="h-4 w-4 text-slate-400" />}
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* New Password */}
                    <div className="grid gap-2">
                      <Label htmlFor="new_password" className="text-slate-700 dark:text-slate-300 font-medium">New Password <span className="text-rose-500">*</span></Label>
                      <div className="relative">
                        <Input
                          id="new_password"
                          type={showPasswords.new ? 'text' : 'password'}
                          required
                          minLength={8}
                          value={passwordData.new_password}
                          onChange={(e) =>
                            setPasswordData({ ...passwordData, new_password: e.target.value })
                          }
                          className="h-11 bg-muted/30 rounded-xl"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPasswords({ ...showPasswords, new: !showPasswords.new })}
                          className="absolute right-3 top-1/2 -translate-y-1/2 p-1 hover:bg-muted rounded-md transition-colors"
                          aria-label={showPasswords.new ? "Hide password" : "Show password"}
                        >
                          {showPasswords.new ? <EyeOff className="h-4 w-4 text-slate-400" /> : <Eye className="h-4 w-4 text-slate-400" />}
                        </button>
                      </div>
                      {passwordData.new_password && !isPasswordStrong && (
                        <p className="text-xs text-rose-500 mt-1 font-medium">
                          Password must be 8+ chars with uppercase, lowercase, and a number
                        </p>
                      )}
                    </div>

                    {/* Confirm Password */}
                    <div className="grid gap-2">
                      <Label htmlFor="confirm_password" className="text-slate-700 dark:text-slate-300 font-medium">Confirm New Password <span className="text-rose-500">*</span></Label>
                      <div className="relative">
                        <Input
                          id="confirm_password"
                          type={showPasswords.confirm ? 'text' : 'password'}
                          required
                          minLength={8}
                          value={passwordData.confirm_password}
                          onChange={(e) =>
                            setPasswordData({ ...passwordData, confirm_password: e.target.value })
                          }
                          className="h-11 bg-muted/30 rounded-xl"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            setShowPasswords({ ...showPasswords, confirm: !showPasswords.confirm })
                          }
                          className="absolute right-3 top-1/2 -translate-y-1/2 p-1 hover:bg-muted rounded-md transition-colors"
                          aria-label={showPasswords.confirm ? "Hide password" : "Show password"}
                        >
                          {showPasswords.confirm ? <EyeOff className="h-4 w-4 text-slate-400" /> : <Eye className="h-4 w-4 text-slate-400" />}
                        </button>
                      </div>
                      {passwordData.confirm_password && !passwordsMatch && (
                        <p className="text-xs text-rose-500 mt-1 font-medium">Passwords do not match</p>
                      )}
                    </div>
                  </div>
                </div>
                <div className="p-6 md:px-8 border-t border-border bg-muted/20 flex justify-end">
                  <Button
                    type="submit"
                    className="bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl px-8 h-11 transition-all"
                    disabled={
                      changePassword.isPending ||
                      !passwordsMatch ||
                      !isPasswordStrong ||
                      !passwordData.current_password
                    }
                  >
                    {changePassword.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Update Password
                  </Button>
                </div>
              </form>
            </div>
          </TabsContent>

          {/* Super Admins Tab */}
          <TabsContent value="super-admins" className="m-0 focus-visible:outline-none focus-visible:ring-0">
            <div className="bg-card/60 backdrop-blur-xl rounded-2xl border border-border/60 overflow-hidden shadow-sm">
              <div className="p-6 md:p-8 border-b border-border flex flex-col xl:flex-row xl:items-center justify-between gap-4">
                <div>
                  <h2 className="text-xl font-bold flex items-center gap-2 text-slate-900 dark:text-white">
                    Super Admin Management
                  </h2>
                  <p className="text-slate-500 mt-1">Create and remove global super administrators.</p>
                </div>
              </div>

              <div className="p-6 md:p-8 space-y-8">
                {/* Create Form */}
                <div className="bg-muted/30 rounded-2xl border border-border p-6">
                  <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
                    <Plus className="h-5 w-5 text-indigo-500" /> Add New Super Admin
                  </h3>
                  <form onSubmit={handleCreateSuperAdmin} className="space-y-6">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                      <div className="grid gap-2">
                        <Label htmlFor="sa_full_name" className="text-slate-700 dark:text-slate-300 font-medium">Full Name <span className="text-rose-500">*</span></Label>
                        <Input
                          id="sa_full_name"
                          type="text"
                          required
                          value={newSuperAdmin.full_name}
                          onChange={(e) => setNewSuperAdmin({ ...newSuperAdmin, full_name: e.target.value })}
                          className="h-11 bg-background rounded-xl"
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="sa_email" className="text-slate-700 dark:text-slate-300 font-medium">Email <span className="text-rose-500">*</span></Label>
                        <Input
                          id="sa_email"
                          type="email"
                          required
                          value={newSuperAdmin.email}
                          onChange={(e) => setNewSuperAdmin({ ...newSuperAdmin, email: e.target.value })}
                          className={`h-11 bg-background rounded-xl ${emailAlreadyExists ? 'border-rose-500 focus-visible:ring-rose-500' : ''}`}
                        />
                        {emailAlreadyExists && (
                          <p className="text-xs text-rose-500 font-medium mt-1">
                            ⚠️ This email is already registered as a super admin
                          </p>
                        )}
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="sa_password" className="text-slate-700 dark:text-slate-300 font-medium">Password <span className="text-rose-500">*</span></Label>
                        <div className="relative">
                          <Input
                            id="sa_password"
                            type={showNewAdminPassword ? 'text' : 'password'}
                            required
                            minLength={8}
                            value={newSuperAdmin.password}
                            onChange={(e) => setNewSuperAdmin({ ...newSuperAdmin, password: e.target.value })}
                            className="h-11 bg-background rounded-xl"
                          />
                          <button
                            type="button"
                            onClick={() => setShowNewAdminPassword(!showNewAdminPassword)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 p-1 hover:bg-muted rounded-md transition-colors"
                            aria-label={showNewAdminPassword ? "Hide password" : "Show password"}
                          >
                            {showNewAdminPassword ? <EyeOff className="h-4 w-4 text-slate-400" /> : <Eye className="h-4 w-4 text-slate-400" />}
                          </button>
                        </div>
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="sa_phone" className="text-slate-700 dark:text-slate-300 font-medium">Phone</Label>
                        <Input
                          id="sa_phone"
                          type="tel"
                          inputMode="numeric"
                          maxLength={10}
                          placeholder="10-digit mobile number"
                          value={newSuperAdmin.phone}
                          onChange={(e) => setNewSuperAdmin({ ...newSuperAdmin, phone: e.target.value.replace(/\D/g, '').slice(0, 10) })}
                          className="h-11 bg-background rounded-xl"
                        />
                      </div>
                    </div>
                    <div className="flex justify-end">
                      <Button
                        type="submit"
                        disabled={createSuperAdmin.isPending || emailAlreadyExists}
                        className="bg-indigo-600 hover:bg-indigo-700 text-white shadow-md shadow-indigo-500/20 rounded-xl px-6 h-11 transition-all"
                      >
                        {createSuperAdmin.isPending ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <Plus className="mr-2 h-4 w-4" />
                        )}
                        Invite Super Admin
                      </Button>
                    </div>
                  </form>
                </div>

                {/* Existing Super Admins */}
                <div className="space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 dark:border-slate-800 pb-3">
                    <h3 className="text-lg font-semibold text-slate-900 dark:text-white flex items-center gap-3">
                      <div className="h-8 w-8 rounded-lg bg-indigo-50 dark:bg-indigo-500/10 flex items-center justify-center text-indigo-600 dark:text-indigo-400 border border-indigo-100 dark:border-indigo-500/20">
                        <span className="font-bold text-sm">{superAdmins.length}</span>
                      </div>
                      Active Administrators
                    </h3>
                  </div>

                  {isSuperAdminsLoading ? (
                    <div className="flex items-center justify-center py-12 text-slate-500 font-medium gap-2">
                      <Loader2 className="h-5 w-5 animate-spin text-indigo-500" />
                      Loading administrators...
                    </div>
                  ) : superAdmins.length === 0 ? (
                    <div className="text-center py-12 bg-muted/30 rounded-2xl border border-dashed border-border">
                      <p className="text-slate-500 font-medium">No other super admins found.</p>
                    </div>
                  ) : (
                    <div className="grid gap-3 pt-2">
                      {superAdmins.map((sa) => (
                        <div key={sa.id} className="group flex items-center justify-between p-4 bg-card hover:bg-muted/20 rounded-xl border border-border/60 transition-all shadow-sm hover:shadow-md">
                          <div className="flex items-center gap-4 min-w-0">
                            <Avatar className="h-12 w-12 border-2 border-white dark:border-slate-800 shadow-sm shrink-0">
                              <AvatarImage src={sa.profile_picture_url || undefined} alt={sa.full_name} />
                              <AvatarFallback className="bg-gradient-to-br from-indigo-500 to-violet-500 text-white font-medium text-sm">
                                {getInitials(sa.full_name)}
                              </AvatarFallback>
                            </Avatar>
                            <div className="min-w-0">
                              <p className="text-sm font-bold text-slate-900 dark:text-white flex flex-wrap items-center gap-2">
                                <span className="truncate">{sa.full_name}</span>
                                {sa.id === user.id && (
                                  <span className="px-2 py-0.5 rounded-md bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 text-[10px] font-bold uppercase tracking-wider shrink-0">You</span>
                                )}
                                {sa.is_suspended && (
                                  <span className="px-2 py-0.5 rounded-md bg-orange-100 dark:bg-orange-500/20 text-orange-700 dark:text-orange-400 text-[10px] font-bold uppercase tracking-wider shrink-0">Suspended</span>
                                )}
                              </p>
                              <p className="text-xs text-slate-500 mt-0.5 truncate">{sa.email}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-1 shrink-0 ml-2">
                            <Button
                              variant="ghost"
                              size="icon"
                              disabled={sa.id === user.id || suspendSuperAdmin.isPending || unsuspendSuperAdmin.isPending}
                              onClick={() => handleSASuspendAction(sa.id, sa.full_name, sa.is_suspended ? 'unsuspend' : 'suspend')}
                              className={`h-9 w-9 opacity-40 group-hover:opacity-100 transition-all disabled:opacity-30 disabled:hover:bg-transparent ${
                                sa.is_suspended
                                  ? 'text-orange-400 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/40'
                                  : 'text-slate-400 hover:text-orange-600 hover:bg-orange-50 dark:hover:bg-orange-900/40'
                              }`}
                              title={sa.id === user.id ? 'Cannot suspend yourself' : sa.is_suspended ? 'Remove Suspension' : 'Suspend Admin'}
                            >
                              {sa.is_suspended ? <Unlock className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              disabled={sa.id === user.id || deleteSuperAdmin.isPending}
                              onClick={() => handleDeleteSuperAdmin(sa.id, sa.full_name)}
                              className="h-9 w-9 text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/40 opacity-40 group-hover:opacity-100 transition-all disabled:opacity-30 disabled:hover:bg-transparent"
                              title={sa.id === user.id ? "Cannot delete yourself" : "Delete Admin"}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {/* Password Prompt for Create Super Admin */}
      <PasswordPromptDialog
        open={showCreatePasswordPrompt}
        onOpenChange={setShowCreatePasswordPrompt}
        onConfirm={handleCreateSuperAdminWithPassword}
        title="Verify Your Password"
        description={`Enter your password to create a new super admin account for "${newSuperAdmin.full_name}".`}
        actionLabel="Create Super Admin"
        actionVariant="default"
      />

      {/* Password Prompt for Delete Super Admin */}
      <PasswordPromptDialog
        open={!!deleteConfirmation}
        onOpenChange={(open) => !open && setDeleteConfirmation(null)}
        onConfirm={confirmDeleteSuperAdmin}
        title={`Delete Super Admin: ${deleteConfirmation?.name}`}
        description="Enter your password to remove this super admin account."
        actionLabel="Delete Super Admin"
        actionVariant="destructive"
        warningMessage="⚠️ This will permanently remove the super admin's access. They will no longer be able to manage schools or other super admins."
      />

      {/* Password Prompt for Suspend / Unsuspend Super Admin */}
      <PasswordPromptDialog
        open={!!suspendConfirmation}
        onOpenChange={(open) => !open && setSuspendConfirmation(null)}
        onConfirm={confirmSASuspendAction}
        title={suspendConfirmation?.action === 'suspend' ? `Suspend Super Admin: ${suspendConfirmation?.name}` : `Remove Suspension: ${suspendConfirmation?.name}`}
        description={
          suspendConfirmation?.action === 'suspend'
            ? `Enter your password to suspend ${suspendConfirmation?.name}. They will be unable to log in until the suspension is removed.`
            : `Enter your password to remove the suspension from ${suspendConfirmation?.name}. They will be able to log in again.`
        }
        actionLabel={suspendConfirmation?.action === 'suspend' ? 'Suspend' : 'Remove Suspension'}
        actionVariant={suspendConfirmation?.action === 'suspend' ? 'destructive' : 'default'}
        warningMessage={suspendConfirmation?.action === 'suspend' ? '⚠️ The suspended admin will see "invalid credentials" when attempting to log in.' : undefined}
      />
    </div>
  )
}

export default function SuperAdminSettingsPage() {
  const router = useRouter()
  useEffect(() => {
    router.replace('/super-admin?tab=settings')
  }, [router])
  return null
}

