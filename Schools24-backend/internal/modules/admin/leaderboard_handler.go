package admin

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// GetStudentsLeaderboard handles student leaderboard fetch.
// GET /api/v1/admin/leaderboards/students
func (h *Handler) GetStudentsLeaderboard(c *gin.Context) {
	schoolID, err := resolveSchoolID(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	academicYear := c.DefaultQuery("academic_year", resolveAcademicYear(c))
	search := strings.TrimSpace(c.Query("search"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "100"))
	refresh := c.DefaultQuery("refresh", "true") != "false"

	var classID *uuid.UUID
	if classIDStr := c.Query("class_id"); classIDStr != "" {
		id, parseErr := uuid.Parse(classIDStr)
		if parseErr != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid class_id"})
			return
		}
		classID = &id
	}

	items, err := h.service.GetStudentsLeaderboard(c.Request.Context(), schoolID, academicYear, classID, search, limit, refresh)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"academic_year": academicYear,
		"items":         items,
		"top_3":         topStudentLeaderboard(items, 3),
	})
}

// GetTeachersLeaderboard handles teacher leaderboard fetch.
// GET /api/v1/admin/leaderboards/teachers
func (h *Handler) GetTeachersLeaderboard(c *gin.Context) {
	schoolID, err := resolveSchoolID(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	academicYear := c.DefaultQuery("academic_year", resolveAcademicYear(c))
	search := strings.TrimSpace(c.Query("search"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "100"))
	refresh := c.DefaultQuery("refresh", "true") != "false"

	items, err := h.service.GetTeachersLeaderboard(c.Request.Context(), schoolID, academicYear, search, limit, refresh)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"academic_year": academicYear,
		"items":         items,
		"top_3":         topTeacherLeaderboard(items, 3),
	})
}

// RefreshLeaderboards recalculates both leaderboards.
// POST /api/v1/admin/leaderboards/refresh
func (h *Handler) RefreshLeaderboards(c *gin.Context) {
	schoolID, err := resolveSchoolID(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var req struct {
		AcademicYear string `json:"academic_year"`
	}
	if err := optionalStrictBindJSON(c, &req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	academicYear := strings.TrimSpace(req.AcademicYear)
	if academicYear == "" {
		academicYear = resolveAcademicYear(c)
	}

	if err := h.service.RefreshLeaderboards(c.Request.Context(), schoolID, academicYear); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message":       "leaderboards_refreshed",
		"academic_year": academicYear,
	})
}

func topStudentLeaderboard(items []StudentLeaderboardItem, n int) []StudentLeaderboardItem {
	if len(items) <= n {
		return items
	}
	return items[:n]
}

func topTeacherLeaderboard(items []TeacherLeaderboardItem, n int) []TeacherLeaderboardItem {
	if len(items) <= n {
		return items
	}
	return items[:n]
}

// GetAssessmentLeaderboard returns a school-wide student ranking based on
// completed assessment averages across all classes.
// GET /api/v1/admin/leaderboards/assessments
func (h *Handler) GetAssessmentLeaderboard(c *gin.Context) {
	schoolID, err := resolveSchoolID(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	academicYear := c.DefaultQuery("academic_year", resolveAcademicYear(c))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "100"))

	resp, err := h.service.GetAllStudentsAssessmentLeaderboard(c.Request.Context(), schoolID, academicYear, limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, resp)
}

// GetWeeklyAttendanceSummary returns per-day present/absent totals for the current week.
// GET /api/v1/admin/attendance/weekly
func (h *Handler) GetWeeklyAttendanceSummary(c *gin.Context) {
	schoolID, err := resolveSchoolID(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	resp, err := h.service.GetWeeklyAttendanceSummary(c.Request.Context(), schoolID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, resp)
}
