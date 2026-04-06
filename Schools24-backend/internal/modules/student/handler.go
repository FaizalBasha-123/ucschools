package student

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/schools24/backend/internal/shared/middleware"
)

func strictBindJSON(c *gin.Context, dest any) error {
	dec := json.NewDecoder(c.Request.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(dest); err != nil {
		return err
	}
	if err := dec.Decode(&struct{}{}); err != io.EOF {
		return fmt.Errorf("request body must contain a single JSON object")
	}
	return nil
}

func servePrivateFile(c *gin.Context, inline bool, contentType, fileName string, content []byte) {
	if strings.TrimSpace(contentType) == "" {
		contentType = "application/octet-stream"
	}
	disposition := "attachment"
	if inline {
		disposition = "inline"
	}
	safeName := strings.ReplaceAll(strings.TrimSpace(fileName), "\"", "")
	c.Header("Content-Type", contentType)
	c.Header("Content-Disposition", disposition+`; filename="`+safeName+`"`)
	c.Header("Content-Length", fmt.Sprintf("%d", len(content)))
	c.Header("Cache-Control", "private, no-store, max-age=0")
	c.Header("Pragma", "no-cache")
	c.Header("X-Content-Type-Options", "nosniff")
	c.Data(http.StatusOK, contentType, content)
}

// Handler handles HTTP requests for students
type Handler struct {
	service *Service
}

// NewHandler creates a new student handler
func NewHandler(service *Service) *Handler {
	return &Handler{service: service}
}

// GetDashboard returns the student's dashboard
// GET /api/v1/student/dashboard
func (h *Handler) GetDashboard(c *gin.Context) {
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

	dashboard, err := h.service.GetDashboard(c.Request.Context(), userID)
	if err != nil {
		if errors.Is(err, ErrStudentNotFound) {
			c.JSON(http.StatusNotFound, gin.H{
				"error":   "student_not_found",
				"message": "Student profile not found. Please contact admin.",
			})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, dashboard)
}

// GetClassSubjects returns subjects assigned to the logged-in student's class.
// GET /api/v1/student/class-subjects
func (h *Handler) GetClassSubjects(c *gin.Context) {
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

	subjects, err := h.service.GetClassSubjects(c.Request.Context(), userID)
	if err != nil {
		if errors.Is(err, ErrStudentNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "student_not_found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"subjects": subjects})
}

// GetProfile returns the student's profile
// GET /api/v1/student/profile
func (h *Handler) GetProfile(c *gin.Context) {
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

	profile, err := h.service.GetProfile(c.Request.Context(), userID)
	if err != nil {
		if errors.Is(err, ErrStudentNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "student_not_found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"student": profile})
}

// GetAttendance returns attendance records
// GET /api/v1/student/attendance
func (h *Handler) GetAttendance(c *gin.Context) {
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

	var startDate time.Time
	var endDate time.Time

	if rawStart := strings.TrimSpace(c.Query("start_date")); rawStart != "" {
		parsedStart, parseErr := time.Parse("2006-01-02", rawStart)
		if parseErr != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_start_date"})
			return
		}
		startDate = parsedStart
	}
	if rawEnd := strings.TrimSpace(c.Query("end_date")); rawEnd != "" {
		parsedEnd, parseErr := time.Parse("2006-01-02", rawEnd)
		if parseErr != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_end_date"})
			return
		}
		endDate = parsedEnd
	}
	if !startDate.IsZero() && !endDate.IsZero() && endDate.Before(startDate) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_date_range"})
		return
	}

	records, stats, err := h.service.GetAttendance(c.Request.Context(), userID, startDate, endDate)
	if err != nil {
		if errors.Is(err, ErrStudentNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "student_not_found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"attendance": records,
		"stats":      stats,
	})
}

// GetFees returns fee summary, breakdown and payment history for logged-in student
// GET /api/v1/student/fees
func (h *Handler) GetFees(c *gin.Context) {
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

	fees, err := h.service.GetFees(c.Request.Context(), userID)
	if err != nil {
		if errors.Is(err, ErrStudentNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "student_not_found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, fees)
}

// ListStudyMaterials returns class-scoped study materials for the logged-in student.
// GET /api/v1/student/materials
func (h *Handler) ListStudyMaterials(c *gin.Context) {
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

	page := int64(1)
	if p := strings.TrimSpace(c.Query("page")); p != "" {
		parsed, parseErr := strconv.ParseInt(p, 10, 64)
		if parseErr != nil || parsed < 1 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "page must be >= 1"})
			return
		}
		page = parsed
	}

	pageSize := int64(20)
	if ps := strings.TrimSpace(c.Query("page_size")); ps != "" {
		parsed, parseErr := strconv.ParseInt(ps, 10, 64)
		if parseErr != nil || parsed < 1 || parsed > 500 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "page_size must be between 1 and 500"})
			return
		}
		pageSize = parsed
	}

	order := strings.ToLower(strings.TrimSpace(c.Query("order")))
	ascending := order == "asc"
	subject := strings.TrimSpace(c.Query("subject"))
	search := strings.TrimSpace(c.Query("search"))

	docs, hasMore, err := h.service.ListStudyMaterialsPaged(c.Request.Context(), userID, page, pageSize, ascending, subject, search)
	if err != nil {
		if errors.Is(err, ErrStudentNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "student_not_found"})
			return
		}
		if errors.Is(err, ErrClassNotFound) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "class_not_assigned"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	nextPage := int64(0)
	if hasMore {
		nextPage = page + 1
	}
	c.JSON(http.StatusOK, gin.H{
		"materials": docs,
		"page":      page,
		"page_size": pageSize,
		"has_more":  hasMore,
		"next_page": nextPage,
		"order":     map[bool]string{true: "asc", false: "desc"}[ascending],
	})
}

