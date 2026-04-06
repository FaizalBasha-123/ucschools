"use client";

import { FormEvent, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Upload, CheckCircle2, AlertTriangle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

type SchoolInfo = {
  school_id: string;
  school_name: string;
  school_slug: string;
  academic_year?: string;
  appointments_open: boolean;
};

type SubmitResponse = {
  application_id: string;
  full_name: string;
  message: string;
};

const PUBLIC_API_BASE = (process.env.NEXT_PUBLIC_PUBLIC_API_BASE || "/api/public").replace(/\/+$/, "");

const DOCUMENT_TYPES = [
  { key: "aadhaar_card", label: "Aadhaar Card" },
  { key: "pan_card", label: "PAN Card" },
  { key: "voter_or_passport", label: "Voter ID / Passport" },
  { key: "marksheets_10_12", label: "10th & 12th Marksheets" },
  { key: "degree_certificates", label: "Degree Certificates" },
  { key: "bed_med_certificate", label: "B.Ed / M.Ed Certificate" },
  { key: "ctet_stet_result", label: "CTET / STET Result" },
  { key: "relieving_letter", label: "Relieving Letter" },
  { key: "experience_certificate", label: "Experience Certificate" },
  { key: "salary_slips", label: "Salary Slips (3 Months)" },
  { key: "epf_uan_number", label: "EPF / UAN Proof" },
  { key: "police_verification", label: "Police Verification" },
  { key: "medical_fitness_cert", label: "Medical Fitness Certificate" },
  { key: "character_certificate", label: "Character Certificate" },
  { key: "passport_photos", label: "Passport Photos (5-6)" },
] as const;

type DocKey = (typeof DOCUMENT_TYPES)[number]["key"];

type FormState = {
  full_name: string;
  email: string;
  phone: string;
  date_of_birth: string;
  gender: string;
  address: string;
  highest_qualification: string;
  professional_degree: string;
  eligibility_test: string;
  subject_expertise: string;
  experience_years: string;
  current_school: string;
  expected_salary: string;
  notice_period_days: string;
  cover_letter: string;
};

const INITIAL_FORM: FormState = {
  full_name: "",
  email: "",
  phone: "",
  date_of_birth: "",
  gender: "",
  address: "",
  highest_qualification: "",
  professional_degree: "",
  eligibility_test: "",
  subject_expertise: "",
  experience_years: "",
  current_school: "",
  expected_salary: "",
  notice_period_days: "",
  cover_letter: "",
};

export default function TeacherAppointmentPublicPage() {
  const params = useParams<{ slug: string }>();
  const slug = String(params?.slug || "");
  const searchSuffix = typeof window !== "undefined" ? window.location.search : "";

  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [docs, setDocs] = useState<Partial<Record<DocKey, File>>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submittedId, setSubmittedId] = useState<string>("");

  const { data, isLoading, error } = useQuery({
    queryKey: ["teacher-appointment-public", slug, searchSuffix],
    queryFn: async () => {
      const res = await fetch(`${PUBLIC_API_BASE}/teacher-appointments/${encodeURIComponent(slug)}${searchSuffix}`);
      if (!res.ok) {
        throw new Error("school_not_found");
      }
      return (await res.json()) as SchoolInfo;
    },
    enabled: !!slug,
  });

  const requiredReady = useMemo(() => {
    return (
      form.full_name.trim() !== "" &&
      form.email.trim() !== "" &&
      form.phone.trim() !== "" &&
      form.subject_expertise.trim() !== ""
    );
  }, [form]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!requiredReady) {
      toast.error("Fill required fields.");
      return;
    }
    setSubmitting(true);
    try {
      const fd = new FormData();
      Object.entries(form).forEach(([k, v]) => {
        if (v.trim() !== "") fd.append(k, v);
      });
      if (data?.academic_year) fd.append("academic_year", data.academic_year);

      for (const [k, f] of Object.entries(docs)) {
        if (f) fd.append(k, f);
      }

      const res = await fetch(`${PUBLIC_API_BASE}/teacher-appointments/${encodeURIComponent(slug)}${searchSuffix}`, {
        method: "POST",
        body: fd,
      });
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body?.error || "submit_failed");
      }
      const payload = body as SubmitResponse;
      setSubmittedId(payload.application_id);
      setForm(INITIAL_FORM);
      setDocs({});
      toast.success("Application submitted.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Submission failed");
    } finally {
      setSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading...
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center p-6">
        <Card className="max-w-lg w-full">
          <CardHeader>
            <CardTitle>Invalid appointment link</CardTitle>
            <CardDescription>This school could not be found.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white py-8 px-4">
      <div className="max-w-5xl mx-auto space-y-6">
        <Card className="border-slate-200">
          <CardHeader>
            <CardTitle className="text-2xl">Teacher Appointment Form</CardTitle>
            <CardDescription>
              {data.school_name} {data.academic_year ? `- ${data.academic_year}` : ""}
            </CardDescription>
          </CardHeader>
        </Card>

        {submittedId && (
          <Card className="border-green-300 bg-green-50">
            <CardContent className="py-8 flex flex-col items-center gap-3 text-green-700 text-center">
              <CheckCircle2 className="h-10 w-10" />
              <div>
                <p className="font-semibold text-lg">Application Submitted Successfully</p>
                <p className="text-sm mt-1 text-green-600">
                  The school will review your application and contact you soon.
                </p>
                <p className="text-xs mt-2 font-mono text-green-600">
                  Application ID: {submittedId}
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {!submittedId && !data.appointments_open && (
          <Card className="border-amber-200 bg-amber-50">
            <CardContent className="py-8 flex flex-col items-center gap-2 text-amber-700 text-center">
              <AlertTriangle className="h-8 w-8" />
              <p className="font-semibold text-lg">Applications are currently closed</p>
              <p className="text-sm text-amber-600">
                This school is not accepting teacher applications at this time. Please check back later.
              </p>
            </CardContent>
          </Card>
        )}

        {/* Document requirements intentionally hidden for now.
            Keep the document model and upload handling in code so this
            section can be re-enabled later without rewriting the flow. */}

        {!submittedId && data.appointments_open && (
        <Card className="border-slate-200">
          <CardHeader>
            <CardTitle>Application</CardTitle>
            <CardDescription>Fields marked * are required</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="space-y-6">
              <div className="grid md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Full Name *</Label>
                  <Input value={form.full_name} onChange={(e) => setForm((s) => ({ ...s, full_name: e.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label>Email *</Label>
                  <Input type="email" value={form.email} onChange={(e) => setForm((s) => ({ ...s, email: e.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label>Phone *</Label>
                  <Input value={form.phone} onChange={(e) => setForm((s) => ({ ...s, phone: e.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label>Date of Birth</Label>
                  <Input type="date" value={form.date_of_birth} onChange={(e) => setForm((s) => ({ ...s, date_of_birth: e.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label>Gender</Label>
                  <Input value={form.gender} onChange={(e) => setForm((s) => ({ ...s, gender: e.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label>Highest Qualification</Label>
                  <Input value={form.highest_qualification} onChange={(e) => setForm((s) => ({ ...s, highest_qualification: e.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label>Professional Degree</Label>
                  <Input value={form.professional_degree} onChange={(e) => setForm((s) => ({ ...s, professional_degree: e.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label>Eligibility Test</Label>
                  <Input value={form.eligibility_test} onChange={(e) => setForm((s) => ({ ...s, eligibility_test: e.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label>Subject Expertise *</Label>
                  <Input placeholder="e.g. Mathematics, Physics" value={form.subject_expertise} onChange={(e) => setForm((s) => ({ ...s, subject_expertise: e.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label>Experience Years</Label>
                  <Input type="number" min={0} value={form.experience_years} onChange={(e) => setForm((s) => ({ ...s, experience_years: e.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label>Current School</Label>
                  <Input value={form.current_school} onChange={(e) => setForm((s) => ({ ...s, current_school: e.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label>Expected Salary</Label>
                  <Input value={form.expected_salary} onChange={(e) => setForm((s) => ({ ...s, expected_salary: e.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label>Notice Period (Days)</Label>
                  <Input type="number" min={0} value={form.notice_period_days} onChange={(e) => setForm((s) => ({ ...s, notice_period_days: e.target.value }))} />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Address</Label>
                <Textarea value={form.address} onChange={(e) => setForm((s) => ({ ...s, address: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Cover Letter</Label>
                <Textarea value={form.cover_letter} onChange={(e) => setForm((s) => ({ ...s, cover_letter: e.target.value }))} />
              </div>
              <div className="flex items-center justify-end gap-3">
                <Button type="submit" disabled={submitting || !requiredReady}>
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Upload className="h-4 w-4 mr-2" />}
                  Submit Application
                </Button>
              </div>
              {!requiredReady && (
                <div className="text-xs text-amber-700 flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" /> Fill Full Name, Email, Phone and Subject Expertise.
                </div>
              )}
            </form>
          </CardContent>
        </Card>
        )}
      </div>
    </div>
  );
}
