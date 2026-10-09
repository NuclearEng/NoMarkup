package handler

// Competitive insurance marketplace — "insurers compete for the customer's
// business." Backed by migration 062 (insurers, insurer_products,
// insurance_quote_requests, insurance_quotes, marketplace_policies).
//
// Flow:
//   1. Customer POSTs a quote-request {product_type, coverage_cents,
//      contract_id?}. The gateway FANS OUT to every approved insurer that
//      offers that product_type, computes each insurer's competing quote
//      (premium = coverage * insurer base_rate_bps / 10000, clamped up to the
//      insurer's min_premium_cents; a sample deductible; expires +7d), inserts
//      one insurance_quotes row per insurer, and returns the quotes sorted by
//      premium ascending (cheapest first — the competitive surface).
//   2. Customer lists / reads their requests + quotes (owner-or-admin only;
//      non-owners get 404 so request existence does not leak — IDOR fix, same
//      posture as insurance.go's policy/claim reads).
//   3. Customer SELECTS a quote → the request is marked bound, selected_quote_id
//      is set, and a marketplace_policies row is bound to the winning insurer.
//      Idempotent: re-selecting returns the already-bound policy.
//
// This is SEPARATE from the fixed per-job insurance (insurance.go / migration
// 022), which is a platform-priced catalog. Here the rate is per-insurer so the
// quotes genuinely differ. The customer routes are gated behind the
// `insurance_competition` feature flag via RequireFlag (see router wiring).
//
// Pattern follows follows.go / category_questions.go: pgx-direct against the
// gateway dbPool (no new gRPC/proto), nil-safe pool (503 when DATABASE_URL is
// unset), parameterized SQL only, money in integer cents, structured slog.

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nomarkup/nomarkup/gateway/internal/middleware"
)

// quoteExpiryDuration is how long a competing quote stays valid after fan-out.
const quoteExpiryDuration = 7 * 24 * time.Hour

// sampleDeductibleBps is the deductible offered on a competitive quote,
// expressed as basis points of the coverage amount (200 bps = 2%). A flat,
// transparent sample so the marketplace is demoable; carriers would set this
// per rate card in a fuller build. Kept all-integer (money-in-cents rule).
const sampleDeductibleBps = 200

// maxCarriersPerRequest bounds the fan-out: a single quote request quotes at
// most this many approved carriers. Without it the carrier SELECT (and the
// resulting per-carrier quote inserts) scale with the total approved-insurer
// population, turning one customer POST into an unbounded write fan-out. 50 is
// far beyond any realistic per-product carrier panel while keeping the request
// O(1) in carrier count.
const maxCarriersPerRequest = 50

// InsuranceCompetitionHandler exposes the competitive insurance marketplace.
type InsuranceCompetitionHandler struct {
	db *pgxpool.Pool
}

// NewInsuranceCompetitionHandler returns an InsuranceCompetitionHandler. A nil
// db short-circuits every endpoint to a 503 (matches the rest of the
// gateway-dbPool surface — follows.go, category_questions.go).
func NewInsuranceCompetitionHandler(db *pgxpool.Pool) *InsuranceCompetitionHandler {
	return &InsuranceCompetitionHandler{db: db}
}

// ─────────────────────────────────────────────────────────────────────────
// JSON shapes
// ─────────────────────────────────────────────────────────────────────────

type quoteJSON struct {
	QuoteID         string    `json:"quote_id"`
	InsurerID       string    `json:"insurer_id"`
	InsurerName     string    `json:"insurer_name"`
	PremiumCents    int64     `json:"premium_cents"`
	DeductibleCents int64     `json:"deductible_cents"`
	Terms           string    `json:"terms"`
	ExpiresAt       time.Time `json:"expires_at"`
}

type quoteRequestJSON struct {
	RequestID       string      `json:"request_id"`
	CustomerID      string      `json:"customer_id"`
	ContractID      *string     `json:"contract_id"`
	ProductType     string      `json:"product_type"`
	CoverageCents   int64       `json:"coverage_cents"`
	Status          string      `json:"status"`
	SelectedQuoteID *string     `json:"selected_quote_id"`
	CreatedAt       time.Time   `json:"created_at"`
	Quotes          []quoteJSON `json:"quotes,omitempty"`
}

type createQuoteRequestRequest struct {
	ProductType   string `json:"product_type"`
	CoverageCents int64  `json:"coverage_cents"`
	ContractID    string `json:"contract_id"`
}

type selectQuoteRequest struct {
	QuoteID string `json:"quote_id"`
}

