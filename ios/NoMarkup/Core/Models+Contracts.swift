import Foundation

// MARK: - Contracts (services reverse-auction workspace)
//
// Gateway: `gateway/internal/handler/contract.go` + `review.go`.
// List: GET `/api/v1/contracts` → `{ contracts: [...], pagination? }`
// Detail: GET `/api/v1/contracts/{id}` → flat contract map (+ optional change_orders).
// Money is integer cents. Status strings match `contractStatusToString`.

// MARK: List envelope

struct ContractsListResponse: Codable, Sendable, Hashable {
    var contracts: [ContractSummary]
    var pagination: PaginationMeta?

    enum CodingKeys: String, CodingKey {
        case contracts
        case pagination
    }

    init(contracts: [ContractSummary], pagination: PaginationMeta? = nil) {
        self.contracts = contracts
        self.pagination = pagination
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        contracts = try c.decodeIfPresent([ContractSummary].self, forKey: .contracts) ?? []
        pagination = try c.decodeIfPresent(PaginationMeta.self, forKey: .pagination)
    }
}

// MARK: Summary (list row)

/// Row from `GET /api/v1/contracts`. All fields optional except `id` so partial maps decode.
struct ContractSummary: Codable, Sendable, Hashable, Identifiable {
    let id: String
    var contractNumber: String?
    var jobId: String?
    var jobTitle: String?
    var customerId: String?
    var providerId: String?
    var customerName: String?
    var providerName: String?
    var bidId: String?
    var amountCents: Int64?
    var tipAmountCents: Int64?
    var paymentTiming: String?
    var status: String?
    var customerAccepted: Bool?
    var providerAccepted: Bool?
    var acceptanceDeadline: String?
    var acceptedAt: String?
    var startedAt: String?
    var completedAt: String?
    var createdAt: String?
    var milestones: [ContractMilestone]?

    enum CodingKeys: String, CodingKey {
        case id
        case contractNumber
        case jobId
        case jobTitle
        case customerId
        case providerId
        case customerName
        case providerName
        case bidId
        case amountCents
        case tipAmountCents
        case paymentTiming
        case status
        case customerAccepted
        case providerAccepted
        case acceptanceDeadline
        case acceptedAt
        case startedAt
        case completedAt
        case createdAt
        case milestones
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        // Require a non-empty id; fall back to empty only if missing (filtered by list consumers).
        if let raw = try c.decodeIfPresent(String.self, forKey: .id), !raw.isEmpty {
            id = raw
        } else {
            throw DecodingError.dataCorruptedError(
                forKey: .id,
                in: c,
                debugDescription: "contract id required"
            )
        }
        contractNumber = try c.decodeIfPresent(String.self, forKey: .contractNumber)
        jobId = try c.decodeIfPresent(String.self, forKey: .jobId)
        jobTitle = try c.decodeIfPresent(String.self, forKey: .jobTitle)
        customerId = try c.decodeIfPresent(String.self, forKey: .customerId)
        providerId = try c.decodeIfPresent(String.self, forKey: .providerId)
        customerName = try c.decodeIfPresent(String.self, forKey: .customerName)
        providerName = try c.decodeIfPresent(String.self, forKey: .providerName)
        bidId = try c.decodeIfPresent(String.self, forKey: .bidId)
        amountCents = Self.decodeFlexibleInt64(c, forKey: .amountCents)
        tipAmountCents = Self.decodeFlexibleInt64(c, forKey: .tipAmountCents)
        paymentTiming = try c.decodeIfPresent(String.self, forKey: .paymentTiming)
        status = try c.decodeIfPresent(String.self, forKey: .status)
        customerAccepted = try c.decodeIfPresent(Bool.self, forKey: .customerAccepted)
        providerAccepted = try c.decodeIfPresent(Bool.self, forKey: .providerAccepted)
        acceptanceDeadline = try c.decodeIfPresent(String.self, forKey: .acceptanceDeadline)
        acceptedAt = try c.decodeIfPresent(String.self, forKey: .acceptedAt)
        startedAt = try c.decodeIfPresent(String.self, forKey: .startedAt)
        completedAt = try c.decodeIfPresent(String.self, forKey: .completedAt)
        createdAt = try c.decodeIfPresent(String.self, forKey: .createdAt)
        milestones = try c.decodeIfPresent([ContractMilestone].self, forKey: .milestones)
    }

