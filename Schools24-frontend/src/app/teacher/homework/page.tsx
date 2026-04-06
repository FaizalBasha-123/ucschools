"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { BookOpen, Calendar, Eye, GraduationCap, Loader2, Pencil, Plus, Search, Trash2, Upload, Users, XCircle } from "lucide-react"
import { toast } from "sonner"
import { api } from "@/lib/api"

interface HomeworkSubjectOption {
  subject_id: string
  subject_name: string
}

interface HomeworkClassOption {
  class_id: string
  class_name: string
  class_level: string
  subjects: HomeworkSubjectOption[]
}

interface HomeworkAttachment {
  id: string
  file_name?: string
  file_size?: number
  mime_type?: string
}

interface HomeworkItem {
  id: string
  title: string
  description?: string
  class_id: string
  class_name: string
  subject_id?: string
  subject_name?: string
  due_date: string
  max_marks: number
  submissions_count: number
  students_count: number
  attachment_count: number
  has_attachments: boolean
  attachments: HomeworkAttachment[]
  created_at: string
}

interface HomeworkSubmissionEntry {
  student_id: string
  student_name: string
  roll_number?: string
  submitted_at: string
  status: string
  marks_obtained?: number | null
  feedback?: string
}

interface HomeworkSubmissionsResponse {
  homework_id: string
  title: string
  submissions_count: number
  students_count: number
  submissions: HomeworkSubmissionEntry[]
}

function formatDate(iso: string) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleDateString()
}

function formatDateTime(iso: string) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString()
}

function toDateInputValue(iso: string | undefined): string {
  if (!iso) return ""
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  return d.toISOString().split("T")[0]
}

function formatFileSize(bytes?: number) {
  if (!bytes || bytes <= 0) return ""
  const units = ["B", "KB", "MB", "GB"]
  let size = bytes
  let idx = 0
  while (size >= 1024 && idx < units.length - 1) {
    size /= 1024
    idx++
  }
  return `${size.toFixed(idx === 0 ? 0 : 1)} ${units[idx]}`
}

