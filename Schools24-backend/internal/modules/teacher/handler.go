package teacher

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/schools24/backend/internal/shared/fileups"
	"github.com/schools24/backend/internal/shared/middleware"
)

// Handler handles HTTP requests for teacher module
type Handler struct {
	service          *Service
	fileService      *fileups.Service
	hub              *MessageHub
	jwtSecret        string
	sessionValidator func(context.Context, *middleware.Claims) error
	upgrader         websocket.Upgrader
}

// NewHandler creates a new teacher handler.
// jwtSecret is used to validate tokens for WebSocket connections that arrive
// before the standard JWT middleware runs (query-param auth).
func NewHandler(service *Service, jwtSecret string, sessionValidator func(context.Context, *middleware.Claims) error) *Handler {
	// Initialize file upload service
	fileService := fileups.NewService("./uploads/attendance")
	return &Handler{
		service:          service,
		fileService:      fileService,
		hub:              NewMessageHub(),
		jwtSecret:        jwtSecret,
		sessionValidator: sessionValidator,
		upgrader: websocket.Upgrader{
			ReadBufferSize:  1024,
			WriteBufferSize: 1024,
			CheckOrigin: func(r *http.Request) bool {
				// Allow all origins in development; tighten in production.
				return true
			},
		},
	}
}

func (h *Handler) validateLiveToken(ctx context.Context, token string) (*middleware.Claims, error) {
	claims, err := middleware.ValidateToken(token, h.jwtSecret)
	if err != nil {
		return nil, err
	}
	if h.sessionValidator != nil {
		if err := h.sessionValidator(ctx, claims); err != nil {
			return nil, err
		}
	}
	return claims, nil
}

func strictBindJSON(c *gin.Context, dest any) error {
	dec := json.NewDecoder(c.Request.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(dest); err != nil {
		return err
	}
	if err := dec.Decode(&struct{}{}); err != io.EOF {
		return errors.New("request body must contain a single JSON object")
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
	c.Header("Content-Length", strconv.Itoa(len(content)))
	c.Header("Cache-Control", "private, no-store, max-age=0")
	c.Header("Pragma", "no-cache")
	c.Header("X-Content-Type-Options", "nosniff")
	c.Data(http.StatusOK, contentType, content)
}

func parseHomeworkAttachments(c *gin.Context, requireAtLeastOne bool) ([]HomeworkAttachmentUpload, error) {
	attachments := make([]HomeworkAttachmentUpload, 0)
	form, err := c.MultipartForm()
	if err != nil {
		return nil, errors.New("invalid multipart payload")
	}
	files := form.File["attachments"]
	if requireAtLeastOne && len(files) == 0 {
		return nil, errors.New("at least one attachment is required")
	}

	const (
		maxAttachmentCount = 5
		maxAttachmentSize  = 25 * 1024 * 1024
	)
	if len(files) > maxAttachmentCount {
		return nil, errors.New("maximum 5 attachments allowed")
	}

	allowedExt := map[string]struct{}{
		".pdf": {}, ".doc": {}, ".docx": {}, ".txt": {}, ".ppt": {}, ".pptx": {}, ".png": {}, ".jpg": {}, ".jpeg": {},
	}
	for _, fileHeader := range files {
		if fileHeader.Size <= 0 || fileHeader.Size > maxAttachmentSize {
			return nil, errors.New("each attachment must be between 1B and 25MB")
		}
		ext := strings.ToLower(filepath.Ext(fileHeader.Filename))
		if _, ok := allowedExt[ext]; !ok {
			return nil, errors.New("unsupported attachment type")
		}
		f, openErr := fileHeader.Open()
		if openErr != nil {
			return nil, errors.New("failed to open attachment")
		}
		content, readErr := io.ReadAll(io.LimitReader(f, maxAttachmentSize+1))
		_ = f.Close()
		if readErr != nil {
			return nil, errors.New("failed to read attachment")
		}
		if int64(len(content)) > maxAttachmentSize {
			return nil, errors.New("attachment too large")
		}
		attachments = append(attachments, HomeworkAttachmentUpload{
			FileName: fileHeader.Filename,
			FileSize: fileHeader.Size,
			MimeType: fileHeader.Header.Get("Content-Type"),
			Content:  content,
		})
	}

	return attachments, nil
}

// GetDashboard returns the teacher's dashboard
// GET /api/v1/teacher/dashboard
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
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, dashboard)
}

// GetProfile returns the teacher's profile
// GET /api/v1/teacher/profile
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
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, profile)
}

// GetLeaderboard returns the teacher leaderboard
// GET /api/v1/teacher/leaderboard
func (h *Handler) GetLeaderboard(c *gin.Context) {
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

	schoolIDStr := middleware.GetSchoolID(c)
	if schoolIDStr == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "school_id missing from context"})
		return
	}

	schoolID, err := uuid.Parse(schoolIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid school_id in token"})
		return
	}

	academicYear := c.Query("academic_year")

	resp, err := h.service.GetLeaderboard(c.Request.Context(), userID, schoolID, academicYear)
	if err != nil {
		if errors.Is(err, ErrTeacherNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "teacher_not_found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, resp)
}

// GetClasses returns assigned classes
// GET /api/v1/teacher/classes
func (h *Handler) GetClasses(c *gin.Context) {
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

	classes, err := h.service.GetAssignedClasses(c.Request.Context(), userID)
	if err != nil {
		if errors.Is(err, ErrTeacherNotFound) {
			log.Printf("[teacher] no teacher record for user_id=%s school_id=%s", userID.String(), middleware.GetSchoolID(c))
			c.JSON(http.StatusOK, gin.H{"classes": []TeacherAssignment{}})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"classes": classes})
}

// GetTimetableConfig returns timetable configuration for teacher view
// GET /api/v1/teacher/timetable/config
func (h *Handler) GetTimetableConfig(c *gin.Context) {
	config, err := h.service.GetTimetableConfig(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"config": config})
}

// GetTimetable returns the teacher's timetable
// GET /api/v1/teacher/timetable
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

	academicYear := c.Query("academic_year")
	timetable, err := h.service.GetTeacherTimetable(c.Request.Context(), userID, academicYear)
	if err != nil {
		if errors.Is(err, ErrTeacherNotFound) {
			log.Printf("[teacher] no teacher record for user_id=%s school_id=%s", userID.String(), middleware.GetSchoolID(c))
			c.JSON(http.StatusOK, gin.H{"timetable": []TimetableEntry{}})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"timetable": timetable})
}

// GetClassTimetable returns timetable for a class (teacher view)
// GET /api/v1/teacher/timetable/classes/:classId
func (h *Handler) GetClassTimetable(c *gin.Context) {
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

	classIDStr := c.Param("classId")
	classID, err := uuid.Parse(classIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid class ID"})
		return
	}

	academicYear := c.Query("academic_year")
	timetable, err := h.service.GetClassTimetable(c.Request.Context(), userID, classID, academicYear)
	if err != nil {
		if errors.Is(err, ErrTeacherNotFound) || errors.Is(err, ErrInvalidClass) {
			if errors.Is(err, ErrTeacherNotFound) {
				log.Printf("[teacher] no teacher record for user_id=%s school_id=%s", userID.String(), middleware.GetSchoolID(c))
			}
			c.JSON(http.StatusOK, gin.H{"timetable": []TimetableEntry{}})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"timetable": timetable})
}

// GetClassStudents returns students in a class
// GET /api/v1/teacher/classes/:classId/students
func (h *Handler) GetClassStudents(c *gin.Context) {
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

	classIDStr := c.Param("classId")
	classID, err := uuid.Parse(classIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid class ID"})
		return
	}

	students, err := h.service.GetStudentsByClass(c.Request.Context(), userID, classID)
	if err != nil {
		if errors.Is(err, ErrTeacherNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "teacher_not_found"})
			return
		}
		if errors.Is(err, ErrNotAuthorized) || errors.Is(err, ErrInvalidClass) {
			c.JSON(http.StatusForbidden, gin.H{"error": "not_authorized_for_class"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"students": students})
}

// GetStudentFeeData returns fee summary, breakdown and payment history for a student
// in one of the authenticated teacher's assigned classes.
// GET /api/v1/teacher/fees/student/:studentId
func (h *Handler) GetStudentFeeData(c *gin.Context) {
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

	studentIDStr := c.Param("studentId")
	studentID, err := uuid.Parse(studentIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid student ID"})
		return
	}

	data, err := h.service.GetStudentFeeData(c.Request.Context(), userID, studentID)
	if err != nil {
		if errors.Is(err, ErrTeacherNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "teacher_not_found"})
			return
		}
		if errors.Is(err, ErrNotAuthorized) {
			c.JSON(http.StatusForbidden, gin.H{"error": "not_authorized_for_student"})
			return
		}
		if errors.Is(err, ErrNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "student_not_found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, data)
}

