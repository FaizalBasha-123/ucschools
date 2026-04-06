"use client"

import { useMemo, useRef, useState } from "react"
import { useEffect } from "react"
import { useMutation, useQuery, useQueryClient, useInfiniteQuery } from "@tanstack/react-query"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
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
import { useAuth } from "@/contexts/AuthContext"
import { useRouter } from "next/navigation"
import { Wand2, FileText, Upload, File, X, FileUp, Loader2, Trash2, Eye, Download, MoreVertical, Search, Layers3, CheckCircle2 } from "lucide-react"
import { toast } from "sonner"
import { api } from "@/lib/api"

interface QuestionDocument {
    id: string
    title: string
    subject?: string
    class_level?: string
    question_type: string
    difficulty?: string
    context?: string
    file_name: string
    file_size: number
    mime_type: string
    uploaded_at: string
    uploaded_by_name?: string
}

interface GlobalClassOption {
    id: string
    name: string
    sort_order: number
}

interface GlobalSubjectOption {
    id: string
    name: string
    code: string
}

interface AssignmentItem {
    class: GlobalClassOption
    subjects: GlobalSubjectOption[]
}

function formatFileSize(bytes: number) {
    if (!bytes) return "0 Bytes"
    const units = ["Bytes", "KB", "MB", "GB"]
    let n = bytes
    let idx = 0
    while (n >= 1024 && idx < units.length - 1) {
        n /= 1024
        idx += 1
    }
    return `${n.toFixed(idx === 0 ? 0 : 2)} ${units[idx]}`
}

