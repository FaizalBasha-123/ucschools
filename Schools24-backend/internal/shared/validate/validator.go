package validate

import (
	"fmt"
	"regexp"
	"strings"
	"unicode"
)

// Validator provides field validation for API payloads
type Validator struct {
	Errors map[string][]string
}

// NewValidator creates a new validator
func NewValidator() *Validator {
	return &Validator{
		Errors: make(map[string][]string),
	}
}

// AddError adds an error for a field
func (v *Validator) AddError(field, message string) {
	v.Errors[field] = append(v.Errors[field], message)
}

// Valid returns true if no errors were recorded
func (v *Validator) Valid() bool {
	return len(v.Errors) == 0
}

// Errors returns all recorded errors
func (v *Validator) ErrorMessages() map[string][]string {
	return v.Errors
}

// ===============================================
// Email Validation
// ===============================================

var emailRegex = regexp.MustCompile(`^[a-zA-Z0-9.!#$%&'*+/=?^_\`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$`)

// ValidateEmail checks if email is valid
func (v *Validator) ValidateEmail(field string, email string) {
	email = strings.TrimSpace(email)
	if email == "" {
		v.AddError(field, "email is required")
		return
	}
	if !emailRegex.MatchString(email) {
		v.AddError(field, "email must be valid")
		return
	}
	if len(email) > 254 {
		v.AddError(field, "email is too long (max 254 characters)")
	}
}

// ===============================================
// Name Validation
// ===============================================

// ValidateName checks if name meets requirements
func (v *Validator) ValidateName(field string, name string, minLen, maxLen int) {
	name = strings.TrimSpace(name)
	if name == "" {
		v.AddError(field, fmt.Sprintf("%s is required", field))
		return
	}
	if len(name) < minLen {
		v.AddError(field, fmt.Sprintf("%s must be at least %d characters", field, minLen))
		return
	}
	if len(name) > maxLen {
		v.AddError(field, fmt.Sprintf("%s must be at most %d characters", field, maxLen))
		return
	}
	// Check for valid characters (letters, spaces, hyphens)
	for _, r := range name {
		if !unicode.IsLetter(r) && !unicode.IsSpace(r) && r != '-' && r != '\'' {
			v.AddError(field, fmt.Sprintf("%s contains invalid characters", field))
			return
		}
	}
}

// ===============================================
// Password Validation
// ===============================================

// ValidatePassword checks if password meets security requirements
func (v *Validator) ValidatePassword(field string, password string) {
	if password == "" {
		v.AddError(field, "password is required")
		return
	}
	if len(password) < 8 {
		v.AddError(field, "password must be at least 8 characters")
		return
	}
	if len(password) > 128 {
		v.AddError(field, "password is too long")
		return
	}

	hasUpper, hasLower, hasDigit, hasSpecial := false, false, false, false
	for _, r := range password {
		switch {
		case unicode.IsUpper(r):
			hasUpper = true
		case unicode.IsLower(r):
			hasLower = true
		case unicode.IsDigit(r):
			hasDigit = true
		case strings.ContainsAny(string(r), "!@#$%^&*()_+-=[]{}|;:,.<>?"):
			hasSpecial = true
		}
	}

	if !hasUpper {
		v.AddError(field, "password must contain at least one uppercase letter")
	}
	if !hasLower {
		v.AddError(field, "password must contain at least one lowercase letter")
	}
	if !hasDigit {
		v.AddError(field, "password must contain at least one digit")
	}
	if !hasSpecial {
		v.AddError(field, "password must contain at least one special character")
	}
}

// ===============================================
// Phone Validation
// ===============================================

// ValidatePhone checks if phone number is valid (Indian format)
func (v *Validator) ValidatePhone(field string, phone string) {
	phone = strings.TrimSpace(phone)
	if phone == "" {
		v.AddError(field, "phone is required")
		return
	}

	// Remove common formatting
	cleaned := strings.Map(func(r rune) rune {
		if r >= '0' && r <= '9' {
			return r
		}
		if r == '+' || r == '-' || r == '(' || r == ')' || r == ' ' {
			return -1
		}
		return r
	}, phone)

	if len(cleaned) < 10 || len(cleaned) > 15 {
		v.AddError(field, "phone must be 10-15 digits")
		return
	}

	if !regexp.MustCompile(`^[0-9]+$`).MatchString(cleaned) {
		v.AddError(field, "phone must contain only digits")
	}
}

// ===============================================
// Required Field Validation
// ===============================================

// Required validates that a field is not empty
func (v *Validator) Required(field string, value string) {
	if strings.TrimSpace(value) == "" {
		v.AddError(field, fmt.Sprintf("%s is required", field))
	}
}

// RequiredUUID validates that a field is a valid UUID
func (v *Validator) RequiredUUID(field string, value string) {
	value = strings.TrimSpace(value)
	if value == "" {
		v.AddError(field, fmt.Sprintf("%s is required", field))
		return
	}
	
	uuidRegex := regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)
	if !uuidRegex.MatchString(value) {
		v.AddError(field, fmt.Sprintf("%s must be a valid UUID", field))
	}
}

// Min validates that a number is at least min
func (v *Validator) Min(field string, value, min int) {
	if value < min {
		v.AddError(field, fmt.Sprintf("%s must be at least %d", field, min))
	}
}

// Max validates that a number is at most max
func (v *Validator) Max(field string, value, max int) {
	if value > max {
		v.AddError(field, fmt.Sprintf("%s must be at most %d", field, max))
	}
}

// Range validates that a number is within range
func (v *Validator) Range(field string, value, min, max int) {
	if value < min || value > max {
		v.AddError(field, fmt.Sprintf("%s must be between %d and %d", field, min, max))
	}
}

// ===============================================
// School Validation
// ===============================================

func ValidateCreateSchool(name, code, address string) *Validator {
	v := NewValidator()
	v.ValidateName("name", name, 3, 100)
	v.ValidateName("code", code, 2, 20)
	if strings.TrimSpace(address) != "" {
		v.ValidateName("address", address, 5, 255)
	}
	return v
}

// ===============================================
// User Validation
// ===============================================

func ValidateCreateUser(email, password, fullName string, role string) *Validator {
	v := NewValidator()
	v.ValidateEmail("email", email)
	if password != "" {
		v.ValidatePassword("password", password)
	}
	v.ValidateName("full_name", fullName, 3, 100)
	if role != "" && !isValidRole(role) {
		v.AddError("role", "role must be one of: admin, teacher, student, staff, parent")
	}
	return v
}

func isValidRole(role string) bool {
	valid := map[string]bool{
		"super_admin": true,
		"admin":       true,
		"teacher":     true,
		"student":     true,
		"staff":       true,
		"parent":      true,
	}
	return valid[role]
}

// ===============================================
// Class Validation
// ===============================================

func ValidateCreateClass(name, academicYear string, grade *int) *Validator {
	v := NewValidator()
	v.ValidateName("name", name, 2, 50)
	v.Required("academic_year", academicYear)
	if grade != nil {
		v.Range("grade", *grade, 1, 12)
	}
	return v
}

// ===============================================
// Subject Validation
// ===============================================

func ValidateCreateSubject(name, code string) *Validator {
	v := NewValidator()
	v.ValidateName("name", name, 2, 50)
	v.ValidateName("code", code, 1, 20)
	return v
}