// MarkAttendance marks attendance for a class
// POST /api/v1/teacher/attendance
func (h *Handler) MarkAttendance(c *gin.Context) {
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

	var req MarkAttendanceRequest
	contentType := c.ContentType()
	if strings.Contains(contentType, "application/json") {
		if err := strictBindJSON(c, &req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
	} else if err := c.ShouldBind(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Parse JSON attendance string
	var attendanceData []StudentAttendance
	if err := json.Unmarshal([]byte(req.Attendance), &attendanceData); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid attendance json format"})
		return
	}

	// Handle file upload
	photoURL := ""
	file, err := c.FormFile("photo")
	if err == nil {
		// File uploaded
		subDir := time.Now().Format("2006-01")
		photoURL, err = h.fileService.UploadFile(file, subDir)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save photo"})
			return
		}
	}

	if err := h.service.MarkAttendance(c.Request.Context(), userID, &req, attendanceData, photoURL); err != nil {
		if errors.Is(err, ErrTeacherNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "teacher_not_found"})
			return
		}
		if errors.Is(err, ErrNotAuthorized) || errors.Is(err, ErrInvalidClass) {
			c.JSON(http.StatusForbidden, gin.H{"error": "not_authorized_for_class"})
			return
		}
		if errors.Is(err, ErrInvalidAttendance) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_attendance_payload"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Attendance marked successfully", "photo_url": photoURL})
}

// GetAttendanceByDate returns attendance rows for selected class and date.
// GET /api/v1/teacher/attendance?class_id=<uuid>&date=YYYY-MM-DD
func (h *Handler) GetAttendanceByDate(c *gin.Context) {
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

	classIDStr := c.Query("class_id")
	if classIDStr == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "class_id is required"})
		return
	}

	classID, err := uuid.Parse(classIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid class_id"})
		return
	}

	dateStr := c.Query("date")
	if dateStr == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "date is required"})
		return
	}

	date, err := time.Parse("2006-01-02", dateStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid date format, use YYYY-MM-DD"})
		return
	}

	rows, err := h.service.GetAttendanceByDate(c.Request.Context(), userID, classID, date)
	if err != nil {
		if errors.Is(err, ErrTeacherNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "teacher_not_found"})
			return
		}
		if errors.Is(err, ErrNotAuthorized) || errors.Is(err, ErrInvalidClass) {
			c.JSON(http.StatusForbidden, gin.H{"error": "not_authorized_for_class"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, AttendanceByDateResponse{
		ClassID:  classID,
		Date:     dateStr,
		Students: rows,
	})
}

// UploadQuestionDocument uploads a question document and stores it in R2.
// POST /api/v1/teacher/question-documents
func (h *Handler) UploadQuestionDocument(c *gin.Context) {
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

	fileHeader, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "file is required"})
		return
	}

	const maxFileSize int64 = 10 * 1024 * 1024 // 10MB
	if fileHeader.Size <= 0 || fileHeader.Size > maxFileSize {
		c.JSON(http.StatusBadRequest, gin.H{"error": "file size must be between 1B and 10MB"})
		return
	}

	ext := strings.ToLower(filepath.Ext(fileHeader.Filename))
	if ext != ".pdf" && ext != ".doc" && ext != ".docx" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "only .pdf, .doc, .docx files are allowed"})
		return
	}

	file, err := fileHeader.Open()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to open file"})
		return
	}
	defer file.Close()

	content, err := io.ReadAll(io.LimitReader(file, maxFileSize+1))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to read file"})
		return
	}
	if int64(len(content)) > maxFileSize {
		c.JSON(http.StatusBadRequest, gin.H{"error": "file too large"})
		return
	}

	questionType := strings.TrimSpace(c.PostForm("question_type"))
	title := strings.TrimSpace(c.PostForm("title"))
	topic := strings.TrimSpace(c.PostForm("topic"))
	subject := strings.TrimSpace(c.PostForm("subject"))
	classLevel := strings.TrimSpace(c.PostForm("class_level"))
	difficulty := strings.TrimSpace(c.PostForm("difficulty"))
	contextText := strings.TrimSpace(c.PostForm("context"))
	numQuestions := 0
	if n := strings.TrimSpace(c.PostForm("num_questions")); n != "" {
		parsed, parseErr := strconv.Atoi(n)
		if parseErr != nil || parsed < 0 || parsed > 500 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "num_questions must be an integer between 0 and 500"})
			return
		}
		numQuestions = parsed
	}
	if title == "" {
		title = strings.TrimSuffix(fileHeader.Filename, filepath.Ext(fileHeader.Filename))
	}

	doc := &QuestionDocument{
		Title:        title,
		Topic:        topic,
		Subject:      subject,
		ClassLevel:   classLevel,
		QuestionType: questionType,
		Difficulty:   difficulty,
		NumQuestions: numQuestions,
		Context:      contextText,
		FileName:     fileHeader.Filename,
		FileSize:     fileHeader.Size,
		MimeType:     fileHeader.Header.Get("Content-Type"),
		Content:      content,
	}
	if schoolID := strings.TrimSpace(middleware.GetSchoolID(c)); schoolID != "" {
		doc.SchoolID = schoolID
	}

	if err := h.service.UploadQuestionDocument(c.Request.Context(), userID, doc); err != nil {
		if errors.Is(err, ErrTeacherNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "teacher_not_found"})
			return
		}
		if errors.Is(err, ErrInvalidQuestionType) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_question_type"})
			return
		}
		if errors.Is(err, ErrUnauthorizedUploadScope) {
			c.JSON(http.StatusForbidden, gin.H{"error": "unauthorized_class_subject_scope"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"document": doc})
}

// UploadStudyMaterial uploads a study material and stores it in R2.
// POST /api/v1/teacher/materials
func (h *Handler) UploadStudyMaterial(c *gin.Context) {
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

	fileHeader, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "file is required"})
		return
	}

	const maxFileSize int64 = 25 * 1024 * 1024 // 25MB
	if fileHeader.Size <= 0 || fileHeader.Size > maxFileSize {
		c.JSON(http.StatusBadRequest, gin.H{"error": "file size must be between 1B and 25MB"})
		return
	}

	ext := strings.ToLower(filepath.Ext(fileHeader.Filename))
	allowedExt := map[string]struct{}{
		".pdf":  {},
		".doc":  {},
		".docx": {},
		".ppt":  {},
		".pptx": {},
		".txt":  {},
		".mp4":  {},
	}
	if _, ok := allowedExt[ext]; !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "unsupported file type"})
		return
	}

	file, err := fileHeader.Open()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to open file"})
		return
	}
	defer file.Close()

	content, err := io.ReadAll(io.LimitReader(file, maxFileSize+1))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to read file"})
		return
	}
	if int64(len(content)) > maxFileSize {
		c.JSON(http.StatusBadRequest, gin.H{"error": "file too large"})
		return
	}

	title := strings.TrimSpace(c.PostForm("title"))
	subject := strings.TrimSpace(c.PostForm("subject"))
	classLevel := strings.TrimSpace(c.PostForm("class_level"))
	description := strings.TrimSpace(c.PostForm("description"))
	if title == "" {
		title = strings.TrimSuffix(fileHeader.Filename, filepath.Ext(fileHeader.Filename))
	}

	doc := &StudyMaterial{
		Title:       title,
		Subject:     subject,
		ClassLevel:  classLevel,
		Description: description,
		FileName:    fileHeader.Filename,
		FileSize:    fileHeader.Size,
		MimeType:    fileHeader.Header.Get("Content-Type"),
		Content:     content,
	}
	if schoolID := strings.TrimSpace(middleware.GetSchoolID(c)); schoolID != "" {
		doc.SchoolID = schoolID
	}

	if err := h.service.UploadStudyMaterial(c.Request.Context(), userID, doc); err != nil {
		if errors.Is(err, ErrTeacherNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "teacher_not_found"})
			return
		}
		if errors.Is(err, ErrUnauthorizedUploadScope) {
			c.JSON(http.StatusForbidden, gin.H{"error": "unauthorized_class_subject_scope"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"material": doc})
}

// GetQuestionUploaderOptions returns teacher classes and allowed subjects for question uploads.
// GET /api/v1/teacher/question-uploader/options
func (h *Handler) GetQuestionUploaderOptions(c *gin.Context) {
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

	academicYear := strings.TrimSpace(c.Query("academic_year"))
	options, err := h.service.GetQuestionUploaderOptions(c.Request.Context(), userID, academicYear)
	if err != nil {
		if errors.Is(err, ErrTeacherNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "teacher_not_found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"options": options})
}

// ListStudyMaterials returns current teacher's uploaded study materials.
// GET /api/v1/teacher/materials
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
			c.JSON(http.StatusBadRequest, gin.H{"error": "page must be a positive integer"})
			return
		}
		page = parsed
	}

	pageSize := int64(20)
	if ps := strings.TrimSpace(c.Query("page_size")); ps != "" {
		parsed, parseErr := strconv.ParseInt(ps, 10, 64)
		if parseErr != nil || parsed < 1 || parsed > 100 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "page_size must be between 1 and 100"})
			return
		}
		pageSize = parsed
	}

	order := strings.ToLower(strings.TrimSpace(c.Query("order")))
	ascending := order == "asc"
	subject := strings.TrimSpace(c.Query("subject"))
	classLevel := strings.TrimSpace(c.Query("class_level"))
	search := strings.TrimSpace(c.Query("search"))

	docs, hasMore, err := h.service.ListStudyMaterialsPaged(c.Request.Context(), userID, page, pageSize, ascending, subject, classLevel, search)
	if err != nil {
		if errors.Is(err, ErrTeacherNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "teacher_not_found"})
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

// ViewStudyMaterial streams a teacher-owned study material for browser viewing.
// GET /api/v1/teacher/materials/:id/view
func (h *Handler) ViewStudyMaterial(c *gin.Context) {
	h.serveStudyMaterial(c, true)
}

