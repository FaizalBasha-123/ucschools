"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  BookOpen,
  Calendar,
  Clock,
  Edit,
  FileText,
  GraduationCap,
  Loader2,
  Plus,
  Search,
  Trash2,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";

interface SubjectOption {
  subject_id: string;
  subject_name: string;
}

interface ClassOption {
  class_id: string;
  class_name: string;
  class_level: string;
  subjects: SubjectOption[];
}

interface QuizItem {
  id: string;
  quiz_source: "tenant" | "global";
  title: string;
  class_id: string;
  class_name: string;
  subject_id: string;
  subject_name: string;
  chapter_name?: string;
  scheduled_at: string;
  is_anytime: boolean;
  duration_minutes: number;
  total_marks: number;
  question_count: number;
  status: "upcoming" | "completed";
  creator_role: "teacher" | "super_admin";
  creator_name: string;
  can_edit: boolean;
}

interface QuizChapter {
  id: string;
  class_id: string;
  subject_id: string;
  chapter_name: string;
  chapter_source?: "teacher" | "platform";
  can_edit?: boolean;
}

interface FormOption {
  option_text: string;
  is_correct: boolean;
}

interface FormQuestion {
  question_text: string;
  marks: number;
  options: FormOption[];
}

function defaultQuestion(): FormQuestion {
  return {
    question_text: "",
    marks: 1,
    options: [
      { option_text: "", is_correct: true },
      { option_text: "", is_correct: false },
    ],
  };
}

function formatScheduledAtForInputs(scheduledAt: string | undefined) {
  if (!scheduledAt) return { date: "", time: "09:00" };
  const parsed = new Date(scheduledAt);
  if (Number.isNaN(parsed.getTime())) return { date: "", time: "09:00" };
  return {
    date: scheduledAt.slice(0, 10),
    time: `${parsed.getUTCHours().toString().padStart(2, "0")}:${parsed.getUTCMinutes().toString().padStart(2, "0")}`,
  };
}