type marketplacePolicyJSON struct {
	ID                  string  `json:"id"`
	RequestID           string  `json:"request_id"`
	QuoteID             string  `json:"quote_id"`
	InsurerID           string  `json:"insurer_id"`
	InsurerName         string  `json:"insurer_name"`
	CustomerID          string  `json:"customer_id"`
	ContractID          *string `json:"contract_id"`
	ProductType         string  `json:"product_type"`
	CoverageAmountCents int64   `json:"coverage_amount_cents"`
	PremiumCents        int64   `json:"premium_cents"`
	DeductibleCents     int64   `json:"deductible_cents"`
	Terms               string  `json:"terms"`
	Status              string  `json:"status"`
	EffectiveDate       string  `json:"effective_date"`
	ExpirationDate      *string `json:"expiration_date"`
}

// ─────────────────────────────────────────────────────────────────────────
// Pricing — premium = coverage * base_rate_bps / 10000, clamped to min.
// All-integer so there is no float drift (money-in-cents rule).
// ─────────────────────────────────────────────────────────────────────────

// computeCompetitivePremiumCents applies an insurer's basis-point rate to the
// coverage amount (rounded half-up) and raises the result to the insurer's
// minimum premium floor.
func computeCompetitivePremiumCents(coverageCents, baseRateBps, minPremiumCents int64) int64 {
	premium := (coverageCents*baseRateBps + 5_000) / 10_000
	if premium < minPremiumCents {
		premium = minPremiumCents
	}
	return premium
}

// computeSampleDeductibleCents returns a flat sample deductible (a % of
// coverage) so quotes carry a realistic deductible without per-carrier inputs.
func computeSampleDeductibleCents(coverageCents int64) int64 {
	return (coverageCents*sampleDeductibleBps + 5_000) / 10_000
}

// ─────────────────────────────────────────────────────────────────────────
// POST /api/v1/insurance/quote-requests — create + fan out
// ─────────────────────────────────────────────────────────────────────────

