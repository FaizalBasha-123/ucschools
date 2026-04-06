-- 017_fix_global_classes_sort_order.sql
-- Reassign sort_order for global_classes so every row has a unique, consecutive
-- value ordered by the current (sort_order, name) ordering.
-- This fixes duplicate sort values (e.g. LKG=2 and UKG=2).

WITH ranked AS (
    SELECT
        id,
        ROW_NUMBER() OVER (ORDER BY sort_order ASC, name ASC) AS new_sort
    FROM public.global_classes
)
UPDATE public.global_classes gc
SET sort_order = r.new_sort,
    updated_at = NOW()
FROM ranked r
WHERE gc.id = r.id;