// DownloadStudyMaterial streams a teacher-owned study material as attachment.
// GET /api/v1/teacher/materials/:id/download
func (h *Handler) DownloadStudyMaterial(c *gin.Context) {
	h.serveStudyMaterial(c, false)
}

// DeleteStudyMaterial deletes a teacher-owned material.
// DELETE /api/v1/teacher/materials/:id
func (h *Handler) DeleteStudyMaterial(c *gin.Context) {
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
	if strings.HasPrefix(materialID, "sa:") {
		c.JSON(http.StatusForbidden, gin.H{"error": "cannot_delete_global_material"})
		return
	}

	if err := h.service.DeleteStudyMaterialByID(c.Request.Context(), userID, materialID); err != nil {
		if errors.Is(err, ErrTeacherNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "teacher_not_found"})
			return
		}
		if errors.Is(err, ErrStudyMaterialNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "study_material_not_found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.Status(http.StatusNoContent)
}

// ListQuestionDocuments returns current teacher's uploaded question documents.
// GET /api/v1/teacher/question-documents
func (h *Handler) ListQuestionDocuments(c *gin.Context) {
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
			c.JSON(http.StatusBadRequest, gin.H{"error": "page must be a positive integer"})
			return
		}
		page = parsed
	}

	pageSize := int64(50)
	if ps := strings.TrimSpace(c.Query("page_size")); ps != "" {
		parsed, parseErr := strconv.ParseInt(ps, 10, 64)
		if parseErr != nil || parsed < 1 || parsed > 100 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "page_size must be between 1 and 100"})
			return
		}
		pageSize = parsed
	}

	order := strings.ToLower(strings.TrimSpace(c.Query("order")))
	ascending := order == "asc"
	subject := strings.TrimSpace(c.Query("subject"))
	classLevel := strings.TrimSpace(c.Query("class_level"))
	search := strings.TrimSpace(c.Query("search"))

	docs, hasMore, err := h.service.ListQuestionDocumentsPaged(c.Request.Context(), userID, page, pageSize, ascending, subject, classLevel, search)
	if err != nil {
		if errors.Is(err, ErrTeacherNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "teacher_not_found"})
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
		"documents": docs,
		"page":      page,
		"page_size": pageSize,
		"has_more":  hasMore,
		"next_page": nextPage,
		"order":     map[bool]string{true: "asc", false: "desc"}[ascending],
	})
}

// GetQuestionDocumentFilters returns distinct subject/class filters for current teacher documents.
// GET /api/v1/teacher/question-documents/filters
func (h *Handler) GetQuestionDocumentFilters(c *gin.Context) {
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

	subjects, classes, hasUnspecifiedSubject, hasUnspecifiedClass, err := h.service.GetQuestionDocumentFilterValues(c.Request.Context(), userID)
	if err != nil {
		if errors.Is(err, ErrTeacherNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "teacher_not_found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"subjects":                subjects,
		"classes":                 classes,
		"has_unspecified_subject": hasUnspecifiedSubject,
		"has_unspecified_class":   hasUnspecifiedClass,
	})
}

// ViewQuestionDocument streams a teacher-owned question document for browser viewing.
// GET /api/v1/teacher/question-documents/:id/view
func (h *Handler) ViewQuestionDocument(c *gin.Context) {
	h.serveQuestionDocument(c, true)
}

// DownloadQuestionDocument streams a teacher-owned question document as attachment.
// GET /api/v1/teacher/question-documents/:id/download
func (h *Handler) DownloadQuestionDocument(c *gin.Context) {
	h.serveQuestionDocument(c, false)
}

// GetClassMessageGroups returns class groups available to current teacher (CI or subject teacher).
// GET /api/v1/teacher/messages/class-groups
func (h *Handler) GetClassMessageGroups(c *gin.Context) {
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

	academicYear := strings.TrimSpace(c.Query("academic_year"))
	groups, err := h.service.ListClassMessageGroups(c.Request.Context(), userID, academicYear)
	if err != nil {
		if errors.Is(err, ErrTeacherNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "teacher_not_found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"groups": groups})
}

// GetClassGroupMessages returns paged messages for a class group.
// GET /api/v1/teacher/messages/class-groups/:classId/messages
func (h *Handler) GetClassGroupMessages(c *gin.Context) {
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

	classID, err := uuid.Parse(strings.TrimSpace(c.Param("classId")))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid class id"})
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

	items, hasMore, err := h.service.ListClassGroupMessages(c.Request.Context(), userID, classID, page, pageSize)
	if err != nil {
		if errors.Is(err, ErrTeacherNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "teacher_not_found"})
			return
		}
		if errors.Is(err, ErrInvalidClass) {
			c.JSON(http.StatusForbidden, gin.H{"error": "forbidden_class"})
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
		"messages":  items,
		"page":      page,
		"page_size": pageSize,
		"has_more":  hasMore,
		"next_page": nextPage,
	})
}

// SendClassGroupMessage posts a message to a class group.
// POST /api/v1/teacher/messages/class-groups/:classId/messages
func (h *Handler) SendClassGroupMessage(c *gin.Context) {
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

	classID, err := uuid.Parse(strings.TrimSpace(c.Param("classId")))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid class id"})
		return
	}

	var req SendClassGroupMessageRequest
	if err := strictBindJSON(c, &req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request payload"})
		return
	}

	msg, err := h.service.SendClassGroupMessage(c.Request.Context(), userID, classID, req.Content)
	if err != nil {
		if errors.Is(err, ErrTeacherNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "teacher_not_found"})
			return
		}
		if errors.Is(err, ErrInvalidClass) {
			c.JSON(http.StatusForbidden, gin.H{"error": "forbidden_class"})
			return
		}
		if errors.Is(err, ErrEmptyMessageContent) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "empty_message"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Broadcast the new message to every WS subscriber in this class room.
	h.hub.Broadcast(classID, msg)

	c.JSON(http.StatusCreated, gin.H{"message": msg})
}

// HandleClassGroupWS upgrades the connection to WebSocket and streams incoming
// class-group messages for a single class in real time.
//
// Auth: JWT passed as ?token=... query param (browser WS cannot set headers).
// The token is validated inline — no middleware required.
//
// GET /api/v1/teacher/ws?class_id=CLASS_UUID&token=JWT
func (h *Handler) HandleClassGroupWS(c *gin.Context) {
	// ── 1. Authenticate via query-param token ─────────────────────────────────
	tokenStr := strings.TrimSpace(c.Query("ticket"))
	isScopedTicket := tokenStr != ""
	if tokenStr == "" {
		tokenStr = strings.TrimSpace(c.Query("token"))
	}
	if tokenStr == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "missing token"})
		return
	}

	claims, err := h.validateLiveToken(c.Request.Context(), tokenStr)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid token"})
		return
	}

	// Only teachers (and admins acting as teachers) may subscribe.
	role := claims.Role
	if role != "teacher" && role != "admin" && role != "super_admin" {
		c.JSON(http.StatusForbidden, gin.H{"error": "forbidden"})
		return
	}

	// ── 2. Parse class_id ─────────────────────────────────────────────────────
	classIDStr := strings.TrimSpace(c.Query("class_id"))
	if classIDStr == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "class_id required"})
		return
	}
	classID, err := uuid.Parse(classIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid class_id"})
		return
	}
	if isScopedTicket {
		if claims.WSScope != "teacher_messages" {
			c.JSON(http.StatusForbidden, gin.H{"error": "invalid_ws_scope"})
			return
		}
		if claims.ClassID != "" && claims.ClassID != classID.String() {
			c.JSON(http.StatusForbidden, gin.H{"error": "invalid_class_scope"})
			return
		}
	}

	// ── 3. Upgrade to WebSocket ───────────────────────────────────────────────
	if !websocket.IsWebSocketUpgrade(c.Request) {
		c.Header("Connection", "Upgrade")
		c.Header("Upgrade", "websocket")
		c.JSON(http.StatusUpgradeRequired, gin.H{"error": "websocket_upgrade_required"})
		return
	}
	conn, err := h.upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		log.Printf("[teacherWS] upgrade error: %v", err)
		return
	}
	defer conn.Close()

	// ── 4. Subscribe to hub ───────────────────────────────────────────────────
	client := h.hub.subscribe(classID)
	defer h.hub.unsubscribe(client)

	log.Printf("[teacherWS] user=%s subscribed to class=%s (total=%d)",
		claims.UserID, classID, h.hub.Subscribers(classID))

	// ── 5. Write-pump goroutine ───────────────────────────────────────────────
	// Forwards hub messages to the WS connection.
	done := make(chan struct{})
	go func() {
		defer close(done)
		for msg := range client.send {
			if err := conn.WriteJSON(msg); err != nil {
				log.Printf("[teacherWS] write error: %v", err)
				return
			}
		}
	}()

	if h.sessionValidator != nil {
		go func() {
			ticker := time.NewTicker(30 * time.Second)
			defer ticker.Stop()
			for {
				select {
				case <-done:
					return
				case <-ticker.C:
					if err := h.sessionValidator(context.Background(), claims); err != nil {
						_ = conn.WriteControl(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.ClosePolicyViolation, "session_revoked"), time.Now().Add(5*time.Second))
						_ = conn.Close()
						return
					}
					_ = conn.WriteControl(websocket.PingMessage, []byte("ping"), time.Now().Add(5*time.Second))
				}
			}
		}()
	}

	// ── 6. Read-pump (main goroutine) ─────────────────────────────────────────
	// We only need to handle ping/pong and detect disconnects here.
	// Teachers send messages via the REST POST endpoint, not via WS.
	conn.SetReadLimit(512)
	conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	conn.SetPongHandler(func(string) error {
		conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		return nil
	})

	for {
		_, _, err := conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("[teacherWS] unexpected close: %v", err)
			}
			break
		}
	}

	// Signal the write-pump to stop and wait.
	h.hub.unsubscribe(client)
	<-done
	log.Printf("[teacherWS] user=%s disconnected from class=%s", claims.UserID, classID)
}

