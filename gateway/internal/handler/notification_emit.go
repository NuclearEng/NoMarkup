package handler

import (
	"context"
	"log/slog"

	"github.com/jackc/pgx/v5/pgxpool"
)

// emitNotification writes a single in-app notification row directly to the
// notifications table, reusing the same low-risk direct-insert seam the
// wishlist-match path uses (wishlist.go). It is the canonical way for a
// gateway handler that already orchestrates an action to notify the RIGHT
// recipient of a core event (new chat message, new bid, offer received, …).
//
// Contract / invariants enforced here so callers cannot get them subtly wrong:
//
//   - FAIL-SOFT. A notification is a side effect; a failure to insert one must
//     NEVER fail the underlying action. Every error path logs and returns — the
//     caller ignores the return value. The signature is intentionally
//     value-less for this reason.
//   - NO SELF-NOTIFY. We refuse to notify the actor about their own action
//     (recipientID == actorID is a no-op). Callers pass actorID so the guard
//     lives in one place rather than being re-derived per call site.
//   - DB-OPTIONAL. A nil pool (the gateway's nil-safe pattern) is a no-op.
//   - notifType is the snake_case string the frontend rendering contract keys
//     on (NOTIFICATION_TYPE in web/src/types/index.ts) and which maps to a
//     NotificationType enum member via stringToNotificationType. Passing a
//     value without an enum member would render as the generic bell icon, so
//     callers must use a type that has both an enum member AND a frontend icon.
//
// entityType/entityID are optional (pass "" to omit); entityID must be a UUID
// when set (the column is uuid). channels defaults to {in_app}.
func emitNotification(
	ctx context.Context,
	db *pgxpool.Pool,
	actorID, recipientID, notifType, title, body, actionURL, entityType, entityID string,
) {
	if db == nil {
		return
	}
	// Never notify the actor about their own action.
	if recipientID == "" || recipientID == actorID {
		return
	}

	var entityTypeArg, entityIDArg interface{}
	if entityType != "" {
		entityTypeArg = entityType
	}
	if entityID != "" {
		entityIDArg = entityID
	}

	if _, err := db.Exec(ctx, `
		INSERT INTO notifications
		    (user_id, notification_type, title, body, action_url, entity_type, entity_id, channels)
		VALUES ($1, $2, $3, $4, $5, $6, $7, ARRAY['in_app'])`,
		recipientID, notifType, title, body, actionURL, entityTypeArg, entityIDArg,
	); err != nil {
		// Fail soft: log and swallow so the underlying action still succeeds.
		slog.ErrorContext(ctx, "notification emit failed",
			"error", err,
			"recipient_id", recipientID,
			"notification_type", notifType,
			"entity_type", entityType,
			"entity_id", entityID,
		)
		return
	}

	slog.InfoContext(ctx, "notification emitted",
		"recipient_id", recipientID,
		"notification_type", notifType,
		"entity_type", entityType,
		"entity_id", entityID,
	)
}
