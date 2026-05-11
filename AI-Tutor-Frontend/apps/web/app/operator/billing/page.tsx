'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  DollarSign, Loader2, AlertTriangle, CheckCircle2,
  TrendingUp, BarChart3, RefreshCw, Zap, Activity, Server,
} from 'lucide-react';
import { DashboardShell } from '@/components/layout/dashboard-shell';
import { operatorSignOut, getOperatorToken, clearOperatorSession } from '@/lib/auth/session';
import * as echarts from 'echarts';

const log = console;

type Range = '1' | '7' | '30' | '90' | '365';

function fmt(n: number) {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function pct(n: number) {
  return `${(n * 100).toFixed(1)}%`;
}

function StatCard({ icon, label, value, sub, color = 'text-[#10B981]' }: { icon: React.ReactNode; label: string; value: React.ReactNode; sub?: string; color?: string }) {
  return (
    <div className="rounded-3xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-6 shadow-sm flex flex-col min-h-[140px] hover:shadow-md transition-all">
      <div className={`flex items-center gap-3 mb-4 ${color}`}>
        <div className="p-2 rounded-xl bg-neutral-50 dark:bg-neutral-900 border border-neutral-100 dark:border-neutral-800">
          {icon}
        </div>
        <h3 className="font-bold text-xs uppercase tracking-wider text-neutral-500">{label}</h3>
      </div>
      <div className="text-3xl font-black text-[#0F172A] dark:text-white">{value}</div>
      {sub && <p className="text-[10px] font-bold text-neutral-400 mt-2 uppercase tracking-tight">{sub}</p>}
    </div>
  );
}

const RANGES: { key: Range; label: string }[] = [
  { key: '1', label: '24H' },
  { key: '7', label: '7D' },
  { key: '30', label: '30D' },
  { key: '90', label: '90D' },
  { key: '365', label: '1Y' },
];

const PROVIDER_COLORS: Record<string, string> = {
  openrouter: '#10B981',
  groq: '#F59E0B',
  elevenlabs: '#8B5CF6',
};

export default function BillingPage() {
  const router = useRouter();
  const [range, setRange] = useState<Range>('30');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<any>(null);

  const pieChartRef = useRef<HTMLDivElement>(null);
  const trendChartRef = useRef<HTMLDivElement>(null);
  const tokenChartRef = useRef<HTMLDivElement>(null);
  const pieInstance = useRef<echarts.ECharts | null>(null);
  const trendInstance = useRef<echarts.ECharts | null>(null);
  const tokenInstance = useRef<echarts.ECharts | null>(null);

  const headers = (): HeadersInit => {
    const tok = getOperatorToken();
    const h: any = { 'Content-Type': 'application/json', 'X-Operator-Header': 'true' };
    if (tok) h['Authorization'] = `Bearer ${tok}`;
    return h;
  };

  const load = async (r: Range) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/operator/api-costs?days=${r}`, {
        headers: headers(),
        cache: 'no-store',
      });
      if (res.status === 401) {
        clearOperatorSession();
        router.push('/operator/login');
        return;
      }
      if (!res.ok) {
        setError(`Backend error: ${res.status}`);
        return;
      }
      const json = await res.json();
      setData(json);
    } catch (e: any) {
      setError(e.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(range); }, [range]);

  const byComponent: any[] = data?.by_component ?? [];
  const perUser: any[] = data?.per_user ?? [];

  // Build provider totals from by_component
  const providerTotals: Record<string, number> = {};
  let totalTokenInput = 0;
  let totalTokenOutput = 0;
  for (const c of byComponent) {
    providerTotals[c.provider] = (providerTotals[c.provider] || 0) + (c.cost_usd || 0);
    totalTokenInput += c.input_tokens || 0;
    totalTokenOutput += c.output_tokens || 0;
  }

  // Provider pie chart
  useEffect(() => {
    if (!pieChartRef.current || loading) return;
    if (!pieInstance.current) {
      pieInstance.current = echarts.init(pieChartRef.current);
    }
    const pieData = Object.entries(providerTotals)
      .filter(([, v]) => v > 0)
      .map(([name, value]) => ({
        name: name.charAt(0).toUpperCase() + name.slice(1),
        value: Math.round(value * 100) / 100,
        itemStyle: { color: PROVIDER_COLORS[name] || '#6B7280' },
      }));
    pieInstance.current.setOption({
      tooltip: { trigger: 'item', formatter: '{b}: ${c}' },
      legend: { bottom: 0, textStyle: { fontSize: 11, fontWeight: 'bold' } },
      series: [{
        type: 'pie',
        radius: ['40%', '65%'],
        center: ['50%', '42%'],
        avoidLabelOverlap: true,
        itemStyle: { borderRadius: 6, borderColor: '#fff', borderWidth: 2 },
        label: { show: true, formatter: '{b}\n{d}%', fontSize: 11, fontWeight: 'bold' },
        emphasis: { label: { show: true, fontSize: 13, fontWeight: 'bold' } },
        data: pieData.length ? pieData : [{ name: 'No data', value: 1, itemStyle: { color: '#E5E7EB' } }],
      }],
    });
  }, [data, loading]);

  // Trend chart (daily cost from by_component — use request_count as proxy for trend)
  useEffect(() => {
    if (!trendChartRef.current || loading) return;
    if (!trendInstance.current) {
      trendInstance.current = echarts.init(trendChartRef.current);
    }
    const providers = [...new Set(byComponent.map((c: any) => c.provider))];
    const series = providers.map((p: string) => ({
      name: p.charAt(0).toUpperCase() + p.slice(1),
      type: 'bar' as const,
      stack: 'cost',
      barMaxWidth: 32,
      itemStyle: { color: PROVIDER_COLORS[p] || '#6B7280', borderRadius: 0 },
      data: byComponent.filter((c: any) => c.provider === p).map((c: any) => Math.round((c.cost_usd || 0) * 100) / 100),
    }));
    const labels = byComponent
      .filter((c: any) => providers.indexOf(c.provider) === 0 || !byComponent.some((x: any) => x.component === c.component && providers.indexOf(x.provider) < providers.indexOf(c.provider)))
      .map((c: any) => c.component.replace(/_/g, ' ').replace(/^\w/, (s: string) => s.toUpperCase()));

    trendInstance.current.setOption({
      tooltip: { trigger: 'axis', formatter: (params: any[]) => {
        let total = 0;
        let html = `<b>${params[0]?.axisValue || ''}</b><br/>`;
        for (const p of params) {
          total += p.value;
          html += `${p.marker} ${p.seriesName}: $${p.value.toFixed(2)}<br/>`;
        }
        html += `<br/><b>Total: $${total.toFixed(2)}</b>`;
        return html;
      }},
      legend: { bottom: 0, textStyle: { fontSize: 11, fontWeight: 'bold' } },
      grid: { left: 60, right: 20, top: 20, bottom: 50 },
      xAxis: {
        type: 'category',
        data: labels,
        axisLabel: { fontSize: 10, fontWeight: 'bold', rotate: 30 },
      },
      yAxis: { type: 'value', axisLabel: { formatter: '${v}' }, min: 0 },
      series,
    });
  }, [data, loading]);

  // Token usage chart
  useEffect(() => {
    if (!tokenChartRef.current || loading) return;
    if (!tokenInstance.current) {
      tokenInstance.current = echarts.init(tokenChartRef.current);
    }
    const inTokens = totalTokenInput;
    const outTokens = totalTokenOutput;
    tokenInstance.current.setOption({
      tooltip: { trigger: 'axis', formatter: (params: any[]) => {
        let html = '';
        for (const p of params) {
          html += `${p.marker} ${p.seriesName}: ${(p.value || 0).toLocaleString()}<br/>`;
        }
        return html;
      }},
      legend: { bottom: 0, textStyle: { fontSize: 11, fontWeight: 'bold' } },
      grid: { left: 60, right: 20, top: 20, bottom: 40 },
      xAxis: { type: 'category', data: ['Tokens'], axisLabel: { fontSize: 11, fontWeight: 'bold' } },
      yAxis: { type: 'value', axisLabel: { formatter: (v: number) => v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : v >= 1_000 ? `${(v / 1_000).toFixed(0)}K` : String(v) } },
      series: [
        {
          name: 'Input Tokens',
          type: 'bar',
          stack: 'tokens',
          barMaxWidth: 60,
          itemStyle: { color: '#10B981', borderRadius: [4, 4, 0, 0] },
          data: [inTokens],
        },
        {
          name: 'Output Tokens',
          type: 'bar',
          stack: 'tokens',
          barMaxWidth: 60,
          itemStyle: { color: '#F59E0B', borderRadius: [4, 4, 0, 0] },
          data: [outTokens],
        },
      ],
    });
  }, [data, loading]);

  // Resize charts on window resize
  useEffect(() => {
    const handleResize = () => {
      pieInstance.current?.resize();
      trendInstance.current?.resize();
      tokenInstance.current?.resize();
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <DashboardShell
      variant="operator"
      onSignOut={async () => {
        await operatorSignOut();
        router.push('/operator/login');
      }}
      shellClassName="bg-[#F8FAFC] dark:bg-neutral-900/50"
    >
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-7xl mx-auto p-4 pt-6 md:p-6 md:pt-10">

          {/* Header */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-10">
            <div>
              <h1 className="text-3xl font-black tracking-tight text-[#0F172A] dark:text-white uppercase">Billing & Costs</h1>
              <p className="text-sm text-neutral-500 mt-1">Provider cost tracking, token consumption, and margin analysis.</p>
            </div>
            <div className="flex items-center gap-3">
              {error && <span className="text-sm text-red-600 bg-red-50 border border-red-100 px-3 py-2 rounded-xl font-medium">{error}</span>}
              <button
                onClick={() => load(range)}
                disabled={loading}
                className="flex items-center gap-2 bg-[#10B981] text-white px-6 py-2.5 rounded-xl font-bold hover:bg-emerald-600 transition-all shadow-lg shadow-emerald-500/20 disabled:opacity-50"
              >
                <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} />
                {loading ? 'Loading…' : 'Refresh'}
              </button>
            </div>
          </div>

          {/* Time range selector */}
          <div className="flex gap-1 mb-10 rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-1.5 w-fit shadow-sm">
            {RANGES.map(r => (
              <button key={r.key} onClick={() => setRange(r.key)}
                className={`px-5 py-2 rounded-xl text-sm font-bold transition-all ${range === r.key ? 'bg-[#0F172A] text-white shadow-lg shadow-blue-900/20' : 'text-neutral-500 hover:text-[#0F172A] hover:bg-neutral-50 dark:hover:bg-neutral-900'}`}>
                {r.label}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-32">
              <Loader2 className="size-10 animate-spin text-[#10B981]" />
            </div>
          ) : !data ? (
            <div className="rounded-[3rem] border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-20 text-center shadow-sm">
              <h3 className="text-lg font-bold text-[#0F172A] dark:text-white mb-2">No Data Available</h3>
              <p className="text-sm text-neutral-400 max-w-sm mx-auto">Usage data appears once the generation pipeline produces records or the backend telemetry endpoint receives events.</p>
            </div>
          ) : (
            <div className="space-y-8">

              {/* ── Stat cards ── */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <StatCard icon={<DollarSign className="size-5" />} label="Total API Cost" color="text-rose-600"
                  value={fmt(data.total_cost_usd_30d ?? 0)}
                  sub={`${RANGES.find(r => r.key === range)?.label || '30D'} period`} />
                <StatCard icon={<Zap className="size-5" />} label="OpenRouter" color="text-emerald-600"
                  value={fmt(data.openrouter_cost_usd ?? 0)}
                  sub={data.estimated_margin_30d != null ? `Margin ${pct(data.estimated_margin_30d)}` : undefined} />
                <StatCard icon={<Activity className="size-5" />} label="Groq" color="text-amber-500"
                  value={fmt(data.groq_cost_usd ?? 0)}
                  sub={`${totalTokenInput.toLocaleString()} in / ${totalTokenOutput.toLocaleString()} out tokens`} />
                <StatCard icon={<Server className="size-5" />} label="ElevenLabs TTS" color="text-purple-500"
                  value={fmt(data.tts_cost_usd ?? 0)}
                  sub={byComponent.filter((c: any) => c.provider === 'elevenlabs').length > 0 ? 'Voice synthesis' : undefined} />
              </div>

              {/* ── Charts row ── */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Provider cost breakdown (pie) */}
                <div className="rounded-[2.5rem] border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-6 shadow-sm">
                  <h3 className="font-black uppercase tracking-tight text-[#0F172A] dark:text-white mb-4">Cost by Provider</h3>
                  <div ref={pieChartRef} className="w-full" style={{ height: 300 }} />
                </div>

                {/* Component cost breakdown (bar) */}
                <div className="lg:col-span-2 rounded-[2.5rem] border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-6 shadow-sm">
                  <h3 className="font-black uppercase tracking-tight text-[#0F172A] dark:text-white mb-4">Cost by Component</h3>
                  <div ref={trendChartRef} className="w-full" style={{ height: 300 }} />
                </div>
              </div>

              {/* ── Token usage chart ── */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="rounded-[2.5rem] border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-6 shadow-sm">
                  <h3 className="font-black uppercase tracking-tight text-[#0F172A] dark:text-white mb-4">Token Consumption</h3>
                  <div ref={tokenChartRef} className="w-full" style={{ height: 220 }} />
                </div>

                {/* Summary stats */}
                <div className="lg:col-span-2 rounded-[2.5rem] border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-6 shadow-sm">
                  <h3 className="font-black uppercase tracking-tight text-[#0F172A] dark:text-white mb-4">Summary</h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                    {[
                      ['Requests', byComponent.reduce((s: number, c: any) => s + (c.request_count || 0), 0).toLocaleString()],
                      ['Providers', Object.keys(providerTotals).length],
                      ['Components', byComponent.length],
                      ['Active Users', perUser.length],
                    ].map(([l, v]) => (
                      <div key={String(l)}>
                        <p className="text-[10px] font-bold text-neutral-400 uppercase tracking-widest mb-1">{l}</p>
                        <p className="text-2xl font-black text-[#0F172A] dark:text-white">{v}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* ── Component breakdown table ── */}
              <div className="rounded-[2.5rem] border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 shadow-sm overflow-hidden">
                <div className="p-6 border-b border-neutral-100 dark:border-neutral-800 bg-neutral-50/50 dark:bg-neutral-900/50">
                  <h3 className="font-black uppercase tracking-tight text-[#0F172A] dark:text-white">Infrastructure Breakdown</h3>
                  <p className="text-[10px] font-bold text-neutral-400 uppercase tracking-widest mt-1">Token usage and cost by component, provider, and model</p>
                </div>
                {byComponent.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                      <thead className="bg-[#F8FAFC] dark:bg-neutral-900 border-b border-neutral-100 dark:border-neutral-800">
                        <tr>
                          {['Component', 'Provider', 'Model', 'Requests', 'I/O Tokens', 'Cost (USD)'].map(h => (
                            <th key={h} className="px-6 py-4 font-black text-neutral-400 uppercase text-[10px] tracking-widest">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-neutral-50 dark:divide-neutral-800">
                        {byComponent.map((c: any, i: number) => (
                          <tr key={i} className="hover:bg-neutral-50 dark:hover:bg-neutral-900/50 transition-colors">
                            <td className="px-6 py-4 font-bold text-[#0F172A] dark:text-white capitalize">
                              {c.component.replace(/_/g, ' ')}
                            </td>
                            <td className="px-6 py-4">
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider"
                                style={{
                                  backgroundColor: `${PROVIDER_COLORS[c.provider] || '#6B7280'}15`,
                                  color: PROVIDER_COLORS[c.provider] || '#6B7280',
                                }}>
                                <span className="size-1.5 rounded-full" style={{ backgroundColor: PROVIDER_COLORS[c.provider] || '#6B7280' }} />
                                {c.provider}
                              </span>
                            </td>
                            <td className="px-6 py-4 text-[10px] text-neutral-400 font-mono tracking-tighter max-w-[200px] truncate">{c.model_id}</td>
                            <td className="px-6 py-4 font-mono text-xs">{c.request_count?.toLocaleString()}</td>
                            <td className="px-6 py-4 text-[11px] text-neutral-500">
                              <span className="text-[#0F172A] dark:text-white font-bold">{c.input_tokens?.toLocaleString()}</span>{' '}
                              <span className="text-neutral-300">/</span>{' '}
                              {c.output_tokens?.toLocaleString()}
                            </td>
                            <td className="px-6 py-4 font-black text-rose-500">{fmt(c.cost_usd ?? 0)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="p-16 text-center text-sm text-neutral-400 italic">No usage records for this period</div>
                )}
              </div>

              {/* ── Per-user cost table ── */}
              {perUser.length > 0 && (
                <div className="rounded-[2.5rem] border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 shadow-sm overflow-hidden">
                  <div className="p-6 border-b border-neutral-100 dark:border-neutral-800 bg-neutral-50/50 dark:bg-neutral-900/50">
                    <h3 className="font-black uppercase tracking-tight text-[#0F172A] dark:text-white">Resource Consumption per User</h3>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                      <thead className="bg-[#F8FAFC] dark:bg-neutral-900 border-b border-neutral-100 dark:border-neutral-800">
                        <tr>
                          {['User', 'Plan', 'Revenue', 'API Cost', 'Ratio', 'Status'].map(h => (
                            <th key={h} className="px-6 py-4 font-black text-neutral-400 uppercase text-[10px] tracking-widest">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-neutral-50 dark:divide-neutral-800">
                        {perUser.map((u: any, i: number) => {
                          const ratio = u.revenue_inr > 0 ? (u.api_cost_usd * 84) / u.revenue_inr : 0;
                          const risky = ratio > 0.7;
                          return (
                            <tr key={i} className="hover:bg-neutral-50 dark:hover:bg-neutral-900/50 transition-colors">
                              <td className="px-6 py-4 font-bold text-[#0F172A] dark:text-white">{u.email ?? u.account_id}</td>
                              <td className="px-6 py-4">
                                <span className="rounded-lg bg-neutral-100 dark:bg-neutral-800 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider">{u.plan ?? 'free'}</span>
                              </td>
                              <td className="px-6 py-4 text-emerald-600 font-black">{fmt(u.revenue_inr / 84)}</td>
                              <td className="px-6 py-4 text-rose-500 font-medium">{fmt(u.api_cost_usd ?? 0)}</td>
                              <td className="px-6 py-4 font-black">{ratio > 0 ? `${(ratio * 100).toFixed(0)}%` : '—'}</td>
                              <td className="px-6 py-4">
                                {risky
                                  ? <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-50 text-rose-600 text-[10px] font-black uppercase border border-rose-100"><AlertTriangle className="size-3" /> High Spend</span>
                                  : <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-600 text-[10px] font-black uppercase border border-emerald-100"><CheckCircle2 className="size-3" /> Healthy</span>}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

            </div>
          )}

        </div>
      </main>
    </DashboardShell>
  );
}