// ViewStudyMaterial streams a student-accessible study material for browser view.
// GET /api/v1/student/materials/:id/view
func (h *Handler) ViewStudyMaterial(c *gin.Context) {
	h.serveStudyMaterial(c, true)
}

// DownloadStudyMaterial streams a student-accessible study material as attachment.
// GET /api/v1/student/materials/:id/download
func (h *Handler) DownloadStudyMaterial(c *gin.Context) {
	h.serveStudyMaterial(c, false)
}

// ListReportDocuments returns class-scoped report documents for the logged-in student.
// GET /api/v1/student/report-documents
func (h *Handler) ListReportDocuments(c *gin.Context) {
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

	page := int64(1)
	if p := strings.TrimSpace(c.Query("page")); p != "" {
		parsed, parseErr := strconv.ParseInt(p, 10, 64)
		if parseErr != nil || parsed < 1 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "page must be >= 1"})
			return
		}
		page = parsed
	}

	pageSize := int64(20)
	if ps := strings.TrimSpace(c.Query("page_size")); ps != "" {
		parsed, parseErr := strconv.ParseInt(ps, 10, 64)
		if parseErr != nil || parsed < 1 || parsed > 500 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "page_size must be between 1 and 500"})
			return
		}
		pageSize = parsed
	}

	order := strings.ToLower(strings.TrimSpace(c.Query("order")))
	ascending := order == "asc"
	search := strings.TrimSpace(c.Query("search"))

	docs, hasMore, err := h.service.ListReportDocumentsPaged(c.Request.Context(), userID, page, pageSize, ascending, search)
	if err != nil {
		if errors.Is(err, ErrStudentNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "student_not_found"})
			return
		}
		if errors.Is(err, ErrClassNotFound) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "class_not_assigned"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	nextPage := int64(0)
	if hasMore {
		nextPage = page + 1
	}
	c.JSON(http.StatusOK, gin.H{
		"reports":   docs,
		"page":      page,
		"page_size": pageSize,
		"has_more":  hasMore,
		"next_page": nextPage,
		"order":     map[bool]string{true: "asc", false: "desc"}[ascending],
	})
}

// ViewReportDocument streams a student-accessible report document for browser view.
// GET /api/v1/student/report-documents/:id/view
func (h *Handler) ViewReportDocument(c *gin.Context) {
	h.serveReportDocument(c, true)
}

// DownloadReportDocument streams a student-accessible report document as attachment.
// GET /api/v1/student/report-documents/:id/download
func (h *Handler) DownloadReportDocument(c *gin.Context) {
	h.serveReportDocument(c, false)
}