// ListAdminQuestionDocuments returns school-scoped question documents for admins.
// GET /api/v1/admin/question-documents
func (h *Handler) ListAdminQuestionDocuments(c *gin.Context) {
	schoolID := strings.TrimSpace(middleware.GetSchoolID(c))
	if schoolID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "school_id missing from context"})
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

	pageSize := int64(20)
	if ps := strings.TrimSpace(c.Query("page_size")); ps != "" {
		parsed, parseErr := strconv.ParseInt(ps, 10, 64)
		if parseErr != nil || parsed < 1 || parsed > 100 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "page_size must be between 1 and 100"})
			return
		}
		pageSize = parsed
	}

	order := strings.ToLower(strings.TrimSpace(c.Query("order")))
	ascending := order == "asc"

	docs, hasMore, err := h.service.ListQuestionDocumentsBySchoolPaged(c.Request.Context(), schoolID, page, pageSize, ascending)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	nextPage := int64(0)
	if hasMore {
		nextPage = page + 1
	}
	c.JSON(http.StatusOK, gin.H{
		"documents": docs,
		"page":      page,
		"page_size": pageSize,
		"has_more":  hasMore,
		"next_page": nextPage,
		"order":     map[bool]string{true: "asc", false: "desc"}[ascending],
	})
}

// ViewAdminQuestionDocument streams a school-scoped question document for browser viewing.
// GET /api/v1/admin/question-documents/:id/view
func (h *Handler) ViewAdminQuestionDocument(c *gin.Context) {
	h.serveAdminQuestionDocument(c, true)
}

// DownloadAdminQuestionDocument streams a school-scoped question document as attachment.
// GET /api/v1/admin/question-documents/:id/download
func (h *Handler) DownloadAdminQuestionDocument(c *gin.Context) {
	h.serveAdminQuestionDocument(c, false)
}

func (h *Handler) serveAdminQuestionDocument(c *gin.Context, inline bool) {
	schoolID := strings.TrimSpace(middleware.GetSchoolID(c))
	if schoolID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "school_id missing from context"})
		return
	}

	documentID := strings.TrimSpace(c.Param("id"))
	if documentID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "document id is required"})
		return
	}

	doc, err := h.service.GetQuestionDocumentBySchoolAndID(c.Request.Context(), schoolID, documentID)
	if err != nil {
		if errors.Is(err, ErrQuestionDocNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "question_document_not_found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	servePrivateFile(c, inline, doc.MimeType, doc.FileName, doc.Content)
}

func (h *Handler) serveQuestionDocument(c *gin.Context, inline bool) {
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

	doc, err := h.service.GetQuestionDocumentByID(c.Request.Context(), userID, documentID)
	if err != nil {
		if errors.Is(err, ErrTeacherNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "teacher_not_found"})
			return
		}
		if errors.Is(err, ErrQuestionDocNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "question_document_not_found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	servePrivateFile(c, inline, doc.MimeType, doc.FileName, doc.Content)
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
		if errors.Is(err, ErrTeacherNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "teacher_not_found"})
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

// ─── Student Individual Reports ───────────────────────────────────────────────

// UploadStudentIndividualReport uploads a report document for a specific student.
// POST /api/v1/teacher/student-reports
func (h *Handler) UploadStudentIndividualReport(c *gin.Context) {
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

	fileHeader, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "file is required"})
		return
	}
	const maxFileSize int64 = 25 * 1024 * 1024 // 25 MB
	if fileHeader.Size <= 0 || fileHeader.Size > maxFileSize {
		c.JSON(http.StatusBadRequest, gin.H{"error": "file size must be between 1 B and 25 MB"})
		return
	}
	ext := strings.ToLower(filepath.Ext(fileHeader.Filename))
	allowedExt := map[string]struct{}{".pdf": {}, ".doc": {}, ".docx": {}, ".ppt": {}, ".pptx": {}, ".txt": {}}
	if _, ok := allowedExt[ext]; !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "unsupported file type; allowed: pdf, doc, docx, ppt, pptx, txt"})
		return
	}
	file, err := fileHeader.Open()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to open file"})
		return
	}
	defer file.Close()
	content, err := io.ReadAll(io.LimitReader(file, maxFileSize+1))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to read file"})
		return
	}
	if int64(len(content)) > maxFileSize {
		c.JSON(http.StatusBadRequest, gin.H{"error": "file too large"})
		return
	}

	classID := strings.TrimSpace(c.PostForm("class_id"))
	studentID := strings.TrimSpace(c.PostForm("student_id"))
	if classID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "class_id is required"})
		return
	}
	if studentID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "student_id is required"})
		return
	}
	title := strings.TrimSpace(c.PostForm("title"))
	if title == "" {
		title = strings.TrimSuffix(fileHeader.Filename, filepath.Ext(fileHeader.Filename))
	}

	doc := &StudentIndividualReport{
		ClassID:      classID,
		StudentID:    studentID,
		StudentName:  strings.TrimSpace(c.PostForm("student_name")),
		Title:        title,
		ReportType:   strings.TrimSpace(c.PostForm("report_type")),
		AcademicYear: strings.TrimSpace(c.PostForm("academic_year")),
		Description:  strings.TrimSpace(c.PostForm("description")),
		FileName:     fileHeader.Filename,
		FileSize:     fileHeader.Size,
		MimeType:     fileHeader.Header.Get("Content-Type"),
		Content:      content,
	}
	if schoolID := strings.TrimSpace(middleware.GetSchoolID(c)); schoolID != "" {
		doc.SchoolID = schoolID
	}

	if err := h.service.UploadStudentIndividualReport(c.Request.Context(), userID, doc); err != nil {
		if errors.Is(err, ErrTeacherNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "teacher_not_found"})
			return
		}
		if errors.Is(err, ErrNotAuthorized) {
			c.JSON(http.StatusForbidden, gin.H{"error": "not_authorized_for_class"})
			return
		}
		if err.Error() == "student_not_in_class" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "student_not_in_class"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"report": doc})
}

// ListStudentIndividualReports returns paged student-specific reports uploaded by this teacher.
// GET /api/v1/teacher/student-reports
func (h *Handler) ListStudentIndividualReports(c *gin.Context) {
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
		if parseErr != nil || parsed < 1 || parsed > 100 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "page_size must be between 1 and 100"})
			return
		}
		pageSize = parsed
	}
	ascending := strings.ToLower(strings.TrimSpace(c.Query("order"))) == "asc"
	classID := strings.TrimSpace(c.Query("class_id"))
	studentID := strings.TrimSpace(c.Query("student_id"))
	academicYear := strings.TrimSpace(c.Query("academic_year"))

	docs, hasMore, err := h.service.ListStudentIndividualReportsPaged(c.Request.Context(), userID, page, pageSize, ascending, classID, studentID, academicYear)
	if err != nil {
		if errors.Is(err, ErrTeacherNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "teacher_not_found"})
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
	})
}

// ViewStudentIndividualReport streams a student-specific report for inline viewing.
// GET /api/v1/teacher/student-reports/:id/view
func (h *Handler) ViewStudentIndividualReport(c *gin.Context) {
	h.serveStudentIndividualReport(c, true)
}

// DownloadStudentIndividualReport streams a student-specific report as attachment.
// GET /api/v1/teacher/student-reports/:id/download
func (h *Handler) DownloadStudentIndividualReport(c *gin.Context) {
	h.serveStudentIndividualReport(c, false)
}

func (h *Handler) serveStudentIndividualReport(c *gin.Context, inline bool) {
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
	reportID := strings.TrimSpace(c.Param("id"))
	if reportID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "report id is required"})
		return
	}
	doc, err := h.service.GetStudentIndividualReportByID(c.Request.Context(), userID, reportID)
	if err != nil {
		if errors.Is(err, ErrTeacherNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "teacher_not_found"})
			return
		}
		if errors.Is(err, ErrReportDocNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "report_not_found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	servePrivateFile(c, inline, doc.MimeType, doc.FileName, doc.Content)
}

