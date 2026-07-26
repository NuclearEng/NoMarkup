import Foundation

// MARK: - Currency

enum MoneyFormat {
    /// Formats integer cents as a localized USD currency string.
    static func usd(cents: Int64) -> String {
        let dollars = Decimal(cents) / 100
        return dollars.formatted(.currency(code: "USD"))
    }

    /// Parses a user-entered dollar amount into integer cents.
    /// Accepts `"12"`, `"12.5"`, `"12.50"`, optional `$` / commas. Rounds half-up to nearest cent.
    /// Returns `nil` for empty, non-numeric, zero, or negative input.
    static func cents(fromDollarsText text: String) -> Int64? {
        var cleaned = text.trimmingCharacters(in: .whitespacesAndNewlines)
        cleaned = cleaned.replacingOccurrences(of: "$", with: "")
        cleaned = cleaned.replacingOccurrences(of: ",", with: "")
        cleaned = cleaned.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleaned.isEmpty, let decimal = Decimal(string: cleaned), decimal > 0 else {
            return nil
        }
        var product = decimal * 100
        var rounded = Decimal()
        NSDecimalRound(&rounded, &product, 0, .plain)
        let value = NSDecimalNumber(decimal: rounded).int64Value
        guard value > 0 else { return nil }
        return value
    }
}

// MARK: - Listing report reasons

/// Valid `reason` values for `POST /api/v1/listings/{id}/report`.
enum ListingReportReason: String, CaseIterable, Identifiable, Sendable {
    case stolen
    case counterfeit
    case prohibited
    case misleading
    case spam
    case other

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .stolen: return "Stolen goods"
        case .counterfeit: return "Counterfeit"
        case .prohibited: return "Prohibited item"
        case .misleading: return "Misleading"
        case .spam: return "Spam"
        case .other: return "Other"
        }
    }
}

// MARK: - Pagination

/// Flexible pagination meta (listings use snake_case + dual camel keys; jobs use camelCase).
struct PaginationMeta: Codable, Sendable, Hashable {
    let page: Int?
    let pageSize: Int?
    let total: Int?
    let totalCount: Int?
    let totalPages: Int?
    let hasNext: Bool?
    let hasPrev: Bool?

    var resolvedTotal: Int {
        total ?? totalCount ?? 0
    }

    var resolvedPage: Int {
        page ?? 1
    }

    var resolvedHasNext: Bool {
        if let hasNext { return hasNext }
        if let totalPages, let page {
            return page < totalPages
        }
        return false
    }
}

// MARK: - Listings (goods forward-auction)

struct ListingPhoto: Codable, Sendable, Hashable, Identifiable {
    let id: String?
    let url: String?
    let sortOrder: Int?
    let blurHash: String?

    var idValue: String { id ?? url ?? UUID().uuidString }
}

/// Summary row from `GET /api/v1/listings`.
struct ListingSummary: Codable, Sendable, Hashable, Identifiable {
    let id: String
    var sellerId: String?
    var categoryId: String?
    var categoryName: String?
    var categorySlug: String?
    var title: String?
    var description: String?
    var status: String?
    var photos: [ListingPhoto]?
    var pickupZip: String?
    var pickupCity: String?
    var pickupState: String?
    var pickupAddress: String?
    var startingPriceCents: Int64?
    var currentBidCents: Int64?
    var minIncrementCents: Int64?
    var reservePriceCents: Int64?
    var buyNowPriceCents: Int64?
    var bidderCount: Int?
    var bidCount: Int?
    var auctionDurationHours: Int?
    var auctionEndsAt: Date?
    var watcherCount: Int?
    var condition: String?
    var distanceKm: Double?
    var createdAt: Date?
    var updatedAt: Date?

    var displayTitle: String {
        let t = title?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return t.isEmpty ? "Untitled listing" : t
    }

    /// Prefer current bid, else starting price.
    var displayPriceCents: Int64 {
        currentBidCents ?? startingPriceCents ?? 0
    }

    var displayPrice: String {
        MoneyFormat.usd(cents: displayPriceCents)
    }

    var locationLabel: String? {
        let city = pickupCity?.trimmingCharacters(in: .whitespacesAndNewlines)
        let state = pickupState?.trimmingCharacters(in: .whitespacesAndNewlines)
        switch (city?.isEmpty == false ? city : nil, state?.isEmpty == false ? state : nil) {
        case let (c?, s?):
            return "\(c), \(s)"
        case let (c?, nil):
            return c
        case let (nil, s?):
            return s
        default:
            if let zip = pickupZip, !zip.isEmpty { return zip }
            return nil
        }
    }
}

