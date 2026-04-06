import type { MetadataRoute } from "next"
import { getPublishedBlogs } from "@/lib/public-blog"

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const blogPayload = await getPublishedBlogs(1, 100)
  const blogEntries = blogPayload.blogs.map((post) => ({
    url: `https://schools24.in/blog/${post.slug}`,
    lastModified: post.updated_at,
    changeFrequency: "weekly" as const,
    priority: 0.7,
  }))

  return [
    {
      url: "https://schools24.in/blogs",
      lastModified: new Date().toISOString(),
      changeFrequency: "weekly",
      priority: 0.8,
    },
    ...blogEntries,
  ]
}

