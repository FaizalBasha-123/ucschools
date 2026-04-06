"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { compareClassLabels } from "@/lib/classOrdering"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  BookOpen,
  Box,
  ChevronLeft,
  ChevronRight,
  FileText,
  GraduationCap,
  Loader2,
  Monitor,
  Play,
  Search,
} from "lucide-react"
import { toast } from "sonner"

// Sketchfab model catalog used in 3D mode.
const SKETCHFAB_MODELS = [
  { id: "beating-heart", name: "Beating Heart",                    description: "Animated beating-heart model for live classroom demo.", embedId: "d9845afb1ee64ad094adc96320c67d98", credit: { authorName: "jalmer",                        authorUrl: "https://sketchfab.com/jalmer",          modelUrl: "https://sketchfab.com/3d-models/beating-heart-d9845afb1ee64ad094adc96320c67d98"                                 }, gradient: "from-rose-500/20 to-red-500/20" },
  { id: "brain",   name: "Regions of the Brain",              description: "Detailed anatomical regions of the human brain.",     embedId: "b2aac93ee4c440ed911f5765158edc9f", credit: { authorName: "University of Dundee, CAHID", authorUrl: "https://sketchfab.com/anatomy_dundee",   modelUrl: "https://sketchfab.com/3d-models/regions-of-the-brain-b2aac93ee4c440ed911f5765158edc9f"   }, gradient: "from-pink-500/20 to-purple-500/20" },
  { id: "heart",   name: "Cardiac Anatomy",                   description: "External view of the human heart with major vessels.", embedId: "a3f0ea2030214a6bbaa97e7357eebd58", credit: { authorName: "HannahNewey",                   authorUrl: "https://sketchfab.com/HannahNewey",     modelUrl: "https://sketchfab.com/3d-models/cardiac-anatomy-external-view-of-human-heart-a3f0ea2030214a6bbaa97e7357eebd58"   }, gradient: "from-red-500/20 to-rose-500/20" },
  { id: "lungs",   name: "Heart after Fontan Procedure",      description: "Post-operative cardiac model - paediatric cardiology.",embedId: "5d25e5608a7b4bb2a15ea842cdb5b01d", credit: { authorName: "E-learning UMCG",                authorUrl: "https://sketchfab.com/eLearningUMCG",   modelUrl: "https://sketchfab.com/3d-models/heart-after-fontan-procedure-5d25e5608a7b4bb2a15ea842cdb5b01d"                    }, gradient: "from-blue-500/20 to-cyan-500/20" },
  { id: "kidneys", name: "Kidneys",                           description: "Human kidneys - excretory system anatomy.",            embedId: "d3dc9bcc490c42f7a3bd9176de169e00", credit: { authorName: "chrishammang",                  authorUrl: "https://sketchfab.com/chrishammang",    modelUrl: "https://sketchfab.com/3d-models/kidneys-d3dc9bcc490c42f7a3bd9176de169e00"                                          }, gradient: "from-amber-500/20 to-orange-500/20" },
  { id: "gi",      name: "Gastrointestinal Tract",            description: "Full digestive system in anatomical position.",        embedId: "26d08389de354277be032be39af5aba4", credit: { authorName: "E-learning UMCG",                authorUrl: "https://sketchfab.com/eLearningUMCG",   modelUrl: "https://sketchfab.com/3d-models/gastrointestinal-tract-26d08389de354277be032be39af5aba4"                           }, gradient: "from-emerald-500/20 to-teal-500/20" },
  { id: "nervous", name: "Nervous & Cardiovascular System",   description: "Combined nervous and cardiovascular network.",        embedId: "0a9c32d586ba4493ae61f90af4fb102d", credit: { authorName: "AERO3D",                        authorUrl: "https://sketchfab.com/aero3d.ua",       modelUrl: "https://sketchfab.com/3d-models/human-nervous-and-cardiovascular-system-0a9c32d586ba4493ae61f90af4fb102d"          }, gradient: "from-violet-500/20 to-indigo-500/20" },
  { id: "pancreas",name: "Pancreas Cross Section",            description: "Anatomical cross-section of the pancreas.",           embedId: "8acf64dc315b49308b4fcbd47e48b92b", credit: { authorName: "Nima",                          authorUrl: "https://sketchfab.com/h3ydari96",       modelUrl: "https://sketchfab.com/3d-models/pancreas-cross-section-anatomy-8acf64dc315b49308b4fcbd47e48b92b"                    }, gradient: "from-yellow-500/20 to-lime-500/20" },
] as const
type TeachModel = typeof SKETCHFAB_MODELS[number]

