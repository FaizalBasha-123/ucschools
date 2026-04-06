import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { PublicBlogContent } from "@/components/blog/PublicBlogContent"
import { blogCanonical, formatBlogDate, getPublishedBlogBySlug, getPublishedBlogs, getReadTime } from "@/lib/public-blog"
import { PublicFooter } from "@/components/public/PublicFooter"
import { PublicHeader } from "@/components/public/PublicHeader"

type PageProps = {
  params: Promise<{ slug: string }>
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params
  const blog = await getPublishedBlogBySlug(slug)

  if (!blog) {
    return {
      title: "Blog Not Found | Schools24",
      robots: {
        index: false,
        follow: false,
      },
    }
  }

  return {
    title: `${blog.title} | Schools24`,
    description: blog.excerpt,
    alternates: {
      canonical: blogCanonical(blog.slug),
    },
    openGraph: {
      type: "article",
      title: blog.title,
      description: blog.excerpt,
      url: blogCanonical(blog.slug),
      siteName: "Schools24",
      publishedTime: blog.published_at || blog.created_at,
      modifiedTime: blog.updated_at,
    },
    twitter: {
      card: "summary_large_image",
      title: `${blog.title} | Schools24`,
      description: blog.excerpt,
    },
  }
}

export default async function BlogArticlePage({ params }: PageProps) {
  const { slug } = await params
  const blog = await getPublishedBlogBySlug(slug)

  if (!blog) {
    notFound()
  }

  const relatedPayload = await getPublishedBlogs(1, 6)
  const relatedBlogs = relatedPayload.blogs.filter((item) => item.slug !== blog.slug).slice(0, 3)
  const readTime = getReadTime(blog)
  const articleSchema = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: blog.title,
    description: blog.excerpt,
    datePublished: blog.published_at || blog.created_at,
    dateModified: blog.updated_at,
    mainEntityOfPage: blogCanonical(blog.slug),
    publisher: {
      "@type": "Organization",
      name: "Schools24",
      url: "https://schools24.in",
    },
  }
  const breadcrumbSchema = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: "Blogs",
        item: "https://schools24.in/blogs",
      },
      {
        "@type": "ListItem",
        position: 2,
        name: blog.title,
        item: blogCanonical(blog.slug),
      },
    ],
  }

  return (
    <>
      <PublicHeader />
      <main className="min-h-screen bg-[#f4f6fb] text-slate-900">
        <script type="application/ld+json" suppressHydrationWarning dangerouslySetInnerHTML={{ __html: JSON.stringify(articleSchema) }} />
        <script type="application/ld+json" suppressHydrationWarning dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbSchema) }} />

        <section className="mx-auto max-w-6xl px-6 pb-24 pt-20 md:pt-28">
        <div className="mb-8">
          <Link href="/blogs" className="text-sm font-medium text-slate-500 underline underline-offset-4">
            Back to all blogs
          </Link>
        </div>

        <article className="mx-auto max-w-[720px] overflow-hidden rounded-[18px] border border-[#d7deea] bg-white shadow-[0_28px_80px_rgba(15,23,42,0.08)]">
          <div className="px-6 pb-5 pt-6 md:px-8 md:pt-8">
            <h1 className="mt-4 text-[2.2rem] font-extrabold leading-[1.05] tracking-[-0.055em] text-[#0d2346] md:text-[3.05rem]">
              {blog.title}
            </h1>
            <p className="mt-4 max-w-[600px] text-[1.08rem] leading-[1.85] text-[#516987]">
              {blog.excerpt}
            </p>
            <div className="mt-6 text-[0.78rem] font-medium text-[#7588a8]">
              Published on <span className="font-bold text-[#0d2346]">{formatBlogDate(blog.published_at)}</span> | {readTime} min read
            </div>
          </div>
          <div className="border-t border-[#d7deea] px-6 py-7 md:px-8 md:py-8">
            <PublicBlogContent blocks={blog.content_blocks} />
          </div>
        </article>

        {relatedBlogs.length > 0 ? (
          <section className="mx-auto mt-14 max-w-[960px]">
            <div className="mb-5">
              <p className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-500">Continue Reading</p>
              <h2 className="mt-2 text-2xl font-extrabold tracking-[-0.04em] text-[#0d2346]">More from Schools24</h2>
            </div>
            <div className="grid gap-5 md:grid-cols-3">
              {relatedBlogs.map((item) => (
                <article key={item.id} className="rounded-[18px] border border-[#d8e1f0] bg-white p-5 shadow-[0_14px_36px_rgba(15,23,42,0.05)]">
                  <div className="text-sm font-medium text-[#8b9dbe]">
                    {formatBlogDate(item.published_at)} | {getReadTime(item)} min read
                  </div>
                  <h3 className="mt-4 text-[1.45rem] font-extrabold leading-[1.15] tracking-[-0.04em] text-[#0d2346]">
                    {item.title}
                  </h3>
                  <p className="mt-3 text-sm leading-7 text-[#516987]">
                    {item.excerpt || "No summary provided."}
                  </p>
                  <Link href={`/blog/${item.slug}`} className="mt-5 inline-flex items-center text-sm font-bold text-[#1f59ff]">
                    Read article
                  </Link>
                </article>
              ))}
            </div>
          </section>
        ) : null}
        </section>
      </main>
      <PublicFooter />
    </>
  )
}
