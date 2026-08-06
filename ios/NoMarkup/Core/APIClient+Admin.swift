import Foundation

// MARK: - Admin console APIs (parity with web `/admin/*`)
// Auth: Bearer + admin role. Non-admins receive 403.

extension APIClient {
    /// GET `/api/v1/admin/flags` — full flag rows with rollout %.
    func fetchAdminFlags() async throws -> [AdminFeatureFlag] {
        let response: AdminFlagsResponse = try await getJSON(
            pathComponents: ["api", "v1", "admin", "flags"],
            authorized: true
        )
        return response.flags
    }

    /// GET `/api/v1/admin/disputes`
    func fetchAdminDisputes(page: Int = 1, pageSize: Int = 40) async throws -> AdminDisputesResponse {
        try await getJSON(
            pathComponents: ["api", "v1", "admin", "disputes"],
            query: [
                URLQueryItem(name: "page", value: String(max(1, page))),
                URLQueryItem(name: "page_size", value: String(min(max(1, pageSize), 100))),
            ],
            authorized: true
        )
    }

    /// GET `/api/v1/admin/users`
    func fetchAdminUsers(page: Int = 1, pageSize: Int = 40, q: String? = nil) async throws -> AdminUsersResponse {
        var query = [
            URLQueryItem(name: "page", value: String(max(1, page))),
            URLQueryItem(name: "page_size", value: String(min(max(1, pageSize), 100))),
        ]
        if let q, !q.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            query.append(URLQueryItem(name: "q", value: q.trimmingCharacters(in: .whitespacesAndNewlines)))
        }
        return try await getJSON(
            pathComponents: ["api", "v1", "admin", "users"],
            query: query,
            authorized: true
        )
    }

    /// GET `/api/v1/admin/goods-reports` (listing reports queue)
    func fetchAdminGoodsReports(page: Int = 1, pageSize: Int = 40) async throws -> AdminReportsResponse {
        try await getJSON(
            pathComponents: ["api", "v1", "admin", "goods-reports"],
            query: [
                URLQueryItem(name: "page", value: String(max(1, page))),
                URLQueryItem(name: "page_size", value: String(min(max(1, pageSize), 100))),
            ],
            authorized: true
        )
    }

    /// GET `/api/v1/admin/user-reports`
    func fetchAdminUserReports(page: Int = 1, pageSize: Int = 40) async throws -> AdminReportsResponse {
        try await getJSON(
            pathComponents: ["api", "v1", "admin", "user-reports"],
            query: [
                URLQueryItem(name: "page", value: String(max(1, page))),
                URLQueryItem(name: "page_size", value: String(min(max(1, pageSize), 100))),
            ],
            authorized: true
        )
    }

    /// GET `/api/v1/admin/fraud/alerts`
    func fetchAdminFraudAlerts(page: Int = 1, pageSize: Int = 40) async throws -> AdminFraudResponse {
        try await getJSON(
            pathComponents: ["api", "v1", "admin", "fraud", "alerts"],
            query: [
                URLQueryItem(name: "page", value: String(max(1, page))),
                URLQueryItem(name: "page_size", value: String(min(max(1, pageSize), 100))),
            ],
            authorized: true
        )
    }

    // MARK: Write operations

    /// PUT `/api/v1/admin/flags/{key}` — toggle `enabled` and optionally set sticky `rollout_percent`.
    /// Omit `rolloutPercent` to leave the cohort unchanged. Money/regulated keys reject 1–99.
    @discardableResult
    func updateAdminFlag(
        key: String,
        enabled: Bool,
        rolloutPercent: Int? = nil
    ) async throws -> AdminFeatureFlagUpdateResponse {
        let trimmed = key.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "Flag key is required.")
        }
        if let p = rolloutPercent, p < 0 || p > 100 {
            throw APIClientError.httpStatus(400, detail: "Rollout percent must be between 0 and 100.")
        }
        let body = UpdateAdminFlagBody(enabled: enabled, rolloutPercent: rolloutPercent)
        return try await putJSON(
            pathComponents: ["api", "v1", "admin", "flags", trimmed],
            body: body,
            authorized: .required
        )
    }

    /// POST `/api/v1/admin/fraud/alerts/{id}/review`
    /// Status: `open` | `investigating` | `resolved_fraud` | `resolved_legitimate` | `dismissed`.
    @discardableResult
    func reviewAdminFraudAlert(
        id: String,
        status: String,
        resolutionNotes: String = "",
        restrictUser: Bool = false,
        banUser: Bool = false
    ) async throws -> AdminFraudAlert {
        let trimmed = id.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "Alert id is required.")
        }
        let statusTrimmed = status.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !statusTrimmed.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "Status is required.")
        }
        let body = ReviewAdminFraudAlertBody(
            status: statusTrimmed,
            resolutionNotes: resolutionNotes.trimmingCharacters(in: .whitespacesAndNewlines),
            restrictUser: restrictUser,
            banUser: banUser
        )
        let response: AdminFraudReviewResponse = try await postJSON(
            pathComponents: ["api", "v1", "admin", "fraud", "alerts", trimmed, "review"],
            body: body,
            authorized: .required
        )
        guard let alert = response.alert else {
            throw APIClientError.decoding("Fraud review response missing alert.")
        }
        return alert
    }

    /// POST `/api/v1/admin/disputes/{id}/resolve`
    /// Resolution types: `favor_customer` | `favor_provider` | `split` | `dismissed` (web parity).
    @discardableResult
    func resolveAdminDispute(
        id: String,
        resolutionType: String,
        resolutionNotes: String = "",
        refundAmountCents: Int64? = nil,
        guaranteeOutcome: String? = nil
    ) async throws -> AdminDisputeRow {
        let trimmed = id.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "Dispute id is required.")
        }
        let typeTrimmed = resolutionType.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !typeTrimmed.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "Resolution type is required.")
        }
        let body = ResolveAdminDisputeBody(
            resolutionType: typeTrimmed,
            resolutionNotes: resolutionNotes.trimmingCharacters(in: .whitespacesAndNewlines),
            refundAmountCents: refundAmountCents,
            guaranteeOutcome: guaranteeOutcome
        )
        let response: AdminDisputeResolveResponse = try await postJSON(
            pathComponents: ["api", "v1", "admin", "disputes", trimmed, "resolve"],
            body: body,
            authorized: .required
        )
        guard let dispute = response.dispute else {
            throw APIClientError.decoding("Dispute resolve response missing dispute.")
        }
        return dispute
    }

    /// POST `/api/v1/admin/goods-reports/{id}/resolve`
    /// Actions: `dismiss` | `actioned` | `review`.
    @discardableResult
    func resolveAdminGoodsReport(
        id: String,
        action: String,
        notes: String = ""
    ) async throws -> AdminReportResolveResponse {
        try await resolveAdminReport(
            pathSegment: "goods-reports",
            id: id,
            action: action,
            notes: notes
        )
    }

    /// POST `/api/v1/admin/user-reports/{id}/resolve`
    /// Actions: `dismiss` | `actioned` | `review`.
    @discardableResult
    func resolveAdminUserReport(
        id: String,
        action: String,
        notes: String = ""
    ) async throws -> AdminReportResolveResponse {
        try await resolveAdminReport(
            pathSegment: "user-reports",
            id: id,
            action: action,
            notes: notes
        )
    }

    private func resolveAdminReport(
        pathSegment: String,
        id: String,
        action: String,
        notes: String
    ) async throws -> AdminReportResolveResponse {
        let trimmed = id.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "Report id is required.")
        }
        let actionTrimmed = action.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard actionTrimmed == "dismiss" || actionTrimmed == "actioned" || actionTrimmed == "review" else {
            throw APIClientError.httpStatus(400, detail: "Action must be dismiss, actioned, or review.")
        }
        let body = ResolveAdminReportBody(
            action: actionTrimmed,
            notes: notes.trimmingCharacters(in: .whitespacesAndNewlines)
        )
        return try await postJSON(
            pathComponents: ["api", "v1", "admin", pathSegment, trimmed, "resolve"],
            body: body,
            authorized: .required
        )
    }

    /// POST `/api/v1/admin/users/{id}/suspend` — body `{ reason }`.
    @discardableResult
    func suspendAdminUser(id: String, reason: String) async throws -> AdminUserRow {
        try await mutateAdminUser(id: id, pathAction: "suspend", reason: reason)
    }

    /// POST `/api/v1/admin/users/{id}/ban` — body `{ reason }`.
    @discardableResult
    func banAdminUser(id: String, reason: String) async throws -> AdminUserRow {
        try await mutateAdminUser(id: id, pathAction: "ban", reason: reason)
    }

    /// POST `/api/v1/admin/users/{id}/reactivate` — optional body; empty payload is valid.
    @discardableResult
    func reactivateAdminUser(id: String) async throws -> AdminUserRow {
        let trimmed = id.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "User id is required.")
        }
        let response: AdminUserMutationResponse = try await postJSON(
            pathComponents: ["api", "v1", "admin", "users", trimmed, "reactivate"],
            body: EmptyBody(),
            authorized: .required
        )
        guard let user = response.user else {
            throw APIClientError.decoding("Reactivate response missing user.")
        }
        return user
    }

    private func mutateAdminUser(id: String, pathAction: String, reason: String) async throws -> AdminUserRow {
        let trimmed = id.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "User id is required.")
        }
        let reasonTrimmed = reason.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !reasonTrimmed.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "Reason is required.")
        }
        let response: AdminUserMutationResponse = try await postJSON(
            pathComponents: ["api", "v1", "admin", "users", trimmed, pathAction],
            body: AdminUserReasonBody(reason: reasonTrimmed),
            authorized: .required
        )
        guard let user = response.user else {
            throw APIClientError.decoding("User \(pathAction) response missing user.")
        }
        return user
    }

    /// GET `/api/v1/admin/advances` — working capital queue (all providers).
    func fetchAdminAdvances(
        page: Int = 1,
        pageSize: Int = 40,
        status: String? = nil
    ) async throws -> AdvancesResponse {
        var query = [
            URLQueryItem(name: "page", value: String(max(1, page))),
            URLQueryItem(name: "page_size", value: String(min(max(1, pageSize), 100))),
        ]
        if let status, !status.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            query.append(
                URLQueryItem(
                    name: "status",
                    value: status.trimmingCharacters(in: .whitespacesAndNewlines)
                )
            )
        }
        return try await getJSON(
            pathComponents: ["api", "v1", "admin", "advances"],
            query: query,
            authorized: true
        )
    }

    /// POST `/api/v1/admin/advances/{id}/review` — `action`: `approve` | `reject`.
    @discardableResult
    func reviewAdminAdvance(
        id: String,
        action: String,
        reason: String = ""
    ) async throws -> WorkingCapitalAdvance {
        let trimmed = id.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "Advance id is required.")
        }
        let actionTrimmed = action.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard actionTrimmed == "approve" || actionTrimmed == "reject" else {
            throw APIClientError.httpStatus(400, detail: "Action must be approve or reject.")
        }
        let body = ReviewAdminAdvanceBody(
            action: actionTrimmed,
            reason: reason.trimmingCharacters(in: .whitespacesAndNewlines)
        )
        let response: AdvanceEnvelope = try await postJSON(
            pathComponents: ["api", "v1", "admin", "advances", trimmed, "review"],
            body: body,
            authorized: .required
        )
        guard let advance = response.advance else {
            throw APIClientError.decoding("Advance review response missing advance.")
        }
        return advance
    }
}

