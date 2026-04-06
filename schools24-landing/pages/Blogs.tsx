import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import SEOMeta from '../components/SEOMeta';
import Footer from '../components/Footer';

type BlogPost = {
  id: string;
  title: string;
  slug: string;
  excerpt: string;
  status: 'draft' | 'published';
  published_at?: string;
  created_at: string;
};

type BlogListResponse = {
  blogs: BlogPost[];
};

const BLOGS_SCHEMA = {
  '@context': 'https://schema.org',
  '@type': 'Blog',
  name: 'MySchools Blog',
  url: 'https://MySchools.in/blogs',
  description: 'School operations, product thinking, and education infrastructure insights from MySchools.',
  publisher: {
    '@type': 'Organization',
    name: 'MySchools',
    url: 'https://MySchools.in',
  },
};

const formatPublishedDate = (value?: string) => {
  if (!value) return 'Unpublished';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unpublished';
  return date.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
};

const estimateReadTime = (post: BlogPost) => {
  const source = `${post.title} ${post.excerpt || ''}`.trim();
  const wordCount = source.split(/\s+/).filter(Boolean).length;
  return Math.max(5, Math.ceil(wordCount / 28));
};

const Blogs: React.FC = () => {
  const [blogs, setBlogs] = useState<BlogPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    const loadBlogs = async () => {
      try {
        setLoading(true);
        setError(null);
        const res = await fetch('/api/v1/public/blogs?page=1&page_size=50');
        if (!res.ok) {
          throw new Error(`Unable to load blogs (${res.status})`);
        }
        const payload = (await res.json()) as BlogListResponse;
        if (isMounted) {
          setBlogs(Array.isArray(payload.blogs) ? payload.blogs : []);
        }
      } catch (err) {
        if (isMounted) {
          setError(err instanceof Error ? err.message : 'Unable to load blogs');
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    loadBlogs();
    return () => {
      isMounted = false;
    };
  }, []);

  return (
    <>
      <SEOMeta
        title="MySchools Blog"
        description="School operations, product decisions, and education technology insights from the MySchools team."
        path="/blogs"
        structuredData={BLOGS_SCHEMA}
      />
      <div className="min-h-screen bg-[#f4f6fb] text-slate-900">
        <section className="mx-auto max-w-6xl px-6 pb-20 pt-32">
          <div className="max-w-3xl">
            <p className="font-editorial-sans text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">MySchools Blog</p>
            <h1 className="mt-4 max-w-2xl font-editorial-sans text-4xl font-extrabold tracking-[-0.055em] text-[#0d2346] md:text-5xl">
              Operational clarity for modern schools.
            </h1>
            <p className="mt-4 max-w-2xl font-editorial-sans text-lg leading-8 text-[#617392]">
              Articles on school systems, product design, and the practical decisions behind the MySchools platform.
            </p>
          </div>

          <div className="mt-12">
            {loading ? (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-6 text-sm text-slate-500">Loading published blogs...</div>
            ) : error ? (
              <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">{error}</div>
            ) : blogs.length === 0 ? (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-6 text-sm text-slate-500">No published blogs yet.</div>
            ) : (
              <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
                {blogs.map((post) => (
                  <article
                    key={post.id}
                    className="rounded-[18px] border border-[#d8e1f0] bg-white p-6 shadow-[0_14px_36px_rgba(15,23,42,0.05)] transition-shadow duration-200 hover:shadow-[0_18px_44px_rgba(15,23,42,0.08)]"
                  >
                    <div className="font-editorial-sans text-sm font-medium text-[#8b9dbe]">
                      {formatPublishedDate(post.published_at)} | {estimateReadTime(post)} min read
                    </div>
                    <h2 className="mt-5 font-editorial-sans text-[2rem] font-extrabold leading-[1.08] tracking-[-0.05em] text-[#0d2346]">
                      {post.title}
                    </h2>
                    <p className="mt-4 font-editorial-sans text-[1rem] leading-9 text-[#516987]">
                      {post.excerpt || 'No summary provided.'}
                    </p>
                    <Link
                      to={`/blog/${post.slug}`}
                      className="mt-6 inline-flex items-center font-editorial-sans text-sm font-bold text-[#1f59ff]"
                    >
                      Read article
                    </Link>
                  </article>
                ))}
              </div>
            )}
          </div>
        </section>

        <Footer theme="light" />
      </div>
    </>
  );
};

export default Blogs;
