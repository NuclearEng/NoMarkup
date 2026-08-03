import Foundation

// MARK: - Contracts API (extension — do not expand APIClient.swift core)
//
// Auth: Bearer required. Reuses internal getJSON / postJSON / putJSON / postEmpty / AuthMode.
//
// Endpoints (gateway/internal/handler/contract.go + review.go + quote_templates tip):
//   GET  /api/v1/contracts
//   GET  /api/v1/contracts/{id}
//   POST /api/v1/contracts/{id}/accept|start|complete|approve-completion|cancel
//   POST /api/v1/contracts/{id}/disputes   body: dispute_type, description
//   POST /api/v1/contracts/{id}/reviews   body: overall_rating, comment
//   POST /api/v1/milestones/{id}/submit|approve
//   GET|POST /api/v1/contracts/{id}/change-orders
//   PUT  /api/v1/contracts/{id}/change-orders/{orderId}
//   POST /api/v1/contracts/{id}/tip
//   GET|POST /api/v1/contracts/{id}/guarantee-claim
//   POST /api/v1/contracts/{id}/report-noshow|report-abandonment
//   GET  /api/v1/contracts/{id}/pdf
//   POST /api/v1/contracts/{id}/checkin|checkout  body: { lat, lng }
//   GET  /api/v1/contracts/{id}/work-session
//   POST /api/v1/contracts/{id}/completion-photos  multipart photo + phase
//   GET|PATCH /api/v1/contracts/{id}/recurring (+ pause|resume|cancel, instances)
//
// Escrow (gateway/internal/handler/payment.go) — services path (FR-9):
//   POST /api/v1/payments                 body: contract_id, amount_cents, provider_id?
//                                         → payment + client_secret (Idempotency-Key)
//   POST /api/v1/payments/calculate-fees  body: amount_cents  (display only)
//   POST /api/v1/payments/{id}/process    body: payment_method_id?  → capture → escrow
//   GET  /api/v1/payments?status=escrow|pending|…
//   POST /api/v1/payments/{id}/release    body: { reason? } + Idempotency-Key
//   Note: approve-completion finalizes the *contract* only; it does NOT call
//   ReleaseEscrow. Customer must POST …/release (provider self-release refused).
//   Goods listing orders release via mutual pickup handshake (not this route).
//
// Security: charge amount is contract.amount_cents from GET /contracts/{id};
// CreatePayment re-validates ownership, amount ≤ contract, and re-derives provider.

extension APIClient {

    // MARK: Reads

    /// GET `/api/v1/contracts?page=&page_size=&status=`
    func fetchContracts(
        page: Int = 1,
        pageSize: Int = 20,
        status: String? = nil
    ) async throws -> ContractsListResponse {
        var query = [
            URLQueryItem(name: "page", value: String(max(1, page))),
            URLQueryItem(name: "page_size", value: String(min(max(1, pageSize), 100))),
        ]
        if let status {
            let trimmed = status.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmed.isEmpty {
                query.append(URLQueryItem(name: "status", value: trimmed))
            }
        }
        return try await getJSON(
            pathComponents: ["api", "v1", "contracts"],
            query: query,
            authorized: true
        )
    }

    /// GET `/api/v1/contracts/{id}` — flat contract map (milestones + optional change_orders).
    func fetchContract(id: String) async throws -> ContractDetail {
        try await getJSON(
            pathComponents: ["api", "v1", "contracts", id],
            authorized: true
        )
    }

    // MARK: Lifecycle mutations

    /// POST `/api/v1/contracts/{id}/accept` — empty body.
    @discardableResult
    func acceptContract(id: String) async throws -> ContractDetail {
        try await postJSON(
            pathComponents: ["api", "v1", "contracts", id, "accept"],
            body: EmptyJSONObject(),
            authorized: .required
        )
    }

    /// POST `/api/v1/contracts/{id}/start` — provider starts work.
    @discardableResult
    func startContract(id: String) async throws -> ContractDetail {
        try await postJSON(
            pathComponents: ["api", "v1", "contracts", id, "start"],
            body: EmptyJSONObject(),
            authorized: .required
        )
    }

    /// POST `/api/v1/contracts/{id}/complete` — provider marks work complete.
    @discardableResult
    func completeContract(id: String) async throws -> ContractDetail {
        try await postJSON(
            pathComponents: ["api", "v1", "contracts", id, "complete"],
            body: EmptyJSONObject(),
            authorized: .required
        )
    }

