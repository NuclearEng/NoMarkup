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

/// Nested recurring schedule on contract detail / GET …/recurring (FR-18).
struct ContractRecurringConfig: Codable, Sendable, Hashable, Identifiable {
    let id: String
    var contractId: String?
    var frequency: String?
    var rateCents: Int64?
    var autoApprove: Bool?
    var status: String?
    var nextOccurrence: String?

    var displayFrequency: String {
        let f = frequency?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return f.isEmpty ? "Recurring" : StatusChipStyle.displayLabel(f)
    }

    var displayStatus: String {
        StatusChipStyle.displayLabel(status ?? "unknown")
    }

    var displayRate: String {
        MoneyFormat.usd(cents: rateCents ?? 0)
    }

    var isActive: Bool {
        (status ?? "").lowercased() == "active"
    }

    var isPaused: Bool {
        (status ?? "").lowercased() == "paused"
    }

    var isCancelled: Bool {
        (status ?? "").lowercased() == "cancelled"
    }
}

/// One occurrence from GET …/recurring/instances (FR-18.2).
struct ContractRecurringInstance: Codable, Sendable, Hashable, Identifiable {
    let id: String
    var recurringId: String?
    var occurrenceDate: String?
    var status: String?
    var amountCents: Int64?
    var autoApproved: Bool?
    var completedAt: String?

    var displayStatus: String {
        StatusChipStyle.displayLabel(status ?? "unknown")
    }

    var displayAmount: String {
        MoneyFormat.usd(cents: amountCents ?? 0)
    }

    var displayDate: String {
        guard let occurrenceDate, !occurrenceDate.isEmpty else { return "—" }
        return CatalogDateFormat.friendlyDateTime(occurrenceDate)
    }

    var isCompletable: Bool {
        let s = (status ?? "").lowercased()
        return s == "scheduled" || s == "in_progress"
    }

    /// Completed visits may be approved by the customer. Server approve is idempotent
    /// (proto has no `approved_at` on the wire — residual).
    var isApprovable: Bool {
        (status ?? "").lowercased() == "completed" && completedAt != nil
    }
}

struct RecurringConfigEnvelope: Codable, Sendable {
    var config: ContractRecurringConfig?
}

struct RecurringInstancesListResponse: Codable, Sendable {
    var instances: [ContractRecurringInstance]?
}

/// Approve/complete envelope. Money fields only on approve when gateway
/// CreatePayment succeeds (snake_case via APIClient convertFromSnakeCase).
struct RecurringInstanceEnvelope: Codable, Sendable {
    var instance: ContractRecurringInstance?
    /// Present when gateway CreatePayment succeeded for this visit (FR-18 residual).
    var paymentId: String?
    /// Stripe PaymentIntent secret for PaymentSheet — only when real PI was created.
    var clientSecret: String?
    /// Honest residual when approve committed but money path did not (no fake payment).
    var paymentResidual: String?
    var paymentError: String?
    /// Nested payment map when gateway embeds CreatePayment result.
    var payment: ContractPayment?
}

/// Result of customer approve-visit: status update plus optional escrow PI.
struct RecurringApproveResult: Sendable {
    var instance: ContractRecurringInstance
    var paymentId: String?
    var clientSecret: String?
    var paymentResidual: String?
    var paymentError: String?
    var payment: ContractPayment?

    /// True when the gateway returned a confirmable (or dev) PaymentIntent secret.
    var hasPayCTA: Bool {
        guard let secret = clientSecret?.trimmingCharacters(in: .whitespacesAndNewlines),
              !secret.isEmpty
        else {
            return false
        }
        if secret.hasPrefix("pi_dev_") || secret.hasPrefix("dev_") {
            return true
        }
        return secret.hasPrefix("pi_") && secret.contains("_secret_")
    }
}

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
    /// Present when the contract has a recurring_configs row (FR-18).
    var recurring: ContractRecurringConfig? = nil

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
        case recurring
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
        recurring = try c.decodeIfPresent(ContractRecurringConfig.self, forKey: .recurring)
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

    /// Customer may request revision while work is submitted for review.
    var canRequestRevisionAsCustomer: Bool {
        normalizedStatus == "submitted"
    }
}

