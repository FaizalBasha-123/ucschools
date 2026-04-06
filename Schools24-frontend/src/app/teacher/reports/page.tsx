"use client";

import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Upload, Eye, Download, FileText } from "lucide-react";
import { api } from "@/lib/api";
import { toast } from "sonner";

interface TeacherReportAssessment {
  id: string;
  name: string;
  assessment_type: string;
  academic_year: string;
  total_marks: number;
  class_ids: string[];
  scheduled_date?: string;
}

interface TeacherReportClass {
  class_id: string;
  class_name: string;
  grade?: number | null;
  subjects?: { subject_id: string; subject_name: string }[];
}

interface TeacherReportOptionsResponse {
  current_academic_year?: string;
  assessments: TeacherReportAssessment[];
  classes: TeacherReportClass[];
}

interface TeacherReportStudentMark {
  student_id: string;
  full_name: string;
  roll_number: string;
  marks_obtained?: number;
  remarks?: string;
  breakdown_marks?: {
    assessment_mark_breakdown_id: string;
    marks_obtained: number;
  }[];
}

interface TeacherReportBreakdownItem {
  assessment_mark_breakdown_id: string;
  title: string;
  max_marks: number;
}

interface TeacherReportMarksSheet {
  assessment_id: string;
  class_id: string;
  subject_id: string;
  subject_name: string;
  class_name: string;
  total_marks: number;
  breakdowns?: TeacherReportBreakdownItem[];
  students: TeacherReportStudentMark[];
}

interface ClassStudent {
  id: string;
  full_name: string;
  roll_number?: string;
}

interface StudentIndividualReport {
  id: string;
  class_id: string;
  class_name?: string;
  student_id: string;
  student_name?: string;
  title: string;
  report_type?: string;
  academic_year?: string;
  description?: string;
  file_name: string;
  file_size: number;
  mime_type: string;
  uploaded_at: string;
}

interface StudentReportsPage {
  reports: StudentIndividualReport[];
  page: number;
  page_size: number;
  has_more: boolean;
  next_page: number;
}

function formatFileSize(bytes: number) {
  if (!bytes) return "0 Bytes";
  const units = ["Bytes", "KB", "MB", "GB"];
  let n = bytes;
  let idx = 0;
  while (n >= 1024 && idx < units.length - 1) {
    n /= 1024;
    idx += 1;
  }
  return `${n.toFixed(idx === 0 ? 0 : 2)} ${units[idx]}`;
}

const getCurrentAcademicYear = () => {
  const now = new Date();
  const y = now.getFullYear();
  if (now.getMonth() + 1 < 4) return `${y - 1}-${y}`;
  return `${y}-${y + 1}`;
};

