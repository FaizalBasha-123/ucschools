CREATE TABLE IF NOT EXISTS public.blog_posts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    slug TEXT NOT NULL,
    excerpt TEXT NOT NULL DEFAULT '',
    cover_image_url TEXT,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
    content_blocks JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_by UUID REFERENCES public.super_admins(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES public.super_admins(id) ON DELETE SET NULL,
    published_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_blog_posts_slug_active
    ON public.blog_posts (lower(slug))
    WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_blog_posts_published_at
    ON public.blog_posts (published_at DESC)
    WHERE deleted_at IS NULL AND status = 'published';

CREATE INDEX IF NOT EXISTS idx_blog_posts_created_at
    ON public.blog_posts (created_at DESC)
    WHERE deleted_at IS NULL;
