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

    /// GET `/api/v1/admin/fraud` (or fraud alerts path)
    func fetchAdminFraudAlerts(page: Int = 1, pageSize: Int = 40) async throws -> AdminFraudResponse {
        try await getJSON(
            pathComponents: ["api", "v1", "admin", "fraud"],
            query: [
                URLQueryItem(name: "page", value: String(max(1, page))),
                URLQueryItem(name: "page_size", value: String(min(max(1, pageSize), 100))),
            ],
            authorized: true
        )
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
}

struct AdminDisputesResponse: Decodable, Sendable {
    var disputes: [AdminDisputeRow]

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        disputes = try c.decodeIfPresent([AdminDisputeRow].self, forKey: .disputes) ?? []
    }

    enum CodingKeys: String, CodingKey { case disputes }
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
}

struct AdminUsersResponse: Decodable, Sendable {
    var users: [AdminUserRow]

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        users = try c.decodeIfPresent([AdminUserRow].self, forKey: .users) ?? []
    }

    enum CodingKeys: String, CodingKey { case users }
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
    var status: String?
    var summary: String?
    var createdAt: String?
    var userId: String?
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
