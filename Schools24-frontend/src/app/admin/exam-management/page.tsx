"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Plus, Pencil, Trash2, Loader2, BookOpenCheck, CalendarDays, Info } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useClasses } from "@/hooks/useClasses";

const ASSESSMENT_TYPES = [
  "FA-1", "SA-1",
  "FA-2", "SA-2",
  "FA-3", "SA-3",
  "FA-4", "SA-4",
] as const;

const normalizeAssessmentType = (value: string | undefined | null): string =>
  ASSESSMENT_TYPES.includes(value as (typeof ASSESSMENT_TYPES)[number])
    ? (value as string)
    : "FA-1";

interface AssessmentSubjectMark {
  id?: string;
  subject_name?: string;
  subject_label?: string;
  total_marks: number;
  breakdowns: AssessmentMarkBreakdown[];
}

interface AssessmentMarkBreakdown {
  id?: string;
  title: string;
  marks: number;
}

interface AssessmentItem {
  id: string;
  name: string;
  assessment_type: string;
  class_name?: string;
  class_grades?: number[];
  class_ids?: string[];
  class_labels?: string[];
  scheduled_date?: string;
  academic_year: string;
  total_marks: number;
  subject_marks: AssessmentSubjectMark[];
}

interface AssessmentFormState {
  name: string;
  assessment_type: string;
  class_ids: string[];
  scheduled_date: string;
  subject_marks: AssessmentSubjectMark[];
}

interface ExamTimetableSubjectOption {
  class_id: string;
  subject_id: string;
  name: string;
  code: string;
}

interface ExamTimetableEntry {
  id: string;
  subject_id: string;
  subject: string;
  exam_date: string;
}

interface ExamTimetableResponse {
  class_name: string;
  subjects: ExamTimetableSubjectOption[];
  entries: ExamTimetableEntry[];
}

interface AdmissionSettingsResponse {
  global_academic_year: string;
}

const emptyForm = (): AssessmentFormState => ({
  name: "",
  assessment_type: "FA-1",
  class_ids: [],
  scheduled_date: "",
  subject_marks: [{ total_marks: 0, breakdowns: [] }],
});

const singleSubject = (
  subjectMarks?: AssessmentSubjectMark[],
): AssessmentSubjectMark[] => {
  if (!subjectMarks || subjectMarks.length === 0) {
    return [{ total_marks: 0, breakdowns: [] }];
  }
  const first = subjectMarks[0];
  return [
    {
      ...first,
      total_marks: Number(first.total_marks || 0),
      breakdowns: (first.breakdowns || []).map((b) => ({
        id: b.id,
        title: b.title,
        marks: Number(b.marks || 0),
      })),
    },
  ];
};

const getCurrentAcademicYear = () => {
  const now = new Date();
  const y = now.getFullYear();
  if (now.getMonth() + 1 < 4) return `${y - 1}-${y}`;
  return `${y}-${y + 1}`;
};

const TYPE_COLORS: Record<string, string> = {
  "FA-1": "bg-blue-100 text-blue-700",
  "FA-2": "bg-blue-100 text-blue-700",
  "FA-3": "bg-blue-100 text-blue-700",
  "FA-4": "bg-blue-100 text-blue-700",
  "SA-1": "bg-purple-100 text-purple-700",
  "SA-2": "bg-purple-100 text-purple-700",
  "SA-3": "bg-purple-100 text-purple-700",
  "SA-4": "bg-purple-100 text-purple-700",
};

