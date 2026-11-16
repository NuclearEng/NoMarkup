package service

// DB-backed AliasLookup — makes the cold-open relay body-rewrite functional
// in the running build (previously SetRelay was never wired, so a real phone
// or email typed into the chat body was persisted verbatim).
//
// Privacy contract (closes audit Section F):
//   - A channel is "cold-open" until the recipient has sent at least one
//     message in it. Until then, any phone/email the *sender* puts in the
//     message body is rewritten to the recipient's relay alias (email) or a
//     masked/proxy value (phone) so neither party's real contact leaks before
//     a mutual reply establishes consent. Once the recipient replies, the
//     channel is "warm" and the rewrite is a no-op — the parties have chosen
//     to talk, so they may share contact details freely.
//
// This is a body-content rewrite only. It is intentionally fail-closed: if the
// alias row is missing we still mask the phone (the maybeRewriteForRelay caller
// falls back to "***-***-****") rather than leak it.

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// PGAliasLookup implements AliasLookup against the chat database. Channels are
// job-scoped (chat_channels.job_id), and chat_aliases rows are keyed by
// (user_id, context_type='job', context_id=job_id), so the recipient's alias
// for a given channel is resolved through the channel's job_id.
type PGAliasLookup struct {
	pool *pgxpool.Pool
}

// NewPGAliasLookup returns a DB-backed AliasLookup. A nil pool yields a lookup
// that reports "no alias, has not replied" — the caller then masks contact
// info, which is the safe (fail-closed) default.
func NewPGAliasLookup(pool *pgxpool.Pool) *PGAliasLookup {
	return &PGAliasLookup{pool: pool}
}

// LookupCold resolves the recipient's relay alias/phone-proxy for this channel
// and reports whether the recipient has already replied. See AliasLookup.
func (l *PGAliasLookup) LookupCold(
	ctx context.Context,
	channelID, recipientID string,
) (emailAlias string, phoneProxy string, hasReplied bool, err error) {
	if l == nil || l.pool == nil {
		// Fail-closed: no DB → treat as cold so contact info gets masked.
		return "", "", false, nil
	}

	// Has the recipient sent any message in this channel? If so the channel is
	// warm and the rewrite is skipped. Non-deleted messages only.
	if err = l.pool.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM chat_messages
			 WHERE channel_id = $1 AND sender_id = $2 AND is_deleted = false
		)`, channelID, recipientID).Scan(&hasReplied); err != nil {
		return "", "", false, err
	}
	if hasReplied {
		return "", "", true, nil
	}

	// Cold-open: resolve the recipient's job-scoped alias via the channel's
	// job_id. A missing alias row is not an error — the caller masks the phone
	// and leaves the (already absent) email alias empty.
	var twilioProxy *string
	err = l.pool.QueryRow(ctx, `
		SELECT a.email_alias, a.twilio_proxy_phone
		  FROM chat_channels ch
		  JOIN chat_aliases a
		    ON a.context_type = 'job'
		   AND a.context_id   = ch.job_id
		   AND a.user_id      = $2
		 WHERE ch.id = $1`, channelID, recipientID,
	).Scan(&emailAlias, &twilioProxy)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", "", false, nil
	}
	if err != nil {
		return "", "", false, err
	}
	if twilioProxy != nil {
		phoneProxy = *twilioProxy
	}
	return emailAlias, phoneProxy, false, nil
}