export function QuestionUploaderForm() {
    const queryClient = useQueryClient()
    const fileInputRef = useRef<HTMLInputElement>(null)

    const [dragActive, setDragActive] = useState(false)
    const [selectedFile, setSelectedFile] = useState<File | null>(null)

    const [title, setTitle] = useState("")
    const [subjectId, setSubjectId] = useState("")
    const [classId, setClassId] = useState("")
    const [questionType, setQuestionType] = useState("")
    const [difficulty, setDifficulty] = useState("medium")
    const [contextText, setContextText] = useState("")
    const [lastUploaded, setLastUploaded] = useState<QuestionDocument | null>(null)

    const classesQuery = useQuery({
        queryKey: ["super-admin-catalog-classes-for-uploader"],
        queryFn: () => api.get<{ classes: GlobalClassOption[] }>("/super-admin/catalog/classes"),
        staleTime: 10 * 60_000,
        refetchOnWindowFocus: false,
    })

    const subjectsQuery = useQuery({
        queryKey: ["super-admin-catalog-subjects-for-uploader"],
        queryFn: () => api.get<{ subjects: GlobalSubjectOption[] }>("/super-admin/catalog/subjects"),
        staleTime: 10 * 60_000,
        refetchOnWindowFocus: false,
    })
    const assignmentsQuery = useQuery({
        queryKey: ["super-admin-catalog-assignments-for-uploader"],
        queryFn: () => api.get<{ assignments: AssignmentItem[] }>("/super-admin/catalog/assignments"),
        staleTime: 10 * 60_000,
        refetchOnWindowFocus: false,
    })

    const classes = useMemo(
        () => [...(classesQuery.data?.classes || [])].sort((a, b) => (a.sort_order - b.sort_order) || a.name.localeCompare(b.name)),
        [classesQuery.data?.classes]
    )
    const subjects = useMemo(
        () => [...(subjectsQuery.data?.subjects || [])].sort((a, b) => a.name.localeCompare(b.name)),
        [subjectsQuery.data?.subjects]
    )
    const availableSubjects = useMemo(() => {
        if (!classId) return subjects
        const assignment = (assignmentsQuery.data?.assignments || []).find((item) => item.class.id === classId)
        if (!assignment) return []
        return [...assignment.subjects].sort((a, b) => a.name.localeCompare(b.name))
    }, [assignmentsQuery.data?.assignments, classId, subjects])
    const selectedClass = useMemo(
        () => classes.find((item) => item.id === classId) || null,
        [classes, classId]
    )
    const selectedSubject = useMemo(
        () => availableSubjects.find((item) => item.id === subjectId) || null,
        [availableSubjects, subjectId]
    )

    const uploadMutation = useMutation({
        mutationFn: async (): Promise<{ document: QuestionDocument }> => {
            if (!selectedFile) throw new Error("Upload a file first")
            if (!title.trim()) throw new Error("Title is required")
            if (!selectedSubject) throw new Error("Subject is required")
            if (!selectedClass) throw new Error("Class is required")
            if (!questionType) throw new Error("Select question type")
            if (!difficulty) throw new Error("Difficulty is required")

            const formData = new FormData()
            formData.append("file", selectedFile)
            formData.append("title", title.trim() || selectedFile.name.replace(/\.[^.]+$/, ""))
            formData.append("subject", selectedSubject.name)
            formData.append("class_level", selectedClass.name)
            formData.append("question_type", questionType)
            formData.append("difficulty", difficulty)
            formData.append("context", contextText.trim())

            return api.postForm("/super-admin/question-documents", formData)
        },
        onSuccess: () => {
            toast.success("Question document uploaded")
            const fallbackTitle = (title.trim() || selectedFile?.name || "").replace(/\.[^.]+$/, "")
            setLastUploaded({
                id: "",
                title: fallbackTitle,
                subject: selectedSubject?.name || undefined,
                class_level: selectedClass?.name || undefined,
                question_type: questionType,
                difficulty: difficulty || undefined,
                context: contextText.trim() || undefined,
                file_name: selectedFile?.name || "",
                file_size: selectedFile?.size || 0,
                mime_type: selectedFile?.type || "",
                uploaded_at: new Date().toISOString(),
            })
            setSelectedFile(null)
            setTitle("")
            setSubjectId("")
            setClassId("")
            setQuestionType("")
            setDifficulty("medium")
            setContextText("")
            if (fileInputRef.current) fileInputRef.current.value = ""
            queryClient.invalidateQueries({ queryKey: ["super-admin-question-documents"] })
        },
        onError: (error: unknown) => {
            const message = error instanceof Error ? error.message : "Please try again"
            toast.error("Upload failed", { description: message })
        },
    })

    const validateAndSetFile = (file: File) => {
        const maxSize = 10 * 1024 * 1024
        const name = file.name.toLowerCase()
        const validExt = name.endsWith(".pdf") || name.endsWith(".doc") || name.endsWith(".docx")

        if (!validExt) {
            toast.error("Invalid format", { description: "Only PDF, DOC and DOCX are allowed" })
            return
        }
        if (file.size <= 0 || file.size > maxSize) {
            toast.error("Invalid file size", { description: "File size must be between 1B and 10MB" })
            return
        }

        setSelectedFile(file)
        if (!title.trim()) {
            setTitle(file.name.replace(/\.[^.]+$/, ""))
        }
    }

    const handleDrag = (e: React.DragEvent) => {
        e.preventDefault()
        e.stopPropagation()
        if (e.type === "dragenter" || e.type === "dragover") setDragActive(true)
        if (e.type === "dragleave") setDragActive(false)
    }

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault()
        e.stopPropagation()
        setDragActive(false)
        const file = e.dataTransfer.files?.[0]
        if (file) validateAndSetFile(file)
    }

    const previewDocument = useMemo(() => {
        if (uploadMutation.data?.document) return uploadMutation.data.document
        return lastUploaded
    }, [uploadMutation.data, lastUploaded])

    return (
        <>
            <div className="space-y-6 lg:space-y-8">
                <Card className="border border-border/60 shadow-sm overflow-hidden bg-card/50 backdrop-blur-xl">
                    <CardHeader className="bg-gradient-to-r from-rose-500/10 via-red-500/5 to-orange-500/10 dark:from-rose-500/20 dark:via-red-500/10 dark:to-orange-500/20 pb-8">
                        <div className="flex flex-col xl:flex-row items-start xl:items-center gap-4">
                            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-rose-500 to-orange-600 shadow-lg shadow-rose-500/30">
                                <Upload className="h-7 w-7 text-white" />
                            </div>
                            <div>
                                <CardTitle className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">Upload Question Paper</CardTitle>
                                <CardDescription className="text-base text-slate-600 dark:text-slate-300 mt-1">Provide semantic metadata and upload question papers in PDF or Word formats</CardDescription>
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent className="p-6 md:p-8 -mt-6 relative z-10">
                        <div className="bg-card rounded-2xl p-2 shadow-sm border border-border">
                            <div
                                className={`relative border-2 border-dashed rounded-xl p-10 transition-all duration-300 flex flex-col items-center justify-center text-center space-y-5
                                ${dragActive
                                        ? "border-rose-500 bg-rose-50/50 dark:bg-rose-900/20"
                                        : "border-border hover:border-rose-300 dark:hover:border-rose-700/50 hover:bg-muted/50"
                                    }`}
                                onDragEnter={handleDrag}
                                onDragLeave={handleDrag}
                                onDragOver={handleDrag}
                                onDrop={handleDrop}
                            >
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    className="hidden"
                                    accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                                    onChange={(e) => {
                                        const file = e.target.files?.[0]
                                        if (file) validateAndSetFile(file)
                                    }}
                                />

                                <div className={`flex h-24 w-24 items-center justify-center rounded-full transition-all duration-500 shadow-sm
                                ${dragActive ? "bg-rose-100 dark:bg-rose-900/40 scale-110 shadow-rose-500/20" : "bg-muted"
                                    }`}>
                                    <FileUp className={`h-10 w-10 transition-colors duration-300 ${dragActive ? "text-rose-600 dark:text-rose-400" : "text-slate-400 dark:text-slate-500"}`} />
                                </div>

                                <div className="space-y-1">
                                    <p className="text-xl font-semibold text-slate-800 dark:text-slate-200 transition-colors">
                                        {dragActive ? "Drop your document here..." : "Drag & drop your question paper"}
                                    </p>
                                    <p className="text-sm text-slate-500 dark:text-slate-400">or click the button below to browse your files</p>
                                </div>

                                <div className="flex items-center gap-3 pt-2">
                                    <span className="px-3.5 py-1.5 rounded-full bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 text-xs font-semibold uppercase tracking-wider border border-red-100 dark:border-red-500/20">PDF</span>
                                    <span className="px-3.5 py-1.5 rounded-full bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 text-xs font-semibold uppercase tracking-wider border border-blue-100 dark:border-blue-500/20">DOC</span>
                                    <span className="px-3.5 py-1.5 rounded-full bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 text-xs font-semibold uppercase tracking-wider border border-indigo-100 dark:border-indigo-500/20">DOCX</span>
                                </div>

                                <Button
                                    onClick={() => fileInputRef.current?.click()}
                                    className="mt-4 bg-gradient-to-r from-rose-600 to-orange-600 hover:from-rose-700 hover:to-orange-700 text-white shadow-md shadow-rose-500/20 h-11 px-8 rounded-full font-medium transition-all"
                                    disabled={uploadMutation.isPending}
                                >
                                    {uploadMutation.isPending ? (
                                        <>
                                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                            Processing Upload...
                                        </>
                                    ) : (
                                        <>
                                            <Upload className="mr-2 h-4 w-4" />
                                            Browse Files
                                        </>
                                    )}
                                </Button>
                            </div>
                        </div>

                        {selectedFile && (
                            <div className="mt-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                                <div className="flex items-center justify-between p-4 rounded-xl border border-rose-200/60 dark:border-rose-900/30 bg-rose-50/50 dark:bg-rose-950/20 shadow-sm">
                                    <div className="flex items-center gap-4">
                                        <div className="p-3 rounded-lg bg-card shadow-sm border border-border">
                                            <File className={`h-6 w-6 ${selectedFile.name.toLowerCase().endsWith(".pdf") ? "text-red-500" : "text-blue-500"}`} />
                                        </div>
                                        <div>
                                            <h4 className="font-semibold text-sm text-slate-800 dark:text-slate-200 mb-0.5">{selectedFile.name}</h4>
                                            <p className="text-xs text-slate-500 dark:text-slate-400 font-medium tracking-wide">{formatFileSize(selectedFile.size)}</p>
                                        </div>
                                    </div>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-9 w-9 text-rose-500 hover:text-rose-700 hover:bg-rose-100 dark:hover:bg-rose-900/50 rounded-full transition-colors"
                                        onClick={() => setSelectedFile(null)}
                                    >
                                        <X className="h-4 w-4" />
                                    </Button>
                                </div>
                            </div>
                        )}
                    </CardContent>
                </Card>

                <div className="grid gap-6 lg:gap-8 grid-cols-1 xl:grid-cols-12">
                    <Card className="lg:col-span-7 xl:col-span-8 border-border/60 shadow-sm bg-card/50 backdrop-blur-xl">
                        <CardHeader className="pb-4 border-b border-border">
                            <CardTitle className="flex items-center gap-2 text-xl font-bold">
                                <FileText className="h-5 w-5 text-indigo-500" /> Assessment Metadata
                            </CardTitle>
                            <CardDescription>Configure categorization, difficulty, and context for seamless indexing</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-6 pt-6">
                            <div className="grid gap-2">
                                <Label htmlFor="title" className="text-slate-700 dark:text-slate-300 font-medium">Document Title</Label>
                                <Input
                                    id="title"
                                    value={title}
                                    onChange={(e) => setTitle(e.target.value)}
                                    placeholder="e.g., Final Year Model Mathematics Paper 2024"
                                    className="h-11 bg-card focus-visible:ring-indigo-500/30"
                                />
                            </div>

                            <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
                                <div className="grid gap-2">
                                    <Label className="text-slate-700 dark:text-slate-300 font-medium">Academic Class</Label>
                                    <Select value={classId} onValueChange={(value) => {
                                        setClassId(value)
                                        setSubjectId("")
                                    }}>
                                        <SelectTrigger className="h-11 bg-card focus-visible:ring-indigo-500/30">
                                            <SelectValue placeholder="Select class level" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {classesQuery.isLoading ? (
                                                <SelectItem value="__loading_classes" disabled>Loading classes...</SelectItem>
                                            ) : classes.length === 0 ? (
                                                <SelectItem value="__no_classes" disabled>No classes found</SelectItem>
                                            ) : (
                                                classes.map((grade) => (
                                                    <SelectItem key={grade.id} value={grade.id}>{grade.name}</SelectItem>
                                                ))
                                            )}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="grid gap-2">
                                    <Label className="text-slate-700 dark:text-slate-300 font-medium">Subject Module</Label>
                                    <Select value={subjectId} onValueChange={setSubjectId} disabled={!classId}>
                                        <SelectTrigger className="h-11 bg-card focus-visible:ring-indigo-500/30">
                                            <SelectValue placeholder={classId ? "Select related subject" : "Select class first"} />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {subjectsQuery.isLoading || assignmentsQuery.isLoading ? (
                                                <SelectItem value="__loading_subjects" disabled>Loading subjects...</SelectItem>
                                            ) : availableSubjects.length === 0 ? (
                                                <SelectItem value="__no_subjects" disabled>No subjects mapped</SelectItem>
                                            ) : (
                                                availableSubjects.map((subj) => (
                                                    <SelectItem key={subj.id} value={subj.id}>{subj.name}</SelectItem>
                                                ))
                                            )}
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>

                            <div className="grid gap-2">
                                <Label className="text-slate-700 dark:text-slate-300 font-medium">Question Format Type</Label>
                                <Select value={questionType} onValueChange={setQuestionType}>
                                        <SelectTrigger className="h-11 bg-card focus-visible:ring-indigo-500/30">
                                        <SelectValue placeholder="Select primary format" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="mcq">Multiple Choice (MCQ)</SelectItem>
                                        <SelectItem value="short">Short Answer Responses</SelectItem>
                                        <SelectItem value="long">Long Essay / Comprehensive</SelectItem>
                                        <SelectItem value="truefalse">True / False Statements</SelectItem>
                                        <SelectItem value="fillblank">Fill in the Blanks</SelectItem>
                                        <SelectItem value="model_question_paper">Full Model Question Paper</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="grid gap-3">
                                <Label className="text-slate-700 dark:text-slate-300 font-medium">Anticipated Difficulty</Label>
                                <div className="flex gap-3 bg-muted/50 p-1.5 rounded-xl border border-border">
                                    <Button
                                        type="button"
                                        variant={difficulty === "easy" ? "default" : "ghost"}
                                        className={`flex-1 rounded-lg transition-all ${difficulty === "easy" ? "bg-emerald-500 hover:bg-emerald-600 text-white shadow-sm" : "hover:bg-muted"}`}
                                        onClick={() => setDifficulty("easy")}
                                    >
                                        Beginner
                                    </Button>
                                    <Button
                                        type="button"
                                        variant={difficulty === "medium" ? "default" : "ghost"}
                                        className={`flex-1 rounded-lg transition-all ${difficulty === "medium" ? "bg-amber-500 hover:bg-amber-600 text-white shadow-sm" : "hover:bg-muted"}`}
                                        onClick={() => setDifficulty("medium")}
                                    >
                                        Intermediate
                                    </Button>
                                    <Button
                                        type="button"
                                        variant={difficulty === "hard" ? "default" : "ghost"}
                                        className={`flex-1 rounded-lg transition-all ${difficulty === "hard" ? "bg-rose-500 hover:bg-rose-600 text-white shadow-sm" : "hover:bg-muted"}`}
                                        onClick={() => setDifficulty("hard")}
                                    >
                                        Advanced
                                    </Button>
                                </div>
                            </div>

                            <div className="grid gap-2">
                                <Label htmlFor="context" className="text-slate-700 dark:text-slate-300 font-medium">Instructions & Context <span className="text-slate-400 font-normal">(Optional)</span></Label>
                                <Textarea
                                    id="context"
                                    value={contextText}
                                    onChange={(e) => setContextText(e.target.value)}
                                    placeholder="Provide evaluator notes, specific chapters covered, or test parameters..."
                                    className="resize-none bg-card focus-visible:ring-indigo-500/30 rounded-xl"
                                    rows={4}
                                />
                            </div>

                            <Button
                                className="w-full h-12 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white shadow-md shadow-indigo-500/20 text-base font-semibold tracking-wide transition-all data-[disabled]:opacity-50"
                                onClick={() => uploadMutation.mutate()}
                                disabled={
                                    uploadMutation.isPending ||
                                    !selectedFile ||
                                    !title.trim() ||
                                    !selectedSubject ||
                                    !selectedClass ||
                                    !questionType
                                }
                            >
                                {uploadMutation.isPending ? (
                                    <>
                                        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                                        Synchronizing Payload...
                                    </>
                                ) : (
                                    <>
                                        <Upload className="mr-2 h-5 w-5" />
                                        Finalize & Upload Entry
                                    </>
                                )}
                            </Button>
                        </CardContent>
                    </Card>

                    <Card className="lg:col-span-5 xl:col-span-4 border-border/60 shadow-sm bg-card/50 backdrop-blur-xl flex flex-col">
                        <CardHeader className="pb-4 border-b border-border bg-muted/50">
                            <CardTitle className="flex items-center gap-2 text-lg">
                                <Eye className="h-5 w-5 text-indigo-400" /> Operational Log
                            </CardTitle>
                            <CardDescription>Most recent successful transmission details</CardDescription>
                        </CardHeader>
                        <CardContent className="flex-1 p-0 flex flex-col justify-center">
                            {uploadMutation.isPending ? (
                                <div className="flex flex-col items-center justify-center p-12 text-center animate-pulse">
                                    <div className="p-4 rounded-full bg-indigo-50 dark:bg-indigo-900/20 mb-4">
                                        <Loader2 className="h-8 w-8 text-indigo-600 dark:text-indigo-400 animate-spin" />
                                    </div>
                                    <p className="font-semibold text-slate-800 dark:text-slate-200">Transmitting to Storage Area...</p>
                                    <p className="text-sm text-slate-500 mt-1">Establishing secure connection</p>
                                </div>
                            ) : !previewDocument ? (
                                <div className="flex flex-col items-center justify-center p-12 text-center">
                                    <div className="p-5 rounded-full bg-muted mb-5 border border-border">
                                        <FileText className="h-10 w-10 text-slate-300 dark:text-slate-600" />
                                    </div>
                                    <h4 className="font-medium text-slate-700 dark:text-slate-300 mb-1">Awaiting Transmission</h4>
                                    <p className="text-sm text-slate-500 px-4">Your uploaded document&apos;s manifest will appear here upon completion</p>
                                </div>
                            ) : (
                                <div className="p-6 space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                                    <div className="p-5 rounded-2xl bg-gradient-to-br from-indigo-50/50 to-white dark:from-slate-900/50 dark:to-slate-900 border border-indigo-100/60 dark:border-slate-800 shadow-sm">
                                        <div className="flex items-start gap-4">
                                            <div className="flex aspect-square h-12 items-center justify-center rounded-xl bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-400">
                                                <CheckCircle2 className="h-6 w-6" />
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <p className="font-bold text-slate-900 dark:text-white truncate" title={previewDocument.title || previewDocument.file_name}>
                                                    {previewDocument.title || previewDocument.file_name}
                                                </p>
                                                <div className="flex flex-wrap items-center gap-1.5 mt-2">
                                                    <Badge variant="outline" className="bg-card font-medium whitespace-nowrap border-indigo-200 dark:border-indigo-700 text-indigo-600 dark:text-indigo-400">{previewDocument.question_type}</Badge>
                                                    {previewDocument.difficulty && <Badge variant="secondary" className="whitespace-nowrap capitalize">{previewDocument.difficulty}</Badge>}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                        <div className="rounded-2xl border border-border overflow-hidden text-sm">
                                            <div className="flex items-center justify-between p-3.5 bg-muted/50 border-b border-border">
                                            <span className="text-slate-500 dark:text-slate-400 font-medium flex items-center gap-1.5"><Layers3 className="h-4 w-4" /> Curriculum Map</span>
                                            <span className="font-semibold text-slate-800 dark:text-slate-200 text-right">
                                                {previewDocument.class_level}<br /><span className="text-indigo-600 dark:text-indigo-400">{previewDocument.subject}</span>
                                            </span>
                                        </div>
                                            <div className="flex items-center justify-between p-3.5 border-b border-border">
                                            <span className="text-slate-500 dark:text-slate-400 font-medium">Digital Signature</span>
                                            <span className="font-semibold text-slate-800 dark:text-slate-200 truncate max-w-[150px]" title={previewDocument.file_name}>{previewDocument.file_name}</span>
                                        </div>
                                            <div className="flex items-center justify-between p-3.5 border-b border-border bg-muted/50">
                                            <span className="text-slate-500 dark:text-slate-400 font-medium">Weight</span>
                                            <span className="font-semibold text-slate-800 dark:text-slate-200">{formatFileSize(previewDocument.file_size)}</span>
                                        </div>
                                        <div className="flex items-center justify-between p-3.5">
                                            <span className="text-slate-500 dark:text-slate-400 font-medium">Timestamp</span>
                                            <span className="font-semibold text-slate-800 dark:text-slate-200">{new Date(previewDocument.uploaded_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                        </div>
                                    </div>
                                    {previewDocument.context && (
                                        <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-950/20 border border-amber-100 dark:border-amber-900/30">
                                            <p className="text-xs font-bold text-amber-800 dark:text-amber-500 uppercase tracking-wider mb-1">Attached Context</p>
                                            <p className="text-sm text-amber-900/80 dark:text-amber-200/80">{previewDocument.context}</p>
                                        </div>
                                    )}
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </div>
            </div>
            <SuperAdminQuestionDocumentsList />
        </>
    )
}

function SuperAdminQuestionDocumentsList() {
    const queryClient = useQueryClient()
    const [search, setSearch] = useState("")
    const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null)

    const docsQuery = useInfiniteQuery({
        queryKey: ["super-admin-question-documents"],
        queryFn: ({ pageParam = 1 }) => {
            const params = new URLSearchParams({ page: String(pageParam), page_size: '50', order: 'desc' })
            return api.get<{ documents: QuestionDocument[]; has_more: boolean; next_page: number }>(`/super-admin/question-documents?${params.toString()}`)
        },
        getNextPageParam: (lastPage) => lastPage.has_more ? lastPage.next_page : undefined,
        initialPageParam: 1,
        staleTime: 30_000,
    })

    useEffect(() => {
        const onScroll = () => {
            if (!docsQuery.hasNextPage || docsQuery.isFetchingNextPage) return
            const el = document.documentElement
            const viewportBottom = (window.scrollY || el.scrollTop) + window.innerHeight
            if (viewportBottom >= el.scrollHeight * 0.8) docsQuery.fetchNextPage()
        }
        window.addEventListener('scroll', onScroll, { passive: true })
        return () => window.removeEventListener('scroll', onScroll)
    }, [docsQuery.hasNextPage, docsQuery.isFetchingNextPage, docsQuery.fetchNextPage])

    const deleteMutation = useMutation({
        mutationFn: (id: string) => api.delete(`/super-admin/question-documents/${id}`),
        onSuccess: () => {
            toast.success("Document deleted")
            queryClient.invalidateQueries({ queryKey: ["super-admin-question-documents"] })
            setDeleteTarget(null)
        },
        onError: () => toast.error("Delete failed"),
    })

    const openDocument = async (id: string, download = false) => {
        const action = download ? "download" : "view"
        try {
            const blob = await api.fetchBlob(`/super-admin/question-documents/${id}/${action}`)
            const blobUrl = URL.createObjectURL(blob)
            if (download) {
                const a = document.createElement("a")
                a.href = blobUrl
                a.download = "document"
                a.click()
            } else {
                window.open(blobUrl, "_blank")
            }
            setTimeout(() => URL.revokeObjectURL(blobUrl), 60000)
        } catch {
            toast.error("Could not open document")
        }
    }

    const docs = docsQuery.data?.pages.flatMap(p => p.documents) ?? []
    const filtered = search
        ? docs.filter(d =>
            d.title.toLowerCase().includes(search.toLowerCase()) ||
            d.subject?.toLowerCase().includes(search.toLowerCase()) ||
            d.class_level?.toLowerCase().includes(search.toLowerCase()) ||
            d.uploaded_by_name?.toLowerCase().includes(search.toLowerCase())
        )
        : docs

    return (
            <Card className="border border-border/60 shadow-sm bg-card/50 backdrop-blur-xl mt-8">
                <CardHeader className="border-b border-border pb-5">
                <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4">
                    <div>
                        <CardTitle className="text-xl font-bold flex items-center gap-2 text-slate-900 dark:text-white">
                            <Layers3 className="h-5 w-5 text-indigo-500" /> Digital Archive
                        </CardTitle>
                        <CardDescription className="text-sm mt-1">
                            {docs.length} document{docs.length !== 1 ? "s" : ""} securely stored across all instances
                        </CardDescription>
                    </div>
                    <div className="relative w-full md:w-80 group">
                        <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                            <Search className="h-4 w-4 text-slate-400 group-focus-within:text-indigo-500 transition-colors" />
                        </div>
                        <Input
                            placeholder="Search by title, subject, or author..."
                            className="pl-10 h-11 bg-muted/50 border-border focus-visible:ring-indigo-500/30 rounded-xl transition-all"
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                        />
                    </div>
                </div>
            </CardHeader>
            <CardContent className="p-0">
                {docsQuery.isLoading ? (
                    <div className="flex flex-col items-center justify-center py-20">
                        <Loader2 className="h-8 w-8 animate-spin text-indigo-500 mb-4" />
                        <p className="text-slate-500 dark:text-slate-400 font-medium tracking-wide animate-pulse">Retrieving archive data...</p>
                    </div>
                ) : filtered.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-24 text-center px-4">
                        <div className="p-6 rounded-full bg-muted mb-6 border border-border shadow-sm inline-flex">
                            <FileText className="h-12 w-12 text-slate-300 dark:text-slate-600" />
                        </div>
                        <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">
                            {search ? "No matches found" : "Archive is empty"}
                        </h3>
                        <p className="text-slate-500 dark:text-slate-400 max-w-sm">
                            {search ? `We couldn't find anything matching "${search}". Try adjusting your filters.` : "No question papers have been uploaded to the system yet. Use the uploader above to begin."}
                        </p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <Table>
                            <TableHeader className="bg-muted/50">
                                <TableRow className="hover:bg-transparent border-border">
                                    <TableHead className="font-semibold text-slate-700 dark:text-slate-300 py-4 px-6 rounded-tl-xl w-[25%]">Document Profile</TableHead>
                                    <TableHead className="font-semibold text-slate-700 dark:text-slate-300 py-4 w-[15%]">Curriculum</TableHead>
                                    <TableHead className="font-semibold text-slate-700 dark:text-slate-300 py-4 w-[20%]">Format & Level</TableHead>
                                    <TableHead className="font-semibold text-slate-700 dark:text-slate-300 py-4 w-[15%]">Author</TableHead>
                                    <TableHead className="font-semibold text-slate-700 dark:text-slate-300 py-4 w-[15%]">Timestamp</TableHead>
                                    <TableHead className="w-[80px] text-right rounded-tr-xl"></TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {filtered.map(doc => (
                                    <TableRow key={doc.id} className="group hover:bg-muted/50 transition-colors border-border border-b last:border-0">
                                        <TableCell className="p-4 px-6 align-top">
                                            <div className="flex items-start gap-4">
                                                <div className="mt-1 p-2 rounded-lg bg-indigo-50 dark:bg-indigo-900/20 shadow-sm border border-indigo-100 dark:border-indigo-800">
                                                    <FileText className="h-5 w-5 text-indigo-500" />
                                                </div>
                                                <div className="min-w-0 flex-1">
                                                    <p className="font-semibold text-slate-900 dark:text-white truncate" title={doc.title}>{doc.title}</p>
                                                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 truncate" title={doc.file_name}>{doc.file_name}</p>
                                                </div>
                                            </div>
                                        </TableCell>
                                        <TableCell className="align-top py-4">
                                            <div className="flex flex-col gap-1">
                                                <span className="font-medium text-slate-800 dark:text-slate-200">{doc.subject || "General"}</span>
                                                <span className="text-xs text-slate-500">{doc.class_level || "No Class"}</span>
                                            </div>
                                        </TableCell>
                                        <TableCell className="align-top py-4">
                                            <div className="flex flex-wrap gap-2">
                                                <Badge variant="outline" className="bg-card font-medium text-xs whitespace-nowrap capitalize border-border">{doc.question_type.replace(/_/g, " ")}</Badge>
                                                {doc.difficulty && (
                                                    <Badge className={`text-[10px] capitalize whitespace-nowrap px-2 py-0 h-5 font-semibold ${
                                                        doc.difficulty === 'easy' ? 'bg-emerald-100/80 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400 hover:bg-emerald-100' :
                                                        doc.difficulty === 'medium' ? 'bg-amber-100/80 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400 hover:bg-amber-100' :
                                                        'bg-rose-100/80 text-rose-700 dark:bg-rose-900/40 dark:text-rose-400 hover:bg-rose-100'
                                                    }`} variant="secondary">
                                                        {doc.difficulty}
                                                    </Badge>
                                                )}
                                            </div>
                                        </TableCell>
                                        <TableCell className="align-top py-4">
                                            <div className="flex items-center gap-2">
                                                <div className="h-6 w-6 rounded-full bg-muted flex items-center justify-center border border-border shrink-0">
                                                    <span className="text-[10px] font-bold text-slate-600 dark:text-slate-400">{doc.uploaded_by_name?.charAt(0) || "S"}</span>
                                                </div>
                                                <span className="text-sm font-medium text-slate-700 dark:text-slate-300 max-w-[120px] truncate" title={doc.uploaded_by_name}>{doc.uploaded_by_name || "System"}</span>
                                            </div>
                                        </TableCell>
                                        <TableCell className="align-top py-4">
                                            <div className="flex flex-col gap-1">
                                                <span className="text-sm text-slate-800 dark:text-slate-200 font-medium">
                                                    {new Date(doc.uploaded_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                                                </span>
                                                <span className="text-xs text-slate-500">
                                                    {new Date(doc.uploaded_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                </span>
                                            </div>
                                        </TableCell>
                                        <TableCell className="align-top py-4 pr-6 text-right">
                                            <DropdownMenu>
                                                <DropdownMenuTrigger asChild>
                                                    <Button variant="ghost" size="icon" className="h-8 w-8 opacity-50 group-hover:opacity-100 transition-opacity focus:opacity-100">
                                                        <MoreVertical className="h-4 w-4" />
                                                    </Button>
                                                </DropdownMenuTrigger>
                                                <DropdownMenuContent align="end" className="w-48 shadow-lg shadow-black/5 rounded-xl border-slate-200 dark:border-slate-800">
                                                    <DropdownMenuItem onClick={() => openDocument(doc.id, false)} className="gap-2 focus:bg-indigo-50 dark:focus:bg-indigo-900/20 focus:text-indigo-600 dark:focus:text-indigo-400">
                                                        <Eye className="h-4 w-4" /> Open Viewer
                                                    </DropdownMenuItem>
                                                    <DropdownMenuItem onClick={() => openDocument(doc.id, true)} className="gap-2 focus:bg-indigo-50 dark:focus:bg-indigo-900/20 focus:text-indigo-600 dark:focus:text-indigo-400">
                                                        <Download className="h-4 w-4" /> Secure Download
                                                    </DropdownMenuItem>
                                                    <div className="h-px bg-border my-1 mx-2" />
                                                    <DropdownMenuItem
                                                        className="gap-2 text-rose-600 focus:text-rose-700 focus:bg-rose-50 dark:focus:bg-rose-900/20"
                                                        onClick={() => setDeleteTarget({ id: doc.id, title: doc.title })}
                                                    >
                                                        <Trash2 className="h-4 w-4" /> Permanently Delete
                                                    </DropdownMenuItem>
                                                </DropdownMenuContent>
                                            </DropdownMenu>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                )}
                {docsQuery.isFetchingNextPage && (
                    <div className="flex justify-center py-6">
                        <Loader2 className="h-6 w-6 animate-spin text-primary" />
                    </div>
                )}
            </CardContent>

    {
        deleteTarget && (
            <AlertDialog open onOpenChange={open => !open && setDeleteTarget(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete &quot;{deleteTarget.title}&quot;?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This permanently removes the question paper and cannot be undone.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={deleteMutation.isPending}>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            className="bg-red-600 hover:bg-red-700"
                            onClick={() => deleteMutation.mutate(deleteTarget.id)}
                            disabled={deleteMutation.isPending}
                        >
                            {deleteMutation.isPending
                                ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Deleting...</>
                                : "Delete"}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        )
    }
        </Card >
    )
}

export default function SuperAdminQuestionGeneratorPage() {
    const { isLoading, isAuthenticated, userRole } = useAuth()
    const router = useRouter()

    useEffect(() => {
        if (!isLoading && isAuthenticated && userRole === "super_admin") {
            router.replace("/super-admin?tab=question-uploader")
        }
    }, [isAuthenticated, isLoading, router, userRole])

    if (isLoading) {
        return (
            <div className="min-h-[100dvh] flex items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        )
    }

    if (!isAuthenticated) {
        return null
    }

    if (userRole !== "super_admin") {
        return (
            <div className="min-h-[100dvh] flex items-center justify-center">
                <p className="text-muted-foreground">Access denied.</p>
            </div>
        )
    }

    return null
}


