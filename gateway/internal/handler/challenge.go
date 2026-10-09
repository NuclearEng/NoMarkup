package handler

import (
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/nomarkup/nomarkup/gateway/internal/middleware"
)

// ChallengeHandler handles HTTP endpoints for provider challenges and seasonal events.
// Challenges are a gateway-level concern stored directly in PostgreSQL,
// not routed through a downstream gRPC service.
type ChallengeHandler struct {
	db *pgxpool.Pool
}

// NewChallengeHandler creates a new ChallengeHandler.
// If db is nil (e.g. DATABASE_URL not set), endpoints return empty/default responses.
func NewChallengeHandler(db *pgxpool.Pool) *ChallengeHandler {
	return &ChallengeHandler{db: db}
}

// ListActiveChallenges handles GET /api/v1/challenges.
// Returns active challenges with the authenticated provider's progress (if joined).
func (h *ChallengeHandler) ListActiveChallenges(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		writeJSON(w, http.StatusOK, map[string]interface{}{"challenges": []interface{}{}})
		return
	}

	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	rows, err := h.db.Query(r.Context(), `
		SELECT
			c.id, c.title, c.description, c.challenge_type, c.target_value,
			c.reward_type, c.reward_value, c.starts_at, c.ends_at,
			c.is_seasonal, c.season_name, c.max_participants,
			cp.id AS participant_id, cp.current_progress, cp.completed, cp.completed_at,
			cp.reward_claimed, cp.joined_at,
			(SELECT COUNT(*) FROM challenge_participants WHERE challenge_id = c.id) AS participant_count
		FROM challenges c
		LEFT JOIN challenge_participants cp ON cp.challenge_id = c.id AND cp.provider_id = $1
		WHERE c.starts_at <= now() AND c.ends_at > now()
		ORDER BY c.is_seasonal DESC, c.ends_at ASC`, claims.UserID)
	if err != nil {
		slog.Error("failed to query active challenges", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to get challenges")
		return
	}
	defer rows.Close()

	challenges := make([]map[string]interface{}, 0)
	for rows.Next() {
		var (
			id, title, description, challengeType string
			targetValue                           int
			rewardType, rewardValue               string
			startsAt, endsAt                      time.Time
			isSeasonal                            bool
			seasonName                            *string
			maxParticipants                       *int
			participantID                         *string
			currentProgress                       *int
			completed                             *bool
			completedAt                           *time.Time
			rewardClaimed                         *bool
			joinedAt                              *time.Time
			participantCount                      int
		)
		if err := rows.Scan(
			&id, &title, &description, &challengeType, &targetValue,
			&rewardType, &rewardValue, &startsAt, &endsAt,
			&isSeasonal, &seasonName, &maxParticipants,
			&participantID, &currentProgress, &completed, &completedAt,
			&rewardClaimed, &joinedAt,
			&participantCount,
		); err != nil {
			slog.Error("failed to scan challenge row", "error", err)
			writeError(w, http.StatusInternalServerError, "failed to read challenges")
			return
		}

		challenge := map[string]interface{}{
			"id":                id,
			"title":             title,
			"description":       description,
			"challenge_type":    challengeType,
			"target_value":      targetValue,
			"reward_type":       rewardType,
			"reward_value":      rewardValue,
			"starts_at":         startsAt.UTC().Format(time.RFC3339),
			"ends_at":           endsAt.UTC().Format(time.RFC3339),
			"is_seasonal":       isSeasonal,
			"season_name":       seasonName,
			"max_participants":  maxParticipants,
			"participant_count": participantCount,
			"joined":            participantID != nil,
		}

		if participantID != nil {
			progress := 0
			if currentProgress != nil {
				progress = *currentProgress
			}
			pctComplete := float64(0)
			if targetValue > 0 {
				pctComplete = float64(progress) / float64(targetValue) * 100
				if pctComplete > 100 {
					pctComplete = 100
				}
			}
			isCompleted := false
			if completed != nil {
				isCompleted = *completed
			}
			isClaimed := false
			if rewardClaimed != nil {
				isClaimed = *rewardClaimed
			}
			myProgress := map[string]interface{}{
				"current_progress": progress,
				"percent_complete": pctComplete,
				"completed":        isCompleted,
				"reward_claimed":   isClaimed,
			}
			if completedAt != nil {
				myProgress["completed_at"] = completedAt.UTC().Format(time.RFC3339)
			}
			if joinedAt != nil {
				myProgress["joined_at"] = joinedAt.UTC().Format(time.RFC3339)
			}
			challenge["my_progress"] = myProgress
		}

		timeRemaining := time.Until(endsAt)
		challenge["time_remaining_seconds"] = int(timeRemaining.Seconds())

		challenges = append(challenges, challenge)
	}
	if err := rows.Err(); err != nil {
		slog.Error("error iterating challenge rows", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to get challenges")
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{"challenges": challenges})
}

// GetChallenge handles GET /api/v1/challenges/{id}.
// Returns challenge details with leaderboard (top 10 participants by progress).
func (h *ChallengeHandler) GetChallenge(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		writeError(w, http.StatusServiceUnavailable, "database not available")
		return
	}

	challengeID := chi.URLParam(r, "id")
	if challengeID == "" {
		writeError(w, http.StatusBadRequest, "challenge id required")
		return
	}

	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	// Fetch challenge details
	var (
		id, title, description, challengeType string
		targetValue                           int
		rewardType, rewardValue               string
		startsAt, endsAt                      time.Time
		isSeasonal                            bool
		seasonName                            *string
		maxParticipants                       *int
		createdAt                             time.Time
	)
	err := h.db.QueryRow(r.Context(), `
		SELECT id, title, description, challenge_type, target_value,
		       reward_type, reward_value, starts_at, ends_at,
		       is_seasonal, season_name, max_participants, created_at
		FROM challenges WHERE id = $1`, challengeID).Scan(
		&id, &title, &description, &challengeType, &targetValue,
		&rewardType, &rewardValue, &startsAt, &endsAt,
		&isSeasonal, &seasonName, &maxParticipants, &createdAt,
	)
	if err != nil {
		slog.Error("failed to query challenge", "challenge_id", challengeID, "error", err)
		writeError(w, http.StatusNotFound, "challenge not found")
		return
	}

	// Fetch participant count
	var participantCount int
	if err := h.db.QueryRow(r.Context(),
		`SELECT COUNT(*) FROM challenge_participants WHERE challenge_id = $1`,
		challengeID).Scan(&participantCount); err != nil {
		slog.Error("failed to count challenge participants", "challenge_id", challengeID, "error", err)
		participantCount = 0
	}

	challenge := map[string]interface{}{
		"id":                id,
		"title":             title,
		"description":       description,
		"challenge_type":    challengeType,
		"target_value":      targetValue,
		"reward_type":       rewardType,
		"reward_value":      rewardValue,
		"starts_at":         startsAt.UTC().Format(time.RFC3339),
		"ends_at":           endsAt.UTC().Format(time.RFC3339),
		"is_seasonal":       isSeasonal,
		"season_name":       seasonName,
		"max_participants":  maxParticipants,
		"participant_count": participantCount,
		"created_at":        createdAt.UTC().Format(time.RFC3339),
	}

	timeRemaining := time.Until(endsAt)
	challenge["time_remaining_seconds"] = int(timeRemaining.Seconds())

	// Fetch current user's progress
	var (
		myCurrentProgress int
		myCompleted       bool
		myCompletedAt     *time.Time
		myRewardClaimed   bool
		myJoinedAt        *time.Time
	)
	err = h.db.QueryRow(r.Context(), `
		SELECT current_progress, completed, completed_at, reward_claimed, joined_at
		FROM challenge_participants
		WHERE challenge_id = $1 AND provider_id = $2`, challengeID, claims.UserID).Scan(
		&myCurrentProgress, &myCompleted, &myCompletedAt, &myRewardClaimed, &myJoinedAt,
	)
	if err == nil {
		pctComplete := float64(0)
		if targetValue > 0 {
			pctComplete = float64(myCurrentProgress) / float64(targetValue) * 100
			if pctComplete > 100 {
				pctComplete = 100
			}
		}
		myProgress := map[string]interface{}{
			"current_progress": myCurrentProgress,
			"percent_complete": pctComplete,
			"completed":        myCompleted,
			"reward_claimed":   myRewardClaimed,
		}
		if myCompletedAt != nil {
			myProgress["completed_at"] = myCompletedAt.UTC().Format(time.RFC3339)
		}
		if myJoinedAt != nil {
			myProgress["joined_at"] = myJoinedAt.UTC().Format(time.RFC3339)
		}
		challenge["my_progress"] = myProgress
		challenge["joined"] = true
	} else {
		challenge["joined"] = false
	}

	// Fetch leaderboard (top 10 by progress)
	leaderboardRows, err := h.db.Query(r.Context(), `
		SELECT cp.provider_id, u.display_name, u.avatar_url,
		       cp.current_progress, cp.completed, cp.completed_at
		FROM challenge_participants cp
		JOIN users u ON u.id = cp.provider_id
		WHERE cp.challenge_id = $1
		ORDER BY cp.current_progress DESC, cp.joined_at ASC
		LIMIT 10`, challengeID)
	if err != nil {
		slog.Error("failed to query challenge leaderboard", "challenge_id", challengeID, "error", err)
		challenge["leaderboard"] = []interface{}{}
	} else {
		defer leaderboardRows.Close()

		leaderboard := make([]map[string]interface{}, 0)
		rank := 1
		for leaderboardRows.Next() {
			var (
				providerID, displayName string
				avatarURL               *string
				progress                int
				completed               bool
				completedAt             *time.Time
			)
			if err := leaderboardRows.Scan(
				&providerID, &displayName, &avatarURL,
				&progress, &completed, &completedAt,
			); err != nil {
				slog.Error("failed to scan leaderboard row", "error", err)
				continue
			}
			pct := float64(0)
			if targetValue > 0 {
				pct = float64(progress) / float64(targetValue) * 100
				if pct > 100 {
					pct = 100
				}
			}
			entry := map[string]interface{}{
				"rank":             rank,
				"provider_id":     providerID,
				"display_name":    displayName,
				"avatar_url":      avatarURL,
				"current_progress": progress,
				"percent_complete": pct,
				"completed":       completed,
			}
			if completedAt != nil {
				entry["completed_at"] = completedAt.UTC().Format(time.RFC3339)
			}
			leaderboard = append(leaderboard, entry)
			rank++
		}
		if err := leaderboardRows.Err(); err != nil {
			slog.Error("error iterating leaderboard rows", "error", err)
		}
		challenge["leaderboard"] = leaderboard
	}

	writeJSON(w, http.StatusOK, challenge)
}

