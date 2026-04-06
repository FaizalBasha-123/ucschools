"use client"

import { useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  useConsentHistory,
  useDSRList,
  useAuditEvents,
  useReconciliationSummary,
  useUnverifiedStudents,
  useWithdrawConsent,
  useUpdateDSRStatus,
} from "@/hooks/useCompliance"
import { Loader2, ShieldCheck, FileText, Users, Activity, AlertTriangle } from "lucide-react"

const STATUS_COLORS: Record<string, string> = {
  active: "bg-emerald-100 text-emerald-800",
  withdrawn: "bg-red-100 text-red-800",
  submitted: "bg-blue-100 text-blue-800",
  under_review: "bg-amber-100 text-amber-800",
  approved: "bg-emerald-100 text-emerald-800",
  rejected: "bg-red-100 text-red-800",
  completed: "bg-slate-100 text-slate-800",
  cancelled: "bg-slate-100 text-slate-500",
  verified: "bg-emerald-100 text-emerald-800",
  partial: "bg-amber-100 text-amber-800",
  pending_external_verification: "bg-blue-100 text-blue-800",
  unverified: "bg-slate-100 text-slate-500",
  failed: "bg-red-100 text-red-800",
}

type Tab = "overview" | "consent" | "dsr" | "identity" | "audit"

