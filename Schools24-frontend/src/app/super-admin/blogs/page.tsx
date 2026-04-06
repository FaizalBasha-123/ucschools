"use client"

import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import {
  ChevronDown,
  ChevronUp,
  GripVertical,
  Heading,
  ImagePlus,
  Link as LinkIcon,
  List,
  Loader2,
  Pilcrow,
  Plus,
  Quote,
  Search,
  Trash2,
} from "lucide-react"
import { toast } from "sonner"

type BlogStatus = "draft" | "published"
type BlockType = "header" | "paragraph" | "hyperlink" | "quote" | "list"
type BlogBlock = { type: BlockType; text?: string; url?: string; label?: string; level?: number }
type BlogPost = {
  id: string
  title: string
  slug: string
  excerpt: string
  read_time_minutes: number
  cover_image_url?: string
  status: BlogStatus
  content_blocks: BlogBlock[]
  published_at?: string
  created_at: string
  updated_at: string
}
type BlogListResponse = { blogs: BlogPost[] }
type BlogDraft = {
  id?: string
  title: string
  excerpt: string
  read_time_minutes: number
  cover_image_url: string
  status: BlogStatus
  content_blocks: BlogBlock[]
}

const blockTypes: BlockType[] = ["header", "paragraph", "hyperlink", "quote", "list"]
const newDraft = (): BlogDraft => ({ title: "", excerpt: "", read_time_minutes: 5, cover_image_url: "", status: "draft", content_blocks: [{ type: "header", text: "", level: 2 }] })
const blockFactory = (type: BlockType): BlogBlock => type === "header" ? { type, text: "", level: 2 } : type === "hyperlink" ? { type, label: "", url: "" } : { type, text: "" }
const toDraft = (blog: BlogPost): BlogDraft => ({ id: blog.id, title: blog.title, excerpt: blog.excerpt, read_time_minutes: blog.read_time_minutes || 5, cover_image_url: blog.cover_image_url || "", status: blog.status, content_blocks: blog.content_blocks.length ? blog.content_blocks : [{ type: "paragraph", text: "" }] })
const slugify = (value: string) => value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
const prettyDate = (iso?: string) => iso ? new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "Not published"
const summary = (block: BlogBlock) => block.type === "hyperlink" ? (block.label || block.url || "No link yet") : (block.text || "No content yet")

const normalizeUrl = (value?: string) => {
  const raw = value?.trim()
  if (!raw) return "#"
  if (raw.startsWith("http://") || raw.startsWith("https://")) return raw
  return `https://${raw}`
}

function renderPreviewBlock(block: BlogBlock, key: string) {
  if (block.type === "header") {
    const text = block.text?.trim() || "Untitled section"
    if (block.level === 1) return <h1 key={key} className="text-[2.1rem] font-extrabold leading-[1.05] tracking-[-0.05em] text-[#0d2346]">{text}</h1>
    if (block.level === 3) return <h3 key={key} className="text-[1.18rem] font-bold text-[#0d2346]">{text}</h3>
    return <h2 key={key} className="text-[1.6rem] font-extrabold tracking-[-0.04em] text-[#0d2346]">{text}</h2>
  }
  if (block.type === "paragraph") return <p key={key} className="text-[1.01rem] leading-[1.9] text-[#3e5476]">{block.text?.trim() || "Start writing your paragraph here."}</p>
  if (block.type === "quote") return <blockquote key={key} className="border-l-[3px] border-[#9eb5da] pl-4 text-[1.05rem] italic leading-[1.9] text-[#26466f]">{block.text?.trim() || "Add a quote."}</blockquote>
  if (block.type === "list") {
    const items = (block.text || "").split("\n").map((item) => item.trim()).filter(Boolean)
    return <ul key={key} className="list-disc space-y-2.5 pl-6 text-[1.01rem] leading-[1.9] text-[#3e5476]">{(items.length ? items : ["List item"]).map((item, index) => <li key={`${key}-${index}`}>{item}</li>)}</ul>
  }
  return <a key={key} href={normalizeUrl(block.url)} className="inline-flex text-sm font-semibold text-[#2b5fd7] underline underline-offset-4" target="_blank" rel="noreferrer">{block.label?.trim() || block.url?.trim() || "Link"}</a>
}

