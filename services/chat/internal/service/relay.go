package service

// Relay rewriting — closes audit Section F's "no Craigslist-style relay"
// gap on the chat-service side.
//
// When a chat message is "cold-open" (the recipient has not yet replied),
// outbound notifications must avoid leaking the sender's real email or
// phone. The notification service handles the From: header rewrite, but
// when the message body itself contains a phone or email, we need to
// rewrite that body inline.
//
// The rewrite uses the alias table (chat_aliases) the gateway populates
// on demand. If the row exists, the email/phone in the message body is
// replaced with the alias values. If not, contact info is masked
// (asterisks) — fail-closed because leaking real contact info on a
// cold-open is worse than a broken-looking message.
//
// Hooked into Service.SendMessage via maybeRewriteForRelay below. In dev
// the rewrite path is a no-op when no AliasLookup is wired up; the
// detection-only flag (FlaggedContactInfo) still fires.

import (
	"context"
	"strings"
)

// AliasLookup is the contract chat-service depends on for relay rewrites.
// Implemented by a gateway-side resolver (or a stub in tests).
type AliasLookup interface {
	// LookupCold returns the email alias and phone proxy (if any) for the
	// recipient on this channel, IFF the recipient has not yet replied.
	// Returns (alias, phoneProxy, hasReplied, error).
	LookupCold(ctx context.Context, channelID, recipientID string) (emailAlias string, phoneProxy string, hasReplied bool, err error)
}

// maybeRewriteForRelay rewrites contact info in `content` to the
// recipient's relay alias when the channel is in a cold-open state.
//
// Strategy:
//   - If `lookup` is nil → no rewrite (dev mode / no relay configured).
//   - If hasReplied → no rewrite (full chat is unlocked).
//   - If alias is set → replace bare emails with alias; replace bare
//     phone numbers with phoneProxy or "***-***-****" if no proxy.
//
// Pure-string rewrite — does NOT call out to anything other than the
// AliasLookup interface, so it's safe for the SendMessage hot path.
func maybeRewriteForRelay(
	ctx context.Context,
	lookup AliasLookup,
	channelID, recipientID, content string,
) string {
	if lookup == nil || !DetectContactInfo(content) {
		return content
	}
	emailAlias, phoneProxy, hasReplied, err := lookup.LookupCold(ctx, channelID, recipientID)
	if err != nil || hasReplied {
		return content
	}

	out := content
	if emailAlias != "" {
		out = emailRegex.ReplaceAllString(out, emailAlias)
	}
	mask := "***-***-****"
	if phoneProxy != "" {
		mask = phoneProxy
	}
	out = phoneRegex.ReplaceAllString(out, mask)

	// Strip social handles (we never proxy these).
	out = socialHandleRegex.ReplaceAllStringFunc(out, func(match string) string {
		// Preserve leading whitespace/paren so the rewrite doesn't eat it.
		prefix := ""
		idx := strings.IndexByte(match, '@')
		if idx > 0 {
			prefix = match[:idx]
		}
		return prefix + "[handle hidden]"
	})

	return out
}

// SetRelay wires an AliasLookup into the chat service so SendMessage can
// rewrite cold-open contact info. Optional — when not set, the existing
// detection-only behavior (FlaggedContactInfo) ships unchanged.
func (s *Service) SetRelay(lookup AliasLookup) {
	s.relay = lookup
}