// MARK: Change order

/// Alias matching product vocabulary; stored type is `ContractChangeOrder`.
typealias ChangeOrder = ContractChangeOrder

/// List envelope from `GET /api/v1/contracts/{id}/change-orders`.
struct ChangeOrdersListResponse: Codable, Sendable, Hashable {
    var changeOrders: [ContractChangeOrder]

    enum CodingKeys: String, CodingKey {
        case changeOrders
    }

    init(changeOrders: [ContractChangeOrder] = []) {
        self.changeOrders = changeOrders
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        changeOrders = try c.decodeIfPresent([ContractChangeOrder].self, forKey: .changeOrders) ?? []
    }
}

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
        if let raw = try c.decodeIfPresent(String.self, forKey: .id), !raw.isEmpty {
            id = raw
        } else {
            id = UUID().uuidString
        }
        contractId = try c.decodeIfPresent(String.self, forKey: .contractId)
        proposedBy = try c.decodeIfPresent(String.self, forKey: .proposedBy)
        description = try c.decodeIfPresent(String.self, forKey: .description)
        if let v = try? c.decodeIfPresent(Int64.self, forKey: .amountDeltaCents) {
            amountDeltaCents = v
        } else if let v = try? c.decodeIfPresent(Int.self, forKey: .amountDeltaCents) {
            amountDeltaCents = Int64(v)
        } else if let v = try? c.decodeIfPresent(Double.self, forKey: .amountDeltaCents) {
            amountDeltaCents = Int64(v)
        } else if let s = try? c.decodeIfPresent(String.self, forKey: .amountDeltaCents),
                  let v = Int64(s.trimmingCharacters(in: .whitespacesAndNewlines))
        {
            amountDeltaCents = v
        } else {
            amountDeltaCents = nil
        }
        status = try c.decodeIfPresent(String.self, forKey: .status)
        createdAt = try c.decodeIfPresent(String.self, forKey: .createdAt)
    }

    var displayDescription: String {
        if let description, !description.isEmpty { return description }
        return "Change order \(String(id.prefix(8)))"
    }

    var displayAmountDelta: String {
        let cents = amountDeltaCents ?? 0
        let absFormatted = MoneyFormat.usd(cents: abs(cents))
        if cents > 0 { return "+\(absFormatted)" }
        if cents < 0 { return "−\(absFormatted)" }
        return absFormatted
    }

    var displayStatus: String {
        StatusChipStyle.displayLabel(status ?? "unknown")
    }

    var normalizedStatus: String {
        (status ?? "").lowercased()
    }

    var isPending: Bool {
        switch normalizedStatus {
        case "proposed", "pending", "open", "":
            return true
        default:
            return false
        }
    }

    /// True when `userId` is a contract party other than the proposer (can accept/reject).
    func canRespond(as userId: String?, contract: ContractDetail) -> Bool {
        guard isPending else { return false }
        guard let userId, !userId.isEmpty else { return false }
        guard contract.isCustomer(userId: userId) || contract.isProvider(userId: userId) else {
            return false
        }
        if let proposedBy, !proposedBy.isEmpty, proposedBy == userId {
            return false
        }
        return true
    }
}

// MARK: Guarantee claim

/// Flexible decode for `GET/POST /api/v1/contracts/{id}/guarantee-claim` (dispute-shaped).
struct GuaranteeClaim: Codable, Sendable, Hashable {
    var id: String?
    var contractId: String?
    var openedBy: String?
    var initiatedBy: String?
    var disputeType: String?
    var reason: String?
    var description: String?
    var evidenceUrls: [String]?
    var status: String?
    var isGuaranteeClaim: Bool?
    var guaranteeOutcome: String?
    var resolutionType: String?
    var resolutionNotes: String?
    var refundAmountCents: Int64?
    var guaranteePayoutCents: Int64?
    var createdAt: String?
    var resolvedAt: String?

