package academic

import (
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/schools24/backend/internal/modules/student"
	"github.com/schools24/backend/internal/shared/middleware"
)

// Handler handles HTTP requests for academic module
type Handler struct {
	service *Service
}

// NewHandler creates a new academic handler
func NewHandler(service *Service) *Handler {
	return &Handler{service: service}
}

// GetTimetable returns the student's timetable
// GET /api/v1/academic/timetable
func (h *Handler) GetTimetable(c *gin.Context) {
	userIDStr := middleware.GetUserID(c)
	if userIDStr == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	userID, err := uuid.Parse(userIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user ID"})
		return
	}

	timetable, err := h.service.GetTimetable(c.Request.Context(), userID)
	if err != nil {
		if errors.Is(err, student.ErrStudentNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "student_not_found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"timetable": timetable})
}

// GetTimetableConfig returns timetable configuration
// GET /api/v1/academic/timetable/config
func (h *Handler) GetTimetableConfig(c *gin.Context) {
	config, err := h.service.GetTimetableConfig(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"config": config})
}

// GetHomework returns homework for the student's class
// GET /api/v1/academic/homework
func (h *Handler) GetHomework(c *gin.Context) {
	userIDStr := middleware.GetUserID(c)
	if userIDStr == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	userID, err := uuid.Parse(userIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user ID"})
		return
	}

	status := c.Query("status")
	subjectID := c.Query("subject_id")
	search := c.Query("search")

	homework, err := h.service.GetHomework(c.Request.Context(), userID, status, subjectID, search)
	if err != nil {
		if errors.Is(err, student.ErrStudentNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "student_not_found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"homework": homework})
}

// GetHomeworkSubjectOptions returns available subjects for student homework filtering.
// GET /api/v1/academic/homework/options
func (h *Handler) GetHomeworkSubjectOptions(c *gin.Context) {
	userIDStr := middleware.GetUserID(c)
	if userIDStr == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	userID, err := uuid.Parse(userIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user ID"})
		return
	}
	options, err := h.service.GetHomeworkSubjectOptions(c.Request.Context(), userID)
	if err != nil {
		if errors.Is(err, student.ErrStudentNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "student_not_found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"subjects": options})
}

// GetHomeworkByID returns a single homework
// GET /api/v1/academic/homework/:id
func (h *Handler) GetHomeworkByID(c *gin.Context) {
	homeworkIDStr := c.Param("id")
	if strings.EqualFold(strings.TrimSpace(homeworkIDStr), "options") {
		h.GetHomeworkSubjectOptions(c)
		return
	}
	homeworkID, err := uuid.Parse(homeworkIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid homework ID"})
		return
	}

	homework, err := h.service.GetHomeworkByID(c.Request.Context(), homeworkID)
	if err != nil {
		if errors.Is(err, ErrHomeworkNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "homework_not_found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"homework": homework})
}

// SubmitHomework submits homework for grading
// POST /api/v1/academic/homework/:id/submit
func (h *Handler) SubmitHomework(c *gin.Context) {
	userIDStr := middleware.GetUserID(c)
	if userIDStr == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	userID, err := uuid.Parse(userIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user ID"})
		return
	}

	homeworkIDStr := c.Param("id")
	homeworkID, err := uuid.Parse(homeworkIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid homework ID"})
		return
	}

	var req SubmitHomeworkRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := h.service.SubmitHomework(c.Request.Context(), userID, homeworkID, &req); err != nil {
		if errors.Is(err, student.ErrStudentNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "student_not_found"})
			return
		}
		if errors.Is(err, ErrHomeworkNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "homework_not_found"})
			return
		}
		if errors.Is(err, ErrEmptySubmission) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "submission_text_or_attachment_required"})
			return
		}
		if errors.Is(err, ErrSubmissionLocked) {
			c.JSON(http.StatusConflict, gin.H{"error": "submission_locked"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Homework submitted successfully"})
}

// ViewHomeworkAttachment streams homework attachment inline for student.
// GET /api/v1/academic/homework/:id/attachments/:attachmentId/view
func (h *Handler) ViewHomeworkAttachment(c *gin.Context) {
	h.serveHomeworkAttachment(c, true)
}

// DownloadHomeworkAttachment downloads homework attachment for student.
// GET /api/v1/academic/homework/:id/attachments/:attachmentId/download
func (h *Handler) DownloadHomeworkAttachment(c *gin.Context) {
	h.serveHomeworkAttachment(c, false)
}

func (h *Handler) serveHomeworkAttachment(c *gin.Context, inline bool) {
	userIDStr := middleware.GetUserID(c)
	if userIDStr == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	userID, err := uuid.Parse(userIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user ID"})
		return
	}
	homeworkID := strings.TrimSpace(c.Param("id"))
	attachmentID := strings.TrimSpace(c.Param("attachmentId"))
	if homeworkID == "" || attachmentID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "missing attachment identifiers"})
		return
	}
	schoolID := strings.TrimSpace(middleware.GetSchoolID(c))
	meta, content, err := h.service.GetHomeworkAttachmentByID(c.Request.Context(), userID, schoolID, homeworkID, attachmentID)
	if err != nil {
		switch {
		case errors.Is(err, student.ErrStudentNotFound):
			c.JSON(http.StatusNotFound, gin.H{"error": "student_not_found"})
		case errors.Is(err, ErrNotAuthorized):
			c.JSON(http.StatusForbidden, gin.H{"error": "not_authorized_for_homework"})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		}
		return
	}
	c.Header("Content-Type", meta.MimeType)
	c.Header("Content-Length", fmt.Sprintf("%d", len(content)))
	disposition := "attachment"
	if inline {
		disposition = "inline"
	}
	c.Header("Content-Disposition", fmt.Sprintf("%s; filename=\"%s\"", disposition, meta.FileName))
	c.Data(http.StatusOK, meta.MimeType, content)
}

// GetGrades returns the student's grades
// GET /api/v1/academic/grades
func (h *Handler) GetGrades(c *gin.Context) {
	userIDStr := middleware.GetUserID(c)
	if userIDStr == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	userID, err := uuid.Parse(userIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user ID"})
		return
	}

	academicYear := c.Query("academic_year")

	grades, err := h.service.GetGrades(c.Request.Context(), userID, academicYear)
	if err != nil {
		if errors.Is(err, student.ErrStudentNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "student_not_found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"grades": grades})
}

// GetSubjects returns all subjects
// GET /api/v1/academic/subjects
func (h *Handler) GetSubjects(c *gin.Context) {
	subjects, err := h.service.GetSubjects(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"subjects": subjects})
}

// CreateSubject creates a new subject (admin only)
// POST /api/v1/academic/subjects
func (h *Handler) CreateSubject(c *gin.Context) {
	var req struct {
		Name        string `json:"name" binding:"required"`
		Code        string `json:"code" binding:"required"`
		Description string `json:"description,omitempty"`
		GradeLevels []int  `json:"grade_levels,omitempty"`
		Credits     int    `json:"credits"`
		IsOptional  bool   `json:"is_optional"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	subject := &Subject{
		Name:        req.Name,
		Code:        req.Code,
		Description: &req.Description,
		GradeLevels: req.GradeLevels,
		Credits:     req.Credits,
		IsOptional:  req.IsOptional,
	}

	if err := h.service.CreateSubject(c.Request.Context(), subject); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"subject": subject})
}
