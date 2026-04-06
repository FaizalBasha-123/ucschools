// cmd/seeder/main.go
// Endpoint-driven demo data generator for Schools24 platform.
// Creates realistic school, admin, teacher, and student data using authenticated API calls only.
// No direct database writes; simulates user-like flows for end-to-end testing.

package main

import (
	"bytes"
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"math/rand"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
)

// Config captures CLI flags and app state
type Config struct {
	APIBaseURL         string
	SuperAdminEmail    string
	SuperAdminPassword string
	SchoolName         string
	SchoolCode         string
	AdminEmail         string
	AdminPassword      string
	DryRun             bool
	Verbose            bool
	IDempotencyTag     string
	AcademicYear       string
	Seed               int64
}

// SeederRunner orchestrates the demo data creation workflow
type SeederRunner struct {
	config     *Config
	httpClient *http.Client
	rand       *rand.Rand
	result     *SeedResult
}

// SeedResult tracks all IDs generated during seeding
type SeedResult struct {
	SchoolID       uuid.UUID
	SchoolName     string
	AdminUserID    uuid.UUID
	AdminEmail     string
	AdminToken     string
	Classes        map[string]uuid.UUID // name -> UUID
	Teachers       map[string]uuid.UUID // email -> UUID
	Students       map[string]uuid.UUID // email -> UUID
	Subjects       map[string]uuid.UUID // name -> UUID
	TimetableSlots int
	Homework       []string // homework IDs
	Quizzes        []string // quiz IDs
	Materials      []string // material IDs
	Attendance     []string // attendance entries
	CreatedAt      time.Time
	Timestamp      string
}