    enum CodingKeys: String, CodingKey {
        case id
        case contractId
        case openedBy
        case initiatedBy
        case disputeType
        case reason
        case description
        case evidenceUrls
        case status
        case isGuaranteeClaim
        case guaranteeOutcome
        case resolutionType
        case resolutionNotes
        case refundAmountCents
        case guaranteePayoutCents
        case createdAt
        case resolvedAt
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeIfPresent(String.self, forKey: .id)
        contractId = try c.decodeIfPresent(String.self, forKey: .contractId)
        openedBy = try c.decodeIfPresent(String.self, forKey: .openedBy)
        initiatedBy = try c.decodeIfPresent(String.self, forKey: .initiatedBy)
        disputeType = try c.decodeIfPresent(String.self, forKey: .disputeType)
        reason = try c.decodeIfPresent(String.self, forKey: .reason)
        description = try c.decodeIfPresent(String.self, forKey: .description)
        evidenceUrls = try c.decodeIfPresent([String].self, forKey: .evidenceUrls)
        status = try c.decodeIfPresent(String.self, forKey: .status)
        isGuaranteeClaim = try c.decodeIfPresent(Bool.self, forKey: .isGuaranteeClaim)
        guaranteeOutcome = try c.decodeIfPresent(String.self, forKey: .guaranteeOutcome)
        resolutionType = try c.decodeIfPresent(String.self, forKey: .resolutionType)
        resolutionNotes = try c.decodeIfPresent(String.self, forKey: .resolutionNotes)
        if let v = try? c.decodeIfPresent(Int64.self, forKey: .refundAmountCents) {
            refundAmountCents = v
        } else if let v = try? c.decodeIfPresent(Int.self, forKey: .refundAmountCents) {
            refundAmountCents = Int64(v)
        } else {
            refundAmountCents = nil
        }
        if let v = try? c.decodeIfPresent(Int64.self, forKey: .guaranteePayoutCents) {
            guaranteePayoutCents = v
        } else if let v = try? c.decodeIfPresent(Int.self, forKey: .guaranteePayoutCents) {
            guaranteePayoutCents = Int64(v)
        } else {
            guaranteePayoutCents = nil
        }
        createdAt = try c.decodeIfPresent(String.self, forKey: .createdAt)
        resolvedAt = try c.decodeIfPresent(String.self, forKey: .resolvedAt)
    }

    var displayType: String {
        let raw = disputeType ?? reason ?? "guarantee"
        return StatusChipStyle.displayLabel(raw)
    }

    var displayStatus: String {
        StatusChipStyle.displayLabel(status ?? "open")
    }

    var displayDescription: String {
        if let description, !description.isEmpty { return description }
        return "NoMarkup Guarantee claim"
    }
}

/// Envelope from `GET /api/v1/contracts/{id}/guarantee-claim`.
struct GuaranteeClaimResponse: Codable, Sendable, Hashable {
    var guaranteeClaim: GuaranteeClaim?

    enum CodingKeys: String, CodingKey {
        case guaranteeClaim
    }

    init(guaranteeClaim: GuaranteeClaim? = nil) {
        self.guaranteeClaim = guaranteeClaim
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        // Null JSON → nil; missing key → nil.
        guaranteeClaim = try c.decodeIfPresent(GuaranteeClaim.self, forKey: .guaranteeClaim)
    }
}

/// Optional PDF export: `GET /api/v1/contracts/{id}/pdf` → `{ "pdf_url": "..." }`.
struct ContractPDFResponse: Codable, Sendable, Hashable {
    var pdfUrl: String?

