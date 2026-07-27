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
}
