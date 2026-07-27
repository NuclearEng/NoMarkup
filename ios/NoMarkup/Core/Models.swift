import Foundation

// MARK: - Date / countdown helpers

enum CatalogDateFormat {
    /// Parses gateway ISO-8601 timestamps (with or without fractional seconds).
    static func parseISO(_ iso: String) -> Date? {
        let trimmed = iso.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = formatter.date(from: trimmed) {
            return date
        }
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.date(from: trimmed)
    }

    static func friendlyDateTime(_ iso: String) -> String {
        guard let date = parseISO(iso) else { return iso }
        return date.formatted(date: .abbreviated, time: .shortened)
    }

    /// Short auction countdown: "Ends in 2h", "Ends in 45m", "Ended", or absolute if far out.
    static func countdownLabel(until date: Date, now: Date = Date()) -> String {
        let remaining = date.timeIntervalSince(now)
        if remaining <= 0 {
            return "Ended"
        }
        let minutes = Int(remaining / 60)
        if minutes < 60 {
            return "Ends in \(max(1, minutes))m"
        }
        let hours = minutes / 60
        if hours < 48 {
            let remMin = minutes % 60
            if remMin == 0 {
                return "Ends in \(hours)h"
            }
            return "Ends in \(hours)h \(remMin)m"
        }
        let days = hours / 24
        if days < 14 {
            return "Ends in \(days)d"
        }
        return "Ends \(date.formatted(date: .abbreviated, time: .omitted))"
    }

    static func countdownLabel(iso: String, now: Date = Date()) -> String? {
        guard let date = parseISO(iso) else { return nil }
        return countdownLabel(until: date, now: now)
    }
}

// MARK: - Status chip styling

enum StatusChipStyle {
    case success
    case info
    case warning
    case danger
    case neutral

    static func forStatus(_ raw: String?) -> StatusChipStyle {
        guard let raw, !raw.isEmpty else { return .neutral }
        switch raw.lowercased() {
        case "open", "active", "live", "published", "in_progress", "awarded":
            return .success
        case "pending", "pending_payment", "scheduled", "review":
            return .warning
        case "completed", "closed", "sold", "fulfilled", "paid":
            return .info
        case "cancelled", "canceled", "rejected", "expired", "failed":
            return .danger
        default:
            return .neutral
        }
    }