    enum CodingKeys: String, CodingKey {
        case pdfUrl
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        pdfUrl = try c.decodeIfPresent(String.self, forKey: .pdfUrl)
    }
}

/// Flexible tip POST response (may be 501 until Stripe tip capture ships).
struct ContractTipResponse: Codable, Sendable, Hashable {
    var id: String?
    var tipAmountCents: Int64?
    var status: String?
    var message: String?

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeIfPresent(String.self, forKey: .id)
        status = try c.decodeIfPresent(String.self, forKey: .status)
        message = try c.decodeIfPresent(String.self, forKey: .message)
        if let v = try? c.decodeIfPresent(Int64.self, forKey: .tipAmountCents) {
            tipAmountCents = v
        } else if let v = try? c.decodeIfPresent(Int.self, forKey: .tipAmountCents) {
            tipAmountCents = Int64(v)
        } else {
            tipAmountCents = nil
        }
    }

    enum CodingKeys: String, CodingKey {
        case id, tipAmountCents, status, message
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

/// GET `/api/v1/contracts/{id}/reviews/eligibility`
struct ReviewEligibility: Codable, Sendable, Hashable {
    var eligible: Bool?
    var alreadyReviewed: Bool?
    var reviewWindowClosesAt: String?

    var isEligible: Bool { eligible == true }
    var hasAlreadyReviewed: Bool { alreadyReviewed == true }

    /// Human-readable reason when not eligible.
    var blockedReason: String? {
        if hasAlreadyReviewed {
            return "You already left a review for this contract."
        }
        if isEligible { return nil }
        if let closes = reviewWindowClosesAt, !closes.isEmpty {
            return "The review window closed on \(CatalogDateFormat.friendlyDateTime(closes))."
        }
        return "This contract is not eligible for review yet (must be completed and within the review window)."
    }
}

// MARK: Guarantee claim reason options

enum GuaranteeClaimReason: String, CaseIterable, Identifiable, Sendable {
    case quality
    case incompleteWork = "incomplete_work"
    case damage
    case noShow = "no_show"
    case other

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .quality: return "Quality issue"
        case .incompleteWork: return "Incomplete work"
        case .damage: return "Property damage"
        case .noShow: return "No-show"
        case .other: return "Other"
        }
    }
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

// MARK: - Service payments / escrow (GET /api/v1/payments, POST create/process/release)

/// Row from `GET /api/v1/payments` / flat payment map from create/process/release.
/// Money fields are server-authoritative integer cents — never recompute on client.
struct ContractPayment: Decodable, Sendable, Hashable, Identifiable {
    let id: String
    var contractId: String?
    var contractNumber: String?
    var milestoneId: String?
    var customerId: String?
    var providerId: String?
    var amountCents: Int64?
    var platformFeeCents: Int64?
    var guaranteeFeeCents: Int64?
    var providerPayoutCents: Int64?
    var status: String?
    var failureReason: String?
    var refundAmountCents: Int64?
    var escrowAt: String?
    var releasedAt: String?
    var completedAt: String?
    var createdAt: String?
    /// Present only on `POST /payments` create response (merged map).
    var clientSecret: String?

