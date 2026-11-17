package service

import "strings"

// emailDomain returns only the domain of an address for logs (raw emails are PII).
func emailDomain(email string) string {
	if at := strings.LastIndex(email, "@"); at >= 0 {
		return email[at+1:]
	}
	return ""
}