/// Detail from `GET /api/v1/listings/{id}` (`{ "listing": ... }`).
struct ListingDetail: Codable, Sendable, Hashable, Identifiable {
    let id: String
    var sellerId: String?
    var categoryId: String?
    var categoryName: String?
    var categorySlug: String?
    var title: String?
    var description: String?
    var status: String?
    var photos: [ListingPhoto]?
    var pickupZip: String?
    var pickupCity: String?
    var pickupState: String?
    var pickupAddress: String?
    var startingPriceCents: Int64?
    var currentBidCents: Int64?
    var minIncrementCents: Int64?
    var reservePriceCents: Int64?
    var buyNowPriceCents: Int64?
    var bidderCount: Int?
    var bidCount: Int?
    var auctionDurationHours: Int?
    var auctionEndsAt: Date?
    var watcherCount: Int?
    var condition: String?
    var distanceKm: Double?
    var createdAt: Date?
    var updatedAt: Date?
    var sellerDisplayName: String?
    var sellerMemberSince: String?
    var sellerListingsCount: Int?
    var sellerTrustTier: String?
    var sellerTrustScore: Int?

    var displayTitle: String {
        let t = title?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return t.isEmpty ? "Untitled listing" : t
    }

    var displayPriceCents: Int64 {
        currentBidCents ?? startingPriceCents ?? 0
    }

    var displayPrice: String {
        MoneyFormat.usd(cents: displayPriceCents)
    }

    var locationLabel: String? {
        let city = pickupCity?.trimmingCharacters(in: .whitespacesAndNewlines)
        let state = pickupState?.trimmingCharacters(in: .whitespacesAndNewlines)
        switch (city?.isEmpty == false ? city : nil, state?.isEmpty == false ? state : nil) {
        case let (c?, s?):
            return "\(c), \(s)"
        case let (c?, nil):
            return c
        case let (nil, s?):
            return s
        default:
            if let zip = pickupZip, !zip.isEmpty { return zip }
            return nil
        }
    }

    /// Seed detail UI from a list row while the network fetch is in flight.
    init(from summary: ListingSummary) {
        id = summary.id
        sellerId = summary.sellerId
        categoryId = summary.categoryId
        categoryName = summary.categoryName
        categorySlug = summary.categorySlug
        title = summary.title
        description = summary.description
        status = summary.status
        photos = summary.photos
        pickupZip = summary.pickupZip
        pickupCity = summary.pickupCity
        pickupState = summary.pickupState
        pickupAddress = summary.pickupAddress
        startingPriceCents = summary.startingPriceCents
        currentBidCents = summary.currentBidCents
        minIncrementCents = summary.minIncrementCents
        reservePriceCents = summary.reservePriceCents
        buyNowPriceCents = summary.buyNowPriceCents
        bidderCount = summary.bidderCount
        bidCount = summary.bidCount
        auctionDurationHours = summary.auctionDurationHours
        auctionEndsAt = summary.auctionEndsAt
        watcherCount = summary.watcherCount
        condition = summary.condition
        distanceKm = summary.distanceKm
        createdAt = summary.createdAt
        updatedAt = summary.updatedAt
        sellerDisplayName = nil
        sellerMemberSince = nil
        sellerListingsCount = nil
        sellerTrustTier = nil
        sellerTrustScore = nil
    }
}

struct ListingsResponse: Codable, Sendable {
    let listings: [ListingSummary]
    let pagination: PaginationMeta?
}

struct ListingDetailResponse: Codable, Sendable {
    let listing: ListingDetail
}

// MARK: - Jobs (services reverse-auction)

struct JobApproximateAddress: Codable, Sendable, Hashable {
    var city: String?
    var state: String?
    var zipCode: String?

    var label: String? {
        let city = city?.trimmingCharacters(in: .whitespacesAndNewlines)
        let state = state?.trimmingCharacters(in: .whitespacesAndNewlines)
        switch (city?.isEmpty == false ? city : nil, state?.isEmpty == false ? state : nil) {
        case let (c?, s?):
            return "\(c), \(s)"
        case let (c?, nil):
            return c
        case let (nil, s?):
            return s
        default:
            if let zip = zipCode, !zip.isEmpty { return zip }
            return nil
        }
    }
}

/// Summary / list row from `GET /api/v1/jobs` (`jobs` array of maps).
///
/// Job timestamps from the gateway are ISO-8601 **strings** (`formatTimestamp`),
/// so date fields are `String?` rather than `Date?`.
struct JobSummary: Codable, Sendable, Hashable, Identifiable {
    let id: String
    var customerId: String?
    var title: String?
    var description: String?
    var status: String?
    var scheduleType: String?
    var isRecurring: Bool?
    var auctionDurationHours: Int?
    var bidCount: Int?
    var repostCount: Int?
    var categoryId: String?
    var categoryName: String?
    var categorySlug: String?
    var approximateAddress: JobApproximateAddress?
    var startingBidCents: Int64?
    var offerAcceptedCents: Int64?
    var auctionEndsAt: String?
    var auctionType: String?
    var createdAt: String?
    var photoUrls: [String]?

    var displayTitle: String {
        let t = title?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return t.isEmpty ? "Untitled job" : t
    }

    var displayPrice: String? {
        if let offer = offerAcceptedCents {
            return MoneyFormat.usd(cents: offer)
        }
        if let start = startingBidCents {
            return MoneyFormat.usd(cents: start)
        }
        return nil
    }