export default function QuizSchedulerPage() {
  const queryClient = useQueryClient();
  const [openCreate, setOpenCreate] = useState(false);
  const [openSubjectManagement, setOpenSubjectManagement] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [classFilter, setClassFilter] = useState("all");
  const [subjectFilter, setSubjectFilter] = useState("all");

  const [title, setTitle] = useState("");
  const [classID, setClassID] = useState("");
  const [subjectID, setSubjectID] = useState("");
  const [chapterName, setChapterName] = useState("");
  const [scheduledDate, setScheduledDate] = useState("");
  const [scheduledTime, setScheduledTime] = useState("09:00");
  const [isAnytime, setIsAnytime] = useState(false);
  const [durationMinutes, setDurationMinutes] = useState("30");
  const [totalMarks, setTotalMarks] = useState("0");
  const [questions, setQuestions] = useState<FormQuestion[]>([
    defaultQuestion(),
  ]);
  const createScheduleBackupRef = useRef<{ date: string; time: string } | null>(null);
  const [managementClassID, setManagementClassID] = useState("");
  const [managementSubjectID, setManagementSubjectID] = useState("");
  const [newChapterName, setNewChapterName] = useState("");
  const [editingChapterID, setEditingChapterID] = useState("");
  const [editingChapterName, setEditingChapterName] = useState("");

  // Edit quiz state
  const [openEdit, setOpenEdit] = useState(false);
  const [editQuiz, setEditQuiz] = useState<QuizItem | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editScheduledDate, setEditScheduledDate] = useState("");
  const [editScheduledTime, setEditScheduledTime] = useState("09:00");
  const [editIsAnytime, setEditIsAnytime] = useState(false);
  const [editDuration, setEditDuration] = useState("30");
  const editScheduleBackupRef = useRef<{ date: string; time: string } | null>(null);

  // Delete quiz state
  const [deleteQuizId, setDeleteQuizId] = useState<string | null>(null);

  // Add question dialog state
  const [openAddQ, setOpenAddQ] = useState(false);
  const [addQQuizId, setAddQQuizId] = useState<string | null>(null);
  const [addQQuestion, setAddQQuestion] = useState("");
  const [addQMarks, setAddQMarks] = useState(1);
  const [addQOptions, setAddQOptions] = useState<FormOption[]>([
    { option_text: "", is_correct: true },
    { option_text: "", is_correct: false },
  ]);
  const resetAddQ = () => {
    setAddQQuestion("");
    setAddQMarks(1);
    setAddQOptions([{ option_text: "", is_correct: true }, { option_text: "", is_correct: false }]);
  };

  const optionsQuery = useQuery({
    queryKey: ["teacher-quiz-options"],
    queryFn: () =>
      api.getOrEmpty<{ options: ClassOption[] }>("/teacher/quizzes/options", { options: [] }),
  });

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery.trim()), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const quizzesQuery = useQuery({
    queryKey: ["teacher-quizzes", classFilter, subjectFilter, debouncedSearch],
    queryFn: () => {
      const params = new URLSearchParams();
      params.set("page", "1");
      params.set("page_size", "100");
      if (classFilter !== "all") params.set("class_id", classFilter);
      if (subjectFilter !== "all") params.set("subject_id", subjectFilter);
      if (debouncedSearch) params.set("search", debouncedSearch);
      return api.getOrEmpty<{ quizzes: QuizItem[] }>(
        `/teacher/quizzes?${params.toString()}`,
        { quizzes: [] }
      );
    },
  });

  const classOptions = optionsQuery.data?.options || [];
  const selectedClass = useMemo(
    () => classOptions.find((c) => c.class_id === classID) || null,
    [classOptions, classID],
  );
  const subjectOptions = selectedClass?.subjects || [];
  const selectedManagementClass = useMemo(
    () => classOptions.find((c) => c.class_id === managementClassID) || null,
    [classOptions, managementClassID],
  );
  const managementSubjectOptions = selectedManagementClass?.subjects || [];
  const selectedFilterClass = useMemo(
    () => classOptions.find((c) => c.class_id === classFilter) || null,
    [classOptions, classFilter],
  );
  const subjectFilterOptions = selectedFilterClass?.subjects || [];
  const quizzes = quizzesQuery.data?.quizzes || [];

  const chapterOptionsQuery = useQuery({
    queryKey: ["teacher-quiz-chapters", classID, subjectID],
    enabled: !!classID && !!subjectID,
    queryFn: () => {
      const params = new URLSearchParams();
      params.set("class_id", classID);
      params.set("subject_id", subjectID);
      return api.getOrEmpty<{ chapters: QuizChapter[] }>(
        `/teacher/quizzes/chapters?${params.toString()}`,
        { chapters: [] }
      );
    },
  });

  const managedChapterQuery = useQuery({
    queryKey: [
      "teacher-quiz-managed-chapters",
      managementClassID,
      managementSubjectID,
    ],
    enabled: !!managementClassID && !!managementSubjectID,
    queryFn: () => {
      const params = new URLSearchParams();
      params.set("class_id", managementClassID);
      params.set("subject_id", managementSubjectID);
      params.set("include_platform", "true");
      return api.getOrEmpty<{ chapters: QuizChapter[] }>(
        `/teacher/quizzes/chapters?${params.toString()}`,
        { chapters: [] }
      );
    },
  });
  const chapterOptions = chapterOptionsQuery.data?.chapters || [];
  const managedChapters = managedChapterQuery.data?.chapters || [];

  const stats = useMemo(() => {
    const upcoming = quizzes.filter((q) => q.status === "upcoming").length;
    const completed = quizzes.filter((q) => q.status === "completed").length;
    return { upcoming, completed, total: quizzes.length };
  }, [quizzes]);

  const resetForm = () => {
    setTitle("");
    setClassID("");
    setSubjectID("");
    setChapterName("");
    setScheduledDate("");
    setScheduledTime("09:00");
    setIsAnytime(false);
    createScheduleBackupRef.current = null;
    setDurationMinutes("30");
    setTotalMarks("0");
    setQuestions([defaultQuestion()]);
  };

  const resetManagementForm = () => {
    setManagementClassID("");
    setManagementSubjectID("");
    setNewChapterName("");
    setEditingChapterID("");
    setEditingChapterName("");
  };

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!title.trim()) throw new Error("Quiz title is required");
      if (!classID) throw new Error("Class is required");
      if (!subjectID) throw new Error("Subject is required");
      if (!chapterName) throw new Error("Chapter is required");
      if (!isAnytime && !scheduledDate) throw new Error("Date is required");
      if (!isAnytime && !scheduledTime) throw new Error("Time is required");
      if (questions.length === 0) throw new Error("Add at least one question");

      const payload = {
        title: title.trim(),
        class_id: classID,
        subject_id: subjectID,
        chapter_name: chapterName,
        is_anytime: isAnytime,
        scheduled_at: isAnytime ? "" : `${scheduledDate}T${scheduledTime}:00Z`,
        duration_minutes: Number(durationMinutes || 30),
        total_marks: Number(totalMarks || 0),
        questions: questions.map((q) => ({
          question_text: q.question_text.trim(),
          marks: Number(q.marks || 1),
          options: q.options.map((o) => ({
            option_text: o.option_text.trim(),
            is_correct: !!o.is_correct,
          })),
        })),
      };

      return api.post<{ id: string; message: string }>(
        "/teacher/quizzes",
        payload,
      );
    },
    onSuccess: () => {
      toast.success("Quiz created");
      setOpenCreate(false);
      resetForm();
      queryClient.invalidateQueries({ queryKey: ["teacher-quizzes"] });
    },
    onError: (error: unknown) => {
      toast.error("Failed to create quiz", {
        description:
          error instanceof Error ? error.message : "Unexpected error",
      });
    },
  });

  const createChapterMutation = useMutation({
    mutationFn: async () => {
      if (!managementClassID) throw new Error("Class is required");
      if (!managementSubjectID) throw new Error("Subject is required");
      if (!newChapterName.trim()) throw new Error("Chapter name is required");
      return api.post<{ chapter: QuizChapter }>("/teacher/quizzes/chapters", {
        class_id: managementClassID,
        subject_id: managementSubjectID,
        chapter_name: newChapterName.trim(),
      });
    },
    onSuccess: () => {
      toast.success("Chapter saved");
      setNewChapterName("");
      queryClient.invalidateQueries({ queryKey: ["teacher-quiz-chapters"] });
      queryClient.invalidateQueries({
        queryKey: ["teacher-quiz-managed-chapters"],
      });
    },
    onError: (error: unknown) => {
      toast.error("Failed to save chapter", {
        description:
          error instanceof Error ? error.message : "Unexpected error",
      });
    },
  });

  const updateChapterMutation = useMutation({
    mutationFn: async () => {
      if (!editingChapterID) throw new Error("Chapter is required");
      if (!editingChapterName.trim())
        throw new Error("Chapter name is required");
      return api.put<{ chapter: QuizChapter }>(
        `/teacher/quizzes/chapters/${editingChapterID}`,
        {
          chapter_name: editingChapterName.trim(),
        },
      );
    },
    onSuccess: () => {
      toast.success("Chapter updated");
      setEditingChapterID("");
      setEditingChapterName("");
      queryClient.invalidateQueries({ queryKey: ["teacher-quiz-chapters"] });
      queryClient.invalidateQueries({
        queryKey: ["teacher-quiz-managed-chapters"],
      });
    },
    onError: (error: unknown) => {
      toast.error("Failed to update chapter", {
        description:
          error instanceof Error ? error.message : "Unexpected error",
      });
    },
  });

  const deleteChapterMutation = useMutation({
    mutationFn: (chapterID: string) =>
      api.delete(`/teacher/quizzes/chapters/${chapterID}`),
    onSuccess: () => {
      toast.success("Chapter removed");
      queryClient.invalidateQueries({ queryKey: ["teacher-quiz-chapters"] });
      queryClient.invalidateQueries({
        queryKey: ["teacher-quiz-managed-chapters"],
      });
    },
    onError: (error: unknown) => {
      toast.error("Failed to remove chapter", {
        description:
          error instanceof Error ? error.message : "Unexpected error",
      });
    },
  });

  const deleteQuizMutation = useMutation({
    mutationFn: (quizId: string) => api.delete(`/teacher/quizzes/${quizId}`),
    onSuccess: () => {
      toast.success("Quiz deleted");
      setDeleteQuizId(null);
      queryClient.invalidateQueries({ queryKey: ["teacher-quizzes"] });
    },
    onError: (error: unknown) => {
      toast.error("Failed to delete quiz", {
        description: error instanceof Error ? error.message : "Unexpected error",
      });
    },
  });

  const updateQuizMutation = useMutation({
    mutationFn: (payload: { id: string; title: string; scheduled_at: string; is_anytime: boolean; duration_minutes: number }) =>
      api.put(`/teacher/quizzes/${payload.id}`, {
        title: payload.title,
        scheduled_at: payload.scheduled_at,
        is_anytime: payload.is_anytime,
        duration_minutes: payload.duration_minutes,
      }),
    onSuccess: () => {
      toast.success("Quiz updated");
      setOpenEdit(false);
      setEditQuiz(null);
      queryClient.invalidateQueries({ queryKey: ["teacher-quizzes"] });
    },
    onError: (error: unknown) => {
      toast.error("Failed to update quiz", {
        description: error instanceof Error ? error.message : "Unexpected error",
      });
    },
  });

  const addQuestionMutation = useMutation({
    mutationFn: () => {
      if (!addQQuizId) throw new Error("No quiz selected");
      if (!addQQuestion.trim()) throw new Error("Question text required");
      if (addQOptions.length < 2) throw new Error("At least 2 options needed");
      if (!addQOptions.some((o) => o.is_correct)) throw new Error("Mark one option as correct");
      return api.post(`/teacher/quizzes/${addQQuizId}/questions`, {
        question_text: addQQuestion.trim(),
        marks: addQMarks,
        options: addQOptions.map((o) => ({ option_text: o.option_text.trim(), is_correct: o.is_correct })),
      });
    },
    onSuccess: () => {
      toast.success("Question added");
      setOpenAddQ(false);
      resetAddQ();
      queryClient.invalidateQueries({ queryKey: ["teacher-quizzes"] });
    },
    onError: (error: unknown) => {
      toast.error("Failed to add question", {
        description: error instanceof Error ? error.message : "Unexpected error",
      });
    },
  });

  const addQuestion = () => {
    setQuestions((prev) => [...prev, defaultQuestion()]);
  };

  const removeQuestion = (qIdx: number) => {
    setQuestions((prev) => prev.filter((_, idx) => idx !== qIdx));
  };

  const updateQuestionText = (qIdx: number, value: string) => {
    setQuestions((prev) =>
      prev.map((q, idx) => (idx === qIdx ? { ...q, question_text: value } : q)),
    );
  };

  const updateQuestionMarks = (qIdx: number, value: number) => {
    setQuestions((prev) =>
      prev.map((q, idx) => (idx === qIdx ? { ...q, marks: value } : q)),
    );
  };

  const addOption = (qIdx: number) => {
    setQuestions((prev) =>
      prev.map((q, idx) =>
        idx === qIdx
          ? {
              ...q,
              options: [...q.options, { option_text: "", is_correct: false }],
            }
          : q,
      ),
    );
  };

  const removeOption = (qIdx: number, oIdx: number) => {
    setQuestions((prev) =>
      prev.map((q, idx) => {
        if (idx !== qIdx) return q;
        const nextOptions = q.options.filter(
          (_, optionIdx) => optionIdx !== oIdx,
        );
        if (nextOptions.length === 1) {
          nextOptions[0].is_correct = true;
        } else if (
          !nextOptions.some((o) => o.is_correct) &&
          nextOptions.length > 0
        ) {
          nextOptions[0].is_correct = true;
        }
        return { ...q, options: nextOptions };
      }),
    );
  };

  const updateOptionText = (qIdx: number, oIdx: number, value: string) => {
    setQuestions((prev) =>
      prev.map((q, idx) => {
        if (idx !== qIdx) return q;
        return {
          ...q,
          options: q.options.map((o, optionIdx) =>
            optionIdx === oIdx ? { ...o, option_text: value } : o,
          ),
        };
      }),
    );
  };

  const setCorrectOption = (qIdx: number, oIdx: number) => {
    setQuestions((prev) =>
      prev.map((q, idx) => {
        if (idx !== qIdx) return q;
        return {
          ...q,
          options: q.options.map((o, optionIdx) => ({
            ...o,
            is_correct: optionIdx === oIdx,
          })),
        };
      }),
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl md:text-3xl font-bold">Quiz Scheduler</h1>
          <p className="text-muted-foreground">
            Create and schedule quizzes for your classes
          </p>
        </div>
        <div className="flex w-full sm:w-auto items-center gap-2 overflow-x-auto pb-1 sm:overflow-visible sm:pb-0">
          <Dialog
            open={openSubjectManagement}
            onOpenChange={(open) => {
              setOpenSubjectManagement(open);
              if (!open) resetManagementForm();
            }}
          >
            <DialogTrigger asChild>
              <Button variant="outline" className="shrink-0 whitespace-nowrap w-auto">
                <BookOpen className="mr-2 h-4 w-4" />
                Subject Management
              </Button>
            </DialogTrigger>
            <DialogContent className="w-[95vw] max-w-3xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Subject Management</DialogTitle>
                <DialogDescription>
                  Select class and subject, then add chapters for quiz creation.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label>Class</Label>
                    <Select
                      value={managementClassID}
                      onValueChange={(value) => {
                        setManagementClassID(value);
                        setManagementSubjectID("");
                        setEditingChapterID("");
                        setEditingChapterName("");
                      }}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select class" />
                      </SelectTrigger>
                      <SelectContent>
                        {classOptions.map((c) => (
                          <SelectItem key={c.class_id} value={c.class_id}>
                            {c.class_name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2">
                    <Label>Subject</Label>
                    <Select
                      value={managementSubjectID}
                      onValueChange={(value) => {
                        setManagementSubjectID(value);
                        setEditingChapterID("");
                        setEditingChapterName("");
                      }}
                      disabled={!managementClassID}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue
                          placeholder={
                            managementClassID
                              ? "Select subject"
                              : "Select class first"
                          }
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {managementSubjectOptions.map((s) => (
                          <SelectItem key={s.subject_id} value={s.subject_id}>
                            {s.subject_name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="flex flex-col sm:flex-row gap-2">
                  <Input
                    value={newChapterName}
                    onChange={(e) => setNewChapterName(e.target.value)}
                    placeholder="Add chapter name"
                    disabled={!managementClassID || !managementSubjectID}
                  />
                  <Button
                    className="w-full sm:w-auto"
                    type="button"
                    onClick={() => createChapterMutation.mutate()}
                    disabled={
                      !managementClassID ||
                      !managementSubjectID ||
                      createChapterMutation.isPending
                    }
                  >
                    {createChapterMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      "Add"
                    )}
                  </Button>
                </div>
                <div className="space-y-2">
                  {managedChapterQuery.isLoading ? (
                    <p className="text-sm text-muted-foreground">
                      Loading chapters...
                    </p>
                  ) : managedChapters.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No chapters yet.
                    </p>
                  ) : (
                    managedChapters.map((chapter) => (
                      <div
                        key={chapter.id}
                        className="flex flex-col sm:flex-row sm:items-center gap-2 border rounded-md p-2"
                      >
                        {editingChapterID === chapter.id ? (
                          <>
                            <Input
                              value={editingChapterName}
                              onChange={(e) =>
                                setEditingChapterName(e.target.value)
                              }
                            />
                            <Button
                              size="sm"
                              onClick={() => updateChapterMutation.mutate()}
                              disabled={updateChapterMutation.isPending}
                            >
                              Save
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                setEditingChapterID("");
                                setEditingChapterName("");
                              }}
                            >
                              Cancel
                            </Button>
                          </>
                        ) : (
                          <>
                            <span className="flex-1 flex items-center gap-2 min-w-0 break-words">
                              {chapter.chapter_name}
                              {chapter.chapter_source === "platform" ? (
                                <Badge variant="secondary">Platform</Badge>
                              ) : null}
                            </span>
                            <Button
                              size="icon"
                              variant="ghost"
                              disabled={chapter.chapter_source === "platform" || chapter.can_edit === false}
                              onClick={() => {
                                setEditingChapterID(chapter.id);
                                setEditingChapterName(chapter.chapter_name);
                              }}
                            >
                              <Edit className="h-4 w-4" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="text-destructive"
                              disabled={chapter.chapter_source === "platform" || chapter.can_edit === false || deleteChapterMutation.isPending}
                              onClick={() => {
                                const confirmed = window.confirm(
                                  "Delete this chapter and all linked quizzes?",
                                );
                                if (confirmed) {
                                  deleteChapterMutation.mutate(chapter.id);
                                }
                              }}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </DialogContent>
          </Dialog>
          <Dialog open={openCreate} onOpenChange={setOpenCreate}>
            <DialogTrigger asChild>
              <Button className="shrink-0 whitespace-nowrap w-auto">
                <Plus className="mr-2 h-4 w-4" />
                Create Quiz
              </Button>
            </DialogTrigger>
            <DialogContent className="w-[95vw] max-w-3xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Create New Quiz</DialogTitle>
                <DialogDescription>
                  Set up a new quiz for your students.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid gap-2">
                  <Label>Quiz Title</Label>
                  <Input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Enter quiz title"
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label>Class</Label>
                    <Select
                      value={classID}
                      onValueChange={(value) => {
                        setClassID(value);
                        setSubjectID("");
                        setChapterName("");
                      }}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select class" />
                      </SelectTrigger>
                      <SelectContent>
                        {classOptions.map((c) => (
                          <SelectItem key={c.class_id} value={c.class_id}>
                            {c.class_name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2">
                    <Label>Subject</Label>
                    <Select
                      value={subjectID}
                      onValueChange={(value) => {
                        setSubjectID(value);
                        setChapterName("");
                      }}
                      disabled={!classID}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue
                          placeholder={
                            classID ? "Select subject" : "Select class first"
                          }
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {subjectOptions.map((s) => (
                          <SelectItem key={s.subject_id} value={s.subject_id}>
                            {s.subject_name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2 sm:col-span-2">
                    <Label>Chapter</Label>
                    <Select
                      value={chapterName}
                      onValueChange={setChapterName}
                      disabled={!classID || !subjectID}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue
                          placeholder={
                            subjectID
                              ? "Select chapter"
                              : "Select subject first"
                          }
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {chapterOptions.map((chapter) => (
                          <SelectItem
                            key={chapter.id}
                            value={chapter.chapter_name}
                          >
                            {chapter.chapter_name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    id="create-anytime"
                    type="checkbox"
                    checked={isAnytime}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setIsAnytime(checked);
                      if (checked) {
                        createScheduleBackupRef.current = {
                          date: scheduledDate,
                          time: scheduledTime,
                        };
                        setScheduledDate("");
                        setScheduledTime("09:00");
                        return;
                      }

                      const backup = createScheduleBackupRef.current;
                      setScheduledDate(backup?.date || "");
                      setScheduledTime(backup?.time || "09:00");
                    }}
                    className="h-4 w-4"
                  />
                  <Label htmlFor="create-anytime">AnyTime</Label>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                  <div className="grid gap-2">
                    <Label>Date</Label>
                    <Input
                      type="date"
                      value={scheduledDate}
                      onChange={(e) => setScheduledDate(e.target.value)}
                      disabled={isAnytime}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label>Time</Label>
                    <Input
                      type="time"
                      value={scheduledTime}
                      onChange={(e) => setScheduledTime(e.target.value)}
                      disabled={isAnytime}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label>Duration (mins)</Label>
                    <Input
                      type="number"
                      min={1}
                      value={durationMinutes}
                      onChange={(e) => setDurationMinutes(e.target.value)}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label>Total Marks</Label>
                    <Input
                      type="number"
                      min={0}
                      value={totalMarks}
                      onChange={(e) => setTotalMarks(e.target.value)}
                    />
                  </div>
                </div>

                <div className="grid gap-3">
                  <div className="flex items-center justify-between">
                    <Label>Generate Question</Label>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={addQuestion}
                    >
                      <Plus className="mr-1 h-3 w-3" />
                      Add Question
                    </Button>
                  </div>
                  {questions.map((q, qIdx) => (
                    <Card key={`q-${qIdx}`}>
                      <CardContent className="p-4 space-y-3">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                          <Input
                            value={q.question_text}
                            onChange={(e) =>
                              updateQuestionText(qIdx, e.target.value)
                            }
                            placeholder={`Question ${qIdx + 1}`}
                          />
                          <Input
                            className="w-full sm:w-24"
                            type="number"
                            min={1}
                            value={q.marks}
                            onChange={(e) =>
                              updateQuestionMarks(
                                qIdx,
                                Number(e.target.value || 1),
                              )
                            }
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="text-destructive"
                            onClick={() => removeQuestion(qIdx)}
                            disabled={questions.length === 1}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                        <div className="space-y-2">
                          {q.options.map((opt, oIdx) => (
                            <div
                              key={`q-${qIdx}-o-${oIdx}`}
                              className="flex flex-col sm:flex-row sm:items-center gap-2"
                            >
                              <input
                                type="checkbox"
                                checked={opt.is_correct}
                                onChange={() => setCorrectOption(qIdx, oIdx)}
                                className="h-4 w-4"
                              />
                              <Input
                                value={opt.option_text}
                                onChange={(e) =>
                                  updateOptionText(qIdx, oIdx, e.target.value)
                                }
                                placeholder={`Option ${oIdx + 1}`}
                              />
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                onClick={() => removeOption(qIdx, oIdx)}
                                disabled={q.options.length <= 2}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          ))}
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            onClick={() => addOption(qIdx)}
                          >
                            <Plus className="mr-1 h-3 w-3" />
                            Add Option
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
              <DialogFooter className="flex-col sm:flex-row gap-2">
                <Button className="w-full sm:w-auto" variant="outline" onClick={() => setOpenCreate(false)}>
                  Cancel
                </Button>
                <Button
                  className="w-full sm:w-auto"
                  onClick={() => createMutation.mutate()}
                  disabled={createMutation.isPending}
                >
                  {createMutation.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Creating...
                    </>
                  ) : (
                    "Create Quiz"
                  )}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
            <div className="relative flex-1 min-w-0">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
                placeholder="Search by title, class or subject"
              />
            </div>
            <div className="flex w-full gap-3 overflow-x-auto pb-1 sm:grid sm:grid-cols-2 sm:overflow-visible sm:pb-0 lg:w-auto">
              <div className="min-w-[220px] sm:min-w-0">
                <Select
                  value={classFilter}
                  onValueChange={(value) => {
                    setClassFilter(value);
                    setSubjectFilter("all");
                  }}
                >
                  <SelectTrigger className="w-full whitespace-nowrap sm:w-[240px]">
                    <GraduationCap className="h-4 w-4 mr-2" />
                    <SelectValue placeholder="All Classes" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Classes</SelectItem>
                    {classOptions.map((opt) => (
                      <SelectItem key={opt.class_id} value={opt.class_id}>
                        {opt.class_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="min-w-[220px] sm:min-w-0">
                <Select
                  value={subjectFilter}
                  onValueChange={setSubjectFilter}
                  disabled={classFilter === "all"}
                >
                  <SelectTrigger className="w-full whitespace-nowrap sm:w-[240px]">
                    <FileText className="h-4 w-4 mr-2" />
                    <SelectValue
                      placeholder={
                        classFilter === "all"
                          ? "Select class first"
                          : "All Subjects"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Subjects</SelectItem>
                    {subjectFilterOptions.map((opt) => (
                      <SelectItem key={opt.subject_id} value={opt.subject_id}>
                        {opt.subject_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
        <Card>
          <CardContent className="p-4 md:p-6 text-center">
            <p className="text-xl md:text-3xl font-bold text-primary">
              {stats.upcoming}
            </p>
            <p className="text-sm text-muted-foreground">Scheduled</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 md:p-6 text-center">
            <p className="text-xl md:text-3xl font-bold text-blue-500">
              {stats.completed}
            </p>
            <p className="text-sm text-muted-foreground">Completed</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 md:p-6 text-center">
            <p className="text-xl md:text-3xl font-bold text-purple-500">
              {stats.total}
            </p>
            <p className="text-sm text-muted-foreground">Total Quizzes</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:gap-6 grid-cols-1 lg:grid-cols-2 xl:grid-cols-3">
        {quizzesQuery.isLoading ? (
          <Card className="md:col-span-2 lg:col-span-3">
            <CardContent className="p-4 md:p-8 text-center text-muted-foreground">
              Loading quizzes...
            </CardContent>
          </Card>
        ) : quizzes.length === 0 ? (
          <Card className="md:col-span-2 lg:col-span-3">
            <CardContent className="p-4 md:p-8 text-center text-muted-foreground">
              No quizzes found.
            </CardContent>
          </Card>
        ) : (
          quizzes.map((quiz) => (
            <Card key={quiz.id} className="card-hover">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <Badge variant="outline">
                    {quiz.is_anytime ? "Anytime" : "Scheduled"}
                  </Badge>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={!quiz.can_edit}
                      onClick={() => {
                        const scheduled = quiz.is_anytime ? { date: "", time: "09:00" } : formatScheduledAtForInputs(quiz.scheduled_at);
                        setEditQuiz(quiz);
                        setEditTitle(quiz.title);
                        setEditIsAnytime(!!quiz.is_anytime);
                        editScheduleBackupRef.current = scheduled;
                        setEditScheduledDate(scheduled.date);
                        setEditScheduledTime(scheduled.time);
                        setEditDuration(String(quiz.duration_minutes));
                        setOpenEdit(true);
                      }}
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={!quiz.can_edit}
                      className="text-destructive"
                      onClick={() => setDeleteQuizId(quiz.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <CardTitle className="text-lg">{quiz.title}</CardTitle>
                <CardDescription>
                  {quiz.subject_name}
                  {quiz.chapter_name ? ` • ${quiz.chapter_name}` : ""}
                </CardDescription>
                <p className="text-xs text-muted-foreground">By {quiz.creator_name} ({quiz.creator_role === "super_admin" ? "Super Admin" : "Teacher"})</p>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Users className="h-4 w-4" />
                    <span>{quiz.class_name}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Calendar className="h-4 w-4" />
                    <span>
                      {quiz.is_anytime ? "Anytime" : new Date(quiz.scheduled_at).toLocaleDateString()}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Clock className="h-4 w-4" />
                    <span>{quiz.duration_minutes} minutes</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <FileText className="h-4 w-4" />
                    <span>
                      {quiz.question_count} questions • {quiz.total_marks} marks
                    </span>
                  </div>
                </div>
                <div className="mt-4 pt-4 border-t">
                  <Button
                    variant="outline"
                    className="w-full"
                    disabled={!quiz.can_edit || quiz.status === "completed"}
                    onClick={() => {
                      if (quiz.can_edit && quiz.status !== "completed") {
                        setAddQQuizId(quiz.id);
                        setOpenAddQ(true);
                      }
                    }}
                  >
                    {quiz.can_edit && quiz.status !== "completed"
                      ? "Add Question"
                      : "Read Only"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {/* ── Edit Quiz Dialog ── */}
      <Dialog open={openEdit} onOpenChange={(v) => { setOpenEdit(v); if (!v) setEditQuiz(null); }}>
        <DialogContent className="w-[95vw] max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Quiz</DialogTitle>
            <DialogDescription>Update the quiz details below.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label>Title</Label>
              <Input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} placeholder="Quiz title" />
            </div>
            <div className="flex items-center gap-2">
              <input
                id="edit-anytime"
                type="checkbox"
                checked={editIsAnytime}
                onChange={(e) => {
                  const checked = e.target.checked;
                  setEditIsAnytime(checked);
                  if (checked) {
                    editScheduleBackupRef.current = {
                      date: editScheduledDate,
                      time: editScheduledTime,
                    };
                    setEditScheduledDate("");
                    setEditScheduledTime("09:00");
                    return;
                  }

                  const backup = editScheduleBackupRef.current;
                  setEditScheduledDate(backup?.date || "");
                  setEditScheduledTime(backup?.time || "09:00");
                }}
                className="h-4 w-4"
              />
              <Label htmlFor="edit-anytime">AnyTime</Label>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>Date</Label>
                <Input type="date" value={editScheduledDate} onChange={(e) => setEditScheduledDate(e.target.value)} disabled={editIsAnytime} />
              </div>
              <div className="grid gap-2">
                <Label>Time</Label>
                <Input type="time" value={editScheduledTime} onChange={(e) => setEditScheduledTime(e.target.value)} disabled={editIsAnytime} />
              </div>
            </div>
            <div className="grid gap-2">
              <Label>Duration (minutes)</Label>
              <Input type="number" min={1} value={editDuration} onChange={(e) => setEditDuration(e.target.value)} />
            </div>
          </div>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button className="w-full sm:w-auto" variant="outline" onClick={() => setOpenEdit(false)}>Cancel</Button>
            <Button
              className="w-full sm:w-auto"
              disabled={updateQuizMutation.isPending}
              onClick={() => {
                if (!editQuiz) return;
                if (!editIsAnytime && !editScheduledDate) {
                  toast.error("Date is required when Anytime is disabled");
                  return;
                }
                if (!editIsAnytime && !editScheduledTime) {
                  toast.error("Time is required when Anytime is disabled");
                  return;
                }
                updateQuizMutation.mutate({
                  id: editQuiz.id,
                  title: editTitle,
                  scheduled_at: editIsAnytime ? "" : (editScheduledDate ? `${editScheduledDate}T${editScheduledTime || "09:00"}:00Z` : ""),
                  is_anytime: editIsAnytime,
                  duration_minutes: Number(editDuration) || 30,
                });
              }}
            >
              {updateQuizMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete Confirm Dialog ── */}
      <Dialog open={!!deleteQuizId} onOpenChange={(v) => { if (!v) setDeleteQuizId(null); }}>
        <DialogContent className="w-[95vw] max-w-sm max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Delete Quiz?</DialogTitle>
            <DialogDescription>This will permanently delete the quiz and all its questions. This action cannot be undone.</DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4 flex-col sm:flex-row gap-2">
            <Button className="w-full sm:w-auto" variant="outline" onClick={() => setDeleteQuizId(null)}>Cancel</Button>
            <Button
              className="w-full sm:w-auto"
              variant="destructive"
              disabled={deleteQuizMutation.isPending}
              onClick={() => { if (deleteQuizId) deleteQuizMutation.mutate(deleteQuizId); }}
            >
              {deleteQuizMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Add Question Dialog ── */}
      <Dialog open={openAddQ} onOpenChange={(v) => { setOpenAddQ(v); if (!v) { resetAddQ(); setAddQQuizId(null); } }}>
        <DialogContent className="w-[95vw] max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add Question</DialogTitle>
            <DialogDescription>Add a new question with options to this quiz.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label>Question Text</Label>
              <Input value={addQQuestion} onChange={(e) => setAddQQuestion(e.target.value)} placeholder="Enter question..." />
            </div>
            <div className="grid gap-2">
              <Label>Marks</Label>
              <Input type="number" min={1} value={addQMarks} onChange={(e) => setAddQMarks(Number(e.target.value))} />
            </div>
            <div className="grid gap-2">
              <Label>Options <span className="text-muted-foreground text-xs">(click radio to mark correct)</span></Label>
              <div className="space-y-2">
                {addQOptions.map((opt, oIdx) => (
                  <div key={oIdx} className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="correct-option"
                      checked={opt.is_correct}
                      onChange={() => setAddQOptions((prev) => prev.map((o, i) => ({ ...o, is_correct: i === oIdx })))}
                      className="accent-primary"
                    />
                    <Input
                      value={opt.option_text}
                      onChange={(e) => setAddQOptions((prev) => prev.map((o, i) => i === oIdx ? { ...o, option_text: e.target.value } : o))}
                      placeholder={`Option ${oIdx + 1}`}
                    />
                    {addQOptions.length > 2 && (
                      <Button variant="ghost" size="icon" onClick={() => setAddQOptions((prev) => prev.filter((_, i) => i !== oIdx))}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
              <Button variant="outline" size="sm" className="w-fit" onClick={() => setAddQOptions((prev) => [...prev, { option_text: "", is_correct: false }])}>
                <Plus className="h-4 w-4 mr-1" /> Add Option
              </Button>
            </div>
          </div>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button className="w-full sm:w-auto" variant="outline" onClick={() => { setOpenAddQ(false); resetAddQ(); }}>Cancel</Button>
            <Button disabled={addQuestionMutation.isPending} onClick={() => addQuestionMutation.mutate()}>
              {addQuestionMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Add Question
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