// UploadSuperAdminQuestionDocument uploads a question document and stores it for the super admin owner.
// POST /api/v1/super-admin/question-documents
func (h *Handler) UploadSuperAdminQuestionDocument(c *gin.Context) {
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

	fileHeader, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "file is required"})
		return
	}

	const maxFileSize int64 = 10 * 1024 * 1024 // 10MB
	if fileHeader.Size <= 0 || fileHeader.Size > maxFileSize {
		c.JSON(http.StatusBadRequest, gin.H{"error": "file size must be between 1B and 10MB"})
		return
	}

	ext := strings.ToLower(filepath.Ext(fileHeader.Filename))
	if ext != ".pdf" && ext != ".doc" && ext != ".docx" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "only .pdf, .doc, .docx files are allowed"})
		return
	}

	file, err := fileHeader.Open()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to open file"})
		return
	}
	defer file.Close()

	content, err := io.ReadAll(io.LimitReader(file, maxFileSize+1))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to read file"})
		return
	}
	if int64(len(content)) > maxFileSize {
		c.JSON(http.StatusBadRequest, gin.H{"error": "file too large"})
		return
	}

	questionType := strings.TrimSpace(c.PostForm("question_type"))
	title := strings.TrimSpace(c.PostForm("title"))
	subject := strings.TrimSpace(c.PostForm("subject"))
	classLevel := strings.TrimSpace(c.PostForm("class_level"))
	difficulty := strings.TrimSpace(c.PostForm("difficulty"))
	contextText := strings.TrimSpace(c.PostForm("context"))
	if title == "" {
		title = strings.TrimSuffix(fileHeader.Filename, filepath.Ext(fileHeader.Filename))
	}

	doc := &QuestionDocument{
		Title:        title,
		Subject:      subject,
		ClassLevel:   classLevel,
		QuestionType: questionType,
		Difficulty:   difficulty,
		Context:      contextText,
		FileName:     fileHeader.Filename,
		FileSize:     fileHeader.Size,
		MimeType:     fileHeader.Header.Get("Content-Type"),
		Content:      content,
	}

	ownerEmail, _ := c.Get("email")
	ownerEmailStr, _ := ownerEmail.(string)

	if err := h.service.UploadSuperAdminQuestionDocument(c.Request.Context(), userID, ownerEmailStr, doc); err != nil {
		if errors.Is(err, ErrInvalidQuestionType) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_question_type"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"document": doc})
}

// ListSuperAdminQuestionDocuments returns all super-admin uploaded question documents (cross-SA visibility).
// GET /api/v1/super-admin/question-documents
func (h *Handler) ListSuperAdminQuestionDocuments(c *gin.Context) {
	if middleware.GetUserID(c) == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
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

	pageSize := int64(20)
	if ps := strings.TrimSpace(c.Query("page_size")); ps != "" {
		parsed, parseErr := strconv.ParseInt(ps, 10, 64)
		if parseErr != nil || parsed < 1 || parsed > 100 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "page_size must be between 1 and 100"})
			return
		}
		pageSize = parsed
	}

	order := strings.ToLower(strings.TrimSpace(c.Query("order")))
	ascending := order == "asc"

	docs, hasMore, err := h.service.ListSuperAdminQuestionDocumentsPaged(c.Request.Context(), page, pageSize, ascending)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	nextPage := int64(0)
	if hasMore {
		nextPage = page + 1
	}
	c.JSON(http.StatusOK, gin.H{
		"documents": docs,
		"page":      page,
		"page_size": pageSize,
		"has_more":  hasMore,
		"next_page": nextPage,
		"order":     map[bool]string{true: "asc", false: "desc"}[ascending],
	})
}

// ViewSuperAdminQuestionDocument streams a super-admin-owned question document for browser viewing.
// GET /api/v1/super-admin/question-documents/:id/view
func (h *Handler) ViewSuperAdminQuestionDocument(c *gin.Context) {
	h.serveSuperAdminQuestionDocument(c, true)
}

// DownloadSuperAdminQuestionDocument streams a super-admin-owned question document as attachment.
// GET /api/v1/super-admin/question-documents/:id/download
func (h *Handler) DownloadSuperAdminQuestionDocument(c *gin.Context) {
	h.serveSuperAdminQuestionDocument(c, false)
}

// UploadSuperAdminStudyMaterial uploads a study material and stores it for the super admin owner.
// POST /api/v1/super-admin/materials
func (h *Handler) UploadSuperAdminStudyMaterial(c *gin.Context) {
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

	fileHeader, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "file is required"})
		return
	}

	const maxFileSize int64 = 25 * 1024 * 1024 // 25MB
	if fileHeader.Size <= 0 || fileHeader.Size > maxFileSize {
		c.JSON(http.StatusBadRequest, gin.H{"error": "file size must be between 1B and 25MB"})
		return
	}

	ext := strings.ToLower(filepath.Ext(fileHeader.Filename))
	allowedExt := map[string]struct{}{
		".pdf":  {},
		".doc":  {},
		".docx": {},
		".ppt":  {},
		".pptx": {},
		".txt":  {},
		".mp4":  {},
	}
	if _, ok := allowedExt[ext]; !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "unsupported file type"})
		return
	}

	file, err := fileHeader.Open()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to open file"})
		return
	}
	defer file.Close()

	content, err := io.ReadAll(io.LimitReader(file, maxFileSize+1))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to read file"})
		return
	}
	if int64(len(content)) > maxFileSize {
		c.JSON(http.StatusBadRequest, gin.H{"error": "file too large"})
		return
	}

	title := strings.TrimSpace(c.PostForm("title"))
	subject := strings.TrimSpace(c.PostForm("subject"))
	classLevel := strings.TrimSpace(c.PostForm("class_level"))
	description := strings.TrimSpace(c.PostForm("description"))
	if title == "" {
		title = strings.TrimSuffix(fileHeader.Filename, filepath.Ext(fileHeader.Filename))
	}

	doc := &StudyMaterial{
		Title:        title,
		Subject:      subject,
		ClassLevel:   classLevel,
		Description:  description,
		FileName:     fileHeader.Filename,
		FileSize:     fileHeader.Size,
		MimeType:     fileHeader.Header.Get("Content-Type"),
		Content:      content,
		UploaderName: "Super Admin",
	}

	if err := h.service.UploadSuperAdminStudyMaterial(c.Request.Context(), userID, doc); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"material": doc})
}

// ListSuperAdminStudyMaterials returns current super admin's uploaded study materials.
// GET /api/v1/super-admin/materials
func (h *Handler) ListSuperAdminStudyMaterials(c *gin.Context) {
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
			c.JSON(http.StatusBadRequest, gin.H{"error": "page must be a positive integer"})
			return
		}
		page = parsed
	}

	pageSize := int64(20)
	if ps := strings.TrimSpace(c.Query("page_size")); ps != "" {
		parsed, parseErr := strconv.ParseInt(ps, 10, 64)
		if parseErr != nil || parsed < 1 || parsed > 100 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "page_size must be between 1 and 100"})
			return
		}
		pageSize = parsed
	}

	order := strings.ToLower(strings.TrimSpace(c.Query("order")))
	ascending := order == "asc"
	subject := strings.TrimSpace(c.Query("subject"))
	classLevel := strings.TrimSpace(c.Query("class_level"))
	search := strings.TrimSpace(c.Query("search"))

	docs, hasMore, err := h.service.ListSuperAdminStudyMaterialsPaged(c.Request.Context(), userID, page, pageSize, ascending, subject, classLevel, search)
	if err != nil {
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

// ViewSuperAdminStudyMaterial streams a super-admin-owned study material for browser viewing.
// GET /api/v1/super-admin/materials/:id/view
func (h *Handler) ViewSuperAdminStudyMaterial(c *gin.Context) {
	h.serveSuperAdminStudyMaterial(c, true)
}

// DownloadSuperAdminStudyMaterial streams a super-admin-owned study material as attachment.
// GET /api/v1/super-admin/materials/:id/download
func (h *Handler) DownloadSuperAdminStudyMaterial(c *gin.Context) {
	h.serveSuperAdminStudyMaterial(c, false)
}

// DeleteSuperAdminStudyMaterial deletes a super-admin-owned material.
// DELETE /api/v1/super-admin/materials/:id
func (h *Handler) DeleteSuperAdminStudyMaterial(c *gin.Context) {
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

	if err := h.service.DeleteSuperAdminStudyMaterialByID(c.Request.Context(), userID, materialID); err != nil {
		if errors.Is(err, ErrStudyMaterialNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "study_material_not_found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *Handler) serveSuperAdminQuestionDocument(c *gin.Context, inline bool) {
	if middleware.GetUserID(c) == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	documentID := strings.TrimSpace(c.Param("id"))
	if documentID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "document id is required"})
		return
	}

	doc, err := h.service.GetSuperAdminQuestionDocumentByID(c.Request.Context(), documentID)
	if err != nil {
		if errors.Is(err, ErrQuestionDocNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "question_document_not_found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	servePrivateFile(c, inline, doc.MimeType, doc.FileName, doc.Content)
}

// DeleteSuperAdminQuestionDocument deletes a super-admin question document by ID. Any super admin may delete.
// DELETE /api/v1/super-admin/question-documents/:id
func (h *Handler) DeleteSuperAdminQuestionDocument(c *gin.Context) {
	if middleware.GetUserID(c) == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	documentID := strings.TrimSpace(c.Param("id"))
	if documentID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "document id is required"})
		return
	}
	if err := h.service.DeleteSuperAdminQuestionDocumentByID(c.Request.Context(), documentID); err != nil {
		if errors.Is(err, ErrQuestionDocNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "question_document_not_found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "document deleted"})
}

func (h *Handler) serveSuperAdminStudyMaterial(c *gin.Context, inline bool) {
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

	doc, err := h.service.GetSuperAdminStudyMaterialByID(c.Request.Context(), userID, materialID)
	if err != nil {
		if errors.Is(err, ErrStudyMaterialNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "study_material_not_found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	servePrivateFile(c, inline, doc.MimeType, doc.FileName, doc.Content)
}

// CreateHomework creates a new homework assignment
// POST /api/v1/teacher/homework
func (h *Handler) CreateHomework(c *gin.Context) {
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

	var req CreateHomeworkRequest
	attachments := make([]HomeworkAttachmentUpload, 0)
	contentType := strings.ToLower(strings.TrimSpace(c.ContentType()))

	if strings.HasPrefix(contentType, "multipart/form-data") {
		req.Title = strings.TrimSpace(c.PostForm("title"))
		req.Description = strings.TrimSpace(c.PostForm("description"))
		req.ClassID = strings.TrimSpace(c.PostForm("class_id"))
		req.SubjectID = strings.TrimSpace(c.PostForm("subject_id"))
		req.DueDate = strings.TrimSpace(c.PostForm("due_date"))
		req.MaxMarks = 100
		if raw := strings.TrimSpace(c.PostForm("max_marks")); raw != "" {
			parsed, parseErr := strconv.Atoi(raw)
			if parseErr != nil || parsed < 0 || parsed > 1000 {
				c.JSON(http.StatusBadRequest, gin.H{"error": "max_marks must be between 0 and 1000"})
				return
			}
			req.MaxMarks = parsed
		}

		attachments, err = parseHomeworkAttachments(c, true)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
	} else {
		c.JSON(http.StatusBadRequest, gin.H{"error": "attachments are required; submit multipart/form-data"})
		return
	}

	schoolID := strings.TrimSpace(middleware.GetSchoolID(c))
	homeworkID, err := h.service.CreateHomework(c.Request.Context(), userID, schoolID, &req, attachments)
	if err != nil {
		if errors.Is(err, ErrTeacherNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "teacher_not_found"})
			return
		}
		if errors.Is(err, ErrUnauthorizedUploadScope) {
			c.JSON(http.StatusForbidden, gin.H{"error": "unauthorized_class_subject_scope"})
			return
		}
		if errors.Is(err, ErrInvalidInput) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"id": homeworkID, "message": "Homework created successfully"})
}