    static func displayLabel(_ raw: String) -> String {
        raw.replacingOccurrences(of: "_", with: " ").capitalized
    }
}

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

    var priceCaption: String {
        if currentBidCents != nil { return "Current bid" }
        return "Starting"
    }

    var auctionCountdown: String? {
        guard let ends = auctionEndsAt else { return nil }
        return CatalogDateFormat.countdownLabel(until: ends)
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

/// Response from `POST|DELETE /api/v1/listings/{id}/watch`.
struct WatchToggleResponse: Codable, Sendable {
    let watching: Bool
    var watcherCount: Int?
}

/// `GET /api/v1/me/watchlist` reuses the public listings list envelope.
typealias WatchlistResponse = ListingsResponse

// MARK: - Service categories (taxonomy)

/// Row from `GET /api/v1/categories` — job create needs a real `id` (UUID FK).
struct ServiceCategorySummary: Codable, Sendable, Hashable, Identifiable {
    let id: String
    var parentId: String?
    var name: String?
    var slug: String?
    var level: Int?
    var description: String?
    var icon: String?
    var active: Bool?

    var displayName: String {
        let n = name?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !n.isEmpty { return n }
        let s = slug?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return s.isEmpty ? id : s
    }
}

struct ServiceCategoriesResponse: Codable, Sendable {
    let categories: [ServiceCategorySummary]
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

    /// Price label: accepted offer preferred, else starting bid.
    var priceCaption: String? {
        if offerAcceptedCents != nil { return "Accepted" }
        if startingBidCents != nil { return "Starting" }
        return nil
    }

    var auctionCountdown: String? {
        guard let ends = auctionEndsAt, !ends.isEmpty else { return nil }
        return CatalogDateFormat.countdownLabel(iso: ends)
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

// MARK: - Marketplace orders & payment (Rail A — Stripe / Apple Pay)

/// Response from `POST /api/v1/listings/{id}/buy-now` and `POST /api/v1/orders/{id}/pay`.
/// Gateway attaches a PaymentIntent `client_secret` for native Apple Pay confirmation.
struct PaymentIntentEnvelope: Codable, Sendable {
    var orderId: String?
    var clientSecret: String?
    var paymentIntentId: String?
    var paymentRequired: Bool?
    var totalCents: Int64?
    var amountCents: Int64?
    var feeCents: Int64?
    var taxCents: Int64?
    var escrowStatus: String?
    var chargeError: String?

    /// True when the secret looks like a real Stripe PaymentIntent client secret.
    var hasConfirmableSecret: Bool {
        guard let secret = clientSecret?.trimmingCharacters(in: .whitespacesAndNewlines),
              !secret.isEmpty else {
            return false
        }
        // Shape: pi_…_secret_…
        return secret.hasPrefix("pi_") && secret.contains("_secret_")
    }

    var displayTotalCents: Int64? {
        if let totalCents, totalCents > 0 { return totalCents }
        if let amountCents, amountCents > 0 { return amountCents }
        return nil
    }
}

/// Buy-now closeout: order created in `pending_payment` + optional PI secret.
struct BuyNowResponse: Codable, Sendable {
    var orderId: String?
    var escrowStatus: String?
    var clientSecret: String?
    var paymentIntentId: String?
    var paymentRequired: Bool?
    var totalCents: Int64?
    var chargeError: String?

    var envelope: PaymentIntentEnvelope {
        PaymentIntentEnvelope(
            orderId: orderId,
            clientSecret: clientSecret,
            paymentIntentId: paymentIntentId,
            paymentRequired: paymentRequired,
            totalCents: totalCents,
            amountCents: nil,
            feeCents: nil,
            taxCents: nil,
            escrowStatus: escrowStatus,
            chargeError: chargeError
        )
    }
}

/// Summary row from `GET /api/v1/me/orders`.
struct ListingOrderSummary: Codable, Sendable, Hashable, Identifiable {
    let id: String
    var orderId: String?
    var listingId: String?
    var listingTitle: String?
    var buyerId: String?
    var sellerId: String?
    var sellerDisplayName: String?
    var escrowStatus: String?
    var status: String?
    var amountCents: Int64?
    var feeCents: Int64?
    var platformFeeCents: Int64?
    var sellerPayoutCents: Int64?
    var paymentIntentId: String?
    var pickupCity: String?
    var pickupState: String?
    /// Present once the seller has stamped their half of the mutual handshake.
    var sellerConfirmedAt: String?
    var pickupConfirmedAt: String?

    var displayTitle: String {
        let t = listingTitle?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return t.isEmpty ? "Order" : t
    }

    var displayAmount: String {
        MoneyFormat.usd(cents: amountCents ?? 0)
    }

    /// Normalized escrow state machine value (`pending_payment`, `held`, …).
    var normalizedEscrow: String {
        (escrowStatus ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }

    var needsPayment: Bool {
        let mapped = (status ?? "").lowercased()
        return normalizedEscrow == "pending_payment" || mapped == "pending"
    }

    /// Buyer may confirm pickup only while funds are held (pre-pickup_confirmed).
    func canConfirmPickupAsBuyer(userId: String?) -> Bool {
        guard let userId, !userId.isEmpty, buyerId == userId else { return false }
        return normalizedEscrow == "held"
    }

    /// Seller may confirm while held or pickup_confirmed, until they have already stamped.
    func canSellerConfirm(userId: String?) -> Bool {
        guard let userId, !userId.isEmpty, sellerId == userId else { return false }
        guard normalizedEscrow == "held" || normalizedEscrow == "pickup_confirmed" else {
            return false
        }
        if let stamped = sellerConfirmedAt?.trimmingCharacters(in: .whitespacesAndNewlines),
           !stamped.isEmpty {
            return false
        }
        return true
    }

    /// Buyer may file a dispute while funds are held, or shortly after mutual pickup confirm.
    func canFileDisputeAsBuyer(userId: String?) -> Bool {
        guard let userId, !userId.isEmpty, buyerId == userId else { return false }
        return normalizedEscrow == "held" || normalizedEscrow == "pickup_confirmed"
    }

    /// Either party may report a no-show while escrow is held (pre-pickup).
    func canReportNoShow(userId: String?) -> Bool {
        guard let userId, !userId.isEmpty else { return false }
        guard buyerId == userId || sellerId == userId else { return false }
        return normalizedEscrow == "held"
    }

    var displayStatus: String {
        if needsPayment { return "Awaiting payment" }
        switch normalizedEscrow {
        case "held":
            return "Held — awaiting pickup"
        case "pickup_confirmed":
            return "Pickup confirmed — awaiting seller"
        case "released":
            return "Released"
        default:
            let raw = escrowStatus ?? status ?? "unknown"
            return raw.replacingOccurrences(of: "_", with: " ").capitalized
        }
    }
}

/// Response from confirm-pickup / seller-confirm (flexible shape).
struct OrderEscrowActionResponse: Codable, Sendable {
    var orderId: String?
    var escrowStatus: String?
    var sellerPayoutCents: Int64?
    var pickupConfirmedAt: String?
    var sellerConfirmedAt: String?
    var bothConfirmed: Bool?
}

struct MyOrdersResponse: Codable, Sendable {
    let orders: [ListingOrderSummary]
}

// MARK: - Best-Offer chain

/// Offer status values from `listing_offers` (+ lazy `expired` display).
enum ListingOfferStatus: String, Codable, Sendable {
    case pending
    case accepted
    case rejected
    case countered
    case withdrawn
    case expired
    case unknown

    init(raw: String?) {
        guard let raw, let value = ListingOfferStatus(rawValue: raw.lowercased()) else {
            self = .unknown
            return
        }
        self = value
    }

    var displayLabel: String {
        rawValue.capitalized
    }

    var isActionable: Bool {
        self == .pending || self == .countered
    }
}

/// PATCH action for `PATCH /api/v1/offers/{id}`.
enum ListingOfferAction: String, Sendable {
    case accept
    case reject
    case counter
    case withdraw
}

/// Single Best-Offer row from create/list/update offer endpoints.
struct ListingOffer: Codable, Sendable, Hashable, Identifiable {
    let id: String
    var listingId: String?
    var buyerId: String?
    var amountCents: Int64?
    var status: String?
    var parentOfferId: String?
    var expiresAt: String?
    var message: String?
    var createdAt: String?
    var updatedAt: String?

    var amountCentsValue: Int64 { amountCents ?? 0 }

    var displayAmount: String {
        MoneyFormat.usd(cents: amountCentsValue)
    }

    var statusEnum: ListingOfferStatus {
        ListingOfferStatus(raw: status)
    }

    var displayStatus: String {
        statusEnum.displayLabel
    }

    var displayMessage: String? {
        let m = message?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return m.isEmpty ? nil : m
    }
}

struct ListingOffersResponse: Codable, Sendable {
    let offers: [ListingOffer]
}

struct ListingOfferEnvelope: Codable, Sendable {
    let offer: ListingOffer?
}

// MARK: - Saved searches

struct SavedSearchQuery: Codable, Sendable, Hashable {
    var q: String?

    var displayQuery: String {
        let t = q?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return t.isEmpty ? "All listings" : t
    }
}

struct SavedSearch: Codable, Sendable, Hashable, Identifiable {
    let id: String
    var userId: String?
    var name: String?
    var query: SavedSearchQuery?
    var alertFrequency: String?
    var lastRunAt: String?
    var createdAt: String?
    var updatedAt: String?

    var displayName: String {
        let n = name?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return n.isEmpty ? "Saved search" : n
    }

    var displayFrequency: String {
        let f = alertFrequency?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "daily"
        return f.capitalized
    }
}

struct SavedSearchesResponse: Codable, Sendable {
    let savedSearches: [SavedSearch]
}

struct SavedSearchEnvelope: Codable, Sendable {
    let savedSearch: SavedSearch?
}

// MARK: - Seller analytics

struct SellerAnalyticsDailyPoint: Codable, Sendable, Hashable, Identifiable {
    var date: String?
    var grossCents: Int64?
    var orderCount: Int?

    var id: String { date ?? UUID().uuidString }

    var displayDate: String {
        date ?? "—"
    }

    var displayGross: String {
        MoneyFormat.usd(cents: grossCents ?? 0)
    }
}

struct SellerAnalyticsTopCategory: Codable, Sendable, Hashable, Identifiable {
    var categoryId: String?
    var categoryName: String?
    var count: Int?

    var id: String { categoryId ?? categoryName ?? UUID().uuidString }

    var displayName: String {
        let n = categoryName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !n.isEmpty { return n }
        return categoryId ?? "Category"
    }
}

struct SellerAnalytics: Codable, Sendable {
    var rangeDays: Int?
    var dailyRevenue: [SellerAnalyticsDailyPoint]?
    var sellThroughRate: Double?
    var avgSalePriceCents: Int64?
    var totalGrossCents: Int64?
    var totalSold: Int?
    var totalListed: Int?
    var topCategories: [SellerAnalyticsTopCategory]?

    var displaySellThrough: String {
        guard let rate = sellThroughRate else { return "—" }
        return rate.formatted(.percent.precision(.fractionLength(0...1)))
    }

    var displayAvgSale: String {
        MoneyFormat.usd(cents: avgSalePriceCents ?? 0)
    }

    var displayTotalGross: String {
        MoneyFormat.usd(cents: totalGrossCents ?? 0)
    }
}

// MARK: - Listing order dispute / no-show

/// Allowed `reason` values for `POST /api/v1/orders/{id}/file-dispute`.
enum ListingDisputeReason: String, CaseIterable, Identifiable, Sendable {
    case itemNotAsDescribed = "item_not_as_described"
    case itemDamaged = "item_damaged"
    case noShow = "no_show"
    case itemNotReceived = "item_not_received"
    case other

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .itemNotAsDescribed: return "Item not as described"
        case .itemDamaged: return "Item damaged"
        case .noShow: return "No-show"
        case .itemNotReceived: return "Item not received"
        case .other: return "Other"
        }
    }
}

struct FileListingDisputeResponse: Codable, Sendable {
    var disputeId: String?
    var orderId: String?
    var escrowStatus: String?
    var status: String?
}

struct ReportNoShowResponse: Codable, Sendable {
    var orderId: String?
    var reportedUserId: String?
    var newNoShowCount: Int?
    var cooldownUntil: String?
    var shadowBanTriggered: Bool?
}

// MARK: - Auction bid ladders

/// Public bid row from `GET /api/v1/listings/{id}/bids`.
struct ListingBidRow: Codable, Sendable, Hashable, Identifiable {
    let id: String
    var listingId: String?
    var bidderId: String?
    var bidderDisplayName: String?
    var amountCents: Int64?
    var isWinning: Bool?
    var createdAt: String?

    var displayName: String {
        let n = bidderDisplayName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return n.isEmpty ? "Bidder" : n
    }

    var displayAmount: String {
        MoneyFormat.usd(cents: amountCents ?? 0)
    }
}

struct ListingBidsResponse: Codable, Sendable {
    let bids: [ListingBidRow]
    var currentBidCents: Int64?
    var bidderCount: Int?
}

/// Nested bid from job owner bid list (auth). Flexible keys for proto JSON.
struct JobBidCore: Codable, Sendable, Hashable {
    var id: String?
    var jobId: String?
    var providerId: String?
    var amountCents: Int64?
    var originalAmountCents: Int64?
    var status: String?
    var isOfferAccepted: Bool?
    var createdAt: String?
    var updatedAt: String?
}

/// Gateway returns `trust_score` as `{ overall_score, tier }`, not a bare double.
struct ProviderTrustScore: Codable, Sendable, Hashable {
    var overallScore: Double?
    var tier: String?

    /// 0…1 overall score when present.
    var normalizedScore: Double? {
        overallScore
    }

    var displayTier: String {
        let t = tier?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return t.isEmpty ? "—" : t.replacingOccurrences(of: "_", with: " ").capitalized
    }
}

struct JobBidEntry: Codable, Sendable, Hashable, Identifiable {
    var bid: JobBidCore?
    var providerDisplayName: String?
    var providerBusinessName: String?
    var providerAvatarUrl: String?
    var jobsCompleted: Int?
    var trustScore: ProviderTrustScore?
    /// Legacy / alternate: some payloads may send a bare number.
    var trustScoreValue: Double?

    var id: String {
        bid?.id ?? UUID().uuidString
    }

    var displayName: String {
        let biz = providerBusinessName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !biz.isEmpty { return biz }
        let n = providerDisplayName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return n.isEmpty ? "Provider" : n
    }

    var displayAmount: String {
        MoneyFormat.usd(cents: bid?.amountCents ?? 0)
    }

    var displayTrust: String {
        if let tier = trustScore?.tier, !tier.isEmpty {
            return trustScore?.displayTier ?? tier
        }
        if let v = trustScore?.overallScore ?? trustScoreValue {
            return String(format: "%.0f%%", v * 100)
        }
        return "—"
    }

    enum CodingKeys: String, CodingKey {
        case bid
        case providerDisplayName
        case providerBusinessName
        case providerAvatarUrl
        case jobsCompleted
        case trustScore
        case reviewSummary
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        bid = try c.decodeIfPresent(JobBidCore.self, forKey: .bid)
        providerDisplayName = try c.decodeIfPresent(String.self, forKey: .providerDisplayName)
        providerBusinessName = try c.decodeIfPresent(String.self, forKey: .providerBusinessName)
        providerAvatarUrl = try c.decodeIfPresent(String.self, forKey: .providerAvatarUrl)
        jobsCompleted = try c.decodeIfPresent(Int.self, forKey: .jobsCompleted)

        // trust_score may be object OR bare number OR missing.
        trustScore = nil
        trustScoreValue = nil
        if c.contains(.trustScore) {
            if let obj = try? c.decode(ProviderTrustScore.self, forKey: .trustScore) {
                trustScore = obj
            } else if let d = try? c.decode(Double.self, forKey: .trustScore) {
                trustScoreValue = d
                trustScore = ProviderTrustScore(overallScore: d, tier: nil)
            } else if let i = try? c.decode(Int.self, forKey: .trustScore) {
                let d = Double(i)
                trustScoreValue = d
                trustScore = ProviderTrustScore(overallScore: d, tier: nil)
            }
            // else: null / unknown shape → leave nil (don't fail whole ladder)
        }
        // review_summary intentionally ignored (null or object).
        _ = try? c.decodeIfPresent(FlexibleJSONValue.self, forKey: .reviewSummary)
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encodeIfPresent(bid, forKey: .bid)
        try c.encodeIfPresent(providerDisplayName, forKey: .providerDisplayName)
        try c.encodeIfPresent(providerBusinessName, forKey: .providerBusinessName)
        try c.encodeIfPresent(providerAvatarUrl, forKey: .providerAvatarUrl)
        try c.encodeIfPresent(jobsCompleted, forKey: .jobsCompleted)
        try c.encodeIfPresent(trustScore, forKey: .trustScore)
    }
}

/// Decode any JSON leaf so unknown nested objects don't break the ladder.
enum FlexibleJSONValue: Codable, Sendable, Hashable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array
    case object

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() {
            self = .null
        } else if let b = try? c.decode(Bool.self) {
            self = .bool(b)
        } else if let n = try? c.decode(Double.self) {
            self = .number(n)
        } else if let s = try? c.decode(String.self) {
            self = .string(s)
        } else if (try? c.decode([FlexibleJSONValue].self)) != nil {
            self = .array
        } else {
            self = .object
        }
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .null: try c.encodeNil()
        case .bool(let b): try c.encode(b)
        case .number(let n): try c.encode(n)
        case .string(let s): try c.encode(s)
        case .array, .object: try c.encodeNil()
        }
    }
}

