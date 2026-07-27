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
    /// Body: `{ "dispute_type": "...", "description": "..." }` (OpenDispute handler).
    @discardableResult
    func openContractDispute(
        id: String,
        disputeType: String,
        description: String
    ) async throws -> ContractDisputeResponse {
        let type = disputeType.trimmingCharacters(in: .whitespacesAndNewlines)
        let desc = description.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !type.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "Dispute type is required.")
        }
        guard !desc.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "Description is required.")
        }
        return try await postJSON(
            pathComponents: ["api", "v1", "contracts", id, "disputes"],
            body: ContractsOpenDisputeBody(disputeType: type, description: desc),
            authorized: .required
        )
    }

    /// POST `/api/v1/contracts/{id}/reviews`
    /// Body: `{ "overall_rating": N, "comment": "..." }` (CreateReview handler).
    @discardableResult
    func createContractReview(
        id: String,
        rating: Int,
        comment: String
    ) async throws -> ContractReviewResponse {
        let clamped = min(5, max(1, rating))
        let trimmed = comment.trimmingCharacters(in: .whitespacesAndNewlines)
        return try await postJSON(
            pathComponents: ["api", "v1", "contracts", id, "reviews"],
            body: ContractsCreateReviewBody(overallRating: Int32(clamped), comment: trimmed),
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
    /// Note: gateway may return 501 until Stripe tip capture is wired (MON-23).
    @discardableResult
    func tipContract(id: String, amountCents: Int64) async throws -> ContractTipResponse {
        guard amountCents >= 100 else {
            throw APIClientError.httpStatus(400, detail: "Tip must be at least $1.00.")
        }
        guard amountCents <= 1_000_000 else {
            throw APIClientError.httpStatus(400, detail: "Tip cannot exceed $10,000.00.")
        }
        return try await postJSON(
            pathComponents: ["api", "v1", "contracts", id, "tip"],
            body: ContractsTipBody(amountCents: amountCents),
            authorized: .required
        )
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

    // MARK: PDF export

    /// GET `/api/v1/contracts/{id}/pdf` → `{ "pdf_url": "..." }` for Safari open.
    func fetchContractPDFURL(id: String) async throws -> URL? {
        let response: ContractPDFResponse = try await getJSON(
            pathComponents: ["api", "v1", "contracts", id, "pdf"],
            authorized: true
        )
        guard let raw = response.pdfUrl?.trimmingCharacters(in: .whitespacesAndNewlines),
              !raw.isEmpty,
              let url = URL(string: raw)
        else {
            return nil
        }
        return url
    }
}

// MARK: - Request bodies (snake_case via encoder keyEncodingStrategy)

private struct ContractsCancelBody: Encodable {
    let reason: String
}

private struct ContractsOpenDisputeBody: Encodable {
    let disputeType: String
    let description: String
}

private struct ContractsCreateReviewBody: Encodable {
    let overallRating: Int32
    let comment: String
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