export default function TeacherReportsPage() {
  const queryClient = useQueryClient();
  const [academicYear, setAcademicYear] = useState(getCurrentAcademicYear());
  const [selectedAssessmentID, setSelectedAssessmentID] = useState("");
  const [selectedClassID, setSelectedClassID] = useState("");
  const [selectedSubjectID, setSelectedSubjectID] = useState("");
  const [draftMarks, setDraftMarks] = useState<
    Record<
      string,
      {
        remarks: string;
        marks_obtained: number;
        breakdown_marks: Record<string, number>;
      }
    >
  >({});
  // ─── Student Individual Reports state ─────────────────────────────────────
  const studentReportFileRef = useRef<HTMLInputElement>(null);
  const [studentUploaderOpen, setStudentUploaderOpen] = useState(false);
  const [srClassID, setSrClassID] = useState("");
  const [srStudentID, setSrStudentID] = useState("");
  const [srTitle, setSrTitle] = useState("");
  const [srReportType, setSrReportType] = useState("report");
  const [srDescription, setSrDescription] = useState("");
  const [srFile, setSrFile] = useState<File | null>(null);
  const [srFilterClassID, setSrFilterClassID] = useState("");
  const [srFilterType, setSrFilterType] = useState("all");
  // ──────────────────────────────────────────────────────────────────────────

  const optionsQuery = useQuery({
    queryKey: ["teacher-report-options", academicYear],
    queryFn: () =>
      api.getOrEmpty<TeacherReportOptionsResponse>(
        `/teacher/reports/options?academic_year=${academicYear}`,
        { assessments: [], classes: [] }
      ),
  });

  const selectedAssessment = useMemo(
    () =>
      (optionsQuery.data?.assessments || []).find(
        (item) => item.id === selectedAssessmentID,
      ),
    [optionsQuery.data?.assessments, selectedAssessmentID],
  );

  const filteredClasses = useMemo(() => {
    const classes = optionsQuery.data?.classes || [];
    if (!selectedAssessment) return classes;
    return classes.filter((item) =>
      (selectedAssessment.class_ids || []).includes(item.class_id),
    );
  }, [optionsQuery.data?.classes, selectedAssessment]);
  const filteredSubjects = useMemo(() => {
    if (!selectedClassID) return [];
    return (
      filteredClasses.find((item) => item.class_id === selectedClassID)?.subjects || []
    );
  }, [filteredClasses, selectedClassID]);

  const marksSheetQuery = useQuery({
    queryKey: [
      "teacher-report-marks-sheet",
      selectedAssessmentID,
      selectedClassID,
      selectedSubjectID,
    ],
    enabled: !!selectedAssessmentID && !!selectedClassID && !!selectedSubjectID,
    queryFn: () =>
      api.getOrEmpty<TeacherReportMarksSheet>(
        `/teacher/reports/marks-sheet?assessment_id=${selectedAssessmentID}&class_id=${selectedClassID}&subject_id=${selectedSubjectID}`,
        { assessment_id: '', class_id: '', subject_id: '', subject_name: '', class_name: '', total_marks: 0, students: [] }
      ),
  });

  // ─── Student individual report queries ────────────────────────────────────
  const allClasses = optionsQuery.data?.classes || [];
  const currentAcademicYear = (
    optionsQuery.data?.current_academic_year || getCurrentAcademicYear()
  ).trim();

  const classStudentsQuery = useQuery({
    queryKey: ["teacher-class-students", srClassID],
    enabled: !!srClassID,
    queryFn: () =>
      api.getOrEmpty<{ students: ClassStudent[] }>(`/teacher/classes/${srClassID}/students`, { students: [] }),
  });

  const studentReportsQuery = useQuery({
    queryKey: ["teacher-student-reports", srFilterClassID],
    queryFn: () => {
      const params = new URLSearchParams({ page: "1", page_size: "50", order: "desc" });
      if (srFilterClassID) params.set("class_id", srFilterClassID);
      return api.getOrEmpty<StudentReportsPage>(`/teacher/student-reports?${params}`, { reports: [], page: 1, page_size: 50, has_more: false, next_page: 0 });
    },
  });

  const filteredStudentReports = useMemo(() => {
    const reports = studentReportsQuery.data?.reports || [];
    if (srFilterType === "all") return reports;
    return reports.filter((item) => (item.report_type || "report") === srFilterType);
  }, [studentReportsQuery.data?.reports, srFilterType]);

  const reportStats = useMemo(() => {
    const reports = studentReportsQuery.data?.reports || [];
    return {
      assessments: (optionsQuery.data?.assessments || []).length,
      classes: allClasses.length,
      uploadedReports: reports.length,
    };
  }, [allClasses.length, optionsQuery.data?.assessments, studentReportsQuery.data?.reports]);

  const uploadStudentReportMutation = useMutation({
    mutationFn: async () => {
      if (!srFile) throw new Error("Choose a file first");
      if (!srClassID) throw new Error("Select a class first");
      if (!srStudentID) throw new Error("Select a student first");
      const fd = new FormData();
      fd.append("file", srFile);
      fd.append("class_id", srClassID);
      fd.append("student_id", srStudentID);
      const selectedStudent = (classStudentsQuery.data?.students || []).find(
        (s) => s.id === srStudentID,
      );
      if (selectedStudent) fd.append("student_name", selectedStudent.full_name);
      fd.append("title", srTitle.trim() || srFile.name.replace(/\.[^.]+$/, ""));
      fd.append("report_type", srReportType);
      fd.append("academic_year", currentAcademicYear);
      fd.append("description", srDescription.trim());

      return api.postForm("/teacher/student-reports", fd);
    },
    onSuccess: () => {
      toast.success("Student report uploaded successfully");
      setSrClassID("");
      setSrStudentID("");
      setSrTitle("");
      setSrReportType("report");
      setSrDescription("");
      setSrFile(null);
      if (studentReportFileRef.current) studentReportFileRef.current.value = "";
      setStudentUploaderOpen(false);
      queryClient.invalidateQueries({ queryKey: ["teacher-student-reports"] });
    },
    onError: (error: unknown) => {
      toast.error("Failed to upload report", {
        description: error instanceof Error ? error.message : "Unexpected error",
      });
    },
  });

  const fetchStudentReportBlob = async (id: string, mode: "view" | "download") => {
    return api.fetchBlob(`/teacher/student-reports/${id}/${mode}`);
  };

  const handleViewStudentReport = async (report: StudentIndividualReport) => {
    try {
      const blob = await fetchStudentReportBlob(report.id, "view");
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener,noreferrer");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      toast.error("Unable to open report", { description: e instanceof Error ? e.message : "Unexpected error" });
    }
  };

  const handleDownloadStudentReport = async (report: StudentIndividualReport) => {
    try {
      const blob = await fetchStudentReportBlob(report.id, "download");
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = report.file_name || report.title;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error("Unable to download report", { description: e instanceof Error ? e.message : "Unexpected error" });
    }
  };
  // ──────────────────────────────────────────────────────────────────────────

  const saveMarksMutation = useMutation({
    mutationFn: () => {
      if (!selectedAssessmentID || !selectedClassID || !selectedSubjectID) {
        throw new Error("Select assessment, class and subject");
      }
      const students = marksSheetQuery.data?.students || [];
      const breakdowns = marksSheetQuery.data?.breakdowns || [];
      const entries = students.map((student) => {
        const draft = draftMarks[student.student_id];
        const baseBreakdownMap = Object.fromEntries(
          (student.breakdown_marks || []).map((item) => [
            item.assessment_mark_breakdown_id,
            Number(item.marks_obtained || 0),
          ]),
        );
        const breakdownMap = {
          ...baseBreakdownMap,
          ...(draft?.breakdown_marks || {}),
        };
        const breakdownEntries = breakdowns.map((item) => ({
          assessment_mark_breakdown_id: item.assessment_mark_breakdown_id,
          marks_obtained: Number(breakdownMap[item.assessment_mark_breakdown_id] || 0),
        }));
        const computedTotal = breakdownEntries.reduce(
          (sum, item) => sum + item.marks_obtained,
          0,
        );
        return {
          student_id: student.student_id,
          marks_obtained:
            breakdowns.length > 0
              ? computedTotal
              : typeof draft?.marks_obtained === "number"
                ? draft.marks_obtained
                : Number(student.marks_obtained || 0),
          remarks:
            typeof draft?.remarks === "string"
              ? draft.remarks
              : student.remarks || "",
          breakdown_marks: breakdownEntries,
        };
      });
      return api.put("/teacher/reports/marks-sheet", {
        assessment_id: selectedAssessmentID,
        class_id: selectedClassID,
        subject_id: selectedSubjectID,
        entries,
      });
    },
    onSuccess: () => {
      toast.success("Marks saved");
      setDraftMarks({});
      queryClient.invalidateQueries({
        queryKey: [
          "teacher-report-marks-sheet",
          selectedAssessmentID,
          selectedClassID,
          selectedSubjectID,
        ],
      });
    },
    onError: (error: unknown) => {
      toast.error("Failed to save marks", {
        description:
          error instanceof Error ? error.message : "Unexpected error",
      });
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col xl:flex-row xl:items-start xl:justify-between gap-3">
        <div>
          <h1 className="text-xl md:text-3xl font-bold">Report Management</h1>
          <p className="text-muted-foreground">
            Upload marks and individual student reports.
          </p>
        </div>
        <div className="flex w-full lg:w-auto gap-2">
          <Button className="w-full sm:w-auto" onClick={() => setStudentUploaderOpen(true)}>
            <Upload className="h-4 w-4 mr-2" />
            Upload Student Report
          </Button>
        </div>
      </div>

      <div className="grid gap-4 grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardContent className="p-4 md:p-5">
            <p className="text-xs text-muted-foreground">Configured Academic Year</p>
            <p className="text-lg md:text-2xl font-semibold">{currentAcademicYear || "-"}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 md:p-5">
            <p className="text-xs text-muted-foreground">Assessments</p>
            <p className="text-lg md:text-2xl font-semibold">{reportStats.assessments}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 md:p-5">
            <p className="text-xs text-muted-foreground">Classes in Scope</p>
            <p className="text-lg md:text-2xl font-semibold">{reportStats.classes}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 md:p-5">
            <p className="text-xs text-muted-foreground">Uploaded Student Reports</p>
            <p className="text-lg md:text-2xl font-semibold">{reportStats.uploadedReports}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Marks Workspace</CardTitle>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Select Assessment</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <div className="space-y-2">
            <Label>Academic Year</Label>
            <Input
              value={currentAcademicYear}
              readOnly
            />
          </div>
          <div className="space-y-2">
            <Label>Assessment</Label>
            <Select
              value={selectedAssessmentID}
              onValueChange={(value) => {
                setSelectedAssessmentID(value);
                setSelectedClassID("");
                setSelectedSubjectID("");
                setDraftMarks({});
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select assessment" />
              </SelectTrigger>
              <SelectContent>
                {(optionsQuery.data?.assessments || []).map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.name} ({item.assessment_type})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Class</Label>
            <Select
              value={selectedClassID}
              onValueChange={(value) => {
                setSelectedClassID(value);
                setSelectedSubjectID("");
                setDraftMarks({});
              }}
              disabled={!selectedAssessmentID}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select class" />
              </SelectTrigger>
              <SelectContent>
                {filteredClasses.map((item) => (
                  <SelectItem key={item.class_id} value={item.class_id}>
                    {item.class_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Subject</Label>
            <Select
              value={selectedSubjectID}
              onValueChange={(value) => {
                setSelectedSubjectID(value);
                setDraftMarks({});
              }}
              disabled={!selectedClassID}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select subject" />
              </SelectTrigger>
              <SelectContent>
                {filteredSubjects.map((item) => (
                  <SelectItem key={item.subject_id} value={item.subject_id}>
                    {item.subject_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Marks Upload</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!selectedAssessmentID || !selectedClassID || !selectedSubjectID ? (
            <p className="text-sm text-muted-foreground">
              Select assessment, class and subject to load students.
            </p>
          ) : marksSheetQuery.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading marks sheet...
            </div>
          ) : marksSheetQuery.isError ? (
            <p className="text-sm text-destructive">
              Failed to load marks sheet. Please try again.
            </p>
          ) : (marksSheetQuery.data?.students || []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No students found for this class.</p>
          ) : (
            <>
              {/* Assessment / subject summary */}
              <div className="rounded-md border bg-muted/40 px-4 py-3 space-y-2">
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                  <span>
                    <span className="text-muted-foreground">Assessment: </span>
                    <span className="font-medium">
                      {(optionsQuery.data?.assessments || []).find(
                        (a) => a.id === selectedAssessmentID,
                      )?.name ?? "—"}
                    </span>
                  </span>
                  <span>
                    <span className="text-muted-foreground">Class: </span>
                    <span className="font-medium">
                      {marksSheetQuery.data?.class_name ?? "—"}
                    </span>
                  </span>
                  <span>
                    <span className="text-muted-foreground">Subject: </span>
                    <span className="font-medium">
                      {marksSheetQuery.data?.subject_name ?? "—"}
                    </span>
                  </span>
                  <span>
                    <span className="text-muted-foreground">Total Marks: </span>
                    <span className="font-medium">
                      {marksSheetQuery.data?.total_marks ?? 0}
                    </span>
                  </span>
                </div>
              </div>

              {/* Student marks table */}
              {(() => {
                const breakdowns = marksSheetQuery.data?.breakdowns || [];
                const hasBreakdowns = breakdowns.length > 0;

                return (
                  <div className="rounded-md border overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-muted/50">
                          <th className="text-left px-3 py-2 font-medium min-w-[160px]">
                            Student
                          </th>
                          <th className="text-left px-3 py-2 font-medium w-20">
                            Roll
                          </th>
                          {hasBreakdowns ? (
                            <>
                              {breakdowns.map((bd) => (
                                <th
                                  key={bd.assessment_mark_breakdown_id}
                                  className="text-left px-3 py-2 font-medium min-w-[120px]"
                                >
                                  <div>{bd.title}</div>
                                  <div className="text-xs font-normal text-muted-foreground">
                                    max {bd.max_marks}
                                  </div>
                                </th>
                              ))}
                              <th className="text-left px-3 py-2 font-medium w-20">
                                <div>Total</div>
                                <div className="text-xs font-normal text-muted-foreground">
                                  / {marksSheetQuery.data?.total_marks ?? 0}
                                </div>
                              </th>
                            </>
                          ) : (
                            <th className="text-left px-3 py-2 font-medium min-w-[120px]">
                              <div>Marks</div>
                              <div className="text-xs font-normal text-muted-foreground">
                                / {marksSheetQuery.data?.total_marks ?? 0}
                              </div>
                            </th>
                          )}
                          <th className="text-left px-3 py-2 font-medium min-w-[160px]">
                            Remarks
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {(marksSheetQuery.data?.students || []).map(
                          (student) => {
                            const draft = draftMarks[student.student_id];
                            const baseBreakdownMap = Object.fromEntries(
                              (student.breakdown_marks || []).map((item) => [
                                item.assessment_mark_breakdown_id,
                                Number(item.marks_obtained || 0),
                              ]),
                            );
                            const breakdownMap =
                              draft?.breakdown_marks || baseBreakdownMap;
                            const computedTotal = hasBreakdowns
                              ? breakdowns.reduce(
                                  (sum, item) =>
                                    sum +
                                    Number(
                                      breakdownMap[
                                        item.assessment_mark_breakdown_id
                                      ] || 0,
                                    ),
                                  0,
                                )
                              : typeof draft?.marks_obtained === "number"
                                ? draft.marks_obtained
                                : Number(student.marks_obtained || 0);
                            const remarks =
                              typeof draft?.remarks === "string"
                                ? draft.remarks
                                : student.remarks || "";

                            return (
                              <tr
                                key={student.student_id}
                                className="border-b last:border-0 hover:bg-muted/30 transition-colors"
                              >
                                <td className="px-3 py-2 font-medium">
                                  {student.full_name}
                                </td>
                                <td className="px-3 py-2 text-muted-foreground">
                                  {student.roll_number || "—"}
                                </td>
                                {hasBreakdowns ? (
                                  <>
                                    {breakdowns.map((bd) => (
                                      <td
                                        key={bd.assessment_mark_breakdown_id}
                                        className="px-3 py-2"
                                      >
                                        <Input
                                          type="number"
                                          min={0}
                                          max={bd.max_marks}
                                          className="h-8 w-24"
                                          value={Number(
                                            breakdownMap[
                                              bd.assessment_mark_breakdown_id
                                            ] || 0,
                                          )}
                                          onChange={(e) => {
                                            const val = Number(
                                              e.target.value || 0,
                                            );
                                            setDraftMarks((prev) => ({
                                              ...prev,
                                              [student.student_id]: {
                                                marks_obtained: computedTotal,
                                                remarks,
                                                breakdown_marks: {
                                                  ...breakdownMap,
                                                  [bd.assessment_mark_breakdown_id]:
                                                    val,
                                                },
                                              },
                                            }));
                                          }}
                                        />
                                      </td>
                                    ))}
                                    <td className="px-3 py-2">
                                      <span className="font-semibold tabular-nums">
                                        {computedTotal}
                                      </span>
                                    </td>
                                  </>
                                ) : (
                                  <td className="px-3 py-2">
                                    <Input
                                      type="number"
                                      min={0}
                                      max={marksSheetQuery.data?.total_marks ?? 100}
                                      className="h-8 w-24"
                                      value={computedTotal}
                                      onChange={(e) =>
                                        setDraftMarks((prev) => ({
                                          ...prev,
                                          [student.student_id]: {
                                            remarks,
                                            marks_obtained: Number(
                                              e.target.value || 0,
                                            ),
                                            breakdown_marks: breakdownMap,
                                          },
                                        }))
                                      }
                                    />
                                  </td>
                                )}
                                <td className="px-3 py-2">
                                  <Input
                                    value={remarks}
                                    placeholder="Optional remarks"
                                    className="h-8"
                                    onChange={(e) =>
                                      setDraftMarks((prev) => ({
                                        ...prev,
                                        [student.student_id]: {
                                          marks_obtained: computedTotal,
                                          remarks: e.target.value,
                                          breakdown_marks: breakdownMap,
                                        },
                                      }))
                                    }
                                  />
                                </td>
                              </tr>
                            );
                          },
                        )}
                      </tbody>
                    </table>
                  </div>
                );
              })()}

              <div className="flex justify-stretch sm:justify-end pt-1">
                <Button
                  className="w-full sm:w-auto"
                  onClick={() => saveMarksMutation.mutate()}
                  disabled={saveMarksMutation.isPending}
                >
                  {saveMarksMutation.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    "Save Marks"
                  )}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Student Individual Reports Card */}
      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <CardTitle>Student-wise Uploaded Reports</CardTitle>
            <div className="flex items-center gap-2">
              <Select
                value={srFilterClassID || "__all__"}
                onValueChange={(v) => setSrFilterClassID(v === "__all__" ? "" : v)}
              >
                <SelectTrigger className="w-full sm:w-44">
                  <SelectValue placeholder="Filter by class" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All classes</SelectItem>
                  {allClasses.map((c) => (
                    <SelectItem key={c.class_id} value={c.class_id}>
                      {c.class_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={srFilterType} onValueChange={setSrFilterType}>
                <SelectTrigger className="w-full sm:w-44">
                  <SelectValue placeholder="Filter by type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All types</SelectItem>
                  <SelectItem value="report">Report Card</SelectItem>
                  <SelectItem value="progress">Progress Report</SelectItem>
                  <SelectItem value="result">Result Sheet</SelectItem>
                  <SelectItem value="certificate">Certificate</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {studentReportsQuery.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading student reports...
            </div>
          ) : studentReportsQuery.isError ? (
            <p className="text-sm text-destructive">Failed to load student reports.</p>
          ) : filteredStudentReports.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No student-specific reports uploaded yet. Use the &quot;Student Report&quot; button to upload one.
            </p>
          ) : (
            <div className="rounded-md border overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 border-b">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">Student</th>
                    <th className="text-left px-3 py-2 font-medium">Class</th>
                    <th className="text-left px-3 py-2 font-medium">Title</th>
                    <th className="text-left px-3 py-2 font-medium">Type</th>
                    <th className="text-left px-3 py-2 font-medium">Academic Year</th>
                    <th className="text-left px-3 py-2 font-medium">File</th>
                    <th className="text-left px-3 py-2 font-medium">Uploaded</th>
                    <th className="text-right px-3 py-2 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredStudentReports.map((item) => (
                    <tr key={item.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                      <td className="px-3 py-2 font-medium">{item.student_name || "—"}</td>
                      <td className="px-3 py-2">{item.class_name || "—"}</td>
                      <td className="px-3 py-2">{item.title}</td>
                      <td className="px-3 py-2 capitalize">{item.report_type || "report"}</td>
                      <td className="px-3 py-2">{item.academic_year || "—"}</td>
                      <td className="px-3 py-2">
                        <div className="flex flex-col">
                          <span>{item.file_name}</span>
                          <span className="text-xs text-muted-foreground">{formatFileSize(item.file_size)}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2">{new Date(item.uploaded_at).toLocaleDateString()}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center justify-end gap-2">
                          <Button size="sm" variant="outline" onClick={() => handleViewStudentReport(item)}>
                            <Eye className="h-4 w-4 mr-2" />
                            View
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => handleDownloadStudentReport(item)}>
                            <Download className="h-4 w-4 mr-2" />
                            Download
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Student Report Upload Dialog */}
      <Dialog open={studentUploaderOpen} onOpenChange={(open) => {
        setStudentUploaderOpen(open);
        if (!open) {
          setSrClassID("");
          setSrStudentID("");
          setSrTitle("");
          setSrReportType("report");
          setSrDescription("");
          setSrFile(null);
          if (studentReportFileRef.current) studentReportFileRef.current.value = "";
        }
      }}>
        <DialogContent className="w-[95vw] max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Upload Student Report</DialogTitle>
            <DialogDescription>
              Upload an individual report document for a specific student. Only that student can view it.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Class <span className="text-destructive">*</span></Label>
                <Select value={srClassID} onValueChange={(v) => { setSrClassID(v); setSrStudentID(""); }}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select class" />
                  </SelectTrigger>
                  <SelectContent>
                    {allClasses.map((c) => (
                      <SelectItem key={c.class_id} value={c.class_id}>{c.class_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Student <span className="text-destructive">*</span></Label>
                <Select value={srStudentID} onValueChange={setSrStudentID} disabled={!srClassID}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={srClassID ? (classStudentsQuery.isLoading ? "Loading..." : "Select student") : "Select class first"} />
                  </SelectTrigger>
                  <SelectContent>
                    {(classStudentsQuery.data?.students || []).map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.full_name}{s.roll_number ? ` (${s.roll_number})` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Title</Label>
              <Input
                value={srTitle}
                onChange={(e) => setSrTitle(e.target.value)}
                placeholder="e.g., Term 1 Result — English"
              />
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Report Type</Label>
                <Select value={srReportType} onValueChange={setSrReportType}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="report">Report Card</SelectItem>
                    <SelectItem value="progress">Progress Report</SelectItem>
                    <SelectItem value="result">Result Sheet</SelectItem>
                    <SelectItem value="certificate">Certificate</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Academic Year</Label>
                <Input
                  value={currentAcademicYear}
                  readOnly
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Description (Optional)</Label>
              <Textarea
                value={srDescription}
                onChange={(e) => setSrDescription(e.target.value)}
                placeholder="Additional notes"
              />
            </div>

            <input
              ref={studentReportFileRef}
              type="file"
              className="hidden"
              accept=".pdf,.doc,.docx,.ppt,.pptx,.txt,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              onChange={(e) => {
                const file = e.target.files?.[0] || null;
                setSrFile(file);
                if (file && !srTitle.trim()) {
                  setSrTitle(file.name.replace(/\.[^.]+$/, ""));
                }
              }}
            />

            <div className="rounded-md border p-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="text-sm min-w-0">
                {srFile ? (
                  <div className="min-w-0">
                    <p className="truncate font-medium">{srFile.name}</p>
                    <p className="text-xs text-muted-foreground">{formatFileSize(srFile.size)}</p>
                  </div>
                ) : (
                  <p className="text-muted-foreground">Allowed: PDF, DOC, DOCX, PPT, PPTX, TXT (max 25 MB)</p>
                )}
              </div>
              <Button className="w-full sm:w-auto" variant="outline" onClick={() => studentReportFileRef.current?.click()}>
                <FileText className="h-4 w-4 mr-2" />
                Choose File
              </Button>
            </div>

            <Button
              className="w-full"
              onClick={() => uploadStudentReportMutation.mutate()}
              disabled={uploadStudentReportMutation.isPending || !srClassID || !srStudentID || !srFile}
            >
              {uploadStudentReportMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Uploading...
                </>
              ) : (
                <>
                  <Upload className="h-4 w-4 mr-2" />
                  Upload Report for Student
                </>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}