// GetQuizOptions returns class-subject options for teacher quiz scheduler.
// GET /api/v1/teacher/quizzes/options
func (h *Handler) GetQuizOptions(c *gin.Context) {
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
	academicYear := strings.TrimSpace(c.Query("academic_year"))
	options, err := h.service.GetQuizOptions(c.Request.Context(), userID, academicYear)
	if err != nil {
		if errors.Is(err, ErrTeacherNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "teacher_not_found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"options": options})
}

// ListQuizChapters lists teacher-managed chapters for quiz creation.
// GET /api/v1/teacher/quizzes/chapters
func (h *Handler) ListQuizChapters(c *gin.Context) {
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

	classID := strings.TrimSpace(c.Query("class_id"))
	subjectID := strings.TrimSpace(c.Query("subject_id"))
	includePlatform := strings.EqualFold(strings.TrimSpace(c.Query("include_platform")), "true") || strings.TrimSpace(c.Query("include_platform")) == "1"

	items, err := h.service.ListQuizChapters(c.Request.Context(), userID, classID, subjectID, includePlatform)
	if err != nil {
		if errors.Is(err, ErrTeacherNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "teacher_not_found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"chapters": items})
}

// ListSuperAdminQuizChapters lists super-admin managed platform chapters.
// GET /api/v1/super-admin/quizzes/chapters
func (h *Handler) ListSuperAdminQuizChapters(c *gin.Context) {
	userIDStr := middleware.GetUserID(c)
	if userIDStr == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	superAdminID, err := uuid.Parse(userIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user ID"})
		return
	}

	classID := strings.TrimSpace(c.Query("class_id"))
	subjectID := strings.TrimSpace(c.Query("subject_id"))

	items, err := h.service.ListSuperAdminQuizChapters(c.Request.Context(), superAdminID, classID, subjectID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"chapters": items})
}

// CreateSuperAdminQuizChapter creates or upserts a platform chapter under class+subject scope.
// POST /api/v1/super-admin/quizzes/chapters
func (h *Handler) CreateSuperAdminQuizChapter(c *gin.Context) {
	userIDStr := middleware.GetUserID(c)
	if userIDStr == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	superAdminID, err := uuid.Parse(userIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user ID"})
		return
	}

	var req CreateQuizChapterRequest
	if err := strictBindJSON(c, &req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	item, err := h.service.CreateSuperAdminQuizChapter(c.Request.Context(), superAdminID, &req)
	if err != nil {
		if errors.Is(err, ErrInvalidQuizPayload) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_quiz_payload"})
			return
		}
		if errors.Is(err, ErrUnauthorizedUploadScope) {
			c.JSON(http.StatusForbidden, gin.H{"error": "unauthorized_class_subject_scope"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"chapter": item})
}

// UpdateSuperAdminQuizChapter renames an existing platform chapter.
// PUT /api/v1/super-admin/quizzes/chapters/:id
func (h *Handler) UpdateSuperAdminQuizChapter(c *gin.Context) {
	userIDStr := middleware.GetUserID(c)
	if userIDStr == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	superAdminID, err := uuid.Parse(userIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user ID"})
		return
	}

	chapterID := strings.TrimSpace(c.Param("id"))
	if chapterID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "chapter id is required"})
		return
	}

	var req UpdateQuizChapterRequest
	if err := strictBindJSON(c, &req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	item, err := h.service.UpdateSuperAdminQuizChapter(c.Request.Context(), superAdminID, chapterID, &req)
	if err != nil {
		if errors.Is(err, ErrInvalidQuizPayload) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_quiz_payload"})
			return
		}
		if errors.Is(err, ErrQuizChapterNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "quiz_chapter_not_found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"chapter": item})
}

// DeleteSuperAdminQuizChapter deletes a platform chapter.
// DELETE /api/v1/super-admin/quizzes/chapters/:id
func (h *Handler) DeleteSuperAdminQuizChapter(c *gin.Context) {
	userIDStr := middleware.GetUserID(c)
	if userIDStr == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	superAdminID, err := uuid.Parse(userIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user ID"})
		return
	}

	chapterID := strings.TrimSpace(c.Param("id"))
	if chapterID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "chapter id is required"})
		return
	}
	if err := h.service.DeleteSuperAdminQuizChapter(c.Request.Context(), superAdminID, chapterID); err != nil {
		if errors.Is(err, ErrInvalidQuizPayload) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_quiz_payload"})
			return
		}
		if errors.Is(err, ErrQuizChapterNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "quiz_chapter_not_found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.Status(http.StatusNoContent)
}

// CreateQuizChapter creates or upserts a teacher chapter under class+subject scope.
// POST /api/v1/teacher/quizzes/chapters
func (h *Handler) CreateQuizChapter(c *gin.Context) {
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

	var req CreateQuizChapterRequest
	if err := strictBindJSON(c, &req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	item, err := h.service.CreateQuizChapter(c.Request.Context(), userID, &req)
	if err != nil {
		if errors.Is(err, ErrTeacherNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "teacher_not_found"})
			return
		}
		if errors.Is(err, ErrInvalidQuizPayload) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_quiz_payload"})
			return
		}
		if errors.Is(err, ErrUnauthorizedUploadScope) {
			c.JSON(http.StatusForbidden, gin.H{"error": "unauthorized_class_subject_scope"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"chapter": item})
}

// UpdateQuizChapter renames an existing teacher chapter.
// PUT /api/v1/teacher/quizzes/chapters/:id
func (h *Handler) UpdateQuizChapter(c *gin.Context) {
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

	chapterID := strings.TrimSpace(c.Param("id"))
	if chapterID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "chapter id is required"})
		return
	}

	var req UpdateQuizChapterRequest
	if err := strictBindJSON(c, &req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	item, err := h.service.UpdateQuizChapter(c.Request.Context(), userID, chapterID, &req)
	if err != nil {
		if errors.Is(err, ErrTeacherNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "teacher_not_found"})
			return
		}
		if errors.Is(err, ErrInvalidQuizPayload) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_quiz_payload"})
			return
		}
		if errors.Is(err, ErrQuizChapterNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "quiz_chapter_not_found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"chapter": item})
}

// DeleteQuizChapter deletes a teacher chapter.
// DELETE /api/v1/teacher/quizzes/chapters/:id
func (h *Handler) DeleteQuizChapter(c *gin.Context) {
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

	chapterID := strings.TrimSpace(c.Param("id"))
	if chapterID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "chapter id is required"})
		return
	}
	if err := h.service.DeleteQuizChapter(c.Request.Context(), userID, chapterID); err != nil {
		if errors.Is(err, ErrTeacherNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "teacher_not_found"})
			return
		}
		if errors.Is(err, ErrInvalidQuizPayload) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_quiz_payload"})
			return
		}
		if errors.Is(err, ErrQuizChapterNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "quiz_chapter_not_found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.Status(http.StatusNoContent)
}