// MARK: - Admin models

struct AdminFeatureFlag: Decodable, Sendable, Hashable, Identifiable {
    var key: String
    var enabled: Bool?
    var description: String?
    var rolloutPercent: Int?
    var binaryOnly: Bool?
    var updatedAt: String?

    var id: String { key }

    var displayTitle: String { key.replacingOccurrences(of: "_", with: " ") }
    var isOn: Bool { enabled == true }
    var isBinaryOnly: Bool { binaryOnly == true }
}

struct AdminFeatureFlagUpdateResponse: Decodable, Sendable {
    var key: String?
    var enabled: Bool?
    var rolloutPercent: Int?
    var binaryOnly: Bool?
}

/// PUT body for `/api/v1/admin/flags/{key}`.
private struct UpdateAdminFlagBody: Encodable {
    var enabled: Bool
    var rolloutPercent: Int?

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(enabled, forKey: .enabled)
        // Omit rollout when nil so the server leaves the column unchanged.
        if let rolloutPercent {
            try c.encode(rolloutPercent, forKey: .rolloutPercent)
        }
    }

    private enum CodingKeys: String, CodingKey {
        case enabled
        case rolloutPercent
    }
}

struct AdminFlagsResponse: Decodable, Sendable {
    var flags: [AdminFeatureFlag]

