package service

import "strings"

// RedactEmail returns a log-safe form of an email address: the first rune of
// the local part plus the domain ("j***@example.com"). Raw emails are PII and
// must not land in log aggregation (GDPR/CCPA data minimisation; App Store
// privacy label "Email Address — not used for tracking").
func RedactEmail(email string) string {
	email = strings.TrimSpace(email)
	if email == "" {
		return ""
	}
	at := strings.LastIndex(email, "@")
	if at <= 0 {
		return "***"
	}
	r := []rune(email[:at])
	return string(r[0]) + "***" + email[at:]
}

// RedactPhone keeps only the last four digits ("***1234").
func RedactPhone(phone string) string {
	digits := make([]rune, 0, len(phone))
	for _, r := range phone {
		if r >= '0' && r <= '9' {
			digits = append(digits, r)
		}
	}
	if len(digits) < 4 {
		return "***"
	}
	return "***" + string(digits[len(digits)-4:])
}