func (h *Handler) serveStudyMaterial(c *gin.Context, inline bool) {
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

	materialID := strings.TrimSpace(c.Param("id"))
	if materialID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "material id is required"})
		return
	}

	doc, err := h.service.GetStudyMaterialByID(c.Request.Context(), userID, materialID)
	if err != nil {
		if errors.Is(err, ErrStudentNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "student_not_found"})
			return
		}
		if errors.Is(err, ErrStudyMaterialNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "study_material_not_found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	servePrivateFile(c, inline, doc.MimeType, doc.FileName, doc.Content)
}

func (h *Handler) serveReportDocument(c *gin.Context, inline bool) {
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

	documentID := strings.TrimSpace(c.Param("id"))
	if documentID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "document id is required"})
		return
	}

	doc, err := h.service.GetReportDocumentByID(c.Request.Context(), userID, documentID)
	if err != nil {
		if errors.Is(err, ErrStudentNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "student_not_found"})
			return
		}
		if errors.Is(err, ErrReportDocNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "report_document_not_found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	servePrivateFile(c, inline, doc.MimeType, doc.FileName, doc.Content)
}

// GetFeedbackOptions returns teacher options for student feedback.
// GET /api/v1/student/feedback/options
func (h *Handler) GetFeedbackOptions(c *gin.Context) {
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

	options, err := h.service.GetFeedbackTeacherOptions(c.Request.Context(), userID)
	if err != nil {
		if errors.Is(err, ErrStudentNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "student_not_found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"teachers": options})
}

// GetFeedback returns student feedback history.
// GET /api/v1/student/feedback
func (h *Handler) GetFeedback(c *gin.Context) {
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

	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	items, err := h.service.ListFeedback(c.Request.Context(), userID, limit)
	if err != nil {
		if errors.Is(err, ErrStudentNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "student_not_found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"feedback": items})
}

// CreateFeedback submits a new student feedback entry.
// POST /api/v1/student/feedback
func (h *Handler) CreateFeedback(c *gin.Context) {
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

	var req CreateStudentFeedbackRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_request_payload"})
		return
	}

	feedbackID, err := h.service.SubmitFeedback(c.Request.Context(), userID, &req)
	if err != nil {
		switch {
		case errors.Is(err, ErrStudentNotFound):
			c.JSON(http.StatusNotFound, gin.H{"error": "student_not_found"})
			return
		case errors.Is(err, ErrInvalidFeedback):
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_feedback_payload"})
			return
		case errors.Is(err, ErrTeacherNotFound):
			c.JSON(http.StatusForbidden, gin.H{"error": "invalid_feedback_target"})
			return
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
	}

	c.JSON(http.StatusCreated, gin.H{
		"message": "feedback_submitted",
		"id":      feedbackID,
	})
}

// GetClasses returns all available classes
// GET /api/v1/classes
func (h *Handler) GetClasses(c *gin.Context) {
	academicYear := c.Query("academic_year")

	classes, err := h.service.GetClasses(c.Request.Context(), academicYear)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"classes": classes})
}

// CreateClass creates a new class (admin only)
// POST /api/v1/classes
func (h *Handler) CreateClass(c *gin.Context) {
	var req struct {
		Name         string  `json:"name" binding:"required"`
		Grade        *int    `json:"grade"` // optional: custom catalog classes have no numeric grade
		Section      *string `json:"section"`
		AcademicYear string  `json:"academic_year" binding:"required"`
		RoomNumber   *string `json:"room_number"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Determine School ID
	var schoolID uuid.UUID
	userRole := middleware.GetRole(c)
	if userRole == "super_admin" {
		sid := c.Query("school_id")
		if sid == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "school_id query param required for super_admin"})
			return
		}
		parsed, err := uuid.Parse(sid)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid school_id"})
			return
		}
		schoolID = parsed
	} else {
		sid := middleware.GetSchoolID(c)
		if sid == "" {
			c.JSON(http.StatusForbidden, gin.H{"error": "school_id missing from context"})
			return
		}
		parsed, err := uuid.Parse(sid)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "invalid school_id in token"})
			return
		}
		schoolID = parsed
	}

	if req.Section != nil {
		section := strings.ToUpper(strings.TrimSpace(*req.Section))
		if section != "" && !isValidSection(section) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid section label"})
			return
		}
		req.Section = &section
	}

	class := &Class{
		SchoolID:     &schoolID,
		Name:         req.Name,
		Grade:        req.Grade, // *int: nil for custom classes, pointer value for numeric grades
		Section:      req.Section,
		AcademicYear: req.AcademicYear,
		RoomNumber:   req.RoomNumber,
	}

	if err := h.service.CreateClass(c.Request.Context(), class); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"class": class})
}

// UpdateClass updates an existing class (admin only)
// PUT /api/v1/classes/:id
func (h *Handler) UpdateClass(c *gin.Context) {
	classID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid class id"})
		return
	}

	var req UpdateClassRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	class, err := h.service.GetClassByID(c.Request.Context(), classID)
	if err != nil {
		if errors.Is(err, ErrClassNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "class_not_found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	if req.Name != nil {
		class.Name = *req.Name
	}
	if req.Grade != nil {
		class.Grade = req.Grade // *int: pass through directly, no numeric restrictions for custom classes
	}
	if req.Section != nil {
		section := strings.ToUpper(strings.TrimSpace(*req.Section))
		if section == "" {
			class.Section = nil
		} else if !isValidSection(section) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid section label"})
			return
		} else {
			class.Section = &section
		}
	}
	if req.AcademicYear != nil {
		class.AcademicYear = *req.AcademicYear
	}
	if req.RoomNumber != nil {
		class.RoomNumber = req.RoomNumber
	}
	if req.ClassTeacherID != nil {
		teacherID := strings.TrimSpace(*req.ClassTeacherID)
		if teacherID == "" {
			class.ClassTeacherID = nil
		} else {
			parsedTeacherID, parseErr := uuid.Parse(teacherID)
			if parseErr != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": "invalid class_teacher_id"})
				return
			}
			class.ClassTeacherID = &parsedTeacherID
		}
	}

	if err := h.service.UpdateClass(c.Request.Context(), class); err != nil {
		if errors.Is(err, ErrClassNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "class_not_found"})
			return
		}
		if errors.Is(err, ErrTeacherNotFound) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "teacher_not_found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"class": class})
}

// DeleteClass deletes a class (admin only)
// DELETE /api/v1/classes/:id
func (h *Handler) DeleteClass(c *gin.Context) {
	classID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid class id"})
		return
	}

	if err := h.service.DeleteClass(c.Request.Context(), classID); err != nil {
		if errors.Is(err, ErrClassHasStudents) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "class_has_students"})
			return
		}
		if errors.Is(err, ErrClassNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "class_not_found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.Status(http.StatusNoContent)
}

// GetAllStudents returns all students (admin only)
// GET /api/v1/students
func (h *Handler) GetAllStudents(c *gin.Context) {
	// Determine School ID
	var schoolID uuid.UUID
	userRole := middleware.GetRole(c)
	var err error

	if userRole == "super_admin" {
		sid := c.Query("school_id")
		if sid == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "school_id query param required for super_admin"})
			return
		}
		schoolID, err = uuid.Parse(sid)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid school_id"})
			return
		}
	} else {
		sid := middleware.GetSchoolID(c)
		if sid == "" {
			c.JSON(http.StatusForbidden, gin.H{"error": "school_id missing from context"})
			return
		}
		schoolID, err = uuid.Parse(sid)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "invalid school_id in token"})
			return
		}
	}

	search := c.Query("search")
	var classIDs []uuid.UUID
	if classIDsRaw := strings.TrimSpace(c.Query("class_ids")); classIDsRaw != "" {
		for _, part := range strings.Split(classIDsRaw, ",") {
			classIDStr := strings.TrimSpace(part)
			if classIDStr == "" {
				continue
			}
			parsedClassID, parseErr := uuid.Parse(classIDStr)
			if parseErr != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": "invalid class_ids"})
				return
			}
			classIDs = append(classIDs, parsedClassID)
		}
	}
	if len(classIDs) == 0 {
		if classIDStr := strings.TrimSpace(c.Query("class_id")); classIDStr != "" {
			parsedClassID, parseErr := uuid.Parse(classIDStr)
			if parseErr != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": "invalid class_id"})
				return
			}
			classIDs = []uuid.UUID{parsedClassID}
		}
	}
	page := 1
	pageSize := 20
	if p := c.Query("page"); p != "" {
		if val, err := strconv.Atoi(p); err == nil {
			page = val
		}
	}
	if ps := c.Query("page_size"); ps != "" {
		if val, err := strconv.Atoi(ps); err == nil {
			pageSize = val
		}
	}

	students, total, err := h.service.GetAllStudents(c.Request.Context(), schoolID, search, classIDs, page, pageSize)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if students == nil {
		students = []Student{}
	}

	c.JSON(http.StatusOK, gin.H{
		"students":  students,
		"total":     total,
		"page":      page,
		"page_size": pageSize,
	})
}

// CreateStudentProfileForAdmin creates a missing student profile row for an existing student user.
// POST /api/v1/admin/students/profile
func (h *Handler) CreateStudentProfileForAdmin(c *gin.Context) {
	var req CreateStudentProfileForUserRequest
	if err := strictBindJSON(c, &req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	student, err := h.service.CreateProfileForExistingUser(c.Request.Context(), &req)
	if err != nil {
		switch {
		case errors.Is(err, ErrInvalidInput), errors.Is(err, ErrInvalidClass):
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		case errors.Is(err, ErrInvalidApaarID), errors.Is(err, ErrInvalidAbcID):
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		case errors.Is(err, ErrApaarIDExists):
			c.JSON(http.StatusConflict, gin.H{"error": "apaar_id_already_exists"})
		case errors.Is(err, ErrAbcIDExists):
			c.JSON(http.StatusConflict, gin.H{"error": "abc_id_already_exists"})
		case errors.Is(err, ErrFederatedIDConflict):
			c.JSON(http.StatusConflict, gin.H{"error": "federated_id_conflict"})
		case errors.Is(err, ErrClassNotFound), errors.Is(err, ErrStudentNotFound):
			c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		}
		return
	}

	c.JSON(http.StatusCreated, gin.H{"student": student})
}

// UpdateStudent updates a student profile (admin only)
// PUT /api/v1/students/:id
func (h *Handler) UpdateStudent(c *gin.Context) {
	idStr := c.Param("id")
	id, err := uuid.Parse(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid student id"})
		return
	}

	var req UpdateStudentRequest
	if err := strictBindJSON(c, &req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Fetch existing student
	student, err := h.service.GetStudentByID(c.Request.Context(), id)
	if err != nil {
		if errors.Is(err, ErrStudentNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "student not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Merge updates
	if req.FullName != nil {
		student.FullName = *req.FullName
	}
	if req.Email != nil {
		student.Email = *req.Email
	}
	if req.AdmissionNumber != nil {
		student.AdmissionNumber = *req.AdmissionNumber
	}
	if req.ApaarID != nil {
		student.ApaarID = req.ApaarID
	}
	if req.AbcID != nil {
		student.AbcID = req.AbcID
	}
	if req.RollNumber != nil {
		student.RollNumber = req.RollNumber
	}
	if req.ClassID != nil {
		classIDRaw := strings.TrimSpace(*req.ClassID)
		if classIDRaw == "" {
			student.ClassID = nil
		} else {
			cid, parseErr := uuid.Parse(classIDRaw)
			if parseErr != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": "invalid class_id"})
				return
			}

			if _, classErr := h.service.GetClassByID(c.Request.Context(), cid); classErr != nil {
				if errors.Is(classErr, ErrClassNotFound) {
					c.JSON(http.StatusBadRequest, gin.H{"error": "class_not_found"})
					return
				}
				c.JSON(http.StatusInternalServerError, gin.H{"error": classErr.Error()})
				return
			}

			student.ClassID = &cid
		}
	}
	if req.BloodGroup != nil {
		student.BloodGroup = req.BloodGroup
	}
	if req.Address != nil {
		student.Address = req.Address
	}
	if req.ParentName != nil {
		student.ParentName = req.ParentName
	}
	if req.ParentEmail != nil {
		student.ParentEmail = req.ParentEmail
	}
	if req.ParentPhone != nil {
		student.ParentPhone = req.ParentPhone
	}
	if req.EmergencyContact != nil {
		student.EmergencyContact = req.EmergencyContact
	}
	if req.DateOfBirth != nil {
		dob, err := time.Parse("2006-01-02", *req.DateOfBirth)
		if err == nil {
			student.DateOfBirth = dob
		}
	}
	if req.Gender != nil {
		student.Gender = *req.Gender
	}
	if req.AdmissionDate != nil {
		adDate, err := time.Parse("2006-01-02", *req.AdmissionDate)
		if err == nil {
			student.AdmissionDate = adDate
		}
	}
	if req.AcademicYear != nil {
		student.AcademicYear = *req.AcademicYear
	}

	// Student section is no longer editable from student details.
	// Class + timetable mapping should drive section semantics.
	student.Section = nil

	if req.TransportMode != nil {
		student.TransportMode = req.TransportMode
	}
	if req.BusRouteID != nil {
		if *req.BusRouteID == "" {
			student.BusRouteID = nil
		} else {
			bid, err := uuid.Parse(*req.BusRouteID)
			if err == nil {
				student.BusRouteID = &bid
			}
		}
	}

	if err := h.service.UpdateStudent(c.Request.Context(), student); err != nil {
		if errors.Is(err, ErrInvalidApaarID) || errors.Is(err, ErrInvalidAbcID) {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		if errors.Is(err, ErrApaarIDExists) {
			c.JSON(http.StatusConflict, gin.H{"error": "apaar_id_already_exists"})
			return
		}
		if errors.Is(err, ErrAbcIDExists) {
			c.JSON(http.StatusConflict, gin.H{"error": "abc_id_already_exists"})
			return
		}
		if errors.Is(err, ErrFederatedIDConflict) {
			c.JSON(http.StatusConflict, gin.H{"error": "federated_id_conflict"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "student updated successfully", "student": student})
}

// DeleteStudent deletes a student (admin only)
// DELETE /api/v1/students/:id
func (h *Handler) DeleteStudent(c *gin.Context) {
	idStr := c.Param("id")
	id, err := uuid.Parse(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid student id"})
		return
	}

	if err := h.service.DeleteStudent(c.Request.Context(), id); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "student deleted successfully"})
}

// GetStudentProfileForAdmin returns a student's full profile looked up by user_id (admin use).
// GET /api/v1/admin/students/by-user/:userID
func (h *Handler) GetStudentProfileForAdmin(c *gin.Context) {
	userIDStr := c.Param("userID")
	userID, err := uuid.Parse(userIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user ID"})
		return
	}
	student, err := h.service.GetProfile(c.Request.Context(), userID)
	if err != nil {
		// Return null student gracefully — admin page handles nil
		c.JSON(http.StatusOK, gin.H{"student": nil})
		return
	}
	c.JSON(http.StatusOK, gin.H{"student": student})
}

func isValidSection(section string) bool {
	re := regexp.MustCompile(`^[A-Za-z]{1,5}$`)
	return re.MatchString(section)
}

// ─── Quiz handlers ────────────────────────────────────────────────────────────

// ListQuizzes returns all quizzes available to the authenticated student.
// GET /student/quizzes
func (h *Handler) ListQuizzes(c *gin.Context) {
	userIDStr := middleware.GetUserID(c)
	if userIDStr == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	userID, err := uuid.Parse(userIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user id"})
		return
	}

	list, err := h.service.ListAvailableQuizzes(c.Request.Context(), userID)
	if err != nil {
		if errors.Is(err, ErrStudentNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "student profile not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if list == nil {
		list = []StudentQuizListItem{}
	}
	c.JSON(http.StatusOK, gin.H{"quizzes": list})
}

// StartQuiz starts or resumes a quiz attempt.
// POST /student/quizzes/:id/start
func (h *Handler) StartQuiz(c *gin.Context) {
	userIDStr := middleware.GetUserID(c)
	if userIDStr == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	userID, err := uuid.Parse(userIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user id"})
		return
	}

	quizID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid quiz id"})
		return
	}

	resp, err := h.service.StartOrResumeQuiz(c.Request.Context(), userID, quizID)
	if err != nil {
		switch {
		case errors.Is(err, ErrStudentNotFound):
			c.JSON(http.StatusNotFound, gin.H{"error": "student profile not found"})
		case errors.Is(err, ErrQuizNotFound):
			c.JSON(http.StatusNotFound, gin.H{"error": "quiz not found"})
		case errors.Is(err, ErrQuizNotActive):
			c.JSON(http.StatusForbidden, gin.H{"error": "quiz is not available for attempts"})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		}
		return
	}
	c.JSON(http.StatusOK, resp)
}

// SubmitQuiz submits answers for a quiz attempt.
// POST /student/quizzes/:id/submit
func (h *Handler) SubmitQuiz(c *gin.Context) {
	userIDStr := middleware.GetUserID(c)
	if userIDStr == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	userID, err := uuid.Parse(userIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user id"})
		return
	}

	quizID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid quiz id"})
		return
	}

	var req SubmitQuizRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	result, err := h.service.SubmitQuiz(c.Request.Context(), userID, quizID, req)
	if err != nil {
		switch {
		case errors.Is(err, ErrStudentNotFound):
			c.JSON(http.StatusNotFound, gin.H{"error": "student profile not found"})
		case errors.Is(err, ErrAttemptNotFound):
			c.JSON(http.StatusNotFound, gin.H{"error": "attempt not found"})
		case errors.Is(err, ErrAttemptAlreadyCompleted):
			c.JSON(http.StatusConflict, gin.H{"error": "attempt already completed"})
		case errors.Is(err, ErrQuizExpired):
			c.JSON(http.StatusGone, gin.H{"error": "quiz timer has expired"})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		}
		return
	}
	c.JSON(http.StatusOK, result)
}

// GetAttemptResult returns the result of a completed attempt.
// GET /student/quizzes/attempts/:attemptID
func (h *Handler) GetAttemptResult(c *gin.Context) {
	userIDStr := middleware.GetUserID(c)
	if userIDStr == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	userID, err := uuid.Parse(userIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user id"})
		return
	}

	attemptID, err := uuid.Parse(c.Param("attemptID"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid attempt id"})
		return
	}

	result, err := h.service.GetAttemptResult(c.Request.Context(), userID, attemptID)
	if err != nil {
		switch {
		case errors.Is(err, ErrStudentNotFound):
			c.JSON(http.StatusNotFound, gin.H{"error": "student profile not found"})
		case errors.Is(err, ErrAttemptNotFound):
			c.JSON(http.StatusNotFound, gin.H{"error": "attempt not found"})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		}
		return
	}
	c.JSON(http.StatusOK, result)
}

// GetQuizLeaderboard returns the quiz-rating leaderboard for the student's class.
// GET /student/leaderboard/quiz
func (h *Handler) GetQuizLeaderboard(c *gin.Context) {
	userIDStr := middleware.GetUserID(c)
	if userIDStr == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	userID, err := uuid.Parse(userIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user id"})
		return
	}

	resp, err := h.service.GetQuizLeaderboard(c.Request.Context(), userID)
	if err != nil {
		switch {
		case errors.Is(err, ErrStudentNotFound):
			c.JSON(http.StatusNotFound, gin.H{"error": "student profile not found"})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		}
		return
	}
	c.JSON(http.StatusOK, resp)
}

// GetAssessmentLeaderboard returns assessment leaderboard for the student's class.
// GET /student/leaderboard/assessments
func (h *Handler) GetAssessmentLeaderboard(c *gin.Context) {
	userIDStr := middleware.GetUserID(c)
	if userIDStr == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	userID, err := uuid.Parse(userIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user id"})
		return
	}

	resp, err := h.service.GetAssessmentLeaderboard(c.Request.Context(), userID)
	if err != nil {
		switch {
		case errors.Is(err, ErrStudentNotFound):
			c.JSON(http.StatusNotFound, gin.H{"error": "student profile not found"})
		case errors.Is(err, ErrInvalidClass):
			c.JSON(http.StatusForbidden, gin.H{"error": "forbidden_class"})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		}
		return
	}
	c.JSON(http.StatusOK, resp)
}

// GetAssessmentStages returns exam-management stages (FA/SA/etc.) for the student's class.
// GET /student/assessments/stages
func (h *Handler) GetAssessmentStages(c *gin.Context) {
	userIDStr := middleware.GetUserID(c)
	if userIDStr == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	userID, err := uuid.Parse(userIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user id"})
		return
	}

	resp, err := h.service.GetAssessmentStages(c.Request.Context(), userID)
	if err != nil {
		switch {
		case errors.Is(err, ErrStudentNotFound):
			c.JSON(http.StatusNotFound, gin.H{"error": "student profile not found"})
		case errors.Is(err, ErrInvalidClass):
			c.JSON(http.StatusForbidden, gin.H{"error": "forbidden_class"})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		}
		return
	}

	c.JSON(http.StatusOK, resp)
}

// GetClassMessages returns paginated messages for the authenticated student's class.
// GET /student/messages
func (h *Handler) GetClassMessages(c *gin.Context) {
	userIDStr := middleware.GetUserID(c)
	if userIDStr == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	userID, err := uuid.Parse(userIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user id"})
		return
	}

	page := int64(1)
	if p := strings.TrimSpace(c.Query("page")); p != "" {
		parsed, parseErr := strconv.ParseInt(p, 10, 64)
		if parseErr != nil || parsed < 1 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "page must be a positive integer"})
			return
		}
		page = parsed
	}

	pageSize := int64(50)
	if ps := strings.TrimSpace(c.Query("page_size")); ps != "" {
		parsed, parseErr := strconv.ParseInt(ps, 10, 64)
		if parseErr != nil || parsed < 1 || parsed > 200 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "page_size must be between 1 and 200"})
			return
		}
		pageSize = parsed
	}

	resp, err := h.service.ListMyClassMessages(c.Request.Context(), userID, page, pageSize)
	if err != nil {
		switch {
		case errors.Is(err, ErrStudentNotFound):
			c.JSON(http.StatusNotFound, gin.H{"error": "student profile not found"})
		case errors.Is(err, ErrInvalidClass):
			c.JSON(http.StatusForbidden, gin.H{"error": "forbidden_class"})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		}
		return
	}

	c.JSON(http.StatusOK, resp)
}

// SendClassMessage posts a message to the authenticated student's class.
// POST /student/messages
func (h *Handler) SendClassMessage(c *gin.Context) {
	userIDStr := middleware.GetUserID(c)
	if userIDStr == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	userID, err := uuid.Parse(userIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user id"})
		return
	}

	var req SendStudentClassMessageRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request payload"})
		return
	}

	msg, err := h.service.SendMyClassMessage(c.Request.Context(), userID, req.Content)
	if err != nil {
		switch {
		case errors.Is(err, ErrStudentNotFound):
			c.JSON(http.StatusNotFound, gin.H{"error": "student profile not found"})
		case errors.Is(err, ErrEmptyMessageContent):
			c.JSON(http.StatusBadRequest, gin.H{"error": "message content cannot be empty"})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		}
		return
	}

	c.JSON(http.StatusCreated, msg)
}

// GetSubjectPerformance returns the calling student's marks aggregated per
// subject from teacher-uploaded assessment marks.
// GET /student/assessments/subject-performance
func (h *Handler) GetSubjectPerformance(c *gin.Context) {
	userIDStr := middleware.GetUserID(c)
	if userIDStr == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	userID, err := uuid.Parse(userIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user id"})
		return
	}

	resp, err := h.service.GetSubjectPerformance(c.Request.Context(), userID)
	if err != nil {
		switch {
		case errors.Is(err, ErrStudentNotFound):
			c.JSON(http.StatusNotFound, gin.H{"error": "student profile not found"})
		case errors.Is(err, ErrInvalidClass):
			c.JSON(http.StatusForbidden, gin.H{"error": "forbidden_class"})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		}
		return
	}

	c.JSON(http.StatusOK, resp)
}

// GetSchoolAssessmentLeaderboard returns the school-wide student ranking based
// on completed assessments. This crosses all classes so students can see where
// they stand across the whole school.
// GET /student/leaderboard/school-assessments
func (h *Handler) GetSchoolAssessmentLeaderboard(c *gin.Context) {
	userIDStr := middleware.GetUserID(c)
	if userIDStr == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	userID, err := uuid.Parse(userIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user id"})
		return
	}

	resp, err := h.service.GetSchoolAssessmentLeaderboard(c.Request.Context(), userID)
	if err != nil {
		switch {
		case errors.Is(err, ErrStudentNotFound):
			c.JSON(http.StatusNotFound, gin.H{"error": "student profile not found"})
		case errors.Is(err, ErrInvalidClass):
			c.JSON(http.StatusForbidden, gin.H{"error": "class not found"})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		}
		return
	}
	c.JSON(http.StatusOK, resp)
}
