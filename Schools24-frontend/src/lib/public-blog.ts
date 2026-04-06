import "server-only"

export type PublicBlogBlock = {
  type: "header" | "paragraph" | "hyperlink" | "quote" | "list"
  text?: string
  url?: string
  label?: string
  level?: number
}

export type PublicBlogPost = {
  id: string
  title: string
  slug: string
  excerpt: string
  read_time_minutes: number
  cover_image_url?: string | null
  status: "draft" | "published"
  content_blocks: PublicBlogBlock[]
  published_at?: string
  created_at: string
  updated_at: string
}

type PublicBlogListResponse = {
  blogs: PublicBlogPost[]
  total: number
  page: number
  page_size: number
  total_pages: number
}

type PublicBlogResponse = {
  blog: PublicBlogPost
}

const SITE_URL = "https://schools24.in"

function normalizeBase(value: string): string {
  return value.replace(/\/+$/, "")
}

function getApiBase(): string {
  const explicitApiBase = process.env.API_BASE_URL
  if (explicitApiBase) return normalizeBase(explicitApiBase)

  const backendOrigin = process.env.BACKEND_URL
  if (backendOrigin) return `${normalizeBase(backendOrigin)}/api/v1`

  if (process.env.NODE_ENV !== "production") return "http://localhost:8081/api/v1"

  throw new Error("API_BASE_URL or BACKEND_URL must be configured for public blog SSR")
}

async function fetchFromBlogApi<T>(path: string): Promise<T> {
  const res = await fetch(`${getApiBase()}${path}`, {
    next: { revalidate: 300 },
    headers: {
      accept: "application/json",
    },
  })

  if (!res.ok) {
    const detail = await res.text().catch(() => "")
    throw new Error(`Blog API ${res.status}: ${detail || "request failed"}`)
  }

  return res.json() as Promise<T>
}

export async function getPublishedBlogs(page = 1, pageSize = 50): Promise<PublicBlogListResponse> {
  return fetchFromBlogApi<PublicBlogListResponse>(`/public/blogs?page=${page}&page_size=${pageSize}`)
}

export async function getPublishedBlogBySlug(slug: string): Promise<PublicBlogPost | null> {
  try {
    const payload = await fetchFromBlogApi<PublicBlogResponse>(`/public/blogs/${encodeURIComponent(slug)}`)
    return payload.blog
  } catch (error) {
    if (error instanceof Error && error.message.includes("404")) {
      return null
    }
    throw error
  }
}

export function estimateReadTime(post: Pick<PublicBlogPost, "title" | "excerpt" | "content_blocks">): number {
  const words = [
    post.title,
    post.excerpt,
    ...post.content_blocks.map((block) => `${block.text || ""} ${block.label || ""}`),
  ]
    .join(" ")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length

  return Math.max(1, Math.ceil(words / 180))
}

export function getReadTime(post: Pick<PublicBlogPost, "read_time_minutes" | "title" | "excerpt" | "content_blocks">): number {
  return post.read_time_minutes > 0 ? post.read_time_minutes : estimateReadTime(post)
}

export function formatBlogDate(value?: string) {
  if (!value) return "Unpublished"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "Unpublished"
  return date.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "long",
    year: "numeric",
  })
}

export function blogCanonical(slug?: string) {
  return slug ? `${SITE_URL}/blog/${slug}` : `${SITE_URL}/blogs`
}