func (h *InsuranceCompetitionHandler) CreateQuoteRequest(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		writeError(w, http.StatusServiceUnavailable, "database unavailable")
		return
	}
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	var req createQuoteRequestRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	if req.ProductType == "" {
		writeError(w, http.StatusBadRequest, "product_type is required")
		return
	}
	if req.CoverageCents <= 0 {
		writeError(w, http.StatusBadRequest, "coverage_cents must be greater than zero")
		return
	}
	// Cap coverage at $1B (in cents) so the premium/deductible int64 multiplies
	// below (coverage × bps) can't overflow into negative/garbage values — which
	// would mis-price quotes and violate the positive-premium CHECK (→ 500).
	const maxCoverageCents = int64(100_000_000_000) // $1,000,000,000.00
	if req.CoverageCents > maxCoverageCents {
		writeError(w, http.StatusBadRequest, "coverage_cents exceeds the maximum supported coverage ($1B)")
		return
	}
	// contract_id is optional, but if supplied it must be a valid UUID so a
	// malformed value returns a clear 400 rather than a 500 at insert time.
	var contractID *string
	if req.ContractID != "" {
		if !isValidUUID(req.ContractID) {
			writeError(w, http.StatusBadRequest, "invalid contract_id")
			return
		}
		cid := req.ContractID
		contractID = &cid
	}

	ctx := r.Context()

	// Fan-out target: every active rate card for this product_type belonging to
	// an APPROVED insurer. No matches → a valid request with zero quotes (the
	// customer simply has no carriers for that product type today).
	type offering struct {
		insurerID       string
		insurerName     string
		baseRateBps     int64
		minPremiumCents int64
	}
	rows, err := h.db.Query(ctx, `
		SELECT i.id::text, i.name, ip.base_rate_bps, ip.min_premium_cents
		  FROM insurer_products ip
		  JOIN insurers i ON i.id = ip.insurer_id
		 WHERE ip.product_type = $1
		   AND ip.active = true
		   AND i.status = 'approved'
		 ORDER BY i.name
		 LIMIT $2
	`, req.ProductType, maxCarriersPerRequest)
	if err != nil {
		slog.Error("insurance competition: fan-out query failed", "error", err, "product_type", req.ProductType)
		writeError(w, http.StatusInternalServerError, "failed to gather insurer offerings")
		return
	}
	var offerings []offering
	for rows.Next() {
		var o offering
		if err := rows.Scan(&o.insurerID, &o.insurerName, &o.baseRateBps, &o.minPremiumCents); err != nil {
			rows.Close()
			slog.Error("insurance competition: scan offering failed", "error", err)
			writeError(w, http.StatusInternalServerError, "failed to read insurer offerings")
			return
		}
		offerings = append(offerings, o)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		slog.Error("insurance competition: offering rows error", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to read insurer offerings")
		return
	}

	// Create the request + its quotes atomically so a partial fan-out can never
	// be observed.
	tx, err := h.db.Begin(ctx)
	if err != nil {
		slog.Error("insurance competition: begin tx failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to create quote request")
		return
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var requestID string
	var createdAt time.Time
	err = tx.QueryRow(ctx, `
		INSERT INTO insurance_quote_requests (customer_id, contract_id, product_type, coverage_cents)
		VALUES ($1, $2, $3, $4)
		RETURNING id::text, created_at
	`, claims.UserID, contractID, req.ProductType, req.CoverageCents).Scan(&requestID, &createdAt)
	if err != nil {
		slog.Error("insurance competition: insert request failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to create quote request")
		return
	}

	expiresAt := time.Now().Add(quoteExpiryDuration).UTC()
	deductibleCents := computeSampleDeductibleCents(req.CoverageCents)

	// Build the per-carrier quotes once, then INSERT them all in a SINGLE
	// multi-row statement (one round-trip) instead of N serial INSERTs inside
	// the tx. RETURNING also yields insurer_id so we can map each generated
	// quote id back to its offering regardless of row order.
	quotes := make([]quoteJSON, 0, len(offerings))
	if len(offerings) > 0 {
		// premium/terms per offering, indexed by insurer_id for the RETURNING map.
		byInsurer := make(map[string]quoteJSON, len(offerings))
		valueClauses := make([]string, 0, len(offerings))
		args := make([]interface{}, 0, len(offerings)*6)
		for _, o := range offerings {
			premium := computeCompetitivePremiumCents(req.CoverageCents, o.baseRateBps, o.minPremiumCents)
			terms := o.insurerName + " — covers " + req.ProductType +
				"; quote valid 7 days; deductible applies per claim."

			base := len(args)
			valueClauses = append(valueClauses, "($"+strconv.Itoa(base+1)+", $"+strconv.Itoa(base+2)+
				", $"+strconv.Itoa(base+3)+", $"+strconv.Itoa(base+4)+", $"+strconv.Itoa(base+5)+
				", $"+strconv.Itoa(base+6)+")")
			args = append(args, requestID, o.insurerID, premium, deductibleCents, terms, expiresAt)

			byInsurer[o.insurerID] = quoteJSON{
				InsurerID:       o.insurerID,
				InsurerName:     o.insurerName,
				PremiumCents:    premium,
				DeductibleCents: deductibleCents,
				Terms:           terms,
				ExpiresAt:       expiresAt,
			}
		}

		quoteRows, qerr := tx.Query(ctx, `
			INSERT INTO insurance_quotes
				(request_id, insurer_id, premium_cents, deductible_cents, terms, expires_at)
			VALUES `+strings.Join(valueClauses, ", ")+`
			RETURNING id::text, insurer_id::text
		`, args...)
		if qerr != nil {
			slog.Error("insurance competition: batch insert quotes failed", "error", qerr)
			writeError(w, http.StatusInternalServerError, "failed to generate insurer quotes")
			return
		}
		for quoteRows.Next() {
			var quoteID, insurerID string
			if err := quoteRows.Scan(&quoteID, &insurerID); err != nil {
				quoteRows.Close()
				slog.Error("insurance competition: scan inserted quote failed", "error", err)
				writeError(w, http.StatusInternalServerError, "failed to generate insurer quotes")
				return
			}
			q := byInsurer[insurerID]
			q.QuoteID = quoteID
			quotes = append(quotes, q)
		}
		quoteRows.Close()
		if err := quoteRows.Err(); err != nil {
			slog.Error("insurance competition: inserted quote rows error", "error", err)
			writeError(w, http.StatusInternalServerError, "failed to generate insurer quotes")
			return
		}
	}

	if err := tx.Commit(ctx); err != nil {
		slog.Error("insurance competition: commit failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to create quote request")
		return
	}

	// Cheapest premium first — the competitive ranking the customer compares on.
	sort.Slice(quotes, func(i, j int) bool {
		return quotes[i].PremiumCents < quotes[j].PremiumCents
	})

	writeJSON(w, http.StatusCreated, map[string]interface{}{
		"request_id": requestID,
		"quotes":     quotes,
	})
}

// ─────────────────────────────────────────────────────────────────────────
// GET /api/v1/insurance/quote-requests — the caller's requests
// ─────────────────────────────────────────────────────────────────────────

func (h *InsuranceCompetitionHandler) ListQuoteRequests(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		writeError(w, http.StatusServiceUnavailable, "database unavailable")
		return
	}
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	rows, err := h.db.Query(r.Context(), `
		SELECT id::text, customer_id::text, contract_id::text, product_type,
		       coverage_cents, status, selected_quote_id::text, created_at
		  FROM insurance_quote_requests
		 WHERE customer_id = $1
		 ORDER BY created_at DESC
	`, claims.UserID)
	if err != nil {
		slog.Error("insurance competition: list requests failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to list quote requests")
		return
	}
	defer rows.Close()

	requests := make([]quoteRequestJSON, 0)
	for rows.Next() {
		req, err := scanQuoteRequest(rows)
		if err != nil {
			slog.Error("insurance competition: scan request failed", "error", err)
			writeError(w, http.StatusInternalServerError, "failed to read quote requests")
			return
		}
		requests = append(requests, req)
	}
	if err := rows.Err(); err != nil {
		slog.Error("insurance competition: list rows error", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to read quote requests")
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{"quote_requests": requests})
}

// ─────────────────────────────────────────────────────────────────────────
// GET /api/v1/insurance/quote-requests/{id} — request + its quotes
// ─────────────────────────────────────────────────────────────────────────

func (h *InsuranceCompetitionHandler) GetQuoteRequest(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		writeError(w, http.StatusServiceUnavailable, "database unavailable")
		return
	}
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	id := chi.URLParam(r, "id")
	if !isValidUUID(id) {
		writeError(w, http.StatusBadRequest, "invalid quote request id")
		return
	}

	ctx := r.Context()
	req, ownerID, err := h.loadQuoteRequest(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "quote request not found")
		return
	}
	if err != nil {
		slog.Error("insurance competition: load request failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to load quote request")
		return
	}

	// Owner-or-admin only. Non-owners get 404 (not 403) so the endpoint does not
	// leak the existence of another customer's request (IDOR fix, matching the
	// posture in insurance.go).
	if !hasRole(claims, "admin") && ownerID != claims.UserID {
		writeError(w, http.StatusNotFound, "quote request not found")
		return
	}

	quotes, err := h.loadQuotes(ctx, id)
	if err != nil {
		slog.Error("insurance competition: load quotes failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to load quotes")
		return
	}
	req.Quotes = quotes

	writeJSON(w, http.StatusOK, req)
}

