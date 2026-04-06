package fileups

import (
	"fmt"
	"io"
	"mime/multipart"
	"os"
	"path/filepath"

	"github.com/google/uuid"
)

// Service handles file uploads
type Service struct {
	UploadDir string
}

// NewService creates a new file upload service
func NewService(uploadDir string) *Service {
	// Ensure upload directory exists
	if _, err := os.Stat(uploadDir); os.IsNotExist(err) {
		os.MkdirAll(uploadDir, 0755)
	}
	return &Service{UploadDir: uploadDir}
}

// UploadFile saves a file to the upload directory and returns the relative path
func (s *Service) UploadFile(file *multipart.FileHeader, subDir string) (string, error) {
	// Create subdirectory if needed
	destDir := filepath.Join(s.UploadDir, subDir)
	if _, err := os.Stat(destDir); os.IsNotExist(err) {
		os.MkdirAll(destDir, 0755)
	}

	// Generate unique filename
	ext := filepath.Ext(file.Filename)
	filename := fmt.Sprintf("%s%s", uuid.New().String(), ext)
	destPath := filepath.Join(destDir, filename)

	// Save file
	src, err := file.Open()
	if err != nil {
		return "", err
	}
	defer src.Close()

	dst, err := os.Create(destPath)
	if err != nil {
		return "", err
	}
	defer dst.Close()

	if _, err = io.Copy(dst, src); err != nil {
		return "", err
	}

	// Return relative path for URL (e.g., /uploads/attendance/abc.jpg)
	return fmt.Sprintf("/uploads/%s/%s", subDir, filename), nil
}

// GetFilePath returns the full filesystem path for a relative URL
func (s *Service) GetFilePath(urlPath string) string {
	// Remove /uploads prefix if present
	if len(urlPath) > 8 && urlPath[:8] == "/uploads" {
		urlPath = urlPath[8:]
	}
	return filepath.Join(s.UploadDir, urlPath)
}