interface TimetableEntry {
  class_id: string
  class_name?: string
  subject_name?: string
}

interface StudyMaterial {
  id: string
  title: string
  uploader_name?: string
  uploader_role?: string
  teacher_name?: string
  subject: string
  class_level: string
  description?: string
  file_name: string
  file_size: number
  mime_type: string
  uploaded_at: string
}

interface StudyMaterialsPage {
  materials: StudyMaterial[]
  page: number
  page_size: number
  has_more: boolean
  next_page: number
  order: "asc" | "desc"
}

type PreviewKind = "pdf" | "txt" | "mp4" | "office" | "unknown"

function getCurrentAcademicYear() {
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth() + 1
  return month < 4 ? `${year - 1}-${year}` : `${year}-${year + 1}`
}

function getExt(name: string) {
  const idx = name.lastIndexOf(".")
  if (idx === -1) return ""
  return name.slice(idx + 1).toLowerCase()
}

function getPreviewKind(material: StudyMaterial | null): PreviewKind {
  if (!material) return "unknown"
  const mime = material.mime_type.toLowerCase()
  const ext = getExt(material.file_name)
  if (mime === "application/pdf" || ext === "pdf") return "pdf"
  if (mime.startsWith("video/mp4") || ext === "mp4") return "mp4"
  if (mime.startsWith("text/plain") || ext === "txt") return "txt"
  if (["doc", "docx", "ppt", "pptx"].includes(ext)) return "office"
  return "unknown"
}