function MobileStatInfo({ label }: { label: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Show ${label}`}
          className="sm:hidden inline-flex h-6 w-6 items-center justify-center rounded-md hover:bg-muted"
        >
          <Info className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="end" className="sm:hidden w-auto max-w-[180px] px-3 py-2 text-xs font-medium leading-5">
        {label}
      </PopoverContent>
    </Popover>
  );
}

export default function ExamManagementPage() {
  const queryClient = useQueryClient();
  const [selectedYear, setSelectedYear] = useState("");
  const [isAssessmentFormOpen, setIsAssessmentFormOpen] = useState(false);
  const [editingAssessment, setEditingAssessment] = useState<AssessmentItem | null>(null);
  const [form, setForm] = useState<AssessmentFormState>(emptyForm());
  const [examDateBySubject, setExamDateBySubject] = useState<Record<string, string>>({});

  const { data: classesData, isLoading: classesLoading } = useClasses(selectedYear || undefined);

  const settingsQuery = useQuery({
    queryKey: ["admin-admission-settings"],
    queryFn: () => api.get<AdmissionSettingsResponse>("/admin/settings/admissions"),
  });

  const platformAcademicYear = (settingsQuery.data?.global_academic_year || "").trim();

  useEffect(() => {
    if (!selectedYear && platformAcademicYear) {
      setSelectedYear(platformAcademicYear);
    }
  }, [platformAcademicYear, selectedYear]);

  useEffect(() => {
    if (!selectedYear && !platformAcademicYear && !settingsQuery.isLoading) {
      setSelectedYear(getCurrentAcademicYear());
    }
  }, [platformAcademicYear, selectedYear, settingsQuery.isLoading]);

  const classOptions = useMemo(() => {
    const byName = new Map<string, { label: string; ids: string[] }>();
    (classesData?.classes || []).forEach((c) => {
      const normalizedName = c.name?.trim();
      const key = normalizedName?.toLowerCase() || `grade-${c.grade ?? "unknown"}`;
      const label = normalizedName || (c.grade != null ? `Grade ${c.grade}` : "Unnamed Class");
      if (byName.has(key)) {
        byName.get(key)!.ids.push(c.id);
      } else {
        byName.set(key, { label, ids: [c.id] });
      }
    });
    return Array.from(byName.entries()).map(([name, { label, ids }]) => ({ name, label, ids }));
  }, [classesData?.classes]);

  const assessmentsQuery = useQuery({
    queryKey: ["admin-assessments", selectedYear],
    enabled: !!selectedYear,
    queryFn: () =>
      api.get<{ assessments: AssessmentItem[] }>(
        `/admin/assessments?academic_year=${selectedYear}`,
      ),
  });
  const assessments = assessmentsQuery.data?.assessments || [];

  const selectedSingleClassGrade =
    form.class_ids.length === 1
      ? (() => {
          const id = form.class_ids[0];
          const cls = classesData?.classes?.find((c) => c.id === id);
          return cls?.grade ?? null;
        })()
      : null;

  const examTimetableQuery = useQuery({
    queryKey: ["assessment-exam-timetable", editingAssessment?.id, selectedSingleClassGrade],
    enabled: !!editingAssessment?.id && selectedSingleClassGrade !== null,
    queryFn: () =>
      api.get<ExamTimetableResponse>(
        `/admin/assessments/${editingAssessment?.id}/exam-timetable?class_grade=${selectedSingleClassGrade}`,
      ),
  });

  const examTimetableMutation = useMutation({
    mutationFn: () => {
      if (!editingAssessment?.id || selectedSingleClassGrade === null) {
        throw new Error("Select exactly one class and edit an assessment first");
      }
      const subjects = examTimetableQuery.data?.subjects || [];
      const entries = subjects
        .map((subject) => ({
          subject_id: subject.subject_id,
          exam_date: examDateBySubject[subject.subject_id],
        }))
        .filter((entry) => entry.exam_date);
      if (entries.length === 0) throw new Error("Select at least one exam date");
      return api.put(`/admin/assessments/${editingAssessment.id}/exam-timetable`, {
        class_grade: selectedSingleClassGrade,
        entries,
      });
    },
    onSuccess: () => {
      toast.success("Exam timetable updated");
      queryClient.invalidateQueries({ queryKey: ["assessment-exam-timetable", editingAssessment?.id] });
      queryClient.invalidateQueries({ queryKey: ["events"] });
    },
    onError: (error: unknown) => {
      toast.error("Failed to update exam timetable", {
        description: error instanceof Error ? error.message : "Unexpected error",
      });
    },
  });

  const totalFormMarks = useMemo(
    () => form.subject_marks.reduce((sum, item) => sum + Number(item.total_marks || 0), 0),
    [form.subject_marks],
  );

  const createAssessmentMutation = useMutation({
    mutationFn: () =>
      api.post("/admin/assessments", {
        ...form,
        academic_year: selectedYear,
        subject_marks: singleSubject(form.subject_marks).map((item) => ({
          total_marks: Number(item.total_marks || 0),
          breakdowns: (item.breakdowns || []).map((b) => ({ title: b.title, marks: Number(b.marks || 0) })),
        })),
      }),
    onSuccess: () => {
      toast.success("Assessment created");
      setIsAssessmentFormOpen(false);
      setForm(emptyForm());
      queryClient.invalidateQueries({ queryKey: ["admin-assessments"] });
    },
    onError: (error: unknown) => {
      toast.error("Failed to create assessment", {
        description: error instanceof Error ? error.message : "Unexpected error",
      });
    },
  });

  const updateAssessmentMutation = useMutation({
    mutationFn: () =>
      api.put(`/admin/assessments/${editingAssessment?.id}`, {
        ...form,
        academic_year: selectedYear,
        subject_marks: singleSubject(form.subject_marks).map((item) => ({
          total_marks: Number(item.total_marks || 0),
          breakdowns: (item.breakdowns || []).map((b) => ({ title: b.title, marks: Number(b.marks || 0) })),
        })),
      }),
    onSuccess: () => {
      toast.success("Assessment updated");
      setIsAssessmentFormOpen(false);
      setEditingAssessment(null);
      setForm(emptyForm());
      queryClient.invalidateQueries({ queryKey: ["admin-assessments"] });
    },
    onError: (error: unknown) => {
      toast.error("Failed to update assessment", {
        description: error instanceof Error ? error.message : "Unexpected error",
      });
    },
  });

  const deleteAssessmentMutation = useMutation({
    mutationFn: (assessmentID: string) => api.delete(`/admin/assessments/${assessmentID}`),
    onSuccess: () => {
      toast.success("Assessment deleted");
      queryClient.invalidateQueries({ queryKey: ["admin-assessments"] });
    },
    onError: (error: unknown) => {
      toast.error("Failed to delete assessment", {
        description: error instanceof Error ? error.message : "Unexpected error",
      });
    },
  });

  const openCreateAssessment = () => {
    setEditingAssessment(null);
    setForm(emptyForm());
    setExamDateBySubject({});
    setIsAssessmentFormOpen(true);
  };

  const openEditAssessment = (item: AssessmentItem) => {
    setEditingAssessment(item);
    setForm({
      name: item.name || "",
      assessment_type: normalizeAssessmentType(item.assessment_type),
      class_ids: item.class_ids || [],
      scheduled_date: item.scheduled_date ? String(item.scheduled_date).slice(0, 10) : "",
      subject_marks: singleSubject(item.subject_marks),
    });
    setExamDateBySubject({});
    setIsAssessmentFormOpen(true);
  };

  const examEntryDateBySubject = useMemo(() => {
    const map: Record<string, string> = {};
    (examTimetableQuery.data?.entries || []).forEach((entry) => {
      map[entry.subject_id] = entry.exam_date;
    });
    return map;
  }, [examTimetableQuery.data?.entries]);

  const submitAssessment = () => {
    if (!form.name.trim() || !form.assessment_type.trim() || form.class_ids.length === 0) {
      toast.error("Missing required fields");
      return;
    }
    if (form.subject_marks.length === 0) {
      toast.error("At least one subject mark breakdown is required");
      return;
    }
    for (const row of form.subject_marks) {
      if (Number(row.total_marks) <= 0) {
        toast.error("Each subject row must have total marks > 0");
        return;
      }
      const breakdownTotal = (row.breakdowns || []).reduce((sum, item) => sum + Number(item.marks || 0), 0);
      if (breakdownTotal > Number(row.total_marks || 0)) {
        toast.error("Breakdown marks cannot exceed total marks per subject");
        return;
      }
    }
    if (editingAssessment) {
      updateAssessmentMutation.mutate();
      const hasExamDates = Object.values(examDateBySubject).some(Boolean);
      if (selectedSingleClassGrade !== null && hasExamDates) {
        examTimetableMutation.mutate();
      }
      return;
    }
    createAssessmentMutation.mutate();
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl md:text-3xl font-bold">Exam Management</h1>
          <p className="text-sm md:text-base text-muted-foreground">Manage assessments and exam timetables</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <div className="rounded-md border bg-muted/30 px-2.5 py-1.5 sm:px-3 sm:py-2 text-right">
            <p className="text-[11px] sm:text-sm font-semibold leading-none">
              {settingsQuery.isLoading
                ? "Loading..."
                : (platformAcademicYear || selectedYear || "Not configured")}
            </p>
          </div>
          <Button size="sm" className="h-8 sm:h-9 px-3 sm:px-4 text-xs sm:text-sm" onClick={openCreateAssessment}>
            <Plus className="h-3.5 w-3.5 sm:h-4 sm:w-4 mr-1.5 sm:mr-2" />
            Add
          </Button>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-2 sm:gap-4">
        <Card>
          <CardContent className="relative p-2.5 sm:p-4 md:p-6">
            <div className="absolute top-2.5 right-2.5 sm:hidden">
              <MobileStatInfo label="Total Assessments" />
            </div>
            <div className="flex items-center gap-2 sm:gap-3 md:gap-4">
              <div className="flex h-8 w-8 sm:h-10 sm:w-10 md:h-12 md:w-12 items-center justify-center rounded-lg sm:rounded-xl bg-purple-500 text-white flex-shrink-0">
                <BookOpenCheck className="h-4 w-4 sm:h-5 sm:w-5 md:h-6 md:w-6" />
              </div>
              <div className="min-w-0">
                <p className="font-bold leading-none tabular-nums text-[clamp(1rem,5vw,1.5rem)]">{assessments.length}</p>
                <div className="mt-0.5 flex items-center gap-1">
                  <p className="hidden sm:block text-[10px] sm:text-xs md:text-sm text-muted-foreground leading-tight">Total Assessments</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="relative p-2.5 sm:p-4 md:p-6">
            <div className="absolute top-2.5 right-2.5 sm:hidden">
              <MobileStatInfo label="Formative Assessments" />
            </div>
            <div className="flex items-center gap-2 sm:gap-3 md:gap-4">
              <div className="flex h-8 w-8 sm:h-10 sm:w-10 md:h-12 md:w-12 items-center justify-center rounded-lg sm:rounded-xl bg-blue-500 text-white flex-shrink-0">
                <CalendarDays className="h-4 w-4 sm:h-5 sm:w-5 md:h-6 md:w-6" />
              </div>
              <div className="min-w-0">
                <p className="font-bold leading-none tabular-nums text-[clamp(1rem,5vw,1.5rem)]">
                  {assessments.filter((a) => a.assessment_type?.startsWith("FA")).length}
                </p>
                <div className="mt-0.5 flex items-center gap-1">
                  <p className="hidden sm:block text-[10px] sm:text-xs md:text-sm text-muted-foreground leading-tight">Formative Assessments</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="relative p-2.5 sm:p-4 md:p-6">
            <div className="absolute top-2.5 right-2.5 sm:hidden">
              <MobileStatInfo label="Summative Assessments" />
            </div>
            <div className="flex items-center gap-2 sm:gap-3 md:gap-4">
              <div className="flex h-8 w-8 sm:h-10 sm:w-10 md:h-12 md:w-12 items-center justify-center rounded-lg sm:rounded-xl bg-green-500 text-white flex-shrink-0">
                <BookOpenCheck className="h-4 w-4 sm:h-5 sm:w-5 md:h-6 md:w-6" />
              </div>
              <div className="min-w-0">
                <p className="font-bold leading-none tabular-nums text-[clamp(1rem,5vw,1.5rem)]">
                  {assessments.filter((a) => a.assessment_type?.startsWith("SA")).length}
                </p>
                <div className="mt-0.5 flex items-center gap-1">
                  <p className="hidden sm:block text-[10px] sm:text-xs md:text-sm text-muted-foreground leading-tight">Summative Assessments</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Assessment list */}
      <Card>
        <CardHeader>
          <CardTitle>Assessments — {selectedYear}</CardTitle>
          <CardDescription>All configured assessments for the selected academic year.</CardDescription>
        </CardHeader>
        <CardContent>
          {assessmentsQuery.isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : assessments.length === 0 ? (
            <div className="py-16 text-center">
              <BookOpenCheck className="h-12 w-12 mx-auto text-muted-foreground/40 mb-3" />
              <p className="text-muted-foreground">No assessments found for {selectedYear}.</p>
              <Button variant="outline" className="mt-4" onClick={openCreateAssessment}>
                <Plus className="h-4 w-4 mr-2" />
                Add First Assessment
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {assessments.map((item) => (
                <Card key={item.id} className="border border-border/60">
                  <CardContent className="p-4">
                    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                      <div className="space-y-1.5 flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-semibold truncate">{item.name}</p>
                          <Badge
                            className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                              TYPE_COLORS[item.assessment_type] || "bg-gray-100 text-gray-700"
                            }`}
                            variant="outline"
                          >
                            {item.assessment_type}
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {(item.class_labels && item.class_labels.length
                            ? item.class_labels.join(", ")
                            : item.class_name || "No Class") +
                            " • " +
                            item.academic_year}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          Date:{" "}
                          {item.scheduled_date ? String(item.scheduled_date).slice(0, 10) : "Not set"}{" "}
                          • Total Marks: {item.total_marks}
                        </p>
                        {item.subject_marks?.length ? (
                          <div className="text-xs text-muted-foreground">
                            {item.subject_marks
                              .map((sm) => `${sm.subject_label || "Subject"}: ${sm.total_marks}`)
                              .join(" | ")}
                          </div>
                        ) : null}
                      </div>
                      <div className="flex gap-2 flex-shrink-0">
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-9 w-9"
                          onClick={() => openEditAssessment(item)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-9 w-9 text-destructive hover:text-destructive"
                          onClick={() => {
                            if (window.confirm("Delete this assessment?")) {
                              deleteAssessmentMutation.mutate(item.id);
                            }
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Assessment Form Dialog */}
      <Dialog
        open={isAssessmentFormOpen}
        onOpenChange={(open) => {
          setIsAssessmentFormOpen(open);
          if (!open) {
            setEditingAssessment(null);
            setForm(emptyForm());
          }
        }}
      >
        <DialogContent className="w-[95vw] max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingAssessment ? "Edit Assessment" : "Add Assessment"}</DialogTitle>
            <DialogDescription>Define assessment and subject-wise marks breakdown.</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label>Classes</Label>
              <div className="rounded-md border p-3">
                {classesLoading ? (
                  <p className="text-sm text-muted-foreground">Loading classes...</p>
                ) : classOptions.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No classes found for {selectedYear || "the selected academic year"}.
                  </p>
                ) : (
                  <div className="grid max-h-44 grid-cols-1 gap-2 overflow-y-auto pr-1 sm:grid-cols-2 xl:grid-cols-4">
                    {classOptions.map((item) => {
                      const checked = item.ids.some((id) => form.class_ids.includes(id));
                      return (
                        <label key={`class-name-${item.name}`} className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              const isChecked = e.target.checked;
                              setForm((prev) => ({
                                ...prev,
                                class_ids: isChecked
                                  ? [...prev.class_ids.filter((id) => !item.ids.includes(id)), ...item.ids]
                                  : prev.class_ids.filter((id) => !item.ids.includes(id)),
                              }));
                            }}
                          />
                          <span>{item.label}</span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>Assessment Name</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                  placeholder="e.g., Half Yearly Exam"
                />
              </div>
              <div className="grid gap-2">
                <Label>Assessment Type</Label>
                <Select
                  value={form.assessment_type}
                  onValueChange={(val) => setForm((prev) => ({ ...prev, assessment_type: val }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    {ASSESSMENT_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>{t}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>Scheduled Date</Label>
                <Input
                  type="date"
                  value={form.scheduled_date}
                  onChange={(e) => setForm((prev) => ({ ...prev, scheduled_date: e.target.value }))}
                />
              </div>
            </div>

            <div className="space-y-3">
              <Label>Subject Marks Breakdown</Label>
              {(() => {
                const row = form.subject_marks[0] || { total_marks: 0, breakdowns: [] };
                return (
                  <div className="border rounded-md p-3 space-y-3">
                    <div className="grid grid-cols-1 xl:grid-cols-[180px_auto] gap-3 items-end">
                      <div className="grid gap-1">
                        <Label className="text-xs">Total Marks</Label>
                        <Input
                          type="number"
                          min={1}
                          value={row.total_marks}
                          onChange={(e) =>
                            setForm((prev) => ({
                              ...prev,
                              subject_marks: [
                                {
                                  ...(prev.subject_marks[0] || { total_marks: 0, breakdowns: [] }),
                                  total_marks: Number(e.target.value || 0),
                                },
                              ],
                            }))
                          }
                        />
                      </div>
                      <div className="flex items-end justify-end">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="w-full sm:w-auto"
                          onClick={() =>
                            setForm((prev) => ({
                              ...prev,
                              subject_marks: [
                                {
                                  ...(prev.subject_marks[0] || { total_marks: 0, breakdowns: [] }),
                                  breakdowns: [...(prev.subject_marks[0]?.breakdowns || []), { title: "", marks: 0 }],
                                },
                              ],
                            }))
                          }
                        >
                          <Plus className="h-3 w-3 mr-1" />
                          Add Breakdown
                        </Button>
                      </div>
                    </div>

                    {(row.breakdowns || []).map((breakdown, breakdownIdx) => (
                      <div
                        key={`breakdown-${breakdownIdx}`}
                        className="grid grid-cols-1 xl:grid-cols-[1fr_140px_44px] gap-2 items-end"
                      >
                        <div className="grid gap-1">
                          <Label className="text-xs">Breakdown Title</Label>
                          <Input
                            value={breakdown.title}
                            onChange={(e) =>
                              setForm((prev) => ({
                                ...prev,
                                subject_marks: [
                                  {
                                    ...(prev.subject_marks[0] || { total_marks: 0, breakdowns: [] }),
                                    breakdowns: (prev.subject_marks[0]?.breakdowns || []).map(
                                      (existing, existingIdx) =>
                                        existingIdx === breakdownIdx
                                          ? { ...existing, title: e.target.value }
                                          : existing,
                                    ),
                                  },
                                ],
                              }))
                            }
                            placeholder="e.g., Theory"
                          />
                        </div>
                        <div className="grid gap-1">
                          <Label className="text-xs">Marks</Label>
                          <Input
                            type="number"
                            min={1}
                            value={breakdown.marks}
                            onChange={(e) =>
                              setForm((prev) => ({
                                ...prev,
                                subject_marks: [
                                  {
                                    ...(prev.subject_marks[0] || { total_marks: 0, breakdowns: [] }),
                                    breakdowns: (prev.subject_marks[0]?.breakdowns || []).map(
                                      (existing, existingIdx) =>
                                        existingIdx === breakdownIdx
                                          ? { ...existing, marks: Number(e.target.value || 0) }
                                          : existing,
                                    ),
                                  },
                                ],
                              }))
                            }
                          />
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="text-destructive w-full sm:w-9"
                          onClick={() =>
                            setForm((prev) => ({
                              ...prev,
                              subject_marks: [
                                {
                                  ...(prev.subject_marks[0] || { total_marks: 0, breakdowns: [] }),
                                  breakdowns: (prev.subject_marks[0]?.breakdowns || []).filter(
                                    (_, existingIdx) => existingIdx !== breakdownIdx,
                                  ),
                                },
                              ],
                            }))
                          }
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}

                    <div className="text-xs text-muted-foreground">
                      Breakdown Total:{" "}
                      {(row.breakdowns || []).reduce((sum, item) => sum + Number(item.marks || 0), 0)} /{" "}
                      {Number(row.total_marks || 0)}
                    </div>
                  </div>
                );
              })()}
              <div className="text-sm font-medium">Total Marks: {totalFormMarks}</div>
            </div>

            <div className="space-y-3 border rounded-md p-3">
              <Label>Exam Timetable</Label>
              {selectedSingleClassGrade === null ? (
                <p className="text-sm text-muted-foreground">Select only one class to use this feature.</p>
              ) : !editingAssessment?.id ? (
                <p className="text-sm text-muted-foreground">Save assessment first to configure exam timetable.</p>
              ) : examTimetableQuery.isLoading ? (
                <p className="text-sm text-muted-foreground">Loading subjects...</p>
              ) : (examTimetableQuery.data?.subjects || []).length === 0 ? (
                <p className="text-sm text-muted-foreground">No subjects found for selected class.</p>
              ) : (
                <div className="space-y-2">
                  {(examTimetableQuery.data?.subjects || []).map((subject) => (
                    <div
                      key={`exam-subject-${subject.subject_id}`}
                      className="grid grid-cols-1 lg:grid-cols-[1fr_180px] gap-2 items-center"
                    >
                      <div className="text-sm">
                        <span className="font-medium">{subject.name}</span>{" "}
                        <span className="text-muted-foreground">({subject.code})</span>
                      </div>
                      <Input
                        type="date"
                        value={
                          examDateBySubject[subject.subject_id] ||
                          examEntryDateBySubject[subject.subject_id] ||
                          ""
                        }
                        onChange={(e) =>
                          setExamDateBySubject((prev) => ({ ...prev, [subject.subject_id]: e.target.value }))
                        }
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" className="w-full sm:w-auto" onClick={() => setIsAssessmentFormOpen(false)}>
              Cancel
            </Button>
            <Button
              className="w-full sm:w-auto"
              onClick={submitAssessment}
              disabled={
                createAssessmentMutation.isPending ||
                updateAssessmentMutation.isPending ||
                examTimetableMutation.isPending
              }
            >
              {createAssessmentMutation.isPending ||
              updateAssessmentMutation.isPending ||
              examTimetableMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : editingAssessment ? (
                "Save Changes"
              ) : (
                "Create Assessment"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
