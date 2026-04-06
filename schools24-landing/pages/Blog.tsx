import React, { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import SEOMeta from '../components/SEOMeta';
import Footer from '../components/Footer';
import BlogContentRenderer, { BlogBlock, estimateReadTime } from '../components/blog/BlogContentRenderer';

type BlogPost = {
  id: string;
  title: string;
  slug: string;
  excerpt: string;
  content_blocks: BlogBlock[];
  published_at?: string;
  created_at: string;
  updated_at: string;
};

type BlogResponse = {
  blog: BlogPost;
};

const formatPublishedDate = (value?: string) => {
  if (!value) return 'Unpublished';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unpublished';
  return date.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
};

const Blog: React.FC = () => {
  const { slug } = useParams();
  const [blog, setBlog] = useState<BlogPost | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    const loadBlog = async () => {
      if (!slug) {
        setError('Blog slug is missing.');
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setError(null);
        const res = await fetch(`/api/v1/public/blogs/${slug}`);
        if (!res.ok) {
          throw new Error(res.status === 404 ? 'Blog not found.' : `Unable to load blog (${res.status})`);
        }
        const payload = (await res.json()) as BlogResponse;
        if (isMounted) {
          if (!payload?.blog) {
            throw new Error('Blog payload is invalid.');
          }
          setBlog({
            ...payload.blog,
            content_blocks: Array.isArray(payload.blog.content_blocks) ? payload.blog.content_blocks : [],
          });
        }
      } catch (err) {
        if (isMounted) {
          setError(err instanceof Error ? err.message : 'Unable to load blog');
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    loadBlog();
    return () => {
      isMounted = false;
    };
  }, [slug]);

  const articleSchema = useMemo(() => {
    if (!blog) return undefined;
    return {
      '@context': 'https://schema.org',
      '@type': 'BlogPosting',
      headline: blog.title,
      description: blog.excerpt,
      datePublished: blog.published_at || blog.created_at,
      dateModified: blog.updated_at,
      mainEntityOfPage: `https://MySchools.in/blog/${blog.slug}`,
      publisher: {
        '@type': 'Organization',
        name: 'MySchools',
        url: 'https://MySchools.in',
      },
    };
  }, [blog]);

  const readTime = useMemo(() => (
    blog ? estimateReadTime(blog.title, blog.excerpt, blog.content_blocks) : 1
  ), [blog]);

  return (
    <>
      <SEOMeta
        title={blog?.title || 'MySchools Blog'}
        description={blog?.excerpt || 'School operations, product decisions, and education technology insights from the MySchools team.'}
        path={blog ? `/blog/${blog.slug}` : '/blogs'}
        ogType="article"
        structuredData={articleSchema}
      />
      <div className="min-h-screen bg-[#f5f7fb] text-slate-900">
        <section className="mx-auto max-w-6xl px-6 pb-24 pt-32">
          <div className="mb-8">
            <Link to="/blogs" className="font-editorial-sans text-sm font-medium text-slate-500 underline underline-offset-4">Back to all blogs</Link>
          </div>

          {loading ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-6 text-sm text-slate-500">Loading article...</div>
          ) : error || !blog ? (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">{error || 'Blog not found.'}</div>
          ) : (
            <article className="mx-auto max-w-[720px] overflow-hidden rounded-[18px] border border-[#d7deea] bg-white shadow-[0_28px_80px_rgba(15,23,42,0.08)]">
              <div className="px-6 pb-5 pt-6 md:px-8 md:pt-8">
                <h1 className="mt-4 font-editorial-sans text-[2.2rem] font-extrabold leading-[1.05] tracking-[-0.055em] text-[#0d2346] md:text-[3.05rem]">
                  {blog.title}
                </h1>
                <p className="mt-4 max-w-[600px] font-editorial-serif text-[1.08rem] leading-[1.85] text-[#516987]">
                  {blog.excerpt}
                </p>
                <div className="mt-6 font-editorial-sans text-[0.78rem] font-medium text-[#7588a8]">
                  Published on <span className="font-bold text-[#0d2346]">{formatPublishedDate(blog.published_at)}</span> | {readTime} min read
                </div>
              </div>
              <div className="border-t border-[#d7deea] px-6 py-7 md:px-8 md:py-8">
                <BlogContentRenderer blocks={blog.content_blocks} />
              </div>
            </article>
          )}
        </section>

        <Footer theme="light" />
      </div>
    </>
  );
};

export default Blog;