// JoinChallenge handles POST /api/v1/challenges/{id}/join.
// Allows a provider to join an active challenge.
func (h *ChallengeHandler) JoinChallenge(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		writeError(w, http.StatusServiceUnavailable, "database not available")
		return
	}

	challengeID := chi.URLParam(r, "id")
	if challengeID == "" {
		writeError(w, http.StatusBadRequest, "challenge id required")
		return
	}

	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	// Verify the user has the provider role
	hasProvider := false
	for _, role := range claims.Roles {
		if role == "provider" {
			hasProvider = true
			break
		}
	}
	if !hasProvider {
		writeError(w, http.StatusForbidden, "only providers can join challenges")
		return
	}

	// Use a transaction with FOR UPDATE to prevent race conditions when
	// checking max_participants. Without this, concurrent requests could
	// each see a count below the limit and both insert, exceeding it.
	tx, err := h.db.Begin(r.Context())
	if err != nil {
		slog.Error("failed to begin transaction", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to join challenge")
		return
	}
	defer tx.Rollback(r.Context())

	// Verify challenge is active (FOR UPDATE locks the row until commit)
	var endsAt time.Time
	var maxParticipants *int
	err = tx.QueryRow(r.Context(), `
		SELECT ends_at, max_participants FROM challenges
		WHERE id = $1 AND starts_at <= now() AND ends_at > now()
		FOR UPDATE`, challengeID).Scan(&endsAt, &maxParticipants)
	if err != nil {
		writeError(w, http.StatusNotFound, "challenge not found or not active")
		return
	}

	// Check max participants if set (consistent read within the transaction)
	if maxParticipants != nil {
		var currentCount int
		if err := tx.QueryRow(r.Context(),
			`SELECT COUNT(*) FROM challenge_participants WHERE challenge_id = $1`,
			challengeID).Scan(&currentCount); err != nil {
			slog.Error("failed to count participants", "challenge_id", challengeID, "error", err)
			writeError(w, http.StatusInternalServerError, "failed to join challenge")
			return
		}
		if currentCount >= *maxParticipants {
			writeError(w, http.StatusConflict, "challenge is full")
			return
		}
	}

	// Insert participant (unique constraint prevents double-join)
	var participantID string
	err = tx.QueryRow(r.Context(), `
		INSERT INTO challenge_participants (challenge_id, provider_id)
		VALUES ($1, $2)
		ON CONFLICT (challenge_id, provider_id) DO NOTHING
		RETURNING id`, challengeID, claims.UserID).Scan(&participantID)
	if err != nil {
		// ON CONFLICT DO NOTHING returns no rows — provider already joined
		writeError(w, http.StatusConflict, "already joined this challenge")
		return
	}

	if err = tx.Commit(r.Context()); err != nil {
		slog.Error("failed to commit join challenge", "challenge_id", challengeID, "error", err)
		writeError(w, http.StatusInternalServerError, "failed to join challenge")
		return
	}

	slog.Info("provider joined challenge",
		"challenge_id", challengeID,
		"provider_id", claims.UserID,
	)

	writeJSON(w, http.StatusCreated, map[string]interface{}{
		"participant_id": participantID,
		"challenge_id":   challengeID,
		"provider_id":    claims.UserID,
		"joined":         true,
	})
}

