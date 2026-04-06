package objectstore

import (
	"context"
	"errors"
	"fmt"
	"strings"
)

// PutQuestionDocument uploads question document content and returns storage key
func PutQuestionDocument(
	ctx context.Context,
	store Store,
	schoolID string,
	teacherID string,
	docID string,
	fileName string,
	content []byte,
) (string, error) {
	if store == nil {
		return "", errors.New("object store not configured")
	}

	scopePrefix := fmt.Sprintf("schools/%s", schoolID)
	key := BuildScopedKey(scopePrefix, "questions", fileName)
	if err := store.Put(ctx, key, "application/octet-stream", content); err != nil {
		return "", fmt.Errorf("failed to store question document school_id=%s file=%s: %w", schoolID, fileName, err)
	}
	return key, nil
}

// PutStudyMaterial uploads study material content and returns storage key
func PutStudyMaterial(
	ctx context.Context,
	store Store,
	schoolID string,
	uploaderID string,
	materialID string,
	fileName string,
	content []byte,
) (string, error) {
	if store == nil {
		return "", errors.New("object store not configured")
	}

	scopePrefix := fmt.Sprintf("schools/%s", schoolID)
	key := BuildScopedKey(scopePrefix, "materials", fileName)
	if err := store.Put(ctx, key, "application/octet-stream", content); err != nil {
		return "", fmt.Errorf("failed to store study material school_id=%s file=%s: %w", schoolID, fileName, err)
	}
	return key, nil
}

// PutStudentReport uploads student report content and returns storage key
func PutStudentReport(
	ctx context.Context,
	store Store,
	schoolID string,
	teacherID string,
	reportID string,
	fileName string,
	content []byte,
) (string, error) {
	if store == nil {
		return "", errors.New("object store not configured")
	}

	scopePrefix := fmt.Sprintf("schools/%s", schoolID)
	key := BuildScopedKey(scopePrefix, "reports", fileName)
	if err := store.Put(ctx, key, "application/octet-stream", content); err != nil {
		return "", fmt.Errorf("failed to store student report school_id=%s file=%s: %w", schoolID, fileName, err)
	}
	return key, nil
}

// PutHomeworkAttachment uploads homework attachment and returns storage key
func PutHomeworkAttachment(
	ctx context.Context,
	store Store,
	schoolID string,
	teacherID string,
	homeworkID string,
	attachmentID string,
	fileName string,
	content []byte,
) (string, error) {
	if store == nil {
		return "", errors.New("object store not configured")
	}

	scopePrefix := fmt.Sprintf("schools/%s", schoolID)
	key := BuildScopedKey(scopePrefix, "homework", fileName)
	if err := store.Put(ctx, key, "application/octet-stream", content); err != nil {
		return "", fmt.Errorf("failed to store homework attachment school_id=%s file=%s: %w", schoolID, fileName, err)
	}
	return key, nil
}

// PutAdmissionDocument uploads admission document and returns storage key
func PutAdmissionDocument(
	ctx context.Context,
	store Store,
	schoolID string,
	applicationID string,
	docID string,
	fileName string,
	content []byte,
) (string, error) {
	if store == nil {
		return "", errors.New("object store not configured")
	}

	scopePrefix := fmt.Sprintf("schools/%s", schoolID)
	key := BuildScopedKey(scopePrefix, "admission", fileName)
	if err := store.Put(ctx, key, "application/octet-stream", content); err != nil {
		return "", fmt.Errorf("failed to store admission document school_id=%s file=%s: %w", schoolID, fileName, err)
	}
	return key, nil
}

// PutTeacherAppointmentDocument uploads a teacher appointment document and returns storage key.
func PutTeacherAppointmentDocument(
	ctx context.Context,
	store Store,
	schoolID string,
	applicationID string,
	docType string,
	fileName string,
	content []byte,
) (string, error) {
	if store == nil {
		return "", errors.New("object store not configured")
	}

	scopePrefix := fmt.Sprintf("schools/%s", schoolID)
	category := "teacher-appointments"
	if trimmedType := strings.TrimSpace(docType); trimmedType != "" {
		category = strings.Join([]string{category, sanitizeFileName(trimmedType)}, "/")
	}
	key := BuildScopedKey(scopePrefix, category, fileName)
	if err := store.Put(ctx, key, "application/octet-stream", content); err != nil {
		return "", fmt.Errorf("failed to store teacher appointment document school_id=%s type=%s file=%s: %w", schoolID, docType, fileName, err)
	}
	return key, nil
}

// PutSuperAdminDocument uploads super-admin owned document and returns storage key
// Stored under "superadmin" scope instead of "schools/school-id" scope
func PutSuperAdminDocument(
	ctx context.Context,
	store Store,
	ownerUserID string,
	docType string, // "questions" or "materials"
	docID string,
	fileName string,
	content []byte,
) (string, error) {
	if store == nil {
		return "", errors.New("object store not configured")
	}
	if strings.TrimSpace(docType) == "" {
		return "", errors.New("super-admin document type is required")
	}

	scopePrefix := "superadmin"
	key := BuildScopedKey(scopePrefix, docType, fileName)
	if err := store.Put(ctx, key, "application/octet-stream", content); err != nil {
		return "", fmt.Errorf("failed to store super-admin document type=%s file=%s: %w", docType, fileName, err)
	}
	return key, nil
}

// GetDocumentRequired retrieves document content from R2 only.
// Requires a non-empty storage key persisted in Postgres metadata tables.
func GetDocumentRequired(ctx context.Context, store Store, storageKey string) ([]byte, error) {
	if store == nil {
		return nil, errors.New("object store not configured")
	}
	if strings.TrimSpace(storageKey) == "" {
		return nil, errors.New("document storage key missing")
	}
	content, err := store.Get(ctx, storageKey)
	if err != nil {
		return nil, err
	}
	return content, nil
}

// DeleteDocumentWithFallback removes from R2
func DeleteDocumentWithFallback(ctx context.Context, store Store, storageKey string) error {
	if strings.TrimSpace(storageKey) == "" || store == nil {
		// No R2 storage key; document metadata exists only in database
		return nil
	}

	err := store.Delete(ctx, storageKey)
	if err == nil {
		return nil
	}
	var notFound ErrObjectNotFound
	if errors.As(err, &notFound) {
		// Already gone
		return nil
	}
	return err
}
