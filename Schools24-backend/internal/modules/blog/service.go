package blog

import (
	"context"
	"errors"
	"regexp"
	"strings"

	"github.com/google/uuid"
)

type Service struct {
	repo *Repository
}

func NewService(repo *Repository) *Service {
	return &Service{repo: repo}
}

func (s *Service) ListForSuperAdmin(ctx context.Context, params ListBlogsParams) (*ListBlogsResponse, error) {
	return s.repo.ListForSuperAdmin(ctx, params)
}

func (s *Service) ListPublished(ctx context.Context, page, pageSize int) (*ListBlogsResponse, error) {
	return s.repo.ListPublished(ctx, page, pageSize)
}

func (s *Service) GetPublishedBySlug(ctx context.Context, slug string) (*BlogPost, error) {
	return s.repo.GetPublishedBySlug(ctx, slug)
}

func (s *Service) CreateBlog(ctx context.Context, req UpsertBlogRequest, authorID uuid.UUID) (*BlogPost, error) {
	if req.ReadTimeMin < 1 || req.ReadTimeMin > 120 {
		return nil, errors.New("read_time_minutes must be between 1 and 120")
	}
	if err := validateBlocks(req.Blocks); err != nil {
		return nil, err
	}
	slugBase := slugify(req.Title)
	return s.repo.CreateBlog(ctx, req, authorID, slugBase)
}

func (s *Service) UpdateBlog(ctx context.Context, blogID uuid.UUID, req UpsertBlogRequest, authorID uuid.UUID) (*BlogPost, error) {
	if req.ReadTimeMin < 1 || req.ReadTimeMin > 120 {
		return nil, errors.New("read_time_minutes must be between 1 and 120")
	}
	if err := validateBlocks(req.Blocks); err != nil {
		return nil, err
	}
	slugBase := slugify(req.Title)
	return s.repo.UpdateBlog(ctx, blogID, req, authorID, slugBase)
}

func (s *Service) DeleteBlog(ctx context.Context, blogID uuid.UUID) error {
	return s.repo.SoftDeleteBlog(ctx, blogID)
}

func validateBlocks(blocks []BlogBlock) error {
	if len(blocks) == 0 {
		return errors.New("content_blocks must contain at least one block")
	}

	for _, block := range blocks {
		t := strings.ToLower(strings.TrimSpace(block.Type))
		switch t {
		case "header", "paragraph", "hyperlink", "quote", "list":
		default:
			return errors.New("unsupported block type: " + block.Type)
		}
		if (t == "header" || t == "paragraph" || t == "quote" || t == "list") && strings.TrimSpace(block.Text) == "" {
			return errors.New("text is required for " + t + " blocks")
		}
		if t == "hyperlink" {
			if strings.TrimSpace(block.URL) == "" || strings.TrimSpace(block.Label) == "" {
				return errors.New("hyperlink blocks require url and label")
			}
		}
	}
	return nil
}

var nonSlug = regexp.MustCompile(`[^a-z0-9]+`)

func slugify(input string) string {
	clean := strings.ToLower(strings.TrimSpace(input))
	clean = nonSlug.ReplaceAllString(clean, "-")
	clean = strings.Trim(clean, "-")
	if clean == "" {
		return "blog"
	}
	return clean
}
