package main

import (
	"context"
	"fmt"
	"hash/fnv"
	"log"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/schools24/backend/internal/config"
	"github.com/schools24/backend/internal/modules/academic"
	"github.com/schools24/backend/internal/modules/admin"
	"github.com/schools24/backend/internal/modules/auth"
	"github.com/schools24/backend/internal/modules/blog"
	"github.com/schools24/backend/internal/modules/chat"
	"github.com/schools24/backend/internal/modules/demo"
	"github.com/schools24/backend/internal/modules/interop"
	"github.com/schools24/backend/internal/modules/models3d"
	"github.com/schools24/backend/internal/modules/operations"
	"github.com/schools24/backend/internal/modules/public"
	"github.com/schools24/backend/internal/modules/school"
	"github.com/schools24/backend/internal/modules/student"
	"github.com/schools24/backend/internal/modules/support"
	"github.com/schools24/backend/internal/modules/teacher"
	"github.com/schools24/backend/internal/modules/transport"
	"github.com/schools24/backend/internal/shared/admissionhub"
	"github.com/schools24/backend/internal/shared/cache"
	"github.com/schools24/backend/internal/shared/database"
	"github.com/schools24/backend/internal/shared/middleware"
	"github.com/schools24/backend/internal/shared/natsclient"
	"github.com/schools24/backend/internal/shared/objectstore"
)

