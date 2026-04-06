package public

import (
	"errors"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/schools24/backend/internal/shared/admissionhub"
	sharedsecurity "github.com/schools24/backend/internal/shared/security"
)

// Handler handles public (no-auth) admission HTTP endpoints.
type Handler struct {
	service     *Service
	hub         *admissionhub.Hub
	embedSecret string
}

// NewHandler creates a new public handler.
func NewHandler(service *Service, hub *admissionhub.Hub, embedSecret string) *Handler {
	return &Handler{service: service, hub: hub, embedSecret: embedSecret}
}

// GetAdmissionInfo handles GET /api/v1/public/admission/:slug
// Returns whether the school exists and whether admissions are currently open.
func (h *Handler) GetAdmissionInfo(c *gin.Context) {
	slug := strings.TrimSpace(c.Param("slug"))
	if slug == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "slug is required"})
		return
	}
	if err := h.requireValidEmbed(c, "admission", slug); err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}

	info, err := h.service.GetSchoolAdmissionInfo(c.Request.Context(), slug)
	if err != nil {
		if errors.Is(err, ErrSchoolNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "school_not_found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal_error"})
		return
	}

	c.JSON(http.StatusOK, info)
}

// SubmitAdmission handles POST /api/v1/public/admission/:slug (multipart/form-data)
// Accepts form fields + up to 6 document files (one per document type).
func (h *Handler) SubmitAdmission(c *gin.Context) {
	slug := strings.TrimSpace(c.Param("slug"))
	if slug == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "slug is required"})
		return
	}
	if err := h.requireValidEmbed(c, "admission", slug); err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}

	// Parse multipart form — accept up to 40MB total (6 docs × ~5MB + form overhead)
	if err := c.Request.ParseMultipartForm(40 << 20); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "failed to parse form"})
		return
	}

	// Bind form fields
	var req SubmitAdmissionRequest
	if err := c.ShouldBind(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid form data", "detail": err.Error()})
		return
	}

	// Parse document uploads
	const maxDocSize int64 = 5 * 1024 * 1024 // 5MB per file
	var documents []*AdmissionDocumentUpload

	for _, docType := range ValidDocumentTypes {
		fh, err := c.FormFile(docType)
		if err != nil {
			// Not uploaded — that's fine, documents are optional
			continue
		}
		if fh.Size > maxDocSize {
			c.JSON(http.StatusBadRequest, gin.H{
				"error":         "file_too_large",
				"document_type": docType,
				"max_bytes":     maxDocSize,
			})
			return
		}
		mimeType := fh.Header.Get("Content-Type")
		if !isAllowedDocMime(mimeType) {
			c.JSON(http.StatusBadRequest, gin.H{
				"error":         "invalid_file_type",
				"document_type": docType,
				"allowed":       "image/jpeg, image/png, application/pdf",
			})
			return
		}
		f, err := fh.Open()
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to open file"})
			return
		}
		content, err := io.ReadAll(io.LimitReader(f, maxDocSize+1))
		f.Close()
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to read file"})
			return
		}
		if int64(len(content)) > maxDocSize {
			c.JSON(http.StatusBadRequest, gin.H{"error": "file_too_large", "document_type": docType})
			return
		}
		documents = append(documents, &AdmissionDocumentUpload{
			DocumentType: docType,
			FileName:     fh.Filename,
			FileSize:     fh.Size,
			MimeType:     mimeType,
			Content:      content,
		})
	}

	resp, err := h.service.SubmitAdmission(c.Request.Context(), slug, &req, documents)
	if err != nil {
		log.Printf("[public-admission] submit failed slug=%s err=%v", slug, err)
		switch {
		case errors.Is(err, ErrSchoolNotFound):
			c.JSON(http.StatusNotFound, gin.H{"error": "school_not_found"})
		case errors.Is(err, ErrAdmissionsClosed):
			c.JSON(http.StatusForbidden, gin.H{"error": "admissions_closed"})
		case errors.Is(err, ErrValidation):
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": "internal_error"})
		}
		return
	}

	c.JSON(http.StatusCreated, resp)

	// Notify any admin WS subscribers watching this school's admissions.
	if h.hub != nil && h.hub.Subscribers(resp.SchoolID) > 0 {
		h.hub.Broadcast(resp.SchoolID, &admissionhub.Event{
			Type:     "new_admission",
			SchoolID: resp.SchoolID.String(),
		})
	}
}