// ListQuizzes lists quizzes created by current teacher.
// GET /api/v1/teacher/quizzes
func (h *Handler) ListQuizzes(c *gin.Context) {
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
	if raw := strings.TrimSpace(c.Query("page")); raw != "" {
		parsed, parseErr := strconv.ParseInt(raw, 10, 64)
		if parseErr != nil || parsed < 1 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "page must be a positive integer"})
			return
		}
		page = parsed
	}
	pageSize := int64(20)
	if raw := strings.TrimSpace(c.Query("page_size")); raw != "" {
		parsed, parseErr := strconv.ParseInt(raw, 10, 64)
		if parseErr != nil || parsed < 1 || parsed > 100 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "page_size must be between 1 and 100"})
			return
		}
		pageSize = parsed
	}
	classID := strings.TrimSpace(c.Query("class_id"))
	subjectID := strings.TrimSpace(c.Query("subject_id"))
	search := strings.TrimSpace(c.Query("search"))

	items, hasMore, err := h.service.ListTeacherQuizzes(c.Request.Context(), userID, page, pageSize, classID, subjectID, search)
	if err != nil {
		if errors.Is(err, ErrTeacherNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "teacher_not_found"})
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
		"quizzes":   items,
		"page":      page,
		"page_size": pageSize,
		"has_more":  hasMore,
		"next_page": nextPage,
	})
}

// CreateQuiz creates a teacher quiz with MCQ questions/options.
// POST /api/v1/teacher/quizzes
func (h *Handler) CreateQuiz(c *gin.Context) {
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
	var req CreateQuizRequest
	if err := strictBindJSON(c, &req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	quizID, err := h.service.CreateQuiz(c.Request.Context(), userID, &req)
	if err != nil {
		if errors.Is(err, ErrTeacherNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "teacher_not_found"})
			return
		}
		if errors.Is(err, ErrInvalidQuizPayload) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_quiz_payload"})
			return
		}
		if errors.Is(err, ErrUnauthorizedUploadScope) {
			c.JSON(http.StatusForbidden, gin.H{"error": "unauthorized_class_subject_scope"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"id": quizID, "message": "Quiz created successfully"})
}

// GET /api/v1/teacher/quizzes/:id
func (h *Handler) GetQuizDetail(c *gin.Context) {
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
	quizID := c.Param("id")
	item, err := h.service.GetQuizDetail(c.Request.Context(), userID, quizID)
	if err != nil {
		if errors.Is(err, ErrTeacherNotFound) || errors.Is(err, ErrNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "not_found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, item)
}

// PUT /api/v1/teacher/quizzes/:id
func (h *Handler) UpdateQuiz(c *gin.Context) {
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
	quizID := c.Param("id")
	var req UpdateQuizRequest
	if err := strictBindJSON(c, &req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.service.UpdateQuiz(c.Request.Context(), userID, quizID, &req); err != nil {
		if errors.Is(err, ErrTeacherNotFound) || errors.Is(err, ErrNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "not_found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Quiz updated successfully"})
}

// DELETE /api/v1/teacher/quizzes/:id
func (h *Handler) DeleteQuiz(c *gin.Context) {
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
	quizID := c.Param("id")
	if err := h.service.DeleteQuiz(c.Request.Context(), userID, quizID); err != nil {
		if errors.Is(err, ErrTeacherNotFound) || errors.Is(err, ErrNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "not_found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Quiz deleted successfully"})
}

// POST /api/v1/teacher/quizzes/:id/questions
func (h *Handler) AddQuizQuestion(c *gin.Context) {
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
	quizID := c.Param("id")
	var req AddQuizQuestionRequest
	if err := strictBindJSON(c, &req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	questionID, err := h.service.AddQuizQuestion(c.Request.Context(), userID, quizID, &req)
	if err != nil {
		if errors.Is(err, ErrTeacherNotFound) || errors.Is(err, ErrNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "not_found"})
			return
		}
		if errors.Is(err, ErrInvalidQuizPayload) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_quiz_payload"})
			return
		}
		if errors.Is(err, ErrUnauthorizedUploadScope) {
			c.JSON(http.StatusForbidden, gin.H{"error": "unauthorized"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"id": questionID, "message": "Question added successfully"})
}

// GetSuperAdminQuizOptions returns class-subject options for super-admin quiz scheduler.
// GET /api/v1/super-admin/quizzes/options
func (h *Handler) GetSuperAdminQuizOptions(c *gin.Context) {
	userIDStr := middleware.GetUserID(c)
	if userIDStr == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	academicYear := strings.TrimSpace(c.Query("academic_year"))
	options, err := h.service.GetSuperAdminQuizOptions(c.Request.Context(), academicYear)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"options": options})
}

// ListSuperAdminQuizzes lists quizzes in the selected tenant for super admin.
// GET /api/v1/super-admin/quizzes
func (h *Handler) ListSuperAdminQuizzes(c *gin.Context) {
	userIDStr := middleware.GetUserID(c)
	if userIDStr == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	superAdminID, err := uuid.Parse(userIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user ID"})
		return
	}

	page := int64(1)
	if raw := strings.TrimSpace(c.Query("page")); raw != "" {
		parsed, parseErr := strconv.ParseInt(raw, 10, 64)
		if parseErr != nil || parsed < 1 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "page must be a positive integer"})
			return
		}
		page = parsed
	}
	pageSize := int64(20)
	if raw := strings.TrimSpace(c.Query("page_size")); raw != "" {
		parsed, parseErr := strconv.ParseInt(raw, 10, 64)
		if parseErr != nil || parsed < 1 || parsed > 100 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "page_size must be between 1 and 100"})
			return
		}
		pageSize = parsed
	}
	classID := strings.TrimSpace(c.Query("class_id"))
	subjectID := strings.TrimSpace(c.Query("subject_id"))
	search := strings.TrimSpace(c.Query("search"))

	items, hasMore, err := h.service.ListSuperAdminQuizzes(c.Request.Context(), superAdminID, page, pageSize, classID, subjectID, search)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	nextPage := int64(0)
	if hasMore {
		nextPage = page + 1
	}
	c.JSON(http.StatusOK, gin.H{
		"quizzes":   items,
		"page":      page,
		"page_size": pageSize,
		"has_more":  hasMore,
		"next_page": nextPage,
	})
}

// CreateQuizAsSuperAdmin creates a quiz in selected tenant using mapped teacher ownership.
// POST /api/v1/super-admin/quizzes
func (h *Handler) CreateQuizAsSuperAdmin(c *gin.Context) {
	userIDStr := middleware.GetUserID(c)
	if userIDStr == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	superAdminID, err := uuid.Parse(userIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user ID"})
		return
	}

	var req CreateQuizRequest
	if err := strictBindJSON(c, &req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	quizID, err := h.service.CreateQuizAsSuperAdmin(c.Request.Context(), superAdminID, &req)
	if err != nil {
		if errors.Is(err, ErrInvalidQuizPayload) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_quiz_payload"})
			return
		}
		if errors.Is(err, ErrUnauthorizedUploadScope) {
			c.JSON(http.StatusForbidden, gin.H{"error": "no_teacher_assignment_for_class_subject"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"id": quizID, "message": "Quiz created successfully"})
}

// GetQuizDetailForSuperAdmin gets quiz detail in selected tenant.
// GET /api/v1/super-admin/quizzes/:id
func (h *Handler) GetQuizDetailForSuperAdmin(c *gin.Context) {
	userIDStr := middleware.GetUserID(c)
	if userIDStr == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	superAdminID, err := uuid.Parse(userIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user ID"})
		return
	}

	quizID := c.Param("id")
	item, err := h.service.GetQuizDetailForSuperAdmin(c.Request.Context(), superAdminID, quizID)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "not_found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, item)
}

// UpdateQuizForSuperAdmin updates quiz details in selected tenant.
// PUT /api/v1/super-admin/quizzes/:id
func (h *Handler) UpdateQuizForSuperAdmin(c *gin.Context) {
	userIDStr := middleware.GetUserID(c)
	if userIDStr == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	superAdminID, err := uuid.Parse(userIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user ID"})
		return
	}

	quizID := c.Param("id")
	var req UpdateQuizRequest
	if err := strictBindJSON(c, &req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.service.UpdateQuizForSuperAdmin(c.Request.Context(), superAdminID, quizID, &req); err != nil {
		if errors.Is(err, ErrNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "not_found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Quiz updated successfully"})
}

// DeleteQuizForSuperAdmin deletes quiz in selected tenant.
// DELETE /api/v1/super-admin/quizzes/:id
func (h *Handler) DeleteQuizForSuperAdmin(c *gin.Context) {
	userIDStr := middleware.GetUserID(c)
	if userIDStr == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	superAdminID, err := uuid.Parse(userIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user ID"})
		return
	}

	quizID := c.Param("id")
	if err := h.service.DeleteQuizForSuperAdmin(c.Request.Context(), superAdminID, quizID); err != nil {
		if errors.Is(err, ErrNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "not_found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Quiz deleted successfully"})
}

// AddQuizQuestionForSuperAdmin adds question to quiz in selected tenant.
// POST /api/v1/super-admin/quizzes/:id/questions
func (h *Handler) AddQuizQuestionForSuperAdmin(c *gin.Context) {
	userIDStr := middleware.GetUserID(c)
	if userIDStr == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	superAdminID, err := uuid.Parse(userIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user ID"})
		return
	}

	quizID := c.Param("id")
	var req AddQuizQuestionRequest
	if err := strictBindJSON(c, &req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	questionID, err := h.service.AddQuizQuestionForSuperAdmin(c.Request.Context(), superAdminID, quizID, &req)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "not_found"})
			return
		}
		if errors.Is(err, ErrInvalidQuizPayload) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_quiz_payload"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"id": questionID, "message": "Question added successfully"})
}

// GetHomeworkOptions returns class-subject options allowed for teacher homework creation.
// GET /api/v1/teacher/homework/options
func (h *Handler) GetHomeworkOptions(c *gin.Context) {
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
	academicYear := strings.TrimSpace(c.Query("academic_year"))
	options, err := h.service.GetHomeworkOptions(c.Request.Context(), userID, academicYear)
	if err != nil {
		if errors.Is(err, ErrTeacherNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "teacher_not_found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"options": options})
}

// ListHomework lists teacher homework assignments.
// GET /api/v1/teacher/homework
func (h *Handler) ListHomework(c *gin.Context) {
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
	if raw := strings.TrimSpace(c.Query("page")); raw != "" {
		parsed, parseErr := strconv.ParseInt(raw, 10, 64)
		if parseErr != nil || parsed < 1 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "page must be a positive integer"})
			return
		}
		page = parsed
	}
	pageSize := int64(20)
	if raw := strings.TrimSpace(c.Query("page_size")); raw != "" {
		parsed, parseErr := strconv.ParseInt(raw, 10, 64)
		if parseErr != nil || parsed < 1 || parsed > 100 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "page_size must be between 1 and 100"})
			return
		}
		pageSize = parsed
	}
	classID := strings.TrimSpace(c.Query("class_id"))
	subjectID := strings.TrimSpace(c.Query("subject_id"))
	search := strings.TrimSpace(c.Query("search"))
	schoolID := strings.TrimSpace(middleware.GetSchoolID(c))

	items, hasMore, err := h.service.ListTeacherHomeworkPaged(c.Request.Context(), userID, page, pageSize, classID, subjectID, search, schoolID)
	if err != nil {
		if errors.Is(err, ErrTeacherNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "teacher_not_found"})
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
		"homework":  items,
		"page":      page,
		"page_size": pageSize,
		"has_more":  hasMore,
		"next_page": nextPage,
	})
}

