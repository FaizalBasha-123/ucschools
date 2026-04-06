"use client"

import { Suspense } from "react"
import { useSearchParams } from "next/navigation"
import { Card, CardContent } from "@/components/ui/card"
import { CheckCircle2, GraduationCap, Phone } from "lucide-react"

function SuccessContent() {
  const searchParams = useSearchParams()
  const applicationId = searchParams.get("id")
  const studentName = searchParams.get("name") || "Student"

  return (
    <div
      className="min-h-screen bg-gradient-to-br from-green-50 via-white to-emerald-50 flex items-center justify-center p-4"
      style={{
        ["--background" as string]: "0 0% 100%",
        ["--foreground" as string]: "220 9% 13%",
        ["--card" as string]: "0 0% 100%",
        ["--card-foreground" as string]: "220 9% 13%",
        ["--popover" as string]: "0 0% 100%",
        ["--popover-foreground" as string]: "220 9% 13%",
        ["--primary" as string]: "221 83% 53%",
        ["--primary-foreground" as string]: "0 0% 100%",
        ["--secondary" as string]: "220 14% 97%",
        ["--secondary-foreground" as string]: "220 9% 13%",
        ["--muted" as string]: "220 14% 97%",
        ["--muted-foreground" as string]: "220 5% 44%",
        ["--accent" as string]: "220 14% 97%",
        ["--accent-foreground" as string]: "220 9% 13%",
        ["--border" as string]: "220 13% 90%",
        ["--input" as string]: "220 13% 90%",
        ["--ring" as string]: "220 12% 62%",
        colorScheme: "light",
      }}
    >
      <div className="max-w-md w-full space-y-6">
        <div className="text-center space-y-3">
          <div className="bg-white rounded-full w-20 h-20 mx-auto flex items-center justify-center shadow-lg">
            <CheckCircle2 className="h-12 w-12 text-green-500" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Application Submitted!</h1>
            <p className="text-gray-500 mt-1">Your admission form has been received.</p>
          </div>
        </div>

        <Card className="shadow-md">
          <CardContent className="pt-6 pb-6 space-y-4">
            <div className="bg-green-50 rounded-lg p-4 space-y-2">
              <div className="flex items-center gap-2">
                <GraduationCap className="h-4 w-4 text-green-700 shrink-0" />
                <span className="text-sm font-semibold text-green-800">Student Name</span>
              </div>
              <p className="text-gray-800 font-medium pl-6">{decodeURIComponent(studentName)}</p>
            </div>

            {applicationId && (
              <div className="bg-gray-50 rounded-lg p-4 space-y-1">
                <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">Application Reference ID</p>
                <p className="font-mono text-sm text-gray-800 break-all">{applicationId}</p>
                <p className="text-xs text-gray-400">Save this for your records</p>
              </div>
            )}

            <div className="space-y-2 text-sm text-gray-600">
              <div className="flex gap-2">
                <Phone className="h-4 w-4 shrink-0 mt-0.5 text-gray-400" />
                <p>The school will contact you on the phone number provided in the application.</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="text-center">
          <p className="text-sm text-gray-500">
            You will be notified about your application status. Please keep your reference ID handy.
          </p>
        </div>
      </div>
    </div>
  )
}

export default function AdmissionSuccessPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center text-gray-500">Loading…</div>
      </div>
    }>
      <SuccessContent />
    </Suspense>
  )
}