    /// POST `/api/v1/contracts/{id}/approve-completion` — customer approves completion.
    @discardableResult
    func approveContractCompletion(id: String) async throws -> ContractDetail {
        try await postJSON(
            pathComponents: ["api", "v1", "contracts", id, "approve-completion"],
            body: EmptyJSONObject(),
            authorized: .required
        )
    }

    /// POST `/api/v1/contracts/{id}/cancel` — optional `{ "reason": "..." }`.
    @discardableResult
    func cancelContract(id: String, reason: String? = nil) async throws -> ContractDetail {
        let trimmed = reason?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if trimmed.isEmpty {
            return try await postJSON(
                pathComponents: ["api", "v1", "contracts", id, "cancel"],
                body: EmptyJSONObject(),
                authorized: .required
            )
        }
        return try await postJSON(
            pathComponents: ["api", "v1", "contracts", id, "cancel"],
            body: ContractsCancelBody(reason: trimmed),
            authorized: .required
        )
    }

    // MARK: Dispute + review

    /// POST `/api/v1/contracts/{id}/disputes`
    /// Body: dispute_type, description, optional evidence_urls (OpenDispute handler).
    @discardableResult
    func openContractDispute(
        id: String,
        disputeType: String,
        description: String,
        evidenceURLs: [String] = []
    ) async throws -> ContractDisputeResponse {
        let type = disputeType.trimmingCharacters(in: .whitespacesAndNewlines)
        let desc = description.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !type.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "Dispute type is required.")
        }
        guard !desc.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "Description is required.")
        }
        let urls = evidenceURLs
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        return try await postJSON(
            pathComponents: ["api", "v1", "contracts", id, "disputes"],
            body: ContractsOpenDisputeBody(
                disputeType: type,
                description: desc,
                evidenceUrls: urls
            ),
            authorized: .required
        )
    }

    /// POST `/api/v1/contracts/{id}/reviews`
    /// Body: overall_rating, comment, optional category ratings (1–5).
    /// Server requires comment ≥ 50 characters and review window eligibility.
    @discardableResult
    func createContractReview(
        id: String,
        rating: Int,
        comment: String,
        qualityRating: Int? = nil,
        communicationRating: Int? = nil,
        timelinessRating: Int? = nil,
        valueRating: Int? = nil
    ) async throws -> ContractReviewResponse {
        let clamped = min(5, max(1, rating))
        let trimmed = comment.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.count >= 50 else {
            throw APIClientError.httpStatus(
                400,
                detail: "Review comment must be at least 50 characters (currently \(trimmed.count))."
            )
        }
        func clampOptional(_ v: Int?) -> Int32? {
            guard let v else { return nil }
            return Int32(min(5, max(1, v)))
        }
        return try await postJSON(
            pathComponents: ["api", "v1", "contracts", id, "reviews"],
            body: ContractsCreateReviewBody(
                overallRating: Int32(clamped),
                comment: trimmed,
                qualityRating: clampOptional(qualityRating),
                communicationRating: clampOptional(communicationRating),
                timelinessRating: clampOptional(timelinessRating),
                valueRating: clampOptional(valueRating)
            ),
            authorized: .required
        )
    }

    /// GET `/api/v1/contracts/{id}/reviews/eligibility`
    func fetchReviewEligibility(contractId: String) async throws -> ReviewEligibility {
        try await getJSON(
            pathComponents: ["api", "v1", "contracts", contractId, "reviews", "eligibility"],
            authorized: true
        )
    }

    /// POST `/api/v1/reviews/{id}/respond` — single public response (≤500 chars server-side).
    @discardableResult
    func respondToReview(id: String, comment: String) async throws -> Data {
        let trimmed = comment.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.count >= 10 else {
            throw APIClientError.httpStatus(400, detail: "Response must be at least 10 characters.")
        }
        guard trimmed.count <= 500 else {
            throw APIClientError.httpStatus(400, detail: "Response must be at most 500 characters.")
        }
        return try await postData(
            pathComponents: ["api", "v1", "reviews", id, "respond"],
            body: ReviewRespondBody(comment: trimmed),
            authorized: .required
        )
    }

    /// POST `/api/v1/reviews/{id}/flag` — flag review for abuse/fraud.
    @discardableResult
    func flagReview(id: String, reason: String, details: String = "") async throws -> Data {
        let r = reason.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !r.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "Flag reason is required.")
        }
        return try await postData(
            pathComponents: ["api", "v1", "reviews", id, "flag"],
            body: ReviewFlagBody(reason: r, details: details),
            authorized: .required
        )
    }

    // MARK: Milestones

    /// POST `/api/v1/milestones/{id}/submit` — provider submits milestone.
    @discardableResult
    func submitMilestone(id: String) async throws -> ContractMilestone {
        try await postJSON(
            pathComponents: ["api", "v1", "milestones", id, "submit"],
            body: EmptyJSONObject(),
            authorized: .required
        )
    }

    /// POST `/api/v1/milestones/{id}/approve` — customer approves milestone.
    @discardableResult
    func approveMilestone(id: String) async throws -> ContractMilestone {
        try await postJSON(
            pathComponents: ["api", "v1", "milestones", id, "approve"],
            body: EmptyJSONObject(),
            authorized: .required
        )
    }

    /// POST `/api/v1/milestones/{id}/revision` — customer requests revision.
    /// Body: `{ "revision_notes": "..." }` (required non-empty notes).
    @discardableResult
    func requestMilestoneRevision(id: String, notes: String) async throws -> ContractMilestone {
        let trimmed = notes.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "Revision notes are required.")
        }
        return try await postJSON(
            pathComponents: ["api", "v1", "milestones", id, "revision"],
            body: ContractsMilestoneRevisionBody(revisionNotes: trimmed),
            authorized: .required
        )
    }

    // MARK: Change orders

    /// GET `/api/v1/contracts/{id}/change-orders` → `{ "change_orders": [...] }`.
    func fetchChangeOrders(contractId: String) async throws -> [ContractChangeOrder] {
        let response: ChangeOrdersListResponse = try await getJSON(
            pathComponents: ["api", "v1", "contracts", contractId, "change-orders"],
            authorized: true
        )
        return response.changeOrders
    }

    /// POST `/api/v1/contracts/{id}/change-orders`
    /// Body: `{ "description": "...", "amount_delta_cents": N }` (signed cents).
    @discardableResult
    func createChangeOrder(
        contractId: String,
        description: String,
        amountDeltaCents: Int64
    ) async throws -> ContractChangeOrder {
        let desc = description.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !desc.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "Description is required.")
        }
        guard amountDeltaCents != 0 else {
            throw APIClientError.httpStatus(400, detail: "Amount change cannot be zero.")
        }
        return try await postJSON(
            pathComponents: ["api", "v1", "contracts", contractId, "change-orders"],
            body: ContractsCreateChangeOrderBody(
                description: desc,
                amountDeltaCents: amountDeltaCents
            ),
            authorized: .required
        )
    }

    /// PUT `/api/v1/contracts/{id}/change-orders/{orderId}` body: `{ "accepted": bool }`.
    @discardableResult
    func respondToChangeOrder(
        contractId: String,
        orderId: String,
        accepted: Bool
    ) async throws -> ContractChangeOrder {
        try await putJSON(
            pathComponents: ["api", "v1", "contracts", contractId, "change-orders", orderId],
            body: ContractsRespondChangeOrderBody(accepted: accepted),
            authorized: .required
        )
    }

    // MARK: Tip

    /// POST `/api/v1/contracts/{id}/tip` body: `{ "amount_cents": N }` ($1…$10,000).
    /// Sticky Idempotency-Key `tip:{contractId}`; charges default payment method off-session.
    @discardableResult
    func tipContract(id: String, amountCents: Int64) async throws -> ContractTipResponse {
        guard amountCents >= 100 else {
            throw APIClientError.httpStatus(400, detail: "Tip must be at least $1.00.")
        }
        guard amountCents <= 1_000_000 else {
            throw APIClientError.httpStatus(400, detail: "Tip cannot exceed $10,000.00.")
        }
        let opKey = "tip:\(id)"
        let headers = idempotencyHeader(for: opKey)
        do {
            let response: ContractTipResponse = try await postJSON(
                pathComponents: ["api", "v1", "contracts", id, "tip"],
                body: ContractsTipBody(amountCents: amountCents),
                authorized: .required,
                headers: headers
            )
            clearIdempotencyKey(opKey)
            return response
        } catch {
            throw error
        }
    }

    // MARK: Guarantee claim

    /// GET `/api/v1/contracts/{id}/guarantee-claim` → `{ "guarantee_claim": null | object }`.
    func fetchGuaranteeClaim(contractId: String) async throws -> GuaranteeClaim? {
        let response: GuaranteeClaimResponse = try await getJSON(
            pathComponents: ["api", "v1", "contracts", contractId, "guarantee-claim"],
            authorized: true
        )
        return response.guaranteeClaim
    }

    /// POST `/api/v1/contracts/{id}/guarantee-claim`
    /// Body: reason, description (≥50 chars), optional evidence_urls.
    @discardableResult
    func submitGuaranteeClaim(
        contractId: String,
        reason: String,
        description: String,
        evidenceURLs: [String] = []
    ) async throws -> GuaranteeClaim {
        let reasonTrimmed = reason.trimmingCharacters(in: .whitespacesAndNewlines)
        let descTrimmed = description.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !reasonTrimmed.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "Reason is required.")
        }
        guard descTrimmed.count >= 50 else {
            throw APIClientError.httpStatus(
                400,
                detail: "Description must be at least 50 characters."
            )
        }
        return try await postJSON(
            pathComponents: ["api", "v1", "contracts", contractId, "guarantee-claim"],
            body: ContractsGuaranteeClaimBody(
                reason: reasonTrimmed,
                description: descTrimmed,
                evidenceUrls: evidenceURLs
            ),
            authorized: .required
        )
    }

    // MARK: Recurring (FR-18)

    /// GET `/api/v1/contracts/{id}/recurring` → `{ "config": … }`.
    func fetchRecurringConfig(contractId: String) async throws -> ContractRecurringConfig? {
        let response: RecurringConfigEnvelope = try await getJSON(
            pathComponents: ["api", "v1", "contracts", contractId, "recurring"],
            authorized: true
        )
        return response.config
    }

    /// GET `/api/v1/contracts/{id}/recurring/instances`
    func fetchRecurringInstances(
        contractId: String,
        page: Int = 1,
        pageSize: Int = 20
    ) async throws -> [ContractRecurringInstance] {
        let response: RecurringInstancesListResponse = try await getJSON(
            pathComponents: ["api", "v1", "contracts", contractId, "recurring", "instances"],
            query: [
                URLQueryItem(name: "page", value: String(max(1, page))),
                URLQueryItem(name: "page_size", value: String(min(max(1, pageSize), 100))),
            ],
            authorized: true
        )
        return response.instances ?? []
    }

    /// POST `/api/v1/contracts/{id}/recurring/pause`
    @discardableResult
    func pauseRecurring(contractId: String) async throws -> ContractRecurringConfig {
        let response: RecurringConfigEnvelope = try await postJSON(
            pathComponents: ["api", "v1", "contracts", contractId, "recurring", "pause"],
            body: EmptyJSONObject(),
            authorized: .required
        )
        guard let config = response.config else {
            throw APIClientError.httpStatus(502, detail: "Recurring schedule missing from pause response.")
        }
        return config
    }

    /// POST `/api/v1/contracts/{id}/recurring/resume`
    @discardableResult
    func resumeRecurring(contractId: String) async throws -> ContractRecurringConfig {
        let response: RecurringConfigEnvelope = try await postJSON(
            pathComponents: ["api", "v1", "contracts", contractId, "recurring", "resume"],
            body: EmptyJSONObject(),
            authorized: .required
        )
        guard let config = response.config else {
            throw APIClientError.httpStatus(502, detail: "Recurring schedule missing from resume response.")
        }
        return config
    }

    /// POST `/api/v1/contracts/{id}/recurring/cancel`
    @discardableResult
    func cancelRecurring(contractId: String) async throws -> ContractRecurringConfig {
        let response: RecurringConfigEnvelope = try await postJSON(
            pathComponents: ["api", "v1", "contracts", contractId, "recurring", "cancel"],
            body: EmptyJSONObject(),
            authorized: .required
        )
        guard let config = response.config else {
            throw APIClientError.httpStatus(502, detail: "Recurring schedule missing from cancel response.")
        }
        return config
    }

    /// PATCH `/api/v1/contracts/{id}/recurring` — FR-18.3 auto-approve + FR-18.4 rate.
    @discardableResult
    func updateRecurringConfig(
        contractId: String,
        autoApprove: Bool? = nil,
        proposedRateCents: Int64? = nil
    ) async throws -> ContractRecurringConfig {
        struct Body: Encodable {
            var autoApprove: Bool?
            var proposedRateCents: Int64?
        }
        let response: RecurringConfigEnvelope = try await patchJSON(
            pathComponents: ["api", "v1", "contracts", contractId, "recurring"],
            body: Body(autoApprove: autoApprove, proposedRateCents: proposedRateCents),
            authorized: .required
        )
        guard let config = response.config else {
            throw APIClientError.httpStatus(502, detail: "Recurring schedule missing from update response.")
        }
        return config
    }

    /// POST `/api/v1/contracts/{id}/recurring/instances/{instanceId}/complete` — provider.
    ///
    /// Status completion is always durable. When the schedule has auto-approve,
    /// the gateway may also CreatePayment (as the contract customer) and return
    /// a real PaymentIntent `client_secret`. Absence of `client_secret` is
    /// residual — never invent money.
    @discardableResult
    func completeRecurringInstance(
        contractId: String,
        instanceId: String
    ) async throws -> RecurringApproveResult {
        let response: RecurringInstanceEnvelope = try await postJSON(
            pathComponents: [
                "api", "v1", "contracts", contractId,
                "recurring", "instances", instanceId, "complete",
            ],
            body: EmptyJSONObject(),
            authorized: .required
        )
        return try Self.recurringVisitMoneyResult(
            response,
            missingDetail: "Instance missing from complete response."
        )
    }

    /// POST `/api/v1/contracts/{id}/recurring/instances/{instanceId}/approve` — customer.
    ///
    /// Status approval is always durable. Gateway may also return a real
    /// PaymentIntent `client_secret` (CreatePayment with `recurring_instance_id`).
    /// Absence of `client_secret` is residual — never invent money.
    @discardableResult
    func approveRecurringInstance(
        contractId: String,
        instanceId: String
    ) async throws -> RecurringApproveResult {
        let response: RecurringInstanceEnvelope = try await postJSON(
            pathComponents: [
                "api", "v1", "contracts", contractId,
                "recurring", "instances", instanceId, "approve",
            ],
            body: EmptyJSONObject(),
            authorized: .required
        )
        return try Self.recurringVisitMoneyResult(
            response,
            missingDetail: "Instance missing from approve response."
        )
    }

    /// Maps approve/complete envelope → result with optional real PI fields only.
    /// Passes through `off_session_charged` so UI can skip PaymentSheet and
    /// show residual messaging — never invents payment_id / client_secret.
    private static func recurringVisitMoneyResult(
        _ response: RecurringInstanceEnvelope,
        missingDetail: String
    ) throws -> RecurringApproveResult {
        guard let instance = response.instance else {
            throw APIClientError.httpStatus(502, detail: missingDetail)
        }
        // Prefer top-level client_secret; fall back to nested payment map if present.
        // When off_session_charged is true, secret is intentionally absent.
        let secret = response.clientSecret
            ?? response.payment?.clientSecret
        let payId = response.paymentId ?? response.payment?.id
        return RecurringApproveResult(
            instance: instance,
            paymentId: payId,
            clientSecret: secret,
            paymentResidual: response.paymentResidual,
            paymentError: response.paymentError,
            payment: response.payment,
            offSessionCharged: response.offSessionCharged,
            offSessionChargeResidual: response.offSessionChargeResidual
        )
    }

    // MARK: Report no-show / abandonment

    /// POST `/api/v1/contracts/{id}/report-noshow` — empty body; customer-only server-side.
    @discardableResult
    func reportContractNoShow(id: String) async throws -> ContractDetail {
        try await postJSON(
            pathComponents: ["api", "v1", "contracts", id, "report-noshow"],
            body: EmptyJSONObject(),
            authorized: .required
        )
    }

    /// POST `/api/v1/contracts/{id}/report-abandonment` — empty body; customer-only server-side.
    @discardableResult
    func reportContractAbandonment(id: String) async throws -> ContractDetail {
        try await postJSON(
            pathComponents: ["api", "v1", "contracts", id, "report-abandonment"],
            body: EmptyJSONObject(),
            authorized: .required
        )
    }

    // MARK: PDF / document export

    /// GET `/api/v1/contracts/{id}/pdf` → `{ "pdf_url": "..." }` (relative path).
    func fetchContractPDFURL(id: String) async throws -> URL? {
        let response: ContractPDFResponse = try await getJSON(
            pathComponents: ["api", "v1", "contracts", id, "pdf"],
            authorized: true
        )
        guard let raw = response.pdfUrl?.trimmingCharacters(in: .whitespacesAndNewlines),
              !raw.isEmpty
        else {
            return nil
        }
        if let absolute = URL(string: raw), absolute.scheme != nil {
            return absolute
        }
        // Relative path from gateway (e.g. /api/v1/contracts/{id}/document.pdf)
        let path = raw.hasPrefix("/") ? String(raw.dropFirst()) : raw
        return AppConfig.apiBaseURL.appending(path: path)
    }

    /// Authenticated download of the contract document (HTML body).
    /// Prefer `document.pdf` path; falls back to invoice HTML download.
    func downloadContractDocument(id: String) async throws -> (data: Data, filename: String) {
        do {
            let data = try await perform(
                method: "GET",
                pathComponents: ["api", "v1", "contracts", id, "document.pdf"],
                query: [],
                body: nil as EmptyBody?,
                auth: .required
            )
            return (data, "contract-\(String(id.prefix(8))).html")
        } catch {
            // Fallback: invoice HTML is a real party document when PDF path fails.
            let data = try await downloadContractInvoice(id: id)
            return (data, "invoice-\(String(id.prefix(8))).html")
        }
    }

    /// GET `/api/v1/contracts/{id}/invoice/download` — HTML invoice bytes.
    func downloadContractInvoice(id: String) async throws -> Data {
        try await perform(
            method: "GET",
            pathComponents: ["api", "v1", "contracts", id, "invoice", "download"],
            query: [],
            body: nil as EmptyBody?,
            auth: .required
        )
    }

    // MARK: Payments / escrow release (services)

    /// GET `/api/v1/payments?status=&page=&page_size=` — auth required.
    /// Used to surface held escrow rows for a contract so the customer can release.
    func fetchPayments(
        status: String? = nil,
        page: Int = 1,
        pageSize: Int = 50
    ) async throws -> PaymentsListResponse {
        var query = [
            URLQueryItem(name: "page", value: String(max(1, page))),
            URLQueryItem(name: "page_size", value: String(min(max(1, pageSize), 100))),
        ]
        if let status {
            let trimmed = status.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmed.isEmpty {
                query.append(URLQueryItem(name: "status", value: trimmed))
            }
        }
        return try await getJSON(
            pathComponents: ["api", "v1", "payments"],
            query: query,
            authorized: true
        )
    }

    /// Payments for a contract (filters client-side; list API has no contract_id query).
    /// Prefer `status: "escrow"` when loading the release CTA.
    func fetchPaymentsForContract(
        contractId: String,
        status: String? = nil
    ) async throws -> [ContractPayment] {
        let cid = contractId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cid.isEmpty else { return [] }
        let response = try await fetchPayments(status: status, page: 1, pageSize: 50)
        return response.payments.filter { payment in
            (payment.contractId ?? "").trimmingCharacters(in: .whitespacesAndNewlines) == cid
        }
    }

    /// POST `/api/v1/payments` — create services escrow PaymentIntent for a contract.
    /// Body: `{ contract_id, amount_cents, provider_id?, recurring_instance_id? }`
    /// (provider re-derived server-side). Returns payment map + `client_secret`.
    ///
    /// **Idempotency-Key sticky** as `create-payment:{contractId}:{amountCents}:{instance?}`.
    /// Clear only after process/capture succeeds so retries replay the same PI.
    ///
    /// **Dual-PI guard (recurring visits):** when `recurringInstanceId` is set,
    /// the payment service also enforces UNIQUE(recurring_instance_id). A prior
    /// gateway approve/auto-complete PI for the same visit soft-replays here
    /// (same payment_id + real client_secret) — never invents a second intent
    /// or a fake secret. If the existing row has no PI, the API fails closed.
    ///
    /// Security: pass **server** amount only — never client fee math.
    /// Payment service refuses amount > contract total and non-customer actors.
    @discardableResult
    func createContractPayment(
        contractId: String,
        amountCents: Int64,
        providerId: String? = nil,
        recurringInstanceId: String? = nil
    ) async throws -> ContractPayment {
        let cid = contractId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cid.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "Contract id is required.")
        }
        guard amountCents > 0 else {
            throw APIClientError.httpStatus(400, detail: "amount_cents must be positive.")
        }
        let instId = recurringInstanceId?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let body = ContractsCreatePaymentBody(
            contractId: cid,
            providerId: providerId?.trimmingCharacters(in: .whitespacesAndNewlines),
            amountCents: amountCents,
            recurringInstanceId: (instId?.isEmpty == false) ? instId : nil
        )
        // Sticky op key — instance-scoped when paying a recurring visit.
        let instSuffix = (instId?.isEmpty == false) ? ":\(instId!)" : ":"
        let opKey = "create-payment:\(cid):\(amountCents)\(instSuffix)"
        let headers = idempotencyHeader(for: opKey)
        return try await postJSON(
            pathComponents: ["api", "v1", "payments"],
            body: body,
            authorized: .required,
            headers: headers
        )
    }

    /// Clears sticky create-payment key after funds are held (or intentional retry).
    func clearCreateContractPaymentIdempotency(
        contractId: String,
        amountCents: Int64
    ) {
        let cid = contractId.trimmingCharacters(in: .whitespacesAndNewlines)
        clearIdempotencyKey("create-payment:\(cid):\(amountCents):")
    }

    /// POST `/api/v1/payments/{id}/process` — capture authorized PI → status `escrow`.
    /// Body: `{ payment_method_id }` (gateway requires JSON; PM unused when PaymentSheet
    /// already confirmed the intent — pass empty string).
    /// Sticky Idempotency-Key `process-payment:{paymentId}`.
    @discardableResult
    func processContractPayment(
        paymentId: String,
        paymentMethodId: String = ""
    ) async throws -> ContractPayment {
        let id = paymentId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !id.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "Payment id is required.")
        }
        let opKey = "process-payment:\(id)"
        let headers = idempotencyHeader(for: opKey)
        do {
            let payment: ContractPayment = try await postJSON(
                pathComponents: ["api", "v1", "payments", id, "process"],
                body: ContractsProcessPaymentBody(paymentMethodId: paymentMethodId),
                authorized: .required,
                headers: headers
            )
            clearIdempotencyKey(opKey)
            return payment
        } catch {
            throw error
        }
    }

    /// POST `/api/v1/payments/calculate-fees` — display-only fee breakdown.
    /// Body: `{ amount_cents, category_id? }`. Never use result to invent a charge —
    /// charge always uses contract `amount_cents` via create payment.
    func calculatePaymentFees(
        amountCents: Int64,
        categoryId: String? = nil
    ) async throws -> PaymentFeeBreakdown {
        guard amountCents > 0 else {
            throw APIClientError.httpStatus(400, detail: "amount_cents must be positive.")
        }
        // Fee preview is not a fund movement; still requires Idempotency-Key on the
        // /payments group. Fresh UUID per call is fine (no sticky retry needed).
        let headers = ["Idempotency-Key": UUID().uuidString]
        return try await postJSON(
            pathComponents: ["api", "v1", "payments", "calculate-fees"],
            body: ContractsCalculateFeesBody(
                amountCents: amountCents,
                categoryId: categoryId?.trimmingCharacters(in: .whitespacesAndNewlines)
            ),
            authorized: .required,
            headers: headers
        )
    }

    /// POST `/api/v1/payments/{id}/release` — customer releases held escrow to provider.
    /// Body: `{ "reason": "..." }` (gateway requires a JSON body; empty reason is ok).
    /// **Idempotency-Key required** (all `/payments` POST mutations).
    ///
    /// Security: auth Bearer only; actor must be the payment customer (or admin).
    /// Provider self-release is refused in the payment service. Never compute
    /// payout amounts client-side — display server `amount_cents` / `provider_payout_cents`.
    @discardableResult
    func releasePayment(
        paymentId: String,
        reason: String = "completion approved"
    ) async throws -> ContractPayment {
        let id = paymentId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !id.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "Payment id is required.")
        }
        let trimmedReason = reason.trimmingCharacters(in: .whitespacesAndNewlines)
        // Sticky key for release retries (double-tap / flaky network). Cleared on success
        // so a later intentional re-release attempt (after refund/re-escrow) mints fresh.
        let opKey = "payment-release:\(id)"
        let headers = idempotencyHeader(for: opKey)
        do {
            let payment: ContractPayment = try await postJSON(
                pathComponents: ["api", "v1", "payments", id, "release"],
                body: ContractsReleasePaymentBody(reason: trimmedReason),
                authorized: .required,
                headers: headers
            )
            clearIdempotencyKey(opKey)
            return payment
        } catch {
            throw error
        }
    }

    // MARK: Provider workspace (check-in / check-out / photos)

    /// GET `/api/v1/contracts/{id}/work-session` — Redis-backed check-in state.
    func fetchWorkSession(contractId: String) async throws -> ContractWorkSession {
        try await getJSON(
            pathComponents: ["api", "v1", "contracts", contractId, "work-session"],
            authorized: true
        )
    }

    /// POST `/api/v1/contracts/{id}/checkin` body: `{ lat, lng }` (GPS required).
    @discardableResult
    func checkInToContract(id: String, lat: Double, lng: Double) async throws -> ContractCheckInResponse {
        try await postJSON(
            pathComponents: ["api", "v1", "contracts", id, "checkin"],
            body: ContractsLocationBody(lat: lat, lng: lng),
            authorized: .required
        )
    }

    /// POST `/api/v1/contracts/{id}/checkout` body: `{ lat, lng }` (GPS required).
    @discardableResult
    func checkOutOfContract(id: String, lat: Double, lng: Double) async throws -> ContractCheckOutResponse {
        try await postJSON(
            pathComponents: ["api", "v1", "contracts", id, "checkout"],
            body: ContractsLocationBody(lat: lat, lng: lng),
            authorized: .required
        )
    }

    /// POST `/api/v1/contracts/{id}/completion-photos` multipart: `photo` + `phase` (`before`|`after`).
    @discardableResult
    func uploadCompletionPhoto(
        contractId: String,
        imageJPEG: Data,
        phase: CompletionPhotoPhase,
        filename: String = "completion.jpg"
    ) async throws -> ContractCompletionPhotoResponse {
        guard !imageJPEG.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "Photo data is required.")
        }
        // Gateway MaxBytesReader cap is 10MB.
        let maxBytes = 10 * 1024 * 1024
        guard imageJPEG.count <= maxBytes else {
            throw APIClientError.httpStatus(413, detail: "Photo must be 10MB or smaller.")
        }
        let boundary = "Boundary-\(UUID().uuidString)"
        var body = Data()
        func append(_ string: String) {
            if let data = string.data(using: .utf8) {
                body.append(data)
            }
        }
        append("--\(boundary)\r\n")
        append("Content-Disposition: form-data; name=\"phase\"\r\n\r\n")
        append("\(phase.rawValue)\r\n")
        append("--\(boundary)\r\n")
        append("Content-Disposition: form-data; name=\"photo\"; filename=\"\(filename)\"\r\n")
        append("Content-Type: image/jpeg\r\n\r\n")
        body.append(imageJPEG)
        append("\r\n")
        append("--\(boundary)--\r\n")

        let data = try await postMultipart(
            pathComponents: ["api", "v1", "contracts", contractId, "completion-photos"],
            body: body,
            boundary: boundary,
            authorized: .required
        )
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        do {
            return try decoder.decode(ContractCompletionPhotoResponse.self, from: data)
        } catch {
            throw APIClientError.decoding("Could not decode completion photo response: \(error.localizedDescription)")
        }
    }
}