struct JobBidsResponse: Codable, Sendable {
    let bids: [JobBidEntry]
}

// MARK: - Live auction state (optional light poll)

/// Snapshot from `GET /api/v1/jobs/{id}/auction/state`.
/// All fields optional — proto/JSON shapes vary and the endpoint may be gated.
struct LiveAuctionState: Decodable, Sendable, Hashable {
    var jobId: String?
    var lowestBidCents: Int64?
    var bidCount: Int?
    var auctionEndsAt: String?
    var snipeExtensionCount: Int?
    var maxSnipeExtensions: Int?

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        jobId = try c.decodeIfPresent(String.self, forKey: .jobId)
        lowestBidCents = Self.decodeInt64(c, forKey: .lowestBidCents)
        bidCount = Self.decodeInt(c, forKey: .bidCount)
        auctionEndsAt = Self.decodeTimestampString(c, forKey: .auctionEndsAt)
        snipeExtensionCount = Self.decodeInt(c, forKey: .snipeExtensionCount)
        maxSnipeExtensions = Self.decodeInt(c, forKey: .maxSnipeExtensions)
    }

    private enum CodingKeys: String, CodingKey {
        case jobId
        case lowestBidCents
        case bidCount
        case auctionEndsAt
        case snipeExtensionCount
        case maxSnipeExtensions
    }

    private static func decodeInt64(
        _ c: KeyedDecodingContainer<CodingKeys>,
        forKey key: CodingKeys
    ) -> Int64? {
        if let v = try? c.decodeIfPresent(Int64.self, forKey: key) { return v }
        if let v = try? c.decodeIfPresent(Int.self, forKey: key) { return Int64(v) }
        if let s = try? c.decodeIfPresent(String.self, forKey: key), let v = Int64(s) { return v }
        if let d = try? c.decodeIfPresent(Double.self, forKey: key) { return Int64(d) }
        return nil
    }

    private static func decodeInt(
        _ c: KeyedDecodingContainer<CodingKeys>,
        forKey key: CodingKeys
    ) -> Int? {
        if let v = try? c.decodeIfPresent(Int.self, forKey: key) { return v }
        if let v = try? c.decodeIfPresent(Int64.self, forKey: key) { return Int(v) }
        if let s = try? c.decodeIfPresent(String.self, forKey: key), let v = Int(s) { return v }
        if let d = try? c.decodeIfPresent(Double.self, forKey: key) { return Int(d) }
        return nil
    }

    /// Accepts ISO-8601 string, or nested `{ "seconds": N }` / number unix seconds.
    private static func decodeTimestampString(
        _ c: KeyedDecodingContainer<CodingKeys>,
        forKey key: CodingKeys
    ) -> String? {
        if let s = try? c.decodeIfPresent(String.self, forKey: key), !s.isEmpty {
            return s
        }
        if let n = try? c.decodeIfPresent(Double.self, forKey: key) {
            let date = Date(timeIntervalSince1970: n)
            return ISO8601DateFormatter().string(from: date)
        }
        if let n = try? c.decodeIfPresent(Int64.self, forKey: key) {
            let date = Date(timeIntervalSince1970: TimeInterval(n))
            return ISO8601DateFormatter().string(from: date)
        }
        // Nested protobuf-style object: { "seconds": ..., "nanos": ... }
        struct ProtoTimestamp: Decodable {
            var seconds: Int64?
            var nanos: Int32?
        }
        if let ts = try? c.decodeIfPresent(ProtoTimestamp.self, forKey: key),
           let seconds = ts.seconds {
            let date = Date(timeIntervalSince1970: TimeInterval(seconds))
            return ISO8601DateFormatter().string(from: date)
        }
        return nil
    }
}