    init(from decoder: Decoder) throws {
        if let arr = try? decoder.singleValueContainer().decode([AdminFeatureFlag].self) {
            flags = arr
            return
        }
        let c = try decoder.container(keyedBy: CodingKeys.self)
        flags = try c.decodeIfPresent([AdminFeatureFlag].self, forKey: .flags) ?? []
    }

    enum CodingKeys: String, CodingKey { case flags }
}

struct AdminDisputeRow: Decodable, Sendable, Hashable, Identifiable {
    var id: String
    var contractId: String?
    var status: String?
    var disputeType: String?
    var description: String?
    var openedBy: String?
    var createdAt: String?
    var isGuaranteeClaim: Bool?
    var resolutionType: String?
    var resolutionNotes: String?

    var isOpenForResolution: Bool {
        let s = (status ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return s.isEmpty || s == "open" || s == "under_review" || s == "escalated"
    }
}

struct AdminDisputesResponse: Decodable, Sendable {
    var disputes: [AdminDisputeRow]

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        disputes = try c.decodeIfPresent([AdminDisputeRow].self, forKey: .disputes) ?? []
    }

    enum CodingKeys: String, CodingKey { case disputes }
}

struct AdminDisputeResolveResponse: Decodable, Sendable {
    var dispute: AdminDisputeRow?
}

