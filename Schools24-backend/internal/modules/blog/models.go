package blog

import (
	"time"

	"github.com/google/uuid"
)

type BlogStatus string

const (
	StatusDraft     BlogStatus = "draft"
	StatusPublished BlogStatus = "published"
)

type BlogBlock struct {
	Type  string `json:"type"`
	Text  string `json:"text,omitempty"`
	URL   string `json:"url,omitempty"`
	Label string `json:"label,omitempty"`
	Level int    `json:"level,omitempty"`
}

type BlogPost struct {
	ID          uuid.UUID   `json:"id"`
	Title       string      `json:"title"`
	Slug        string      `json:"slug"`
	Excerpt     string      `json:"excerpt"`
	ReadTimeMin int         `json:"read_time_minutes"`
	CoverImage  *string     `json:"cover_image_url,omitempty"`
	Status      BlogStatus  `json:"status"`
	Blocks      []BlogBlock `json:"content_blocks"`
	CreatedBy   *uuid.UUID  `json:"created_by,omitempty"`
	UpdatedBy   *uuid.UUID  `json:"updated_by,omitempty"`
	PublishedAt *time.Time  `json:"published_at,omitempty"`
	CreatedAt   time.Time   `json:"created_at"`
	UpdatedAt   time.Time   `json:"updated_at"`
}

type UpsertBlogRequest struct {
	Title      string      `json:"title" binding:"required,min=3,max=220"`
	Excerpt    string      `json:"excerpt" binding:"max=500"`
	ReadTimeMin int        `json:"read_time_minutes" binding:"required,min=1,max=120"`
	CoverImage *string     `json:"cover_image_url,omitempty"`
	Status     BlogStatus  `json:"status" binding:"required,oneof=draft published"`
	Blocks     []BlogBlock `json:"content_blocks" binding:"required,min=1"`
}

type ListBlogsParams struct {
	Page     int
	PageSize int
	Search   string
	Status   string
}

type ListBlogsResponse struct {
	Blogs      []BlogPost `json:"blogs"`
	Total      int        `json:"total"`
	Page       int        `json:"page"`
	PageSize   int        `json:"page_size"`
	TotalPages int        `json:"total_pages"`
}