// MARK: - My bids (account)

/// Nested listing snapshot on `GET /api/v1/listings/bids/mine`.
struct MyListingBidListing: Codable, Sendable, Hashable {
    var id: String?
    var sellerId: String?
    var title: String?
    var status: String?
    var currentBidCents: Int64?
    var bidCount: Int?
    var auctionEndsAt: String?

    var displayTitle: String {
        let t = title?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return t.isEmpty ? "Listing" : t
    }
}

/// Row from goods bid history: `{ "bid": {...}, "listing": {...} }`.
struct MyListingBidEntry: Codable, Sendable, Hashable, Identifiable {
    var bid: ListingBidRow?
    var listing: MyListingBidListing?

    var id: String {
        bid?.id ?? listing?.id ?? UUID().uuidString
    }

    var displayTitle: String {
        listing?.displayTitle ?? "Listing bid"
    }

    var displayAmount: String {
        bid?.displayAmount ?? MoneyFormat.usd(cents: 0)
    }

    var isWinning: Bool {
        bid?.isWinning == true
    }
}

struct MyListingBidsResponse: Codable, Sendable {
    let bids: [MyListingBidEntry]
    let pagination: PaginationMeta?
}

/// Provider service bid from `GET /api/v1/bids/mine` (proto JSON flat shape).
struct MyJobBidRow: Codable, Sendable, Hashable, Identifiable {
    let id: String
    var jobId: String?
    var providerId: String?
    var amountCents: Int64?
    var status: String?
    var isOfferAccepted: Bool?
    var createdAt: String?

