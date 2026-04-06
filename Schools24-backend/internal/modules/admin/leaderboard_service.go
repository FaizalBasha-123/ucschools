package admin

import (
	"context"

	"github.com/google/uuid"
)

func (s *Service) RefreshLeaderboards(ctx context.Context, schoolID uuid.UUID, academicYear string) error {
	if err := s.repo.RefreshStudentLeaderboard(ctx, schoolID, academicYear); err != nil {
		return err
	}
	if err := s.repo.RefreshTeacherLeaderboard(ctx, schoolID, academicYear); err != nil {
		return err
	}
	return nil
}

// GetStudentsLeaderboard reads live assessment data — no cache refresh needed.
// The refresh parameter is accepted for API compatibility but is no longer used
// because GetStudentLeaderboard now queries assessment tables directly.
func (s *Service) GetStudentsLeaderboard(ctx context.Context, schoolID uuid.UUID, academicYear string, classID *uuid.UUID, search string, limit int, _ bool) ([]StudentLeaderboardItem, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	return s.repo.GetStudentLeaderboard(ctx, schoolID, academicYear, classID, search, limit)
}

// GetTeachersLeaderboard computes teacher rankings live — no cache refresh needed.
// The refresh parameter is accepted for API compatibility but is no longer used
// because GetTeacherLeaderboard now queries source tables directly.
func (s *Service) GetTeachersLeaderboard(ctx context.Context, schoolID uuid.UUID, academicYear string, search string, limit int, _ bool) ([]TeacherLeaderboardItem, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	return s.repo.GetTeacherLeaderboard(ctx, schoolID, academicYear, search, limit)
}

// GetAllStudentsAssessmentLeaderboard returns a school-wide student ranking based
// on completed assessment averages (no class filter — all students, all classes).
func (s *Service) GetAllStudentsAssessmentLeaderboard(ctx context.Context, schoolID uuid.UUID, academicYear string, limit int) (*AdminAssessmentLeaderboardResponse, error) {
	if limit <= 0 || limit > 200 {
		limit = 100
	}
	items, err := s.repo.GetAllStudentsAssessmentLeaderboard(ctx, schoolID, academicYear, limit)
	if err != nil {
		return nil, err
	}
	return &AdminAssessmentLeaderboardResponse{
		AcademicYear: academicYear,
		TotalItems:   len(items),
		Items:        items,
	}, nil
}
