package config

import (
	"log"
	"os"
	"strconv"

	"github.com/joho/godotenv"
)

// Config holds all configuration for the application
type Config struct {
	App       AppConfig
	Database  DatabaseConfig
	Redis     RedisConfig
	NATS      NATSConfig
	Transport TransportSchedulerConfig
	Interop   InteropConfig
	JWT       JWTConfig
	AWS       AWSConfig
	R2        R2Config
	Razorpay  RazorpayConfig
	Email     EmailConfig
	SMS       SMSConfig
	FCM       FCMConfig
	Logging   LoggingConfig
	RateLimit RateLimitConfig
	CORS      CORSConfig
	Features  FeatureFlags
	AI        AIConfig
}

type AIConfig struct {
	OpenRouterAPIKey string
	OpenRouterModel  string
}

type AppConfig struct {
	Env                 string
	Name                string
	Port                string
	GinMode             string
	DashURL             string
	FormsURL            string
	CookieDomain        string
	EmbedSigningSecret  string
	EmbedFrameAncestors string
}

type DatabaseConfig struct {
	URL string // Neon PostgreSQL connection string
}

type RedisConfig struct {
	URL      string // Render Valkey URL: redis://host:port or rediss://host:port (takes priority)
	Addr     string
	Password string
	DB       int
	PoolSize int
}

type JWTConfig struct {
	Secret                string
	ExpirationHours       int
	RefreshExpirationDays int
}

type AWSConfig struct {
	Region          string
	AccessKeyID     string
	SecretAccessKey string
	S3BucketName    string
	S3Endpoint      string
}

type R2Config struct {
	Enabled         bool
	AccountID       string
	AccessKeyID     string
	SecretAccessKey string
	BucketName      string
	Region          string
	Endpoint        string
}

type RazorpayConfig struct {
	KeyID         string
	KeySecret     string
	WebhookSecret string
}

type EmailConfig struct {
	SendGridAPIKey string
	FromEmail      string
	FromName       string
}

type SMSConfig struct {
	TwilioAccountSID string
	TwilioAuthToken  string
	TwilioFromPhone  string
}

type FCMConfig struct {
	// ServiceAccountJSON holds the full content of the Firebase service account key JSON.
	// Set via FCM_SERVICE_ACCOUNT_JSON env var.
	ServiceAccountJSON string
	ProjectID          string
}

type NATSConfig struct {
	// URL is the NATS server connection string, e.g. "nats://localhost:4222".
	// When empty, NATS JetStream is disabled and transport falls back to in-memory Hub.
	URL string
}

type TransportSchedulerConfig struct {
	Enabled          bool
	IntervalSec      int
	PerRunTimeoutSec int
}

type InteropConfig struct {
	Enabled               bool
	ClientID              string
	SigningSecret         string
	DIKSHAEndpoint        string
	DigiLockerEndpoint    string
	ABCEndpoint           string
	RequestTimeoutSeconds int
	MaxRetries            int
	RetrySweepEnabled     bool
	RetrySweepIntervalSec int
	RetrySweepBatchSize   int
	RetrySweepTimeoutSec  int
}

type LoggingConfig struct {
	Level     string
	SentryDSN string
}

type RateLimitConfig struct {
	RequestsPerMin int
	Burst          int
}

type CORSConfig struct {
	AllowedOrigins string
	AllowedMethods string
	AllowedHeaders string
}

type FeatureFlags struct {
	QuestionPaperManagement bool
	LiveClasses             bool
	PaymentEnabled          bool
}