    var displayAmount: String {
        MoneyFormat.usd(cents: amountCents ?? 0)
    }

    var displayStatus: String {
        let raw = status ?? "unknown"
        return raw.replacingOccurrences(of: "_", with: " ").capitalized
    }

    var displayTitle: String {
        if let jobId, !jobId.isEmpty {
            return "Job · \(String(jobId.prefix(8)))…"
        }
        return "Service bid"
    }

    /// Active service bids can be withdrawn via `DELETE /api/v1/bids/{id}`.
    var isWithdrawable: Bool {
        let s = (status ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return s == "active" || s == "open" || s == "pending"
    }

    /// Returns a copy marked withdrawn for optimistic UI updates.
    func markedWithdrawn() -> MyJobBidRow {
        var copy = self
        copy.status = "withdrawn"
        return copy
    }
}

struct MyJobBidsResponse: Codable, Sendable {
    let bids: [MyJobBidRow]
    let pagination: PaginationMeta?
}

// MARK: - Notifications

/// Row from `GET /api/v1/notifications`.
struct AppNotification: Codable, Sendable, Hashable, Identifiable {
    let id: String
    var userId: String?
    var notificationType: String?
    var title: String?
    var body: String?
    var actionUrl: String?
    var isRead: Bool?
    var createdAt: String?
    var readAt: String?

    var displayTitle: String {
        let t = title?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return t.isEmpty ? "Notification" : t
    }

    var displayBody: String {
        body?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    }

    var typeLabel: String? {
        guard let notificationType, !notificationType.isEmpty else { return nil }
        return notificationType.replacingOccurrences(of: "_", with: " ").capitalized
    }

    var unread: Bool {
        isRead != true
    }

    /// Returns a copy marked read for optimistic UI updates.
    func markedRead() -> AppNotification {
        var copy = self
        copy.isRead = true
        return copy
    }
}

struct NotificationsResponse: Codable, Sendable {
    let notifications: [AppNotification]
    let pagination: PaginationMeta?
}

/// `GET /api/v1/notifications/unread-count` — gateway emits `{ "count": N }`.
/// Also accepts `unread_count` if the shape evolves.
struct UnreadNotificationCountResponse: Codable, Sendable {
    var count: Int?
    var unreadCount: Int?

    var value: Int {
        max(0, unreadCount ?? count ?? 0)
    }
}

/// `POST /api/v1/notifications/read-all` — `{ "marked_count": N }`.
struct MarkAllNotificationsReadResponse: Codable, Sendable {
    var markedCount: Int?
}