export default function CompliancePage() {
  const [activeTab, setActiveTab] = useState<Tab>("overview")

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Compliance Console</h1>
        <p className="text-sm text-slate-500 mt-1">
          Manage consent, data subject requests, identity verification, and audit logs
        </p>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-1 bg-slate-100 p-1 rounded-lg w-fit">
        {([
          { key: "overview", label: "Overview", icon: Activity },
          { key: "consent", label: "Consent", icon: ShieldCheck },
          { key: "dsr", label: "DSR", icon: FileText },
          { key: "identity", label: "Identity", icon: Users },
          { key: "audit", label: "Audit Log", icon: AlertTriangle },
        ] as const).map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-medium transition-colors ${
              activeTab === key
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-500 hover:text-slate-700"
            }`}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </div>

      {activeTab === "overview" && <OverviewTab />}
      {activeTab === "consent" && <ConsentTab />}
      {activeTab === "dsr" && <DSRTab />}
      {activeTab === "identity" && <IdentityTab />}
      {activeTab === "audit" && <AuditTab />}
    </div>
  )
}

function OverviewTab() {
  const consent = useConsentHistory("all", 5)
  const dsr = useDSRList("all", 5)
  const recon = useReconciliationSummary()
  const unverified = useUnverifiedStudents(5)

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      <Card>
        <CardHeader className="pb-2">
          <CardDescription>Active Consents</CardDescription>
          <CardTitle className="text-2xl">
            {consent.isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> :
              consent.data?.items?.filter(c => c.status === "active").length ?? 0}
          </CardTitle>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardDescription>Open DSRs</CardDescription>
          <CardTitle className="text-2xl">
            {dsr.isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> :
              dsr.data?.items?.filter(d => !["completed", "cancelled", "rejected"].includes(d.status)).length ?? 0}
          </CardTitle>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardDescription>Pending Reconciliations</CardDescription>
          <CardTitle className="text-2xl">
            {recon.isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> :
              recon.data?.summary?.pending ?? 0}
          </CardTitle>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardDescription>Unverified Students</CardDescription>
          <CardTitle className="text-2xl">
            {unverified.isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> :
              unverified.data?.count ?? 0}
          </CardTitle>
        </CardHeader>
      </Card>
    </div>
  )
}

function ConsentTab() {
  const [statusFilter, setStatusFilter] = useState("all")
  const { data, isLoading } = useConsentHistory(statusFilter)
  const withdrawMutation = useWithdrawConsent()

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {["all", "active", "withdrawn"].map(s => (
          <Button key={s} variant={statusFilter === s ? "default" : "outline"} size="sm"
            onClick={() => setStatusFilter(s)} className="text-xs capitalize">{s}</Button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Guardian</th>
                <th className="text-left px-4 py-2 font-medium">Method</th>
                <th className="text-left px-4 py-2 font-medium">Status</th>
                <th className="text-left px-4 py-2 font-medium">Date</th>
                <th className="text-left px-4 py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {data?.items?.map(c => (
                <tr key={c.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2 font-medium">{c.guardian_name}</td>
                  <td className="px-4 py-2">{c.consent_method}</td>
                  <td className="px-4 py-2">
                    <Badge variant="secondary" className={STATUS_COLORS[c.status] || ""}>{c.status}</Badge>
                  </td>
                  <td className="px-4 py-2 text-slate-500">{new Date(c.consented_at).toLocaleDateString()}</td>
                  <td className="px-4 py-2">
                    {c.status === "active" && (
                      <Button variant="outline" size="sm" className="text-xs text-red-600 hover:text-red-700"
                        disabled={withdrawMutation.isPending}
                        onClick={() => withdrawMutation.mutate({ consentId: c.id, payload: { reason: "Admin withdrawal", method: "digital" } })}>
                        Withdraw
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
              {(!data?.items || data.items.length === 0) && (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-400">No consent records found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function DSRTab() {
  const [statusFilter, setStatusFilter] = useState("all")
  const { data, isLoading } = useDSRList(statusFilter)
  const updateStatus = useUpdateDSRStatus()

  return (
    <div className="space-y-4">
      <div className="flex gap-2 flex-wrap">
        {["all", "submitted", "under_review", "approved", "completed"].map(s => (
          <Button key={s} variant={statusFilter === s ? "default" : "outline"} size="sm"
            onClick={() => setStatusFilter(s)} className="text-xs capitalize">{s.replace("_", " ")}</Button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Requester</th>
                <th className="text-left px-4 py-2 font-medium">Type</th>
                <th className="text-left px-4 py-2 font-medium">Status</th>
                <th className="text-left px-4 py-2 font-medium">Submitted</th>
                <th className="text-left px-4 py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {data?.items?.map(d => (
                <tr key={d.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2 font-medium">{d.requester_name}</td>
                  <td className="px-4 py-2 capitalize">{d.request_type}</td>
                  <td className="px-4 py-2">
                    <Badge variant="secondary" className={STATUS_COLORS[d.status] || ""}>{d.status.replace("_", " ")}</Badge>
                  </td>
                  <td className="px-4 py-2 text-slate-500">{d.submitted_at ? new Date(d.submitted_at).toLocaleDateString() : "-"}</td>
                  <td className="px-4 py-2 flex gap-1">
                    {d.status === "submitted" && (
                      <Button variant="outline" size="sm" className="text-xs"
                        disabled={updateStatus.isPending}
                        onClick={() => updateStatus.mutate({ id: d.id, payload: { status: "under_review" } })}>
                        Review
                      </Button>
                    )}
                    {d.status === "under_review" && (
                      <>
                        <Button variant="outline" size="sm" className="text-xs text-emerald-600"
                          disabled={updateStatus.isPending}
                          onClick={() => updateStatus.mutate({ id: d.id, payload: { status: "approved" } })}>
                          Approve
                        </Button>
                        <Button variant="outline" size="sm" className="text-xs text-red-600"
                          disabled={updateStatus.isPending}
                          onClick={() => updateStatus.mutate({ id: d.id, payload: { status: "rejected" } })}>
                          Reject
                        </Button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {(!data?.items || data.items.length === 0) && (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-400">No data subject requests found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function IdentityTab() {
  const { data, isLoading } = useUnverifiedStudents(50)

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Unverified Students</CardTitle>
          <CardDescription>Students with APAAR/ABC IDs that have not been verified</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : (
            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-600">
                  <tr>
                    <th className="text-left px-4 py-2 font-medium">Name</th>
                    <th className="text-left px-4 py-2 font-medium">APAAR ID</th>
                    <th className="text-left px-4 py-2 font-medium">ABC ID</th>
                    <th className="text-left px-4 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {data?.items?.map(s => (
                    <tr key={s.id} className="hover:bg-slate-50">
                      <td className="px-4 py-2 font-medium">{s.full_name}</td>
                      <td className="px-4 py-2 font-mono text-xs">{s.apaar_id || "-"}</td>
                      <td className="px-4 py-2 font-mono text-xs">{s.abc_id || "-"}</td>
                      <td className="px-4 py-2">
                        <Badge variant="secondary" className={STATUS_COLORS[s.identity_verification_status] || ""}>
                          {s.identity_verification_status}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                  {(!data?.items || data.items.length === 0) && (
                    <tr><td colSpan={4} className="px-4 py-8 text-center text-slate-400">All students verified ✓</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function AuditTab() {
  const { data, isLoading } = useAuditEvents("", 100)

  return (
    <div className="space-y-4">
      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Event</th>
                <th className="text-left px-4 py-2 font-medium">Actor</th>
                <th className="text-left px-4 py-2 font-medium">Timestamp</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {data?.items?.map(e => (
                <tr key={e.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2">
                    <Badge variant="outline" className="font-mono text-xs">{e.event_type}</Badge>
                  </td>
                  <td className="px-4 py-2 text-xs">
                    {e.actor_role ? `${e.actor_role}` : "system"}
                  </td>
                  <td className="px-4 py-2 text-slate-500 text-xs">{new Date(e.created_at).toLocaleString()}</td>
                </tr>
              ))}
              {(!data?.items || data.items.length === 0) && (
                <tr><td colSpan={3} className="px-4 py-8 text-center text-slate-400">No audit events yet</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
