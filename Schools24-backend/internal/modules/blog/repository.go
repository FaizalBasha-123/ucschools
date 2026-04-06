package blog

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/schools24/backend/internal/shared/database"
)

type Repository struct {
	db *database.PostgresDB
}

func NewRepository(db *database.PostgresDB) *Repository {
	return &Repository{db: db}
}

func (r *Repository) slugExists(ctx context.Context, slug string, excludeID *uuid.UUID) (bool, error) {
	if excludeID != nil {
		var exists bool
		err := r.db.Pool.QueryRow(ctx, `
			SELECT EXISTS(
				SELECT 1 FROM public.blog_posts
				WHERE lower(slug) = lower($1)
				  AND deleted_at IS NULL
				  AND id <> $2
			)
		`, slug, *excludeID).Scan(&exists)
		return exists, err
	}

	var exists bool
	err := r.db.Pool.QueryRow(ctx, `
		SELECT EXISTS(
			SELECT 1 FROM public.blog_posts
			WHERE lower(slug) = lower($1)
			  AND deleted_at IS NULL
		)
	`, slug).Scan(&exists)
	return exists, err
}

func (r *Repository) createUniqueSlug(ctx context.Context, baseSlug string, excludeID *uuid.UUID) (string, error) {
	candidate := baseSlug
	if candidate == "" {
		candidate = "blog"
	}
	for i := 1; i <= 9999; i++ {
		exists, err := r.slugExists(ctx, candidate, excludeID)
		if err != nil {
			return "", err
		}
		if !exists {
			return candidate, nil
		}
		candidate = fmt.Sprintf("%s-%d", baseSlug, i+1)
	}
	return "", fmt.Errorf("unable to generate unique slug")
}

func (r *Repository) CreateBlog(ctx context.Context, req UpsertBlogRequest, authorID uuid.UUID, slugBase string) (*BlogPost, error) {
	slug, err := r.createUniqueSlug(ctx, slugBase, nil)
	if err != nil {
		return nil, err
	}

	blocksJSON, err := json.Marshal(req.Blocks)
	if err != nil {
		return nil, err
	}

	var publishedAt *time.Time
	if req.Status == StatusPublished {
		now := time.Now().UTC()
		publishedAt = &now
	}

	row := r.db.Pool.QueryRow(ctx, `
		INSERT INTO public.blog_posts
			(title, slug, excerpt, read_time_minutes, cover_image_url, status, content_blocks, created_by, updated_by, published_at)
		VALUES
			($1, $2, $3, $4, NULLIF($5, ''), $6, $7::jsonb, $8, $8, $9)
		RETURNING
			id, title, slug, excerpt, read_time_minutes, cover_image_url, status, content_blocks,
			created_by, updated_by, published_at, created_at, updated_at
	`, strings.TrimSpace(req.Title), slug, strings.TrimSpace(req.Excerpt), req.ReadTimeMin, strings.TrimSpace(ptrToString(req.CoverImage)), req.Status, string(blocksJSON), authorID, publishedAt)

	return scanBlog(row)
}

func (r *Repository) UpdateBlog(ctx context.Context, blogID uuid.UUID, req UpsertBlogRequest, authorID uuid.UUID, slugBase string) (*BlogPost, error) {
	slug, err := r.createUniqueSlug(ctx, slugBase, &blogID)
	if err != nil {
		return nil, err
	}

	blocksJSON, err := json.Marshal(req.Blocks)
	if err != nil {
		return nil, err
	}

	row := r.db.Pool.QueryRow(ctx, `
		UPDATE public.blog_posts
		SET
			title = $2,
			slug = $3,
			excerpt = $4,
			read_time_minutes = $5,
			cover_image_url = NULLIF($6, ''),
			status = $7,
			content_blocks = $8::jsonb,
			updated_by = $9,
			published_at = CASE
				WHEN $7 = 'published' THEN NOW()
				WHEN $7 = 'draft' THEN NULL
				ELSE published_at
			END,
			updated_at = NOW()
		WHERE id = $1 AND deleted_at IS NULL
		RETURNING
			id, title, slug, excerpt, read_time_minutes, cover_image_url, status, content_blocks,
			created_by, updated_by, published_at, created_at, updated_at
	`, blogID, strings.TrimSpace(req.Title), slug, strings.TrimSpace(req.Excerpt), req.ReadTimeMin, strings.TrimSpace(ptrToString(req.CoverImage)), req.Status, string(blocksJSON), authorID)

	return scanBlog(row)
}

func (r *Repository) SoftDeleteBlog(ctx context.Context, blogID uuid.UUID) error {
	tag, err := r.db.Pool.Exec(ctx, `
		UPDATE public.blog_posts
		SET deleted_at = NOW(), updated_at = NOW()
		WHERE id = $1 AND deleted_at IS NULL
	`, blogID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("blog not found")
	}
	return nil
}