// ─────────────────────────────────────────────────────────────────────────
// POST /api/v1/insurance/quote-requests/{id}/select — bind a winning quote
// ─────────────────────────────────────────────────────────────────────────

func (h *InsuranceCompetitionHandler) SelectQuote(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		writeError(w, http.StatusServiceUnavailable, "database unavailable")
		return
	}
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	id := chi.URLParam(r, "id")
	if !isValidUUID(id) {
		writeError(w, http.StatusBadRequest, "invalid quote request id")
		return
	}

	var body selectQuoteRequest
	if !decodeJSON(w, r, &body) {
		return
	}
	if !isValidUUID(body.QuoteID) {
		writeError(w, http.StatusBadRequest, "invalid quote_id")
		return
	}

	ctx := r.Context()

	tx, err := h.db.Begin(ctx)
	if err != nil {
		slog.Error("insurance competition: begin select tx failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to select quote")
		return
	}
	defer func() { _ = tx.Rollback(ctx) }()

	// Lock the request row so a concurrent double-select is serialized.
	var ownerID, status, productType string
	var coverageCents int64
	var contractID *string
	var existingSelected *string
	err = tx.QueryRow(ctx, `
		SELECT customer_id::text, status, product_type, coverage_cents,
		       contract_id::text, selected_quote_id::text
		  FROM insurance_quote_requests
		 WHERE id = $1
		 FOR UPDATE
	`, id).Scan(&ownerID, &status, &productType, &coverageCents, &contractID, &existingSelected)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "quote request not found")
		return
	}
	if err != nil {
		slog.Error("insurance competition: load request for select failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to select quote")
		return
	}

	// Only the owner may bind (admins are not customers here; binding creates a
	// policy FOR the customer, so it must be the customer themselves). 404 to
	// non-owners to avoid leaking request existence.
	if ownerID != claims.UserID {
		writeError(w, http.StatusNotFound, "quote request not found")
		return
	}

	// Idempotency: if already bound, return the existing policy. Re-selecting a
	// DIFFERENT quote on an already-bound request is a conflict.
	if status == "bound" {
		if existingSelected != nil && *existingSelected != body.QuoteID {
			writeError(w, http.StatusConflict, "quote request is already bound to a different quote")
			return
		}
		policy, err := h.loadPolicyByRequest(ctx, tx, id)
		if err != nil {
			slog.Error("insurance competition: load bound policy failed", "error", err)
			writeError(w, http.StatusInternalServerError, "failed to load bound policy")
			return
		}
		if err := tx.Commit(ctx); err != nil {
			slog.Error("insurance competition: commit idempotent select failed", "error", err)
			writeError(w, http.StatusInternalServerError, "failed to select quote")
			return
		}
		writeJSON(w, http.StatusOK, policy)
		return
	}
	if status == "expired" {
		writeError(w, http.StatusConflict, "quote request has expired")
		return
	}

	// Validate the chosen quote belongs to THIS request and pull its terms.
	var insurerID, terms string
	var insurerName string
	var premiumCents, deductibleCents int64
	var expiresAt time.Time
	err = tx.QueryRow(ctx, `
		SELECT q.insurer_id::text, i.name, q.premium_cents, q.deductible_cents,
		       q.terms, q.expires_at
		  FROM insurance_quotes q
		  JOIN insurers i ON i.id = q.insurer_id
		 WHERE q.id = $1 AND q.request_id = $2
	`, body.QuoteID, id).Scan(&insurerID, &insurerName, &premiumCents, &deductibleCents, &terms, &expiresAt)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusBadRequest, "quote does not belong to this request")
		return
	}
	if err != nil {
		slog.Error("insurance competition: load selected quote failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to select quote")
		return
	}
	if time.Now().After(expiresAt) {
		writeError(w, http.StatusConflict, "selected quote has expired")
		return
	}

	// Mark the request bound.
	if _, err := tx.Exec(ctx, `
		UPDATE insurance_quote_requests
		   SET status = 'bound', selected_quote_id = $2
		 WHERE id = $1
	`, id, body.QuoteID); err != nil {
		slog.Error("insurance competition: mark bound failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to bind quote request")
		return
	}

	// Bind the policy to the winning insurer. The unique constraint on
	// (request_id) makes this safe against a concurrent racer that slipped past
	// the row lock in a different connection.
	expirationDate := time.Now().Add(quoteExpiryDuration).UTC().Format("2006-01-02")
	var policyID string
	var effectiveDate, expDate time.Time
	err = tx.QueryRow(ctx, `
		INSERT INTO marketplace_policies
			(request_id, quote_id, insurer_id, customer_id, contract_id, product_type,
			 coverage_amount_cents, premium_cents, deductible_cents, terms, expiration_date)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
		RETURNING id::text, effective_date, expiration_date
	`, id, body.QuoteID, insurerID, claims.UserID, contractID, productType,
		coverageCents, premiumCents, deductibleCents, terms, expirationDate).
		Scan(&policyID, &effectiveDate, &expDate)
	if err != nil {
		slog.Error("insurance competition: insert policy failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to bind policy")
		return
	}

	if err := tx.Commit(ctx); err != nil {
		slog.Error("insurance competition: commit select failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to select quote")
		return
	}

	expStr := expDate.Format("2006-01-02")
	writeJSON(w, http.StatusCreated, marketplacePolicyJSON{
		ID:                  policyID,
		RequestID:           id,
		QuoteID:             body.QuoteID,
		InsurerID:           insurerID,
		InsurerName:         insurerName,
		CustomerID:          claims.UserID,
		ContractID:          contractID,
		ProductType:         productType,
		CoverageAmountCents: coverageCents,
		PremiumCents:        premiumCents,
		DeductibleCents:     deductibleCents,
		Terms:               terms,
		Status:              "active",
		EffectiveDate:       effectiveDate.Format("2006-01-02"),
		ExpirationDate:      &expStr,
	})
}

