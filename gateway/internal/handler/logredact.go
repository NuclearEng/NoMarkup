package handler

import "strings"

// redactEmail returns a log-safe form of an email address ("j***@example.com").
// Raw emails are PII and must not be written to logs.
func redactEmail(email string) string {
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