export default function HomeworkPage() {
  const queryClient = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const editFileInputRef = useRef<HTMLInputElement>(null)

  const [openAssign, setOpenAssign] = useState(false)
  const [viewHomework, setViewHomework] = useState<HomeworkItem | null>(null)

  // edit dialog
  const [editHomework, setEditHomework] = useState<HomeworkItem | null>(null)
  const [editTitle, setEditTitle] = useState("")
  const [editDescription, setEditDescription] = useState("")
  const [editDueDate, setEditDueDate] = useState("")
  const [editMaxMarks, setEditMaxMarks] = useState("100")
  const [editFiles, setEditFiles] = useState<File[]>([])

  // delete confirm
  const [deleteTarget, setDeleteTarget] = useState<HomeworkItem | null>(null)

  const [searchQuery, setSearchQuery] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [classFilter, setClassFilter] = useState("all")
  const [subjectFilter, setSubjectFilter] = useState("all")

  const [title, setTitle] = useState("")
  const [classId, setClassId] = useState("")
  const [subjectId, setSubjectId] = useState("")
  const [dueDate, setDueDate] = useState("")
  const [description, setDescription] = useState("")
  const [maxMarks, setMaxMarks] = useState("100")
  const [files, setFiles] = useState<File[]>([])
  const [dragActive, setDragActive] = useState(false)

  const optionsQuery = useQuery({
    queryKey: ["teacher-homework-options"],
    queryFn: () => api.getOrEmpty<{ options: HomeworkClassOption[] }>("/teacher/homework/options", { options: [] }),
  })

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery.trim()), 300)
    return () => clearTimeout(timer)
  }, [searchQuery])

  const listQuery = useQuery({
    queryKey: ["teacher-homework-list", classFilter, subjectFilter, debouncedSearch],
    queryFn: () => {
      const params = new URLSearchParams()
      params.set("page", "1")
      params.set("page_size", "100")
      if (classFilter !== "all") params.set("class_id", classFilter)
      if (subjectFilter !== "all") params.set("subject_id", subjectFilter)
      if (debouncedSearch) params.set("search", debouncedSearch)
      return api.getOrEmpty<{ homework: HomeworkItem[] }>(`/teacher/homework?${params.toString()}`, { homework: [] })
    },
  })

  // submissions query: enabled only when view dialog is open
  const submissionsQuery = useQuery({
    queryKey: ["teacher-homework-submissions", viewHomework?.id],
    queryFn: () =>
      api.getOrEmpty<HomeworkSubmissionsResponse>(
        `/teacher/homework/${viewHomework!.id}/submissions`,
        { homework_id: '', title: '', submissions_count: 0, students_count: 0, submissions: [] }
      ),
    enabled: !!viewHomework,
  })

  // open edit dialog – populate fields from the selected homework
  const openEditDialog = (hw: HomeworkItem) => {
    setEditHomework(hw)
    setEditTitle(hw.title)
    setEditDescription(hw.description || "")
    setEditDueDate(toDateInputValue(hw.due_date))
    setEditMaxMarks(String(hw.max_marks || 100))
    setEditFiles([])
    if (editFileInputRef.current) editFileInputRef.current.value = ""
  }

  const classOptions = optionsQuery.data?.options || []
  const selectedClass = useMemo(
    () => classOptions.find((c) => c.class_id === classId) || null,
    [classOptions, classId]
  )
  const subjectOptions = selectedClass?.subjects || []
  const selectedFilterClass = useMemo(
    () => classOptions.find((c) => c.class_id === classFilter) || null,
    [classOptions, classFilter]
  )
  const subjectFilterOptions = selectedFilterClass?.subjects || []

  const homeworks = listQuery.data?.homework || []
  const totalAssignments = homeworks.length
  const totalSubmissions = homeworks.reduce((sum, h) => sum + h.submissions_count, 0)
  const totalPending = homeworks.reduce(
    (sum, h) => sum + Math.max(0, h.students_count - h.submissions_count),
    0
  )

  const resetForm = () => {
    setTitle("")
    setClassId("")
    setSubjectId("")
    setDueDate("")
    setDescription("")
    setMaxMarks("100")
    setFiles([])
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!title.trim()) throw new Error("Title is required")
      if (!classId) throw new Error("Class is required")
      if (!subjectId) throw new Error("Subject is required")
      if (!dueDate) throw new Error("Due date is required")
      if (files.length === 0) throw new Error("At least one attachment is required")

      const form = new FormData()
      form.append("title", title.trim())
      form.append("class_id", classId)
      form.append("subject_id", subjectId)
      form.append("due_date", dueDate)
      form.append("description", description.trim())
      form.append("max_marks", maxMarks || "100")
      files.forEach((file) => form.append("attachments", file))

      return api.postForm("/teacher/homework", form)
    },
    onSuccess: () => {
      toast.success("Homework assigned")
      setOpenAssign(false)
      resetForm()
      queryClient.invalidateQueries({ queryKey: ["teacher-homework-list"] })
    },
    onError: (error: unknown) => {
      toast.error("Failed to assign homework", {
        description: error instanceof Error ? error.message : "Unexpected error",
      })
    },
  })

  // update mutation
  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!editHomework) throw new Error("No homework selected")
      if (!editTitle.trim()) throw new Error("Title is required")
      if (!editDueDate) throw new Error("Due date is required")
      if (editFiles.length > 0) {
        const form = new FormData()
        form.append("title", editTitle.trim())
        form.append("description", editDescription.trim())
        form.append("due_date", editDueDate)
        form.append("max_marks", String(parseInt(editMaxMarks || "100", 10)))
        editFiles.forEach((file) => form.append("attachments", file))
        return api.putForm(`/teacher/homework/${editHomework.id}`, form)
      }

      return api.put(`/teacher/homework/${editHomework.id}`, {
        title: editTitle.trim(),
        description: editDescription.trim(),
        due_date: editDueDate,
        max_marks: parseInt(editMaxMarks || "100", 10),
      })
    },
    onSuccess: () => {
      toast.success("Homework updated")
      setEditHomework(null)
      setEditFiles([])
      if (editFileInputRef.current) editFileInputRef.current.value = ""
      queryClient.invalidateQueries({ queryKey: ["teacher-homework-list"] })
    },
    onError: (error: unknown) => {
      toast.error("Failed to update homework", {
        description: error instanceof Error ? error.message : "Unexpected error",
      })
    },
  })

  // delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (hwId: string) => api.delete(`/teacher/homework/${hwId}`),
    onSuccess: () => {
      toast.success("Homework deleted")
      setDeleteTarget(null)
      queryClient.invalidateQueries({ queryKey: ["teacher-homework-list"] })
    },
    onError: (error: unknown) => {
      toast.error("Failed to delete homework", {
        description: error instanceof Error ? error.message : "Unexpected error",
      })
    },
  })

  const downloadAttachment = async (homeworkID: string, attachmentID: string, fileName?: string) => {
    try {
      const blob = await api.fetchBlob(
        `/teacher/homework/${homeworkID}/attachments/${attachmentID}/download`
      )
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = fileName || "attachment"
      document.body.appendChild(a)
      a.click()
      a.remove()
      window.URL.revokeObjectURL(url)
    } catch (error) {
      toast.error("Failed to download attachment", {
        description: error instanceof Error ? error.message : "Unexpected error",
      })
    }
  }

  const handleFiles = (incoming: FileList | null) => {
    if (!incoming) return
    const picked = Array.from(incoming)
    const maxCount = 5
    const merged = [...files, ...picked].slice(0, maxCount)
    setFiles(merged)
  }

  const handleEditFiles = (incoming: FileList | null) => {
    if (!incoming) return
    const picked = Array.from(incoming)
    setEditFiles(picked.slice(0, 5))
  }

  return (
    <div className="space-y-6">
      <Dialog open={openAssign} onOpenChange={setOpenAssign}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center justify-between gap-3 sm:flex-row sm:justify-start sm:gap-4">
              <h1 className="text-xl md:text-3xl font-bold">Homework</h1>
              <DialogTrigger asChild>
                <Button className="whitespace-nowrap w-auto shrink-0">
                  <Plus className="mr-2 h-4 w-4" />
                  Assign Homework
                </Button>
              </DialogTrigger>
            </div>
            <p className="text-muted-foreground">Create and manage homework assignments</p>
          </div>
        </div>
        <DialogContent className="w-[95vw] max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Assign New Homework</DialogTitle>
              <DialogDescription>Create a new homework assignment for your students.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label>Title</Label>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Enter homework title" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label>Class</Label>
                  <Select
                    value={classId}
                    onValueChange={(value) => {
                      setClassId(value)
                      setSubjectId("")
                    }}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select class" />
                    </SelectTrigger>
                    <SelectContent>
                      {classOptions.map((opt) => (
                        <SelectItem key={opt.class_id} value={opt.class_id}>
                          {opt.class_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label>Subject</Label>
                  <Select value={subjectId} onValueChange={setSubjectId} disabled={!classId}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder={classId ? "Select subject" : "Select class first"} />
                    </SelectTrigger>
                    <SelectContent>
                      {subjectOptions.map((opt) => (
                        <SelectItem key={opt.subject_id} value={opt.subject_id}>
                          {opt.subject_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label>Due Date</Label>
                  <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
                </div>
                <div className="grid gap-2">
                  <Label>Max Marks</Label>
                  <Input type="number" min={1} max={1000} value={maxMarks} onChange={(e) => setMaxMarks(e.target.value)} />
                </div>
              </div>
              <div className="grid gap-2">
                <Label>Description</Label>
                <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} placeholder="Enter homework description and instructions" />
              </div>
              <div className="grid gap-2">
                <Label>Attachments *</Label>
                <div
                  className={`border-2 border-dashed rounded-lg p-6 text-center ${dragActive ? "border-primary bg-primary/5" : ""}`}
                  onDragOver={(e) => {
                    e.preventDefault()
                    setDragActive(true)
                  }}
                  onDragLeave={() => setDragActive(false)}
                  onDrop={(e) => {
                    e.preventDefault()
                    setDragActive(false)
                    handleFiles(e.dataTransfer.files)
                  }}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    className="hidden"
                    multiple
                    onChange={(e) => handleFiles(e.target.files)}
                  />
                  <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground mb-3">Drop files here or click to upload (max 5)</p>
                  <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()}>
                    Choose Files
                  </Button>
                </div>
                {files.length > 0 ? (
                  <div className="space-y-1">
                    {files.map((file, idx) => (
                      <div key={`${file.name}-${idx}`} className="text-xs text-muted-foreground flex justify-between">
                        <span>{file.name}</span>
                        <span>{formatFileSize(file.size)}</span>
                      </div>
                    ))}
                  </div>
                ) : null}
                {files.length === 0 ? <p className="text-xs text-muted-foreground">Attach at least one document to assign homework.</p> : null}
              </div>
            </div>
            <DialogFooter className="flex-col sm:flex-row gap-2">
              <Button className="w-full sm:w-auto" variant="outline" onClick={() => setOpenAssign(false)}>
                Cancel
              </Button>
              <Button className="w-full sm:w-auto" onClick={() => createMutation.mutate()} disabled={createMutation.isPending}>
                {createMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Assigning...
                  </>
                ) : (
                  "Assign Homework"
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
            <div className="relative flex-1 min-w-0">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
                placeholder="Search by title or description"
              />
            </div>
            <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2 xl:w-auto">
              <Select
                value={classFilter}
                onValueChange={(value) => {
                  setClassFilter(value)
                  setSubjectFilter("all")
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
              <Select value={subjectFilter} onValueChange={setSubjectFilter} disabled={classFilter === "all"}>
                <SelectTrigger className="w-full whitespace-nowrap sm:w-[240px]">
                  <BookOpen className="h-4 w-4 mr-2" />
                  <SelectValue placeholder={classFilter === "all" ? "Select class first" : "All Subjects"} />
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
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <Card>
          <CardContent className="p-4 md:p-6 text-center">
            <p className="text-xl md:text-3xl font-bold text-primary">{totalAssignments}</p>
            <p className="text-sm text-muted-foreground">Total Assignments</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 md:p-6 text-center">
            <p className="text-xl md:text-3xl font-bold text-green-500">{totalSubmissions}</p>
            <p className="text-sm text-muted-foreground">Total Submissions</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 md:p-6 text-center">
            <p className="text-xl md:text-3xl font-bold text-yellow-500">{totalPending}</p>
            <p className="text-sm text-muted-foreground">Pending</p>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4">
        {listQuery.isLoading ? (
          <Card>
            <CardContent className="p-4 md:p-6 text-center text-muted-foreground">Loading homework...</CardContent>
          </Card>
        ) : homeworks.length === 0 ? (
          <Card>
            <CardContent className="p-4 md:p-6 text-center text-muted-foreground">No homework assigned yet.</CardContent>
          </Card>
        ) : (
          homeworks.map((homework) => (
            <Card key={homework.id} className="card-hover">
              <CardContent className="p-4 md:p-6">
                <div className="flex flex-col sm:flex-row sm:items-center gap-4 md:gap-6">
                  <div className="flex items-center gap-4 md:gap-6 flex-1 min-w-0">
                    <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-primary/10 text-primary flex-shrink-0">
                      <BookOpen className="h-7 w-7" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-1 flex-wrap">
                        <h3 className="font-semibold text-lg">{homework.title}</h3>
                      </div>
                      <div className="flex items-center gap-4 text-sm text-muted-foreground flex-wrap">
                        <span>{homework.subject_name || "Unknown Subject"}</span>
                        <span>•</span>
                        <span>{homework.class_name}</span>
                        <span>•</span>
                        <div className="flex items-center gap-1">
                          <Calendar className="h-4 w-4" />
                          Due: {formatDate(homework.due_date)}
                        </div>
                        {homework.attachment_count > 0 ? (
                          <>
                            <span>•</span>
                            <span>{homework.attachment_count} attachment(s)</span>
                          </>
                        ) : null}
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-6 w-full sm:w-auto">
                    <div className="text-center px-6">
                      <p className="text-2xl font-bold">
                        {homework.submissions_count}/{homework.students_count}
                      </p>
                      <p className="text-sm text-muted-foreground">Submitted</p>
                    </div>
                    <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
                      <Button className="w-full sm:w-auto" variant="outline" size="sm" onClick={() => setViewHomework(homework)}>
                        <Eye className="mr-1.5 h-4 w-4" />
                        View
                      </Button>
                      <Button className="w-full sm:w-auto" variant="outline" size="sm" onClick={() => openEditDialog(homework)}>
                        <Pencil className="mr-1.5 h-4 w-4" />
                        Edit
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full sm:w-auto text-destructive hover:bg-destructive/10 hover:text-destructive border-destructive/30"
                        onClick={() => setDeleteTarget(homework)}
                      >
                        <Trash2 className="mr-1.5 h-4 w-4" />
                        Delete
                      </Button>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {/* ── View / Submissions dialog ─────────────────────────────────────── */}
      <Dialog open={!!viewHomework} onOpenChange={(open) => !open && setViewHomework(null)}>
        <DialogContent className="w-[95vw] max-w-2xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>{viewHomework?.title}</DialogTitle>
            <DialogDescription>
              {viewHomework?.subject_name} • {viewHomework?.class_name}
            </DialogDescription>
          </DialogHeader>
          {viewHomework ? (
            <div className="flex flex-col gap-4 overflow-y-auto pr-1">
              {/* Meta */}
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-lg bg-muted/50 p-3">
                  <p className="text-xs text-muted-foreground mb-0.5">Due Date</p>
                  <p className="font-medium">{formatDate(viewHomework.due_date)}</p>
                </div>
                <div className="rounded-lg bg-muted/50 p-3">
                  <p className="text-xs text-muted-foreground mb-0.5">Max Marks</p>
                  <p className="font-medium">{viewHomework.max_marks}</p>
                </div>
                <div className="rounded-lg bg-muted/50 p-3 col-span-2">
                  <p className="text-xs text-muted-foreground mb-0.5">Description</p>
                  <p>{viewHomework.description || "No description"}</p>
                </div>
              </div>

              {/* Attachments */}
              {viewHomework.attachments?.length ? (
                <div className="space-y-2">
                  <Label>Attachments</Label>
                  {viewHomework.attachments.map((att) => (
                    <div key={att.id} className="flex items-center justify-between border rounded-md p-2">
                      <div className="text-sm">
                        <p>{att.file_name || "Attachment"}</p>
                        <p className="text-xs text-muted-foreground">{formatFileSize(att.file_size)}</p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => downloadAttachment(viewHomework.id, att.id, att.file_name)}
                      >
                        Download
                      </Button>
                    </div>
                  ))}
                </div>
              ) : null}

              {/* Submissions */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-muted-foreground" />
                  <Label>Student Submissions</Label>
                  {submissionsQuery.isSuccess && (
                    <Badge variant="secondary">
                      {submissionsQuery.data.submissions_count}/{submissionsQuery.data.students_count}
                    </Badge>
                  )}
                </div>

                {submissionsQuery.isLoading && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground py-3">
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading submissions…
                  </div>
                )}
                {submissionsQuery.isError && (
                  <p className="text-sm text-destructive py-2">Failed to load submissions</p>
                )}
                {submissionsQuery.isSuccess && submissionsQuery.data.submissions.length === 0 && (
                  <p className="text-sm text-muted-foreground py-2">No submissions yet.</p>
                )}
                {submissionsQuery.isSuccess && submissionsQuery.data.submissions.length > 0 && (
                  <div className="rounded-lg border overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-muted/50">
                          <th className="text-left p-3 font-medium">Student</th>
                          <th className="text-left p-3 font-medium hidden sm:table-cell">Roll No.</th>
                          <th className="text-left p-3 font-medium">Submitted</th>
                          <th className="text-left p-3 font-medium hidden sm:table-cell">Marks</th>
                          <th className="text-center p-3 font-medium">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {submissionsQuery.data.submissions.map((sub) => (
                          <tr key={sub.student_id} className="hover:bg-muted/30 transition-colors">
                            <td className="p-3 font-medium">{sub.student_name}</td>
                            <td className="p-3 text-muted-foreground hidden sm:table-cell">{sub.roll_number || "—"}</td>
                            <td className="p-3 text-muted-foreground">{formatDateTime(sub.submitted_at)}</td>
                            <td className="p-3 text-muted-foreground hidden sm:table-cell">
                              {sub.marks_obtained != null ? sub.marks_obtained : "—"}
                            </td>
                            <td className="p-3 text-center">
                              <Badge
                                variant={
                                  sub.status === "graded"
                                    ? "success"
                                    : sub.status === "late"
                                    ? "destructive"
                                    : "secondary"
                                }
                                className="text-xs"
                              >
                                {sub.status}
                              </Badge>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {submissionsQuery.isSuccess &&
                  submissionsQuery.data.students_count - submissionsQuery.data.submissions_count > 0 && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <XCircle className="h-4 w-4 text-yellow-500 flex-shrink-0" />
                      <span>
                        {submissionsQuery.data.students_count - submissionsQuery.data.submissions_count} student
                        {submissionsQuery.data.students_count - submissionsQuery.data.submissions_count !== 1
                          ? "s"
                          : ""}{" "}
                        have not submitted yet
                      </span>
                    </div>
                  )}
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* ── Edit dialog ───────────────────────────────────────────────────── */}
      <Dialog open={!!editHomework} onOpenChange={(open) => !open && setEditHomework(null)}>
        <DialogContent className="w-[95vw] max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Homework</DialogTitle>
            <DialogDescription>Update the details below. Class and subject cannot be changed.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label>Title</Label>
              <Input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} placeholder="Homework title" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label>Due Date</Label>
                <Input type="date" value={editDueDate} onChange={(e) => setEditDueDate(e.target.value)} />
              </div>
              <div className="grid gap-2">
                <Label>Max Marks</Label>
                <Input
                  type="number"
                  min={1}
                  max={1000}
                  value={editMaxMarks}
                  onChange={(e) => setEditMaxMarks(e.target.value)}
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label>Description</Label>
              <Textarea
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                rows={4}
                placeholder="Description (optional)"
              />
            </div>
            {editHomework?.attachments?.length ? (
              <div className="grid gap-2">
                <Label>Current Attachments</Label>
                <div className="space-y-2">
                  {editHomework.attachments.map((att) => (
                    <div key={att.id} className="flex items-center justify-between rounded-md border p-2">
                      <div className="text-sm min-w-0">
                        <p className="truncate">{att.file_name || "Attachment"}</p>
                        <p className="text-xs text-muted-foreground">{formatFileSize(att.file_size)}</p>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => downloadAttachment(editHomework.id, att.id, att.file_name)}
                      >
                        Download
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            <div className="grid gap-2">
              <Label>Replace Attachments (optional)</Label>
              <input
                ref={editFileInputRef}
                type="file"
                className="hidden"
                multiple
                onChange={(e) => handleEditFiles(e.target.files)}
              />
              <div className="rounded-lg border border-dashed p-4 text-center">
                <p className="text-sm text-muted-foreground mb-3">Choose up to 5 files to replace existing attachments</p>
                <Button type="button" variant="outline" onClick={() => editFileInputRef.current?.click()}>
                  <Upload className="mr-2 h-4 w-4" />
                  Choose Replacement Files
                </Button>
              </div>
              {editFiles.length > 0 ? (
                <div className="space-y-1">
                  {editFiles.map((file, idx) => (
                    <div key={`${file.name}-${idx}`} className="text-xs text-muted-foreground flex justify-between">
                      <span>{file.name}</span>
                      <span>{formatFileSize(file.size)}</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button className="w-full sm:w-auto" variant="outline" onClick={() => setEditHomework(null)}>
              Cancel
            </Button>
            <Button className="w-full sm:w-auto" onClick={() => updateMutation.mutate()} disabled={updateMutation.isPending}>
              {updateMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving…
                </>
              ) : (
                "Save Changes"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete confirm ────────────────────────────────────────────────── */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Homework?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete &quot;{deleteTarget?.title}&quot; and all its submission records. This
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90"
              disabled={deleteMutation.isPending}
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
            >
              {deleteMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Deleting…
                </>
              ) : (
                "Delete"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

