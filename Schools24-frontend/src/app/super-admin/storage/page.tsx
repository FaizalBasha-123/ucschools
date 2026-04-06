"use client"

import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Input } from "@/components/ui/input"
import { api } from "@/lib/api"
import { AlertCircle, Database, HardDrive, Loader2, RefreshCw, Search, Server, Warehouse, ChevronDown, ChevronUp, FileText } from "lucide-react"

export interface StorageCollectionUsage {
  collection: string
  bytes: number
  documents: number
}

export interface SchoolStorageUsage {
  school_id: string
  school_name: string
  schema_name: string
  neon_bytes: number
  r2_bytes: number
  total_bytes: number
  r2_documents: number
  r2_collections: StorageCollectionUsage[]
}

export interface PlatformStorageUsage {
  schema_name: string
  neon_bytes: number
  r2_bytes: number
  total_bytes: number
  r2_documents: number
  r2_collections: StorageCollectionUsage[]
}

export interface StorageOverviewResponse {
  summary: {
    total_school_neon_bytes: number
    total_school_r2_bytes: number
    total_school_bytes: number
    platform_neon_bytes: number
    platform_r2_bytes: number
    platform_bytes: number
    grand_total_bytes: number
    school_count: number
  }
  platform: PlatformStorageUsage
  schools: SchoolStorageUsage[]
}

export function formatStorageBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B"
  const units = ["B", "KB", "MB", "GB", "TB"]
  let value = bytes
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  return `${value >= 100 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(2)} ${units[unitIndex]}`
}

function formatExactBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 bytes"
  return `${bytes.toLocaleString()} bytes`
}

function CollectionBreakdown({ items }: { items: StorageCollectionUsage[] }) {
  if (items.length === 0) {
    return <p className="text-xs text-muted-foreground italic">No R2 file payload stored yet.</p>
  }
  const totalBytes = items.reduce((sum, item) => sum + item.bytes, 0)
  return (
    <div className="space-y-1.5">
      {items
        .slice()
        .sort((a, b) => b.bytes - a.bytes)
        .map((item) => {
          const pct = totalBytes > 0 ? (item.bytes / totalBytes) * 100 : 0
          return (
            <div key={item.collection} className="rounded-lg border border-border/50 bg-muted/30 px-3 py-2">
              <div className="flex items-center justify-between gap-2 mb-1">
                <div className="flex items-center gap-1.5 min-w-0">
                  <FileText className="h-3 w-3 shrink-0 text-muted-foreground" />
                  <p className="truncate text-xs font-medium">{item.collection}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[10px] text-muted-foreground">{item.documents} docs</span>
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">
                    {formatStorageBytes(item.bytes)}
                  </Badge>
                </div>
              </div>
              <Progress value={pct} className="h-1" />
            </div>
          )
        })}
    </div>
  )
}

function StatTile({
  label,
  value,
  sub,
  icon,
  color,
}: {
  label: string
  value: string
  sub: string
  icon: React.ReactNode
  color: string
}) {
  return (
    <div className={`rounded-2xl border ${color} p-4 flex flex-col gap-2`}>
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
        {icon}
      </div>
      <p className="text-2xl font-bold tracking-tight">{value}</p>
      <p className="text-xs text-muted-foreground">{sub}</p>
    </div>
  )
}

