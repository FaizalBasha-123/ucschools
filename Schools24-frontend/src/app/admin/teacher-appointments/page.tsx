"use client";

import { useMemo, useState, useEffect, useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import {
  Users,
  Clock,
  CheckCircle2,
  XCircle,
  Search,
  Copy,
  Eye,
  Check,
  X,
  Loader2,
  FileText,
  User,
  BriefcaseBusiness,
  GraduationCap,
  ExternalLink,
  Code2,
  ChevronRight,
  ClipboardCheck,
  ToggleRight,
} from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";

// ─── Types ────────────────────────────────────────────────────────────────────

type StatusFilter = "all" | "pending" | "approved" | "rejected";

type ListItem = {
  id: string;
  full_name: string;
  email: string;
  phone: string;
  subject_expertise?: string;
  experience_years?: number;
  document_count: number;
  status: "pending" | "approved" | "rejected";
  submitted_at: string;
};

type ApplicationDetail = {
  id: string;
  full_name: string;
  email: string;
  phone: string;
  subject_expertise?: string;
  highest_qualification?: string;
  professional_degree?: string;
  eligibility_test?: string;
  experience_years?: number;
  current_school?: string;
  expected_salary?: number;
  notice_period_days?: number;
  cover_letter?: string;
  address?: string;
  status: string;
};

type DocumentItem = {
  id: string;
  document_type: string;
  file_name: string;
  file_size: number;
  mime_type: string;
};

type DetailResponse = {
  application: ApplicationDetail;
  documents: DocumentItem[];
};

type AdmissionSettings = {
  school_slug: string;
  admissions_open: boolean;
  auto_approve: boolean;
  teacher_appointments_open: boolean;
};

type DecisionItem = {
  id: string;
  application_id: string;
  applicant_name: string;
  applicant_email: string;
  decision: "approved" | "rejected";
  reason?: string;
  reviewed_at: string;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getFormsOrigin() {
  if (process.env.NEXT_PUBLIC_FORMS_URL) {
    return process.env.NEXT_PUBLIC_FORMS_URL.replace(/\/+$/, "");
  }
  return "http://localhost:3000";
}

function getInitials(name: string) {
  return name
    .split(" ")
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function humanDocType(type: string) {
  return type
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

const STATUS_COLOR: Record<string, string> = {
  pending:
    "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-300 dark:border-amber-800",
  approved:
    "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-300 dark:border-emerald-800",
  rejected:
    "bg-red-50 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-300 dark:border-red-800",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold capitalize ${
        STATUS_COLOR[status] ?? "bg-muted text-muted-foreground border-border"
      }`}
    >
      {status === "pending" && <Clock className="h-2.5 w-2.5" />}
      {status === "approved" && <CheckCircle2 className="h-2.5 w-2.5" />}
      {status === "rejected" && <XCircle className="h-2.5 w-2.5" />}
      {status}
    </span>
  );
}

function InfoField({
  label,
  value,
}: {
  label: string;
  value?: string | number | null;
}) {
  if (!value && value !== 0) return null;
  return (
    <div>
      <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-0.5">
        {label}
      </p>
      <p className="text-sm font-medium text-foreground">{String(value)}</p>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AdminTeacherAppointmentsPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [selected, setSelected] = useState<ListItem | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [copied, setCopied] = useState<"link" | "embed" | null>(null);
  const [formsOrigin, setFormsOrigin] = useState("");

  useEffect(() => {
    setFormsOrigin(getFormsOrigin());
  }, []);

  // ── Queries ────────────────────────────────────────────────────────────────

  const listQuery = useQuery({
    queryKey: ["admin-teacher-appointments", "all"],
    queryFn: () =>
      api.get<{ items: ListItem[]; total: number }>(
        "/admin/teacher-appointments?status=all&page=1&page_size=200"
      ),
    staleTime: 30_000,
  });

  const detailQuery = useQuery({
    queryKey: ["admin-teacher-appointment", selected?.id],
    queryFn: () =>
      api.get<DetailResponse>(
        `/admin/teacher-appointments/${selected!.id}`
      ),
    enabled: !!selected?.id,
  });

  const decisionsQuery = useQuery({
    queryKey: ["admin-teacher-appointment-decisions"],
    queryFn: () =>
      api.get<{ items: DecisionItem[]; total: number }>(
        "/admin/teacher-appointments/decisions?page=1&page_size=50"
      ),
    staleTime: 30_000,
  });

  const settingsQuery = useQuery({
    queryKey: ["admin-admission-settings-embed"],
    queryFn: () => api.get<AdmissionSettings>("/admin/settings/admissions"),
    staleTime: 5 * 60_000,
  });

  // ── Mutations ──────────────────────────────────────────────────────────────

  const approveMutation = useMutation({
    mutationFn: (id: string) =>
      api.put(`/admin/teacher-appointments/${id}/approve`, {}),
    onSuccess: () => {
      toast.success("Application approved", {
        description: "The applicant has been moved to User Management.",
      });
      setSelected(null);
      qc.invalidateQueries({ queryKey: ["admin-teacher-appointments"] });
      qc.invalidateQueries({
        queryKey: ["admin-teacher-appointment-decisions"],
      });
    },
    onError: (e: Error) =>
      toast.error("Approval failed", { description: e.message }),
  });

  const rejectMutation = useMutation({
    mutationFn: (id: string) =>
      api.put(`/admin/teacher-appointments/${id}/reject`, {
        reason: rejectReason.trim() || undefined,
      }),
    onSuccess: () => {
      toast.success("Application rejected");
      setSelected(null);
      setRejectReason("");
      qc.invalidateQueries({ queryKey: ["admin-teacher-appointments"] });
      qc.invalidateQueries({
        queryKey: ["admin-teacher-appointment-decisions"],
      });
    },
    onError: (e: Error) =>
      toast.error("Rejection failed", { description: e.message }),
  });

  const toggleAppointmentsMutation = useMutation({
    mutationFn: (open: boolean) =>
      api.put("/admin/settings/admissions", {
        admissions_open: settingsQuery.data?.admissions_open ?? false,
        auto_approve: settingsQuery.data?.auto_approve ?? false,
        teacher_appointments_open: open,
      }),
    onSuccess: (_data, open) => {
      toast.success(
        open ? "Applications are now open" : "Applications are now closed"
      );
      qc.invalidateQueries({ queryKey: ["admin-admission-settings-embed"] });
    },
    onError: (e: Error) =>
      toast.error("Failed to update setting", { description: e.message }),
  });

  // ── Derived stats ──────────────────────────────────────────────────────────

  const allItems = listQuery.data?.items ?? [];
  const stats = useMemo(
    () => ({
      total: allItems.length,
      pending: allItems.filter((i) => i.status === "pending").length,
      approved: allItems.filter((i) => i.status === "approved").length,
      rejected: allItems.filter((i) => i.status === "rejected").length,
    }),
    [allItems]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allItems
      .filter(
        (i) => statusFilter === "all" || i.status === statusFilter
      )
      .filter(
        (i) =>
          !q ||
          i.full_name.toLowerCase().includes(q) ||
          i.email.toLowerCase().includes(q) ||
          i.phone.includes(q) ||
          (i.subject_expertise ?? "").toLowerCase().includes(q)
      );
  }, [allItems, statusFilter, search]);

  // ── Embed / link ───────────────────────────────────────────────────────────

  const slug = settingsQuery.data?.school_slug;
  const publicFormUrl = slug
    ? `${formsOrigin}/teacher-appointment/${slug}`
    : "";
  const embedCode = slug
    ? `<iframe src="${formsOrigin}/teacher-appointment/${slug}?embed=1" width="100%" height="980" style="border:0;" loading="lazy"></iframe>`
    : "";

  const copyText = useCallback(
    async (text: string, kind: "link" | "embed") => {
      if (!text) return;
      await navigator.clipboard.writeText(text);
      setCopied(kind);
      toast.success(kind === "link" ? "Link copied" : "Embed code copied");
      setTimeout(() => setCopied(null), 2000);
    },
    []
  );

  // ── Document viewer ────────────────────────────────────────────────────────

  const viewDoc = async (docId: string) => {
    if (!selected?.id) return;
    try {
      const blob = await api.fetchBlob(
        `/admin/teacher-appointments/${selected.id}/documents/${docId}/view`
      );
      window.open(URL.createObjectURL(blob), "_blank", "noopener,noreferrer");
    } catch {
      toast.error("Unable to load document.");
    }
  };

  const isActing = approveMutation.isPending || rejectMutation.isPending;
  const isPending = selected ? selected.status === "pending" : false;

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* ── Page header ───────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-xl md:text-3xl font-bold tracking-tight">
              Teacher Recruitment
            </h1>
            {!settingsQuery.isLoading && (
              <span
                className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${
                  settingsQuery.data?.teacher_appointments_open
                    ? "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-300 dark:border-emerald-800"
                    : "bg-red-50 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-300 dark:border-red-800"
                }`}
              >
                {settingsQuery.data?.teacher_appointments_open ? (
                  <CheckCircle2 className="h-3 w-3" />
                ) : (
                  <XCircle className="h-3 w-3" />
                )}
                {settingsQuery.data?.teacher_appointments_open
                  ? "Accepting Applications"
                  : "Applications Closed"}
              </span>
            )}
          </div>
          <p className="text-muted-foreground mt-0.5">
            Review and manage teacher job applications submitted via your
            public form
          </p>
        </div>
        <div className="flex items-center gap-2 overflow-x-auto pb-1 sm:pb-0 sm:flex-wrap lg:flex-nowrap lg:justify-end">
          {/* Applications open/closed toggle */}
          <div className="flex items-center gap-2 rounded-lg border bg-card px-2.5 py-1.5 shadow-sm whitespace-nowrap shrink-0 sm:px-3 sm:py-2">
            <ToggleRight className="h-3.5 w-3.5 text-muted-foreground shrink-0 sm:h-4 sm:w-4" />
            <span className="text-xs sm:text-sm font-medium whitespace-nowrap">
              Accept Applications
            </span>
            {settingsQuery.isLoading ? (
              <div className="h-6 w-11 rounded-full bg-muted animate-pulse shrink-0" />
            ) : (
              <ToggleSwitch
                checked={settingsQuery.data?.teacher_appointments_open ?? true}
                onCheckedChange={(checked) =>
                  toggleAppointmentsMutation.mutate(checked)
                }
                disabled={toggleAppointmentsMutation.isPending}
                aria-label="Toggle teacher appointment applications open or closed"
              />
            )}
          </div>
          {publicFormUrl && (
            <Button asChild variant="outline" size="sm" className="h-8 justify-center px-3 text-xs whitespace-nowrap shrink-0 sm:h-9 sm:text-sm">
              <a
                href={publicFormUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                <ExternalLink className="h-3.5 w-3.5 mr-1.5 shrink-0" />
                View Public Form
              </a>
            </Button>
          )}
        </div>
      </div>

      {/* ── KPI stat cards ────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
        {(
          [
            {
              label: "Total Applications",
              value: stats.total,
              icon: Users,
              color: "text-indigo-600 dark:text-indigo-400",
              bg: "bg-indigo-50 dark:bg-indigo-900/20",
            },
            {
              label: "Awaiting Review",
              value: stats.pending,
              icon: Clock,
              color: "text-amber-600 dark:text-amber-400",
              bg: "bg-amber-50 dark:bg-amber-900/20",
            },
            {
              label: "Approved",
              value: stats.approved,
              icon: CheckCircle2,
              color: "text-emerald-600 dark:text-emerald-400",
              bg: "bg-emerald-50 dark:bg-emerald-900/20",
            },
            {
              label: "Rejected",
              value: stats.rejected,
              icon: XCircle,
              color: "text-red-600 dark:text-red-400",
              bg: "bg-red-50 dark:bg-red-900/20",
            },
          ] as const
        ).map(({ label, value, icon: Icon, color, bg }) => (
          <Card key={label} className="border-border shadow-sm">
            <CardContent className="p-3 sm:p-4 flex items-center gap-2.5 sm:gap-3">
              <div
                className={`h-9 w-9 rounded-xl flex items-center justify-center shrink-0 sm:h-10 sm:w-10 ${bg}`}
              >
                <Icon className={`h-4.5 w-4.5 sm:h-5 sm:w-5 ${color}`} />
              </div>
              <div className="min-w-0">
                <p className="text-[11px] sm:text-xs text-muted-foreground truncate">
                  {label}
                </p>
                {listQuery.isLoading ? (
                  <div className="h-6 w-8 rounded bg-muted animate-pulse mt-0.5" />
                ) : (
                  <p className="text-xl sm:text-2xl font-bold tabular-nums leading-none mt-0.5">
                    {value}
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ── Applications table ────────────────────────────────────────────── */}
      <Card className="border-border shadow-sm overflow-hidden">
        <CardHeader className="pb-3 pt-4 sm:pt-5">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <CardTitle className="text-lg">Applications</CardTitle>
              <CardDescription>
                {listQuery.isLoading
                  ? "Loading…"
                  : `${filtered.length} application${
                      filtered.length !== 1 ? "s" : ""
                    } matching current filter`}
              </CardDescription>
            </div>
            <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search name, email, subject…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="h-9 pl-8 text-sm w-full lg:w-[240px]"
                />
              </div>
              <Tabs
                value={statusFilter}
                onValueChange={(v) => setStatusFilter(v as StatusFilter)}
              >
                <TabsList className="h-auto w-full flex-wrap justify-start gap-1 rounded-xl bg-muted/60 p-1 lg:w-auto lg:flex-nowrap">
                  <TabsTrigger value="all" className="h-8 text-[11px] sm:text-xs px-3">
                    All
                  </TabsTrigger>
                  <TabsTrigger value="pending" className="h-8 text-[11px] sm:text-xs px-3">
                    Pending
                    {stats.pending > 0 && (
                      <span className="ml-1.5 rounded-full bg-amber-500 text-white text-[10px] font-bold w-4 h-4 inline-flex items-center justify-center leading-none">
                        {stats.pending}
                      </span>
                    )}
                  </TabsTrigger>
                  <TabsTrigger value="approved" className="h-8 text-[11px] sm:text-xs px-3">
                    Approved
                  </TabsTrigger>
                  <TabsTrigger value="rejected" className="h-8 text-[11px] sm:text-xs px-3">
                    Rejected
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y divide-border md:hidden">
            {listQuery.isLoading &&
              Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="space-y-3 px-4 py-4">
                  <div className="h-4 w-2/5 rounded bg-muted animate-pulse" />
                  <div className="h-3 w-3/4 rounded bg-muted animate-pulse" />
                  <div className="grid grid-cols-2 gap-2">
                    <div className="h-11 rounded-xl bg-muted animate-pulse" />
                    <div className="h-11 rounded-xl bg-muted animate-pulse" />
                  </div>
                </div>
              ))}

            {!listQuery.isLoading && filtered.length === 0 && (
              <div className="py-16 text-center px-6">
                <Users className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
                <p className="font-medium text-muted-foreground">
                  No applications found
                </p>
                <p className="text-sm text-muted-foreground/60 mt-1">
                  {search || statusFilter !== "all"
                    ? "Try adjusting your search or filter."
                    : "Applications submitted through your public form will appear here."}
                </p>
              </div>
            )}

            {!listQuery.isLoading &&
              filtered.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSelected(item)}
                  className="w-full px-4 py-4 text-left transition-colors hover:bg-muted/30"
                >
                  <div className="flex items-start gap-3">
                    <div className="h-10 w-10 rounded-full bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 flex items-center justify-center text-sm font-bold shrink-0">
                      {getInitials(item.full_name)}
                    </div>
                    <div className="min-w-0 flex-1 space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-semibold text-sm truncate">
                            {item.full_name}
                          </p>
                          <p className="text-xs text-muted-foreground truncate">
                            {item.email}
                          </p>
                        </div>
                        <StatusBadge status={item.status} />
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div className="rounded-xl border bg-muted/30 px-3 py-2">
                          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                            Subject
                          </p>
                          <p className="mt-1 truncate text-xs font-medium text-foreground">
                            {item.subject_expertise || "Not provided"}
                          </p>
                        </div>
                        <div className="rounded-xl border bg-muted/30 px-3 py-2">
                          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                            Submitted
                          </p>
                          <p className="mt-1 truncate text-xs font-medium text-foreground">
                            {formatDistanceToNow(new Date(item.submitted_at), {
                              addSuffix: true,
                            })}
                          </p>
                        </div>
                        <div className="rounded-xl border bg-muted/30 px-3 py-2">
                          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                            Experience
                          </p>
                          <p className="mt-1 text-xs font-medium text-foreground">
                            {item.experience_years != null ? `${item.experience_years} years` : "—"}
                          </p>
                        </div>
                        <div className="rounded-xl border bg-muted/30 px-3 py-2">
                          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                            Documents
                          </p>
                          <p className="mt-1 text-xs font-medium text-foreground">
                            {item.document_count}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center justify-between text-xs font-medium text-indigo-600 dark:text-indigo-400">
                        <span className="truncate">{item.phone}</span>
                        <span className="inline-flex items-center gap-1 shrink-0">
                          Review <ChevronRight className="h-3.5 w-3.5" />
                        </span>
                      </div>
                    </div>
                  </div>
                </button>
              ))}
          </div>

          <div className="hidden overflow-x-auto md:block">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30 hover:bg-muted/30">
                  <TableHead className="pl-5 w-[280px]">Applicant</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead className="text-center">Exp.</TableHead>
                  <TableHead className="text-center">Docs</TableHead>
                  <TableHead>Submitted</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="pr-5 text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {listQuery.isLoading &&
                  Array.from({ length: 4 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 7 }).map((__, j) => (
                        <TableCell key={j}>
                          <div className="h-4 rounded bg-muted animate-pulse w-full max-w-[120px]" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}

                {!listQuery.isLoading && filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="py-16 text-center">
                      <div className="flex flex-col items-center gap-2">
                        <Users className="h-8 w-8 text-muted-foreground/40" />
                        <p className="font-medium text-muted-foreground">
                          No applications found
                        </p>
                        <p className="text-sm text-muted-foreground/60">
                          {search || statusFilter !== "all"
                            ? "Try adjusting your search or filter."
                            : "Applications submitted through your public form will appear here."}
                        </p>
                      </div>
                    </TableCell>
                  </TableRow>
                )}

                {filtered.map((item) => (
                  <TableRow
                    key={item.id}
                    className="hover:bg-muted/30 cursor-pointer group"
                    onClick={() => setSelected(item)}
                  >
                    <TableCell className="pl-5">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="h-8 w-8 rounded-full bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 flex items-center justify-center text-xs font-bold shrink-0">
                          {getInitials(item.full_name)}
                        </div>
                        <div className="min-w-0">
                          <p className="font-medium text-sm truncate">
                            {item.full_name}
                          </p>
                          <p className="text-xs text-muted-foreground truncate">
                            {item.email}
                          </p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-muted-foreground">
                        {item.subject_expertise || (
                          <span className="text-muted-foreground/40">—</span>
                        )}
                      </span>
                    </TableCell>
                    <TableCell className="text-center">
                      <span className="text-sm tabular-nums">
                        {item.experience_years != null ? (
                          `${item.experience_years}y`
                        ) : (
                          <span className="text-muted-foreground/40">—</span>
                        )}
                      </span>
                    </TableCell>
                    <TableCell className="text-center">
                      <span
                        className={`inline-flex items-center gap-0.5 text-xs font-medium tabular-nums ${
                          item.document_count > 0
                            ? "text-foreground"
                            : "text-muted-foreground/40"
                        }`}
                      >
                        <FileText className="h-3 w-3" />
                        {item.document_count}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="text-xs text-muted-foreground whitespace-nowrap">
                        {formatDistanceToNow(new Date(item.submitted_at), {
                          addSuffix: true,
                        })}
                      </span>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={item.status} />
                    </TableCell>
                    <TableCell className="pr-5 text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="opacity-0 group-hover:opacity-100 transition-opacity h-7 text-xs gap-1"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelected(item);
                        }}
                      >
                        Review <ChevronRight className="h-3 w-3" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* ── Bottom row: Decision trail + Form sharing ─────────────────────── */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* Decision trail */}
        <Card className="border-border shadow-sm">
          <CardHeader className="pb-3">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-violet-50 dark:bg-violet-900/20">
                <ClipboardCheck className="h-4 w-4 text-violet-600 dark:text-violet-400" />
              </div>
              <div className="min-w-0">
                <CardTitle className="text-base leading-tight">Decision Trail</CardTitle>
                <CardDescription className="mt-1 text-xs leading-relaxed">
                  Audit log of all review decisions
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            {decisionsQuery.isLoading && (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="flex items-start gap-3">
                    <div className="h-7 w-7 rounded-full bg-muted animate-pulse shrink-0" />
                    <div className="flex-1 space-y-1.5">
                      <div className="h-3.5 bg-muted animate-pulse rounded w-3/4" />
                      <div className="h-3 bg-muted animate-pulse rounded w-1/2" />
                    </div>
                  </div>
                ))}
              </div>
            )}
            {!decisionsQuery.isLoading &&
              (decisionsQuery.data?.items ?? []).length === 0 && (
                <div className="py-8 text-center">
                  <ClipboardCheck className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">
                    No decisions recorded yet
                  </p>
                </div>
              )}
            <div className="space-y-2">
              {(decisionsQuery.data?.items ?? []).map((d, i, arr) => (
                <div key={d.id} className="rounded-2xl border border-border/80 bg-muted/20 px-3 py-3 sm:bg-transparent sm:border-0 sm:px-0 sm:py-3">
                  <div className="flex items-start gap-3">
                  <div className="relative flex flex-col items-center shrink-0">
                    <div
                      className={`h-7 w-7 rounded-full flex items-center justify-center z-10 ${
                        d.decision === "approved"
                          ? "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400"
                          : "bg-red-100 dark:bg-red-900/40 text-red-500 dark:text-red-400"
                      }`}
                    >
                      {d.decision === "approved" ? (
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      ) : (
                        <XCircle className="h-3.5 w-3.5" />
                      )}
                    </div>
                    {i < arr.length - 1 && (
                      <div className="w-px flex-1 bg-border mt-1 min-h-[12px]" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1 pb-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="min-w-0 truncate font-medium text-sm">
                        {d.applicant_name}
                      </span>
                      <span
                        className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold border ${
                          d.decision === "approved"
                            ? "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-400 dark:border-emerald-800"
                            : "bg-red-50 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-400 dark:border-red-800"
                        }`}
                      >
                        {d.decision}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">
                      {d.applicant_email}
                    </p>
                    {d.reason && (
                      <p className="mt-1 rounded-xl bg-background/80 px-2.5 py-2 text-xs italic text-muted-foreground">
                        "{d.reason}"
                      </p>
                    )}
                    <p className="text-[11px] text-muted-foreground/60 mt-0.5">
                      {formatDistanceToNow(new Date(d.reviewed_at), {
                        addSuffix: true,
                      })}
                    </p>
                  </div>
                </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Form sharing */}
        <Card className="border-border shadow-sm">
          <CardHeader className="pb-3">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-50 dark:bg-indigo-900/20">
                <Code2 className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
              </div>
              <div className="min-w-0">
                <CardTitle className="text-base leading-tight">
                  Application Form Sharing
                </CardTitle>
                <CardDescription className="mt-1 text-xs leading-relaxed">
                  Share the public form or embed it on your website
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 pt-0">
            {settingsQuery.isLoading ? (
              <div className="space-y-3">
                <div className="h-9 bg-muted animate-pulse rounded" />
                <div className="h-9 bg-muted animate-pulse rounded" />
              </div>
            ) : !slug ? (
              <div className="text-sm text-muted-foreground py-4 text-center">
                School slug not configured.
              </div>
            ) : (
              <>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">
                    Direct Form URL
                  </Label>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <div className="flex min-w-0 flex-1 items-start gap-2 rounded-xl border bg-muted/40 px-3 py-2.5">
                      <ExternalLink className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <a
                        href={publicFormUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="min-w-0 break-all text-xs font-mono leading-relaxed text-indigo-600 hover:underline dark:text-indigo-400"
                      >
                        {publicFormUrl}
                      </a>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-9 w-full shrink-0 gap-2 sm:w-auto sm:px-3"
                      onClick={() => copyText(publicFormUrl, "link")}
                    >
                      {copied === "link" ? (
                        <>
                          <Check className="h-3.5 w-3.5 text-emerald-500" />
                          Copied
                        </>
                      ) : (
                        <>
                          <Copy className="h-3.5 w-3.5" />
                          Copy Link
                        </>
                      )}
                    </Button>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">
                    Embed Code
                  </Label>
                  <div className="relative">
                    <pre className="overflow-x-auto rounded-xl bg-zinc-950 p-3 pr-10 text-[11px] font-mono leading-relaxed text-zinc-300 whitespace-pre-wrap break-all dark:bg-zinc-900">
                      {embedCode}
                    </pre>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="absolute top-2 right-2 h-7 w-7 text-zinc-400 hover:text-zinc-100"
                      onClick={() => copyText(embedCode, "embed")}
                    >
                      {copied === "embed" ? (
                        <Check className="h-3.5 w-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  </div>
                </div>
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  Paste the embed code into any website page to show the
                  application form inline. Submissions will appear in the table
                  above.
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Application Review Dialog ─────────────────────────────────────── */}
      <Dialog
        open={!!selected}
        onOpenChange={(open) => {
          if (!open) {
            setSelected(null);
            setRejectReason("");
          }
        }}
      >
        <DialogContent className="w-full sm:max-w-3xl max-h-[92dvh] overflow-y-auto p-0">
          <div className="px-6 pt-6 pb-4 border-b sticky top-0 bg-background z-10">
            <DialogHeader>
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 flex items-center justify-center text-sm font-bold shrink-0">
                    {selected ? getInitials(selected.full_name) : "—"}
                  </div>
                  <div>
                    <DialogTitle className="text-base leading-tight">
                      {selected?.full_name ?? "Application Review"}
                    </DialogTitle>
                    <DialogDescription className="text-xs mt-0.5">
                      {selected?.email} · Submitted{" "}
                      {selected
                        ? formatDistanceToNow(
                            new Date(selected.submitted_at),
                            { addSuffix: true }
                          )
                        : ""}
                    </DialogDescription>
                  </div>
                </div>
                {selected && <StatusBadge status={selected.status} />}
              </div>
            </DialogHeader>
          </div>

          <div className="px-6 py-5">
            {!detailQuery.data ? (
              <div className="py-12 flex flex-col items-center gap-3">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  Loading application…
                </p>
              </div>
            ) : (
              <div className="space-y-6">
                {/* Personal information */}
                <section>
                  <div className="flex items-center gap-2 mb-3">
                    <User className="h-4 w-4 text-indigo-500" />
                    <h3 className="text-sm font-semibold text-foreground">
                      Personal Information
                    </h3>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4 bg-muted/30 rounded-xl p-4 border border-border">
                    <InfoField
                      label="Full Name"
                      value={detailQuery.data.application.full_name}
                    />
                    <InfoField
                      label="Email"
                      value={detailQuery.data.application.email}
                    />
                    <InfoField
                      label="Phone"
                      value={detailQuery.data.application.phone}
                    />
                    <InfoField
                      label="Address"
                      value={detailQuery.data.application.address}
                    />
                  </div>
                </section>

                {/* Academic & Professional */}
                <section>
                  <div className="flex items-center gap-2 mb-3">
                    <GraduationCap className="h-4 w-4 text-violet-500" />
                    <h3 className="text-sm font-semibold text-foreground">
                      Academic & Professional
                    </h3>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4 bg-muted/30 rounded-xl p-4 border border-border">
                    <InfoField
                      label="Subject Expertise"
                      value={detailQuery.data.application.subject_expertise}
                    />
                    <InfoField
                      label="Highest Qualification"
                      value={
                        detailQuery.data.application.highest_qualification
                      }
                    />
                    <InfoField
                      label="Professional Degree"
                      value={detailQuery.data.application.professional_degree}
                    />
                    <InfoField
                      label="Eligibility Test"
                      value={detailQuery.data.application.eligibility_test}
                    />
                    <InfoField
                      label="Experience"
                      value={
                        detailQuery.data.application.experience_years != null
                          ? `${
                              detailQuery.data.application.experience_years
                            } year${
                              detailQuery.data.application.experience_years !==
                              1
                                ? "s"
                                : ""
                            }`
                          : null
                      }
                    />
                  </div>
                </section>

                {/* Employment */}
                <section>
                  <div className="flex items-center gap-2 mb-3">
                    <BriefcaseBusiness className="h-4 w-4 text-emerald-500" />
                    <h3 className="text-sm font-semibold text-foreground">
                      Employment Details
                    </h3>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4 bg-muted/30 rounded-xl p-4 border border-border">
                    <InfoField
                      label="Current School"
                      value={detailQuery.data.application.current_school}
                    />
                    <InfoField
                      label="Expected Salary"
                      value={
                        detailQuery.data.application.expected_salary
                          ? `\u20b9${Number(
                              detailQuery.data.application.expected_salary
                            ).toLocaleString("en-IN")}`
                          : null
                      }
                    />
                    <InfoField
                      label="Notice Period"
                      value={
                        detailQuery.data.application.notice_period_days != null
                          ? `${detailQuery.data.application.notice_period_days} days`
                          : null
                      }
                    />
                  </div>
                </section>

                {/* Cover letter */}
                {detailQuery.data.application.cover_letter && (
                  <section>
                    <div className="flex items-center gap-2 mb-3">
                      <FileText className="h-4 w-4 text-sky-500" />
                      <h3 className="text-sm font-semibold text-foreground">
                        Cover Letter
                      </h3>
                    </div>
                    <div className="bg-muted/30 rounded-xl p-4 border border-border">
                      <p className="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed">
                        {detailQuery.data.application.cover_letter}
                      </p>
                    </div>
                  </section>
                )}

                {/* Documents */}
                {detailQuery.data.documents.length > 0 && (
                  <section>
                    <div className="flex items-center gap-2 mb-3">
                      <FileText className="h-4 w-4 text-fuchsia-500" />
                      <h3 className="text-sm font-semibold text-foreground">
                        Documents ({detailQuery.data.documents.length})
                      </h3>
                    </div>
                    <div className="grid sm:grid-cols-2 gap-2">
                      {detailQuery.data.documents.map((doc) => (
                        <button
                          key={doc.id}
                          onClick={() => viewDoc(doc.id)}
                          className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 hover:bg-muted/60 hover:border-indigo-300 dark:hover:border-indigo-700 transition-colors p-3 text-left group"
                        >
                          <div className="h-8 w-8 rounded-lg bg-indigo-50 dark:bg-indigo-900/30 flex items-center justify-center shrink-0">
                            <FileText className="h-4 w-4 text-indigo-500" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-semibold text-foreground truncate">
                              {humanDocType(doc.document_type)}
                            </p>
                            <p className="text-[11px] text-muted-foreground truncate">
                              {doc.file_name} · {formatFileSize(doc.file_size)}
                            </p>
                          </div>
                          <Eye className="h-3.5 w-3.5 text-muted-foreground/40 group-hover:text-indigo-500 transition-colors shrink-0" />
                        </button>
                      ))}
                    </div>
                  </section>
                )}

                {/* Review actions — only for pending */}
                {isPending && (
                  <>
                    <Separator />
                    <section className="space-y-3">
                      <h3 className="text-sm font-semibold text-foreground">
                        Decision
                      </h3>
                      <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground">
                          Rejection reason{" "}
                          <span className="text-muted-foreground/60">
                            (optional — only needed if rejecting)
                          </span>
                        </Label>
                        <Textarea
                          placeholder="Explain why this application is being rejected…"
                          value={rejectReason}
                          onChange={(e) => setRejectReason(e.target.value)}
                          rows={2}
                          className="resize-none text-sm"
                        />
                      </div>
                    </section>
                  </>
                )}
              </div>
            )}
          </div>

          {detailQuery.data && isPending && (
            <div className="px-6 pb-6 flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-2 border-t pt-4">
              <Button
                variant="outline"
                className="border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950 w-full sm:w-auto"
                onClick={() =>
                  selected && rejectMutation.mutate(selected.id)
                }
                disabled={isActing}
              >
                {rejectMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <X className="h-4 w-4 mr-2" />
                )}
                Reject Application
              </Button>
              <Button
                className="bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm shadow-emerald-500/20 w-full sm:w-auto"
                onClick={() =>
                  selected && approveMutation.mutate(selected.id)
                }
                disabled={isActing}
              >
                {approveMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Check className="h-4 w-4 mr-2" />
                )}
                Approve & Onboard
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
