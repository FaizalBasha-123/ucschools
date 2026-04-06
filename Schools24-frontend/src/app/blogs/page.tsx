import type { Metadata } from "next"
import Link from "next/link"
import { formatBlogDate, getPublishedBlogs, getReadTime } from "@/lib/public-blog"
import { PublicFooter } from "@/components/public/PublicFooter"
import { PublicHeader } from "@/components/public/PublicHeader"

export const metadata: Metadata = {
  title: "Schools24 Blog | Schools24",
  description: "School operations, product decisions, and education technology insights from the Schools24 team.",
  alternates: {
    canonical: "https://schools24.in/blogs",
  },
  openGraph: {
    type: "website",
    title: "Schools24 Blog | Schools24",
    description: "School operations, product decisions, and education technology insights from the Schools24 team.",
    url: "https://schools24.in/blogs",
    siteName: "Schools24",
  },
  twitter: {
    card: "summary_large_image",
    title: "Schools24 Blog | Schools24",
    description: "School operations, product decisions, and education technology insights from the Schools24 team.",
  },
}

export default async function BlogsPage() {
  let blogs: Awaited<ReturnType<typeof getPublishedBlogs>>["blogs"] = []
  try {
    const payload = await getPublishedBlogs(1, 50)
    blogs = payload.blogs
  } catch (err) {
    console.error("[BlogsPage] failed to load published blogs:", err)
  }

  return (
    <>
      <PublicHeader />
      <main className="min-h-screen bg-[#f4f6fb] text-slate-900">
      <section className="mx-auto max-w-6xl px-6 pb-20 pt-20 md:pt-28">
        <div className="max-w-3xl">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">Schools24 Blog</p>
          <h1 className="mt-4 max-w-2xl text-4xl font-extrabold tracking-[-0.055em] text-[#0d2346] md:text-5xl">
            Operational clarity for modern schools.
          </h1>
          <p className="mt-4 max-w-2xl text-lg leading-8 text-[#617392]">
            Articles on school systems, product design, and the practical decisions behind the Schools24 platform.
          </p>
        </div>

        {blogs.length === 0 ? (
          <div className="mt-12 rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
            No published blogs yet.
          </div>
        ) : (
          <div className="mt-12 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {blogs.map((post) => (
              <article
                key={post.id}
                className="rounded-[18px] border border-[#d8e1f0] bg-white p-6 shadow-[0_14px_36px_rgba(15,23,42,0.05)] transition-shadow duration-200 hover:shadow-[0_18px_44px_rgba(15,23,42,0.08)]"
              >
                <div className="text-sm font-medium text-[#8b9dbe]">
                  {formatBlogDate(post.published_at)} | {getReadTime(post)} min read
                </div>
                <h2 className="mt-5 text-[2rem] font-extrabold leading-[1.08] tracking-[-0.05em] text-[#0d2346]">
                  {post.title}
                </h2>
                <p className="mt-4 text-[1rem] leading-9 text-[#516987]">
                  {post.excerpt || "No summary provided."}
                </p>
                <Link href={`/blog/${post.slug}`} className="mt-6 inline-flex items-center text-sm font-bold text-[#1f59ff]">
                  Read article
                </Link>
              </article>
            ))}
          </div>
        )}
      </section>
      </main>
      <PublicFooter />
    </>
  )
}