    /// Tolerates Int / Double / String money fields from heterogeneous gateway maps.
    private static func decodeFlexibleInt64(
        _ c: KeyedDecodingContainer<CodingKeys>,
        forKey key: CodingKeys
    ) -> Int64? {
        if let v = try? c.decodeIfPresent(Int64.self, forKey: key) { return v }
        if let v = try? c.decodeIfPresent(Int.self, forKey: key) { return Int64(v) }
        if let v = try? c.decodeIfPresent(Double.self, forKey: key) { return Int64(v) }
        if let s = try? c.decodeIfPresent(String.self, forKey: key),
           let v = Int64(s.trimmingCharacters(in: .whitespacesAndNewlines))
        {
            return v
        }
        return nil
    }

    // MARK: Display

    var displayTitle: String {
        if let jobTitle, !jobTitle.isEmpty { return jobTitle }
        if let contractNumber, !contractNumber.isEmpty { return "Contract \(contractNumber)" }
        return "Contract \(String(id.prefix(8)))"
    }

    var displayStatus: String {
        StatusChipStyle.displayLabel(status ?? "unknown")
    }

    var displayAmount: String {
        MoneyFormat.usd(cents: amountCents ?? 0)
    }

    var statusStyle: StatusChipStyle {
        StatusChipStyle.forContractStatus(status)
    }

    var hasStarted: Bool {
        guard let startedAt, !startedAt.isEmpty else { return false }
        return true
    }

    var hasCompletedMark: Bool {
        guard let completedAt, !completedAt.isEmpty else { return false }
        return true
    }

    var normalizedStatus: String {
        (status ?? "").lowercased()
    }

    func isCustomer(userId: String?) -> Bool {
        guard let userId, !userId.isEmpty, let customerId else { return false }
        return customerId == userId
    }

    func isProvider(userId: String?) -> Bool {
        guard let userId, !userId.isEmpty, let providerId else { return false }
        return providerId == userId
    }

    func partyHasAccepted(userId: String?) -> Bool {
        if isCustomer(userId: userId) { return customerAccepted == true }
        if isProvider(userId: userId) { return providerAccepted == true }
        return false
    }

    func counterpartyLabel(userId: String?) -> String {
        if isCustomer(userId: userId) {
            if let providerName, !providerName.isEmpty { return providerName }
            if let providerId, !providerId.isEmpty {
                return "Provider \(String(providerId.prefix(8)))"
            }
            return "Provider"
        }
        if isProvider(userId: userId) {
            if let customerName, !customerName.isEmpty { return customerName }
            if let customerId, !customerId.isEmpty {
                return "Customer \(String(customerId.prefix(8)))"
            }
            return "Customer"
        }
        // Unknown role: show both when available.
        let cust = customerName ?? customerId.map { String($0.prefix(8)) } ?? "Customer"
        let prov = providerName ?? providerId.map { String($0.prefix(8)) } ?? "Provider"
        return "\(cust) · \(prov)"
    }
}

// MARK: Detail

/// Full contract from `GET /api/v1/contracts/{id}` (flat map; change_orders optional).
struct ContractDetail: Codable, Sendable, Hashable, Identifiable {
    let id: String
    var contractNumber: String?
    var jobId: String?
    var jobTitle: String?
    var customerId: String?
    var providerId: String?
    var customerName: String?
    var providerName: String?
    var bidId: String?
    var amountCents: Int64?
    var tipAmountCents: Int64?
    var paymentTiming: String?
    var status: String?
    var customerAccepted: Bool?
    var providerAccepted: Bool?
    var acceptanceDeadline: String?
    var acceptedAt: String?
    var startedAt: String?
    var completedAt: String?
    var createdAt: String?
    var milestones: [ContractMilestone]?
    var changeOrders: [ContractChangeOrder]?