    var locationLabel: String? {
        approximateAddress?.label
    }
}

/// Detail from `GET /api/v1/jobs/{id}` (`{ "job": ... }`).
struct JobDetail: Codable, Sendable, Hashable, Identifiable {
    let id: String
    var customerId: String?
    var title: String?
    var description: String?
    var status: String?
    var scheduleType: String?
    var isRecurring: Bool?
    var auctionDurationHours: Int?
    var bidCount: Int?
    var repostCount: Int?
    var categoryId: String?
    var categoryName: String?
    var categorySlug: String?
    var approximateAddress: JobApproximateAddress?
    var startingBidCents: Int64?
    var offerAcceptedCents: Int64?
    var auctionEndsAt: String?
    var auctionType: String?
    var createdAt: String?
    var photoUrls: [String]?
    var customerDisplayName: String?
    var customerAvatarUrl: String?
    var customerMemberSince: String?
    var customerJobsPosted: Int?
    var awardedProviderId: String?
    var completedAt: String?
    var auctionClosedAt: String?

    var displayTitle: String {
        let t = title?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return t.isEmpty ? "Untitled job" : t
    }

    var displayPrice: String? {
        if let offer = offerAcceptedCents {
            return MoneyFormat.usd(cents: offer)
        }
        if let start = startingBidCents {
            return MoneyFormat.usd(cents: start)
        }
        return nil
    }

    var locationLabel: String? {
        approximateAddress?.label
    }

    init(from summary: JobSummary) {
        id = summary.id
        customerId = summary.customerId
        title = summary.title
        description = summary.description
        status = summary.status
        scheduleType = summary.scheduleType
        isRecurring = summary.isRecurring
        auctionDurationHours = summary.auctionDurationHours
        bidCount = summary.bidCount
        repostCount = summary.repostCount
        categoryId = summary.categoryId
        categoryName = summary.categoryName
        categorySlug = summary.categorySlug
        approximateAddress = summary.approximateAddress
        startingBidCents = summary.startingBidCents
        offerAcceptedCents = summary.offerAcceptedCents
        auctionEndsAt = summary.auctionEndsAt
        auctionType = summary.auctionType
        createdAt = summary.createdAt
        photoUrls = summary.photoUrls
        customerDisplayName = nil
        customerAvatarUrl = nil
        customerMemberSince = nil
        customerJobsPosted = nil
        awardedProviderId = nil
        completedAt = nil
        auctionClosedAt = nil
    }
}

struct JobsResponse: Codable, Sendable {
    let jobs: [JobSummary]
    let pagination: PaginationMeta?
}

struct JobDetailResponse: Codable, Sendable {
    let job: JobDetail
}

/// Authenticated `GET /api/v1/jobs/mine` uses the same job row shape as public list.
/// Alias keeps call sites explicit about the owner-scoped surface.
typealias JobMine = JobSummary

struct JobsMineResponse: Codable, Sendable {
    let jobs: [JobMine]
    let pagination: PaginationMeta?
}

// MARK: - Chat

/// Preview / last message embedded on a channel, or a row from messages list.
struct ChatMessage: Codable, Sendable, Hashable, Identifiable {
    let id: String
    var channelId: String?
    var senderId: String?
    var messageType: String?
    var content: String?
    var isRead: Bool?
    var createdAt: String?

    var displayBody: String {
        let raw = content?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if raw.isEmpty {
            switch messageType {
            case "image": return "Photo"
            case "file": return "File"
            case "system": return "System message"
            case "contact_share": return "Contact shared"
            default: return "Message"
            }
        }
        return raw
    }
}

/// Summary row from `GET /api/v1/channels` (`channels` array).
struct ChatChannelSummary: Codable, Sendable, Hashable, Identifiable {
    let id: String
    var jobId: String?
    var contractId: String?
    var customerId: String?
    var providerId: String?
    var channelType: String?
    var unreadCount: Int?
    var createdAt: String?
    var updatedAt: String?
    var customerName: String?
    var providerName: String?
    var lastMessage: ChatMessage?

    /// Best-effort title for the inbox row (counterparty when known).
    var displayTitle: String {
        let customer = customerName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let provider = providerName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !customer.isEmpty, !provider.isEmpty {
            return "\(customer) · \(provider)"
        }
        if !customer.isEmpty { return customer }
        if !provider.isEmpty { return provider }
        if let jobId, !jobId.isEmpty {
            return "Job chat"
        }
        return "Conversation"
    }

    var previewText: String? {
        lastMessage?.displayBody
    }

    var typeLabel: String? {
        guard let channelType, !channelType.isEmpty else { return nil }
        return channelType.replacingOccurrences(of: "_", with: " ").capitalized
    }
}

struct ChatChannelsResponse: Codable, Sendable {
    let channels: [ChatChannelSummary]
    let pagination: PaginationMeta?
}

struct ChatMessagesResponse: Codable, Sendable {
    let messages: [ChatMessage]
}
