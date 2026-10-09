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

    /// GET `/api/v1/jobs/{id}/viewer-count` — public active-viewer count.
    func fetchJobViewerCount(jobId: String) async throws -> Int {
        let trimmed = jobId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "Job id is required.")
        }
        let payload: JobViewerCountResponse = try await getJSON(
            pathComponents: ["api", "v1", "jobs", trimmed, "viewer-count"],
            authorized: false
        )
        return max(0, payload.count ?? 0)
    }

    /// POST `/api/v1/jobs/{id}/ping-viewer` — auth-only presence ping. 204.
    /// Logged-out callers must not hit this: a 401 would bounce the session.
    func pingJobViewer(jobId: String) async throws {
        let trimmed = jobId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "Job id is required.")
        }
        try await postEmpty(
            pathComponents: ["api", "v1", "jobs", trimmed, "ping-viewer"],
            body: EmptyJSONObject(),
            authorized: .required
        )
    }

    /// GET `/api/v1/categories/{id}/questions` — public pre-quote set.
    /// Named apart from the admin `fetchCategoryQuestions` (same path, row type
    /// without select options). Swift cannot overload on the return type alone.
    func fetchPublicCategoryQuestions(categoryId: String) async throws -> [CategoryQuestion] {
        let trimmed = categoryId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return [] }
        let payload: PublicCategoryQuestionsResponse = try await getJSON(
            pathComponents: ["api", "v1", "categories", trimmed, "questions"],
            authorized: false
        )
        return (payload.questions ?? []).sorted { ($0.displayOrder ?? 0) < ($1.displayOrder ?? 0) }
    }

    /// GET `/api/v1/jobs/{id}/answers` — owner, admin, or a provider with a bid.
    func fetchJobAnswers(jobId: String) async throws -> [JobQuestionAnswer] {
        let trimmed = jobId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "Job id is required.")
        }
        let payload: JobAnswersResponse = try await getJSON(
            pathComponents: ["api", "v1", "jobs", trimmed, "answers"],
            authorized: true
        )
        return payload.answers ?? []
    }

    /// POST `/api/v1/jobs/{id}/answers` — job owner upserts pre-quote answers.
    func submitJobAnswers(jobId: String, answers: [SubmitJobAnswerBody]) async throws {
        let trimmed = jobId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "Job id is required.")
        }
        guard !answers.isEmpty else { return }
        let _: SavedAnswersResponse = try await postJSON(
            pathComponents: ["api", "v1", "jobs", trimmed, "answers"],
            body: SubmitJobAnswersBody(answers: answers),
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

struct JobViewerCountResponse: Codable, Sendable {
    var count: Int?
}

struct CategoryQuestion: Codable, Identifiable, Hashable, Sendable {
    let id: String
    var categoryId: String?
    let question: String
    let questionType: String
    let options: [String]?
    var required: Bool?
    var displayOrder: Int?
}

struct PublicCategoryQuestionsResponse: Codable, Sendable {
    var questions: [CategoryQuestion]?
}

enum JobAnswerJSONValue: Codable, Hashable, Sendable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case strings([String])
    case null

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
            return
        }
        if let value = try? container.decode(Bool.self) {
            self = .bool(value)
            return
        }
        if let value = try? container.decode(Double.self) {
            self = .number(value)
            return
        }
        if let value = try? container.decode(String.self) {
            self = .string(value)
            return
        }
        if let value = try? container.decode([String].self) {
            self = .strings(value)
            return
        }
        self = .null
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .string(let value):
            try container.encode(value)
        case .number(let value):
            try container.encode(value)
        case .bool(let value):
            try container.encode(value)
        case .strings(let value):
            try container.encode(value)
        case .null:
            try container.encodeNil()
        }
    }

    var displayText: String {
        switch self {
        case .string(let value):
            return value
        case .number(let value):
            if value.rounded() == value {
                return String(Int(value))
            }
            return String(value)
        case .bool(let value):
            return value ? "Yes" : "No"
        case .strings(let value):
            return value.joined(separator: ", ")
        case .null:
            return ""
        }
    }
}

struct JobQuestionAnswer: Codable, Identifiable, Hashable, Sendable {
    let id: String
    let questionId: String
    var answerText: String?
    var answerJson: JobAnswerJSONValue?

    var displayText: String {
        let text = answerText?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !text.isEmpty { return text }
        return answerJson?.displayText ?? ""
    }
}

struct JobAnswersResponse: Codable, Sendable {
    var answers: [JobQuestionAnswer]?
}

struct SubmitJobAnswerBody: Encodable, Sendable {
    let questionId: String
    let answerText: String?
    let answerJson: JobAnswerJSONValue?
}

private struct SubmitJobAnswersBody: Encodable {
    let answers: [SubmitJobAnswerBody]
}

private struct SavedAnswersResponse: Codable, Sendable {
    var saved: Int?
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
