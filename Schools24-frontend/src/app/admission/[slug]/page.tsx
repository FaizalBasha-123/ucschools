"use client"

import React, { useState, useRef } from "react"
import { useParams, useRouter } from "next/navigation"
import { useQuery } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import {
  Upload, CheckCircle2, XCircle, AlertCircle, Loader2,
  FileText, Image, ArrowRight, ArrowLeft, Phone, Mail, Globe
} from "lucide-react"

// ─── Types ────────────────────────────────────────────────────────────────────

interface SchoolAdmissionInfo {
  school_id: string
  school_name: string
  admissions_open: boolean
  admission_academic_year?: string
  phone?: string
  email?: string
  website?: string
}

const DOCUMENT_TYPES = [
  { key: "birth_certificate", label: "Birth Certificate" },
  { key: "aadhaar_card", label: "Aadhaar Card" },
  { key: "transfer_certificate", label: "Transfer Certificate" },
  { key: "caste_certificate", label: "Caste Certificate" },
  { key: "income_certificate", label: "Income Certificate" },
  { key: "passport_photo", label: "Passport Photo" },
] as const

type DocumentKey = typeof DOCUMENT_TYPES[number]["key"]

type Step = 1 | 2 | 3 | 4
const PUBLIC_API_BASE = (process.env.NEXT_PUBLIC_PUBLIC_API_BASE || "/api/public").replace(/\/+$/, "")

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AdmissionPage() {
  const { slug } = useParams<{ slug: string }>()
  const router = useRouter()
  const searchSuffix = typeof window !== "undefined" ? window.location.search : ""

  // ── School info query
  const { data: school, isLoading, error } = useQuery<SchoolAdmissionInfo>({
    queryKey: ["public-admission", slug, searchSuffix],
    queryFn: async () => {
      const res = await fetch(`${PUBLIC_API_BASE}/admission/${encodeURIComponent(slug)}${searchSuffix}`)
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || "Failed to load school information")
      }
      return res.json()
    },
    retry: 1,
  })

  const [step, setStep] = useState<Step>(1)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  // ── Form state
  const [form, setForm] = useState({
    // Required
    student_name: "",
    date_of_birth: "",
    mother_phone: "",
    // Login email — used when the student account is created upon approval
    email: "",
    // Personal
    gender: "",
    religion: "",
    caste_category: "",
    nationality: "Indian",
    mother_tongue: "",
    blood_group: "",
    aadhaar_number: "",
    applying_for_class: "",
    // Previous school
    previous_school_name: "",
    previous_class: "",
    previous_school_address: "",
    tc_number: "",
    // Parents
    father_name: "",
    father_phone: "",
    father_occupation: "",
    mother_name: "",
    mother_occupation: "",
    guardian_name: "",
    guardian_phone: "",
    guardian_relation: "",
    // Address
    address_line1: "",
    address_line2: "",
    city: "",
    state: "",
    pincode: "",
  })

  // ── Documents state
  const [documents, setDocuments] = useState<Record<DocumentKey, File | null>>({
    birth_certificate: null,
    aadhaar_card: null,
    transfer_certificate: null,
    caste_certificate: null,
    income_certificate: null,
    passport_photo: null,
  })

  const fileRefs = useRef<Record<DocumentKey, HTMLInputElement | null>>({
    birth_certificate: null,
    aadhaar_card: null,
    transfer_certificate: null,
    caste_certificate: null,
    income_certificate: null,
    passport_photo: null,
  })

  const set = (field: keyof typeof form, value: string) =>
    setForm((f) => ({ ...f, [field]: value }))

  /** Phone fields: digits only, max 10 characters */
  const setPhone = (field: keyof typeof form, value: string) =>
    set(field, value.replace(/\D/g, "").slice(0, 10))

  // ── Step validation
  // Only the starred fields on step 1 are student_name and date_of_birth.
  // mother_phone lives on step 2 and is validated there.
  const step1Valid =
    form.student_name.trim() !== "" &&
    form.date_of_birth !== "" &&
    form.email.trim() !== "" &&
    /\S+@\S+\.\S+/.test(form.email.trim())

  const handleDocumentChange = (key: DocumentKey, file: File | null) => {
    if (file) {
      if (file.size > 5 * 1024 * 1024) {
        alert(`${file.name} is too large. Max 5MB per document.`)
        return
      }
      const allowed = ["image/jpeg", "image/png", "application/pdf"]
      if (!allowed.includes(file.type)) {
        alert(`${file.name}: only JPEG, PNG, or PDF files are allowed.`)
        return
      }
    }
    setDocuments((d) => ({ ...d, [key]: file }))
  }

  // ── Submit
  const handleSubmit = async () => {
    setSubmitting(true)
    setSubmitError(null)
    try {
      const fd = new FormData()
      // Form fields
      Object.entries(form).forEach(([k, v]) => {
        if (v.trim() !== "") fd.append(k, v)
      })
      // Academic year from school global settings (not a user-editable form field)
      if (school?.admission_academic_year) {
        fd.append("academic_year", school.admission_academic_year)
      }
      // Document files
      DOCUMENT_TYPES.forEach(({ key }) => {
        const file = documents[key]
        if (file) fd.append(key, file)
      })

      const res = await fetch(`${PUBLIC_API_BASE}/admission/${encodeURIComponent(slug)}${searchSuffix}`, {
        method: "POST",
        body: fd,
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        if (err.error === "admissions_closed") {
          setSubmitError("This school is no longer accepting admissions.")
        } else {
          setSubmitError(err.error || "Submission failed. Please try again.")
        }
        return
      }
      const data = await res.json()
      // Navigate to success page with application ID
      router.push(`/admission/${slug}/success?id=${data.application_id}&name=${encodeURIComponent(data.student_name)}`)
    } catch {
      setSubmitError("Network error. Please check your connection and try again.")
    } finally {
      setSubmitting(false)
    }
  }

  // ─── Loading / Error States ────────────────────────────────────────────────

  const lightStyle: React.CSSProperties = {
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
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="text-center space-y-3">
          <Loader2 className="h-10 w-10 animate-spin text-blue-600 mx-auto" />
          <p className="text-gray-600 font-medium">Loading admission form…</p>
        </div>
      </div>
    )
  }

  if (error || !school) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white p-4" style={lightStyle}>
        <Card className="max-w-md w-full">
          <CardContent className="pt-8 pb-6 text-center space-y-4">
            <XCircle className="h-14 w-14 text-red-400 mx-auto" />
            <div>
              <h2 className="text-xl font-bold text-gray-800">School Not Found</h2>
              <p className="text-gray-500 mt-1">
                The admission link you followed may be incorrect or expired.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!school.admissions_open) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white p-4" style={lightStyle}>
        <Card className="max-w-md w-full shadow-md">
          <CardContent className="pt-8 pb-8 text-center space-y-5">
            {/* Icon */}
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-amber-50 border-2 border-amber-100">
              <AlertCircle className="h-8 w-8 text-amber-500" />
            </div>

            {/* School name */}
            <div>
              <h2 className="text-xl font-bold text-gray-900">{school.school_name}</h2>
              {school.admission_academic_year && (
                <p className="text-xs text-gray-400 mt-1">Academic Year {school.admission_academic_year}</p>
              )}
            </div>

            {/* Closed message */}
            <div className="rounded-xl bg-amber-50 border border-amber-100 px-4 py-3">
              <p className="text-sm font-semibold text-amber-800">Admissions are currently closed</p>
              <p className="text-xs text-amber-600 mt-1">Online applications are not being accepted at this time.</p>
            </div>

            {/* Contact info */}
            <div className="text-left space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Contact the school</p>
              {school.phone ? (
                <a
                  href={`tel:${school.phone}`}
                  className="flex items-center gap-3 rounded-lg border px-4 py-2.5 hover:bg-gray-50 transition-colors"
                >
                  <Phone className="h-4 w-4 text-blue-500 shrink-0" />
                  <span className="text-sm text-gray-700">{school.phone}</span>
                </a>
              ) : (
                <div className="flex items-center gap-3 rounded-lg border px-4 py-2.5 text-gray-400">
                  <Phone className="h-4 w-4 shrink-0" />
                  <span className="text-sm">Phone not available</span>
                </div>
              )}
              {school.email ? (
                <a
                  href={`mailto:${school.email}`}
                  className="flex items-center gap-3 rounded-lg border px-4 py-2.5 hover:bg-gray-50 transition-colors"
                >
                  <Mail className="h-4 w-4 text-blue-500 shrink-0" />
                  <span className="text-sm text-gray-700">{school.email}</span>
                </a>
              ) : (
                <div className="flex items-center gap-3 rounded-lg border px-4 py-2.5 text-gray-400">
                  <Mail className="h-4 w-4 shrink-0" />
                  <span className="text-sm">Email not available</span>
                </div>
              )}
              {school.website && (
                <a
                  href={school.website.startsWith("http") ? school.website : `https://${school.website}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-3 rounded-lg border px-4 py-2.5 hover:bg-gray-50 transition-colors"
                >
                  <Globe className="h-4 w-4 text-blue-500 shrink-0" />
                  <span className="text-sm text-gray-700">{school.website}</span>
                </a>
              )}
            </div>

            <p className="text-xs text-gray-400">
              Please contact the school directly to enquire about upcoming admissions.
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  // ─── Step Indicators ───────────────────────────────────────────────────────

  const steps = [
    { n: 1, label: "Student Details" },
    { n: 2, label: "Family & Address" },
    { n: 3, label: "Previous School" },
    { n: 4, label: "Documents" },
  ]

  return (
    <div
      className="min-h-screen bg-white text-[hsl(220,9%,13%)]"
      style={{
        ...lightStyle,
      }}
    >
      {/* Header */}
      <div className="bg-white border-b shadow-sm">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-bold text-gray-900">{school.school_name}</h1>
            <p className="text-sm text-gray-500">
              Online Admission Form
              {school.admission_academic_year && ` \u2014 ${school.admission_academic_year}`}
            </p>
          </div>
          {/* Powered by Schools24 — styled like Stripe’s payment attribution */}
          <a
            href="https://schools24.in"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 rounded-md border border-gray-200 bg-gray-50 px-2.5 py-1.5 hover:bg-gray-100 transition-colors shrink-0"
          >
            <span className="text-[10px] text-gray-400 font-medium leading-none">powered by</span>
            <span className="text-[12px] font-bold text-gray-800 leading-none tracking-tight">Schools24</span>
          </a>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        {/* Step bar */}
        <div className="flex items-center gap-1 overflow-x-auto">
          {steps.map(({ n, label }) => (
            <div key={n} className="flex items-center gap-1 flex-1 min-w-0">
              <div className="flex items-center gap-2 shrink-0">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors
                  ${step === n ? "bg-gray-900 text-white" : step > n ? "bg-green-500 text-white" : "bg-gray-200 text-gray-500"}`}>
                  {step > n ? <CheckCircle2 className="h-4 w-4" /> : n}
                </div>
                <span className={`text-xs font-medium hidden sm:inline ${step === n ? "text-gray-900" : "text-gray-400"}`}>{label}</span>
              </div>
              {n < 4 && <div className={`flex-1 h-0.5 mx-1 ${step > n ? "bg-green-500" : "bg-gray-200"}`} />}
            </div>
          ))}
        </div>

        {/* Form card */}
        <Card className="shadow-md">
          {/* ── Step 1: Student Details ─────────────────────────────────── */}
          {step === 1 && (
            <>
              <CardHeader>
                <CardTitle>Student Details</CardTitle>
                <CardDescription>Fields marked * are required</CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="md:col-span-2 space-y-1.5">
                    <Label>Student Full Name *</Label>
                    <Input placeholder="As in birth certificate" value={form.student_name}
                      onChange={(e) => set("student_name", e.target.value)} />
                  </div>
                  <div className="md:col-span-2 space-y-1.5">
                    <Label>Email Address * <span className="text-gray-400 font-normal text-xs">(used for login after admission)</span></Label>
                    <Input
                      type="email"
                      placeholder="student@example.com"
                      value={form.email}
                      onChange={(e) => set("email", e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Date of Birth *</Label>
                    <Input type="date" value={form.date_of_birth}
                      onChange={(e) => set("date_of_birth", e.target.value)}
                      max={new Date().toISOString().split("T")[0]} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Gender</Label>
                    <Select value={form.gender} onValueChange={(v) => set("gender", v)}>
                      <SelectTrigger><SelectValue placeholder="Select gender" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="male">Male</SelectItem>
                        <SelectItem value="female">Female</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Blood Group</Label>
                    <Select value={form.blood_group} onValueChange={(v) => set("blood_group", v)}>
                      <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                      <SelectContent>
                        {["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"].map(bg => (
                          <SelectItem key={bg} value={bg}>{bg}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Nationality</Label>
                    <Input value={form.nationality} onChange={(e) => set("nationality", e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Mother Tongue</Label>
                    <Input placeholder="e.g. Tamil, Hindi" value={form.mother_tongue}
                      onChange={(e) => set("mother_tongue", e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Religion</Label>
                    <Input placeholder="e.g. Hindu, Christian" value={form.religion}
                      onChange={(e) => set("religion", e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Caste Category</Label>
                    <Select value={form.caste_category} onValueChange={(v) => set("caste_category", v)}>
                      <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="general">General</SelectItem>
                        <SelectItem value="obc">OBC</SelectItem>
                        <SelectItem value="sc">SC</SelectItem>
                        <SelectItem value="st">ST</SelectItem>
                        <SelectItem value="ews">EWS</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Aadhaar Number</Label>
                    <Input placeholder="12-digit Aadhaar" maxLength={14} value={form.aadhaar_number}
                      onChange={(e) => set("aadhaar_number", e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Applying for Class</Label>
                    <Input placeholder="e.g. Class 1, LKG" value={form.applying_for_class}
                      onChange={(e) => set("applying_for_class", e.target.value)} />
                  </div>
                </div>
                <Separator />
                <div className="flex justify-end">
                  <Button onClick={() => setStep(2)} disabled={!step1Valid}>
                    Next: Family Details <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </>
          )}

          {/* ── Step 2: Family & Address ────────────────────────────────── */}
          {step === 2 && (
            <>
              <CardHeader>
                <CardTitle>Family &amp; Address Details</CardTitle>
                <CardDescription>Mother&apos;s phone is required *</CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-gray-700">Father</p>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="space-y-1.5">
                      <Label>Father&apos;s Name</Label>
                      <Input value={form.father_name} onChange={(e) => set("father_name", e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Father&apos;s Phone</Label>
                      <Input type="tel" inputMode="numeric" maxLength={10} value={form.father_phone} onChange={(e) => setPhone("father_phone", e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Father&apos;s Occupation</Label>
                      <Input value={form.father_occupation} onChange={(e) => set("father_occupation", e.target.value)} />
                    </div>
                  </div>
                </div>
                <Separator />
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-gray-700">Mother</p>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="space-y-1.5">
                      <Label>Mother&apos;s Name</Label>
                      <Input value={form.mother_name} onChange={(e) => set("mother_name", e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Mother&apos;s Phone *</Label>
                      <Input type="tel" inputMode="numeric" maxLength={10} required value={form.mother_phone} onChange={(e) => setPhone("mother_phone", e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Mother&apos;s Occupation</Label>
                      <Input value={form.mother_occupation} onChange={(e) => set("mother_occupation", e.target.value)} />
                    </div>
                  </div>
                </div>
                <Separator />
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-gray-700">Guardian (if applicable)</p>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="space-y-1.5">
                      <Label>Guardian&apos;s Name</Label>
                      <Input value={form.guardian_name} onChange={(e) => set("guardian_name", e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Guardian&apos;s Phone</Label>
                      <Input type="tel" inputMode="numeric" maxLength={10} value={form.guardian_phone} onChange={(e) => setPhone("guardian_phone", e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Relation</Label>
                      <Input placeholder="e.g. Uncle, Grandparent" value={form.guardian_relation}
                        onChange={(e) => set("guardian_relation", e.target.value)} />
                    </div>
                  </div>
                </div>
                <Separator />
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-gray-700">Residential Address</p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="md:col-span-2 space-y-1.5">
                      <Label>Address Line 1</Label>
                      <Input placeholder="House no., Street" value={form.address_line1}
                        onChange={(e) => set("address_line1", e.target.value)} />
                    </div>
                    <div className="md:col-span-2 space-y-1.5">
                      <Label>Address Line 2</Label>
                      <Input placeholder="Locality, Landmark" value={form.address_line2}
                        onChange={(e) => set("address_line2", e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>City</Label>
                      <Input value={form.city} onChange={(e) => set("city", e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>State</Label>
                      <Input value={form.state} onChange={(e) => set("state", e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>PIN Code</Label>
                      <Input maxLength={6} value={form.pincode} onChange={(e) => set("pincode", e.target.value)} />
                    </div>
                  </div>
                </div>
                <div className="flex justify-between">
                  <Button variant="outline" onClick={() => setStep(1)}>
                    <ArrowLeft className="mr-2 h-4 w-4" /> Back
                  </Button>
                  <Button onClick={() => setStep(3)} disabled={form.mother_phone.trim() === ""}>
                    Next: Previous School <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </>
          )}

          {/* ── Step 3: Previous School ─────────────────────────────────── */}
          {step === 3 && (
            <>
              <CardHeader>
                <CardTitle>Previous School Details</CardTitle>
                <CardDescription>Skip if this is a new admission (no previous school)</CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="md:col-span-2 space-y-1.5">
                    <Label>Previous School Name</Label>
                    <Input value={form.previous_school_name}
                      onChange={(e) => set("previous_school_name", e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Class Last Studied</Label>
                    <Input placeholder="e.g. Class 5" value={form.previous_class}
                      onChange={(e) => set("previous_class", e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>TC Number</Label>
                    <Input placeholder="Transfer Certificate number" value={form.tc_number}
                      onChange={(e) => set("tc_number", e.target.value)} />
                  </div>
                  <div className="md:col-span-2 space-y-1.5">
                    <Label>Previous School Address</Label>
                    <Input placeholder="City, State" value={form.previous_school_address}
                      onChange={(e) => set("previous_school_address", e.target.value)} />
                  </div>
                </div>
                <div className="flex justify-between">
                  <Button variant="outline" onClick={() => setStep(2)}>
                    <ArrowLeft className="mr-2 h-4 w-4" /> Back
                  </Button>
                  <Button onClick={() => setStep(4)}>
                    Next: Documents <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </>
          )}

          {/* ── Step 4: Documents & Submit ──────────────────────────────── */}
          {step === 4 && (
            <>
              <CardHeader>
                <CardTitle>Upload Documents</CardTitle>
                <CardDescription>
                  All documents are optional but may be required for admission. Max 5MB per file. 
                  Accepted formats: JPEG, PNG, PDF.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {DOCUMENT_TYPES.map(({ key, label }) => {
                    const file = documents[key]
                    const inputId = `doc-${key}`
                    return (
                      <div key={key} className="space-y-1.5">
                        <Label htmlFor={inputId}>{label}</Label>
                        <div className={`border-2 border-dashed rounded-lg p-3 transition-colors cursor-pointer
                          ${file ? "border-green-400 bg-green-50" : "border-gray-200 hover:border-blue-300 hover:bg-blue-50"}`}
                          onClick={() => fileRefs.current[key]?.click()}>
                          <input
                            id={inputId}
                            type="file"
                            accept="image/jpeg,image/png,application/pdf"
                            className="hidden"
                            ref={(el) => { fileRefs.current[key] = el }}
                            onChange={(e) => handleDocumentChange(key, e.target.files?.[0] ?? null)}
                          />
                          {file ? (
                            <div className="flex items-center gap-2">
                              {file.type.startsWith("image") ? (
                                <Image className="h-4 w-4 text-green-600" aria-hidden />
                              ) : (
                                <FileText className="h-4 w-4 text-green-600" aria-hidden />
                              )}
                              <span className="text-sm text-green-700 font-medium truncate">{file.name}</span>
                              <Badge variant="secondary" className="ml-auto shrink-0 text-xs">
                                {(file.size / 1024).toFixed(0)} KB
                              </Badge>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2 text-gray-400">
                              <Upload className="h-4 w-4" />
                              <span className="text-sm">Click to upload</span>
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>

                {submitError && (
                  <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                    <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                    <span>{submitError}</span>
                  </div>
                )}

                {/* Summary before submit */}
                <div className="bg-gray-50 rounded-lg p-4 space-y-2 text-sm border">
                  <p className="font-semibold text-gray-800">Application Summary</p>
                  <div className="text-gray-700 space-y-1">
                    {school?.admission_academic_year && (
                      <p><span className="font-medium">Academic Year:</span> {school.admission_academic_year}</p>
                    )}
                    <p><span className="font-medium">Student:</span> {form.student_name}</p>
                    <p><span className="font-medium">Email:</span> {form.email}</p>
                    <p><span className="font-medium">Date of Birth:</span> {form.date_of_birth}</p>
                    <p><span className="font-medium">Class Applied:</span> {form.applying_for_class || "Not specified"}</p>
                    <p><span className="font-medium">Mother&apos;s Phone:</span> {form.mother_phone}</p>
                    <p><span className="font-medium">Documents:</span> {Object.values(documents).filter(Boolean).length} file(s) attached</p>
                  </div>
                </div>

                <div className="flex justify-between">
                  <Button variant="outline" onClick={() => setStep(3)} disabled={submitting}>
                    <ArrowLeft className="mr-2 h-4 w-4" /> Back
                  </Button>
                  <Button onClick={handleSubmit} disabled={submitting}>
                    {submitting ? (
                      <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Submitting…</>
                    ) : (
                      <><CheckCircle2 className="mr-2 h-4 w-4" /> Submit Application</>
                    )}
                  </Button>
                </div>
              </CardContent>
            </>
          )}
        </Card>

        {/* Footer */}
        <p className="text-center text-xs text-gray-400">
          Your information is kept confidential and used only for admission processing.
        </p>
      </div>
    </div>
  )
}
