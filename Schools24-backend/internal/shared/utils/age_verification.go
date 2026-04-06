package utils

import "time"

// IsMinor determines if a date of birth indicates a minor (< 18 years old)
// This is critical for DPDPA 2023 compliance - children under 18 have special data protection rights
func IsMinor(dob time.Time) bool {
	now := time.Now()
	age := now.Year() - dob.Year()

	// Adjust if birthday hasn't occurred yet this year
	if now.Month() < dob.Month() || (now.Month() == dob.Month() && now.Day() < dob.Day()) {
		age--
	}

	return age < 18
}

// CalculateAge returns the age in years for a given date of birth
func CalculateAge(dob time.Time) int {
	now := time.Now()
	age := now.Year() - dob.Year()

	// Adjust if birthday hasn't occurred yet this year
	if now.Month() < dob.Month() || (now.Month() == dob.Month() && now.Day() < dob.Day()) {
		age--
	}

	return age
}

// WillBeMinorOn checks if a person will still be a minor on a future date
// Useful for planning consent expiry dates
func WillBeMinorOn(dob time.Time, futureDate time.Time) bool {
	age := futureDate.Year() - dob.Year()

	if futureDate.Month() < dob.Month() || (futureDate.Month() == dob.Month() && futureDate.Day() < dob.Day()) {
		age--
	}

	return age < 18
}

// GetNextBirthday returns the date of the next birthday
func GetNextBirthday(dob time.Time) time.Time {
	now := time.Now()
	nextBirthday := time.Date(now.Year(), dob.Month(), dob.Day(), 0, 0, 0, 0, now.Location())

	// If birthday already passed this year, use next year
	if nextBirthday.Before(now) {
		nextBirthday = nextBirthday.AddDate(1, 0, 0)
	}

	return nextBirthday
}

// DaysUntil18thBirthday calculates days remaining until person turns 18
// Returns 0 if already 18 or older
func DaysUntil18thBirthday(dob time.Time) int {
	if !IsMinor(dob) {
		return 0
	}

	// Calculate 18th birthday date
	eighteenthBirthday := dob.AddDate(18, 0, 0)
	now := time.Now()

	duration := eighteenthBirthday.Sub(now)
	days := int(duration.Hours() / 24)

	if days < 0 {
		return 0
	}

	return days
}
