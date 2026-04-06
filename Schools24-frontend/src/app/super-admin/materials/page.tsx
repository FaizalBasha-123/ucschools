"use client"

import { useEffect, useMemo, useRef, useState } from 'react'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { compareClassLabels } from '@/lib/classOrdering'
import { toast } from 'sonner'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { BookOpen, Download, Eye, File, FileText, Filter, GraduationCap, Loader2, Search, Trash2, Upload, Users, X } from 'lucide-react'

interface CatalogClass {
  id: string
  name: string
  sort_order: number
}

interface CatalogSubject {
  id: string
  name: string
  code?: string
}

interface StudyMaterial {
  id: string
  title: string
  uploader_name?: string
  uploader_role?: string
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

const ACCEPTED_EXTENSIONS = ['pdf', 'doc', 'docx', 'ppt', 'pptx', 'txt', 'mp4']
const MAX_FILE_SIZE = 25 * 1024 * 1024

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

export function SuperAdminMaterialsForm() {
  const queryClient = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [subjectFilter, setSubjectFilter] = useState('all')
  const [classFilter, setClassFilter] = useState('all')

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [selectedClass, setSelectedClass] = useState('')
  const [selectedSubject, setSelectedSubject] = useState('')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)

  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewMaterial, setPreviewMaterial] = useState<StudyMaterial | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [uploadOpen, setUploadOpen] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery.trim()), 300)
    return () => clearTimeout(timer)
  }, [searchQuery])

  const { data: classesData } = useQuery({
    queryKey: ['super-admin-catalog-classes', 'materials'],
    queryFn: () => api.get<{ classes: CatalogClass[] }>('/super-admin/catalog/classes'),
    staleTime: 10 * 60_000,
    refetchOnWindowFocus: false,
  })

  const { data: subjectsData } = useQuery({
    queryKey: ['super-admin-catalog-subjects', 'materials'],
    queryFn: () => api.get<{ subjects: CatalogSubject[] }>('/super-admin/catalog/subjects'),
    staleTime: 10 * 60_000,
    refetchOnWindowFocus: false,
  })

  const classOptions = useMemo(() => {
    return [...(classesData?.classes || [])].sort((a, b) => compareClassLabels(a.name, b.name))
  }, [classesData?.classes])

  const subjectOptions = useMemo(() => {
    return [...(subjectsData?.subjects || [])].map((s) => s.name).filter(Boolean).sort((a, b) => a.localeCompare(b))
  }, [subjectsData?.subjects])

  const {
    data,
    isLoading,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['super-admin-materials', 50, 'asc', subjectFilter, classFilter, debouncedSearch],
    initialPageParam: 1,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams()
      params.set('page', String(pageParam))
      params.set('page_size', '50')
      params.set('order', 'asc')
      if (subjectFilter !== 'all') params.set('subject', subjectFilter)
      if (classFilter !== 'all') params.set('class_level', classFilter)
      if (debouncedSearch) params.set('search', debouncedSearch)
      return api.get<StudyMaterialsPage>(`/super-admin/materials?${params.toString()}`)
    },
    getNextPageParam: (lastPage) => (lastPage.has_more ? lastPage.next_page : undefined),
    staleTime: 30_000,
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
    return api.fetchBlob(`/super-admin/materials/${id}/${mode}`)
  }

  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!selectedFile) throw new Error('Choose a file first')
      if (!title.trim()) throw new Error('Title is required')
      if (!selectedClass) throw new Error('Class is required')
      if (!selectedSubject) throw new Error('Subject is required')

      const formData = new FormData()
      formData.append('file', selectedFile)
      formData.append('title', title.trim())
      formData.append('description', description.trim())
      formData.append('subject', selectedSubject)
      formData.append('class_level', selectedClass)

      return api.postForm('/super-admin/materials', formData)
    },
    onSuccess: () => {
      toast.success('Study material uploaded')
      setTitle('')
      setDescription('')
      setSelectedClass('')
      setSelectedSubject('')
      setSelectedFile(null)
      setUploadOpen(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
      queryClient.invalidateQueries({ queryKey: ['super-admin-materials'] })
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : 'Upload failed'
      toast.error('Upload failed', { description: message })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/super-admin/materials/${id}`),
    onSuccess: () => {
      toast.success('Study material deleted')
      queryClient.invalidateQueries({ queryKey: ['super-admin-materials'] })
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
    if (!title.trim()) setTitle(file.name.replace(/\.[^.]+$/, ''))
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
      <div className="space-y-6 max-w-7xl mx-auto pb-12">
        {/* Header */}
        <div className="flex flex-col gap-4 lg:flex-row xl:items-center xl:justify-between bg-card/40 p-6 rounded-2xl border border-border/50 backdrop-blur-xl">
          <div>
            <h1 className="text-2xl md:text-3xl font-extrabold bg-gradient-to-r from-emerald-600 to-teal-500 bg-clip-text text-transparent tracking-tight">
              Study Materials
            </h1>
            <p className="text-slate-500 dark:text-slate-400 mt-1 font-medium">Manage and distribute curriculum resources globally.</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-2 px-4 py-2 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 rounded-xl border border-emerald-100 dark:border-emerald-500/20 font-medium">
              <BookOpen className="h-4 w-4" />
              <span>{materials.length} Materials</span>
            </div>
            <Button onClick={() => setUploadOpen(true)} className="bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white shadow-md shadow-emerald-500/20 h-10 px-5 rounded-xl font-medium transition-all">
              <Upload className="mr-2 h-4 w-4" />
              Upload Material
            </Button>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-card/60 backdrop-blur-xl rounded-2xl border border-border/60 p-4 shadow-sm flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 h-11 bg-card/80 border-border rounded-xl focus-visible:ring-emerald-500 transition-shadow"
              placeholder="Search by title, file or description..."
            />
          </div>
          <div className="flex flex-col sm:flex-row items-center gap-3 w-full lg:w-auto">
            <Select value={classFilter} onValueChange={setClassFilter}>
              <SelectTrigger className="w-full sm:w-[180px] h-11 bg-card/80 border-border rounded-xl">
                <div className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
                  <GraduationCap className="h-4 w-4 text-indigo-500" />
                  <SelectValue placeholder="All Classes" />
                </div>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Classes</SelectItem>
                {classOptions.map((cls) => <SelectItem key={cls.id} value={cls.name}>{cls.name}</SelectItem>)}
              </SelectContent>
            </Select>

            <Select value={subjectFilter} onValueChange={setSubjectFilter}>
              <SelectTrigger className="w-full sm:w-[180px] h-11 bg-card/80 border-border rounded-xl">
                <div className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
                  <FileText className="h-4 w-4 text-emerald-500" />
                  <SelectValue placeholder="All Subjects" />
                </div>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Subjects</SelectItem>
                {subjectOptions.map((subject) => <SelectItem key={subject} value={subject}>{subject}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Table Data */}
        <div className="bg-card/60 backdrop-blur-xl rounded-2xl border border-border/60 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50 border-b border-border/60 hover:bg-transparent">
                  <TableHead className="font-semibold text-slate-600 dark:text-slate-300 py-4 px-6">Material</TableHead>
                  <TableHead className="font-semibold text-slate-600 dark:text-slate-300 py-4 px-6">Uploaded By</TableHead>
                  <TableHead className="font-semibold text-slate-600 dark:text-slate-300 py-4 px-6">Subject</TableHead>
                  <TableHead className="font-semibold text-slate-600 dark:text-slate-300 py-4 px-6">Class Level</TableHead>
                  <TableHead className="font-semibold text-slate-600 dark:text-slate-300 py-4 px-6">Date & Size</TableHead>
                  <TableHead className="text-right font-semibold text-slate-600 dark:text-slate-300 py-4 px-6">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-48 text-center text-slate-500">
                      <div className="flex flex-col items-center justify-center">
                        <Loader2 className="h-8 w-8 animate-spin text-emerald-500 mb-4" />
                        Loading materials...
                      </div>
                    </TableCell>
                  </TableRow>
                ) : materials.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-64 text-center">
                      <div className="flex flex-col items-center justify-center">
                        <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center mb-4">
                          <FileText className="h-8 w-8 text-slate-400" />
                        </div>
                        <p className="text-lg font-medium text-slate-900 dark:text-white">No materials found</p>
                        <p className="text-sm text-slate-500 mt-1 max-w-sm">No study resources match your search criteria or none have been uploaded yet.</p>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  materials.map((material) => (
                    <TableRow key={material.id} className="group hover:bg-muted/50 transition-colors border-b border-border/60">
                      <TableCell className="px-6 py-4">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className={`h-10 w-10 shrink-0 rounded-xl flex items-center justify-center shadow-sm ${isPdf(material.mime_type, material.file_name) ? 'bg-rose-50 text-rose-500 dark:bg-rose-500/10' :
                            ['doc', 'docx'].some(ext => material.file_name.toLowerCase().endsWith(ext)) ? 'bg-blue-50 text-blue-500 dark:bg-blue-500/10' :
                              ['ppt', 'pptx'].some(ext => material.file_name.toLowerCase().endsWith(ext)) ? 'bg-amber-50 text-amber-500 dark:bg-amber-500/10' :
                                material.mime_type.includes('video') ? 'bg-purple-50 text-purple-500 dark:bg-purple-500/10' :
                                  'bg-muted text-muted-foreground'
                            }`}>
                            <FileText className="h-5 w-5" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="font-semibold text-slate-900 dark:text-white truncate" title={material.title || material.file_name}>{material.title || material.file_name}</p>
                            <p className="text-xs text-slate-500 truncate" title={material.file_name}>{material.file_name}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="px-6 py-4 text-slate-600 dark:text-slate-300 font-medium">
                        {material.uploader_name || 'Super Admin'}
                      </TableCell>
                      <TableCell className="px-6 py-4">
                        <Badge variant="secondary" className="bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-400 font-medium">
                          {material.subject}
                        </Badge>
                      </TableCell>
                      <TableCell className="px-6 py-4">
                        <div className="flex items-center gap-1.5 text-slate-700 dark:text-slate-300 font-medium">
                          <Users className="h-4 w-4 text-slate-400" />
                          {material.class_level}
                        </div>
                      </TableCell>
                      <TableCell className="px-6 py-4 whitespace-nowrap">
                        <div className="flex flex-col">
                          <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{new Date(material.uploaded_at).toLocaleDateString()}</span>
                          <span className="text-xs text-slate-500">{formatFileSize(material.file_size)}</span>
                        </div>
                      </TableCell>
                      <TableCell className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end gap-1 opacity-60 group-hover:opacity-100 transition-opacity">
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/30" onClick={() => handleView(material)} title="Preview">
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/30" onClick={() => handleDownload(material)} title="Download">
                            <Download className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/30" disabled={deleteMutation.isPending} onClick={() => { const ok = window.confirm(`Delete \"${material.title || material.file_name}\"?`); if (ok) deleteMutation.mutate(material.id) }} title="Delete">
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

          {isFetchingNextPage ? (
            <div className="flex items-center justify-center p-4 border-t border-slate-100 dark:border-slate-800 text-indigo-500 text-sm font-medium gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading more materials...
            </div>
          ) : null}
        </div>

        <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
          <DialogContent className="w-[95vw] max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Upload Study Material</DialogTitle>
              <DialogDescription>Share study materials for catalog classes and subjects.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="grid gap-2">
                <Label htmlFor="superadmin-material-title">Title</Label>
                <Input id="superadmin-material-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g., Class 10 Physics Notes" />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label>Class</Label>
                  <Select value={selectedClass} onValueChange={setSelectedClass}>
                    <SelectTrigger><SelectValue placeholder="Select class" /></SelectTrigger>
                    <SelectContent>{classOptions.map((cls) => <SelectItem key={cls.id} value={cls.name}>{cls.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label>Subject</Label>
                  <Select value={selectedSubject} onValueChange={setSelectedSubject}>
                    <SelectTrigger><SelectValue placeholder="Select subject" /></SelectTrigger>
                    <SelectContent>{subjectOptions.map((subject) => <SelectItem key={subject} value={subject}>{subject}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="superadmin-material-description">Description (Optional)</Label>
                <Textarea id="superadmin-material-description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Short description of the material" rows={3} />
              </div>

              <input ref={fileInputRef} type="file" className="hidden" accept=".pdf,.doc,.docx,.ppt,.pptx,.txt,.mp4,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,text/plain,video/mp4" onChange={(e) => { const file = e.target.files?.[0]; if (file) validateAndSetFile(file) }} />

              <div className="rounded-lg border border-dashed p-4">
              <div className="flex flex-col gap-3 lg:flex-row xl:items-center xl:justify-between">
                  <div className="text-sm text-muted-foreground">Allowed: {ACCEPTED_EXTENSIONS.join(', ').toUpperCase()} | Max 25MB</div>
                  <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()}><Upload className="h-4 w-4 mr-2" />Choose File</Button>
                </div>
                {selectedFile ? (
                  <div className="mt-3 flex items-center justify-between rounded-md border p-3">
                    <div className="flex items-center gap-3 min-w-0"><File className="h-5 w-5 text-blue-600" /><div className="min-w-0"><p className="text-sm font-medium truncate">{selectedFile.name}</p><p className="text-xs text-muted-foreground">{formatFileSize(selectedFile.size)}</p></div></div>
                    <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setSelectedFile(null); if (fileInputRef.current) fileInputRef.current.value = '' }}><X className="h-4 w-4" /></Button>
                  </div>
                ) : null}
              </div>

              <Button className="w-full" onClick={() => uploadMutation.mutate()} disabled={uploadMutation.isPending || !title.trim() || !selectedClass || !selectedSubject || !selectedFile}>
                {uploadMutation.isPending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Uploading...</> : <><Upload className="h-4 w-4 mr-2" />Upload Study Material</>}
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={previewOpen} onOpenChange={(open) => {
          setPreviewOpen(open)
          if (!open) {
            setPreviewMaterial(null)
            if (previewUrl) {
              URL.revokeObjectURL(previewUrl)
              setPreviewUrl(null)
            }
          }
        }}>
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
                  <div><span className="text-muted-foreground">Uploaded by:</span> {previewMaterial.uploader_name || 'Super Admin'}</div>
                  <div><span className="text-muted-foreground">Subject:</span> {previewMaterial.subject}</div>
                  <div><span className="text-muted-foreground">Class:</span> {previewMaterial.class_level}</div>
                  <div className="col-span-2"><span className="text-muted-foreground">Uploaded at:</span> {new Date(previewMaterial.uploaded_at).toLocaleString()}</div>
                </div>

                {isPdf(previewMaterial.mime_type, previewMaterial.file_name) ? (
                  <div className="border rounded-md overflow-hidden h-[65vh] bg-muted/20">
                    {previewLoading ? (
                      <div className="h-full flex items-center justify-center text-muted-foreground gap-2"><Loader2 className="h-4 w-4 animate-spin" />Loading preview...</div>
                    ) : previewUrl ? (
                      <iframe src={previewUrl} className="w-full h-full" title="Material Preview" />
                    ) : (
                      <div className="h-full flex items-center justify-center text-muted-foreground">Preview unavailable</div>
                    )}
                  </div>
                ) : (
                  <div className="border rounded-md p-4 md:p-6 text-sm text-muted-foreground">Inline preview is available only for PDF files. Use download for this material.</div>
                )}
              </div>
            ) : null}
          </DialogContent>
        </Dialog>
      </div>
    </div>
  )
}

export default SuperAdminMaterialsForm


