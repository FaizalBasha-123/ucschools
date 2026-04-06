"use client";

import { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  FileSpreadsheet,
  BarChart3,
  Users,
  DollarSign,
  GraduationCap,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  Cell,
} from "recharts";
import { toast } from "sonner";
import { useAdminRevenueChart, useAdminWeeklyAttendance, useAdminClassDistribution } from "@/hooks/useAdminDashboardSections";

const COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6"];

const getCurrentAcademicYear = () => {
  const now = new Date();
  const y = now.getFullYear();
  if (now.getMonth() + 1 < 4) return `${y - 1}-${y}`;
  return `${y}-${y + 1}`;
};

const getAcademicYearOptions = () => {
  const y = new Date().getFullYear();
  const items: string[] = [];
  for (let i = 0; i < 11; i += 1) {
    const start = y - i;
    items.push(`${start}-${start + 1}`);
  }
  return items;
};

export default function ReportsPage() {
  const [selectedYear, setSelectedYear] = useState(getCurrentAcademicYear());

  // Real chart data
  const { data: revenueChartResp } = useAdminRevenueChart('month')
  const revenueChartData = revenueChartResp?.data ?? []

  const { data: weeklyAttendanceResp } = useAdminWeeklyAttendance()
  const attendanceChartData = weeklyAttendanceResp?.days ?? []

  const { data: classDistResp } = useAdminClassDistribution()
  const gradeDistribution = (classDistResp?.items ?? []).map(item => ({
    name: item.name,
    value: item.student_count,
  }))

  const handleExportAll = () => {
    toast.success("Exporting all reports", {
      description: `Generating reports for ${selectedYear}...`,
    });
    setTimeout(() => {
      toast.success("Export completed", {
        description: "All reports have been downloaded.",
      });
    }, 1500);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl md:text-3xl font-bold">Reports</h1>
          <p className="text-muted-foreground">
            Generate and view school reports
          </p>
        </div>
        <div className="grid w-full grid-cols-[minmax(0,1fr)_auto] gap-2 sm:flex sm:w-auto sm:gap-3">
          <Select value={selectedYear} onValueChange={setSelectedYear}>
            <SelectTrigger className="w-full sm:w-[180px]">
              <SelectValue placeholder="Select Year" />
            </SelectTrigger>
            <SelectContent>
              {getAcademicYearOptions().map((year) => (
                <SelectItem key={year} value={year}>
                  {year}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button className="h-9 px-3 text-xs sm:h-10 sm:w-auto sm:px-4 sm:text-sm" onClick={handleExportAll}>
            <FileSpreadsheet className="mr-2 h-4 w-4" />
            Export All Reports
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <Card className="card-hover cursor-pointer">
          <CardContent className="p-3 text-center md:p-6">
            <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500 text-white md:mb-3 md:h-12 md:w-12">
              <GraduationCap className="h-5 w-5 md:h-6 md:w-6" />
            </div>
            <p className="text-sm font-medium md:text-base">Student Report</p>
            <p className="text-xs text-muted-foreground md:text-sm">
              Generate student reports
            </p>
          </CardContent>
        </Card>
        <Card className="card-hover cursor-pointer">
          <CardContent className="p-3 text-center md:p-6">
            <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-xl bg-green-500 text-white md:mb-3 md:h-12 md:w-12">
              <Users className="h-5 w-5 md:h-6 md:w-6" />
            </div>
            <p className="text-sm font-medium md:text-base">Attendance Report</p>
            <p className="text-xs text-muted-foreground md:text-sm">
              Monthly attendance stats
            </p>
          </CardContent>
        </Card>
        <Card className="card-hover cursor-pointer">
          <CardContent className="p-3 text-center md:p-6">
            <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-xl bg-yellow-500 text-white md:mb-3 md:h-12 md:w-12">
              <DollarSign className="h-5 w-5 md:h-6 md:w-6" />
            </div>
            <p className="text-sm font-medium md:text-base">Financial Report</p>
            <p className="text-xs text-muted-foreground md:text-sm">
              Fee collection status
            </p>
          </CardContent>
        </Card>
        <Card className="card-hover cursor-pointer">
          <CardContent className="p-3 text-center md:p-6">
            <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-xl bg-purple-500 text-white md:mb-3 md:h-12 md:w-12">
              <BarChart3 className="h-5 w-5 md:h-6 md:w-6" />
            </div>
            <p className="text-sm font-medium md:text-base">Performance Report</p>
            <p className="text-xs text-muted-foreground md:text-sm">
              Academic performance
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:gap-6 grid-cols-1 xl:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base sm:text-lg">Revenue Collected</CardTitle>
            <CardDescription className="text-xs sm:text-sm">Monthly fee collections this year</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[220px] sm:h-[260px] md:h-[300px]">
              {revenueChartData.length === 0 ? (
                <div className="h-full flex items-center justify-center text-sm text-muted-foreground">No payment data yet.</div>
              ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={revenueChartData}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    className="stroke-muted"
                  />
                  <XAxis dataKey="label" className="text-xs" />
                  <YAxis className="text-xs" tickFormatter={(v) => `₹${(v/1000).toFixed(0)}k`} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "8px",
                    }}
                    cursor={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="revenue"
                    stroke="#3b82f6"
                    strokeWidth={2}
                    name="Revenue"
                  />
                </LineChart>
              </ResponsiveContainer>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base sm:text-lg">Class Distribution</CardTitle>
            <CardDescription className="text-xs sm:text-sm">Students enrolled per class</CardDescription>
          </CardHeader>
          <CardContent>
            {gradeDistribution.length === 0 ? (
              <div className="h-[200px] flex items-center justify-center text-sm text-muted-foreground">No class data yet.</div>
            ) : (
              <>
                <div className="overflow-y-auto max-h-[220px]">
                  <div style={{ height: Math.max(200, gradeDistribution.length * 44) }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        layout="vertical"
                        data={gradeDistribution}
                        margin={{ top: 4, right: 40, bottom: 4, left: 8 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" horizontal={false} className="stroke-muted" />
                        <XAxis type="number" className="text-xs" tickFormatter={(v) => String(v)} allowDecimals={false} />
                        <YAxis
                          type="category"
                          dataKey="name"
                          width={90}
                          tick={{ fontSize: 12 }}
                          tickLine={false}
                          axisLine={false}
                        />
                        <Tooltip
                          cursor={{ fill: 'hsl(var(--muted))' }}
                          contentStyle={{
                            backgroundColor: 'hsl(var(--card))',
                            border: '1px solid hsl(var(--border))',
                            borderRadius: '8px',
                            fontSize: '12px',
                          }}
                          formatter={(value) => [value, 'Students']}
                        />
                        <Bar dataKey="value" radius={[0, 4, 4, 0]} label={{ position: 'right', fontSize: 11 }}>
                          {gradeDistribution.map((_, index) => (
                            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
                {/* Colour legend */}
                <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1.5">
                  {gradeDistribution.map((entry, index) => (
                    <div key={entry.name} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <span
                        className="inline-block h-2.5 w-2.5 rounded-sm flex-shrink-0"
                        style={{ backgroundColor: COLORS[index % COLORS.length] }}
                      />
                      {entry.name}
                    </div>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base sm:text-lg">Weekly Attendance Trends</CardTitle>
          <CardDescription className="text-xs sm:text-sm">Present vs Absent students</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-[220px] sm:h-[260px] md:h-[300px]">
            {attendanceChartData.length === 0 ? (
              <div className="h-full flex items-center justify-center text-sm text-muted-foreground">No attendance data for this week yet.</div>
            ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={attendanceChartData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="day" className="text-xs" />
                <YAxis className="text-xs" />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "8px",
                  }}
                  cursor={false}
                />
                <Bar
                  dataKey="present"
                  fill="#10b981"
                  radius={[4, 4, 0, 0]}
                  name="Present %"
                />
                <Bar
                  dataKey="absent"
                  fill="#ef4444"
                  radius={[4, 4, 0, 0]}
                  name="Absent %"
                />
              </BarChart>
            </ResponsiveContainer>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