// GetTeacherAppointmentInfo handles GET /api/v1/public/teacher-appointments/:slug
func (h *Handler) GetTeacherAppointmentInfo(c *gin.Context) {
	slug := strings.TrimSpace(c.Param("slug"))
	if slug == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "slug is required"})
		return
	}
	if err := h.requireValidEmbed(c, "teacher-appointment", slug); err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}

	info, err := h.service.GetSchoolTeacherAppointmentInfo(c.Request.Context(), slug)
	if err != nil {
		if errors.Is(err, ErrSchoolNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "school_not_found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal_error"})
		return
	}
	c.JSON(http.StatusOK, info)
}

// SubmitTeacherAppointment handles POST /api/v1/public/teacher-appointments/:slug (multipart/form-data)
func (h *Handler) SubmitTeacherAppointment(c *gin.Context) {
	slug := strings.TrimSpace(c.Param("slug"))
	if slug == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "slug is required"})
		return
	}
	if err := h.requireValidEmbed(c, "teacher-appointment", slug); err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}

	if err := c.Request.ParseMultipartForm(120 << 20); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "failed to parse form"})
		return
	}

	var req SubmitTeacherAppointmentRequest
	if err := c.ShouldBind(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid form data", "detail": err.Error()})
		return
	}

	const maxDocSize int64 = 8 * 1024 * 1024 // 8MB per file
	documents := make([]*TeacherAppointmentDocumentUpload, 0)
	for _, docType := range ValidTeacherAppointmentDocumentTypes {
		fh, err := c.FormFile(docType)
		if err != nil {
			continue
		}
		if fh.Size > maxDocSize {
			c.JSON(http.StatusBadRequest, gin.H{
				"error":         "file_too_large",
				"document_type": docType,
				"max_bytes":     maxDocSize,
			})
			return
		}

		mimeType := fh.Header.Get("Content-Type")
		if !isAllowedTeacherAppointmentDocMime(mimeType) {
			c.JSON(http.StatusBadRequest, gin.H{
				"error":         "invalid_file_type",
				"document_type": docType,
				"allowed":       "image/jpeg, image/png, application/pdf",
			})
			return
		}

		f, err := fh.Open()
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to open file"})
			return
		}
		content, err := io.ReadAll(io.LimitReader(f, maxDocSize+1))
		f.Close()
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to read file"})
			return
		}
		if int64(len(content)) > maxDocSize {
			c.JSON(http.StatusBadRequest, gin.H{"error": "file_too_large", "document_type": docType})
			return
		}

		documents = append(documents, &TeacherAppointmentDocumentUpload{
			DocumentType: docType,
			FileName:     fh.Filename,
			FileSize:     fh.Size,
			MimeType:     mimeType,
			Content:      content,
		})
	}

	resp, err := h.service.SubmitTeacherAppointment(c.Request.Context(), slug, &req, documents)
	if err != nil {
		log.Printf("[public-teacher-appointment] submit failed slug=%s err=%v", slug, err)
		switch {
		case errors.Is(err, ErrSchoolNotFound):
			c.JSON(http.StatusNotFound, gin.H{"error": "school_not_found"})
		case errors.Is(err, ErrTeacherAppointmentsClosed):
			c.JSON(http.StatusForbidden, gin.H{"error": "teacher_appointments_closed"})
		case errors.Is(err, ErrValidation):
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": "internal_error"})
		}
		return
	}

	c.JSON(http.StatusCreated, resp)
}

func isAllowedDocMime(mime string) bool {
	switch strings.ToLower(strings.TrimSpace(mime)) {
	case "image/jpeg", "image/jpg", "image/png", "application/pdf":
		return true
	}
	return false
}

func isAllowedTeacherAppointmentDocMime(mime string) bool {
	switch strings.ToLower(strings.TrimSpace(mime)) {
	case "image/jpeg", "image/jpg", "image/png", "application/pdf":
		return true
	}
	return false
}

func (h *Handler) requireValidEmbed(c *gin.Context, formType, slug string) error {
	if c.Query("embed") != "1" {
		return nil
	}

	return sharedsecurity.VerifyEmbedSignature(
		h.embedSecret,
		formType,
		slug,
		c.Query("expires"),
		c.Query("signature"),
		time.Now(),
	)
}
