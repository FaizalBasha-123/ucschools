"use client"

import { useEffect, useMemo, useRef, useState } from 'react'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ValidationError } from '@/lib/api'
import { compareClassLabels } from '@/lib/classOrdering'
import { toast } from 'sonner'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import {
  BookOpen,
  Download,
  Eye,
  File,
  FileText,
  Filter,
  GraduationCap,
  Loader2,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react'

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
  order: 'asc' | 'desc'
}

function getUploaderDisplayName(material: StudyMaterial) {
  const role = (material.uploader_role || '').toLowerCase()
  if (material.id.startsWith('sa:') || role === 'super_admin' || role === 'super-admin') {
    return 'Schools24'
  }
  return material.uploader_name || material.teacher_name || 'You'
}

function formatFileSize(bytes: number) {
  if (!bytes) return '0 Bytes'
  const units = ['Bytes', 'KB', 'MB', 'GB']
  let n = bytes
  let idx = 0
  while (n >= 1024 && idx < units.length - 1) {
    n /= 1024
    idx += 1
  }
  return `${n.toFixed(idx === 0 ? 0 : 2)} ${units[idx]}`
}

function isPdf(mimeType: string, fileName: string) {
  return mimeType.toLowerCase() === 'application/pdf' || fileName.toLowerCase().endsWith('.pdf')
}

function getCurrentAcademicYear() {
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth() + 1
  return month < 4 ? `${year - 1}-${year}` : `${year}-${year + 1}`
}

const ACCEPTED_EXTENSIONS = ['pdf', 'doc', 'docx', 'ppt', 'pptx', 'txt', 'mp4']
const MAX_FILE_SIZE = 25 * 1024 * 1024