// ─────────────────────────────────────────────────────────────────────────
// ADMIN: GET /api/v1/admin/insurers — list carriers + rate cards
// ─────────────────────────────────────────────────────────────────────────

type insurerProductJSON struct {
	ID              string `json:"id"`
	ProductType     string `json:"product_type"`
	BaseRateBps     int    `json:"base_rate_bps"`
	MinPremiumCents int64  `json:"min_premium_cents"`
	Active          bool   `json:"active"`
}

type insurerJSON struct {
	ID            string               `json:"id"`
	Name          string               `json:"name"`
	Slug          string               `json:"slug"`
	Status        string               `json:"status"`
	PayoutAccount *string              `json:"payout_account"`
	Products      []insurerProductJSON `json:"products"`
	CreatedAt     time.Time            `json:"created_at"`
}

func (h *InsuranceCompetitionHandler) AdminListInsurers(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		writeError(w, http.StatusServiceUnavailable, "database unavailable")
		return
	}
	ctx := r.Context()

	rows, err := h.db.Query(ctx, `
		SELECT id::text, name, slug, status, payout_account, created_at
		  FROM insurers
		 ORDER BY name
	`)
	if err != nil {
		slog.Error("insurance competition: admin list insurers failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to list insurers")
		return
	}
	defer rows.Close()

	insurers := make([]insurerJSON, 0)
	index := make(map[string]int)
	for rows.Next() {
		var ins insurerJSON
		if err := rows.Scan(&ins.ID, &ins.Name, &ins.Slug, &ins.Status, &ins.PayoutAccount, &ins.CreatedAt); err != nil {
			slog.Error("insurance competition: scan insurer failed", "error", err)
			writeError(w, http.StatusInternalServerError, "failed to read insurers")
			return
		}
		ins.Products = make([]insurerProductJSON, 0)
		index[ins.ID] = len(insurers)
		insurers = append(insurers, ins)
	}
	if err := rows.Err(); err != nil {
		slog.Error("insurance competition: insurer rows error", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to read insurers")
		return
	}

	prodRows, err := h.db.Query(ctx, `
		SELECT id::text, insurer_id::text, product_type, base_rate_bps, min_premium_cents, active
		  FROM insurer_products
		 ORDER BY product_type
	`)
	if err != nil {
		slog.Error("insurance competition: list rate cards failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to list rate cards")
		return
	}
	defer prodRows.Close()

	for prodRows.Next() {
		var insurerID string
		var p insurerProductJSON
		if err := prodRows.Scan(&p.ID, &insurerID, &p.ProductType, &p.BaseRateBps, &p.MinPremiumCents, &p.Active); err != nil {
			slog.Error("insurance competition: scan rate card failed", "error", err)
			writeError(w, http.StatusInternalServerError, "failed to read rate cards")
			return
		}
		if i, ok := index[insurerID]; ok {
			insurers[i].Products = append(insurers[i].Products, p)
		}
	}
	if err := prodRows.Err(); err != nil {
		slog.Error("insurance competition: rate card rows error", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to read rate cards")
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{"insurers": insurers})
}

// ─────────────────────────────────────────────────────────────────────────
// ADMIN: POST /api/v1/admin/insurers — onboard a carrier + initial rate card
// ─────────────────────────────────────────────────────────────────────────

type rateCardInput struct {
	ProductType     string `json:"product_type"`
	BaseRateBps     int    `json:"base_rate_bps"`
	MinPremiumCents int64  `json:"min_premium_cents"`
	Active          *bool  `json:"active"`
}

type createInsurerRequest struct {
	Name          string          `json:"name"`
	Slug          string          `json:"slug"`
	Status        string          `json:"status"`
	PayoutAccount string          `json:"payout_account"`
	RateCard      []rateCardInput `json:"rate_card"`
}

func (h *InsuranceCompetitionHandler) AdminCreateInsurer(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		writeError(w, http.StatusServiceUnavailable, "database unavailable")
		return
	}

	var req createInsurerRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	if req.Name == "" {
		writeError(w, http.StatusBadRequest, "name is required")
		return
	}
	if req.Slug == "" {
		writeError(w, http.StatusBadRequest, "slug is required")
		return
	}
	status := req.Status
	if status == "" {
		status = "pending"
	}
	if !isValidInsurerStatus(status) {
		writeError(w, http.StatusBadRequest, "status must be pending, approved, or suspended")
		return
	}
	if err := validateRateCard(req.RateCard); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	var payoutAccount *string
	if req.PayoutAccount != "" {
		pa := req.PayoutAccount
		payoutAccount = &pa
	}

	ctx := r.Context()
	tx, err := h.db.Begin(ctx)
	if err != nil {
		slog.Error("insurance competition: begin create insurer tx failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to create insurer")
		return
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var insurerID string
	var createdAt time.Time
	err = tx.QueryRow(ctx, `
		INSERT INTO insurers (name, slug, status, payout_account)
		VALUES ($1, $2, $3, $4)
		RETURNING id::text, created_at
	`, req.Name, req.Slug, status, payoutAccount).Scan(&insurerID, &createdAt)
	if err != nil {
		// A duplicate slug is a client error (409), not a 500.
		if isUniqueViolation(err) {
			writeError(w, http.StatusConflict, "an insurer with that slug already exists")
			return
		}
		slog.Error("insurance competition: insert insurer failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to create insurer")
		return
	}

	products := make([]insurerProductJSON, 0, len(req.RateCard))
	for _, rc := range req.RateCard {
		active := true
		if rc.Active != nil {
			active = *rc.Active
		}
		var prodID string
		err = tx.QueryRow(ctx, `
			INSERT INTO insurer_products (insurer_id, product_type, base_rate_bps, min_premium_cents, active)
			VALUES ($1, $2, $3, $4, $5)
			RETURNING id::text
		`, insurerID, rc.ProductType, rc.BaseRateBps, rc.MinPremiumCents, active).Scan(&prodID)
		if err != nil {
			if isUniqueViolation(err) {
				writeError(w, http.StatusConflict, "duplicate product_type in rate card")
				return
			}
			slog.Error("insurance competition: insert rate card failed", "error", err)
			writeError(w, http.StatusInternalServerError, "failed to create rate card")
			return
		}
		products = append(products, insurerProductJSON{
			ID:              prodID,
			ProductType:     rc.ProductType,
			BaseRateBps:     rc.BaseRateBps,
			MinPremiumCents: rc.MinPremiumCents,
			Active:          active,
		})
	}

	if err := tx.Commit(ctx); err != nil {
		slog.Error("insurance competition: commit create insurer failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to create insurer")
		return
	}

	writeJSON(w, http.StatusCreated, insurerJSON{
		ID:            insurerID,
		Name:          req.Name,
		Slug:          req.Slug,
		Status:        status,
		PayoutAccount: payoutAccount,
		Products:      products,
		CreatedAt:     createdAt,
	})
}

// ─────────────────────────────────────────────────────────────────────────
// ADMIN: PUT /api/v1/admin/insurers/{id} — approve/suspend + edit rate card
// ─────────────────────────────────────────────────────────────────────────

type updateInsurerRequest struct {
	Status        *string         `json:"status"`
	PayoutAccount *string         `json:"payout_account"`
	RateCard      []rateCardInput `json:"rate_card"`
}

func (h *InsuranceCompetitionHandler) AdminUpdateInsurer(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		writeError(w, http.StatusServiceUnavailable, "database unavailable")
		return
	}

	id := chi.URLParam(r, "id")
	if !isValidUUID(id) {
		writeError(w, http.StatusBadRequest, "invalid insurer id")
		return
	}

	var req updateInsurerRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	if req.Status != nil && !isValidInsurerStatus(*req.Status) {
		writeError(w, http.StatusBadRequest, "status must be pending, approved, or suspended")
		return
	}
	// rate_card here UPSERTS each named product_type (edit the rate / activate /
	// deactivate). Validate before opening the tx.
	if err := validateRateCard(req.RateCard); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	ctx := r.Context()
	tx, err := h.db.Begin(ctx)
	if err != nil {
		slog.Error("insurance competition: begin update insurer tx failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to update insurer")
		return
	}
	defer func() { _ = tx.Rollback(ctx) }()

	// Ensure the insurer exists (and lock it) before applying edits.
	var exists bool
	err = tx.QueryRow(ctx, `SELECT true FROM insurers WHERE id = $1 FOR UPDATE`, id).Scan(&exists)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "insurer not found")
		return
	}
	if err != nil {
		slog.Error("insurance competition: lock insurer failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to update insurer")
		return
	}

	if req.Status != nil {
		if _, err := tx.Exec(ctx, `UPDATE insurers SET status = $2 WHERE id = $1`, id, *req.Status); err != nil {
			slog.Error("insurance competition: update status failed", "error", err)
			writeError(w, http.StatusInternalServerError, "failed to update insurer status")
			return
		}
	}
	if req.PayoutAccount != nil {
		var pa *string
		if *req.PayoutAccount != "" {
			pa = req.PayoutAccount
		}
		if _, err := tx.Exec(ctx, `UPDATE insurers SET payout_account = $2 WHERE id = $1`, id, pa); err != nil {
			slog.Error("insurance competition: update payout account failed", "error", err)
			writeError(w, http.StatusInternalServerError, "failed to update payout account")
			return
		}
	}

	// Upsert each rate-card row on (insurer_id, product_type).
	for _, rc := range req.RateCard {
		active := true
		if rc.Active != nil {
			active = *rc.Active
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO insurer_products (insurer_id, product_type, base_rate_bps, min_premium_cents, active)
			VALUES ($1, $2, $3, $4, $5)
			ON CONFLICT (insurer_id, product_type)
			DO UPDATE SET base_rate_bps = EXCLUDED.base_rate_bps,
			              min_premium_cents = EXCLUDED.min_premium_cents,
			              active = EXCLUDED.active
		`, id, rc.ProductType, rc.BaseRateBps, rc.MinPremiumCents, active); err != nil {
			slog.Error("insurance competition: upsert rate card failed", "error", err)
			writeError(w, http.StatusInternalServerError, "failed to update rate card")
			return
		}
	}

	if err := tx.Commit(ctx); err != nil {
		slog.Error("insurance competition: commit update insurer failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to update insurer")
		return
	}

	// Return the refreshed insurer so the admin UI reflects the new state.
	ins, err := h.loadInsurer(ctx, id)
	if err != nil {
		slog.Error("insurance competition: reload insurer failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to load updated insurer")
		return
	}
	writeJSON(w, http.StatusOK, ins)
}

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

func isValidInsurerStatus(s string) bool {
	return s == "pending" || s == "approved" || s == "suspended"
}

// validateRateCard enforces non-negative rates / minimums and non-empty product
// types so a bad rate card returns a 400 rather than a constraint 500.
func validateRateCard(card []rateCardInput) error {
	for _, rc := range card {
		if rc.ProductType == "" {
			return errors.New("each rate_card entry requires a product_type")
		}
		if rc.BaseRateBps < 0 {
			return errors.New("base_rate_bps must be non-negative")
		}
		if rc.MinPremiumCents < 0 {
			return errors.New("min_premium_cents must be non-negative")
		}
	}
	return nil
}

// (isUniqueViolation lives in referrals.go — SQLSTATE 23505 → 409.)

// rowScanner abstracts pgx.Row / pgx.Rows so scanQuoteRequest works for both.
type rowScanner interface {
	Scan(dest ...any) error
}

func scanQuoteRequest(s rowScanner) (quoteRequestJSON, error) {
	var q quoteRequestJSON
	if err := s.Scan(
		&q.RequestID, &q.CustomerID, &q.ContractID, &q.ProductType,
		&q.CoverageCents, &q.Status, &q.SelectedQuoteID, &q.CreatedAt,
	); err != nil {
		return quoteRequestJSON{}, err
	}
	return q, nil
}

// loadQuoteRequest returns the request plus its owner id (for the access check).
func (h *InsuranceCompetitionHandler) loadQuoteRequest(ctx context.Context, id string) (quoteRequestJSON, string, error) {
	row := h.db.QueryRow(ctx, `
		SELECT id::text, customer_id::text, contract_id::text, product_type,
		       coverage_cents, status, selected_quote_id::text, created_at
		  FROM insurance_quote_requests
		 WHERE id = $1
	`, id)
	q, err := scanQuoteRequest(row)
	if err != nil {
		return quoteRequestJSON{}, "", err
	}
	return q, q.CustomerID, nil
}

func (h *InsuranceCompetitionHandler) loadQuotes(ctx context.Context, requestID string) ([]quoteJSON, error) {
	rows, err := h.db.Query(ctx, `
		SELECT q.id::text, q.insurer_id::text, i.name, q.premium_cents,
		       q.deductible_cents, q.terms, q.expires_at
		  FROM insurance_quotes q
		  JOIN insurers i ON i.id = q.insurer_id
		 WHERE q.request_id = $1
		 ORDER BY q.premium_cents ASC
	`, requestID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	quotes := make([]quoteJSON, 0)
	for rows.Next() {
		var q quoteJSON
		if err := rows.Scan(&q.QuoteID, &q.InsurerID, &q.InsurerName, &q.PremiumCents,
			&q.DeductibleCents, &q.Terms, &q.ExpiresAt); err != nil {
			return nil, err
		}
		quotes = append(quotes, q)
	}
	return quotes, rows.Err()
}

// loadPolicyByRequest returns the bound marketplace policy for a request (used
// for the idempotent re-select path). tx may be a live transaction.
func (h *InsuranceCompetitionHandler) loadPolicyByRequest(ctx context.Context, tx pgx.Tx, requestID string) (marketplacePolicyJSON, error) {
	var p marketplacePolicyJSON
	var effectiveDate time.Time
	var expirationDate *time.Time
	err := tx.QueryRow(ctx, `
		SELECT mp.id::text, mp.request_id::text, mp.quote_id::text, mp.insurer_id::text,
		       i.name, mp.customer_id::text, mp.contract_id::text, mp.product_type,
		       mp.coverage_amount_cents, mp.premium_cents, mp.deductible_cents, mp.terms,
		       mp.status, mp.effective_date, mp.expiration_date
		  FROM marketplace_policies mp
		  JOIN insurers i ON i.id = mp.insurer_id
		 WHERE mp.request_id = $1
	`, requestID).Scan(
		&p.ID, &p.RequestID, &p.QuoteID, &p.InsurerID, &p.InsurerName, &p.CustomerID,
		&p.ContractID, &p.ProductType, &p.CoverageAmountCents, &p.PremiumCents,
		&p.DeductibleCents, &p.Terms, &p.Status, &effectiveDate, &expirationDate,
	)
	if err != nil {
		return marketplacePolicyJSON{}, err
	}
	p.EffectiveDate = effectiveDate.Format("2006-01-02")
	if expirationDate != nil {
		s := expirationDate.Format("2006-01-02")
		p.ExpirationDate = &s
	}
	return p, nil
}

// loadInsurer returns one insurer with its full rate card.
func (h *InsuranceCompetitionHandler) loadInsurer(ctx context.Context, id string) (insurerJSON, error) {
	var ins insurerJSON
	err := h.db.QueryRow(ctx, `
		SELECT id::text, name, slug, status, payout_account, created_at
		  FROM insurers WHERE id = $1
	`, id).Scan(&ins.ID, &ins.Name, &ins.Slug, &ins.Status, &ins.PayoutAccount, &ins.CreatedAt)
	if err != nil {
		return insurerJSON{}, err
	}

	rows, err := h.db.Query(ctx, `
		SELECT id::text, product_type, base_rate_bps, min_premium_cents, active
		  FROM insurer_products WHERE insurer_id = $1 ORDER BY product_type
	`, id)
	if err != nil {
		return insurerJSON{}, err
	}
	defer rows.Close()

	ins.Products = make([]insurerProductJSON, 0)
	for rows.Next() {
		var p insurerProductJSON
		if err := rows.Scan(&p.ID, &p.ProductType, &p.BaseRateBps, &p.MinPremiumCents, &p.Active); err != nil {
			return insurerJSON{}, err
		}
		ins.Products = append(ins.Products, p)
	}
	return ins, rows.Err()
}