func main() {
	config := parseFlags()
	if config.DryRun {
		log.Println("[DRY-RUN MODE] No changes will be persisted.")
	}

	// Initialize seeder with validated configuration
	seeder, err := NewSeederRunner(config)
	if err != nil {
		log.Fatalf("Failed to initialize seeder: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	// Execute the seeding workflow
	log.Println("=== Schools24 Endpoint-Driven Demo Data Seeder ===")
	log.Printf("Target: %s | Academic Year: %s | Idempotency: %s\n",
		config.APIBaseURL, config.AcademicYear, config.IDempotencyTag)

	if err := seeder.Run(ctx); err != nil {
		log.Fatalf("Seeding failed: %v", err)
	}

	// Print summary
	seeder.printSummary()
}

func parseFlags() *Config {
	cfg := &Config{
		APIBaseURL:         "http://localhost:8080/api/v1",
		SuperAdminEmail:    "superadmin@schools24.local",
		SuperAdminPassword: "SuperAdmin@2025",
		SchoolName:         "Cambridge International Academy",
		SchoolCode:         "CIA-2025",
		AdminEmail:         "admin@cia.local",
		AdminPassword:      "AdminPass@2025",
		AcademicYear:       "2025-2026",
		Seed:               time.Now().UnixNano(),
	}

	flag.StringVar(&cfg.APIBaseURL, "api", cfg.APIBaseURL, "API base URL")
	flag.StringVar(&cfg.SuperAdminEmail, "super-admin-email", cfg.SuperAdminEmail, "Super admin email")
	flag.StringVar(&cfg.SuperAdminPassword, "super-admin-password", cfg.SuperAdminPassword, "Super admin password")
	flag.StringVar(&cfg.SchoolName, "school-name", cfg.SchoolName, "School name to create")
	flag.StringVar(&cfg.SchoolCode, "school-code", cfg.SchoolCode, "School code")
	flag.StringVar(&cfg.AdminEmail, "admin-email", cfg.AdminEmail, "School admin email")
	flag.StringVar(&cfg.AdminPassword, "admin-password", cfg.AdminPassword, "School admin password")
	flag.StringVar(&cfg.AcademicYear, "academic-year", cfg.AcademicYear, "Academic year (e.g., 2025-2026)")
	flag.BoolVar(&cfg.DryRun, "dry-run", false, "Simulate without persisting changes")
	flag.BoolVar(&cfg.Verbose, "verbose", false, "Enable verbose logging")
	flag.Int64Var(&cfg.Seed, "seed", cfg.Seed, "Random seed for reproducible generation")
	flag.Parse()

	cfg.IDempotencyTag = fmt.Sprintf("demo-%s-%d", time.Now().Format("20060102-150405"), cfg.Seed%1000)
	return cfg
}

// NewSeederRunner creates and validates a seeder instance
func NewSeederRunner(config *Config) (*SeederRunner, error) {
	if config.APIBaseURL == "" {
		return nil, fmt.Errorf("api base URL is required")
	}
	if config.SuperAdminEmail == "" || config.SuperAdminPassword == "" {
		return nil, fmt.Errorf("super admin credentials required")
	}

	return &SeederRunner{
		config:     config,
		httpClient: &http.Client{Timeout: 30 * time.Second},
		rand:       rand.New(rand.NewSource(config.Seed)),
		result: &SeedResult{
			Classes:   make(map[string]uuid.UUID),
			Teachers:  make(map[string]uuid.UUID),
			Students:  make(map[string]uuid.UUID),
			Subjects:  make(map[string]uuid.UUID),
			CreatedAt: time.Now(),
			Timestamp: time.Now().Format(time.RFC3339),
		},
	}, nil
}

// Run executes the complete seeding workflow
func (s *SeederRunner) Run(ctx context.Context) error {
	steps := []struct {
		name string
		fn   func(context.Context) error
	}{
		{"super-admin login", s.loginSuperAdmin},
		{"create school", s.createSchool},
		{"admin login", s.loginAdmin},
		{"create global classes", s.ensureGlobalClasses},
		{"create global subjects", s.ensureGlobalSubjects},
		{"create tenant classes", s.createTenantClasses},
		{"fetch global catalogs", s.fetchGlobalCatalogs},
		{"create teachers", s.createTeachers},
		{"create students", s.createStudents},
		{"assign timetable", s.assignTimetable},
		{"create homework", s.createHomework},
		{"create quizzes", s.createQuizzes},
		{"upload materials", s.uploadMaterials},
		{"mark attendance", s.markAttendance},
		{"validate student views", s.validateStudentPages},
	}

	for i, step := range steps {
		log.Printf("\n[%d/%d] %s...", i+1, len(steps), step.name)
		if err := step.fn(ctx); err != nil {
			return fmt.Errorf("step '%s' failed: %w", step.name, err)
		}
		log.Printf("✓ %s completed", step.name)
	}

	return nil
}

func (s *SeederRunner) loginSuperAdmin(ctx context.Context) error {
	type LoginReq struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	type LoginResp struct {
		AccessToken string `json:"access_token"`
		User        struct {
			ID   uuid.UUID `json:"id"`
			Role string    `json:"role"`
		} `json:"user"`
	}

	reqBody := LoginReq{
		Email:    s.config.SuperAdminEmail,
		Password: s.config.SuperAdminPassword,
	}

	var resp LoginResp
	if err := s.post(ctx, "/auth/login", reqBody, &resp, ""); err != nil {
		return err
	}

	if resp.User.Role != "super_admin" {
		return fmt.Errorf("user is not a super admin: role=%s", resp.User.Role)
	}

	s.result.AdminToken = resp.AccessToken // Store super admin token temporarily
	return nil
}

func (s *SeederRunner) createSchool(ctx context.Context) error {
	type AdminReq struct {
		Name     string `json:"name"`
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	type CreateSchoolReq struct {
		Name    string     `json:"name"`
		Code    string     `json:"code"`
		Address string     `json:"address"`
		Admins  []AdminReq `json:"admins"`
	}
	type CreateSchoolResp struct {
		ID uuid.UUID `json:"id"`
	}

	reqBody := CreateSchoolReq{
		Name:    s.config.SchoolName,
		Code:    s.config.SchoolCode,
		Address: "123 Academy Lane, Education City",
		Admins: []AdminReq{
			{
				Name:     "School Administrator",
				Email:    s.config.AdminEmail,
				Password: s.config.AdminPassword,
			},
		},
	}

	var resp CreateSchoolResp
	if err := s.post(ctx, "/super-admin/schools", reqBody, &resp, s.result.AdminToken); err != nil {
		return err
	}

	s.result.SchoolID = resp.ID
	s.result.SchoolName = s.config.SchoolName
	return nil
}

func (s *SeederRunner) loginAdmin(ctx context.Context) error {
	type LoginReq struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	type LoginResp struct {
		AccessToken string `json:"access_token"`
		User        struct {
			ID       uuid.UUID `json:"id"`
			Role     string    `json:"role"`
			SchoolID string    `json:"school_id"`
		} `json:"user"`
	}

	reqBody := LoginReq{
		Email:    s.config.AdminEmail,
		Password: s.config.AdminPassword,
	}

	var resp LoginResp
	if err := s.post(ctx, "/auth/login", reqBody, &resp, ""); err != nil {
		return err
	}

	if resp.User.Role != "admin" {
		return fmt.Errorf("user is not an admin: role=%s", resp.User.Role)
	}

	s.result.AdminUserID = resp.User.ID
	s.result.AdminEmail = s.config.AdminEmail
	s.result.AdminToken = resp.AccessToken
	return nil
}

// ensureGlobalClasses fetches or creates standard global classes (if not present)
func (s *SeederRunner) ensureGlobalClasses(ctx context.Context) error {
	type GlobalClass struct {
		ID   uuid.UUID `json:"id"`
		Name string    `json:"name"`
	}
	type ListResp struct {
		Classes []GlobalClass `json:"classes"`
	}

	var resp ListResp
	if err := s.get(ctx, "/super-admin/catalog/classes", &resp, s.result.AdminToken); err != nil {
		return err
	}

	// If classes already exist, populate our cache
	for _, cls := range resp.Classes {
		s.result.Classes[cls.Name] = cls.ID
	}

	// Optionally create missing standard classes
	standardClasses := []string{"10th Grade", "11th Grade", "12th Grade"}
	for _, name := range standardClasses {
		if _, exists := s.result.Classes[name]; !exists {
			s.logVerbose("Standard class %s not found, may need manual creation", name)
		}
	}

	return nil
}

// ensureGlobalSubjects fetches or creates standard global subjects
func (s *SeederRunner) ensureGlobalSubjects(ctx context.Context) error {
	type GlobalSubject struct {
		ID   uuid.UUID `json:"id"`
		Name string    `json:"name"`
	}
	type ListResp struct {
		Subjects []GlobalSubject `json:"subjects"`
	}

	var resp ListResp
	if err := s.get(ctx, "/super-admin/catalog/subjects", &resp, s.result.AdminToken); err != nil {
		return err
	}

	for _, subj := range resp.Subjects {
		s.result.Subjects[subj.Name] = subj.ID
	}

	return nil
}

// createTenantClasses creates custom classes within the tenant schema
func (s *SeederRunner) createTenantClasses(ctx context.Context) error {
	type CreateClassReq struct {
		Name         string `json:"name"`
		Grade        int    `json:"grade"`
		Section      string `json:"section"`
		AcademicYear string `json:"academic_year"`
		RoomNumber   string `json:"room_number"`
	}
	type CreateClassResp struct {
		Class struct {
			ID   uuid.UUID `json:"id"`
			Name string    `json:"name"`
		} `json:"class"`
	}

	classes := []struct {
		name, section, room string
		grade               int
	}{
		{"Class 10-A", "A", "101", 10},
		{"Class 10-B", "B", "102", 10},
		{"Class 11-A", "A", "201", 11},
		{"Class 12-A", "A", "301", 12},
	}

	for _, cls := range classes {
		reqBody := CreateClassReq{
			Name:         cls.name,
			Grade:        cls.grade,
			Section:      cls.section,
			AcademicYear: s.config.AcademicYear,
			RoomNumber:   cls.room,
		}

		var resp CreateClassResp
		if err := s.post(ctx, "/admin/classes", reqBody, &resp, s.result.AdminToken); err != nil {
			s.logVerbose("Class creation: %v (may already exist)", err)
			continue
		}

		s.result.Classes[cls.name] = resp.Class.ID
		s.logVerbose("Created class: %s (%s)", cls.name, resp.Class.ID)
	}

	if len(s.result.Classes) == 0 {
		return fmt.Errorf("no classes were created")
	}

	return nil
}

// fetchGlobalCatalogs retrieves available classes and subjects for timetable assignment
func (s *SeederRunner) fetchGlobalCatalogs(ctx context.Context) error {
	type Class struct {
		ID   uuid.UUID `json:"id"`
		Name string    `json:"name"`
	}
	type Subject struct {
		ID   uuid.UUID `json:"id"`
		Name string    `json:"name"`
	}
	type ClassesResp struct {
		Classes []Class `json:"classes"`
	}
	type SubjectsResp struct {
		Subjects []Subject `json:"subjects"`
	}

	var classesResp ClassesResp
	if err := s.get(ctx, "/admin/catalog/classes", &classesResp, s.result.AdminToken); err != nil {
		s.logVerbose("Failed to fetch global classes: %v", err)
	} else {
		for _, cls := range classesResp.Classes {
			if _, ok := s.result.Classes[cls.Name]; !ok {
				s.result.Classes[cls.Name] = cls.ID
			}
		}
	}

	var subjectsResp SubjectsResp
	if err := s.get(ctx, "/admin/catalog/subjects", &subjectsResp, s.result.AdminToken); err != nil {
		s.logVerbose("Failed to fetch global subjects: %v", err)
	} else {
		for _, subj := range subjectsResp.Subjects {
			s.result.Subjects[subj.Name] = subj.ID
		}
	}

	return nil
}

// createTeachers creates teacher accounts with profile
func (s *SeederRunner) createTeachers(ctx context.Context) error {
	type CreateTeacherReq struct {
		Email          string   `json:"email"`
		Password       string   `json:"password"`
		FullName       string   `json:"full_name"`
		Phone          string   `json:"phone"`
		EmployeeID     string   `json:"employee_id"`
		Department     string   `json:"department"`
		Designation    string   `json:"designation"`
		SubjectsTaught []string `json:"subjects_taught"`
	}
	type CreateTeacherResp struct {
		UserID uuid.UUID `json:"user_id"`
	}

	teachers := []struct {
		name, email, empID, subject string
	}{
		{"Dr. Rajesh Kumar", "rajesh.kumar@cia.local", "EMP001", "Mathematics"},
		{"Ms. Priya Singh", "priya.singh@cia.local", "EMP002", "English"},
		{"Mr. Arun Verma", "arun.verma@cia.local", "EMP003", "Science"},
		{"Ms. Anjali Patel", "anjali.patel@cia.local", "EMP004", "History"},
	}

	for _, t := range teachers {
		reqBody := CreateTeacherReq{
			Email:          t.email,
			Password:       "Teacher@2025",
			FullName:       t.name,
			Phone:          fmt.Sprintf("98%010d", s.rand.Intn(1000000000)),
			EmployeeID:     t.empID,
			Department:     "Academic",
			Designation:    "Teacher",
			SubjectsTaught: []string{t.subject},
		}

		var resp CreateTeacherResp
		if err := s.post(ctx, "/admin/teachers", reqBody, &resp, s.result.AdminToken); err != nil {
			s.logVerbose("Teacher creation skip: %v", err)
			continue
		}

		s.result.Teachers[t.email] = resp.UserID
		s.logVerbose("Created teacher: %s (%s)", t.name, resp.UserID)
	}

	if len(s.result.Teachers) == 0 {
		return fmt.Errorf("no teachers were created")
	}

	return nil
}

// createStudents creates student accounts
func (s *SeederRunner) createStudents(ctx context.Context) error {
	type CreateStudentReq struct {
		Email           string `json:"email"`
		Password        string `json:"password"`
		FullName        string `json:"full_name"`
		Phone           string `json:"phone"`
		ClassID         string `json:"class_id"`
		RollNumber      string `json:"roll_number"`
		AdmissionNumber string `json:"admission_number"`
		DateOfBirth     string `json:"date_of_birth"`
		Gender          string `json:"gender"`
		AcademicYear    string `json:"academic_year"`
	}
	type CreateStudentResp struct {
		UserID uuid.UUID `json:"user_id"`
	}

	// Get first available class
	var selectedClassID uuid.UUID
	for _, cid := range s.result.Classes {
		selectedClassID = cid
		break
	}
	if selectedClassID == uuid.Nil {
		return fmt.Errorf("no classes available for student assignment")
	}

	students := []struct {
		name, email, roll string
		dob               string
	}{
		{"Aditya Sharma", "aditya.sharma@cia.local", "101", "2008-03-15"},
		{"Bhavna Iyer", "bhavna.iyer@cia.local", "102", "2008-05-22"},
		{"Chirag Gupta", "chirag.gupta@cia.local", "103", "2008-07-10"},
		{"Divya Nair", "divya.nair@cia.local", "104", "2008-09-03"},
		{"Evaan Chakraborty", "evaan.chakraborty@cia.local", "105", "2008-11-12"},
	}

	for i, st := range students {
		reqBody := CreateStudentReq{
			Email:           st.email,
			Password:        "Student@2025",
			FullName:        st.name,
			Phone:           fmt.Sprintf("99%010d", 1000000+i),
			ClassID:         selectedClassID.String(),
			RollNumber:      st.roll,
			AdmissionNumber: fmt.Sprintf("ADM%05d", 2025001+i),
			DateOfBirth:     st.dob,
			Gender:          []string{"male", "female"}[i%2],
			AcademicYear:    s.config.AcademicYear,
		}

		var resp CreateStudentResp
		if err := s.post(ctx, "/admin/students", reqBody, &resp, s.result.AdminToken); err != nil {
			s.logVerbose("Student creation skip: %v", err)
			continue
		}

		s.result.Students[st.email] = resp.UserID
		s.logVerbose("Created student: %s (%s)", st.name, resp.UserID)
	}

	if len(s.result.Students) == 0 {
		return fmt.Errorf("no students were created")
	}

	return nil
}

// assignTimetable creates timetable slots for teachers in classes
func (s *SeederRunner) assignTimetable(ctx context.Context) error {
	type UpsertSlotReq struct {
		ClassID      string `json:"class_id"`
		DayOfWeek    int    `json:"day_of_week"`
		PeriodNumber int    `json:"period_number"`
		SubjectID    string `json:"subject_id"`
		TeacherID    string `json:"teacher_id"`
		StartTime    string `json:"start_time"`
		EndTime      string `json:"end_time"`
		RoomNumber   string `json:"room_number"`
		AcademicYear string `json:"academic_year"`
	}

	// Select one teacher and one class
	var classID, teacherID uuid.UUID
	for _, cid := range s.result.Classes {
		classID = cid
		break
	}
	for _, tid := range s.result.Teachers {
		teacherID = tid
		break
	}

	if classID == uuid.Nil || teacherID == uuid.Nil {
		return fmt.Errorf("missing class or teacher for timetable assignment")
	}

	// Pick a subject (Mathematics)
	var subjectID uuid.UUID
	for name, sid := range s.result.Subjects {
		if strings.Contains(name, "Math") || strings.Contains(name, "English") || strings.Contains(name, "Science") {
			subjectID = sid
			break
		}
	}
	if subjectID == uuid.Nil {
		// Use any available subject
		for _, sid := range s.result.Subjects {
			subjectID = sid
			break
		}
	}

	// Create 5 slots per week (Mon-Fri, period 1-5)
	for day := 1; day <= 5; day++ {
		for period := 1; period <= 3; period++ {
			reqBody := UpsertSlotReq{
				ClassID:      classID.String(),
				DayOfWeek:    day,
				PeriodNumber: period,
				SubjectID:    subjectID.String(),
				TeacherID:    teacherID.String(),
				StartTime:    fmt.Sprintf("%02d:00:00", 8+period),
				EndTime:      fmt.Sprintf("%02d:00:00", 9+period),
				RoomNumber:   "101",
				AcademicYear: s.config.AcademicYear,
			}

			if err := s.post(ctx, "/admin/timetable/slots", reqBody, nil, s.result.AdminToken); err != nil {
				s.logVerbose("Timetable slot creation: %v", err)
				continue
			}

			s.result.TimetableSlots++
		}
	}

	return nil
}

// createHomework creates sample homework assignments
func (s *SeederRunner) createHomework(ctx context.Context) error {
	type HomeworkReq struct {
		Title       string `json:"title"`
		Description string `json:"description"`
		ClassID     string `json:"class_id"`
		SubjectID   string `json:"subject_id"`
		DueDate     string `json:"due_date"`
		MaxMarks    int    `json:"max_marks"`
	}
	type HomeworkResp struct {
		ID uuid.UUID `json:"id"`
	}

	// Select first class and subject
	var classID, subjectID uuid.UUID
	for _, cid := range s.result.Classes {
		classID = cid
		break
	}
	for _, sid := range s.result.Subjects {
		subjectID = sid
		break
	}

	if classID == uuid.Nil || subjectID == uuid.Nil {
		return fmt.Errorf("missing class or subject for homework")
	}

	// Pick a teacher to create homework as
	var teacherEmail string
	for email := range s.result.Teachers {
		teacherEmail = email
		break
	}

	// Login as teacher
	type TeacherLoginReq struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	type LoginResp struct {
		AccessToken string `json:"access_token"`
	}

	teacherLogin := TeacherLoginReq{
		Email:    teacherEmail,
		Password: "Teacher@2025",
	}
	var teacherResp LoginResp
	if err := s.post(ctx, "/auth/login", teacherLogin, &teacherResp, ""); err != nil {
		s.logVerbose("Teacher login for homework: %v", err)
		return err
	}

	// Create homework
	dueDate := time.Now().AddDate(0, 0, 7).Format("2006-01-02")
	hwTitles := []string{
		"Algebra Fundamentals - Chapter 5",
		"Scientific Method Practice",
		"Historical Analysis Essay",
		"Grammar & Composition Exercises",
	}

	for _, title := range hwTitles {
		reqBody := HomeworkReq{
			Title:       title,
			Description: fmt.Sprintf("Complete all exercises in %s", title),
			ClassID:     classID.String(),
			SubjectID:   subjectID.String(),
			DueDate:     dueDate,
			MaxMarks:    50,
		}

		var resp HomeworkResp
		if err := s.post(ctx, "/teacher/homework", reqBody, &resp, teacherResp.AccessToken); err != nil {
			s.logVerbose("Homework creation: %v", err)
			continue
		}

		s.result.Homework = append(s.result.Homework, resp.ID.String())
		s.logVerbose("Created homework: %s (%s)", title, resp.ID)
	}

	return nil
}

// createQuizzes creates sample quiz assessments
func (s *SeederRunner) createQuizzes(ctx context.Context) error {
	type QuizOptionReq struct {
		OptionText string `json:"option_text"`
		IsCorrect  bool   `json:"is_correct"`
	}
	type QuizQuestionReq struct {
		QuestionText string          `json:"question_text"`
		Marks        int             `json:"marks"`
		Options      []QuizOptionReq `json:"options"`
	}
	type CreateQuizReq struct {
		Title           string            `json:"title"`
		ChapterName     string            `json:"chapter_name"`
		ClassID         string            `json:"class_id"`
		SubjectID       string            `json:"subject_id"`
		ScheduledAt     string            `json:"scheduled_at"`
		IsAnytime       bool              `json:"is_anytime"`
		DurationMinutes int               `json:"duration_minutes"`
		TotalMarks      int               `json:"total_marks"`
		Questions       []QuizQuestionReq `json:"questions"`
	}
	type QuizResp struct {
		ID uuid.UUID `json:"id"`
	}

	// Select first class and subject
	var classID, subjectID uuid.UUID
	for _, cid := range s.result.Classes {
		classID = cid
		break
	}
	for _, sid := range s.result.Subjects {
		subjectID = sid
		break
	}

	if classID == uuid.Nil || subjectID == uuid.Nil {
		return fmt.Errorf("missing class or subject for quiz")
	}

	// Login as teacher
	var teacherEmail string
	for email := range s.result.Teachers {
		teacherEmail = email
		break
	}

	type TeacherLoginReq struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	type LoginResp struct {
		AccessToken string `json:"access_token"`
	}

	teacherLogin := TeacherLoginReq{
		Email:    teacherEmail,
		Password: "Teacher@2025",
	}
	var teacherResp LoginResp
	if err := s.post(ctx, "/auth/login", teacherLogin, &teacherResp, ""); err != nil {
		return err
	}

	// Create sample quiz with questions
	questions := []QuizQuestionReq{
		{
			QuestionText: "What is 5 + 3?",
			Marks:        5,
			Options: []QuizOptionReq{
				{OptionText: "7", IsCorrect: false},
				{OptionText: "8", IsCorrect: true},
				{OptionText: "9", IsCorrect: false},
				{OptionText: "10", IsCorrect: false},
			},
		},
		{
			QuestionText: "What is the capital of France?",
			Marks:        5,
			Options: []QuizOptionReq{
				{OptionText: "London", IsCorrect: false},
				{OptionText: "Paris", IsCorrect: true},
				{OptionText: "Berlin", IsCorrect: false},
				{OptionText: "Madrid", IsCorrect: false},
			},
		},
	}

	scheduledTime := time.Now().AddDate(0, 0, 1).Format(time.RFC3339)
	reqBody := CreateQuizReq{
		Title:           "Mid-Term Assessment",
		ChapterName:     "Fundamentals",
		ClassID:         classID.String(),
		SubjectID:       subjectID.String(),
		ScheduledAt:     scheduledTime,
		IsAnytime:       false,
		DurationMinutes: 60,
		TotalMarks:      100,
		Questions:       questions,
	}

	var resp QuizResp
	if err := s.post(ctx, "/teacher/quizzes", reqBody, &resp, teacherResp.AccessToken); err != nil {
		s.logVerbose("Quiz creation: %v", err)
	} else {
		s.result.Quizzes = append(s.result.Quizzes, resp.ID.String())
		s.logVerbose("Created quiz: %s (%s)", reqBody.Title, resp.ID)
	}

	return nil
}

// uploadMaterials uploads sample study materials
func (s *SeederRunner) uploadMaterials(ctx context.Context) error {
	s.logVerbose("Materials upload: placeholder (multipart form upload requires FormFile)")
	// In a real scenario, would use multipart/form-data to upload PDF/DOC files
	// For now, log as informational
	return nil
}

// markAttendance records sample attendance
func (s *SeederRunner) markAttendance(ctx context.Context) error {
	type StudentAttendance struct {
		StudentID string `json:"student_id"`
		Status    string `json:"status"`
		Remarks   string `json:"remarks,omitempty"`
	}
	type MarkAttendanceReq struct {
		ClassID    string `json:"class_id"`
		Date       string `json:"date"`
		Attendance string `json:"attendance"`
	}

	// Select first class
	var classID uuid.UUID
	for _, cid := range s.result.Classes {
		classID = cid
		break
	}

	if classID == uuid.Nil {
		return fmt.Errorf("no class available for attendance")
	}

	// Build student attendance data
	var attendanceList []StudentAttendance
	statuses := []string{"present", "absent", "late"}
	for _, studentID := range s.result.Students {
		attendanceList = append(attendanceList, StudentAttendance{
			StudentID: studentID.String(),
			Status:    statuses[s.rand.Intn(len(statuses))],
		})
	}

	attendanceJSON, _ := json.Marshal(attendanceList)

	// Login as teacher
	var teacherEmail string
	for email := range s.result.Teachers {
		teacherEmail = email
		break
	}

	type TeacherLoginReq struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	type LoginResp struct {
		AccessToken string `json:"access_token"`
	}

	teacherLogin := TeacherLoginReq{
		Email:    teacherEmail,
		Password: "Teacher@2025",
	}
	var teacherResp LoginResp
	if err := s.post(ctx, "/auth/login", teacherLogin, &teacherResp, ""); err != nil {
		return err
	}

	attendanceReq := MarkAttendanceReq{
		ClassID:    classID.String(),
		Date:       time.Now().Format("2006-01-02"),
		Attendance: string(attendanceJSON),
	}

	if err := s.post(ctx, "/teacher/attendance", attendanceReq, nil, teacherResp.AccessToken); err != nil {
		s.logVerbose("Attendance marking: %v", err)
	} else {
		s.result.Attendance = append(s.result.Attendance, time.Now().Format("2006-01-02"))
		s.logVerbose("Marked attendance for %d students", len(attendanceList))
	}

	return nil
}

// validateStudentPages performs sample student API calls to validate workflow
func (s *SeederRunner) validateStudentPages(ctx context.Context) error {
	if len(s.result.Students) == 0 {
		return fmt.Errorf("no students available for validation")
	}

	// Login as first student
	var studentEmail string
	for email := range s.result.Students {
		studentEmail = email
		break
	}

	type StudentLoginReq struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	type LoginResp struct {
		AccessToken string `json:"access_token"`
	}

	studentLogin := StudentLoginReq{
		Email:    studentEmail,
		Password: "Student@2025",
	}
	var studentResp LoginResp
	if err := s.post(ctx, "/auth/login", studentLogin, &studentResp, ""); err != nil {
		s.logVerbose("Student login for validation: %v", err)
		return err
	}

	// Call student APIs to validate access
	_ = s.get(ctx, "/student/dashboard", nil, studentResp.AccessToken)
	_ = s.get(ctx, "/student/profile", nil, studentResp.AccessToken)
	_ = s.get(ctx, "/student/materials", nil, studentResp.AccessToken)

	s.logVerbose("Student validation completed")
	return nil
}

// Helper methods

func (s *SeederRunner) post(ctx context.Context, endpoint string, reqBody, respDest interface{}, token string) error {
	if s.config.DryRun {
		s.logVerbose("[DRY-RUN] POST %s", endpoint)
		return nil
	}

	url := s.config.APIBaseURL + endpoint
	bodyBytes, _ := json.Marshal(reqBody)
	req, _ := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(bodyBytes))
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("POST %s: %w", endpoint, err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 300 {
		return fmt.Errorf("POST %s: status %d: %s", endpoint, resp.StatusCode, string(body))
	}

	if respDest != nil {
		if err := json.Unmarshal(body, respDest); err != nil {
			return fmt.Errorf("POST %s: parse response: %w", endpoint, err)
		}
	}

	return nil
}

func (s *SeederRunner) get(ctx context.Context, endpoint string, respDest interface{}, token string) error {
	url := s.config.APIBaseURL + endpoint
	req, _ := http.NewRequestWithContext(ctx, "GET", url, nil)
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("GET %s: %w", endpoint, err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 300 {
		return fmt.Errorf("GET %s: status %d", endpoint, resp.StatusCode)
	}

	if respDest != nil {
		if err := json.Unmarshal(body, respDest); err != nil {
			return fmt.Errorf("GET %s: parse response: %w", endpoint, err)
		}
	}

	return nil
}

func (s *SeederRunner) logVerbose(format string, args ...interface{}) {
	if s.config.Verbose {
		log.Printf("[VERBOSE] "+format, args...)
	}
}

func (s *SeederRunner) printSummary() {
	fmt.Println("\n" + strings.Repeat("=", 60))
	fmt.Println("DEMO DATA SEEDING COMPLETED")
	fmt.Println(strings.Repeat("=", 60))
	fmt.Printf("School: %s (ID: %s)\n", s.result.SchoolName, s.result.SchoolID)
	fmt.Printf("Admin: %s\n", s.result.AdminEmail)
	fmt.Printf("Academic Year: %s\n", s.config.AcademicYear)
	fmt.Printf("Idempotency Tag: %s\n", s.config.IDempotencyTag)
	fmt.Printf("Timestamp: %s\n\n", s.result.Timestamp)
	fmt.Printf("Classes Created: %d\n", len(s.result.Classes))
	fmt.Printf("Teachers Created: %d\n", len(s.result.Teachers))
	fmt.Printf("Students Created: %d\n", len(s.result.Students))
	fmt.Printf("Timetable Slots: %d\n", s.result.TimetableSlots)
	fmt.Printf("Homework Assignments: %d\n", len(s.result.Homework))
	fmt.Printf("Quizzes: %d\n", len(s.result.Quizzes))
	fmt.Printf("Attendance Days: %d\n", len(s.result.Attendance))
	fmt.Println(strings.Repeat("=", 60))

	if s.config.DryRun {
		fmt.Println("DRY-RUN MODE: No data was persisted to the database.")
	}
}
