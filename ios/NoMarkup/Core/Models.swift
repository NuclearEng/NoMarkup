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
        case "pending", "pending_payment", "scheduled", "review", "draft":
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

    /// Distance from the request browse center when the gateway returns `distance_km`.
    var distanceLabel: String? {
        guard let distanceKm else { return nil }
        if distanceKm < 1 {
            return String(format: "%.0f m away", distanceKm * 1000)
        }
        return String(format: "%.1f km away", distanceKm)
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

/// Nested node from `GET /api/v1/categories/tree`.
struct CategoryNode: Codable, Sendable, Hashable, Identifiable {
    let id: String
    var parentId: String?
    var name: String?
    var slug: String?
    var level: Int?
    var description: String?
    var icon: String?
    var sortOrder: Int?
    var active: Bool?
    var children: [CategoryNode]?

    var displayName: String {
        let n = name?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !n.isEmpty { return n }
        let s = slug?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return s.isEmpty ? id : s
    }

    /// Active children only (treat missing `active` as true).
    var activeChildren: [CategoryNode] {
        (children ?? []).filter { $0.active != false }
    }

    var hasActiveChildren: Bool {
        !activeChildren.isEmpty
    }
}

struct CategoryTreeResponse: Codable, Sendable {
    let categories: [CategoryNode]
}

// MARK: - Listings autocomplete

/// Row from `GET /api/v1/listings/autocomplete` — `type` is `"listing"` or `"category"`.
struct ListingAutocompleteSuggestion: Codable, Sendable, Hashable {
    var type: String?
    /// Listing UUID when `type == "listing"`.
    var id: String?
    var title: String?
    var categorySlug: String?
    /// Category display label when `type == "category"`.
    var label: String?
    var startingPriceCents: Int64?

    var isCategory: Bool {
        (type ?? "").lowercased() == "category"
    }

    var isListing: Bool {
        (type ?? "").lowercased() == "listing"
    }

    /// Stable identity for `ForEach` (categories have no listing id).
    var suggestionKey: String {
        if isListing {
            let listingID = id?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            if !listingID.isEmpty { return "listing:\(listingID)" }
            let t = title?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            return "listing-title:\(t)"
        }
        let slug = categorySlug?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !slug.isEmpty { return "category:\(slug)" }
        let lab = label?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return "category-label:\(lab)"
    }

    var displayLabel: String {
        if isCategory {
            let lab = label?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            if !lab.isEmpty { return lab }
            let slug = categorySlug?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            return slug.isEmpty ? "Category" : slug
        }
        let t = title?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return t.isEmpty ? "Listing" : t
    }

    var secondaryLabel: String? {
        if isCategory {
            let slug = categorySlug?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            return slug.isEmpty ? "Category" : "Category · \(slug)"
        }
        if let cents = startingPriceCents {
            return MoneyFormat.usd(cents: cents)
        }
        let slug = categorySlug?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return slug.isEmpty ? "Listing" : slug
    }
}

struct ListingsAutocompleteResponse: Codable, Sendable {
    var suggestions: [ListingAutocompleteSuggestion]?
}

// MARK: - Fair price (optional social proof)

/// `GET /api/v1/analytics/fair-price` — soft social proof; fails soft with `has_data=false`.
struct FairPriceResponse: Codable, Sendable {
    var hasData: Bool?
    var priceCents: Int64?
    var p25Cents: Int64?
    var p75Cents: Int64?
    var ciLoCents: Int64?
    var ciHiCents: Int64?
    var nEff: Double?
    var confidence: Double?
    var confidenceLabel: String?
    var levelUsed: Int?
    var modelVersion: String?

    init(
        hasData: Bool? = nil,
        priceCents: Int64? = nil,
        p25Cents: Int64? = nil,
        p75Cents: Int64? = nil,
        ciLoCents: Int64? = nil,
        ciHiCents: Int64? = nil,
        nEff: Double? = nil,
        confidence: Double? = nil,
        confidenceLabel: String? = nil,
        levelUsed: Int? = nil,
        modelVersion: String? = nil
    ) {
        self.hasData = hasData
        self.priceCents = priceCents
        self.p25Cents = p25Cents
        self.p75Cents = p75Cents
        self.ciLoCents = ciLoCents
        self.ciHiCents = ciHiCents
        self.nEff = nEff
        self.confidence = confidence
        self.confidenceLabel = confidenceLabel
        self.levelUsed = levelUsed
        self.modelVersion = modelVersion
    }

    var isUsable: Bool {
        hasData == true && (priceCents ?? 0) > 0
    }

    /// Short caption for form footers, e.g. "Market median ≈ $120 (p25–p75 $80–$160)".
    var hintCaption: String? {
        guard isUsable, let price = priceCents else { return nil }
        var parts: [String] = ["Market median ≈ \(MoneyFormat.usd(cents: price))"]
        if let lo = p25Cents, let hi = p75Cents, lo > 0, hi > 0 {
            parts.append("(p25–p75 \(MoneyFormat.usd(cents: lo))–\(MoneyFormat.usd(cents: hi)))")
        }
        if let label = confidenceLabel?.trimmingCharacters(in: .whitespacesAndNewlines), !label.isEmpty {
            parts.append("· \(label)")
        }
        return parts.joined(separator: " ")
    }
}

// MARK: - Market range API (`GET /api/v1/analytics/market/range`) — FR-11

/// Public market price band from the analytics service. Soft empty: `{ "has_data": false }`.
/// Wire fields: `low_cents` / `median_cents` / `high_cents` / `data_points` (sample size) / `source`.
/// (`source` is typically `"seeded"`, `"platform"`, or `"blended"`.)
struct MarketRangeResponse: Codable, Sendable, Equatable {
    var hasData: Bool?
    var categoryId: String?
    var subcategoryId: String?
    var serviceTypeId: String?
    var region: String?
    var lowCents: Int64?
    var medianCents: Int64?
    var highCents: Int64?
    var dataPoints: Int?
    var source: String?
    var confidence: Double?
    var computedAt: String?

    init(
        hasData: Bool? = nil,
        categoryId: String? = nil,
        subcategoryId: String? = nil,
        serviceTypeId: String? = nil,
        region: String? = nil,
        lowCents: Int64? = nil,
        medianCents: Int64? = nil,
        highCents: Int64? = nil,
        dataPoints: Int? = nil,
        source: String? = nil,
        confidence: Double? = nil,
        computedAt: String? = nil
    ) {
        self.hasData = hasData
        self.categoryId = categoryId
        self.subcategoryId = subcategoryId
        self.serviceTypeId = serviceTypeId
        self.region = region
        self.lowCents = lowCents
        self.medianCents = medianCents
        self.highCents = highCents
        self.dataPoints = dataPoints
        self.source = source
        self.confidence = confidence
        self.computedAt = computedAt
    }

    /// True when the gateway returned a usable low/high band (cents > 0).
    /// Median is optional — `displayMedianCents` fills midpoint when missing.
    var isUsable: Bool {
        guard hasData == true else { return false }
        guard let low = lowCents, let high = highCents, low > 0, high >= low else { return false }
        return true
    }

    /// Sample size alias (`data_points` on the wire).
    var sampleSize: Int {
        max(0, dataPoints ?? 0)
    }

    /// Display median: server median, else midpoint of low–high.
    var displayMedianCents: Int64 {
        if let mid = medianCents, mid > 0 { return mid }
        let low = lowCents ?? 0
        let high = highCents ?? low
        return low + (high - low) / 2
    }

    /// Seeded / industry guides (FR-11.2 disclaimer) vs platform transactions.
    var isIndustrySeeded: Bool {
        let s = (source ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return s == "seeded" || s == "industry" || s == "industry_data"
    }
}

// MARK: - Market range intelligence (job detail H1.4 / H1.5)

/// Provenance for the band shown when FPI may be empty — never claim index data we do not have.
enum MarketRangeSource: String, Sendable, Equatable {
    /// Fair-price index p25–p75 (or median) from the pricing analytics API.
    case marketIndex
    /// Client-side p25–p75 of recent public jobs' starting bids in the same category.
    case categorySample
    /// Heuristic 60%–100% of this job's starting bid (typical reverse-auction room).
    case reverseAuctionBand

    /// Strip title — honest about estimate vs index.
    var titleLabel: String {
        switch self {
        case .marketIndex: return "Market index"
        case .categorySample: return "Category sample (estimate)"
        case .reverseAuctionBand: return "Typical reverse-auction band"
        }
    }
}

/// Resolved low/high (and optional median) for the job-detail market intelligence strip.
struct MarketRangeEstimate: Sendable, Equatable {
    var lowCents: Int64
    var highCents: Int64
    var medianCents: Int64?
    var sampleCount: Int
    var source: MarketRangeSource

    /// e.g. "$80 – $160 · 12 jobs" or "$80 – $160 · 24 data pts".
    var rangeCaption: String {
        let band: String
        if lowCents == highCents {
            band = "Median ≈ \(MoneyFormat.usd(cents: lowCents))"
        } else {
            band = "\(MoneyFormat.usd(cents: lowCents)) – \(MoneyFormat.usd(cents: highCents))"
        }
        guard sampleCount > 0 else { return band }
        switch source {
        case .marketIndex:
            return "\(band) · \(sampleCount) data pts"
        case .categorySample:
            return "\(band) · \(sampleCount) jobs"
        case .reverseAuctionBand:
            return band
        }
    }
}

/// Pure helpers for building a showcase-style range without the pricing engine.
enum MarketRangeMath {
    /// Linear-interpolation percentile on a non-empty ascending sample. `p` in 0…1.
    static func percentileCents(sortedAscending values: [Int64], p: Double) -> Int64? {
        guard !values.isEmpty else { return nil }
        if values.count == 1 { return values[0] }
        let clamped = min(1, max(0, p))
        let idx = clamped * Double(values.count - 1)
        let lo = Int(idx.rounded(.down))
        let hi = Int(idx.rounded(.up))
        guard lo >= 0, hi < values.count else { return values.last }
        if lo == hi { return values[lo] }
        let weight = idx - Double(lo)
        let blended = Double(values[lo]) * (1 - weight) + Double(values[hi]) * weight
        return Int64(blended.rounded())
    }

    /// Analytics market/range → estimate when `isUsable` (low/median/high + data_points).
    static func fromMarketRange(_ range: MarketRangeResponse) -> MarketRangeEstimate? {
        guard range.isUsable,
              let lo = range.lowCents,
              let hi = range.highCents
        else {
            return nil
        }
        return MarketRangeEstimate(
            lowCents: lo,
            highCents: hi,
            medianCents: range.displayMedianCents,
            sampleCount: range.sampleSize,
            source: .marketIndex
        )
    }

    /// FPI → estimate when `isUsable` (p25–p75 preferred, else CI, else median-as-point).
    static func fromFairPrice(_ fair: FairPriceResponse) -> MarketRangeEstimate? {
        guard fair.isUsable else { return nil }
        let lo = fair.p25Cents ?? fair.ciLoCents
        let hi = fair.p75Cents ?? fair.ciHiCents
        let n = fair.nEff.map { Int($0.rounded()) } ?? 0
        if let lo, let hi, lo > 0, hi >= lo {
            return MarketRangeEstimate(
                lowCents: lo,
                highCents: hi,
                medianCents: fair.priceCents.flatMap { $0 > 0 ? $0 : nil },
                sampleCount: max(0, n),
                source: .marketIndex
            )
        }
        if let mid = fair.priceCents, mid > 0 {
            return MarketRangeEstimate(
                lowCents: mid,
                highCents: mid,
                medianCents: mid,
                sampleCount: max(0, n),
                source: .marketIndex
            )
        }
        return nil
    }

    /// Fair-price engine → market/range-shaped payload so the same bar can render either API.
    /// Maps p25 → low, price (p50) → median, p75 → high, n_eff → data_points.
    static func marketRangeResponse(from fair: FairPriceResponse) -> MarketRangeResponse? {
        guard fair.isUsable else { return nil }
        let lo = fair.p25Cents ?? fair.ciLoCents
        let hi = fair.p75Cents ?? fair.ciHiCents
        let mid = fair.priceCents
        let n = fair.nEff.map { Int($0.rounded()) } ?? 0
        if let lo, let hi, lo > 0, hi >= lo {
            return MarketRangeResponse(
                hasData: true,
                lowCents: lo,
                medianCents: mid.flatMap { $0 > 0 ? $0 : nil } ?? (lo + (hi - lo) / 2),
                highCents: hi,
                dataPoints: max(0, n),
                source: "platform",
                confidence: fair.confidence
            )
        }
        if let mid, mid > 0 {
            return MarketRangeResponse(
                hasData: true,
                lowCents: mid,
                medianCents: mid,
                highCents: mid,
                dataPoints: max(0, n),
                source: "platform",
                confidence: fair.confidence
            )
        }
        return nil
    }

    /// p25–p75 of public jobs' starting bids (same category). Needs ≥2 positive samples; caps at `maxSample`.
    /// Input order is treated as recency (API page order); only then sorted for percentiles.
    static func fromCategoryStartingBids(
        _ bids: [Int64],
        maxSample: Int = 20
    ) -> MarketRangeEstimate? {
        let positive = bids.filter { $0 > 0 }
        guard positive.count >= 2 else { return nil }
        let capped = Array(positive.prefix(max(2, maxSample)))
        let sample = capped.sorted()
        guard
            let lo = percentileCents(sortedAscending: sample, p: 0.25),
            let hi = percentileCents(sortedAscending: sample, p: 0.75),
            lo > 0,
            hi >= lo
        else {
            return nil
        }
        let mid = percentileCents(sortedAscending: sample, p: 0.5)
        return MarketRangeEstimate(
            lowCents: lo,
            highCents: hi,
            medianCents: mid,
            sampleCount: sample.count,
            source: .categorySample
        )
    }

    /// Documented estimate: 60%–100% of starting bid (room for reverse-auction discovery).
    static func reverseAuctionBand(startingBidCents: Int64) -> MarketRangeEstimate? {
        guard startingBidCents > 0 else { return nil }
        let high = startingBidCents
        let low = max(1, (startingBidCents * 60) / 100)
        guard low <= high else { return nil }
        return MarketRangeEstimate(
            lowCents: low,
            highCents: high,
            medianCents: nil,
            sampleCount: 0,
            source: .reverseAuctionBand
        )
    }
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
    /// Present on owner-scoped mine list when the job is tied to a saved property (FR-19).
    var propertyId: String? = nil
    var title: String?
    var description: String?
    var status: String?
    var scheduleType: String?
    var isRecurring: Bool?
    /// weekly | biweekly | monthly when `isRecurring` (FR-18.1).
    var recurrenceFrequency: String? = nil
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
    /// FR-10.7: present when browse was geo-scoped (`latitude`/`longitude` query).
    var distanceKm: Double?

    var displayTitle: String {
        let t = title?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return t.isEmpty ? "Untitled job" : t
    }

    var distanceLabel: String? {
        guard let distanceKm else { return nil }
        if distanceKm < 1 {
            return String(format: "%.0f m away", distanceKm * 1000)
        }
        return String(format: "%.1f km away", distanceKm)
    }

    var normalizedStatus: String {
        (status ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }

    /// Live auction or work currently in progress (property dashboard "active").
    var isActiveWork: Bool {
        switch normalizedStatus {
        case "active", "open", "live", "bidding", "in_progress":
            return true
        default:
            return false
        }
    }

    /// Awarded / contract pending — scheduled or soon-to-start work (property dashboard "upcoming").
    var isUpcomingWork: Bool {
        switch normalizedStatus {
        case "awarded", "contract_pending":
            return true
        default:
            return false
        }
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

    /// Human label for recurrence when the job is recurring.
    var recurrenceLabel: String? {
        guard isRecurring == true else { return nil }
        let f = recurrenceFrequency?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if f.isEmpty { return "Yes" }
        return StatusChipStyle.displayLabel(f)
    }
}

/// Detail from `GET /api/v1/jobs/{id}` (`{ "job": ... }`).
///
/// `exactAddress` is server-gated: only job owner or awarded provider receive it.
/// Never surface street-level address from approximate fields alone.
struct JobDetail: Codable, Sendable, Hashable, Identifiable {
    let id: String
    var customerId: String?
    var propertyId: String?
    var title: String?
    var description: String?
    var status: String?
    var scheduleType: String?
    var isRecurring: Bool?
    /// weekly | biweekly | monthly when `isRecurring` (FR-18.1).
    var recurrenceFrequency: String? = nil
    var auctionDurationHours: Int?
    var bidCount: Int?
    var repostCount: Int?
    var categoryId: String?
    var categoryName: String?
    var categorySlug: String?
    var approximateAddress: JobApproximateAddress?
    /// Party-only street address (owner / awarded provider). Absent for public viewers.
    var exactAddress: JobExactAddress?
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

    /// Public-safe area label (city/state). Never a full street for non-parties.
    var locationLabel: String? {
        approximateAddress?.label
    }

    /// Exact single-line address when the server included `exact_address` for this caller.
    var exactLocationLabel: String? {
        exactAddress?.singleLine
    }

    /// True when Get Directions should be offered (authorized exact address present).
    var canOfferDirections: Bool {
        exactAddress?.isDirectionsReady == true
    }

    /// Human label for recurrence when the job is recurring.
    var recurrenceLabel: String? {
        guard isRecurring == true else { return nil }
        let f = recurrenceFrequency?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if f.isEmpty { return "Yes" }
        return StatusChipStyle.displayLabel(f)
    }

    init(from summary: JobSummary) {
        id = summary.id
        customerId = summary.customerId
        propertyId = summary.propertyId
        title = summary.title
        description = summary.description
        status = summary.status
        scheduleType = summary.scheduleType
        isRecurring = summary.isRecurring
        recurrenceFrequency = summary.recurrenceFrequency
        auctionDurationHours = summary.auctionDurationHours
        bidCount = summary.bidCount
        repostCount = summary.repostCount
        categoryId = summary.categoryId
        categoryName = summary.categoryName
        categorySlug = summary.categorySlug
        approximateAddress = summary.approximateAddress
        exactAddress = nil
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

/// Authenticated `GET /api/v1/jobs/drafts` — unpublished jobs owned by the customer.
/// Drafts use the same job row shape as the public list (`JobSummary`).
struct JobDraftsResponse: Codable, Sendable {
    let drafts: [JobSummary]
}

// MARK: - Chat

/// Preview / last message embedded on a channel, or a row from messages list.
struct ChatMessage: Codable, Sendable, Hashable, Identifiable {
    let id: String
    var channelId: String?
    var senderId: String?
    var messageType: String?
    var content: String?
    /// Gateway projects proto `is_read`. Domain→proto currently does not populate it
    /// (always false on the wire); iOS still honors `true` if a future path sets it.
    var isRead: Bool?
    var createdAt: String?

    /// Normalized message_type from gateway (`text` | `image` | `file` | `system` |
    /// `contact_share` | `proposed_terms` | `terms_accepted` | `terms_rejected`).
    /// Unknown values fall through to text rendering.
    var normalizedType: String {
        (messageType ?? "text").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }

    var isImageMessage: Bool { normalizedType == "image" }

    /// File / PDF attachment (`message_type == file`). Composer uploads via
    /// imaging `chat_attachment` context (PDF pass-through).
    var isFileMessage: Bool { normalizedType == "file" }

    /// Opt-in contact share system card (`message_type == contact_share`).
    /// FR-8.8: posted via `POST /channels/{id}/share-contact` (ShareContactInfo).
    var isContactShareMessage: Bool { normalizedType == "contact_share" }

    /// System-style centered pills: platform system + local-terms accept/reject outcomes.
    var isSystemMessage: Bool {
        switch normalizedType {
        case "system", "terms_accepted", "terms_rejected":
            return true
        default:
            return false
        }
    }

    /// Local-terms proposal (FR-8.9 / FR-5.4). Web encodes as a plain text body that
    /// starts with `[Proposed Terms]`; native path uses `message_type=proposed_terms`
    /// via `POST …/proposed-terms`. Content prefix remains the portable detector.
    var isProposedTermsMessage: Bool {
        if normalizedType == "proposed_terms" { return true }
        let raw = content?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return raw.hasPrefix("[Proposed Terms]")
    }

    /// Parsed local-terms fields when `isProposedTermsMessage` (web `parseProposedTerms` parity).
    var parsedProposedTerms: ProposedTermsPayload? {
        ProposedTermsPayload.parse(content: content)
    }

    /// Inbox / accessibility body. Image/file never surface raw CDN URLs in lists.
    var displayBody: String {
        if isProposedTermsMessage {
            if let terms = parsedProposedTerms, !terms.amount.isEmpty {
                return "Proposed terms · \(terms.amount)"
            }
            return "Proposed terms"
        }
        switch normalizedType {
        case "image":
            return "Photo"
        case "file":
            return "File"
        case "system", "terms_accepted", "terms_rejected":
            let raw = content?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            if !raw.isEmpty { return raw }
            if normalizedType == "terms_accepted" { return "Terms accepted" }
            if normalizedType == "terms_rejected" { return "Terms rejected" }
            return "System message"
        case "contact_share":
            return "Contact shared"
        default:
            let raw = content?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            return raw.isEmpty ? "Message" : raw
        }
    }

    /// HTTPS (or local-dev HTTP) image URL when `message_type == image` and content is a plain absolute URL.
    /// Never returns non-http(s) schemes (no `javascript:`, `data:`, HTML).
    /// Prefer URLs from our imaging upload pipeline (`confirmed_url`); arbitrary http(s) may still
    /// decode but the composer only attaches via `ImageUploader`.
    var safeImageURL: URL? {
        guard isImageMessage else { return nil }
        return Self.safeHTTPURL(from: content)
    }

    /// Absolute http(s) URL for `file` messages when content is a plain URL (no HTML).
    var safeFileURL: URL? {
        guard isFileMessage else { return nil }
        return Self.safeHTTPURL(from: content)
    }

    /// Shared safe absolute http(s) parse for image/file message content.
    private static func safeHTTPURL(from content: String?) -> URL? {
        let raw = content?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !raw.isEmpty, raw.count <= 2000 else { return nil }
        // Reject whitespace / angle brackets that would indicate HTML injection attempts.
        guard !raw.contains(where: { $0.isWhitespace || $0 == "<" || $0 == ">" }) else { return nil }
        guard let url = URL(string: raw),
              let scheme = url.scheme?.lowercased(),
              scheme == "https" || scheme == "http",
              let host = url.host, !host.isEmpty
        else { return nil }
        return url
    }

    /// Case-insensitive match for in-thread search (local filter on loaded messages).
    func matchesSearch(_ query: String) -> Bool {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !q.isEmpty else { return true }
        if displayBody.localizedCaseInsensitiveContains(q) { return true }
        if let content, content.localizedCaseInsensitiveContains(q) { return true }
        if normalizedType.localizedCaseInsensitiveContains(q) { return true }
        return false
    }
}

/// Summary row from `GET /api/v1/channels` / `GET /api/v1/channels/{id}`.
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
    /// MarkRead watermark for the customer party (ISO-8601). Used for peer read receipts.
    var customerLastReadAt: String?
    /// MarkRead watermark for the provider party (ISO-8601). Used for peer read receipts.
    var providerLastReadAt: String?

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

    /// Peer's MarkRead watermark relative to `viewerUserID` (customer vs provider).
    /// Nil when the viewer isn't a known party or the peer has never marked read.
    func peerLastReadAt(viewerUserID: String?) -> String? {
        let me = viewerUserID?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !me.isEmpty else { return nil }
        let customer = customerId?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let provider = providerId?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if me == customer {
            return providerLastReadAt
        }
        if me == provider {
            return customerLastReadAt
        }
        return nil
    }
}

struct ChatChannelsResponse: Codable, Sendable {
    let channels: [ChatChannelSummary]
    let pagination: PaginationMeta?
}

struct ChatMessagesResponse: Codable, Sendable {
    let messages: [ChatMessage]
}

/// Structured local-terms proposal embedded in a chat message body (web FR-8.9 shape).
///
/// Wire format (plain text, not JSON metadata on REST today):
/// ```
/// [Proposed Terms]
/// Payment Type: milestone
/// Amount: $1,500
/// Milestones:
/// Demo - $500
/// Description: Roof patch
/// ```
struct ProposedTermsPayload: Equatable, Sendable {
    var paymentType: String
    var amount: String
    var milestones: String?
    var description: String

    static func parse(content: String?) -> ProposedTermsPayload? {
        let raw = content?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard raw.hasPrefix("[Proposed Terms]") else { return nil }

        var paymentType = ""
        var amount = ""
        var description = ""
        var inMilestones = false
        var milestoneLines: [String] = []

        for line in raw.split(separator: "\n", omittingEmptySubsequences: false).map(String.init) {
            if line.hasPrefix("Payment Type: ") {
                paymentType = String(line.dropFirst("Payment Type: ".count))
                inMilestones = false
            } else if line.hasPrefix("Amount: ") {
                amount = String(line.dropFirst("Amount: ".count))
                inMilestones = false
            } else if line.hasPrefix("Milestones:") {
                inMilestones = true
            } else if line.hasPrefix("Description: ") {
                description = String(line.dropFirst("Description: ".count))
                inMilestones = false
            } else if inMilestones {
                let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
                if !trimmed.isEmpty {
                    milestoneLines.append(trimmed)
                }
            }
        }

        return ProposedTermsPayload(
            paymentType: paymentType,
            amount: amount,
            milestones: milestoneLines.isEmpty ? nil : milestoneLines.joined(separator: "\n"),
            description: description
        )
    }
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

    /// Buyer or seller may leave a goods review after escrow is released (14-day window enforced server-side).
    func canLeaveReview(userId: String?) -> Bool {
        guard let userId, !userId.isEmpty else { return false }
        guard buyerId == userId || sellerId == userId else { return false }
        return normalizedEscrow == "released"
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

    /// Primary next step for the signed-in party (goods escrow is released only
    /// after mutual pickup confirm on the server — not via `/payments/.../release`).
    func nextActionCaption(userId: String?) -> String? {
        if needsPayment {
            return "Next: pay with Apple Pay (or card). Funds are held in escrow until pickup."
        }
        if canConfirmPickupAsBuyer(userId: userId) {
            return "Next: confirm pickup after you receive the goods."
        }
        if canSellerConfirm(userId: userId) {
            if normalizedEscrow == "pickup_confirmed" {
                return "Next: seller confirm to finish the handshake and release escrow."
            }
            return "Next: seller confirm when the buyer takes possession (or wait for buyer confirm)."
        }
        guard let userId, !userId.isEmpty else { return nil }
        switch normalizedEscrow {
        case "held":
            if buyerId == userId {
                return "Next: confirm pickup after you receive the goods."
            }
            if sellerId == userId {
                return "Waiting for buyer pickup confirmation — you can also seller-confirm."
            }
        case "pickup_confirmed":
            if buyerId == userId {
                return "Waiting for the seller to confirm handoff. Escrow releases when both sides confirm."
            }
            if sellerId == userId {
                return "Next: seller confirm to release escrow to you."
            }
        case "released":
            return "Escrow released — leave a review while the window is open."
        case "disputed":
            return "Order is under dispute. Support reviews escrow."
        default:
            break
        }
        return nil
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

// MARK: - Goods order reviews (FE-14)

/// `GET /api/v1/orders/{id}/reviews/eligibility`
struct ListingOrderReviewEligibility: Decodable, Sendable, Hashable {
    var eligible: Bool?
    var alreadyReviewed: Bool?
    var reviewWindowClosesAt: String?

    var isEligible: Bool { eligible == true }

    var blockedReason: String? {
        if alreadyReviewed == true {
            return "You already left a review for this order."
        }
        if eligible == true {
            return nil
        }
        if let closes = reviewWindowClosesAt, !closes.isEmpty {
            return "Not eligible to review (window closes \(CatalogDateFormat.friendlyDateTime(closes)))."
        }
        return "Order must be completed (escrow released) and within the 14-day review window."
    }
}

/// Published goods order review (`listing_order_reviews`).
struct ListingOrderReview: Decodable, Sendable, Hashable, Identifiable {
    let id: String
    var orderId: String?
    var listingId: String?
    var reviewerId: String?
    var revieweeId: String?
    var reviewerRole: String?
    var overallRating: Int?
    var comment: String?
    var status: String?
    var reviewWindowEndsAt: String?
    var createdAt: String?

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeIfPresent(String.self, forKey: .id) ?? UUID().uuidString
        orderId = try c.decodeIfPresent(String.self, forKey: .orderId)
        listingId = try c.decodeIfPresent(String.self, forKey: .listingId)
        reviewerId = try c.decodeIfPresent(String.self, forKey: .reviewerId)
        revieweeId = try c.decodeIfPresent(String.self, forKey: .revieweeId)
        reviewerRole = try c.decodeIfPresent(String.self, forKey: .reviewerRole)
        if let v = try? c.decodeIfPresent(Int.self, forKey: .overallRating) {
            overallRating = v
        } else if let v = try? c.decodeIfPresent(Int32.self, forKey: .overallRating) {
            overallRating = Int(v)
        } else {
            overallRating = nil
        }
        // Gateway uses "comment" on create response; list may use review_text → reviewText.
        if let text = try c.decodeIfPresent(String.self, forKey: .comment) {
            comment = text
        } else {
            comment = try c.decodeIfPresent(String.self, forKey: .reviewText)
        }
        status = try c.decodeIfPresent(String.self, forKey: .status)
        reviewWindowEndsAt = try c.decodeIfPresent(String.self, forKey: .reviewWindowEndsAt)
        createdAt = try c.decodeIfPresent(String.self, forKey: .createdAt)
    }

    enum CodingKeys: String, CodingKey {
        case id, orderId, listingId, reviewerId, revieweeId, reviewerRole
        case overallRating, comment, reviewText, status, reviewWindowEndsAt, createdAt
    }
}

struct ListingOrderReviewsResponse: Decodable, Sendable {
    var reviews: [ListingOrderReview]

    init(from decoder: Decoder) throws {
        if let arr = try? decoder.singleValueContainer().decode([ListingOrderReview].self) {
            reviews = arr
            return
        }
        let c = try decoder.container(keyedBy: CodingKeys.self)
        reviews = try c.decodeIfPresent([ListingOrderReview].self, forKey: .reviews) ?? []
    }

    enum CodingKeys: String, CodingKey { case reviews }
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

    /// Live negotiation states that may still transition (gateway + display).
    var isActionable: Bool {
        self == .pending || self == .countered
    }

    /// Terminal chain states (no further accept/reject/counter/withdraw).
    var isTerminal: Bool {
        switch self {
        case .accepted, .rejected, .withdrawn, .expired, .unknown:
            return true
        case .pending, .countered:
            return false
        }
    }
}

/// PATCH action for `PATCH /api/v1/offers/{id}`.
enum ListingOfferAction: String, Sendable {
    case accept
    case reject
    case counter
    case withdraw
}

/// Which participant a live offer currently awaits (depth parity rule).
/// Even depth (0, 2, …) = buyer's proposal → awaits **seller**.
/// Odd depth (1, 3, …) = seller's counter → awaits **buyer**.
enum ListingOfferAwaitingParty: String, Sendable {
    case buyer
    case seller
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

/// `PATCH /api/v1/offers/{id}` body — accept may also mint a `listing_orders` row
/// and (only when the **buyer** accepts a counter) return the buyer's PI secret.
struct UpdateListingOfferResponse: Codable, Sendable {
    var offer: ListingOffer?
    var orderId: String?
    var parentOffer: ListingOffer?
    var clientSecret: String?
    var paymentIntentId: String?
    var paymentRequired: Bool?
    var totalCents: Int64?
    var escrowStatus: String?
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

// MARK: - Best-Offer depth helpers (mirror web `useOffers.ts`)

enum ListingOfferChain {
    /// Reconstruct chain depth from `parent_offer_id` walks (root buyer offer = 0).
    static func depths(for offers: [ListingOffer]) -> [String: Int] {
        let byId = Dictionary(uniqueKeysWithValues: offers.map { ($0.id, $0) })
        var cache: [String: Int] = [:]

        func depthOf(_ offer: ListingOffer, seen: inout Set<String>) -> Int {
            if let cached = cache[offer.id] { return cached }
            guard let parentId = offer.parentOfferId, !parentId.isEmpty else {
                cache[offer.id] = 0
                return 0
            }
            if seen.contains(offer.id) {
                cache[offer.id] = 0
                return 0
            }
            guard let parent = byId[parentId] else {
                cache[offer.id] = 0
                return 0
            }
            seen.insert(offer.id)
            let d = depthOf(parent, seen: &seen) + 1
            cache[offer.id] = d
            return d
        }

        for offer in offers {
            var seen = Set<String>()
            _ = depthOf(offer, seen: &seen)
        }
        return cache
    }

    /// Even depth awaits seller; odd depth awaits buyer.
    static func awaitingParty(depth: Int) -> ListingOfferAwaitingParty {
        depth % 2 == 1 ? .buyer : .seller
    }

    static func awaitingParty(for offer: ListingOffer, in offers: [ListingOffer]) -> ListingOfferAwaitingParty {
        let d = depths(for: offers)[offer.id] ?? 0
        return awaitingParty(depth: d)
    }
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

/// Nested `trust_score` on bid ladder / provider cards.
/// Full endpoint returns all four dimensions; ladder may send overall + tier only.
struct ProviderTrustScore: Codable, Sendable, Hashable {
    var overallScore: Double?
    var tier: String?
    var feedbackScore: Double?
    var riskScore: Double?
    var volumeScore: Double?
    var fraudScore: Double?
    var dataPoints: Int?
    var computedAt: String?
    var userId: String?

    init(
        overallScore: Double? = nil,
        tier: String? = nil,
        feedbackScore: Double? = nil,
        riskScore: Double? = nil,
        volumeScore: Double? = nil,
        fraudScore: Double? = nil,
        dataPoints: Int? = nil,
        computedAt: String? = nil,
        userId: String? = nil
    ) {
        self.overallScore = overallScore
        self.tier = tier
        self.feedbackScore = feedbackScore
        self.riskScore = riskScore
        self.volumeScore = volumeScore
        self.fraudScore = fraudScore
        self.dataPoints = dataPoints
        self.computedAt = computedAt
        self.userId = userId
    }

    /// 0…1 overall score when present (clamps values already on a 0…100 scale).
    var normalizedScore: Double? {
        TrustScoreScale.normalized(overallScore)
    }

    var displayTier: String {
        TrustScoreScale.displayTier(tier)
    }

    /// Composite 0–100 label for compact chips (e.g. bid ladder).
    var displayOverallPoints: String {
        TrustScoreScale.displayPoints(overallScore)
    }

    /// True when any of the four weighted dimensions arrived on the wire.
    var hasDimensionBreakdown: Bool {
        feedbackScore != nil || riskScore != nil || volumeScore != nil || fraudScore != nil
    }
}

// MARK: - Full user trust score (GET /users/{id}/trust-score)

/// Showcase weights: Feedback 35%, Risk 25%, Volume 20%, Fraud 20%.
enum TrustScoreWeights {
    static let feedback: Double = 0.35
    static let risk: Double = 0.25
    static let volume: Double = 0.20
    static let fraud: Double = 0.20

    static let feedbackPercentLabel = "35%"
    static let riskPercentLabel = "25%"
    static let volumePercentLabel = "20%"
    static let fraudPercentLabel = "20%"
}

/// Shared 0…1 ↔ 0…100 display helpers for trust scores.
enum TrustScoreScale {
    /// Normalize a raw score to 0…1. Values already on 0…100 are divided by 100.
    static func normalized(_ raw: Double?) -> Double? {
        guard let raw else { return nil }
        if raw.isNaN || raw.isInfinite { return nil }
        if raw > 1.0 {
            return min(1.0, max(0.0, raw / 100.0))
        }
        return min(1.0, max(0.0, raw))
    }

    /// Display as integer points on a 0–100 scale.
    static func displayPoints(_ raw: Double?) -> String {
        guard let n = normalized(raw) else { return "—" }
        let points = (n * 100.0).rounded()
        return String(format: "%.0f", points)
    }

    /// Display as "78" or "78/100" style label.
    static func displayPointsOutOf100(_ raw: Double?) -> String {
        let pts = displayPoints(raw)
        return pts == "—" ? "—" : "\(pts)"
    }

    static func displayTier(_ tier: String?) -> String {
        let t = tier?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return t.isEmpty ? "—" : t.replacingOccurrences(of: "_", with: " ").capitalized
    }
}

/// Full breakdown from `GET /api/v1/users/{id}/trust-score`.
/// Scores are 0…1 on the wire; UI shows 0–100.
struct UserTrustScore: Codable, Sendable, Hashable {
    var userId: String?
    var overallScore: Double?
    var feedbackScore: Double?
    var riskScore: Double?
    var volumeScore: Double?
    var fraudScore: Double?
    var tier: String?
    var computedAt: String?
    var dataPoints: Int?

    var displayTier: String {
        TrustScoreScale.displayTier(tier)
    }

    var displayOverall: String {
        TrustScoreScale.displayPoints(overallScore)
    }

    var displayFeedback: String {
        TrustScoreScale.displayPoints(feedbackScore)
    }

    var displayRisk: String {
        TrustScoreScale.displayPoints(riskScore)
    }

    var displayVolume: String {
        TrustScoreScale.displayPoints(volumeScore)
    }

    var displayFraud: String {
        TrustScoreScale.displayPoints(fraudScore)
    }

    var normalizedOverall: Double {
        TrustScoreScale.normalized(overallScore) ?? 0
    }

    var normalizedFeedback: Double {
        TrustScoreScale.normalized(feedbackScore) ?? 0
    }

    var normalizedRisk: Double {
        TrustScoreScale.normalized(riskScore) ?? 0
    }

    var normalizedVolume: Double {
        TrustScoreScale.normalized(volumeScore) ?? 0
    }

    var normalizedFraud: Double {
        TrustScoreScale.normalized(fraudScore) ?? 0
    }

    var computedAtLabel: String? {
        guard let computedAt, !computedAt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return nil
        }
        return CatalogDateFormat.friendlyDateTime(computedAt)
    }

    /// Four showcase dimensions in display order with weights.
    var dimensions: [TrustScoreDimension] {
        [
            TrustScoreDimension(
                id: "feedback",
                title: "Feedback",
                weightLabel: TrustScoreWeights.feedbackPercentLabel,
                weight: TrustScoreWeights.feedback,
                normalized: normalizedFeedback,
                displayPoints: displayFeedback,
                systemImage: "star.bubble"
            ),
            TrustScoreDimension(
                id: "risk",
                title: "Risk",
                weightLabel: TrustScoreWeights.riskPercentLabel,
                weight: TrustScoreWeights.risk,
                normalized: normalizedRisk,
                displayPoints: displayRisk,
                systemImage: "shield.lefthalf.filled"
            ),
            TrustScoreDimension(
                id: "volume",
                title: "Volume",
                weightLabel: TrustScoreWeights.volumePercentLabel,
                weight: TrustScoreWeights.volume,
                normalized: normalizedVolume,
                displayPoints: displayVolume,
                systemImage: "chart.bar.fill"
            ),
            TrustScoreDimension(
                id: "fraud",
                title: "Fraud",
                weightLabel: TrustScoreWeights.fraudPercentLabel,
                weight: TrustScoreWeights.fraud,
                normalized: normalizedFraud,
                displayPoints: displayFraud,
                systemImage: "exclamationmark.shield"
            ),
        ]
    }
}

/// One weighted dimension row for the trust breakdown UI.
struct TrustScoreDimension: Identifiable, Sendable, Hashable {
    let id: String
    let title: String
    let weightLabel: String
    let weight: Double
    let normalized: Double
    let displayPoints: String
    let systemImage: String
}

/// Snapshot from `GET /api/v1/users/{id}/trust-history`.
struct UserTrustHistorySnapshot: Codable, Sendable, Hashable, Identifiable {
    var changeReason: String?
    var recordedAt: String?
    var score: UserTrustScore?
    var previousOverall: Double?
    var previousTier: String?

    var id: String {
        let at = recordedAt ?? ""
        let reason = changeReason ?? ""
        let overall = score.flatMap { $0.overallScore.map { String($0) } } ?? ""
        let key = "\(at)|\(reason)|\(overall)"
        return key == "||" ? "snapshot" : key
    }

    var recordedAtLabel: String {
        guard let recordedAt, !recordedAt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return "—"
        }
        return CatalogDateFormat.friendlyDateTime(recordedAt)
    }

    var displayReason: String {
        let r = changeReason?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return r.isEmpty ? "Score update" : r.replacingOccurrences(of: "_", with: " ").capitalized
    }

    var displayOverall: String {
        if let score {
            return score.displayOverall
        }
        return "—"
    }
}

struct UserTrustHistoryResponse: Codable, Sendable {
    var snapshots: [UserTrustHistorySnapshot]
    var pagination: PaginationMeta?

    enum CodingKeys: String, CodingKey {
        case snapshots
        case pagination
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        snapshots = try c.decodeIfPresent([UserTrustHistorySnapshot].self, forKey: .snapshots) ?? []
        pagination = try c.decodeIfPresent(PaginationMeta.self, forKey: .pagination)
    }
}

/// FR-4.5 verification badge chip from bid ladder payload (`badges[]`).
struct BidVerificationBadge: Codable, Sendable, Hashable {
    var documentType: String?
    var status: String?
    var verifiedAt: String?
    var expiresAt: String?

    /// Short label for a capsule chip (e.g. "ID", "License", "Insurance").
    var displayShortLabel: String {
        let raw = (documentType ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        switch raw {
        case "drivers_license", "driver_license", "id", "government_id":
            return "ID"
        case "business_license":
            return "Business"
        case "trade_license":
            return "License"
        case "insurance":
            return "Insurance"
        case "ein", "ein_tin":
            return "EIN"
        default:
            if raw.isEmpty { return "Verified" }
            return raw.replacingOccurrences(of: "_", with: " ").capitalized
        }
    }

    var isVerified: Bool {
        let s = (status ?? "verified").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return s.isEmpty || s == "verified"
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
    /// FR-4.5/4.6: optional review summary when gateway projects it.
    var averageRating: Double?
    var reviewCount: Int?
    /// FR-4.5: verified document badges when gateway projects them.
    var badges: [BidVerificationBadge]?

    var id: String {
        bid?.id ?? UUID().uuidString
    }

    /// Verified badges only — empty when payload has none (UI skips).
    var verifiedBadges: [BidVerificationBadge] {
        (badges ?? []).filter(\.isVerified)
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
            let tierLabel = trustScore?.displayTier ?? tier
            if let points = trustScore?.displayOverallPoints, points != "—" {
                return "\(points) · \(tierLabel)"
            }
            return tierLabel
        }
        if let points = trustScore?.displayOverallPoints, points != "—" {
            return points
        }
        if let v = trustScoreValue {
            return TrustScoreScale.displayPoints(v)
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
        case badges
    }

    private enum ReviewSummaryKeys: String, CodingKey {
        case averageRating
        case avgRating
        case rating
        case reviewCount
        case count
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

        averageRating = nil
        reviewCount = nil
        if c.contains(.reviewSummary),
           let nested = try? c.nestedContainer(keyedBy: ReviewSummaryKeys.self, forKey: .reviewSummary)
        {
            if let d = try? nested.decodeIfPresent(Double.self, forKey: .averageRating) {
                averageRating = d
            } else if let d = try? nested.decodeIfPresent(Double.self, forKey: .avgRating) {
                averageRating = d
            } else if let d = try? nested.decodeIfPresent(Double.self, forKey: .rating) {
                averageRating = d
            }
            if let n = try? nested.decodeIfPresent(Int.self, forKey: .reviewCount) {
                reviewCount = n
            } else if let n = try? nested.decodeIfPresent(Int.self, forKey: .count) {
                reviewCount = n
            }
        }

        // FR-4.5 — optional badges array; missing/null → nil (skip UI chips).
        if c.contains(.badges),
           let list = try? c.decodeIfPresent([BidVerificationBadge].self, forKey: .badges),
           !list.isEmpty
        {
            badges = list
        } else {
            badges = nil
        }
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encodeIfPresent(bid, forKey: .bid)
        try c.encodeIfPresent(providerDisplayName, forKey: .providerDisplayName)
        try c.encodeIfPresent(providerBusinessName, forKey: .providerBusinessName)
        try c.encodeIfPresent(providerAvatarUrl, forKey: .providerAvatarUrl)
        try c.encodeIfPresent(jobsCompleted, forKey: .jobsCompleted)
        try c.encodeIfPresent(trustScore, forKey: .trustScore)
        try c.encodeIfPresent(badges, forKey: .badges)
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

// MARK: - Live auction state / events (optional light poll)

/// One bid-activity row from `GET …/auction/events` (or `recent_events` on state).
/// All fields optional — gateway may emit snake_case, camelCase, or proto timestamps.
struct AuctionEvent: Decodable, Sendable, Hashable, Identifiable {
    var jobId: String?
    var amountCents: Int64?
    var eventType: String?
    var createdAt: String?

    /// Stable list identity when the wire payload has no `id` (proto omits it).
    var id: String {
        let type = eventType ?? ""
        let amount = amountCents.map(String.init) ?? ""
        let when = createdAt ?? ""
        let job = jobId ?? ""
        return "\(when)|\(type)|\(amount)|\(job)"
    }

    init(
        jobId: String? = nil,
        amountCents: Int64? = nil,
        eventType: String? = nil,
        createdAt: String? = nil
    ) {
        self.jobId = jobId
        self.amountCents = amountCents
        self.eventType = eventType
        self.createdAt = createdAt
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        jobId = try c.decodeIfPresent(String.self, forKey: .jobId)
        amountCents = Self.decodeInt64(c, forKey: .amountCents)
        eventType = try c.decodeIfPresent(String.self, forKey: .eventType)
        createdAt = Self.decodeTimestampString(c, forKey: .createdAt)
    }

    /// Human label for `event_type` (`bid_placed`, `bid_updated`, `bid_withdrawn`, …).
    var displayEventLabel: String {
        let raw = (eventType ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        switch raw {
        case "bid_placed", "placed":
            return "Bid placed"
        case "bid_updated", "updated":
            return "Bid updated"
        case "bid_withdrawn", "withdrawn":
            return "Bid withdrawn"
        case "auction_ended", "ended":
            return "Auction ended"
        case "snipe_extension", "extended":
            return "Time extended"
        case "":
            return "Activity"
        default:
            return raw
                .replacingOccurrences(of: "_", with: " ")
                .capitalized
        }
    }

    private enum CodingKeys: String, CodingKey {
        case jobId
        case amountCents
        case eventType
        case createdAt
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

    /// Accepts ISO-8601 string, unix seconds, or nested `{ "seconds": N }` protobuf JSON.
    private static func decodeTimestampString(
        _ c: KeyedDecodingContainer<CodingKeys>,
        forKey key: CodingKeys
    ) -> String? {
        LiveAuctionJSON.decodeTimestampString(c, forKey: key)
    }
}

/// Flexible wrapper for `GET /api/v1/jobs/{id}/auction/events`.
/// Gateway currently writes a bare JSON array; also accepts `{ "events": [...] }`.
struct AuctionEventsPayload: Decodable, Sendable {
    var events: [AuctionEvent]

    init(events: [AuctionEvent] = []) {
        self.events = events
    }

    init(from decoder: Decoder) throws {
        if var unkeyed = try? decoder.unkeyedContainer() {
            var items: [AuctionEvent] = []
            while !unkeyed.isAtEnd {
                if let event = try? unkeyed.decode(AuctionEvent.self) {
                    items.append(event)
                } else if (try? unkeyed.decode(FlexibleJSONValue.self)) != nil {
                    continue
                } else {
                    break
                }
            }
            events = items
            return
        }

        let c = try decoder.container(keyedBy: CodingKeys.self)
        if let list = try? c.decodeIfPresent([AuctionEvent].self, forKey: .events) {
            events = list
        } else if let list = try? c.decodeIfPresent([AuctionEvent].self, forKey: .recentEvents) {
            events = list
        } else {
            events = []
        }
    }

    private enum CodingKeys: String, CodingKey {
        case events
        case recentEvents
    }
}

/// Snapshot from `GET /api/v1/jobs/{id}/auction/state`.
/// All fields optional — proto/JSON shapes vary and the endpoint may be gated.
struct LiveAuctionState: Decodable, Sendable, Hashable {
    var jobId: String?
    var lowestBidCents: Int64?
    var bidCount: Int?
    var auctionEndsAt: String?
    var snipeExtensionCount: Int?
    var maxSnipeExtensions: Int?
    /// Optional recent activity when the state payload includes it.
    var recentEvents: [AuctionEvent]?

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        jobId = try c.decodeIfPresent(String.self, forKey: .jobId)
        lowestBidCents = Self.decodeInt64(c, forKey: .lowestBidCents)
        bidCount = Self.decodeInt(c, forKey: .bidCount)
        auctionEndsAt = Self.decodeTimestampString(c, forKey: .auctionEndsAt)
        snipeExtensionCount = Self.decodeInt(c, forKey: .snipeExtensionCount)
        maxSnipeExtensions = Self.decodeInt(c, forKey: .maxSnipeExtensions)
        recentEvents = try? c.decodeIfPresent([AuctionEvent].self, forKey: .recentEvents)
    }

    private enum CodingKeys: String, CodingKey {
        case jobId
        case lowestBidCents
        case bidCount
        case auctionEndsAt
        case snipeExtensionCount
        case maxSnipeExtensions
        case recentEvents
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
        LiveAuctionJSON.decodeTimestampString(c, forKey: key)
    }
}

/// Nested protobuf-style timestamp object: `{ "seconds": ..., "nanos": ... }`.
/// Top-level (not nested in a generic function) so Swift can form the type metadata.
private struct LiveAuctionProtoTimestamp: Decodable {
    var seconds: Int64?
    var nanos: Int32?
}

/// Shared flexible timestamp decode helpers for live-auction JSON shapes.
private enum LiveAuctionJSON {
    static func decodeTimestampString<K: CodingKey>(
        _ c: KeyedDecodingContainer<K>,
        forKey key: K
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
        if let ts = try? c.decodeIfPresent(LiveAuctionProtoTimestamp.self, forKey: key),
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

    /// Listing id for `POST …/listings/{id}/bids/{bidId}/retract`.
    var listingIdForAPI: String? {
        if let id = listing?.id?.trimmingCharacters(in: .whitespacesAndNewlines), !id.isEmpty {
            return id
        }
        if let id = bid?.listingId?.trimmingCharacters(in: .whitespacesAndNewlines), !id.isEmpty {
            return id
        }
        return nil
    }

    /// Bid id for retract; nil when the nested bid is missing.
    var bidIdForAPI: String? {
        guard let id = bid?.id.trimmingCharacters(in: .whitespacesAndNewlines), !id.isEmpty else {
            return nil
        }
        return id
    }

    /// eBay-style 60s retract: leading/winning bid only, within 60s of placement.
    /// Server re-checks ownership + window — this is UI-only gating.
    func canRetract(now: Date = Date()) -> Bool {
        guard isWinning else { return false }
        guard listingIdForAPI != nil, bidIdForAPI != nil else { return false }
        guard let createdAt = bid?.createdAt,
              let created = CatalogDateFormat.parseISO(createdAt)
        else {
            return false
        }
        return now.timeIntervalSince(created) < 60
    }

    func retractSecondsRemaining(now: Date = Date()) -> Int? {
        guard let createdAt = bid?.createdAt,
              let created = CatalogDateFormat.parseISO(createdAt)
        else {
            return nil
        }
        let remaining = 60 - Int(now.timeIntervalSince(created))
        return remaining > 0 ? remaining : nil
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

    /// Active bids can be lowered via `PATCH /api/v1/bids/{id}` (never raised).
    var isLowerable: Bool { isWithdrawable }

    /// Returns a copy marked withdrawn for optimistic UI updates.
    func markedWithdrawn() -> MyJobBidRow {
        var copy = self
        copy.status = "withdrawn"
        return copy
    }

    /// Returns a copy with a lowered amount for optimistic UI updates.
    func markedLowered(to cents: Int64) -> MyJobBidRow {
        var copy = self
        copy.amountCents = cents
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