// GetMyProgress handles GET /api/v1/challenges/me.
// Returns the authenticated provider's active challenges with progress.
func (h *ChallengeHandler) GetMyProgress(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		writeJSON(w, http.StatusOK, map[string]interface{}{"challenges": []interface{}{}})
		return
	}

	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	rows, err := h.db.Query(r.Context(), `
		SELECT
			c.id, c.title, c.description, c.challenge_type, c.target_value,
			c.reward_type, c.reward_value, c.starts_at, c.ends_at,
			c.is_seasonal, c.season_name,
			cp.current_progress, cp.completed, cp.completed_at,
			cp.reward_claimed, cp.joined_at
		FROM challenge_participants cp
		JOIN challenges c ON c.id = cp.challenge_id
		WHERE cp.provider_id = $1
		ORDER BY cp.completed ASC, c.ends_at ASC`, claims.UserID)
	if err != nil {
		slog.Error("failed to query provider challenges", "provider_id", claims.UserID, "error", err)
		writeError(w, http.StatusInternalServerError, "failed to get challenges")
		return
	}
	defer rows.Close()

	challenges := make([]map[string]interface{}, 0)
	for rows.Next() {
		var (
			id, title, description, challengeType string
			targetValue                           int
			rewardType, rewardValue               string
			startsAt, endsAt                      time.Time
			isSeasonal                            bool
			seasonName                            *string
			currentProgress                       int
			completed                             bool
			completedAt                           *time.Time
			rewardClaimed                         bool
			joinedAt                              time.Time
		)
		if err := rows.Scan(
			&id, &title, &description, &challengeType, &targetValue,
			&rewardType, &rewardValue, &startsAt, &endsAt,
			&isSeasonal, &seasonName,
			&currentProgress, &completed, &completedAt,
			&rewardClaimed, &joinedAt,
		); err != nil {
			slog.Error("failed to scan provider challenge row", "error", err)
			writeError(w, http.StatusInternalServerError, "failed to read challenges")
			return
		}

		pctComplete := float64(0)
		if targetValue > 0 {
			pctComplete = float64(currentProgress) / float64(targetValue) * 100
			if pctComplete > 100 {
				pctComplete = 100
			}
		}

		challenge := map[string]interface{}{
			"id":               id,
			"title":            title,
			"description":      description,
			"challenge_type":   challengeType,
			"target_value":     targetValue,
			"reward_type":      rewardType,
			"reward_value":     rewardValue,
			"starts_at":        startsAt.UTC().Format(time.RFC3339),
			"ends_at":          endsAt.UTC().Format(time.RFC3339),
			"is_seasonal":      isSeasonal,
			"season_name":      seasonName,
			"current_progress": currentProgress,
			"percent_complete": pctComplete,
			"completed":        completed,
			"reward_claimed":   rewardClaimed,
			"joined_at":        joinedAt.UTC().Format(time.RFC3339),
		}
		if completedAt != nil {
			challenge["completed_at"] = completedAt.UTC().Format(time.RFC3339)
		}

		timeRemaining := time.Until(endsAt)
		challenge["time_remaining_seconds"] = int(timeRemaining.Seconds())

		challenges = append(challenges, challenge)
	}
	if err := rows.Err(); err != nil {
		slog.Error("error iterating provider challenge rows", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to get challenges")
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{"challenges": challenges})
}