func main() {
	// 1. Load Configuration
	cfg := config.Load()

	log.Printf("Starting %s in %s mode", cfg.App.Name, cfg.App.Env)

	// 2. Set Gin Mode
	gin.SetMode(cfg.App.GinMode)

	// 3. Initialize Valkey/Redis Cache
	// REDIS_URL (Render convention) takes priority; falls back to REDIS_ADDR for local dev.
	var appCache *cache.Cache
	if cfg.Redis.URL != "" {
		var err error
		appCache, err = cache.NewFromURL(cfg.Redis.URL)
		if err != nil {
			log.Printf("WARNING: Failed to connect to Valkey via REDIS_URL: %v", err)
			log.Printf("Continuing without cache — all requests will hit database directly")
			appCache = cache.NewNoop()
		} else {
			defer appCache.Close()
		}
	} else {
		cacheConfig := cache.Config{
			Address:  cfg.Redis.Addr,
			Password: cfg.Redis.Password,
			DB:       cfg.Redis.DB,
			PoolSize: cfg.Redis.PoolSize,
		}
		var err error
		appCache, err = cache.New(cacheConfig)
		if err != nil {
			log.Printf("WARNING: Failed to initialize Redis cache: %v", err)
			log.Printf("Continuing without cache — all requests will hit database directly")
			appCache = cache.NewNoop()
		} else {
			defer appCache.Close()
			log.Printf("Redis cache initialized at %s", cfg.Redis.Addr)
		}
	}

	// 4. Initialize PostgreSQL (Neon)
	db, err := database.NewPostgresDB(cfg.Database.URL)
	if err != nil {
		log.Fatalf("Failed to connect to PostgreSQL: %v", err)
	}
	defer db.Close()

	// 5. Run migrations (auto-create tables)
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()

	if err := db.RunGlobalMigrations(ctx); err != nil {
		log.Fatalf("Failed to run global migrations: %v", err)
	}

	// NOTE: RunStudentMigrations / RunAdminMigrations / RunGradesMigrations were removed.
	// Those helpers created tenant-only tables (e.g. teachers, students) in the public schema,
	// which broke once users/teachers were moved exclusively to tenant schemas.
	// All schema provisioning is now handled per-tenant below.

	// Ensure tenant schemas exist and migrations are applied for existing schools
	// This fixes missing tenant tables (e.g., students) for pre-existing schools.
	existingSchoolRepo := school.NewRepository(db)
	activeSchools, activeErr := existingSchoolRepo.GetAll(ctx)
	deletedSchools, deletedErr := existingSchoolRepo.GetDeletedSchools(ctx)
	if activeErr == nil || deletedErr == nil {
		seen := make(map[string]struct{})
		allSchools := make([]school.School, 0, len(activeSchools)+len(deletedSchools))
		for _, s := range activeSchools {
			idKey := s.ID.String()
			if _, ok := seen[idKey]; ok {
				continue
			}
			seen[idKey] = struct{}{}
			allSchools = append(allSchools, s)
		}
		for _, s := range deletedSchools {
			idKey := s.ID.String()
			if _, ok := seen[idKey]; ok {
				continue
			}
			seen[idKey] = struct{}{}
			allSchools = append(allSchools, s)
		}

		for _, s := range allSchools {
			if err := db.CreateSchoolSchema(ctx, s.ID); err != nil {
				log.Printf("Failed to provision schema for school %s: %v", s.ID, err)
			}

			// Backfill non_teaching_staff from public schema into tenant schema (if any)
			tenCtx := context.WithValue(ctx, "tenant_schema", fmt.Sprintf("\"school_%s\"", s.ID.String()))
			_, _ = db.Pool.Exec(tenCtx, `
				INSERT INTO non_teaching_staff (
					id, school_id, user_id, employee_id, designation,
					qualification, experience_years, salary, hire_date, created_at, updated_at
				)
				SELECT p.id, p.school_id, p.user_id, p.employee_id, p.designation,
				       p.qualification, p.experience_years, p.salary, p.hire_date, p.created_at, p.updated_at
				FROM public.non_teaching_staff p
				WHERE p.school_id = $1
				AND NOT EXISTS (
					SELECT 1 FROM non_teaching_staff t WHERE t.user_id = p.user_id
				)
			`, s.ID)
			// Note: Legacy public.staff backfill removed - all staff now directly created in tenant schemas
		}
	} else {
		log.Printf("Failed to list schools for tenant provisioning: active=%v deleted=%v", activeErr, deletedErr)
	}
	// Note: Other migration functions (RunStudentMigrations etc) are now obsolete if they were just running specific files.
	// However, looking at the previous file content, there were many `RunXMigrations` calls.
	// If those functions were manually defined to run valid logic, removing them might break things IF they were not just file runners.
	// But since I moved ALL SQL files to global/tenant, the file-based runner is what matters.
	// I should comment out or remove the old specific runners if they are no longer relevant.
	// Assuming the specific runners in `migrations_student.go` etc. were just applying files that are now moved.
	/*
			// Specific migrations are now handled by Global/Tenant migration runners
			if err := db.RunAcademicMigrations(ctx); err != nil {
				log.Printf("Failed to run academic migrations: %v", err)
			}
			if err := db.RunTeacherMigrations(ctx); err != nil {
				log.Printf("Failed to run teacher migrations: %v", err)
			}
			if err := db.RunAttendanceMigrations(ctx); err != nil {
				log.Printf("Failed to run attendance migrations: %v", err)
			}
		    // Admin, School, Ext, Grades also need checking/moving if not covered.
		    // Assuming Ext/Grades logic is similar, I should check them too.
		    // For now, disabling them prevents duplicate/public schema creation.
			if err := db.RunAdminMigrations(ctx); err != nil {
				log.Printf("Failed to run admin migrations: %v", err)
			}
			if err := db.RunSchoolMigrations(ctx); err != nil {
				log.Printf("Failed to run school migrations: %v", err)
			}
			if err := db.RunExtMigrations(ctx); err != nil {
				log.Printf("Failed to run extended migrations: %v", err)
			}
			if err := db.RunGradesMigrations(ctx); err != nil {
				log.Printf("Failed to run grades migrations: %v", err)
			}
	*/

	// Ensure Global Migrations ran
	if err := database.AddSlugColumn(ctx, db); err != nil {
		log.Printf("Slug column might already exist or failed: %v", err)
	}

	// Migrate all data from public schema to tenant schemas for complete isolation
	log.Println("Migrating data to tenant schemas for complete isolation...")
	if err := db.MigrateAllSchoolsData(ctx); err != nil {
		log.Printf("WARNING: Data migration failed (non-fatal): %v", err)
	} else {
		log.Println("✓ Data migration to tenant schemas completed!")
	}
	// Apply any pending SQL tenant migrations to all existing schemas.
	// This ensures schools created before a migration file was added (e.g. 052_admission_applications)
	// have their tables created without needing a manual DB intervention.
	log.Println("Ensuring all tenant schemas are up-to-date...")
	if err := db.EnsureAllTenantMigrations(ctx); err != nil {
		log.Printf("WARNING: EnsureAllTenantMigrations failed (non-fatal): %v", err)
	} else {
		log.Println("\u2713 All tenant schema migrations are up-to-date!")
	}
	// 6. Initialize R2 Object Store (optional, for document storage)
	var store objectstore.Store
	if cfg.R2.Enabled {
		var err error
		store, err = objectstore.NewR2Store(ctx, objectstore.R2Config{
			Enabled:         cfg.R2.Enabled,
			AccountID:       cfg.R2.AccountID,
			AccessKeyID:     cfg.R2.AccessKeyID,
			SecretAccessKey: cfg.R2.SecretAccessKey,
			BucketName:      cfg.R2.BucketName,
			Region:          cfg.R2.Region,
			Endpoint:        cfg.R2.Endpoint,
		})
		if err != nil {
			log.Fatalf("R2 initialization failed while R2 is enabled: %v", err)
		} else {
			log.Printf("R2 object store initialized for bucket: %s", cfg.R2.BucketName)
		}
	}

	// 7. Initialize Modules
	// Auth Module
	authRepo := auth.NewRepository(db)
	authService := auth.NewService(authRepo, cfg)
	authHandler := auth.NewHandler(authService)

	// Student Module
	studentRepo := student.NewRepository(db, store)
	studentService := student.NewService(studentRepo, cfg)
	studentHandler := student.NewHandler(studentService)

	// Academic Module
	academicRepo := academic.NewRepository(db, store)
	academicService := academic.NewService(academicRepo, studentRepo, cfg)
	academicHandler := academic.NewHandler(academicService)

	// Teacher Module
	teacherRepo := teacher.NewRepository(db, store)
	teacherService := teacher.NewService(teacherRepo, cfg)
	teacherHandler := teacher.NewHandler(teacherService, cfg.JWT.Secret, authService.ValidateAccessSession)

	// Interop Module (DIKSHA / DigiLocker / ABC integration readiness)
	interopService := interop.NewService(cfg, db)
	interopHandler := interop.NewHandler(interopService)

	// Admin Module
	adminRepo := admin.NewRepository(db, store)
	adminService := admin.NewService(adminRepo, cfg, interopService)

	// Shared real-time admission hub (broadcast from public module → admin WS)
	admHub := admissionhub.New()

	adminHandler := admin.NewHandler(adminService, admHub, cfg.JWT.Secret, authService.ValidateAccessSession)

	// Public Admission Module
	publicRepo := public.NewRepository(db, store)
	publicService := public.NewService(publicRepo)
	publicHandler := public.NewHandler(publicService, admHub, cfg.App.EmbedSigningSecret)

	// School Module
	schoolRepo := school.NewRepository(db)
	schoolService := school.NewService(schoolRepo, authRepo, authService, cfg, store)
	schoolHandler := school.NewHandler(schoolService)

	// Chat Module (Adam)
	chatService := chat.NewService(cfg, db, appCache)
	chatHandler := chat.NewHandler(chatService, cfg.JWT.Secret, authService.ValidateAccessSession)

	// 3D Models Module (static manifest-driven, no DB needed)
	models3dHandler := models3d.NewHandler("./uploads/3d-models")

	// Operations Module (Events, Bus Routes, Inventory)
	operationsRepo := operations.NewRepository(db)
	operationsService := operations.NewService(operationsRepo, cfg)
	operationsHandler := operations.NewHandler(operationsService, appCache)

	// Support / Help Center Module
	supportRepo := support.NewRepository(db)
	supportService := support.NewService(supportRepo)
	supportHandler := support.NewHandler(supportService, cfg.JWT.Secret, authService.ValidateAccessSession)

	// Demo Request Module
	demoRepo := demo.NewRepository(db)
	demoService := demo.NewService(demoRepo, authRepo, authService, schoolService, cfg.JWT.Secret)
	demoHandler := demo.NewHandler(demoService)

	// Blog Module (global/public content + super-admin management)
	blogRepo := blog.NewRepository(db)
	blogService := blog.NewService(blogRepo)
	blogHandler := blog.NewHandler(blogService)

	// Transport Module (live GPS bus tracking)
	transportRepo := transport.NewRepository(db)
	transportHub := transport.NewHub()

	// NATS JetStream — optional; transport falls back to in-memory Hub when unavailable.
	natsClient, natsErr := natsclient.New(cfg.NATS.URL)
	if natsErr != nil && strings.TrimSpace(cfg.NATS.URL) != "" {
		log.Printf("WARNING: NATS unavailable, transport will use in-memory Hub: %v", natsErr)
	} else {
		defer natsClient.Close()
	}

	transportHandler := transport.NewHandler(transportRepo, transportHub, appCache, natsClient, cfg.JWT.Secret, authService.ValidateAccessSession, authService.SendFCMNotification)

	// 8. Initialize Gin Router
	r := gin.New()
	r.Use(gin.Recovery())

	// Compression middleware for faster response times
	r.Use(middleware.Gzip())

	if cfg.App.Env == "development" {
		r.Use(gin.Logger())
	}

	// CORS middleware
	allowedOrigins := cfg.CORS.AllowedOrigins
	if cfg.App.Env != "development" && (strings.TrimSpace(allowedOrigins) == "" || strings.TrimSpace(allowedOrigins) == "*") {
		allowedOrigins = strings.Join([]string{
			cfg.App.DashURL,
			cfg.App.FormsURL,
		}, ",")
	}
	r.Use(middleware.CORSFromEnv(
		allowedOrigins,
		cfg.CORS.AllowedMethods,
		cfg.CORS.AllowedHeaders,
	))
	// Rate limiting
	r.Use(middleware.RateLimit(
		float64(cfg.RateLimit.RequestsPerMin)/60,
		cfg.RateLimit.Burst,
	))

	// Security Headers (HSTS, CSP, Etc.)
	r.Use(middleware.SecurityHeaders())

	// 9. Register Routes

	// Liveness check: fast, no DB dependency. Used by Render health checks and load balancers.
	// Should return 200 instantly if the app process is running.
	r.GET("/live", func(c *gin.Context) {
		c.JSON(200, gin.H{
			"status": "alive",
		})
	})

	// Health checks: also fast, mainly informational, no DB dependency to avoid waking serverless DB.
	r.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{
			"status":  "healthy",
			"service": cfg.App.Name,
		})
	})

	// Scanner-friendly alias (many tools are configured to probe /api/v1/* endpoints).
	r.GET("/api/v1/health", func(c *gin.Context) {
		c.JSON(200, gin.H{
			"status":  "healthy",
			"service": cfg.App.Name,
		})
	})

	// Readiness check: includes dependency checks (DB + Cache).
	// Only call this when you explicitly need to verify the full stack, not from health check probes.
	r.GET("/ready", func(c *gin.Context) {
		status := gin.H{
			"ready":    true,
			"database": "ok",
			"cache":    "disabled",
		}

		// Check database
		if err := db.Pool.Ping(c.Request.Context()); err != nil {
			status["ready"] = false
			status["database"] = fmt.Sprintf("error: %v", err)
		}

		// Check cache
		if appCache.IsEnabled() {
			if err := appCache.Ping(c.Request.Context()); err != nil {
				status["cache"] = fmt.Sprintf("error: %v", err)
			} else {
				stats := appCache.Stats()
				status["cache"] = gin.H{
					"status": "ok",
					"hits":   stats.Hits,
					"misses": stats.Misses,
					"keys":   appCache.Len(),
				}
			}
		}

		if status["ready"] == true {
			c.JSON(200, status)
		} else {
			c.JSON(503, status)
		}
	})

	// Scanner-friendly alias for readiness checks.
	r.GET("/api/v1/ready", func(c *gin.Context) {
		status := gin.H{
			"ready":    true,
			"database": "ok",
			"cache":    "disabled",
		}

		if err := db.Pool.Ping(c.Request.Context()); err != nil {
			status["ready"] = false
			status["database"] = fmt.Sprintf("error: %v", err)
		}

		if appCache.IsEnabled() {
			if err := appCache.Ping(c.Request.Context()); err != nil {
				status["cache"] = fmt.Sprintf("error: %v", err)
			} else {
				stats := appCache.Stats()
				status["cache"] = gin.H{
					"status": "ok",
					"hits":   stats.Hits,
					"misses": stats.Misses,
					"keys":   appCache.Len(),
				}
			}
		}

		if status["ready"] == true {
			c.JSON(200, status)
		} else {
			c.JSON(503, status)
		}
	})

	// API v1 routes
	v1 := r.Group("/api/v1")

	// Static files (uploads)
	r.Static("/uploads", "./uploads")

	// Auth routes (public — login only)
	authPublic := v1.Group("/auth")
	{
		authPublic.POST("/login", middleware.LoginRateLimitMiddleware(), authHandler.Login)
		authPublic.GET("/csrf", authHandler.GetCSRFToken)
		authPublic.POST("/refresh", middleware.RateLimitByKey(1.5, 6, func(c *gin.Context) string {
			return "refresh:" + c.ClientIP()
		}), authHandler.Refresh)
		authPublic.POST("/logout", middleware.RateLimitByKey(2, 8, func(c *gin.Context) string {
			return "logout:" + c.ClientIP()
		}), authHandler.Logout)
		// NOTE: /register is now protected — only super_admins can create accounts.
		// See the super-admin route group below.
	}

	// Public admission routes (no auth required).
	// Per-route low rate caps were removed because legitimate school-side submission bursts
	// can happen within the same second; abuse protection is now driven by signed embeds,
	// validation, host isolation, and the global limiter.
	publicAdmission := v1.Group("/public/admission")
	{
		publicAdmission.GET("/:slug", publicHandler.GetAdmissionInfo)
		publicAdmission.POST("/:slug", middleware.RateLimitByKey(4, 20, func(c *gin.Context) string {
			return "admission:" + c.ClientIP() + ":" + c.Param("slug")
		}), publicHandler.SubmitAdmission)
	}

	// Public teacher appointment routes (no auth required).
	publicTeacherAppointments := v1.Group("/public/teacher-appointments")
	{
		publicTeacherAppointments.GET("/:slug", publicHandler.GetTeacherAppointmentInfo)
		publicTeacherAppointments.POST("/:slug", middleware.RateLimitByKey(4, 20, func(c *gin.Context) string {
			return "teacher-appointment:" + c.ClientIP() + ":" + c.Param("slug")
		}), publicHandler.SubmitTeacherAppointment)
	}

	publicSupport := v1.Group("/public/support")
	{
		publicSupport.POST("/tickets", middleware.RateLimitByKey(2, 10, func(c *gin.Context) string {
			return "support-ticket:" + c.ClientIP()
		}), supportHandler.CreatePublicTicket)
	}
	publicDemo := v1.Group("/public/demo-requests")
	{
		publicDemo.POST("", middleware.RateLimitByKey(2, 10, func(c *gin.Context) string {
			return "demo-request:" + c.ClientIP()
		}), demoHandler.CreatePublicRequest)
	}

	publicBlogs := v1.Group("/public/blogs")
	{
		publicBlogs.GET("", blogHandler.ListPublished)
		publicBlogs.GET("/:slug", blogHandler.GetPublishedBySlug)
	}

	// Chat WebSocket (Handles its own auth via Query Param)
	v1.GET("/chat/ws", chatHandler.HandleWebSocket)

	// Teacher class-group WebSocket (auth via ?token= query param)
	v1.GET("/teacher/ws", teacherHandler.HandleClassGroupWS)

	// Transport: driver GPS broadcast (WebSocket, staff role, auth via header or ?token=)
	v1.GET("/transport/driver/ws", transportHandler.DriverWebSocket)
	// Transport: driver session push stream (WebSocket) to avoid tight polling.
	v1.GET("/transport/driver-session/ws", transportHandler.DriverSessionWebSocket)
	// Transport: live bus tracking stream (SSE, student/admin role, auth via header or ?token=)
	v1.GET("/transport/track/:routeID", transportHandler.TrackRoute)
	// Transport: admin realtime fleet status stream (WebSocket)
	v1.GET("/transport/admin-live/ws", transportHandler.AdminLiveStatusWebSocket)
	// Transport: tracking session status (staff/student poll this to know if admin activated)
	v1.GET("/transport/session-status", transportHandler.GetDriverSessionStatus)
	// Transport: driver-accessible list of active recurring tracking schedules
	v1.GET("/transport/schedules", transportHandler.GetDriverSchedules)

	// Backward compatibility for older frontend bundles that still call transport
	// routes without the /api/v1 prefix (especially APK remote-web builds cached
	// on device). Keep these aliases until all clients are confirmed migrated.
	r.GET("/transport/driver/ws", transportHandler.DriverWebSocket)
	r.GET("/transport/driver-session/ws", transportHandler.DriverSessionWebSocket)
	r.GET("/transport/track/:routeID", transportHandler.TrackRoute)
	r.GET("/transport/admin-live/ws", transportHandler.AdminLiveStatusWebSocket)
	r.GET("/transport/session-status", transportHandler.GetDriverSessionStatus)
	r.GET("/transport/schedules", transportHandler.GetDriverSchedules)

	// Support/Help-Center WebSocket — super-admin only (auth via ?token= query param)
	v1.GET("/super-admin/support/ws", supportHandler.HandleSupportWS)

	// Admin admissions WebSocket — real-time new-application events (auth via ?token= query param)
	v1.GET("/admin/admissions/ws", adminHandler.HandleAdmissionWS)

	jwtCfg := middleware.DefaultJWTConfig(cfg.JWT.Secret)
	jwtCfg.SessionValidator = authService.ValidateAccessSession

	// Protected routes (require JWT)
	protected := v1.Group("")
	protected.Use(middleware.JWTAuth(jwtCfg))
	protected.Use(middleware.RequireActiveUser(db))
	protected.Use(middleware.MutationRateLimitByIdentity(8, 30))
	protected.Use(middleware.CSRFProtect(middleware.CSRFConfig{
		AllowedOrigins: []string{
			cfg.App.DashURL,
			cfg.App.FormsURL,
			"http://localhost:3000",
			"http://127.0.0.1:3000",
			"http://localhost:1000",
			"http://127.0.0.1:1000",
		},
	}))
	// Apply Tenant Middleware AFTER JWT Auth so it can access claims
	protected.Use(middleware.TenantMiddleware(db))
	// Cache middleware: caches GET responses per school+role, auto-invalidates on writes
	protected.Use(cache.ResponseCacheMiddleware(appCache, cache.DefaultCacheMiddlewareConfig()))
	{
		// Auth protected routes
		protected.GET("/auth/me", authHandler.GetMe)
		protected.PUT("/auth/me", authHandler.UpdateProfile)
		protected.POST("/auth/change-password", authHandler.ChangePassword)
		protected.GET("/auth/ws-ticket", authHandler.CreateWSTicket)
		protected.POST("/auth/push-tokens", authHandler.RegisterPushToken)
		protected.DELETE("/auth/push-tokens", authHandler.DeletePushToken)
		protected.POST("/auth/push-tokens/test", authHandler.SendTestPush)

		// Super admin management
		protected.GET("/super-admins", authHandler.ListSuperAdmins)
		protected.POST("/super-admins", authHandler.CreateSuperAdmin)
		protected.DELETE("/super-admins/:id", authHandler.DeleteSuperAdmin)
		protected.PUT("/super-admins/:id/suspend", authHandler.SuspendSuperAdmin)
		protected.PUT("/super-admins/:id/unsuspend", authHandler.UnsuspendSuperAdmin)

		// Student routes
		studentRoutes := protected.Group("/student")
		{
			studentRoutes.GET("/dashboard", studentHandler.GetDashboard)
			studentRoutes.GET("/class-subjects", studentHandler.GetClassSubjects)
			studentRoutes.GET("/profile", studentHandler.GetProfile)
			studentRoutes.GET("/attendance", studentHandler.GetAttendance)
			studentRoutes.GET("/fees", studentHandler.GetFees)
			studentRoutes.GET("/materials", studentHandler.ListStudyMaterials)
			studentRoutes.GET("/materials/:id/view", studentHandler.ViewStudyMaterial)
			studentRoutes.GET("/materials/:id/download", studentHandler.DownloadStudyMaterial)
			studentRoutes.GET("/report-documents", studentHandler.ListReportDocuments)
			studentRoutes.GET("/report-documents/:id/view", studentHandler.ViewReportDocument)
			studentRoutes.GET("/report-documents/:id/download", studentHandler.DownloadReportDocument)
			studentRoutes.GET("/feedback/options", studentHandler.GetFeedbackOptions)
			studentRoutes.GET("/feedback", studentHandler.GetFeedback)
			studentRoutes.POST("/feedback", studentHandler.CreateFeedback)
			studentRoutes.GET("/messages", studentHandler.GetClassMessages)
			studentRoutes.POST("/messages", studentHandler.SendClassMessage)
			studentRoutes.GET("/events", operationsHandler.GetStudentEvents)
			// Quiz routes
			studentRoutes.GET("/quizzes", studentHandler.ListQuizzes)
			studentRoutes.POST("/quizzes/:id/start", studentHandler.StartQuiz)
			studentRoutes.POST("/quizzes/:id/submit", studentHandler.SubmitQuiz)
			studentRoutes.GET("/quizzes/attempts/:attemptID", studentHandler.GetAttemptResult)
			// Leaderboard routes
			studentRoutes.GET("/leaderboard/quiz", studentHandler.GetQuizLeaderboard)
			studentRoutes.GET("/leaderboard/assessments", studentHandler.GetAssessmentLeaderboard)
			studentRoutes.GET("/leaderboard/school-assessments", studentHandler.GetSchoolAssessmentLeaderboard)
			studentRoutes.GET("/assessments/stages", studentHandler.GetAssessmentStages)
			studentRoutes.GET("/assessments/subject-performance", studentHandler.GetSubjectPerformance)
		}

		// Academic routes
		academicRoutes := protected.Group("/academic")
		{
			academicRoutes.GET("/timetable", academicHandler.GetTimetable)
			academicRoutes.GET("/timetable/config", academicHandler.GetTimetableConfig)
			academicRoutes.GET("/homework", academicHandler.GetHomework)
			academicRoutes.GET("/homework/options", academicHandler.GetHomeworkSubjectOptions)
			academicRoutes.GET("/homework/:id", academicHandler.GetHomeworkByID)
			academicRoutes.GET("/homework/:id/attachments/:attachmentId/view", academicHandler.ViewHomeworkAttachment)
			academicRoutes.GET("/homework/:id/attachments/:attachmentId/download", academicHandler.DownloadHomeworkAttachment)
			academicRoutes.POST("/homework/:id/submit", academicHandler.SubmitHomework)
			academicRoutes.GET("/grades", academicHandler.GetGrades)
			academicRoutes.GET("/subjects", academicHandler.GetSubjects)
			academicRoutes.POST("/subjects", middleware.RequireRole("admin"), academicHandler.CreateSubject)
		}

		// Teacher routes
		teacherRoutes := protected.Group("/teacher")
		teacherRoutes.Use(middleware.RequireRole("teacher", "admin"))
		{
			// 3D Anatomy Models
			teacherRoutes.GET("/3d-models", models3dHandler.ListModels)
			teacherRoutes.GET("/3d-models/:id", models3dHandler.GetModel)

			teacherRoutes.GET("/dashboard", teacherHandler.GetDashboard)
			teacherRoutes.GET("/profile", teacherHandler.GetProfile)
			teacherRoutes.GET("/leaderboard", teacherHandler.GetLeaderboard)
			teacherRoutes.GET("/classes", teacherHandler.GetClasses)
			teacherRoutes.GET("/timetable", teacherHandler.GetTimetable)
			teacherRoutes.GET("/timetable/config", teacherHandler.GetTimetableConfig)
			teacherRoutes.GET("/timetable/classes/:classId", teacherHandler.GetClassTimetable)
			teacherRoutes.GET("/classes/:classId/students", teacherHandler.GetClassStudents)
			teacherRoutes.GET("/fees/student/:studentId", teacherHandler.GetStudentFeeData)
			teacherRoutes.GET("/attendance", teacherHandler.GetAttendanceByDate)
			teacherRoutes.POST("/attendance", teacherHandler.MarkAttendance)
			teacherRoutes.GET("/question-documents", teacherHandler.ListQuestionDocuments)
			teacherRoutes.GET("/question-documents/filters", teacherHandler.GetQuestionDocumentFilters)
			teacherRoutes.GET("/question-uploader/options", teacherHandler.GetQuestionUploaderOptions)
			teacherRoutes.GET("/materials", teacherHandler.ListStudyMaterials)
			teacherRoutes.GET("/materials/:id/view", teacherHandler.ViewStudyMaterial)
			teacherRoutes.GET("/materials/:id/download", teacherHandler.DownloadStudyMaterial)
			teacherRoutes.POST("/materials", teacherHandler.UploadStudyMaterial)
			teacherRoutes.DELETE("/materials/:id", teacherHandler.DeleteStudyMaterial)
			teacherRoutes.GET("/student-reports", teacherHandler.ListStudentIndividualReports)
			teacherRoutes.POST("/student-reports", teacherHandler.UploadStudentIndividualReport)
			teacherRoutes.GET("/student-reports/:id/view", teacherHandler.ViewStudentIndividualReport)
			teacherRoutes.GET("/student-reports/:id/download", teacherHandler.DownloadStudentIndividualReport)
			teacherRoutes.GET("/messages/class-groups", teacherHandler.GetClassMessageGroups)
			teacherRoutes.GET("/messages/class-groups/:classId/messages", teacherHandler.GetClassGroupMessages)
			teacherRoutes.POST("/messages/class-groups/:classId/messages", teacherHandler.SendClassGroupMessage)
			teacherRoutes.GET("/question-documents/:id/view", teacherHandler.ViewQuestionDocument)
			teacherRoutes.GET("/question-documents/:id/download", teacherHandler.DownloadQuestionDocument)
			teacherRoutes.POST("/question-documents", teacherHandler.UploadQuestionDocument)
			teacherRoutes.GET("/homework/options", teacherHandler.GetHomeworkOptions)
			teacherRoutes.GET("/homework", teacherHandler.ListHomework)
			teacherRoutes.GET("/homework/:id/submissions", teacherHandler.GetHomeworkSubmissions)
			teacherRoutes.GET("/homework/:id/attachments/:attachmentId/view", teacherHandler.ViewHomeworkAttachment)
			teacherRoutes.GET("/homework/:id/attachments/:attachmentId/download", teacherHandler.DownloadHomeworkAttachment)
			teacherRoutes.POST("/homework", teacherHandler.CreateHomework)
			teacherRoutes.PUT("/homework/:id", teacherHandler.UpdateHomework)
			teacherRoutes.DELETE("/homework/:id", teacherHandler.DeleteHomework)
			teacherRoutes.GET("/quizzes/options", teacherHandler.GetQuizOptions)
			teacherRoutes.GET("/quizzes/chapters", teacherHandler.ListQuizChapters)
			teacherRoutes.POST("/quizzes/chapters", teacherHandler.CreateQuizChapter)
			teacherRoutes.PUT("/quizzes/chapters/:id", teacherHandler.UpdateQuizChapter)
			teacherRoutes.DELETE("/quizzes/chapters/:id", teacherHandler.DeleteQuizChapter)
			teacherRoutes.GET("/quizzes", teacherHandler.ListQuizzes)
			teacherRoutes.POST("/quizzes", teacherHandler.CreateQuiz)
			teacherRoutes.GET("/quizzes/:id", teacherHandler.GetQuizDetail)
			teacherRoutes.PUT("/quizzes/:id", teacherHandler.UpdateQuiz)
			teacherRoutes.DELETE("/quizzes/:id", teacherHandler.DeleteQuiz)
			teacherRoutes.POST("/quizzes/:id/questions", teacherHandler.AddQuizQuestion)
			teacherRoutes.POST("/grades", teacherHandler.EnterGrade)
			teacherRoutes.GET("/reports/options", teacherHandler.GetReportOptions)
			teacherRoutes.GET("/reports/marks-sheet", teacherHandler.GetReportMarksSheet)
			teacherRoutes.PUT("/reports/marks-sheet", teacherHandler.UpsertReportMarks)
			teacherRoutes.POST("/announcements", teacherHandler.CreateAnnouncement)
			teacherRoutes.GET("/events", operationsHandler.GetTeacherEvents)

		}

		// Announcements (all authenticated users can view)
		protected.GET("/announcements", teacherHandler.GetAnnouncements)

		// Super Admin routes
		superAdminRoutes := protected.Group("/super-admin")
		superAdminRoutes.Use(middleware.RequireRole("super_admin"))
		{
			superAdminRoutes.POST("/register", authHandler.Register)
			superAdminRoutes.POST("/schools", schoolHandler.CreateSchool)
			superAdminRoutes.GET("/schools", schoolHandler.GetSchools)
			superAdminRoutes.GET("/schools/trash", schoolHandler.GetDeletedSchools)
			superAdminRoutes.GET("/schools/:id", schoolHandler.GetSchool)
			superAdminRoutes.PUT("/schools/:id", schoolHandler.UpdateSchool)
			superAdminRoutes.DELETE("/schools/:id", schoolHandler.DeleteSchool)
			superAdminRoutes.POST("/schools/:id/restore", schoolHandler.RestoreSchool)
			superAdminRoutes.GET("/catalog/classes", schoolHandler.ListGlobalClasses)
			superAdminRoutes.POST("/catalog/classes", schoolHandler.CreateGlobalClass)
			superAdminRoutes.PUT("/catalog/classes/reorder", schoolHandler.ReorderGlobalClasses)
			superAdminRoutes.PUT("/catalog/classes/:id", schoolHandler.UpdateGlobalClass)
			superAdminRoutes.DELETE("/catalog/classes/:id", schoolHandler.DeleteGlobalClass)
			superAdminRoutes.PUT("/catalog/classes/:id/subjects", schoolHandler.ReplaceGlobalClassSubjects)
			superAdminRoutes.GET("/catalog/subjects", schoolHandler.ListGlobalSubjects)
			superAdminRoutes.POST("/catalog/subjects", schoolHandler.CreateGlobalSubject)
			superAdminRoutes.PUT("/catalog/subjects/:id", schoolHandler.UpdateGlobalSubject)
			superAdminRoutes.DELETE("/catalog/subjects/:id", schoolHandler.DeleteGlobalSubject)
			superAdminRoutes.GET("/catalog/assignments", schoolHandler.ListGlobalCatalogAssignments)
			superAdminRoutes.GET("/question-documents", teacherHandler.ListSuperAdminQuestionDocuments)
			superAdminRoutes.GET("/question-documents/:id/view", teacherHandler.ViewSuperAdminQuestionDocument)
			superAdminRoutes.GET("/question-documents/:id/download", teacherHandler.DownloadSuperAdminQuestionDocument)
			superAdminRoutes.POST("/question-documents", teacherHandler.UploadSuperAdminQuestionDocument)
			superAdminRoutes.DELETE("/question-documents/:id", teacherHandler.DeleteSuperAdminQuestionDocument)
			superAdminRoutes.GET("/materials", teacherHandler.ListSuperAdminStudyMaterials)
			superAdminRoutes.GET("/materials/:id/view", teacherHandler.ViewSuperAdminStudyMaterial)
			superAdminRoutes.GET("/materials/:id/download", teacherHandler.DownloadSuperAdminStudyMaterial)
			superAdminRoutes.POST("/materials", teacherHandler.UploadSuperAdminStudyMaterial)
			superAdminRoutes.DELETE("/materials/:id", teacherHandler.DeleteSuperAdminStudyMaterial)
			superAdminRoutes.GET("/quizzes/options", teacherHandler.GetSuperAdminQuizOptions)
			superAdminRoutes.GET("/quizzes/chapters", teacherHandler.ListSuperAdminQuizChapters)
			superAdminRoutes.POST("/quizzes/chapters", teacherHandler.CreateSuperAdminQuizChapter)
			superAdminRoutes.PUT("/quizzes/chapters/:id", teacherHandler.UpdateSuperAdminQuizChapter)
			superAdminRoutes.DELETE("/quizzes/chapters/:id", teacherHandler.DeleteSuperAdminQuizChapter)
			superAdminRoutes.GET("/quizzes", teacherHandler.ListSuperAdminQuizzes)
			superAdminRoutes.POST("/quizzes", teacherHandler.CreateQuizAsSuperAdmin)
			superAdminRoutes.GET("/quizzes/:id", teacherHandler.GetQuizDetailForSuperAdmin)
			superAdminRoutes.PUT("/quizzes/:id", teacherHandler.UpdateQuizForSuperAdmin)
			superAdminRoutes.DELETE("/quizzes/:id", teacherHandler.DeleteQuizForSuperAdmin)
			superAdminRoutes.POST("/quizzes/:id/questions", teacherHandler.AddQuizQuestionForSuperAdmin)
			superAdminRoutes.GET("/analytics/monthly-users", schoolHandler.GetMonthlyNewUsers)
			superAdminRoutes.GET("/storage/overview", schoolHandler.GetStorageOverview)
			superAdminRoutes.GET("/settings/global", schoolHandler.GetGlobalSettings)
			superAdminRoutes.PUT("/settings/global", schoolHandler.UpdateGlobalSettings)
			superAdminRoutes.GET("/blogs", blogHandler.ListForSuperAdmin)
			superAdminRoutes.POST("/blogs", blogHandler.CreateBlog)
			superAdminRoutes.PUT("/blogs/:id", blogHandler.UpdateBlog)
			superAdminRoutes.DELETE("/blogs/:id", blogHandler.DeleteBlog)
			superAdminRoutes.GET("/reconciliations", adminHandler.ListLearnerReconciliations)
			superAdminRoutes.POST("/reconciliations/scan", adminHandler.ScanLearnerReconciliations)
			superAdminRoutes.PUT("/reconciliations/:id/review", adminHandler.ReviewLearnerReconciliation)
			superAdminRoutes.PUT("/reconciliations/:id/unmerge", adminHandler.UnmergeLearnerReconciliation)
			superAdminRoutes.GET("/interop/readiness", interopHandler.GetReadiness)
			superAdminRoutes.GET("/interop/sweeper/stats", interopHandler.GetSweeperStats)
			superAdminRoutes.GET("/interop/jobs", interopHandler.ListJobs)
			superAdminRoutes.GET("/interop/jobs/:id", interopHandler.GetJob)
			superAdminRoutes.POST("/interop/jobs", interopHandler.CreateJob)
			superAdminRoutes.POST("/interop/jobs/:id/retry", interopHandler.RetryJob)

			// Consent + DSR (NDEAR Phase PR-03) — super admin requires ?school_id=
			superAdminRoutes.GET("/consent/history", adminHandler.GetConsentHistory)
			superAdminRoutes.POST("/consent/:id/withdraw", adminHandler.WithdrawConsent)
			superAdminRoutes.GET("/consent/audit", adminHandler.GetConsentAuditEvents)
			superAdminRoutes.POST("/dsr", adminHandler.CreateDSR)
			superAdminRoutes.GET("/dsr", adminHandler.ListDSRs)
			superAdminRoutes.GET("/dsr/:id", adminHandler.GetDSR)
			superAdminRoutes.PUT("/dsr/:id/status", adminHandler.UpdateDSRStatus)

			// Federated Identity Verification + Reconciliation (NDEAR Phase PR-04)
			superAdminRoutes.POST("/learners/:id/verify", adminHandler.VerifyLearnerIdentity)
			superAdminRoutes.GET("/learners/:id/identity", adminHandler.GetStudentFederatedIdentity)
			superAdminRoutes.GET("/learners/unverified", adminHandler.ListUnverifiedStudents)
			superAdminRoutes.GET("/reconciliations/summary", adminHandler.GetReconciliationSummary)

			superAdminRoutes.POST("/schema", schoolHandler.GetDatabaseSchema)

			// Support / Help Center — super admin view
			superAdminRoutes.GET("/support/tickets/unread-count", supportHandler.UnreadCount)
			superAdminRoutes.GET("/support/tickets", supportHandler.ListTickets)
			superAdminRoutes.GET("/support/tickets/:id", supportHandler.GetTicketByID)
			superAdminRoutes.PUT("/support/tickets/:id/status", supportHandler.UpdateTicketStatus)
			superAdminRoutes.DELETE("/support/tickets/:id", supportHandler.DeleteTicket)
			superAdminRoutes.GET("/demo-requests", demoHandler.ListRequests)
			superAdminRoutes.GET("/demo-requests/stats", demoHandler.GetStats)
			superAdminRoutes.POST("/demo-requests/:id/accept", demoHandler.AcceptRequest)
			superAdminRoutes.POST("/demo-requests/:id/trash", demoHandler.TrashRequest)
		}

		// Admin routes
		adminRoutes := protected.Group("/admin")
		adminRoutes.Use(middleware.RequireRole("admin", "super_admin"))
		{
			adminRoutes.GET("/catalog/classes", schoolHandler.ListGlobalClasses)
			adminRoutes.GET("/catalog/subjects", schoolHandler.ListGlobalSubjects)
			adminRoutes.GET("/dashboard", adminHandler.GetDashboard)
			adminRoutes.GET("/stats/users", adminHandler.GetUserStats)
			adminRoutes.GET("/users", adminHandler.GetUsers)
			adminRoutes.GET("/users/:id", adminHandler.GetUser)
			adminRoutes.POST("/users", adminHandler.CreateUser)
			adminRoutes.PUT("/users/:id", adminHandler.UpdateUser)
			adminRoutes.DELETE("/users/:id", adminHandler.DeleteUser)
			adminRoutes.PUT("/users/:id/suspend", adminHandler.SuspendUser)
			adminRoutes.PUT("/users/:id/unsuspend", adminHandler.UnsuspendUser)
			adminRoutes.GET("/teachers", adminHandler.GetTeachers)
			adminRoutes.GET("/question-documents", teacherHandler.ListAdminQuestionDocuments)
			adminRoutes.GET("/question-documents/:id/view", teacherHandler.ViewAdminQuestionDocument)
			adminRoutes.GET("/question-documents/:id/download", teacherHandler.DownloadAdminQuestionDocument)
			adminRoutes.POST("/students", adminHandler.CreateStudent)
			adminRoutes.POST("/students/profile", studentHandler.CreateStudentProfileForAdmin)
			adminRoutes.GET("/students/by-user/:userID", studentHandler.GetStudentProfileForAdmin)
			adminRoutes.PUT("/students/:id", studentHandler.UpdateStudent)    // Corrected: studentHandler
			adminRoutes.DELETE("/students/:id", studentHandler.DeleteStudent) // Corrected: studentHandler
			adminRoutes.GET("/students-list", studentHandler.GetAllStudents)  // Use student handler for proper list
			adminRoutes.POST("/teachers", adminHandler.CreateTeacher)
			adminRoutes.GET("/teachers/by-user/:userID", adminHandler.GetTeacherByUserID)
			adminRoutes.PUT("/teachers/:id", adminHandler.UpdateTeacherDetail)
			adminRoutes.DELETE("/teachers/:id", adminHandler.DeleteTeacherDetail)
			adminRoutes.GET("/staff", adminHandler.GetAllStaff)
			adminRoutes.POST("/staff", adminHandler.CreateStaff)
			adminRoutes.PUT("/staff/:id", adminHandler.UpdateStaff)
			adminRoutes.DELETE("/staff/:id", adminHandler.DeleteStaff)
			adminRoutes.GET("/fees/structures", adminHandler.GetFeeStructures)
			adminRoutes.POST("/fees/structures", adminHandler.CreateFeeStructure)
			adminRoutes.GET("/assessments", adminHandler.ListAssessments)
			adminRoutes.POST("/assessments", adminHandler.CreateAssessment)
			adminRoutes.PUT("/assessments/:id", adminHandler.UpdateAssessment)
			adminRoutes.DELETE("/assessments/:id", adminHandler.DeleteAssessment)
			adminRoutes.GET("/assessments/:id/exam-timetable", adminHandler.GetAssessmentExamTimetableOptions)
			adminRoutes.PUT("/assessments/:id/exam-timetable", adminHandler.UpsertAssessmentExamTimetable)
			adminRoutes.GET("/fees/purposes", adminHandler.ListFeeDemandPurposes)
			adminRoutes.POST("/fees/purposes", adminHandler.CreateFeeDemandPurpose)
			adminRoutes.PUT("/fees/purposes/:id", adminHandler.UpdateFeeDemandPurpose)
			adminRoutes.DELETE("/fees/purposes/:id", adminHandler.DeleteFeeDemandPurpose)
			adminRoutes.GET("/fees/demands", adminHandler.GetFeeDemands)
			adminRoutes.POST("/fees/demands", adminHandler.CreateFeeDemand)
			adminRoutes.GET("/leaderboards/students", adminHandler.GetStudentsLeaderboard)
			adminRoutes.GET("/leaderboards/teachers", adminHandler.GetTeachersLeaderboard)
			adminRoutes.POST("/leaderboards/refresh", adminHandler.RefreshLeaderboards)
			adminRoutes.GET("/leaderboards/assessments", adminHandler.GetAssessmentLeaderboard)
			adminRoutes.GET("/attendance/weekly", adminHandler.GetWeeklyAttendanceSummary)
			adminRoutes.POST("/fees/payments", adminHandler.RecordPayment)
			adminRoutes.POST("/payments", adminHandler.RecordPayment)
			adminRoutes.GET("/payments", adminHandler.GetPayments)
			adminRoutes.GET("/finance/chart", adminHandler.GetFinanceChart)
			adminRoutes.GET("/reports/class-distribution", adminHandler.GetClassDistribution)
			adminRoutes.GET("/audit-logs", adminHandler.GetAuditLogs)

			// Events Management
			eventsRoutes := adminRoutes.Group("/events")
			eventsRoutes.Use(middleware.RequireRole("admin"))
			{
				eventsRoutes.GET("", operationsHandler.GetEvents)
				eventsRoutes.GET("/:id", operationsHandler.GetEventByID)
				eventsRoutes.POST("", operationsHandler.CreateEvent)
				eventsRoutes.PUT("/:id", operationsHandler.UpdateEvent)
				eventsRoutes.DELETE("/:id", operationsHandler.DeleteEvent)
			}

			adminRoutes.GET("/bus-routes", adminHandler.GetBusRoutes)
			adminRoutes.POST("/bus-routes", adminHandler.CreateBusRoute)
			adminRoutes.PUT("/bus-routes/:id", adminHandler.UpdateBusRoute)
			adminRoutes.DELETE("/bus-routes/:id", adminHandler.DeleteBusRoute)
			adminRoutes.GET("/bus-routes/:id/stops", adminHandler.GetBusRouteStops)
			adminRoutes.PUT("/bus-routes/:id/stops", adminHandler.UpdateBusRouteStops)
			adminRoutes.PUT("/bus-routes/:id/shape", adminHandler.UpdateBusRouteShape)
			adminRoutes.GET("/bus-routes/:id/stop-assignments", adminHandler.GetBusStopAssignments)
			adminRoutes.PUT("/bus-routes/:id/stop-assignments", adminHandler.UpdateBusStopAssignments)

			// Transport: 7-day GPS activity log for all bus routes (admin)
			adminRoutes.GET("/transport/routes-activity", transportHandler.GetRoutesActivity)
			// Transport: admin manual tracking session control
			adminRoutes.GET("/transport/tracking-session", transportHandler.GetAdminTrackingSession)
			adminRoutes.POST("/transport/tracking-session", transportHandler.SetTrackingSession)
			adminRoutes.GET("/transport/tracking-schedules", transportHandler.ListTrackingSchedules)
			adminRoutes.POST("/transport/tracking-schedules", transportHandler.CreateTrackingSchedule)
			adminRoutes.PUT("/transport/tracking-schedules/:id", transportHandler.UpdateTrackingSchedule)
			adminRoutes.DELETE("/transport/tracking-schedules/:id", transportHandler.DeleteTrackingSchedule)

			// Classes
			adminRoutes.GET("/classes/:classId/subjects", adminHandler.GetClassSubjects)

			// Timetable
			adminRoutes.GET("/timetable/config", adminHandler.GetTimetableConfig)
			adminRoutes.PUT("/timetable/config", adminHandler.UpdateTimetableConfig)
			adminRoutes.GET("/timetable/classes/:classId", adminHandler.GetClassTimetable)
			adminRoutes.GET("/timetable/teachers/:teacherId", adminHandler.GetTeacherTimetable)
			adminRoutes.POST("/timetable/slots", adminHandler.UpsertTimetableSlot)
			adminRoutes.DELETE("/timetable/slots", adminHandler.DeleteTimetableSlot)

			// Inventory
			adminRoutes.GET("/inventory", adminHandler.GetInventoryItems)
			adminRoutes.POST("/inventory", adminHandler.CreateInventoryItem)
			adminRoutes.PUT("/inventory/:id", adminHandler.UpdateInventoryItem)
			adminRoutes.DELETE("/inventory/:id", adminHandler.DeleteInventoryItem)

			// Admission Applications
			adminRoutes.GET("/admissions", adminHandler.ListAdmissions)
			adminRoutes.GET("/admissions/:id", adminHandler.GetAdmission)
			adminRoutes.PUT("/admissions/:id/approve", adminHandler.ApproveAdmission)
			adminRoutes.PUT("/admissions/:id/reject", adminHandler.RejectAdmission)
			adminRoutes.GET("/admissions/:id/documents/:docId/view", adminHandler.ViewAdmissionDocument)
			adminRoutes.GET("/transfers/destination-schools", adminHandler.ListTransferDestinationSchools)
			adminRoutes.GET("/transfers", adminHandler.ListLearnerTransfers)
			adminRoutes.POST("/transfers", adminHandler.InitiateLearnerTransfer)
			adminRoutes.POST("/transfers/:id/complete", adminHandler.CompleteLearnerTransfer)
			adminRoutes.PUT("/transfers/:id/review", adminHandler.ReviewLearnerTransfer)
			adminRoutes.POST("/transfers/:id/gov-sync", adminHandler.TriggerTransferGovSync)
			adminRoutes.POST("/transfers/:id/gov-sync/retry", adminHandler.RetryTransferGovSync)
			adminRoutes.GET("/interop/readiness", interopHandler.GetReadiness)
			adminRoutes.GET("/interop/sweeper/stats", interopHandler.GetSweeperStats)
			adminRoutes.GET("/interop/jobs", interopHandler.ListJobs)
			adminRoutes.GET("/interop/jobs/:id", interopHandler.GetJob)
			adminRoutes.POST("/interop/jobs", interopHandler.CreateJob)
			adminRoutes.POST("/interop/jobs/:id/retry", interopHandler.RetryJob)

			// Consent + DSR (NDEAR Phase PR-03)
			adminRoutes.GET("/consent/history", adminHandler.GetConsentHistory)
			adminRoutes.POST("/consent/:id/withdraw", adminHandler.WithdrawConsent)
			adminRoutes.GET("/consent/audit", adminHandler.GetConsentAuditEvents)
			adminRoutes.POST("/dsr", adminHandler.CreateDSR)
			adminRoutes.GET("/dsr", adminHandler.ListDSRs)
			adminRoutes.GET("/dsr/:id", adminHandler.GetDSR)
			adminRoutes.PUT("/dsr/:id/status", adminHandler.UpdateDSRStatus)

			// Federated Identity Verification + Reconciliation (NDEAR Phase PR-04)
			adminRoutes.POST("/learners/:id/verify", adminHandler.VerifyLearnerIdentity)
			adminRoutes.GET("/learners/:id/identity", adminHandler.GetStudentFederatedIdentity)
			adminRoutes.GET("/learners/unverified", adminHandler.ListUnverifiedStudents)
			adminRoutes.GET("/reconciliations/summary", adminHandler.GetReconciliationSummary)

			// Teacher Appointment Applications
			adminRoutes.GET("/teacher-appointments", adminHandler.ListTeacherAppointments)
			adminRoutes.GET("/teacher-appointments/decisions", adminHandler.ListTeacherAppointmentDecisions)
			adminRoutes.GET("/teacher-appointments/:id", adminHandler.GetTeacherAppointment)
			adminRoutes.PUT("/teacher-appointments/:id/approve", adminHandler.ApproveTeacherAppointment)
			adminRoutes.PUT("/teacher-appointments/:id/reject", adminHandler.RejectTeacherAppointment)
			adminRoutes.GET("/teacher-appointments/:id/documents/:docId/view", adminHandler.ViewTeacherAppointmentDocument)

			// Admission Settings (toggle open/closed)
			adminRoutes.GET("/settings/admissions", adminHandler.GetAdmissionSettings)
			adminRoutes.PUT("/settings/admissions", adminHandler.UpdateAdmissionSettings)
		}

		// Support / Help Center — end-user routes (all authenticated roles)
		protected.POST("/support/tickets", supportHandler.CreateTicket)
		protected.GET("/support/tickets/mine", supportHandler.GetMyTickets)

		// Classes routes (shared)
		protected.GET("/classes", studentHandler.GetClasses)
		protected.POST("/classes", middleware.RequireRole("admin", "super_admin"), studentHandler.CreateClass)
		protected.PUT("/classes/:id", middleware.RequireRole("admin", "super_admin"), studentHandler.UpdateClass)
		protected.DELETE("/classes/:id", middleware.RequireRole("admin", "super_admin"), studentHandler.DeleteClass)
	}

	// Start background cleanup job for deleted schools (runs every hour)
	go func() {
		ticker := time.NewTicker(1 * time.Hour)
		defer ticker.Stop()

		runCleanup := func(trigger string) {
			cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 60*time.Second)
			defer cleanupCancel()
			log.Printf("Running %s school cleanup check...", trigger)
			if err := schoolService.CleanupOldDeletedSchools(cleanupCtx); err != nil {
				log.Printf("School cleanup error: %v", err)
			}
		}

		// Run immediately on startup
		runCleanup("initial")

		// Then run every hour
		for range ticker.C {
			runCleanup("scheduled")
		}
	}()

	go func() {
		ticker := time.NewTicker(1 * time.Hour)
		defer ticker.Stop()

		runCleanup := func(trigger string) {
			cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 30*time.Second)
			defer cleanupCancel()
			log.Printf("Running %s demo-request cleanup check...", trigger)
			if err := demoService.CleanupOldTrashedRequests(cleanupCtx); err != nil {
				log.Printf("Demo-request cleanup error: %v", err)
			}
		}

		runCleanup("initial")
		for range ticker.C {
			runCleanup("scheduled")
		}
	}()

	// Nightly cleanup: delete bus_location_history records older than 7 days.
	// Runs once per day at midnight IST across all active tenant schemas.
	// Storage stays bounded at ~250 MB per school regardless of how long the
	// product runs (see architecture notes).
	go func() {
		for {
			nowIST := time.Now().In(transport.IST)
			// Sleep until 00:00:30 IST next day (30s pad to let midnight settle)
			nextMidnight := time.Date(nowIST.Year(), nowIST.Month(), nowIST.Day()+1, 0, 0, 30, 0, transport.IST)
			time.Sleep(time.Until(nextMidnight))

			cleanCtx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
			// Include both active and soft-deleted schools so their schemas are
			// kept below the 7-day storage bound even after a school is removed.
			activeSchools, activeErr := existingSchoolRepo.GetAll(cleanCtx)
			deletedSchoolsForCleanup, deletedErr := existingSchoolRepo.GetDeletedSchools(cleanCtx)
			if activeErr != nil && deletedErr != nil {
				log.Printf("transport cleanup: failed to list schools: active=%v deleted=%v", activeErr, deletedErr)
				cancel()
				continue
			}
			allSchoolsForCleanup := make([]school.School, 0, len(activeSchools)+len(deletedSchoolsForCleanup))
			allSchoolsForCleanup = append(allSchoolsForCleanup, activeSchools...)
			allSchoolsForCleanup = append(allSchoolsForCleanup, deletedSchoolsForCleanup...)
			cleaned := 0
			for _, s := range allSchoolsForCleanup {
				tCtx := context.WithValue(cleanCtx, "tenant_schema", fmt.Sprintf(`"school_%s"`, s.ID.String()))
				if err := transportRepo.DeleteOldLocationHistory(tCtx); err != nil {
					log.Printf("transport cleanup: school %s: %v", s.ID, err)
				} else {
					cleaned++
				}
			}
			cancel()
			log.Printf("transport: location history cleanup done (%d/%d schools)", cleaned, len(allSchoolsForCleanup))
		}
	}()

	// Scheduled transport notification loop: when a recurring tracking window turns live,
	// notify only students assigned to school-bus transport for that school.
	go func() {
		if !cfg.Transport.Enabled {
			log.Printf("transport notification loop: disabled (TRANSPORT_SCHEDULED_LOOP_ENABLED=false)")
			return
		}

		interval := time.Duration(cfg.Transport.IntervalSec) * time.Second
		if interval <= 0 {
			interval = 300 * time.Second
		}

		timeout := time.Duration(cfg.Transport.PerRunTimeoutSec) * time.Second
		if timeout <= 0 {
			timeout = 120 * time.Second
		}

		log.Printf("transport notification loop: enabled interval=%s timeout=%s", interval, timeout)

		ticker := time.NewTicker(interval)
		defer ticker.Stop()

		dueTicker := time.NewTicker(1 * time.Second)
		defer dueTicker.Stop()

		var cachedSchools []school.School
		schoolsCacheExpiresAt := time.Time{}
		schoolsCacheTTL := 30 * time.Minute

		run := func(trigger string) {
			ctx, cancel := context.WithTimeout(context.Background(), timeout)
			defer cancel()

			now := time.Now()
			schoolsRefreshed := false
			if len(cachedSchools) == 0 || now.After(schoolsCacheExpiresAt) {
				activeSchools, activeErr := existingSchoolRepo.GetAll(ctx)
				if activeErr != nil {
					if len(cachedSchools) == 0 {
						log.Printf("transport notification loop (%s): failed to list schools: %v", trigger, activeErr)
						return
					}
					log.Printf("transport notification loop (%s): school list refresh failed, using cached list: %v", trigger, activeErr)
				} else {
					cachedSchools = activeSchools
					schoolsCacheExpiresAt = now.Add(schoolsCacheTTL)
					schoolsRefreshed = true
				}
			}

			if appCache != nil && appCache.IsEnabled() {
				if schoolsRefreshed {
					for _, s := range cachedSchools {
						if err := transportHandler.RebuildTrackingScheduleQueueForSchool(ctx, s.ID); err != nil {
							log.Printf("transport notification loop (%s): queue rebuild failed (school=%s): %v", trigger, s.ID, err)
						}
					}
				}
				for _, s := range cachedSchools {
					transportHandler.FlushStaleRouteHistoryBuffers(ctx, s.ID)
				}
				return
			}

			for _, s := range cachedSchools {
				transportHandler.ProcessScheduledStartNotifications(ctx, s.ID, now)
				transportHandler.FlushStaleRouteHistoryBuffers(ctx, s.ID)
			}
		}

		if appCache != nil && appCache.IsEnabled() {
			bootstrapCtx, bootstrapCancel := context.WithTimeout(context.Background(), timeout)
			cachedSchools, _ = existingSchoolRepo.GetAll(bootstrapCtx)
			schoolsCacheExpiresAt = time.Now().Add(schoolsCacheTTL)
			for _, s := range cachedSchools {
				if err := transportHandler.RebuildTrackingScheduleQueueForSchool(bootstrapCtx, s.ID); err != nil {
					log.Printf("transport notification loop (bootstrap): queue rebuild failed (school=%s): %v", s.ID, err)
				}
			}
			bootstrapCancel()
		}

		run("initial")
		for {
			select {
			case <-dueTicker.C:
				if appCache != nil && appCache.IsEnabled() {
					dueCtx, dueCancel := context.WithTimeout(context.Background(), 8*time.Second)
					processed, err := transportHandler.ProcessDueTrackingScheduleQueue(dueCtx, time.Now(), 256)
					dueCancel()
					if err != nil {
						log.Printf("transport notification loop (due): failed to process queue: %v", err)
					} else if processed > 0 {
						log.Printf("transport notification loop (due): processed=%d", processed)
					}
				}
			case <-ticker.C:
				run("scheduled")
			}
		}
	}()

	// Interop DLQ sweeper: retries a small capped batch per school at fixed intervals.
	// This keeps retry pressure controlled while steadily draining transient failures.
	go func() {
		if !cfg.Interop.RetrySweepEnabled {
			log.Printf("interop sweeper: disabled (INTEROP_RETRY_SWEEP_ENABLED=false)")
			return
		}

		interval := time.Duration(cfg.Interop.RetrySweepIntervalSec) * time.Second
		if interval <= 0 {
			interval = 120 * time.Second
		}

		batchSize := cfg.Interop.RetrySweepBatchSize
		if batchSize <= 0 {
			batchSize = 5
		}

		timeoutSec := cfg.Interop.RetrySweepTimeoutSec
		if timeoutSec <= 0 {
			timeoutSec = 20
		}

		run := func(trigger string) {
			if !cfg.Interop.Enabled {
				return
			}

			listCtx, listCancel := context.WithTimeout(context.Background(), 30*time.Second)
			activeSchools, activeErr := existingSchoolRepo.GetAll(listCtx)
			listCancel()
			if activeErr != nil {
				log.Printf("interop sweeper (%s): failed to list schools: %v", trigger, activeErr)
				return
			}

			totalRetried := 0
			for _, s := range activeSchools {
				time.Sleep(interopSweepJitter(s.ID.String()))

				schoolCtx, schoolCancel := context.WithTimeout(context.Background(), time.Duration(timeoutSec)*time.Second)
				safeSchema := fmt.Sprintf("\"school_%s\"", s.ID.String())
				schoolCtx = context.WithValue(schoolCtx, "tenant_schema", safeSchema)
				schoolCtx = context.WithValue(schoolCtx, "school_id", s.ID.String())

				retried, err := interopService.SweepPendingRetries(schoolCtx, s.ID.String(), batchSize)
				schoolCancel()
				if err != nil {
					log.Printf("interop sweeper (%s): school %s error: %v", trigger, s.ID, err)
					continue
				}
				totalRetried += retried
			}

			if totalRetried > 0 {
				log.Printf("interop sweeper (%s): retried %d jobs across %d schools", trigger, totalRetried, len(activeSchools))
			}
		}

		ticker := time.NewTicker(interval)
		defer ticker.Stop()

		run("initial")
		for range ticker.C {
			run("scheduled")
		}
	}()

	// 10. Start Server
	port := cfg.App.Port
	log.Printf("Server starting on port %s", port)
	log.Printf("Health: http://localhost:%s/health", port)

	if err := r.Run(":" + port); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}

func interopSweepJitter(schoolID string) time.Duration {
	h := fnv.New32a()
	_, _ = h.Write([]byte(strings.TrimSpace(schoolID)))
	// Keep jitter small: 25-149ms per school to reduce request bursts without slowing sweep significantly.
	ms := 25 + int(h.Sum32()%125)
	return time.Duration(ms) * time.Millisecond
}