export default function TeachPage() {
  const academicYear = getCurrentAcademicYear()

  // Page mode toggle between study materials and 3D models.
  const [mode, setMode] = useState<"materials" | "3d-models">("materials")

  // Currently selected Sketchfab model.
  const [selectedModel, setSelectedModel] = useState<TeachModel>(SKETCHFAB_MODELS[0])

  // Materials state.
  const [selectedClassId, setSelectedClassId] = useState("")
  const [selectedSubject, setSelectedSubject] = useState("")
  const [searchQuery, setSearchQuery] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")

  const [selectedMaterial, setSelectedMaterial] = useState<StudyMaterial | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewText, setPreviewText] = useState<string>("")
  const [previewLoading, setPreviewLoading] = useState(false)
  const [listCollapsed, setListCollapsed] = useState(false)
  const [isMobileListOpen, setIsMobileListOpen] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery.trim()), 300)
    return () => clearTimeout(timer)
  }, [searchQuery])

  const { data: timetableData } = useQuery({
    queryKey: ["teacher-teach-timetable", academicYear],
    queryFn: () => api.getOrEmpty<{ timetable: TimetableEntry[] }>(`/teacher/timetable?academic_year=${encodeURIComponent(academicYear)}`, { timetable: [] }),
    staleTime: 60 * 1000,
  })

  const classOptions = useMemo(() => {
    const map = new Map<string, string>()
    for (const row of timetableData?.timetable || []) {
      if (!row.class_id) continue
      const className = (row.class_name || "").trim()
      if (!className) continue
      if (!map.has(row.class_id)) map.set(row.class_id, className)
    }
    return [...map.entries()]
      .map(([classID, className]) => ({ classID, className }))
      .sort((a, b) => compareClassLabels(a.className, b.className))
  }, [timetableData?.timetable])

  const effectiveSelectedClassId = selectedClassId || classOptions[0]?.classID || ""

  const subjectOptions = useMemo(() => {
    if (!effectiveSelectedClassId) return []
    const set = new Set<string>()
    for (const row of timetableData?.timetable || []) {
      if (row.class_id !== effectiveSelectedClassId) continue
      const subject = (row.subject_name || "").trim()
      if (subject) set.add(subject)
    }
    return [...set].sort((a, b) => a.localeCompare(b))
  }, [effectiveSelectedClassId, timetableData?.timetable])

  useEffect(() => {
    if (!effectiveSelectedClassId) {
      setSelectedSubject("")
      return
    }
    if (!subjectOptions.includes(selectedSubject)) {
      setSelectedSubject(subjectOptions[0] || "")
    }
  }, [effectiveSelectedClassId, subjectOptions, selectedSubject])

  const selectedClassName = useMemo(() => {
    const selected = classOptions.find((x) => x.classID === effectiveSelectedClassId)
    return selected?.className || ""
  }, [effectiveSelectedClassId, classOptions])

  const { data: materialsData, isLoading: isMaterialsLoading } = useQuery({
    queryKey: ["teacher-teach-materials", selectedClassName, selectedSubject, debouncedSearch],
    queryFn: () => {
      const params = new URLSearchParams()
      params.set("page", "1")
      params.set("page_size", "100")
      params.set("order", "asc")
      if (selectedClassName) params.set("class_level", selectedClassName)
      if (selectedSubject) params.set("subject", selectedSubject)
      if (debouncedSearch) params.set("search", debouncedSearch)
      return api.getOrEmpty<StudyMaterialsPage>(`/teacher/materials?${params.toString()}`, { materials: [], page: 1, page_size: 100, has_more: false, next_page: 0, order: 'asc' })
    },
    enabled: !!selectedClassName && !!selectedSubject,
  })

  const materials = materialsData?.materials || []

  useEffect(() => {
    if (!selectedMaterial) return
    const stillExists = materials.find((m) => m.id === selectedMaterial.id)
    if (!stillExists) {
      setSelectedMaterial(materials[0] || null)
      setPreviewText("")
    }
  }, [materials, selectedMaterial])

  useEffect(() => {
    if (!selectedMaterial && materials.length > 0) {
      setSelectedMaterial(materials[0])
    }
  }, [materials, selectedMaterial])

  useEffect(() => {
    if (selectedMaterial) {
      setIsMobileListOpen(false)
    }
  }, [selectedMaterial])

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    }
  }, [previewUrl])

  const fetchMaterialBlob = async (id: string, mode: "view" | "download") => {
    return api.fetchBlob(`/teacher/materials/${id}/${mode}`)
  }

  useEffect(() => {
    const loadPreview = async () => {
      if (!selectedMaterial) return
      const kind = getPreviewKind(selectedMaterial)

      setPreviewLoading(true)
      setPreviewText("")
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl)
        setPreviewUrl(null)
      }

      try {
        const blob = await fetchMaterialBlob(selectedMaterial.id, "view")

        if (kind === "txt") {
          const text = await blob.text()
          setPreviewText(text)
        } else {
          const url = URL.createObjectURL(blob)
          setPreviewUrl(url)
        }
      } catch (error) {
        toast.error("Failed to load preview", {
          description: error instanceof Error ? error.message : "Unexpected error",
        })
      } finally {
        setPreviewLoading(false)
      }
    }

    void loadPreview()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMaterial?.id])

  const previewKind = getPreviewKind(selectedMaterial)

  return (
    <div className="space-y-4">
      {/* Top control bar */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
            {/* Class/Subject selectors hidden in 3D mode */}
            {mode === "materials" && (
              <div className="grid flex-1 grid-cols-2 gap-2 xl:flex xl:flex-row xl:gap-3">
                <Select
                  value={effectiveSelectedClassId}
                  onValueChange={(value) => {
                    setSelectedClassId(value)
                    setSelectedSubject("")
                    setSelectedMaterial(null)
                  }}
                >
                  <SelectTrigger className="w-full min-w-0 xl:w-[240px]">
                    <GraduationCap className="h-4 w-4 mr-2" />
                    <SelectValue placeholder="Select class" />
                  </SelectTrigger>
                  <SelectContent>
                    {classOptions.map((opt) => (
                      <SelectItem key={opt.classID} value={opt.classID}>
                        {opt.className}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select value={selectedSubject} onValueChange={setSelectedSubject} disabled={!effectiveSelectedClassId}>
                  <SelectTrigger className="w-full min-w-0 xl:w-[260px]">
                    <BookOpen className="h-4 w-4 mr-2" />
                    <SelectValue placeholder={effectiveSelectedClassId ? "Select subject" : "Select class first"} />
                  </SelectTrigger>
                  <SelectContent>
                    {subjectOptions.map((subject) => (
                      <SelectItem key={subject} value={subject}>
                        {subject}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {mode === "3d-models" && (
              <div className="flex-1 flex items-center gap-2">
                <Box className="h-5 w-5 text-primary" />
                <span className="font-medium text-sm">3D Anatomy Models</span>
              </div>
            )}

            <div className="flex gap-2 xl:ml-auto">
              <Button
                variant="outline"
                className="w-full sm:w-auto"
                onClick={() => setMode((m) => (m === "3d-models" ? "materials" : "3d-models"))}
              >
                {mode === "3d-models" ? (
                  <>
                    <ChevronLeft className="h-4 w-4 mr-2" />
                    Back
                  </>
                ) : (
                  <>
                    <Box className="h-4 w-4 mr-2" />
                    3D Models
                  </>
                )}
              </Button>

              {mode === "materials" && (
                <Link href="/teacher/teach/whiteboard">
                  <Button variant="outline" className="w-full sm:w-auto">
                    <Monitor className="h-4 w-4 mr-2" />
                    Whiteboard
                  </Button>
                </Link>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 3D models layout */}
      {mode === "3d-models" && (
        <div className="grid gap-4 grid-cols-1 xl:grid-cols-[260px_minmax(0,1fr)]">
          {/* Left: model list */}
          <Card>
            <CardContent className="p-3 space-y-1">
              {SKETCHFAB_MODELS.map((model) => {
                const active = selectedModel.id === model.id
                return (
                  <button
                    key={model.id}
                    type="button"
                    onClick={() => setSelectedModel(model)}
                    className={`w-full text-left rounded-lg border px-3 py-2.5 transition-colors ${
                      active ? "border-primary bg-primary/5 text-primary" : "hover:bg-muted/50 border-transparent"
                    }`}
                  >
                    <p className="font-medium text-sm">{model.name}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{model.description}</p>
                  </button>
                )
              })}
            </CardContent>
          </Card>

          {/* Right: Sketchfab viewer */}
          <Card className="overflow-hidden">
            <CardContent className="p-0 relative h-[calc(100vh-200px)] min-h-[480px]">
              <iframe
                key={selectedModel.embedId}
                title={selectedModel.name}
                src={`https://sketchfab.com/models/${selectedModel.embedId}/embed`}
                frameBorder={0}
                allowFullScreen
                allow="autoplay; fullscreen; xr-spatial-tracking"
                className="absolute inset-0 w-full h-full"
              />
              <div className="absolute bottom-0 left-0 right-0 px-3 py-1.5 bg-black/60 flex flex-wrap items-center gap-1 text-[10px] text-white/70 pointer-events-none">
                <span>Model by</span>
                <span className="font-semibold text-[#1CAAD9]">{selectedModel.credit.authorName}</span>
                <span>on Sketchfab</span>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Materials layout */}
      {mode === "materials" && (
        <div
          className={`grid gap-4 grid-cols-1 ${
            listCollapsed ? "xl:grid-cols-[56px_minmax(0,1fr)]" : "xl:grid-cols-[360px_minmax(0,1fr)]"
          }`}
        >
          <Card className={`hidden xl:block ${listCollapsed ? "xl:col-span-1" : ""}`}>
            <CardContent className="p-2">
              <div className="flex items-center gap-2 p-2">
                {!listCollapsed ? (
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-9"
                      placeholder="Search by title, file or topic"
                    />
                  </div>
                ) : null}
                <Button variant="outline" size="icon" onClick={() => setListCollapsed((prev) => !prev)}>
                  {listCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
                </Button>
              </div>

              {!listCollapsed ? (
                <div className="space-y-3 p-2 pt-1">
                  <div className="max-h-[560px] overflow-y-auto space-y-2 pr-1">
                    {isMaterialsLoading ? (
                      <div className="flex items-center justify-center text-muted-foreground py-12 gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" /> Loading materials...
                      </div>
                    ) : materials.length === 0 ? (
                      <div className="text-sm text-muted-foreground py-12 text-center">No materials found for selected class/subject.</div>
                    ) : (
                      materials.map((material) => {
                        const active = selectedMaterial?.id === material.id
                        return (
                          <button
                            type="button"
                            key={material.id}
                            onClick={() => setSelectedMaterial(material)}
                            className={`w-full text-left rounded-lg border p-3 transition ${active ? "border-primary bg-primary/5" : "hover:bg-muted/40"}`}
                          >
                            <p className="font-medium truncate">{material.title || material.file_name}</p>
                            <p className="text-xs text-muted-foreground truncate mt-1">{material.file_name}</p>
                            <div className="mt-2 overflow-hidden text-xs text-muted-foreground">
                              <span className="block truncate whitespace-nowrap">
                                {material.class_level} • {material.subject}
                              </span>
                            </div>
                          </button>
                        )
                      })
                    )}
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card className="relative overflow-hidden">
            <CardContent>
              <div className="xl:hidden">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-label="Open materials list"
                  onClick={() => setIsMobileListOpen(true)}
                  className="absolute left-3 top-3 z-20 h-9 rounded-full border-border/80 bg-background/95 px-3 shadow-sm backdrop-blur"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>

              {!selectedMaterial ? (
                <div className="h-[52vh] min-h-[320px] md:h-[600px] flex items-center justify-center text-muted-foreground border rounded-lg">
                  Select a material to preview.
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="h-[58vh] min-h-[360px] md:h-[650px] border rounded-lg overflow-hidden bg-muted/20">
                    {previewLoading ? (
                      <div className="h-full flex items-center justify-center text-muted-foreground gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" /> Loading preview...
                      </div>
                    ) : previewKind === "pdf" && previewUrl ? (
                      <iframe src={previewUrl} className="w-full h-full" title="PDF Preview" />
                    ) : previewKind === "mp4" && previewUrl ? (
                      <video className="w-full h-full bg-black" controls src={previewUrl} />
                    ) : previewKind === "txt" ? (
                      <pre className="h-full w-full p-4 text-sm whitespace-pre-wrap overflow-auto">{previewText || "No text content."}</pre>
                    ) : previewKind === "office" && previewUrl ? (
                      <div className="h-full flex flex-col">
                        <iframe src={previewUrl} className="w-full flex-1" title="Office Preview" />
                        <div className="p-2 border-t text-xs text-muted-foreground">
                          If your browser cannot render this file inline, use Download.
                        </div>
                      </div>
                    ) : (
                      <div className="h-full flex flex-col items-center justify-center text-muted-foreground gap-2 p-4 md:p-6 text-center">
                        <FileText className="h-8 w-8" />
                        <p>Inline preview not available for this file.</p>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <Badge variant="outline">Supported: PDF, DOC, DOCX, PPT, PPTX, TXT, MP4</Badge>
                    {previewKind === "office" ? (
                      <Badge variant="secondary"><Play className="h-3 w-3 mr-1" /> Office preview may vary by browser</Badge>
                    ) : null}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <div
            className={`xl:hidden fixed inset-0 z-40 transition-all duration-200 ${
              isMobileListOpen ? "pointer-events-auto" : "pointer-events-none"
            }`}
            aria-hidden={!isMobileListOpen}
          >
            <div
              className={`absolute inset-0 bg-black/35 transition-opacity duration-200 ${
                isMobileListOpen ? "opacity-100" : "opacity-0"
              }`}
              onClick={() => setIsMobileListOpen(false)}
            />

            <div
              className={`absolute left-0 top-0 h-full w-[88vw] max-w-sm border-r bg-background shadow-2xl transition-transform duration-200 ${
                isMobileListOpen ? "translate-x-0" : "-translate-x-full"
              }`}
            >
              <div className="flex h-full flex-col">
                <div className="flex items-center gap-2 border-b p-3">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-9"
                      placeholder="Search materials"
                    />
                  </div>
                  <Button type="button" variant="outline" size="icon" onClick={() => setIsMobileListOpen(false)}>
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                </div>

                <div className="flex-1 overflow-y-auto p-3">
                  <div className="space-y-2">
                    {isMaterialsLoading ? (
                      <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" /> Loading materials...
                      </div>
                    ) : materials.length === 0 ? (
                      <div className="py-12 text-center text-sm text-muted-foreground">
                        No materials found for selected class and subject.
                      </div>
                    ) : (
                      materials.map((material) => {
                        const active = selectedMaterial?.id === material.id
                        return (
                          <button
                            type="button"
                            key={`mobile-${material.id}`}
                            onClick={() => setSelectedMaterial(material)}
                            className={`w-full rounded-xl border p-3 text-left transition ${
                              active ? "border-primary bg-primary/5" : "hover:bg-muted/40"
                            }`}
                          >
                            <p className="truncate font-medium">{material.title || material.file_name}</p>
                            <p className="mt-1 truncate text-xs text-muted-foreground">{material.file_name}</p>
                            <p className="mt-2 truncate whitespace-nowrap text-xs text-muted-foreground">
                              {material.class_level} • {material.subject}
                            </p>
                          </button>
                        )
                      })
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
