package operations

import (
	"time"

	"github.com/google/uuid"
)

// Event represents a school event
type Event struct {
	ID                 uuid.UUID  `json:"id" db:"id"`
	SchoolID           uuid.UUID  `json:"school_id" db:"school_id"`
	Title              string     `json:"title" db:"title"`
	Description        *string    `json:"description,omitempty" db:"description"`
	EventDate          time.Time  `json:"event_date" db:"event_date"`
	StartTime          *time.Time `json:"start_time,omitempty" db:"start_time"`
	EndTime            *time.Time `json:"end_time,omitempty" db:"end_time"`
	Type               string     `json:"type" db:"type"` // event, exam, holiday, meeting, sports
	Location           *string    `json:"location,omitempty" db:"location"`
	TargetGrade        *int       `json:"target_grade,omitempty" db:"target_grade"`
	SourceAssessmentID *uuid.UUID `json:"source_assessment_id,omitempty" db:"source_assessment_id"`
	SourceSubjectID    *uuid.UUID `json:"source_subject_id,omitempty" db:"source_subject_id"`
	CreatedAt          time.Time  `json:"created_at" db:"created_at"`
	UpdatedAt          time.Time  `json:"updated_at" db:"updated_at"`
}

// CreateEventRequest for creating a new event
type CreateEventRequest struct {
	Title       string `json:"title" binding:"required"`
	Description string `json:"description"`
	EventDate   string `json:"event_date" binding:"required"` // YYYY-MM-DD
	StartTime   string `json:"start_time"`                    // HH:MM
	EndTime     string `json:"end_time"`                      // HH:MM
	Type        string `json:"type" binding:"required,oneof=event exam holiday meeting sports"`
	Location    string `json:"location"`
	TargetGrade *int   `json:"target_grade,omitempty"`
}

// UpdateEventRequest for updating an event
type UpdateEventRequest struct {
	Title       *string `json:"title,omitempty"`
	Description *string `json:"description,omitempty"`
	EventDate   *string `json:"event_date,omitempty"` // YYYY-MM-DD
	StartTime   *string `json:"start_time,omitempty"` // HH:MM
	EndTime     *string `json:"end_time,omitempty"`   // HH:MM
	Type        *string `json:"type,omitempty"`
	Location    *string `json:"location,omitempty"`
	TargetGrade *int    `json:"target_grade,omitempty"`
}

// ListEventsResponse for paginated event list
type ListEventsResponse struct {
	Events     []Event `json:"events"`
	TotalCount int     `json:"total_count"`
	Page       int     `json:"page"`
	PageSize   int     `json:"page_size"`
}

// EventType constants
const (
	EventTypeEvent   = "event"
	EventTypeExam    = "exam"
	EventTypeHoliday = "holiday"
	EventTypeMeeting = "meeting"
	EventTypeSports  = "sports"
)