    enum CodingKeys: String, CodingKey {
        case id
        case contractId
        case contractNumber
        case milestoneId
        case customerId
        case providerId
        case amountCents
        case platformFeeCents
        case guaranteeFeeCents
        case providerPayoutCents
        case status
        case failureReason
        case refundAmountCents
        case escrowAt
        case releasedAt
        case completedAt
        case createdAt
        case clientSecret
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        if let raw = try c.decodeIfPresent(String.self, forKey: .id), !raw.isEmpty {
            id = raw
        } else {
            throw DecodingError.dataCorruptedError(
                forKey: .id,
                in: c,
                debugDescription: "payment id required"
            )
        }
        contractId = try c.decodeIfPresent(String.self, forKey: .contractId)
        contractNumber = try c.decodeIfPresent(String.self, forKey: .contractNumber)
        milestoneId = try c.decodeIfPresent(String.self, forKey: .milestoneId)
        customerId = try c.decodeIfPresent(String.self, forKey: .customerId)
        providerId = try c.decodeIfPresent(String.self, forKey: .providerId)
        amountCents = Self.decodeFlexibleInt64(c, forKey: .amountCents)
        platformFeeCents = Self.decodeFlexibleInt64(c, forKey: .platformFeeCents)
        guaranteeFeeCents = Self.decodeFlexibleInt64(c, forKey: .guaranteeFeeCents)
        providerPayoutCents = Self.decodeFlexibleInt64(c, forKey: .providerPayoutCents)
        status = try c.decodeIfPresent(String.self, forKey: .status)
        failureReason = try c.decodeIfPresent(String.self, forKey: .failureReason)
        refundAmountCents = Self.decodeFlexibleInt64(c, forKey: .refundAmountCents)
        escrowAt = try c.decodeIfPresent(String.self, forKey: .escrowAt)
        releasedAt = try c.decodeIfPresent(String.self, forKey: .releasedAt)
        completedAt = try c.decodeIfPresent(String.self, forKey: .completedAt)
        createdAt = try c.decodeIfPresent(String.self, forKey: .createdAt)
        clientSecret = try c.decodeIfPresent(String.self, forKey: .clientSecret)
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

    var normalizedStatus: String {
        (status ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }

    /// Funds held pending customer release (or system/admin release).
    var isHeldInEscrow: Bool {
        normalizedStatus == "escrow"
    }

    /// Awaiting customer PaymentSheet confirm + process/capture.
    var isPendingCapture: Bool {
        switch normalizedStatus {
        case "pending", "processing":
            return true
        default:
            return false
        }
    }

    var isReleased: Bool {
        switch normalizedStatus {
        case "released", "completed":
            return true
        default:
            return false
        }
    }

    /// Display amount: server `amount_cents` only (no client fee math).
    var displayAmount: String {
        MoneyFormat.usd(cents: amountCents ?? 0)
    }

    /// Provider-facing payout label when the server supplies it.
    var displayProviderPayout: String? {
        guard let providerPayoutCents, providerPayoutCents > 0 else { return nil }
        return MoneyFormat.usd(cents: providerPayoutCents)
    }

    var displayStatus: String {
        StatusChipStyle.displayLabel(status ?? "unknown")
    }

    /// True when `client_secret` looks like a real Stripe PaymentIntent secret.
    var hasConfirmableSecret: Bool {
        guard let secret = clientSecret?.trimmingCharacters(in: .whitespacesAndNewlines),
              !secret.isEmpty
        else {
            return false
        }
        return secret.hasPrefix("pi_") && secret.contains("_secret_")
    }

    /// Dev-stack sentinel (`pi_dev_…` / `dev_…`) — skip PaymentSheet; process/capture only.
    var isDevClientSecret: Bool {
        guard let secret = clientSecret?.trimmingCharacters(in: .whitespacesAndNewlines),
              !secret.isEmpty
        else {
            return false
        }
        return secret.hasPrefix("pi_dev_") || secret.hasPrefix("dev_")
    }

    /// Customer may call `POST /payments/{id}/release` while status is escrow.
    /// Provider self-release is refused server-side (actor rules).
    func canReleaseAsCustomer(userId: String?) -> Bool {
        guard isHeldInEscrow else { return false }
        guard let userId, !userId.isEmpty else { return false }
        if let customerId, !customerId.isEmpty {
            return customerId == userId
        }
        // If customer_id is absent on the map, still allow UI for the signed-in
        // customer path; the gateway/payment service enforces party + actor.
        return true
    }
}

struct PaymentsListResponse: Decodable, Sendable, Hashable {
    var payments: [ContractPayment]
    var pagination: PaginationMeta?

