"use client"

import { useMemo, useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Wand2, FileText, Upload, File, X, FileUp, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { api } from "@/lib/api"
import { compareClassLabels } from "@/lib/classOrdering"

interface QuestionDocument {
    id: string
    title: string
    topic?: string
    subject?: string
    class_level?: string
    question_type: string
    difficulty?: string
    num_questions?: number
    context?: string
    file_name: string
    file_size: number
    mime_type: string
    uploaded_at: string
}

interface TimetableEntry {
    class_id: string
    class_name?: string
    subject_name?: string
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

function getCurrentAcademicYear() {
    const now = new Date()
    const year = now.getFullYear()
    const month = now.getMonth() + 1
    return month < 4 ? `${year - 1}-${year}` : `${year}-${year + 1}`
}

export default function QuestionGeneratorPage() {
    const queryClient = useQueryClient()
    const fileInputRef = useRef<HTMLInputElement>(null)

    const [dragActive, setDragActive] = useState(false)
    const [selectedFile, setSelectedFile] = useState<File | null>(null)

    const [title, setTitle] = useState("")
    const [subject, setSubject] = useState("")
    const [classLevel, setClassLevel] = useState("")
    const [questionType, setQuestionType] = useState("")
    const [difficulty, setDifficulty] = useState("medium")
    const [contextText, setContextText] = useState("")
    const [lastUploaded, setLastUploaded] = useState<QuestionDocument | null>(null)
    const [mobileSection, setMobileSection] = useState<"generate" | "preview">("generate")
    const academicYear = getCurrentAcademicYear()

    const { data: timetableData } = useQuery({
        queryKey: ["teacher-question-generator-timetable", academicYear],
        queryFn: () => {
            const params = new URLSearchParams()
            params.append("academic_year", academicYear)
            return api.getOrEmpty<{ timetable: TimetableEntry[] }>(`/teacher/timetable?${params.toString()}`, { timetable: [] })
        },
    })

    const classOptions = useMemo(() => {
        const map = new Map<string, string>()
        for (const row of timetableData?.timetable || []) {
            if (!row.class_id) continue
            if (!map.has(row.class_id)) {
                map.set(row.class_id, row.class_name || row.class_id)
            }
        }
        return Array.from(map.entries())
            .map(([id, name]) => ({ id, name }))
            .sort((a, b) => compareClassLabels(a.name, b.name))
    }, [timetableData])

    const subjectOptions = useMemo(() => {
        if (!classLevel) return []
        const set = new Set<string>()
        for (const row of timetableData?.timetable || []) {
            if (row.class_id !== classLevel) continue
            const subjectName = (row.subject_name || "").trim()
            if (subjectName) set.add(subjectName)
        }
        return Array.from(set).sort((a, b) => a.localeCompare(b))
    }, [classLevel, timetableData])

    const selectedClassName = useMemo(
        () => classOptions.find((cls) => cls.id === classLevel)?.name || "",
        [classOptions, classLevel]
    )

    const uploadMutation = useMutation({
        mutationFn: async (): Promise<{ document: QuestionDocument }> => {
            if (!selectedFile) throw new Error("Upload a file first")
            if (!title.trim()) throw new Error("Title is required")
            if (!subject) throw new Error("Subject is required")
            if (!classLevel) throw new Error("Class level is required")
            if (!questionType) throw new Error("Select question type")
            if (!difficulty) throw new Error("Difficulty is required")

            const formData = new FormData()
            formData.append("file", selectedFile)
            formData.append("title", title.trim() || selectedFile.name.replace(/\.[^.]+$/, ""))
            formData.append("subject", subject)
            formData.append("class_level", selectedClassName || classLevel)
            formData.append("question_type", questionType)
            formData.append("difficulty", difficulty)
            formData.append("context", contextText.trim())

            return api.postForm("/teacher/question-documents", formData)
        },
        onSuccess: () => {
            toast.success("Question document uploaded")
            const fallbackTitle = (title.trim() || selectedFile?.name || "").replace(/\.[^.]+$/, "")
            setLastUploaded({
                id: "",
                title: fallbackTitle,
                subject: subject || undefined,
                class_level: selectedClassName || classLevel || undefined,
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
            setSubject("")
            setClassLevel("")
            setQuestionType("")
            setDifficulty("medium")
            setContextText("")
            if (fileInputRef.current) fileInputRef.current.value = ""
            queryClient.invalidateQueries({ queryKey: ["teacher-question-documents"] })
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
        <div className="space-y-6">
            <Card className="border-dashed border-2 overflow-hidden">
                <CardHeader className="bg-gradient-to-r from-emerald-500/10 via-teal-500/10 to-cyan-500/10">
                    <div className="flex items-center gap-3">
                        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 shadow-lg">
                            <Upload className="h-6 w-6 text-white" />
                        </div>
                        <div>
                            <CardTitle>Upload Question Paper</CardTitle>
                            <CardDescription>Manually upload question papers in PDF or Word format</CardDescription>
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="p-4 md:p-6">
                    <div
                        className={`relative border-2 border-dashed rounded-xl p-8 transition-all duration-300 ${dragActive
                            ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/20"
                            : "border-muted-foreground/25 hover:border-muted-foreground/50"
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

                        <div className="flex flex-col items-center justify-center text-center space-y-4">
                            <div className={`flex h-20 w-20 items-center justify-center rounded-full transition-all duration-300 ${dragActive
                                ? "bg-emerald-100 dark:bg-emerald-900/30 scale-110"
                                : "bg-muted"
                                }`}>
                                <FileUp className={`h-10 w-10 transition-colors ${dragActive ? "text-emerald-600" : "text-muted-foreground"}`} />
                            </div>

                            <div>
                                <p className="text-lg font-medium">{dragActive ? "Drop your file here" : "Drag & drop your question paper"}</p>
                                <p className="text-sm text-muted-foreground mt-1">or click to browse from your computer</p>
                            </div>

                            <div className="flex items-center gap-4">
                                <span className="px-3 py-1 rounded-full bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 text-xs font-medium">PDF</span>
                                <span className="px-3 py-1 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 text-xs font-medium">DOC</span>
                                <span className="px-3 py-1 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 text-xs font-medium">DOCX</span>
                            </div>

                            <Button
                                onClick={() => fileInputRef.current?.click()}
                                className="gradient-primary border-0 mt-2"
                                disabled={uploadMutation.isPending}
                            >
                                {uploadMutation.isPending ? (
                                    <>
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                        Uploading...
                                    </>
                                ) : (
                                    <>
                                        <Upload className="mr-2 h-4 w-4" />
                                        Choose File
                                    </>
                                )}
                            </Button>
                        </div>
                    </div>

                    {selectedFile && (
                        <div className="mt-6 space-y-3">
                            <h4 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">Selected File</h4>
                            <div className="flex items-center justify-between p-4 rounded-xl border bg-card hover:shadow-md transition-all duration-200 group">
                                <div className="flex items-center gap-4">
                                    <File className={`h-8 w-8 ${selectedFile.name.toLowerCase().endsWith(".pdf") ? "text-red-500" : "text-blue-500"}`} />
                                    <div>
                                        <p className="font-medium text-sm">{selectedFile.name}</p>
                                        <p className="text-xs text-muted-foreground">{formatFileSize(selectedFile.size)}</p>
                                    </div>
                                </div>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                                    onClick={() => setSelectedFile(null)}
                                >
                                    <X className="h-4 w-4" />
                                </Button>
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>

            <div className="sm:hidden">
                <div className="inline-flex w-full rounded-xl border bg-muted/30 p-1">
                    <Button
                        type="button"
                        variant={mobileSection === "generate" ? "default" : "ghost"}
                        className="flex-1"
                        onClick={() => setMobileSection("generate")}
                    >
                        Generate Questions
                    </Button>
                    <Button
                        type="button"
                        variant={mobileSection === "preview" ? "default" : "ghost"}
                        className="flex-1"
                        onClick={() => setMobileSection("preview")}
                    >
                        Upload Preview
                    </Button>
                </div>
            </div>

            <div className="grid gap-4 md:gap-6 grid-cols-1 sm:grid-cols-2">
                <Card className={mobileSection === "preview" ? "hidden sm:block" : ""}>
                    <CardHeader>
                        <CardTitle>Generate Questions</CardTitle>
                        <CardDescription>Configure your question parameters</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6">
                        <div className="grid gap-2">
                            <Label htmlFor="title">Title</Label>
                            <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g., Unit Test - Algebra" />
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className="grid gap-2">
                                <Label htmlFor="subject">Subject</Label>
                                <Select
                                    value={subject}
                                    onValueChange={setSubject}
                                    disabled={!classLevel || subjectOptions.length === 0}
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder={!classLevel ? "Select class first" : "Select subject"} />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {subjectOptions.map((subj) => (
                                            <SelectItem key={subj} value={subj}>
                                                {subj}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="grid gap-2">
                                <Label htmlFor="class">Class Level</Label>
                                <Select
                                    value={classLevel}
                                    onValueChange={(value) => {
                                        setClassLevel(value)
                                        setSubject("")
                                    }}
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder="Select class" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {classOptions.map((cls) => (
                                            <SelectItem key={cls.id} value={cls.id}>
                                                {cls.name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>

                        <div className="grid gap-2">
                            <Label>Question Type</Label>
                            <Select value={questionType} onValueChange={setQuestionType}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Select type" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="mcq">Multiple Choice (MCQ)</SelectItem>
                                    <SelectItem value="short">Short Answer</SelectItem>
                                    <SelectItem value="long">Long Answer</SelectItem>
                                    <SelectItem value="truefalse">True/False</SelectItem>
                                    <SelectItem value="fillblank">Fill in the Blanks</SelectItem>
                                    <SelectItem value="model_question_paper">Model Question Paper</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="grid gap-2">
                            <Label>Difficulty Level</Label>
                            <div className="flex gap-2">
                                <Button variant={difficulty === "easy" ? "default" : "outline"} className="flex-1" onClick={() => setDifficulty("easy")}>Easy</Button>
                                <Button variant={difficulty === "medium" ? "default" : "outline"} className="flex-1" onClick={() => setDifficulty("medium")}>Medium</Button>
                                <Button variant={difficulty === "hard" ? "default" : "outline"} className="flex-1" onClick={() => setDifficulty("hard")}>Hard</Button>
                            </div>
                        </div>

                        <div className="grid gap-2">
                            <Label htmlFor="context">Additional Context (Optional)</Label>
                            <Textarea
                                id="context"
                                value={contextText}
                                onChange={(e) => setContextText(e.target.value)}
                                placeholder="Provide any additional context or specific areas to focus on"
                                rows={3}
                            />
                        </div>

                        <Button
                            className="w-full gradient-primary border-0"
                            onClick={() => uploadMutation.mutate()}
                            disabled={
                                uploadMutation.isPending ||
                                !selectedFile ||
                                !title.trim() ||
                                !subject ||
                                !classLevel ||
                                !questionType
                            }
                        >
                            {uploadMutation.isPending ? (
                                <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    Uploading...
                                </>
                            ) : (
                                <>
                                    <Wand2 className="mr-2 h-4 w-4" />
                                    Generate Questions
                                </>
                            )}
                        </Button>
                    </CardContent>
                </Card>

                <Card className={mobileSection === "generate" ? "hidden sm:block" : ""}>
                    <CardHeader>
                        <div className="flex items-center justify-between">
                            <div>
                                <CardTitle>Upload Preview & Metadata</CardTitle>
                                <CardDescription>Upload doc to view status and saved metadata</CardDescription>
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent>
                        {uploadMutation.isPending ? (
                            <div className="flex flex-col items-center justify-center py-12 text-center">
                                <Loader2 className="h-12 w-12 text-primary animate-spin mb-4" />
                                <p className="font-medium">Uploading document...</p>
                                <p className="text-sm text-muted-foreground">Please wait while your file is being saved</p>
                            </div>
                        ) : !previewDocument ? (
                            <div className="flex flex-col items-center justify-center py-12 text-center">
                                <FileText className="h-16 w-16 text-muted-foreground/20 mb-4" />
                                <p className="text-muted-foreground">No uploaded document selected yet</p>
                                <p className="text-sm text-muted-foreground">Choose a file and click Generate Questions to upload</p>
                            </div>
                        ) : (
                            <div className="space-y-4">
                                <div className="p-4 rounded-lg border">
                                    <div className="flex items-start gap-3">
                                        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-medium">1</div>
                                        <div className="flex-1">
                                            <p className="font-medium mb-2">{previewDocument.title || previewDocument.file_name}</p>
                                            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                                <Badge variant="outline">{previewDocument.question_type}</Badge>
                                                {previewDocument.difficulty && <Badge variant="secondary">{previewDocument.difficulty}</Badge>}
                                                {previewDocument.subject && <span>{previewDocument.subject}</span>}
                                                {previewDocument.class_level && <span>{previewDocument.class_level}</span>}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                <div className="rounded-lg border p-4 space-y-2 text-sm">
                                    <div className="flex items-center justify-between">
                                        <span className="text-muted-foreground">File Name</span>
                                        <span className="font-medium">{previewDocument.file_name}</span>
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <span className="text-muted-foreground">File Size</span>
                                        <span className="font-medium">{formatFileSize(previewDocument.file_size)}</span>
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <span className="text-muted-foreground">File Type</span>
                                        <span className="font-medium">{previewDocument.mime_type || "unknown"}</span>
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <span className="text-muted-foreground">Uploaded At</span>
                                        <span className="font-medium">{new Date(previewDocument.uploaded_at).toLocaleString()}</span>
                                    </div>
                                </div>
                                {previewDocument.topic ? <p className="text-sm">Topic: {previewDocument.topic}</p> : null}
                                {previewDocument.context ? <p className="text-sm text-muted-foreground">{previewDocument.context}</p> : null}
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    )
}