    enum CodingKeys: String, CodingKey {
        case id
        case contractNumber
        case jobId
        case jobTitle
        case customerId
        case providerId
        case customerName
        case providerName
        case bidId
        case amountCents
        case tipAmountCents
        case paymentTiming
        case status
        case customerAccepted
        case providerAccepted
        case acceptanceDeadline
        case acceptedAt
        case startedAt
        case completedAt
        case createdAt
        case milestones
        case changeOrders
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        if let raw = try c.decodeIfPresent(String.self, forKey: .id), !raw.isEmpty {
            id = raw
        } else {
            throw DecodingError.dataCorruptedError(
                forKey: .id,
                in: c,
                debugDescription: "contract id required"
            )
        }
        contractNumber = try c.decodeIfPresent(String.self, forKey: .contractNumber)
        jobId = try c.decodeIfPresent(String.self, forKey: .jobId)
        jobTitle = try c.decodeIfPresent(String.self, forKey: .jobTitle)
        customerId = try c.decodeIfPresent(String.self, forKey: .customerId)
        providerId = try c.decodeIfPresent(String.self, forKey: .providerId)
        customerName = try c.decodeIfPresent(String.self, forKey: .customerName)
        providerName = try c.decodeIfPresent(String.self, forKey: .providerName)
        bidId = try c.decodeIfPresent(String.self, forKey: .bidId)
        amountCents = Self.decodeFlexibleInt64(c, forKey: .amountCents)
        tipAmountCents = Self.decodeFlexibleInt64(c, forKey: .tipAmountCents)
        paymentTiming = try c.decodeIfPresent(String.self, forKey: .paymentTiming)
        status = try c.decodeIfPresent(String.self, forKey: .status)
        customerAccepted = try c.decodeIfPresent(Bool.self, forKey: .customerAccepted)
        providerAccepted = try c.decodeIfPresent(Bool.self, forKey: .providerAccepted)
        acceptanceDeadline = try c.decodeIfPresent(String.self, forKey: .acceptanceDeadline)
        acceptedAt = try c.decodeIfPresent(String.self, forKey: .acceptedAt)
        startedAt = try c.decodeIfPresent(String.self, forKey: .startedAt)
        completedAt = try c.decodeIfPresent(String.self, forKey: .completedAt)
        createdAt = try c.decodeIfPresent(String.self, forKey: .createdAt)
        milestones = try c.decodeIfPresent([ContractMilestone].self, forKey: .milestones)
        changeOrders = try c.decodeIfPresent([ContractChangeOrder].self, forKey: .changeOrders)
    }

    private static func decodeFlexibleInt64(
        _ c: KeyedDecodingContainer<CodingKeys>,
        forKey key: CodingKeys
    ) -> Int64? {
        if let v = try? c.decodeIfPresent(Int64.self, forKey: key) { return v }
        if let v = try? c.decodeIfPresent(Int.self, forKey: key) { return Int64(v) }
        if let v = try? c.decodeIfPresent(Double.self, forKey: key) { return Int64(v) }
        if let s = try? c.decodeIfPresent(String.self, forKey: key),
           let v = Int64(s.trimmingCharacters(in: .whitespacesAndNewlines))
        {
            return v
        }
        return nil
    }

    var displayTitle: String {
        if let jobTitle, !jobTitle.isEmpty { return jobTitle }
        if let contractNumber, !contractNumber.isEmpty { return "Contract \(contractNumber)" }
        return "Contract \(String(id.prefix(8)))"
    }

    var displayStatus: String {
        StatusChipStyle.displayLabel(status ?? "unknown")
    }

    var displayAmount: String {
        MoneyFormat.usd(cents: amountCents ?? 0)
    }

    var statusStyle: StatusChipStyle {
        StatusChipStyle.forContractStatus(status)
    }

    var hasStarted: Bool {
        guard let startedAt, !startedAt.isEmpty else { return false }
        return true
    }

    var hasCompletedMark: Bool {
        guard let completedAt, !completedAt.isEmpty else { return false }
        return true
    }

    var normalizedStatus: String {
        (status ?? "").lowercased()
    }

    var resolvedMilestones: [ContractMilestone] {
        milestones ?? []
    }

    func isCustomer(userId: String?) -> Bool {
        guard let userId, !userId.isEmpty, let customerId else { return false }
        return customerId == userId
    }

    func isProvider(userId: String?) -> Bool {
        guard let userId, !userId.isEmpty, let providerId else { return false }
        return providerId == userId
    }

    func partyHasAccepted(userId: String?) -> Bool {
        if isCustomer(userId: userId) { return customerAccepted == true }
        if isProvider(userId: userId) { return providerAccepted == true }
        return false
    }
}

// MARK: Milestone

/// Alias matching product vocabulary; stored type is `ContractMilestone`.
typealias Milestone = ContractMilestone

struct ContractMilestone: Codable, Sendable, Hashable, Identifiable {
    let id: String
    var contractId: String?
    var description: String?
    var amountCents: Int64?
    var sortOrder: Int?
    var status: String?
    var revisionCount: Int?
    var revisionNotes: String?
    var submittedAt: String?
    var approvedAt: String?