export function SuperAdminBlogManagementSection() {
  const queryClient = useQueryClient()
  const [selectedBlogId, setSelectedBlogId] = useState<string | null>(null)
  const [selectedBlockIndex, setSelectedBlockIndex] = useState(0)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<"all" | BlogStatus>("all")
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [draft, setDraft] = useState<BlogDraft | null>(null)

  const listQuery = useQuery({ queryKey: ["super-admin-blogs"], queryFn: () => api.get<BlogListResponse>("/super-admin/blogs?page=1&page_size=100") })
  const blogs = useMemo(() => listQuery.data?.blogs ?? [], [listQuery.data])
  const activeBlogId = selectedBlogId ?? draft?.id ?? blogs[0]?.id ?? null
  const activeBlog = useMemo(() => activeBlogId ? blogs.find((item) => item.id === activeBlogId) ?? null : null, [activeBlogId, blogs])

  const filteredBlogs = useMemo(() => {
    const term = search.trim().toLowerCase()
    return blogs.filter((blog) => {
      const matchesStatus = statusFilter === "all" || blog.status === statusFilter
      const matchesSearch = !term || [blog.title, blog.excerpt, blog.slug].join(" ").toLowerCase().includes(term)
      return matchesStatus && matchesSearch
    })
  }, [blogs, search, statusFilter])

  const createMutation = useMutation({
    mutationFn: (payload: Omit<BlogDraft, "id">) => api.post<{ blog: BlogPost }>("/super-admin/blogs", payload),
    onSuccess: ({ blog }) => {
      toast.success("Blog created")
      queryClient.invalidateQueries({ queryKey: ["super-admin-blogs"] })
      setSelectedBlogId(blog.id)
      setDraft(toDraft(blog))
    },
    onError: (error) => toast.error("Unable to create blog", { description: error instanceof Error ? error.message : "Unexpected error" }),
  })

  const updateMutation = useMutation({
    mutationFn: (payload: BlogDraft) => api.put<{ blog: BlogPost }>(`/super-admin/blogs/${payload.id}`, { title: payload.title, excerpt: payload.excerpt, read_time_minutes: payload.read_time_minutes, cover_image_url: payload.cover_image_url || null, status: payload.status, content_blocks: payload.content_blocks }),
    onSuccess: ({ blog }) => {
      toast.success(blog.status === "published" ? "Blog published" : "Draft saved")
      queryClient.invalidateQueries({ queryKey: ["super-admin-blogs"] })
      setSelectedBlogId(blog.id)
      setDraft(toDraft(blog))
    },
    onError: (error) => toast.error("Unable to update blog", { description: error instanceof Error ? error.message : "Unexpected error" }),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/super-admin/blogs/${id}`),
    onSuccess: () => {
      toast.success("Blog deleted")
      queryClient.invalidateQueries({ queryKey: ["super-admin-blogs"] })
      setDraft(null)
      setSelectedBlogId(null)
      setSelectedBlockIndex(0)
    },
    onError: (error) => toast.error("Unable to delete blog", { description: error instanceof Error ? error.message : "Unexpected error" }),
  })

  const currentDraft = draft ?? (activeBlog ? toDraft(activeBlog) : null)
  const selectedBlock = currentDraft?.content_blocks[selectedBlockIndex]
  const isBusy = createMutation.isPending || updateMutation.isPending || deleteMutation.isPending
  const previewSlug = slugify(currentDraft?.title || "") || "blog-slug"
  const previewReadTime = currentDraft?.read_time_minutes || 5

  const saveDraft = (nextStatus: BlogStatus) => {
    if (!currentDraft) return
    if (!currentDraft.title.trim()) return toast.error("Title is required")
    if (!currentDraft.excerpt.trim()) return toast.error("Excerpt is required")
    if (currentDraft.read_time_minutes < 1 || currentDraft.read_time_minutes > 120) return toast.error("Read time must be between 1 and 120 minutes")
    if (!currentDraft.content_blocks.length) return toast.error("Add at least one block")
    const payload = { ...currentDraft, status: nextStatus }
    setDraft(payload)
    if (payload.id) updateMutation.mutate(payload)
    else createMutation.mutate(payload)
  }

  const addBlock = (type: BlockType) => {
    if (!currentDraft) return
    const nextBlocks = [...currentDraft.content_blocks, blockFactory(type)]
    setDraft({ ...currentDraft, content_blocks: nextBlocks })
    setSelectedBlockIndex(nextBlocks.length - 1)
  }

  const updateBlock = (index: number, patch: Partial<BlogBlock>) => {
    if (!currentDraft) return
    setDraft({ ...currentDraft, content_blocks: currentDraft.content_blocks.map((block, i) => i === index ? { ...block, ...patch } : block) })
  }

  const moveBlock = (fromIndex: number, toIndex: number) => {
    if (!currentDraft || fromIndex === toIndex || toIndex < 0 || toIndex >= currentDraft.content_blocks.length) return
    const nextBlocks = [...currentDraft.content_blocks]
    const [moved] = nextBlocks.splice(fromIndex, 1)
    nextBlocks.splice(toIndex, 0, moved)
    setDraft({ ...currentDraft, content_blocks: nextBlocks })
    setSelectedBlockIndex(toIndex)
  }

  const removeBlock = (index: number) => {
    if (!currentDraft) return
    const nextBlocks = currentDraft.content_blocks.filter((_, i) => i !== index)
    if (!nextBlocks.length) return toast.error("At least one block is required")
    setDraft({ ...currentDraft, content_blocks: nextBlocks })
    setSelectedBlockIndex(Math.max(0, Math.min(index, nextBlocks.length - 1)))
  }

  return (
    <TooltipProvider>
      <div className="grid grid-cols-1 gap-6 2xl:grid-cols-[320px_minmax(0,1fr)]">
        <Card className="h-fit border-border shadow-sm bg-card">
          <CardHeader className="border-b border-border bg-muted/40">
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle>Blog Library</CardTitle>
                <CardDescription>Find drafts fast and jump back into editing.</CardDescription>
              </div>
              <Button size="sm" onClick={() => { setSelectedBlogId(null); setDraft(newDraft()); setSelectedBlockIndex(0) }}>
                <Plus className="mr-2 h-4 w-4" /> New
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 p-4">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search blogs" className="pl-9" />
            </div>
            <Select value={statusFilter} onValueChange={(value: "all" | BlogStatus) => setStatusFilter(value)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="draft">Drafts</SelectItem>
                <SelectItem value="published">Published</SelectItem>
              </SelectContent>
            </Select>
            <div className="max-h-[680px] space-y-2 overflow-auto pr-1">
              {listQuery.isLoading ? (
                <div className="flex items-center justify-center py-10 text-sm text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading blogs...</div>
              ) : filteredBlogs.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">No blogs found.</div>
              ) : (
                filteredBlogs.map((blog) => (
                  <button
                    key={blog.id}
                    type="button"
                    onClick={() => {
                      setSelectedBlogId(blog.id)
                      setDraft(toDraft(blog))
                      setSelectedBlockIndex(0)
                    }}
                    className={`w-full rounded-2xl border px-4 py-4 text-left transition ${activeBlogId === blog.id ? "border-primary/40 bg-primary/10" : "border-border bg-card hover:bg-muted/40"}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="line-clamp-2 text-sm font-semibold leading-6 text-foreground">{blog.title}</p>
                        <p className="mt-2 line-clamp-2 text-xs leading-5 text-muted-foreground">{blog.excerpt || "No excerpt yet"}</p>
                      </div>
                      <Badge variant={blog.status === "published" ? "default" : "secondary"}>{blog.status}</Badge>
                    </div>
                    <p className="mt-3 text-[11px] text-muted-foreground">{blog.slug} • {prettyDate(blog.published_at)}</p>
                  </button>
                ))
              )}
            </div>
          </CardContent>
        </Card>

        {!currentDraft ? (
          <Card className="border-dashed"><CardContent className="py-20 text-center text-muted-foreground">Select a blog or create a new one to begin.</CardContent></Card>
        ) : (
          <div className="space-y-6">
            <Card className="border-border shadow-sm bg-card">
              <CardHeader className="border-b border-border bg-muted/40">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={currentDraft.status === "published" ? "default" : "secondary"}>{currentDraft.status}</Badge>
                      <Badge variant="outline">/blog/{previewSlug}</Badge>
                    </div>
                    <div>
                      <CardTitle>{currentDraft.id ? "Blog Workspace" : "New Blog Workspace"}</CardTitle>
                      <CardDescription>Write clearly on the left and confirm the final article on the right.</CardDescription>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-3 text-center">
                    <div className="rounded-xl border border-border bg-card px-4 py-3"><div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Read Time</div><div className="mt-2 text-sm font-semibold text-foreground">{previewReadTime} min</div></div>
                    <div className="rounded-xl border border-border bg-card px-4 py-3"><div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Blocks</div><div className="mt-2 text-sm font-semibold text-foreground">{currentDraft.content_blocks.length}</div></div>
                    <div className="rounded-xl border border-border bg-card px-4 py-3"><div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Published</div><div className="mt-2 text-sm font-semibold text-foreground">{prettyDate(activeBlog?.published_at)}</div></div>
                  </div>
                </div>
              </CardHeader>
            </Card>

            <div className="grid gap-6 xl:grid-cols-[minmax(0,0.95fr)_minmax(380px,0.85fr)]">
              <div className="space-y-6">
                <Card className="border-border shadow-sm bg-card">
                  <CardHeader><CardTitle>Article Metadata</CardTitle><CardDescription>Title, summary, and publishing state.</CardDescription></CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_220px]">
                      <Input value={currentDraft.title ?? ""} onChange={(e) => setDraft({ ...currentDraft, title: e.target.value })} placeholder="Enter blog title" />
                      <Select value={currentDraft.status} onValueChange={(value: BlogStatus) => setDraft({ ...currentDraft, status: value })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="draft">Draft</SelectItem>
                          <SelectItem value="published">Published</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid gap-2 md:max-w-[220px]">
                      <label className="text-sm font-medium">Read Time</label>
                      <Input
                        type="number"
                        min={1}
                        max={120}
                        value={currentDraft.read_time_minutes ?? ""}
                        onChange={(e) => setDraft({ ...currentDraft, read_time_minutes: Math.max(1, Math.min(120, Number(e.target.value) || 1)) })}
                        placeholder="Minutes"
                      />
                    </div>
                    <Textarea rows={4} value={currentDraft.excerpt ?? ""} onChange={(e) => setDraft({ ...currentDraft, excerpt: e.target.value })} placeholder="Short summary shown in listing and SEO previews" />
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="flex cursor-not-allowed items-center justify-between rounded-xl border border-dashed border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
                          <span className="flex items-center gap-2 font-medium"><ImagePlus className="h-4 w-4" /> Feature image</span>
                          <Badge variant="secondary">Coming soon</Badge>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent>Coming soon</TooltipContent>
                    </Tooltip>
                  </CardContent>
                </Card>

                <Card className="border-border shadow-sm bg-card">
                  <CardHeader><CardTitle>Content Structure</CardTitle><CardDescription>Add blocks, reorder them, and edit the selected block below.</CardDescription></CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                      {blockTypes.map((type) => (
                        <Button key={type} type="button" variant="outline" className="justify-start" onClick={() => addBlock(type)}>
                          {type === "header" && <Heading className="mr-2 h-4 w-4" />}
                          {type === "paragraph" && <Pilcrow className="mr-2 h-4 w-4" />}
                          {type === "hyperlink" && <LinkIcon className="mr-2 h-4 w-4" />}
                          {type === "quote" && <Quote className="mr-2 h-4 w-4" />}
                          {type === "list" && <List className="mr-2 h-4 w-4" />}
                          {type}
                        </Button>
                      ))}
                    </div>
                    <div className="space-y-3">
                      {currentDraft.content_blocks.map((block, index) => (
                        <div key={`${block.type}-${index}`} className={`rounded-2xl border px-4 py-4 ${selectedBlockIndex === index ? "border-primary/40 bg-primary/10" : "border-border bg-card"}`}>
                          <div className="flex gap-3">
                            <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setSelectedBlockIndex(index)}>
                              <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">{block.type} #{index + 1}</div>
                              <p className="mt-2 line-clamp-2 text-sm font-medium text-foreground">{summary(block)}</p>
                            </button>
                            <div className="flex items-center gap-1">
                              <Button type="button" variant="ghost" size="icon" onClick={() => moveBlock(index, index - 1)} disabled={index === 0}><ChevronUp className="h-4 w-4" /></Button>
                              <Button type="button" variant="ghost" size="icon" onClick={() => moveBlock(index, index + 1)} disabled={index === currentDraft.content_blocks.length - 1}><ChevronDown className="h-4 w-4" /></Button>
                              <Button type="button" variant="ghost" size="icon" onClick={() => removeBlock(index)}><Trash2 className="h-4 w-4 text-red-600" /></Button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>

                {selectedBlock ? (
                  <Card className="border-border shadow-sm bg-card">
                    <CardHeader><CardTitle className="capitalize">Editing {selectedBlock.type}</CardTitle><CardDescription>Changes appear in the preview immediately.</CardDescription></CardHeader>
                    <CardContent className="space-y-4">
                      {selectedBlock.type === "header" ? (
                        <div className="grid gap-3 md:grid-cols-[140px_1fr]">
                          <Select value={String(selectedBlock.level || 2)} onValueChange={(value) => updateBlock(selectedBlockIndex, { level: Number(value) })}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="1">H1</SelectItem>
                              <SelectItem value="2">H2</SelectItem>
                              <SelectItem value="3">H3</SelectItem>
                            </SelectContent>
                          </Select>
                          <Input value={selectedBlock.text ?? ""} onChange={(e) => updateBlock(selectedBlockIndex, { text: e.target.value })} placeholder="Header text" />
                        </div>
                      ) : null}
                      {(selectedBlock.type === "paragraph" || selectedBlock.type === "quote" || selectedBlock.type === "list") ? (
                        <Textarea rows={selectedBlock.type === "paragraph" ? 10 : 6} value={selectedBlock.text ?? ""} onChange={(e) => updateBlock(selectedBlockIndex, { text: e.target.value })} placeholder={selectedBlock.type === "list" ? "Enter one bullet point per line" : "Enter content"} />
                      ) : null}
                      {selectedBlock.type === "hyperlink" ? (
                        <div className="grid gap-3 md:grid-cols-2">
                          <Input value={selectedBlock.label ?? ""} onChange={(e) => updateBlock(selectedBlockIndex, { label: e.target.value })} placeholder="Link label" />
                          <Input value={selectedBlock.url ?? ""} onChange={(e) => updateBlock(selectedBlockIndex, { url: e.target.value })} placeholder="https://example.com" />
                        </div>
                      ) : null}
                    </CardContent>
                  </Card>
                ) : null}
              </div>

              <Card className="border-border bg-muted/30 shadow-sm xl:sticky xl:top-6 xl:self-start">
                <CardHeader><CardTitle>Live Preview</CardTitle><CardDescription>Drag blocks here to define the final published order.</CardDescription></CardHeader>
                <CardContent>
                  <div className="mx-auto max-w-[720px] overflow-hidden rounded-[18px] border border-[#d7deea] bg-white shadow-[0_28px_80px_rgba(15,23,42,0.08)]">
                    <div className="px-6 pb-5 pt-6">
                      <h1 className="mt-4 text-[2.2rem] font-extrabold leading-[1.05] tracking-[-0.055em] text-[#0d2346]">{currentDraft.title.trim() || "Type your title here"}</h1>
                      <p className="mt-4 max-w-[590px] text-[1.05rem] leading-[1.85] text-[#516987]">{currentDraft.excerpt.trim() || "Type your summary here"}</p>
                      <div className="mt-6 text-[0.78rem] font-medium text-[#7588a8]">Published on <span className="font-bold text-[#0d2346]">{prettyDate(new Date().toISOString())}</span> | {previewReadTime} min read</div>
                    </div>
                    <div className="space-y-4 border-t border-[#d7deea] px-6 py-7">
                      {currentDraft.content_blocks.map((block, index) => (
                        <div
                          key={`${block.type}-${index}`}
                          draggable
                          onDragStart={() => setDragIndex(index)}
                          onDragOver={(event) => event.preventDefault()}
                          onDrop={() => { if (dragIndex !== null) moveBlock(dragIndex, index); setDragIndex(null) }}
                          onDragEnd={() => setDragIndex(null)}
                          onClick={() => setSelectedBlockIndex(index)}
                          className={`cursor-move rounded-xl border p-4 ${selectedBlockIndex === index ? "border-[#8eb0e8] bg-[#f3f7ff]" : "border-slate-200 bg-white hover:border-[#bfd0ee]"}`}
                        >
                          <div className="mb-3 flex items-center justify-between gap-3 text-xs text-slate-500"><div className="flex items-center gap-2"><GripVertical className="h-4 w-4" /><span className="font-medium uppercase tracking-[0.18em]">{block.type}</span></div><span>Block {index + 1}</span></div>
                          {renderPreviewBlock(block, `${block.type}-${index}`)}
                        </div>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            <div className="sticky bottom-0 z-10 rounded-2xl border border-border bg-background/95 px-4 py-4 shadow-lg backdrop-blur">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div className="text-sm text-muted-foreground">Save drafts freely. Publish when the title, summary, and block order are ready.</div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button disabled={isBusy} variant="outline" onClick={() => saveDraft("draft")}>{isBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Save Draft</Button>
                  <Button disabled={isBusy} onClick={() => saveDraft("published")}>Publish</Button>
                  {currentDraft.id ? <Button disabled={isBusy} variant="destructive" onClick={() => deleteMutation.mutate(currentDraft.id as string)}>Delete</Button> : null}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </TooltipProvider>
  )
}

export default SuperAdminBlogManagementSection