/// POST body for `/api/v1/admin/disputes/{id}/resolve`.
private struct ResolveAdminDisputeBody: Encodable {
    var resolutionType: String
    var resolutionNotes: String
    var refundAmountCents: Int64?
    var guaranteeOutcome: String?

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(resolutionType, forKey: .resolutionType)
        try c.encode(resolutionNotes, forKey: .resolutionNotes)
        if let refundAmountCents {
            try c.encode(refundAmountCents, forKey: .refundAmountCents)
        }
        if let guaranteeOutcome {
            try c.encode(guaranteeOutcome, forKey: .guaranteeOutcome)
        }
    }

    private enum CodingKeys: String, CodingKey {
        case resolutionType
        case resolutionNotes
        case refundAmountCents
        case guaranteeOutcome
    }
}

struct AdminUserRow: Decodable, Sendable, Hashable, Identifiable {
    var id: String
    var email: String?
    var displayName: String?
    var roles: [String]?
    var createdAt: String?
    var status: String?

    var displayLabel: String {
        let name = displayName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !name.isEmpty { return name }
        let e = email?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return e.isEmpty ? id : e
    }

    var normalizedStatus: String {
        (status ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }

    var isSuspended: Bool { normalizedStatus == "suspended" }
    var isBanned: Bool { normalizedStatus == "banned" }
    /// Mirrors web: Suspend disabled when already suspended (or banned).
    var canSuspend: Bool { !isSuspended && !isBanned }
    /// Ban disabled when already banned.
    var canBan: Bool { !isBanned }
    var canReactivate: Bool { isSuspended }

    var displayStatus: String {
        let s = normalizedStatus
        return s.isEmpty ? "unknown" : s
    }
}

struct AdminUsersResponse: Decodable, Sendable {
    var users: [AdminUserRow]

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        users = try c.decodeIfPresent([AdminUserRow].self, forKey: .users) ?? []
    }