    enum CodingKeys: String, CodingKey {
        case payments
        case pagination
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        payments = try c.decodeIfPresent([ContractPayment].self, forKey: .payments) ?? []
        pagination = try c.decodeIfPresent(PaginationMeta.self, forKey: .pagination)
    }
}

// MARK: Fee breakdown (display only — POST /payments/calculate-fees)

/// Server fee math for services GMV. Customer still pays `total_cents` (== contract
/// amount); platform/guarantee/lead-gen reduce provider payout. Never use this to
/// invent a charge amount — only display server fields.
struct PaymentFeeBreakdown: Decodable, Sendable, Hashable {
    var subtotalCents: Int64?
    var platformFeeCents: Int64?
    var guaranteeFeeCents: Int64?
    var totalCents: Int64?
    var providerPayoutCents: Int64?
    var feePercentage: Double?
    var guaranteePercentage: Double?
    var leadGenFeeCents: Int64?
    var leadGenPercentage: Double?

    enum CodingKeys: String, CodingKey {
        case subtotalCents
        case platformFeeCents
        case guaranteeFeeCents
        case totalCents
        case providerPayoutCents
        case feePercentage
        case guaranteePercentage
        case leadGenFeeCents
        case leadGenPercentage
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        subtotalCents = Self.decodeFlexibleInt64(c, forKey: .subtotalCents)
        platformFeeCents = Self.decodeFlexibleInt64(c, forKey: .platformFeeCents)
        guaranteeFeeCents = Self.decodeFlexibleInt64(c, forKey: .guaranteeFeeCents)
        totalCents = Self.decodeFlexibleInt64(c, forKey: .totalCents)
        providerPayoutCents = Self.decodeFlexibleInt64(c, forKey: .providerPayoutCents)
        feePercentage = Self.decodeFlexibleDouble(c, forKey: .feePercentage)
        guaranteePercentage = Self.decodeFlexibleDouble(c, forKey: .guaranteePercentage)
        leadGenFeeCents = Self.decodeFlexibleInt64(c, forKey: .leadGenFeeCents)
        leadGenPercentage = Self.decodeFlexibleDouble(c, forKey: .leadGenPercentage)
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

    private static func decodeFlexibleDouble(
        _ c: KeyedDecodingContainer<CodingKeys>,
        forKey key: CodingKeys
    ) -> Double? {
        if let v = try? c.decodeIfPresent(Double.self, forKey: key) { return v }
        if let v = try? c.decodeIfPresent(Int.self, forKey: key) { return Double(v) }
        if let s = try? c.decodeIfPresent(String.self, forKey: key),
           let v = Double(s.trimmingCharacters(in: .whitespacesAndNewlines))
        {
            return v
        }
        return nil
    }

    /// Format a 0…1 fraction as percent for labels (server fields only).
    static func formatPercent(_ fraction: Double?) -> String? {
        guard let fraction else { return nil }
        let pct = fraction * 100
        if pct == floor(pct) {
            return "\(Int(pct))%"
        }
        let trimmed = String(format: "%.2f", pct).replacingOccurrences(
            of: "\\.?0+$",
            with: "",
            options: .regularExpression
        )
        return "\(trimmed)%"
    }

    var displaySubtotal: String {
        MoneyFormat.usd(cents: subtotalCents ?? totalCents ?? 0)
    }

    var displayTotal: String {
        MoneyFormat.usd(cents: totalCents ?? subtotalCents ?? 0)
    }

    var displayPlatformFee: String {
        MoneyFormat.usd(cents: platformFeeCents ?? 0)
    }

    var displayGuaranteeFee: String {
        MoneyFormat.usd(cents: guaranteeFeeCents ?? 0)
    }

    var displayProviderPayout: String {
        MoneyFormat.usd(cents: providerPayoutCents ?? 0)
    }

    var displayLeadGenFee: String? {
        guard let leadGenFeeCents, leadGenFeeCents > 0 else { return nil }
        return MoneyFormat.usd(cents: leadGenFeeCents)
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