    enum CodingKeys: String, CodingKey {
        case id
        case contractId
        case description
        case amountCents
        case sortOrder
        case status
        case revisionCount
        case revisionNotes
        case submittedAt
        case approvedAt
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        if let raw = try c.decodeIfPresent(String.self, forKey: .id), !raw.isEmpty {
            id = raw
        } else {
            throw DecodingError.dataCorruptedError(
                forKey: .id,
                in: c,
                debugDescription: "milestone id required"
            )
        }
        contractId = try c.decodeIfPresent(String.self, forKey: .contractId)
        description = try c.decodeIfPresent(String.self, forKey: .description)
        if let v = try? c.decodeIfPresent(Int64.self, forKey: .amountCents) {
            amountCents = v
        } else if let v = try? c.decodeIfPresent(Int.self, forKey: .amountCents) {
            amountCents = Int64(v)
        } else if let v = try? c.decodeIfPresent(Double.self, forKey: .amountCents) {
            amountCents = Int64(v)
        } else {
            amountCents = nil
        }
        sortOrder = try c.decodeIfPresent(Int.self, forKey: .sortOrder)
        status = try c.decodeIfPresent(String.self, forKey: .status)
        revisionCount = try c.decodeIfPresent(Int.self, forKey: .revisionCount)
        revisionNotes = try c.decodeIfPresent(String.self, forKey: .revisionNotes)
        submittedAt = try c.decodeIfPresent(String.self, forKey: .submittedAt)
        approvedAt = try c.decodeIfPresent(String.self, forKey: .approvedAt)
    }

    var displayDescription: String {
        if let description, !description.isEmpty { return description }
        return "Milestone \(String(id.prefix(8)))"
    }

    var displayAmount: String {
        MoneyFormat.usd(cents: amountCents ?? 0)
    }

    var displayStatus: String {
        StatusChipStyle.displayLabel(status ?? "unknown")
    }

    var normalizedStatus: String {
        (status ?? "").lowercased()
    }

    var canSubmitAsProvider: Bool {
        switch normalizedStatus {
        case "in_progress", "revision_requested":
            return true
        default:
            return false
        }
    }

    var canApproveAsCustomer: Bool {
        normalizedStatus == "submitted"
    }
}

// MARK: Change order (detail only)

struct ContractChangeOrder: Codable, Sendable, Hashable, Identifiable {
    let id: String
    var contractId: String?
    var proposedBy: String?
    var description: String?
    var amountDeltaCents: Int64?
    var status: String?
    var createdAt: String?

    enum CodingKeys: String, CodingKey {
        case id, contractId, proposedBy, description, amountDeltaCents, status, createdAt
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeIfPresent(String.self, forKey: .id) ?? UUID().uuidString
        contractId = try c.decodeIfPresent(String.self, forKey: .contractId)
        proposedBy = try c.decodeIfPresent(String.self, forKey: .proposedBy)
        description = try c.decodeIfPresent(String.self, forKey: .description)
        if let v = try? c.decodeIfPresent(Int64.self, forKey: .amountDeltaCents) {
            amountDeltaCents = v
        } else if let v = try? c.decodeIfPresent(Int.self, forKey: .amountDeltaCents) {
            amountDeltaCents = Int64(v)
        } else {
            amountDeltaCents = nil
        }
        status = try c.decodeIfPresent(String.self, forKey: .status)
        createdAt = try c.decodeIfPresent(String.self, forKey: .createdAt)
    }
}

// MARK: Dispute / review responses (flexible)

struct ContractDisputeResponse: Codable, Sendable, Hashable {
    var id: String?
    var contractId: String?
    var status: String?
    var disputeType: String?
    var description: String?
}

struct ContractReviewResponse: Codable, Sendable, Hashable {
    var id: String?
    var contractId: String?
    var overallRating: Int?
    var comment: String?
    var status: String?
}

// MARK: Dispute type options (OpenDispute `dispute_type`)

enum ContractDisputeType: String, CaseIterable, Identifiable, Sendable {
    case quality
    case incompleteWork = "incomplete_work"
    case noShow = "no_show"
    case abandonment
    case payment
    case scopeDisagreement = "scope_disagreement"
    case other

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .quality: return "Quality issue"
        case .incompleteWork: return "Incomplete work"
        case .noShow: return "No-show"
        case .abandonment: return "Abandonment"
        case .payment: return "Payment issue"
        case .scopeDisagreement: return "Scope disagreement"
        case .other: return "Other"
        }
    }
}

// MARK: Status chip extension for contracts

extension StatusChipStyle {
    static func forContractStatus(_ raw: String?) -> StatusChipStyle {
        guard let raw, !raw.isEmpty else { return .neutral }
        switch raw.lowercased() {
        case "active", "in_progress":
            return .success
        case "pending_acceptance", "pending", "suspended":
            return .warning
        case "completed":
            return .info
        case "cancelled", "canceled", "voided", "abandoned", "disputed":
            return .danger
        default:
            return forStatus(raw)
        }
    }
}
