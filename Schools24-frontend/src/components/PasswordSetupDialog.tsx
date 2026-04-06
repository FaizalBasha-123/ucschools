"use client"

import { useEffect, useState } from "react"
import { useAuth } from "@/contexts/AuthContext"
import { PASSWORD_SETUP_LOGIN_MARKER } from "@/contexts/AuthContext"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Eye, EyeOff, KeyRound, Loader2 } from "lucide-react"
import { api } from "@/lib/api"
import { toast } from "sonner"

const SESSION_KEY = "schools24_pwd_setup_shown"

/**
 * Shown to students for their first 4 logins after account creation,
 * prompting them to set a personal password.
 *
 * Uses session storage so it surfaces once per browser session (not on every
 * page navigation).  The backend `login_count` is the authoritative check —
 * the dialog is only rendered when login_count <= 4.
 */
export default function PasswordSetupDialog() {
  const { user, updateUser } = useAuth()
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (typeof window === "undefined" || !user) {
      setOpen(false)
      return
    }

    const markerValue = sessionStorage.getItem(PASSWORD_SETUP_LOGIN_MARKER)
    if (!markerValue || sessionStorage.getItem(SESSION_KEY)) {
      setOpen(false)
      return
    }

    let marker: { user_id?: string; login_count?: number | null } | null = null
    try {
      marker = JSON.parse(markerValue)
    } catch {
      sessionStorage.removeItem(PASSWORD_SETUP_LOGIN_MARKER)
      setOpen(false)
      return
    }

    const shouldShow =
      user.role === "student" &&
      marker?.user_id === user.id &&
      typeof user.login_count === "number" &&
      user.login_count <= 4 &&
      marker?.login_count === user.login_count

    setOpen(shouldShow)
  }, [user])

  // How many more times this reminder will appear AFTER the current login.
  // login_count=1 → 3 more, login_count=4 → 0 more (last time).
  const remindersLeft = Math.max(0, 4 - (user?.login_count ?? 1))
  const [currentPassword, setCurrentPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [showCurrent, setShowCurrent] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleDismiss = () => {
    sessionStorage.setItem(SESSION_KEY, "1")
    sessionStorage.removeItem(PASSWORD_SETUP_LOGIN_MARKER)
    setOpen(false)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (newPassword.length < 8) {
      setError("New password must be at least 8 characters.")
      return
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.")
      return
    }

    setSubmitting(true)
    try {
      await api.put("/auth/change-password", {
        current_password: currentPassword,
        new_password: newPassword,
      })
      // Bump login_count locally so the dialog doesn't reappear this session
      if (user) {
        updateUser({ login_count: (user.login_count ?? 0) + 10 }) // push past threshold
      }
      toast.success("Password updated successfully!")
      sessionStorage.setItem(SESSION_KEY, "1")
      sessionStorage.removeItem(PASSWORD_SETUP_LOGIN_MARKER)
      setOpen(false)
    } catch (err: any) {
      setError(err?.message || "Failed to change password. Please check your current password.")
    } finally {
      setSubmitting(false)
    }
  }

  if (!open) return null

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent
        className="sm:max-w-md [&>button:last-child]:hidden"
        // Prevent closing by clicking outside or pressing Escape — use explicit buttons
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        {/* Reminder counter — replaces the default X close button */}
        <div className="absolute right-4 top-4 flex items-center gap-1.5 rounded-full bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700 px-2.5 py-1 text-[11px] font-semibold text-amber-700 dark:text-amber-400 select-none">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
          {remindersLeft === 0
            ? "Last reminder"
            : `${remindersLeft} more reminder${remindersLeft === 1 ? "" : "s"}`}
        </div>
        <DialogHeader>
          <div className="flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-primary" />
            <DialogTitle>Set Up Your Password</DialogTitle>
          </div>
          <DialogDescription>
            Your account was created with a default password. Please set a new
            personal password to keep your account secure. You can also skip
            this for now.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div className="space-y-1.5">
            <Label htmlFor="current-pwd">Current Password</Label>
            <div className="relative">
              <Input
                id="current-pwd"
                type={showCurrent ? "text" : "password"}
                placeholder="Enter current password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowCurrent((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                tabIndex={-1}
              >
                {showCurrent ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="new-pwd">New Password</Label>
            <div className="relative">
              <Input
                id="new-pwd"
                type={showNew ? "text" : "password"}
                placeholder="At least 8 characters"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowNew((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                tabIndex={-1}
              >
                {showNew ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="confirm-pwd">Confirm New Password</Label>
            <Input
              id="confirm-pwd"
              type="password"
              placeholder="Repeat new password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
            />
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
              {error}
            </p>
          )}

          <div className="flex justify-between pt-1">
            <Button
              type="button"
              variant="ghost"
              onClick={handleDismiss}
              disabled={submitting}
              className="text-muted-foreground"
            >
              Skip for now
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving…
                </>
              ) : (
                "Update Password"
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
