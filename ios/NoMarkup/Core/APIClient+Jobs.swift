import Foundation

// MARK: - Jobs / service-bid API

extension APIClient {
    /// DELETE `/api/v1/bids/{id}` — provider withdraws their active service bid.
    /// Gateway returns the bid JSON; empty / 204 bodies are also treated as success.
    func withdrawJobBid(id: String) async throws {
        let trimmed = id.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "Bid id is required.")
        }
        try await deleteEmpty(
            pathComponents: ["api", "v1", "bids", trimmed],
            authorized: .required
        )
    }

    /// PATCH `/api/v1/bids/{id}` — provider lowers an active service bid (never raise).
    /// Body: `{ "new_amount_cents": N }` (must be strictly less than current — engine-enforced).
    /// No Idempotency-Key on this route (unlike POST place-bid).
    @discardableResult
    func updateJobBid(id: String, newAmountCents: Int64) async throws -> JobBidCore {
        let trimmed = id.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "Bid id is required.")
        }
        guard newAmountCents > 0 else {
            throw APIClientError.httpStatus(400, detail: "New amount must be greater than zero.")
        }
        return try await patchJSON(
            pathComponents: ["api", "v1", "bids", trimmed],
            body: UpdateJobBidBody(newAmountCents: newAmountCents),
            authorized: .required
        )
    }

    /// POST `/api/v1/jobs/{id}/bids/accept-offer` — provider accepts the customer's
    /// instant offer price (`offer_accepted_cents`). Creates a bid at that amount with
    /// `is_offer_accepted = true`. Provider role required. Empty body.
    /// Does not auto-award; customer still selects among acceptors / awards a bid.
    @discardableResult
    func acceptJobOffer(jobId: String) async throws -> JobBidCore {
        let trimmed = jobId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "Job id is required.")
        }
        return try await postJSON(
            pathComponents: ["api", "v1", "jobs", trimmed, "bids", "accept-offer"],
            body: EmptyJSONObject(),
            authorized: .required
        )
    }

    /// GET `/api/v1/jobs/{id}/auction/state` — live reverse-auction snapshot (optional feature).
    /// Callers should treat decode / 404 failures as non-fatal.
    func fetchJobAuctionState(jobId: String) async throws -> LiveAuctionState {
        let trimmed = jobId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "Job id is required.")
        }
        return try await getJSON(
            pathComponents: ["api", "v1", "jobs", trimmed, "auction", "state"],
            authorized: false
        )
    }

    /// GET `/api/v1/jobs/{id}/auction/events` — recent live-auction activity (optional feature).
    /// Accepts a bare JSON array or `{ "events": [...] }`. Soft-fail 404 / decode at the call site.
    func fetchJobAuctionEvents(jobId: String) async throws -> [AuctionEvent] {
        let trimmed = jobId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "Job id is required.")
        }
        let payload: AuctionEventsPayload = try await getJSON(
            pathComponents: ["api", "v1", "jobs", trimmed, "auction", "events"],
            authorized: false
        )
        return payload.events
    }

    /// POST `/api/v1/jobs/{id}/cancel` — owner cancels the job auction.
    func cancelJob(id: String) async throws {
        let trimmed = id.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "Job id is required.")
        }
        try await postEmpty(
            pathComponents: ["api", "v1", "jobs", trimmed, "cancel"],
            body: EmptyJSONObject(),
            authorized: .required
        )
    }

    /// POST `/api/v1/jobs/{id}/close` — owner closes reverse auction (award window).
    func closeJob(id: String) async throws {
        let trimmed = id.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "Job id is required.")
        }
        try await postEmpty(
            pathComponents: ["api", "v1", "jobs", trimmed, "close"],
            body: EmptyJSONObject(),
            authorized: .required
        )
    }

    /// GET `/api/v1/jobs/drafts` — customer's unpublished job drafts (Bearer required).
    /// Response: `{ "drafts": [ Job-like objects ] }`.
    func fetchJobDrafts() async throws -> JobDraftsResponse {
        try await getJSON(
            pathComponents: ["api", "v1", "jobs", "drafts"],
            authorized: true
        )
    }

    /// POST `/api/v1/jobs/{id}/publish` — publish a draft to the active reverse auction.
    /// Response is the job JSON map (not wrapped), same shape as create.
    @discardableResult
    func publishJob(id: String) async throws -> JobDetail {
        let trimmed = id.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "Job id is required.")
        }
        return try await postJSON(
            pathComponents: ["api", "v1", "jobs", trimmed, "publish"],
            body: EmptyJSONObject(),
            authorized: .required
        )
    }

    /// POST `/api/v1/jobs/{id}/instant-match` — customer-owned job only.
    /// Broadcasts a pending Instant offer (Redis, ~15 min). Requires `offer_accepted_cents` on the job
    /// (server rejects without it). Empty body. Response: `{ "status", "expires_at" }`.
    /// Role: customer + job owner (gateway enforces; never invent offers client-side).
    @discardableResult
    func createInstantMatch(jobId: String) async throws -> InstantMatchCreateResponse {
        let trimmed = jobId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "Job id is required.")
        }
        return try await postJSON(
            pathComponents: ["api", "v1", "jobs", trimmed, "instant-match"],
            body: EmptyJSONObject(),
            authorized: .required
        )
    }

    /// POST `/api/v1/jobs/{id}/repost` — owner creates a new auction from a closed/expired/
    /// cancelled (or zero-bid closed) job (FR-3.5 / FR-3.10). Previous bids do not carry over.
    /// Optional overrides let the customer tweak starting bid / duration / title / description.
    @discardableResult
    func repostJob(
        id: String,
        title: String? = nil,
        description: String? = nil,
        startingBidCents: Int64? = nil,
        offerAcceptedCents: Int64? = nil,
        auctionDurationHours: Int? = nil
    ) async throws -> JobDetail {
        let trimmed = id.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "Job id is required.")
        }
        func optionalTrimmed(_ value: String?) -> String? {
            guard let value else { return nil }
            let t = value.trimmingCharacters(in: .whitespacesAndNewlines)
            return t.isEmpty ? nil : t
        }
        let body = RepostJobBody(
            title: optionalTrimmed(title),
            description: optionalTrimmed(description),
            startingBidCents: startingBidCents,
            offerAcceptedCents: offerAcceptedCents,
            auctionDurationHours: auctionDurationHours
        )
        return try await postJSON(
            pathComponents: ["api", "v1", "jobs", trimmed, "repost"],
            body: body,
            authorized: .required
        )
    }
}

// MARK: - Request bodies (camelCase → snake_case via encoder)

/// Body for `PATCH /api/v1/bids/{id}` — reverse-auction lower only.
private struct UpdateJobBidBody: Encodable {
    let newAmountCents: Int64
}

/// Body for `POST /api/v1/jobs/{id}/repost` — all fields optional (empty = copy original).
private struct RepostJobBody: Encodable {
    let title: String?
    let description: String?
    let startingBidCents: Int64?
    let offerAcceptedCents: Int64?
    let auctionDurationHours: Int?
}

// MARK: - Instant match (customer create)

/// `POST /api/v1/jobs/{id}/instant-match` response.
struct InstantMatchCreateResponse: Codable, Sendable, Hashable {
    var status: String?
    var expiresAt: String?
    /// Schedule-eligible Instant providers that received in-app fan-out.
    var providersNotified: Int?

    var displayStatus: String {
        let s = status?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return s.isEmpty ? "offer_sent" : s
    }

    var isOfferSent: Bool {
        displayStatus.lowercased() == "offer_sent" || displayStatus.lowercased() == "pending"
    }
}
