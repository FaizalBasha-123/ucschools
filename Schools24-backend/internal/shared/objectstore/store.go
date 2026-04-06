package objectstore

import (
	"context"
	"fmt"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/google/uuid"
)

var nonSafeChars = regexp.MustCompile(`[^a-zA-Z0-9._-]+`)

// Store defines object storage operations used by document repositories.
type Store interface {
	Put(ctx context.Context, key, contentType string, body []byte) error
	Get(ctx context.Context, key string) ([]byte, error)
	Delete(ctx context.Context, key string) error
	List(ctx context.Context, prefix string) ([]ObjectInfo, error)
}

// ObjectInfo describes a stored object returned by List.
type ObjectInfo struct {
	Key  string
	Size int64
}

// ErrObjectNotFound indicates the object key does not exist in the bucket.
type ErrObjectNotFound struct {
	Key string
}

func (e ErrObjectNotFound) Error() string {
	return fmt.Sprintf("object not found: %s", e.Key)
}

// BuildScopedKey creates a stable key layout for R2 storage.
// Example: schools/<school-id>/docs/question-documents/<uuid>-<file>
func BuildScopedKey(scopePrefix, category, fileName string) string {
	safeFileName := sanitizeFileName(fileName)
	return strings.Trim(strings.Join([]string{
		strings.Trim(scopePrefix, "/"),
		"docs",
		strings.Trim(category, "/"),
		fmt.Sprintf("%s-%s", uuid.NewString(), safeFileName),
	}, "/"), "/")
}

// sanitizeFileName removes unsafe characters from file names
func sanitizeFileName(fileName string) string {
	return nonSafeChars.ReplaceAllString(filepath.Base(fileName), "_")
}