// MARK: - Request bodies (snake_case via encoder keyEncodingStrategy)

private struct ContractsLocationBody: Encodable {
    let lat: Double
    let lng: Double
}

private struct ContractsCancelBody: Encodable {
    let reason: String
}

private struct ContractsOpenDisputeBody: Encodable {
    let disputeType: String
    let description: String
    let evidenceUrls: [String]
}

private struct ContractsCreateReviewBody: Encodable {
    let overallRating: Int32
    let comment: String
    let qualityRating: Int32?
    let communicationRating: Int32?
    let timelinessRating: Int32?
    let valueRating: Int32?
}

private struct ReviewRespondBody: Encodable {
    let comment: String
}

private struct ReviewFlagBody: Encodable {
    let reason: String
    let details: String
}

private struct ContractsMilestoneRevisionBody: Encodable {
    let revisionNotes: String
}

private struct ContractsCreateChangeOrderBody: Encodable {
    let description: String
    let amountDeltaCents: Int64
}

private struct ContractsRespondChangeOrderBody: Encodable {
    let accepted: Bool
}

private struct ContractsTipBody: Encodable {
    let amountCents: Int64
}

private struct ContractsGuaranteeClaimBody: Encodable {
    let reason: String
    let description: String
    let evidenceUrls: [String]
}

