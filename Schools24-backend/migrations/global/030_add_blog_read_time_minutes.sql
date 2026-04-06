ALTER TABLE public.blog_posts
ADD COLUMN IF NOT EXISTS read_time_minutes INTEGER;

UPDATE public.blog_posts
SET read_time_minutes = GREATEST(
    1,
    CEIL(
        GREATEST(
            1,
            array_length(
                regexp_split_to_array(
                    trim(
                        concat_ws(
                            ' ',
                            title,
                            excerpt,
                            regexp_replace(content_blocks::text, '[^A-Za-z0-9 ]', ' ', 'g')
                        )
                    ),
                    '\s+'
                ),
                1
            )
        ) / 180.0
    )::INTEGER
)
WHERE read_time_minutes IS NULL
  AND deleted_at IS NULL;

ALTER TABLE public.blog_posts
ALTER COLUMN read_time_minutes SET DEFAULT 1;

UPDATE public.blog_posts
SET read_time_minutes = 1
WHERE read_time_minutes IS NULL;

ALTER TABLE public.blog_posts
ALTER COLUMN read_time_minutes SET NOT NULL;

ALTER TABLE public.blog_posts
ADD CONSTRAINT blog_posts_read_time_minutes_check
CHECK (read_time_minutes >= 1 AND read_time_minutes <= 120);