// AdminCreateChallenge handles POST /api/v1/admin/challenges.
// Allows an admin to create a new challenge.
func (h *ChallengeHandler) AdminCreateChallenge(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		writeError(w, http.StatusServiceUnavailable, "database not available")
		return
	}

	var req struct {
		Title           string  `json:"title"`
		Description     string  `json:"description"`
		ChallengeType   string  `json:"challenge_type"`
		TargetValue     int     `json:"target_value"`
		RewardType      string  `json:"reward_type"`
		RewardValue     string  `json:"reward_value"`
		StartsAt        string  `json:"starts_at"`
		EndsAt          string  `json:"ends_at"`
		IsSeasonal      bool    `json:"is_seasonal"`
		SeasonName      *string `json:"season_name"`
		MaxParticipants *int    `json:"max_participants"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}

	// Validate required fields
	if req.Title == "" || req.Description == "" || req.ChallengeType == "" ||
		req.TargetValue <= 0 || req.RewardType == "" || req.RewardValue == "" ||
		req.StartsAt == "" || req.EndsAt == "" {
		writeError(w, http.StatusBadRequest, "missing required fields")
		return
	}

	startsAt, err := time.Parse(time.RFC3339, req.StartsAt)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid starts_at format (RFC3339 required)")
		return
	}
	endsAt, err := time.Parse(time.RFC3339, req.EndsAt)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid ends_at format (RFC3339 required)")
		return
	}
	if endsAt.Before(startsAt) {
		writeError(w, http.StatusBadRequest, "ends_at must be after starts_at")
		return
	}

	var id string
	var createdAt time.Time
	err = h.db.QueryRow(r.Context(), `
		INSERT INTO challenges (title, description, challenge_type, target_value,
		                        reward_type, reward_value, starts_at, ends_at,
		                        is_seasonal, season_name, max_participants)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
		RETURNING id, created_at`,
		req.Title, req.Description, req.ChallengeType, req.TargetValue,
		req.RewardType, req.RewardValue, startsAt, endsAt,
		req.IsSeasonal, req.SeasonName, req.MaxParticipants,
	).Scan(&id, &createdAt)
	if err != nil {
		slog.Error("failed to create challenge", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to create challenge")
		return
	}

	slog.Info("challenge created", "challenge_id", id, "title", req.Title)

	writeJSON(w, http.StatusCreated, map[string]interface{}{
		"id":               id,
		"title":            req.Title,
		"description":      req.Description,
		"challenge_type":   req.ChallengeType,
		"target_value":     req.TargetValue,
		"reward_type":      req.RewardType,
		"reward_value":     req.RewardValue,
		"starts_at":        startsAt.UTC().Format(time.RFC3339),
		"ends_at":          endsAt.UTC().Format(time.RFC3339),
		"is_seasonal":      req.IsSeasonal,
		"season_name":      req.SeasonName,
		"max_participants": req.MaxParticipants,
		"created_at":       createdAt.UTC().Format(time.RFC3339),
	})
}

// AdminListChallenges handles GET /api/v1/admin/challenges.
// Returns all challenges with participant counts for the admin dashboard.
func (h *ChallengeHandler) AdminListChallenges(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		writeJSON(w, http.StatusOK, map[string]interface{}{"challenges": []interface{}{}})
		return
	}

	rows, err := h.db.Query(r.Context(), `
		SELECT
			c.id, c.title, c.description, c.challenge_type, c.target_value,
			c.reward_type, c.reward_value, c.starts_at, c.ends_at,
			c.is_seasonal, c.season_name, c.max_participants,
			c.created_at, c.updated_at,
			(SELECT COUNT(*) FROM challenge_participants WHERE challenge_id = c.id) AS participant_count,
			(SELECT COUNT(*) FROM challenge_participants WHERE challenge_id = c.id AND completed = true) AS completed_count
		FROM challenges c
		ORDER BY c.created_at DESC`)
	if err != nil {
		slog.Error("failed to list challenges", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to list challenges")
		return
	}
	defer rows.Close()

	challenges := make([]map[string]interface{}, 0)
	for rows.Next() {
		var (
			id, title, description, challengeType string
			targetValue                           int
			rewardType, rewardValue               string
			startsAt, endsAt                      time.Time
			isSeasonal                            bool
			seasonName                            *string
			maxParticipants                       *int
			createdAt, updatedAt                  time.Time
			participantCount, completedCount      int
		)
		if err := rows.Scan(
			&id, &title, &description, &challengeType, &targetValue,
			&rewardType, &rewardValue, &startsAt, &endsAt,
			&isSeasonal, &seasonName, &maxParticipants,
			&createdAt, &updatedAt,
			&participantCount, &completedCount,
		); err != nil {
			slog.Error("failed to scan admin challenge row", "error", err)
			writeError(w, http.StatusInternalServerError, "failed to read challenges")
			return
		}

		isActive := time.Now().After(startsAt) && time.Now().Before(endsAt)

		challenge := map[string]interface{}{
			"id":                id,
			"title":             title,
			"description":       description,
			"challenge_type":    challengeType,
			"target_value":      targetValue,
			"reward_type":       rewardType,
			"reward_value":      rewardValue,
			"starts_at":         startsAt.UTC().Format(time.RFC3339),
			"ends_at":           endsAt.UTC().Format(time.RFC3339),
			"is_seasonal":       isSeasonal,
			"season_name":       seasonName,
			"max_participants":  maxParticipants,
			"participant_count": participantCount,
			"completed_count":   completedCount,
			"is_active":         isActive,
			"created_at":        createdAt.UTC().Format(time.RFC3339),
			"updated_at":        updatedAt.UTC().Format(time.RFC3339),
		}

		challenges = append(challenges, challenge)
	}
	if err := rows.Err(); err != nil {
		slog.Error("error iterating admin challenge rows", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to list challenges")
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{"challenges": challenges})
}