private struct ContractsReleasePaymentBody: Encodable {
    let reason: String
}

private struct ContractsCreatePaymentBody: Encodable {
    let contractId: String
    let providerId: String?
    let amountCents: Int64
    let recurringInstanceId: String?

    // Explicit snake_case: custom CodingKeys are not rewritten by convertToSnakeCase.
    enum CodingKeys: String, CodingKey {
        case contractId = "contract_id"
        case providerId = "provider_id"
        case amountCents = "amount_cents"
        case recurringInstanceId = "recurring_instance_id"
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(contractId, forKey: .contractId)
        try c.encode(amountCents, forKey: .amountCents)
        if let providerId, !providerId.isEmpty {
            try c.encode(providerId, forKey: .providerId)
        }
        if let recurringInstanceId, !recurringInstanceId.isEmpty {
            try c.encode(recurringInstanceId, forKey: .recurringInstanceId)
        }
    }
}

private struct ContractsProcessPaymentBody: Encodable {
    let paymentMethodId: String

    enum CodingKeys: String, CodingKey {
        case paymentMethodId = "payment_method_id"
    }
}

private struct ContractsCalculateFeesBody: Encodable {
    let amountCents: Int64
    let categoryId: String?

    enum CodingKeys: String, CodingKey {
        case amountCents = "amount_cents"
        case categoryId = "category_id"
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(amountCents, forKey: .amountCents)
        if let categoryId, !categoryId.isEmpty {
            try c.encode(categoryId, forKey: .categoryId)
        }
    }
}