    enum CodingKeys: String, CodingKey { case users }
}

struct AdminUserMutationResponse: Decodable, Sendable {
    var user: AdminUserRow?
}

/// POST body for suspend/ban.
private struct AdminUserReasonBody: Encodable {
    var reason: String
}

struct AdminReportRow: Decodable, Sendable, Hashable, Identifiable {
    var id: String
    var status: String?
    var reason: String?
    var targetId: String?
    var reporterId: String?
    var createdAt: String?
    var listingId: String?
    var userId: String?

    /// Open or intermediate (`reviewed`) — not terminal `dismissed` / `actioned`.
    var isOpenForResolution: Bool {
        let s = (status ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if s.isEmpty || s == "open" || s == "pending" || s == "reviewed" { return true }
        return s != "dismissed" && s != "actioned"
    }
}

struct AdminReportsResponse: Decodable, Sendable {
    var reports: [AdminReportRow]

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        if let r = try c.decodeIfPresent([AdminReportRow].self, forKey: .reports) {
            reports = r
        } else if let r = try c.decodeIfPresent([AdminReportRow].self, forKey: .goodsReports) {
            reports = r
        } else if let r = try c.decodeIfPresent([AdminReportRow].self, forKey: .userReports) {
            reports = r
        } else {
            reports = []
        }
    }

    enum CodingKeys: String, CodingKey {
        case reports
        case goodsReports
        case userReports
    }
}

struct AdminFraudAlert: Decodable, Sendable, Hashable, Identifiable {
    var id: String
    var severity: String?
    var aggregateRiskLevel: String?
    var status: String?
    var summary: String?
    var resolutionNotes: String?
    var createdAt: String?
    var userId: String?

    var displayRisk: String {
        let raw = (aggregateRiskLevel ?? severity ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        return raw.isEmpty ? "alert" : raw
    }

    var isResolved: Bool {
        let s = (status ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return s == "resolved_fraud" || s == "resolved_legitimate" || s == "dismissed"
    }
}

struct AdminFraudResponse: Decodable, Sendable {
    var alerts: [AdminFraudAlert]

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        if let a = try c.decodeIfPresent([AdminFraudAlert].self, forKey: .alerts) {
            alerts = a
        } else if let a = try c.decodeIfPresent([AdminFraudAlert].self, forKey: .items) {
            alerts = a
        } else {
            alerts = []
        }
    }

    enum CodingKeys: String, CodingKey { case alerts, items }
}

struct AdminFraudReviewResponse: Decodable, Sendable {
    var alert: AdminFraudAlert?
}

/// POST body for `/api/v1/admin/fraud/alerts/{id}/review`.
private struct ReviewAdminFraudAlertBody: Encodable {
    var status: String
    var resolutionNotes: String
    var restrictUser: Bool
    var banUser: Bool
}

struct AdminReportResolveResponse: Decodable, Sendable {
    var reportId: String?
    var status: String?
}

/// POST body for goods/user report resolve.
private struct ResolveAdminReportBody: Encodable {
    var action: String
    var notes: String
}

/// POST body for `/api/v1/admin/advances/{id}/review`.
private struct ReviewAdminAdvanceBody: Encodable {
    var action: String
    var reason: String
}
