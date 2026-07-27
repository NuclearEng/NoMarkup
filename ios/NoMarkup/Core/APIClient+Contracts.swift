import Foundation

// MARK: - Contracts API (extension — do not expand APIClient.swift core)
//
// Auth: Bearer required. Reuses internal getJSON / postJSON / AuthMode.
//
// Endpoints (gateway/internal/handler/contract.go + review.go):
//   GET  /api/v1/contracts
//   GET  /api/v1/contracts/{id}
//   POST /api/v1/contracts/{id}/accept|start|complete|approve-completion|cancel
//   POST /api/v1/contracts/{id}/disputes   body: dispute_type, description
//   POST /api/v1/contracts/{id}/reviews   body: overall_rating, comment
//   POST /api/v1/milestones/{id}/submit|approve

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