func (r *Repository) ListForSuperAdmin(ctx context.Context, params ListBlogsParams) (*ListBlogsResponse, error) {
	if params.Page < 1 {
		params.Page = 1
	}
	if params.PageSize < 1 || params.PageSize > 100 {
		params.PageSize = 20
	}

	where := []string{"deleted_at IS NULL"}
	args := []any{}
	argIdx := 1

	if strings.TrimSpace(params.Status) != "" {
		where = append(where, fmt.Sprintf("status = $%d", argIdx))
		args = append(args, strings.TrimSpace(params.Status))
		argIdx++
	}

	if strings.TrimSpace(params.Search) != "" {
		s := "%" + strings.ToLower(strings.TrimSpace(params.Search)) + "%"
		where = append(where, fmt.Sprintf("(lower(title) LIKE $%d OR lower(excerpt) LIKE $%d)", argIdx, argIdx+1))
		args = append(args, s, s)
		argIdx += 2
	}

	whereSQL := strings.Join(where, " AND ")

	var total int
	countQuery := fmt.Sprintf(`SELECT COUNT(*) FROM public.blog_posts WHERE %s`, whereSQL)
	if err := r.db.Pool.QueryRow(ctx, countQuery, args...).Scan(&total); err != nil {
		return nil, err
	}

	offset := (params.Page - 1) * params.PageSize
	listArgs := append(args, params.PageSize, offset)
	listQuery := fmt.Sprintf(`
		SELECT
			id, title, slug, excerpt, read_time_minutes, cover_image_url, status, content_blocks,
			created_by, updated_by, published_at, created_at, updated_at
		FROM public.blog_posts
		WHERE %s
		ORDER BY COALESCE(published_at, created_at) DESC, created_at DESC
		LIMIT $%d OFFSET $%d
	`, whereSQL, argIdx, argIdx+1)

	rows, err := r.db.Pool.Query(ctx, listQuery, listArgs...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	blogs := make([]BlogPost, 0)
	for rows.Next() {
		item, scanErr := scanBlog(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		blogs = append(blogs, *item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	totalPages := int(math.Ceil(float64(total) / float64(params.PageSize)))
	return &ListBlogsResponse{
		Blogs:      blogs,
		Total:      total,
		Page:       params.Page,
		PageSize:   params.PageSize,
		TotalPages: totalPages,
	}, nil
}

func (r *Repository) ListPublished(ctx context.Context, page, pageSize int) (*ListBlogsResponse, error) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}

	var total int
	if err := r.db.Pool.QueryRow(ctx, `
		SELECT COUNT(*)
		FROM public.blog_posts
		WHERE deleted_at IS NULL AND status = 'published'
	`).Scan(&total); err != nil {
		return nil, err
	}

	offset := (page - 1) * pageSize
	rows, err := r.db.Pool.Query(ctx, `
		SELECT
			id, title, slug, excerpt, read_time_minutes, cover_image_url, status, content_blocks,
			created_by, updated_by, published_at, created_at, updated_at
		FROM public.blog_posts
		WHERE deleted_at IS NULL AND status = 'published'
		ORDER BY published_at DESC, created_at DESC
		LIMIT $1 OFFSET $2
	`, pageSize, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	blogs := make([]BlogPost, 0)
	for rows.Next() {
		item, scanErr := scanBlog(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		blogs = append(blogs, *item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	totalPages := int(math.Ceil(float64(total) / float64(pageSize)))
	return &ListBlogsResponse{
		Blogs:      blogs,
		Total:      total,
		Page:       page,
		PageSize:   pageSize,
		TotalPages: totalPages,
	}, nil
}

func (r *Repository) GetPublishedBySlug(ctx context.Context, slug string) (*BlogPost, error) {
	row := r.db.Pool.QueryRow(ctx, `
		SELECT
			id, title, slug, excerpt, read_time_minutes, cover_image_url, status, content_blocks,
			created_by, updated_by, published_at, created_at, updated_at
		FROM public.blog_posts
		WHERE deleted_at IS NULL
		  AND status = 'published'
		  AND lower(slug) = lower($1)
	`, strings.TrimSpace(slug))
	return scanBlog(row)
}

type scanner interface {
	Scan(dest ...any) error
}

func scanBlog(s scanner) (*BlogPost, error) {
	item := &BlogPost{}
	var blocksRaw []byte
	if err := s.Scan(
		&item.ID,
		&item.Title,
		&item.Slug,
		&item.Excerpt,
		&item.ReadTimeMin,
		&item.CoverImage,
		&item.Status,
		&blocksRaw,
		&item.CreatedBy,
		&item.UpdatedBy,
		&item.PublishedAt,
		&item.CreatedAt,
		&item.UpdatedAt,
	); err != nil {
		return nil, err
	}

	if len(blocksRaw) > 0 {
		if err := json.Unmarshal(blocksRaw, &item.Blocks); err != nil {
			return nil, err
		}
	}
	if item.Blocks == nil {
		item.Blocks = []BlogBlock{}
	}
	return item, nil
}

func ptrToString(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}