function SchoolRow({ school, totalBytes }: { school: SchoolStorageUsage; totalBytes: number }) {
  const [expanded, setExpanded] = useState(false)
  const pct = totalBytes > 0 ? (school.total_bytes / totalBytes) * 100 : 0
  const neonPct = school.total_bytes > 0 ? (school.neon_bytes / school.total_bytes) * 100 : 0

  return (
    <div className="rounded-xl border border-border/60 bg-background/60 overflow-hidden">
      <button
        onClick={() => setExpanded((e) => !e)}
        className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-muted/40 transition-colors"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold truncate">{school.school_name}</p>
            <span className="font-mono text-[10px] text-muted-foreground">{school.schema_name}</span>
          </div>
          <div className="mt-1.5 flex items-center gap-2">
            <Progress value={pct} className="h-1.5 flex-1 max-w-[160px]" />
            <span className="text-[11px] text-muted-foreground">{pct.toFixed(1)}% of tenant storage</span>
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <div className="text-right hidden sm:block">
            <p className="text-base font-bold">{formatStorageBytes(school.total_bytes)}</p>
            <p className="text-[10px] text-muted-foreground">{formatExactBytes(school.total_bytes)}</p>
          </div>
          {expanded ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4 border-t border-border/50 bg-muted/10 space-y-4 pt-3">
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-xl border border-border/60 bg-card p-3 text-center">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Neon (SQL)</p>
              <p className="text-lg font-bold">{formatStorageBytes(school.neon_bytes)}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">{neonPct.toFixed(0)}% of total</p>
            </div>
            <div className="rounded-xl border border-border/60 bg-card p-3 text-center">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">R2</p>
              <p className="text-lg font-bold">{formatStorageBytes(school.r2_bytes)}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">{(100 - neonPct).toFixed(0)}% of total</p>
            </div>
            <div className="rounded-xl border border-border/60 bg-card p-3 text-center">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">R2 Objects</p>
              <p className="text-lg font-bold">{school.r2_documents.toLocaleString()}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">objects</p>
            </div>
          </div>
          {school.r2_collections.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                R2 Category Breakdown
              </p>
              <CollectionBreakdown items={school.r2_collections} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function SuperAdminStorageSection() {
  const [search, setSearch] = useState("")

  const overviewQuery = useQuery({
    queryKey: ["super-admin-storage-overview"],
    queryFn: () => api.get<StorageOverviewResponse>("/super-admin/storage/overview"),
    // Storage stats are expensive (Neon pg_database_size per schema + R2 object listing per prefix).
    // Cache them for 5 minutes — numbers don't change second-to-second.
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
    refetchOnWindowFocus: false,   // don't re-query every alt-tab
    refetchOnReconnect: false,     // don't re-query on network reconnect
  })

  const rankedSchools = useMemo(
    () => (overviewQuery.data?.schools ?? []).slice().sort((a, b) => b.total_bytes - a.total_bytes),
    [overviewQuery.data],
  )

  const filteredSchools = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return rankedSchools
    return rankedSchools.filter(
      (s) => s.school_name.toLowerCase().includes(q) || s.schema_name.toLowerCase().includes(q),
    )
  }, [rankedSchools, search])

  if (overviewQuery.isLoading) {
    return (
      <div className="min-h-[50vh] flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  if (overviewQuery.error || !overviewQuery.data) {
    return (
      <Card className="border-red-200/60 bg-red-50/60 dark:border-red-900/50 dark:bg-red-950/20">
        <CardContent className="flex items-center gap-3 p-6 text-sm text-red-700 dark:text-red-300">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <span>
            {overviewQuery.error instanceof Error
              ? overviewQuery.error.message
              : "Failed to load storage overview."}
          </span>
        </CardContent>
      </Card>
    )
  }

  const { summary, platform } = overviewQuery.data

  return (
    <div className="space-y-6">
      {/* ── Summary stat tiles ─────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatTile
          label="Grand Total"
          value={formatStorageBytes(summary.grand_total_bytes)}
          sub={formatExactBytes(summary.grand_total_bytes)}
          icon={<Warehouse className="h-4 w-4 text-indigo-500" />}
          color="border-indigo-200/60 bg-indigo-50/40 dark:border-indigo-800/40 dark:bg-indigo-950/20"
        />
        <StatTile
          label="Tenant SQL (Neon)"
          value={formatStorageBytes(summary.total_school_neon_bytes)}
          sub={`${summary.school_count} school schemas`}
          icon={<Database className="h-4 w-4 text-violet-500" />}
          color="border-violet-200/60 bg-violet-50/40 dark:border-violet-800/40 dark:bg-violet-950/20"
        />
        <StatTile
          label="Tenant Files (R2)"
          value={formatStorageBytes(summary.total_school_r2_bytes)}
          sub="School-scoped document payloads"
          icon={<HardDrive className="h-4 w-4 text-emerald-500" />}
          color="border-emerald-200/60 bg-emerald-50/40 dark:border-emerald-800/40 dark:bg-emerald-950/20"
        />
        <StatTile
          label="Platform Core"
          value={formatStorageBytes(summary.platform_bytes)}
          sub="public schema + super-admin docs"
          icon={<Server className="h-4 w-4 text-fuchsia-500" />}
          color="border-fuchsia-200/60 bg-fuchsia-50/40 dark:border-fuchsia-800/40 dark:bg-fuchsia-950/20"
        />
      </div>

      {/* ── Two independent scroll panels ──────────────────────────── */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.1fr_1.9fr]">

        {/* Platform Storage Core — capped height, own scrollbar */}
        <Card className="border-border/60 bg-card/70 backdrop-blur-xl flex flex-col" style={{ maxHeight: "680px" }}>
          <CardHeader className="shrink-0 pb-3">
            <CardTitle className="text-base">Platform Storage Core</CardTitle>
            <CardDescription>Public schema and super-admin document payloads.</CardDescription>
          </CardHeader>
          <CardContent className="flex-1 overflow-y-auto space-y-4 pr-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-2xl border border-border/60 bg-background/70 p-4">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Neon (SQL)</p>
                <p className="mt-2 text-xl font-bold">{formatStorageBytes(platform.neon_bytes)}</p>
                <p className="mt-1 text-[10px] text-muted-foreground">{formatExactBytes(platform.neon_bytes)}</p>
                <p className="mt-0.5 text-[10px] font-mono text-muted-foreground">{platform.schema_name}</p>
              </div>
              <div className="rounded-2xl border border-border/60 bg-background/70 p-4">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">R2</p>
                <p className="mt-2 text-xl font-bold">{formatStorageBytes(platform.r2_bytes)}</p>
                <p className="mt-1 text-[10px] text-muted-foreground">{formatExactBytes(platform.r2_bytes)}</p>
                <p className="mt-0.5 text-[10px] text-muted-foreground">
                  {platform.r2_documents.toLocaleString()} objects
                </p>
              </div>
            </div>
            {platform.r2_collections.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                  Collection Breakdown
                </p>
                <CollectionBreakdown items={platform.r2_collections} />
              </div>
            )}
          </CardContent>
        </Card>

        {/* School Storage Control — capped height, own scrollbar, searchable */}
        <Card className="border-border/60 bg-card/70 backdrop-blur-xl flex flex-col" style={{ maxHeight: "680px" }}>
          <CardHeader className="shrink-0 pb-3 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle className="text-base">School Storage Control</CardTitle>
                <CardDescription className="mt-0.5">
                  Per-tenant Neon schema footprint and R2 payload. Click a row to expand.
                </CardDescription>
              </div>
              <div className="flex items-center gap-2 shrink-0 mt-0.5">
                <Badge variant="secondary">{rankedSchools.length} schools</Badge>
                <button
                  onClick={() => overviewQuery.refetch()}
                  disabled={overviewQuery.isFetching}
                  title="Refresh storage data"
                  className="rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted/60 disabled:opacity-40 transition-colors"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${overviewQuery.isFetching ? 'animate-spin' : ''}`} />
                </button>
              </div>
            </div>
            {overviewQuery.dataUpdatedAt > 0 && (
              <p className="text-[10px] text-muted-foreground/60">
                Last fetched {new Date(overviewQuery.dataUpdatedAt).toLocaleTimeString()} · cached 5 min
              </p>
            )}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              <Input
                placeholder="Search by school name or schema…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 h-9 text-sm"
              />
            </div>
          </CardHeader>
          <CardContent className="flex-1 overflow-y-auto space-y-2 pr-2">
            {filteredSchools.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
                <Search className="h-8 w-8 mb-3 opacity-30" />
                <p className="text-sm font-medium">
                  {search ? `No schools match "${search}"` : "No school storage metrics yet."}
                </p>
                {search && (
                  <button
                    onClick={() => setSearch("")}
                    className="mt-2 text-xs text-primary hover:underline"
                  >
                    Clear search
                  </button>
                )}
              </div>
            ) : (
              filteredSchools.map((school) => (
                <SchoolRow
                  key={school.school_id}
                  school={school}
                  totalBytes={summary.total_school_bytes}
                />
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

export default function SuperAdminStoragePage() {
  return <SuperAdminStorageSection />
}