export default function TeacherMaterialsPage() {
  const queryClient = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [subjectFilter, setSubjectFilter] = useState('all')
  const [classFilter, setClassFilter] = useState('all')

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [selectedClassId, setSelectedClassId] = useState('')
  const [selectedSubject, setSelectedSubject] = useState('')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)

  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewMaterial, setPreviewMaterial] = useState<StudyMaterial | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [uploadOpen, setUploadOpen] = useState(false)
  const academicYear = getCurrentAcademicYear()

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery.trim()), 300)
    return () => clearTimeout(timer)
  }, [searchQuery])

  const { data: timetableData } = useQuery({
    queryKey: ['teacher-materials-timetable', academicYear],
    queryFn: () => api.getOrEmpty<{ timetable: TimetableEntry[] }>(`/teacher/timetable?academic_year=${encodeURIComponent(academicYear)}`, { timetable: [] }),
    staleTime: 60 * 1000,
  })

  const classOptions = useMemo(() => {
    const map = new Map<string, string>()
    for (const row of timetableData?.timetable || []) {
      if (!row.class_id) continue
      const className = (row.class_name || '').trim()
      if (!className) continue
      if (!map.has(row.class_id)) map.set(row.class_id, className)
    }
    return [...map.entries()]
      .map(([classID, className]) => ({ classID, className }))
      .sort((a, b) => compareClassLabels(a.className, b.className))
  }, [timetableData?.timetable])

  const classFilterOptions = useMemo(() => {
    const set = new Set<string>()
    for (const row of timetableData?.timetable || []) {
      const cls = (row.class_name || '').trim()
      if (cls) set.add(cls)
    }
    return [...set].sort((a, b) => compareClassLabels(a, b))
  }, [timetableData?.timetable])

  const subjectFilterOptions = useMemo(() => {
    const set = new Set<string>()
    for (const row of timetableData?.timetable || []) {
      const s = (row.subject_name || '').trim()
      if (s) set.add(s)
    }
    return [...set].sort((a, b) => a.localeCompare(b))
  }, [timetableData?.timetable])

  const uploadSubjects = useMemo(() => {
    if (!selectedClassId) return []
    const set = new Set<string>()
    for (const row of timetableData?.timetable || []) {
      if (row.class_id !== selectedClassId) continue
      const s = (row.subject_name || '').trim()
      if (s) set.add(s)
    }
    return [...set].sort((a, b) => a.localeCompare(b))
  }, [selectedClassId, timetableData?.timetable])

  const selectedClassLevel = useMemo(() => {
    if (!selectedClassId) return ''
    const selected = classOptions.find((x) => x.classID === selectedClassId)
    return (selected?.className || '').trim()
  }, [selectedClassId, classOptions])

  const {
    data,
    isLoading,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['teacher-materials', 20, 'asc', subjectFilter, classFilter, debouncedSearch],
    initialPageParam: 1,
    queryFn: async ({ pageParam }) => {
      try {
        const params = new URLSearchParams()
        params.set('page', String(pageParam))
        params.set('page_size', '20')
        params.set('order', 'asc')
        if (subjectFilter !== 'all') params.set('subject', subjectFilter)
        if (classFilter !== 'all') params.set('class_level', classFilter)
        if (debouncedSearch) params.set('search', debouncedSearch)
        return await api.get<StudyMaterialsPage>(`/teacher/materials?${params.toString()}`)
      } catch (e) {
        if (e instanceof ValidationError) return { materials: [], page: 1, page_size: 20, has_more: false, next_page: 0, order: 'asc' as const }
        throw e
      }
    },
    getNextPageParam: (lastPage) => (lastPage.has_more ? lastPage.next_page : undefined),
  })

  useEffect(() => {
    const onScroll = () => {
      if (!hasNextPage || isFetchingNextPage) return
      const el = document.documentElement
      const scrollTop = window.scrollY || el.scrollTop
      const viewportBottom = scrollTop + window.innerHeight
      const threshold = el.scrollHeight * 0.8
      if (viewportBottom >= threshold) fetchNextPage()
    }

    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  const materials = useMemo(() => data?.pages.flatMap((p) => p.materials) || [], [data])

  const fetchMaterialBlob = async (id: string, mode: 'view' | 'download') => {
    return api.fetchBlob(`/teacher/materials/${id}/${mode}`)
  }

  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!selectedFile) throw new Error('Choose a file first')
      if (!title.trim()) throw new Error('Title is required')
      if (!selectedClassLevel) throw new Error('Class is required')
      if (!selectedSubject) throw new Error('Subject is required')

      const formData = new FormData()
      formData.append('file', selectedFile)
      formData.append('title', title.trim())
      formData.append('description', description.trim())
      formData.append('subject', selectedSubject)
      formData.append('class_level', selectedClassLevel)

      return api.postForm('/teacher/materials', formData)
    },
    onSuccess: () => {
      toast.success('Study material uploaded')
      setTitle('')
      setDescription('')
      setSelectedClassId('')
      setSelectedSubject('')
      setSelectedFile(null)
      setUploadOpen(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
      queryClient.invalidateQueries({ queryKey: ['teacher-materials'] })
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : 'Upload failed'
      toast.error('Upload failed', { description: message })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/teacher/materials/${id}`),
    onSuccess: () => {
      toast.success('Study material deleted')
      queryClient.invalidateQueries({ queryKey: ['teacher-materials'] })
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : 'Delete failed'
      toast.error('Delete failed', { description: message })
    },
  })

  const validateAndSetFile = (file: File) => {
    const fileName = file.name.toLowerCase()
    const ext = fileName.includes('.') ? fileName.split('.').pop() || '' : ''
    if (!ACCEPTED_EXTENSIONS.includes(ext)) {
      toast.error('Invalid format', { description: 'Allowed: PDF, DOC, DOCX, PPT, PPTX, TXT, MP4' })
      return
    }
    if (file.size <= 0 || file.size > MAX_FILE_SIZE) {
      toast.error('Invalid file size', { description: 'File size must be between 1B and 25MB' })
      return
    }

    setSelectedFile(file)
    if (!title.trim()) {
      setTitle(file.name.replace(/\.[^.]+$/, ''))
    }
  }

  const handleDownload = async (material: StudyMaterial) => {
    try {
      const blob = await fetchMaterialBlob(material.id, 'download')
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = material.file_name || material.title
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Download failed'
      toast.error('Download failed', { description: message })
    }
  }

  const handleView = async (material: StudyMaterial) => {
    setPreviewMaterial(material)
    setPreviewOpen(true)

    if (!isPdf(material.mime_type, material.file_name)) {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl)
        setPreviewUrl(null)
      }
      return
    }

    setPreviewLoading(true)
    try {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl)
        setPreviewUrl(null)
      }
      const blob = await fetchMaterialBlob(material.id, 'view')
      const url = URL.createObjectURL(blob)
      setPreviewUrl(url)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Preview failed'
      toast.error('Preview failed', { description: message })
    } finally {
      setPreviewLoading(false)
    }
  }

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    }
  }, [previewUrl])

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-xl md:text-3xl font-bold bg-gradient-to-r from-green-500 via-emerald-500 to-teal-600 bg-clip-text text-transparent">
            Study Materials
          </h1>
          <p className="text-muted-foreground mt-1">Upload and manage class materials shared by you</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="text-sm py-1.5 px-3">
            <BookOpen className="h-4 w-4 mr-2" />
            {materials.length} Materials
          </Badge>
          <Button className="whitespace-nowrap" onClick={() => setUploadOpen(true)}>
            <Upload className="h-4 w-4 mr-2" />
            Upload Material
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-center">
            <div className="relative flex-1 min-w-0">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
                placeholder="Search by title, file name or description"
              />
            </div>

            <div className="flex w-full gap-3 overflow-x-auto pb-1 sm:grid sm:grid-cols-2 sm:overflow-visible sm:pb-0 xl:w-auto">
              <div className="min-w-[220px] sm:min-w-0">
                <Select value={subjectFilter} onValueChange={setSubjectFilter}>
                  <SelectTrigger className="w-full whitespace-nowrap sm:w-[220px] [&>span]:truncate [&>span]:whitespace-nowrap">
                    <Filter className="h-4 w-4 mr-2" />
                    <SelectValue placeholder="All Subjects" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Subjects</SelectItem>
                    {subjectFilterOptions.map((subject) => (
                      <SelectItem key={subject} value={subject}>
                        {subject}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="min-w-[220px] sm:min-w-0">
                <Select value={classFilter} onValueChange={setClassFilter}>
                  <SelectTrigger className="w-full whitespace-nowrap sm:w-[220px] [&>span]:truncate [&>span]:whitespace-nowrap">
                    <GraduationCap className="h-4 w-4 mr-2" />
                    <SelectValue placeholder="All Classes" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Classes</SelectItem>
                    {classFilterOptions.map((cls) => (
                      <SelectItem key={cls} value={cls}>
                        {cls}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <div className="rounded-lg border overflow-hidden">
            <div className="hidden overflow-x-auto md:block">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead>Material</TableHead>
                  <TableHead>Uploaded By</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead>Class</TableHead>
                  <TableHead>Uploaded</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-12 text-muted-foreground">Loading materials...</TableCell>
                  </TableRow>
                ) : materials.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-12">
                      <FileText className="h-12 w-12 mx-auto text-muted-foreground/30 mb-4" />
                      <p className="text-muted-foreground">No materials found</p>
                    </TableCell>
                  </TableRow>
                ) : (
                  materials.map((material) => (
                    <TableRow key={material.id}>
                      <TableCell>
                        <div className="min-w-0">
                          <p className="font-medium truncate">{material.title || material.file_name}</p>
                          <p className="text-xs text-muted-foreground truncate">{material.file_name}</p>
                        </div>
                      </TableCell>
                      <TableCell>{getUploaderDisplayName(material)}</TableCell>
                      <TableCell><Badge variant="outline">{material.subject}</Badge></TableCell>
                      <TableCell>{material.class_level}</TableCell>
                      <TableCell>{new Date(material.uploaded_at).toLocaleDateString()}</TableCell>
                      <TableCell>{formatFileSize(material.file_size)}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleView(material)}>
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleDownload(material)}>
                            <Download className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-red-600 hover:text-red-700"
                            disabled={deleteMutation.isPending || material.id.startsWith('sa:')}
                            title={material.id.startsWith('sa:') ? 'Global material cannot be deleted by teacher' : 'Delete'}
                            onClick={() => {
                              const ok = window.confirm(`Delete \"${material.title || material.file_name}\"?`)
                              if (ok) deleteMutation.mutate(material.id)
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
            </div>

            <div className="divide-y md:hidden">
              {isLoading ? (
                <div className="py-12 text-center text-muted-foreground">Loading materials...</div>
              ) : materials.length === 0 ? (
                <div className="py-12 text-center">
                  <FileText className="h-12 w-12 mx-auto text-muted-foreground/30 mb-4" />
                  <p className="text-muted-foreground">No materials found</p>
                </div>
              ) : (
                materials.map((material) => (
                  <div key={material.id} className="space-y-3 p-4">
                    <div className="min-w-0">
                      <p className="font-medium leading-tight">{material.title || material.file_name}</p>
                      <p className="mt-1 truncate text-xs text-muted-foreground">{material.file_name}</p>
                    </div>
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <p className="text-xs text-muted-foreground">Uploaded By</p>
                        <p>{getUploaderDisplayName(material)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Uploaded</p>
                        <p>{new Date(material.uploaded_at).toLocaleDateString()}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Subject</p>
                        <Badge variant="outline" className="mt-1">{material.subject}</Badge>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Class</p>
                        <p>{material.class_level}</p>
                      </div>
                      <div className="col-span-2">
                        <p className="text-xs text-muted-foreground">Size</p>
                        <p>{formatFileSize(material.file_size)}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="sm" className="flex-1" onClick={() => handleView(material)}>
                        <Eye className="mr-2 h-4 w-4" />
                        View
                      </Button>
                      <Button variant="outline" size="sm" className="flex-1" onClick={() => handleDownload(material)}>
                        <Download className="mr-2 h-4 w-4" />
                        Download
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-red-600 hover:text-red-700"
                        disabled={deleteMutation.isPending || material.id.startsWith('sa:')}
                        title={material.id.startsWith('sa:') ? 'Global material cannot be deleted by teacher' : 'Delete'}
                        onClick={() => {
                          const ok = window.confirm(`Delete \"${material.title || material.file_name}\"?`)
                          if (ok) deleteMutation.mutate(material.id)
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {isFetchingNextPage ? (
            <div className="flex items-center justify-center py-4 text-muted-foreground text-sm gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading next 20 rows...
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Dialog
        open={previewOpen}
        onOpenChange={(open) => {
          setPreviewOpen(open)
          if (!open) {
            setPreviewMaterial(null)
            if (previewUrl) {
              URL.revokeObjectURL(previewUrl)
              setPreviewUrl(null)
            }
          }
        }}
      >
        <DialogContent className="w-[95vw] max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{previewMaterial?.title || previewMaterial?.file_name || 'Material Preview'}</DialogTitle>
            <DialogDescription>Preview metadata and document details</DialogDescription>
          </DialogHeader>

          {previewMaterial ? (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                <div><span className="text-muted-foreground">File name:</span> {previewMaterial.file_name}</div>
                <div><span className="text-muted-foreground">Type:</span> {previewMaterial.mime_type || 'unknown'}</div>
                <div><span className="text-muted-foreground">Size:</span> {formatFileSize(previewMaterial.file_size)}</div>
                <div><span className="text-muted-foreground">Uploaded by:</span> {previewMaterial.uploader_name || previewMaterial.teacher_name || 'You'}</div>
                <div><span className="text-muted-foreground">Subject:</span> {previewMaterial.subject}</div>
                <div><span className="text-muted-foreground">Class:</span> {previewMaterial.class_level}</div>
                <div><span className="text-muted-foreground">Uploaded at:</span> {new Date(previewMaterial.uploaded_at).toLocaleString()}</div>
                {previewMaterial.description ? (
                  <div className="col-span-2"><span className="text-muted-foreground">Description:</span> {previewMaterial.description}</div>
                ) : null}
              </div>

              {isPdf(previewMaterial.mime_type, previewMaterial.file_name) ? (
                <div className="border rounded-md overflow-hidden h-[65vh] bg-muted/20">
                  {previewLoading ? (
                    <div className="h-full flex items-center justify-center text-muted-foreground gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading preview...
                    </div>
                  ) : previewUrl ? (
                    <iframe src={previewUrl} className="w-full h-full" title="Material Preview" />
                  ) : (
                    <div className="h-full flex items-center justify-center text-muted-foreground">
                      Preview unavailable
                    </div>
                  )}
                </div>
              ) : (
                <div className="border rounded-md p-4 md:p-6 text-sm text-muted-foreground">
                  Inline preview is available only for PDF files. Use download for this material.
                </div>
              )}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
        <DialogContent className="w-[95vw] max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Upload Study Material</DialogTitle>
            <DialogDescription>Share study materials with your students.</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid gap-2">
              <Label htmlFor="material-title">Title</Label>
              <Input
                id="material-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g., Chapter 5 Notes"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>Class</Label>
                <Select
                  value={selectedClassId}
                  onValueChange={(value) => {
                    setSelectedClassId(value)
                    setSelectedSubject('')
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select class" />
                  </SelectTrigger>
                  <SelectContent>
                    {classOptions.map((cls) => (
                      <SelectItem key={cls.classID} value={cls.classID}>
                        {cls.className}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-2">
                <Label>Subject</Label>
                <Select
                  value={selectedSubject}
                  onValueChange={setSelectedSubject}
                  disabled={!selectedClassId || uploadSubjects.length === 0}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={!selectedClassId ? 'Select class first' : 'Select subject'} />
                  </SelectTrigger>
                  <SelectContent>
                    {uploadSubjects.map((subject) => (
                      <SelectItem key={subject} value={subject}>
                        {subject}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="material-description">Description (Optional)</Label>
              <Textarea
                id="material-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Short description of the material"
                rows={3}
              />
            </div>

            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept=".pdf,.doc,.docx,.ppt,.pptx,.txt,.mp4,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,text/plain,video/mp4"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) validateAndSetFile(file)
              }}
            />

            <div className="rounded-lg border border-dashed p-4">
              <div className="flex flex-col gap-3 lg:flex-row xl:items-center xl:justify-between">
                <div className="text-sm text-muted-foreground">
                  Allowed: {ACCEPTED_EXTENSIONS.join(', ').toUpperCase()} | Max 25MB
                </div>
                <Button className="w-full sm:w-auto" type="button" variant="outline" onClick={() => fileInputRef.current?.click()}>
                  <Upload className="h-4 w-4 mr-2" />
                  Choose File
                </Button>
              </div>

              {selectedFile ? (
                <div className="mt-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-md border p-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <File className="h-5 w-5 text-blue-600" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{selectedFile.name}</p>
                      <p className="text-xs text-muted-foreground">{formatFileSize(selectedFile.size)}</p>
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => {
                      setSelectedFile(null)
                      if (fileInputRef.current) fileInputRef.current.value = ''
                    }}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ) : null}
            </div>

            <Button
              className="w-full"
              onClick={() => uploadMutation.mutate()}
              disabled={uploadMutation.isPending || !title.trim() || !selectedClassId || !selectedSubject || !selectedFile}
            >
              {uploadMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Uploading...
                </>
              ) : (
                <>
                  <Upload className="h-4 w-4 mr-2" />
                  Upload Study Material
                </>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}


