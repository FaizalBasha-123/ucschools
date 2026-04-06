package validation

import (
	"errors"
	"unicode"
)

// ValidatePasswordStrength enforces the following password policy:
//   - At least 8 characters
//   - At least one uppercase letter
//   - At least one digit
func ValidatePasswordStrength(password string) error {
	if len(password) < 8 {
		return errors.New("password must be at least 8 characters")
	}

	var hasUpper, hasDigit bool

	for _, ch := range password {
		switch {
		case unicode.IsUpper(ch):
			hasUpper = true
		case unicode.IsDigit(ch):
			hasDigit = true
		}
	}

	if !hasUpper {
		return errors.New("password must contain at least one uppercase letter")
	}
	if !hasDigit {
		return errors.New("password must contain at least one number")
	}

	return nil
}