// ViewHomeworkAttachment streams a homework attachment inline.
// GET /api/v1/teacher/homework/:id/attachments/:attachmentId/view
func (h *Handler) ViewHomeworkAttachment(c *gin.Context) {
	h.serveHomeworkAttachment(c, true)
}

// DownloadHomeworkAttachment downloads a homework attachment.
// GET /api/v1/teacher/homework/:id/attachments/:attachmentId/download
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
		c.JSON(http.StatusBadRequest, gin.H{"error": "homework and attachment id are required"})
		return
	}
	schoolID := strings.TrimSpace(middleware.GetSchoolID(c))
	meta, content, err := h.service.GetHomeworkAttachmentByID(c.Request.Context(), userID, schoolID, homeworkID, attachmentID)
	if err != nil {
		if errors.Is(err, ErrHomeworkNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "homework_or_attachment_not_found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	servePrivateFile(c, inline, meta.MimeType, meta.FileName, content)
}

// EnterGrade enters a grade for a student
// POST /api/v1/teacher/grades
func (h *Handler) EnterGrade(c *gin.Context) {
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

	var req EnterGradeRequest
	if err := strictBindJSON(c, &req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := h.service.EnterGrade(c.Request.Context(), userID, &req); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Grade entered successfully"})
}

// GetReportOptions returns assessments and classes available for teacher marks upload.
// GET /api/v1/teacher/reports/options
func (h *Handler) GetReportOptions(c *gin.Context) {
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
	academicYear := strings.TrimSpace(c.Query("academic_year"))
	if academicYear == "" {
		academicYear = getCurrentAcademicYear()
	}
	options, err := h.service.GetReportOptions(c.Request.Context(), userID, academicYear)
	if err != nil {
		if errors.Is(err, ErrTeacherNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "teacher_not_found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, options)
}

// GetReportMarksSheet returns class student rows with existing marks for an assessment+subject.
// GET /api/v1/teacher/reports/marks-sheet?assessment_id=&class_id=&subject_id=
func (h *Handler) GetReportMarksSheet(c *gin.Context) {
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

	assessmentID, err := uuid.Parse(strings.TrimSpace(c.Query("assessment_id")))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid assessment_id"})
		return
	}
	classID, err := uuid.Parse(strings.TrimSpace(c.Query("class_id")))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid class_id"})
		return
	}
	subjectID, err := uuid.Parse(strings.TrimSpace(c.Query("subject_id")))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid subject_id"})
		return
	}

	sheet, err := h.service.GetReportMarksSheet(c.Request.Context(), userID, assessmentID, classID, subjectID)
	if err != nil {
		if errors.Is(err, ErrTeacherNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "teacher_not_found"})
			return
		}
		if errors.Is(err, ErrNotAuthorized) {
			c.JSON(http.StatusForbidden, gin.H{"error": "not_authorized"})
			return
		}
		if errors.Is(err, ErrNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "not_found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, sheet)
}

// UpsertReportMarks creates or updates student marks for assessment/class.
// PUT /api/v1/teacher/reports/marks-sheet
func (h *Handler) UpsertReportMarks(c *gin.Context) {
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

	var req TeacherReportMarksUpdateRequest
	if err := strictBindJSON(c, &req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.service.UpsertReportMarks(c.Request.Context(), userID, &req); err != nil {
		if errors.Is(err, ErrTeacherNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "teacher_not_found"})
			return
		}
		if errors.Is(err, ErrInvalidInput) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input"})
			return
		}
		if errors.Is(err, ErrNotAuthorized) {
			c.JSON(http.StatusForbidden, gin.H{"error": "not_authorized"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "marks_updated"})
}

// CreateAnnouncement creates a new announcement
// POST /api/v1/teacher/announcements
func (h *Handler) CreateAnnouncement(c *gin.Context) {
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

	var req CreateAnnouncementRequest
	if err := strictBindJSON(c, &req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	id, err := h.service.CreateAnnouncement(c.Request.Context(), userID, &req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"id": id, "message": "Announcement created successfully"})
}

// GetAnnouncements returns recent announcements
// GET /api/v1/announcements
func (h *Handler) GetAnnouncements(c *gin.Context) {
	announcements, err := h.service.GetAnnouncements(c.Request.Context(), 10)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"announcements": announcements})
}

// UpdateHomework updates a teacher's homework record.
// PUT /api/v1/teacher/homework/:id
func (h *Handler) UpdateHomework(c *gin.Context) {
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
	if homeworkID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "homework id required"})
		return
	}
	var req UpdateHomeworkRequest
	attachments := make([]HomeworkAttachmentUpload, 0)
	contentType := strings.ToLower(strings.TrimSpace(c.ContentType()))
	if strings.HasPrefix(contentType, "multipart/form-data") {
		req.Title = strings.TrimSpace(c.PostForm("title"))
		req.Description = strings.TrimSpace(c.PostForm("description"))
		req.DueDate = strings.TrimSpace(c.PostForm("due_date"))
		req.MaxMarks = 100
		if raw := strings.TrimSpace(c.PostForm("max_marks")); raw != "" {
			parsed, parseErr := strconv.Atoi(raw)
			if parseErr != nil || parsed < 0 || parsed > 1000 {
				c.JSON(http.StatusBadRequest, gin.H{"error": "max_marks must be between 0 and 1000"})
				return
			}
			req.MaxMarks = parsed
		}

		attachments, err = parseHomeworkAttachments(c, false)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
	} else {
		if err := strictBindJSON(c, &req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
	}

	schoolID := strings.TrimSpace(middleware.GetSchoolID(c))
	if err := h.service.UpdateHomework(c.Request.Context(), userID, homeworkID, &req, schoolID, attachments); err != nil {
		switch {
		case errors.Is(err, ErrTeacherNotFound):
			c.JSON(http.StatusNotFound, gin.H{"error": "teacher_not_found"})
		case errors.Is(err, ErrHomeworkNotFound):
			c.JSON(http.StatusNotFound, gin.H{"error": "homework_not_found"})
		case errors.Is(err, ErrInvalidInput):
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input"})
		case errors.Is(err, ErrNotAuthorized):
			c.JSON(http.StatusForbidden, gin.H{"error": "not_authorized"})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		}
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "homework_updated"})
}

// DeleteHomework deletes a teacher's homework record.
// DELETE /api/v1/teacher/homework/:id
func (h *Handler) DeleteHomework(c *gin.Context) {
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
	if homeworkID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "homework id required"})
		return
	}
	if err := h.service.DeleteHomework(c.Request.Context(), userID, homeworkID); err != nil {
		switch {
		case errors.Is(err, ErrTeacherNotFound):
			c.JSON(http.StatusNotFound, gin.H{"error": "teacher_not_found"})
		case errors.Is(err, ErrHomeworkNotFound):
			c.JSON(http.StatusNotFound, gin.H{"error": "homework_not_found"})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		}
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "homework_deleted"})
}

// GetHomeworkSubmissions returns the list of students who submitted a specific homework.
// GET /api/v1/teacher/homework/:id/submissions
func (h *Handler) GetHomeworkSubmissions(c *gin.Context) {
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
	if homeworkID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "homework id required"})
		return
	}
	resp, err := h.service.GetHomeworkSubmissions(c.Request.Context(), userID, homeworkID)
	if err != nil {
		switch {
		case errors.Is(err, ErrTeacherNotFound):
			c.JSON(http.StatusNotFound, gin.H{"error": "teacher_not_found"})
		case errors.Is(err, ErrHomeworkNotFound):
			c.JSON(http.StatusNotFound, gin.H{"error": "homework_not_found"})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		}
		return
	}
	c.JSON(http.StatusOK, resp)
}