// Load reads environment variables and returns a Config struct
func Load() *Config {
	// Load .env file if it exists
	if err := godotenv.Load(); err != nil {
		log.Println("No .env file found, using environment variables")
	}

	appEnv := getEnv("APP_ENV", "development")
	transportDefaultEnabled := appEnv != "production"

	return &Config{
		App: AppConfig{
			Env:                 appEnv,
			Name:                getEnv("APP_NAME", "schools24-backend"),
			Port:                getPort(),
			GinMode:             getEnv("GIN_MODE", "debug"),
			DashURL:             getEnv("APP_DASH_URL", "https://dash.schools24.in"),
			FormsURL:            getEnv("APP_FORMS_URL", "https://forms.schools24.in"),
			CookieDomain:        getEnv("APP_COOKIE_DOMAIN", ""),
			EmbedSigningSecret:  getEmbedSigningSecret(appEnv),
			EmbedFrameAncestors: getEnv("APP_EMBED_FRAME_ANCESTORS", "'self' https:"),
		},
		Database: DatabaseConfig{
			URL: getEnv("DATABASE_URL", ""),
		},
		Redis: RedisConfig{
			URL:      getEnv("REDIS_URL", ""),
			Addr:     getEnv("REDIS_ADDR", "localhost:6379"),
			Password: getEnv("REDIS_PASSWORD", ""),
			DB:       getEnvAsInt("REDIS_DB", 0),
			PoolSize: getEnvAsInt("REDIS_POOL_SIZE", 25),
		},
		NATS: NATSConfig{
			URL: getEnv("NATS_URL", ""),
		},
		Transport: TransportSchedulerConfig{
			Enabled:          getEnvAsBool("TRANSPORT_SCHEDULED_LOOP_ENABLED", transportDefaultEnabled),
			IntervalSec:      getEnvAsInt("TRANSPORT_SCHEDULED_LOOP_INTERVAL_SECONDS", 300),
			PerRunTimeoutSec: getEnvAsInt("TRANSPORT_SCHEDULED_LOOP_TIMEOUT_SECONDS", 120),
		},
		Interop: InteropConfig{
			Enabled:               getEnvAsBool("INTEROP_ENABLED", false),
			ClientID:              getEnv("INTEROP_CLIENT_ID", ""),
			SigningSecret:         getEnv("INTEROP_SIGNING_SECRET", ""),
			DIKSHAEndpoint:        getEnv("INTEROP_DIKSHA_ENDPOINT", ""),
			DigiLockerEndpoint:    getEnv("INTEROP_DIGILOCKER_ENDPOINT", ""),
			ABCEndpoint:           getEnv("INTEROP_ABC_ENDPOINT", ""),
			RequestTimeoutSeconds: getEnvAsInt("INTEROP_REQUEST_TIMEOUT_SECONDS", 20),
			MaxRetries:            getEnvAsInt("INTEROP_MAX_RETRIES", 3),
			RetrySweepEnabled:     getEnvAsBool("INTEROP_RETRY_SWEEP_ENABLED", false),
			RetrySweepIntervalSec: getEnvAsInt("INTEROP_RETRY_SWEEP_INTERVAL_SECONDS", 120),
			RetrySweepBatchSize:   getEnvAsInt("INTEROP_RETRY_SWEEP_BATCH_SIZE", 5),
			RetrySweepTimeoutSec:  getEnvAsInt("INTEROP_RETRY_SWEEP_TIMEOUT_SECONDS", 20),
		},
		JWT: JWTConfig{
			Secret:                getJWTSecret(appEnv),
			ExpirationHours:       getEnvAsInt("JWT_EXPIRATION_HOURS", 24),
			RefreshExpirationDays: getEnvAsInt("JWT_REFRESH_EXPIRATION_DAYS", 7),
		},
		AWS: AWSConfig{
			Region:          getEnv("AWS_REGION", "ap-south-1"),
			AccessKeyID:     getEnv("AWS_ACCESS_KEY_ID", ""),
			SecretAccessKey: getEnv("AWS_SECRET_ACCESS_KEY", ""),
			S3BucketName:    getEnv("S3_BUCKET_NAME", "schools24-files"),
			S3Endpoint:      getEnv("S3_ENDPOINT", ""),
		},
		R2: R2Config{
			Enabled:         getEnvAsBool("R2_ENABLED", true),
			AccountID:       getEnv("R2_ACCOUNT_ID", ""),
			AccessKeyID:     getEnv("R2_ACCESS_KEY_ID", ""),
			SecretAccessKey: getEnv("R2_SECRET_ACCESS_KEY", ""),
			BucketName:      getEnv("R2_BUCKET_NAME", "schools24-documents"),
			Region:          getEnv("R2_REGION", "auto"),
			Endpoint:        getEnv("R2_ENDPOINT", ""),
		},
		Razorpay: RazorpayConfig{
			KeyID:         getEnv("RAZORPAY_KEY_ID", ""),
			KeySecret:     getEnv("RAZORPAY_KEY_SECRET", ""),
			WebhookSecret: getEnv("RAZORPAY_WEBHOOK_SECRET", ""),
		},
		Email: EmailConfig{
			SendGridAPIKey: getEnv("SENDGRID_API_KEY", ""),
			FromEmail:      getEnv("SENDGRID_FROM_EMAIL", "noreply@schools24.com"),
			FromName:       getEnv("SENDGRID_FROM_NAME", "Schools24"),
		},
		SMS: SMSConfig{
			TwilioAccountSID: getEnv("TWILIO_ACCOUNT_SID", ""),
			TwilioAuthToken:  getEnv("TWILIO_AUTH_TOKEN", ""),
			TwilioFromPhone:  getEnv("TWILIO_FROM_PHONE", ""),
		},
		FCM: FCMConfig{
			ServiceAccountJSON: getEnv("FCM_SERVICE_ACCOUNT_JSON", ""),
			ProjectID:          getEnv("FCM_PROJECT_ID", ""),
		},
		Logging: LoggingConfig{
			Level:     getEnv("LOG_LEVEL", "debug"),
			SentryDSN: getEnv("SENTRY_DSN", ""),
		},
		RateLimit: RateLimitConfig{
			RequestsPerMin: getEnvAsInt("RATE_LIMIT_REQUESTS_PER_MIN", 100),
			Burst:          getEnvAsInt("RATE_LIMIT_BURST", 20),
		},
		CORS: CORSConfig{
			AllowedOrigins: getEnv("CORS_ALLOWED_ORIGINS", ""),
			AllowedMethods: getEnv("CORS_ALLOWED_METHODS", "GET,POST,PUT,PATCH,DELETE,OPTIONS"),
			AllowedHeaders: getEnv("CORS_ALLOWED_HEADERS", "Origin,Content-Type,Accept,Authorization,X-Requested-With"),
		},
		Features: FeatureFlags{
			QuestionPaperManagement: getEnvAsBool("FEATURE_QUESTION_PAPER_MANAGEMENT", true),
			LiveClasses:             getEnvAsBool("FEATURE_LIVE_CLASSES", false),
			PaymentEnabled:          getEnvAsBool("FEATURE_PAYMENT_ENABLED", false),
		},
		AI: AIConfig{
			OpenRouterAPIKey: getEnv("OPENROUTER_API_KEY", ""),
			OpenRouterModel:  getEnv("OPENROUTER_MODEL", "google/gemini-2.0-flash-lite-001"),
		},
	}
}

// Helper functions
func getEnv(key, defaultValue string) string {
	if value, exists := os.LookupEnv(key); exists {
		return value
	}
	return defaultValue
}

// getPort returns the server port, checking PORT (Render/Heroku convention) first,
// then SERVER_PORT, with a default fallback of 8080.
func getPort() string {
	if port := os.Getenv("PORT"); port != "" {
		return port
	}
	return getEnv("SERVER_PORT", "8080")
}

// getJWTSecret returns the JWT secret, enforcing that it must be set in production.
func getJWTSecret(env string) string {
	secret := os.Getenv("JWT_SECRET")
	if secret == "" {
		if env != "development" {
			log.Fatal("FATAL: JWT_SECRET environment variable must be set in production")
		}
		log.Println("WARNING: Using default JWT secret — set JWT_SECRET env var for production")
		return "dev_only_jwt_secret_not_for_production"
	}
	return secret
}

func getEmbedSigningSecret(env string) string {
	secret := os.Getenv("EMBED_SIGNING_SECRET")
	if secret != "" {
		return secret
	}

	jwtSecret := os.Getenv("JWT_SECRET")
	if jwtSecret != "" {
		log.Println("WARNING: EMBED_SIGNING_SECRET not set — falling back to JWT_SECRET")
		return jwtSecret
	}

	if env != "development" {
		log.Fatal("FATAL: EMBED_SIGNING_SECRET or JWT_SECRET must be set in production")
	}

	log.Println("WARNING: Using development embed signing secret")
	return "dev_only_embed_secret_not_for_production"
}

func getEnvAsInt(key string, defaultValue int) int {
	valueStr := getEnv(key, "")
	if value, err := strconv.Atoi(valueStr); err == nil {
		return value
	}
	return defaultValue
}

func getEnvAsBool(key string, defaultValue bool) bool {
	valueStr := getEnv(key, "")
	if value, err := strconv.ParseBool(valueStr); err == nil {
		return value
	}
	return defaultValue
}
