import Foundation

// MARK: - Provider search & public profile
//
// Gateway: `handler/provider.go` — SearchProviders / GetProvider.
// Snake_case keys map via APIClient's convertFromSnakeCase decoder.

/// Nested review aggregate on provider search + profile responses.
struct ProviderReviewSummary: Codable, Sendable, Hashable {
    var averageRating: Double?
    var reviewCount: Int?
    /// Null when unknown (no timeliness-rated reviews); UI should hide, not show 0%.
    var onTimeRate: Double?

    var displayRating: String {
        guard let averageRating else { return "—" }
        return averageRating.formatted(.number.precision(.fractionLength(1)))
    }

    var displayCount: String {
        let n = reviewCount ?? 0
        return n == 1 ? "1 review" : "\(n) reviews"
    }
}

/// Nested trust card on provider profile / search (when present).
/// May include dimension scores when the gateway expands the payload.
struct ProviderTrustSummary: Codable, Sendable, Hashable {
    var overallScore: Double?
    var tier: String?
    var feedbackScore: Double?
    var riskScore: Double?
    var volumeScore: Double?
    var fraudScore: Double?
    var dataPoints: Int?
    var computedAt: String?

    var displayTier: String {
        TrustScoreScale.displayTier(tier)
    }

    var displayOverallPoints: String {
        TrustScoreScale.displayPoints(overallScore)
    }

    var hasDimensionBreakdown: Bool {
        feedbackScore != nil || riskScore != nil || volumeScore != nil || fraudScore != nil
    }
}

/// Category chip on provider search/detail.
struct ProviderCategorySummary: Codable, Sendable, Hashable, Identifiable {
    var id: String?
    var name: String?
    var slug: String?
    var level: Int?
    var parentName: String?

    var idValue: String { id ?? slug ?? name ?? UUID().uuidString }

    var displayName: String {
        let n = name?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !n.isEmpty { return n }
        let s = slug?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return s.isEmpty ? (id ?? "Category") : s
    }
}

/// Portfolio image on provider detail.
struct ProviderPortfolioImage: Codable, Sendable, Hashable, Identifiable {
    var id: String?
    var imageUrl: String?
    var caption: String?
    var sortOrder: Int?

    var idValue: String { id ?? imageUrl ?? UUID().uuidString }
}

/// Row from `GET /api/v1/providers/search` → `{ "providers": [...] }`.
struct ProviderSearchResult: Codable, Sendable, Hashable, Identifiable {
    let id: String
    var userId: String?
    var displayName: String?
    var businessName: String?
    var avatarUrl: String?
    var distanceKm: Double?
    var jobsCompleted: Int?
    var reviewSummary: ProviderReviewSummary?
    var trustScore: ProviderTrustSummary?
    var instantAvailable: Bool?
    var responseTimeLabel: String?
    var serviceCategories: [ProviderCategorySummary]?

    enum CodingKeys: String, CodingKey {
        case id
        case userId
        case displayName
        case businessName
        case avatarUrl
        case distanceKm
        case jobsCompleted
        case reviewSummary
        case trustScore
        case instantAvailable
        case responseTimeLabel
        case serviceCategories
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let rawId = try c.decodeIfPresent(String.self, forKey: .id)
        let rawUser = try c.decodeIfPresent(String.self, forKey: .userId)
        let resolved = (rawId?.trimmingCharacters(in: .whitespacesAndNewlines)).flatMap { $0.isEmpty ? nil : $0 }
            ?? (rawUser?.trimmingCharacters(in: .whitespacesAndNewlines)).flatMap { $0.isEmpty ? nil : $0 }
        guard let resolved else {
            throw DecodingError.dataCorruptedError(
                forKey: .id,
                in: c,
                debugDescription: "provider search result requires id or user_id"
            )
        }
        id = resolved
        userId = rawUser ?? rawId
        displayName = try c.decodeIfPresent(String.self, forKey: .displayName)
        businessName = try c.decodeIfPresent(String.self, forKey: .businessName)
        avatarUrl = try c.decodeIfPresent(String.self, forKey: .avatarUrl)
        distanceKm = try c.decodeIfPresent(Double.self, forKey: .distanceKm)
        jobsCompleted = Self.decodeFlexibleInt(c, forKey: .jobsCompleted)
        reviewSummary = try c.decodeIfPresent(ProviderReviewSummary.self, forKey: .reviewSummary)
        trustScore = try c.decodeIfPresent(ProviderTrustSummary.self, forKey: .trustScore)
        instantAvailable = try c.decodeIfPresent(Bool.self, forKey: .instantAvailable)
        responseTimeLabel = try c.decodeIfPresent(String.self, forKey: .responseTimeLabel)
        serviceCategories = try c.decodeIfPresent([ProviderCategorySummary].self, forKey: .serviceCategories)
    }

    private static func decodeFlexibleInt(
        _ c: KeyedDecodingContainer<CodingKeys>,
        forKey key: CodingKeys
    ) -> Int? {
        if let v = try? c.decodeIfPresent(Int.self, forKey: key) { return v }
        if let v = try? c.decodeIfPresent(Int64.self, forKey: key) { return Int(v) }
        if let v = try? c.decodeIfPresent(Double.self, forKey: key) { return Int(v) }
        if let s = try? c.decodeIfPresent(String.self, forKey: key),
           let v = Int(s.trimmingCharacters(in: .whitespacesAndNewlines))
        {
            return v
        }
        return nil
    }

    /// Non-optional label for list rows (views expect `displayName` as String).
    var resolvedDisplayName: String {
        let name = displayName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !name.isEmpty { return name }
        return displayLabel
    }

    var averageRating: Double? {
        reviewSummary?.averageRating
    }

    var displayLabel: String {
        let business = businessName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !business.isEmpty { return business }
        let name = displayName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !name.isEmpty { return name }
        return "Provider"
    }

    var distanceLabel: String? {
        guard let distanceKm else { return nil }
        if distanceKm < 1 {
            return String(format: "%.0f m away", distanceKm * 1000)
        }
        return String(format: "%.1f km away", distanceKm)
    }
}

struct ProvidersSearchResponse: Codable, Sendable {
    var providers: [ProviderSearchResult]
    var pagination: PaginationMeta?

    enum CodingKeys: String, CodingKey {
        case providers
        case pagination
    }

    init(providers: [ProviderSearchResult], pagination: PaginationMeta? = nil) {
        self.providers = providers
        self.pagination = pagination
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        providers = try c.decodeIfPresent([ProviderSearchResult].self, forKey: .providers) ?? []
        pagination = try c.decodeIfPresent(PaginationMeta.self, forKey: .pagination)
    }
}

/// Public provider profile from `GET /api/v1/providers/{id}` (flat map, flexible fields).
struct ProviderProfileDetail: Codable, Sendable, Hashable, Identifiable {
    var id: String
    var userId: String?
    var displayName: String?
    var businessName: String?
    var bio: String?
    var avatarUrl: String?
    var serviceRadiusKm: Double?
    var defaultPaymentTiming: String?
    var cancellationPolicy: String?
    var warrantyTerms: String?
    var instantEnabled: Bool?
    var instantAvailable: Bool?
    var jobsCompleted: Int?
    var avgResponseTimeMinutes: Double?
    var onTimeRate: Double?
    var profileCompleteness: Double?
    var stripeOnboardingComplete: Bool?
    var memberSince: String?
    var responseTimeLabel: String?
    var followerCount: Int?
    var isFollowing: Bool?
    var reviewSummary: ProviderReviewSummary?
    var trustScore: ProviderTrustSummary?
    var serviceCategories: [ProviderCategorySummary]?
    var portfolio: [ProviderPortfolioImage]?

    enum CodingKeys: String, CodingKey {
        case id
        case userId
        case displayName
        case businessName
        case bio
        case avatarUrl
        case serviceRadiusKm
        case defaultPaymentTiming
        case cancellationPolicy
        case warrantyTerms
        case instantEnabled
        case instantAvailable
        case jobsCompleted
        case avgResponseTimeMinutes
        case onTimeRate
        case profileCompleteness
        case stripeOnboardingComplete
        case memberSince
        case responseTimeLabel
        case followerCount
        case isFollowing
        case reviewSummary
        case trustScore
        case serviceCategories
        case portfolio
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let rawId = try c.decodeIfPresent(String.self, forKey: .id)
        let rawUser = try c.decodeIfPresent(String.self, forKey: .userId)
        let resolved = (rawId?.trimmingCharacters(in: .whitespacesAndNewlines)).flatMap { $0.isEmpty ? nil : $0 }
            ?? (rawUser?.trimmingCharacters(in: .whitespacesAndNewlines)).flatMap { $0.isEmpty ? nil : $0 }
            ?? ""
        id = resolved
        userId = rawUser ?? rawId
        displayName = try c.decodeIfPresent(String.self, forKey: .displayName)
        businessName = try c.decodeIfPresent(String.self, forKey: .businessName)
        bio = try c.decodeIfPresent(String.self, forKey: .bio)
        avatarUrl = try c.decodeIfPresent(String.self, forKey: .avatarUrl)
        serviceRadiusKm = try c.decodeIfPresent(Double.self, forKey: .serviceRadiusKm)
        defaultPaymentTiming = try c.decodeIfPresent(String.self, forKey: .defaultPaymentTiming)
        cancellationPolicy = try c.decodeIfPresent(String.self, forKey: .cancellationPolicy)
        warrantyTerms = try c.decodeIfPresent(String.self, forKey: .warrantyTerms)
        instantEnabled = try c.decodeIfPresent(Bool.self, forKey: .instantEnabled)
        instantAvailable = try c.decodeIfPresent(Bool.self, forKey: .instantAvailable)
        jobsCompleted = Self.decodeFlexibleInt(c, forKey: .jobsCompleted)
        avgResponseTimeMinutes = try c.decodeIfPresent(Double.self, forKey: .avgResponseTimeMinutes)
        onTimeRate = try c.decodeIfPresent(Double.self, forKey: .onTimeRate)
        profileCompleteness = try c.decodeIfPresent(Double.self, forKey: .profileCompleteness)
        stripeOnboardingComplete = try c.decodeIfPresent(Bool.self, forKey: .stripeOnboardingComplete)
        memberSince = try c.decodeIfPresent(String.self, forKey: .memberSince)
        responseTimeLabel = try c.decodeIfPresent(String.self, forKey: .responseTimeLabel)
        followerCount = Self.decodeFlexibleInt(c, forKey: .followerCount)
        isFollowing = try c.decodeIfPresent(Bool.self, forKey: .isFollowing)
        reviewSummary = try c.decodeIfPresent(ProviderReviewSummary.self, forKey: .reviewSummary)
        trustScore = try c.decodeIfPresent(ProviderTrustSummary.self, forKey: .trustScore)
        serviceCategories = try c.decodeIfPresent([ProviderCategorySummary].self, forKey: .serviceCategories)
        portfolio = try c.decodeIfPresent([ProviderPortfolioImage].self, forKey: .portfolio)
    }

    private static func decodeFlexibleInt(
        _ c: KeyedDecodingContainer<CodingKeys>,
        forKey key: CodingKeys
    ) -> Int? {
        if let v = try? c.decodeIfPresent(Int.self, forKey: key) { return v }
        if let v = try? c.decodeIfPresent(Int64.self, forKey: key) { return Int(v) }
        if let v = try? c.decodeIfPresent(Double.self, forKey: key) { return Int(v) }
        if let s = try? c.decodeIfPresent(String.self, forKey: key),
           let v = Int(s.trimmingCharacters(in: .whitespacesAndNewlines))
        {
            return v
        }
        return nil
    }

    var displayLabel: String {
        let business = businessName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !business.isEmpty { return business }
        let name = displayName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !name.isEmpty { return name }
        return "Provider"
    }

    var averageRating: Double? {
        reviewSummary?.averageRating
    }

    var reviewSummaryLabel: String? {
        guard let summary = reviewSummary else { return nil }
        let count = summary.reviewCount ?? 0
        if let rating = summary.averageRating {
            return "\(rating.formatted(.number.precision(.fractionLength(1)))) · \(count) review\(count == 1 ? "" : "s")"
        }
        return count > 0 ? "\(count) review\(count == 1 ? "" : "s")" : nil
    }

    var portfolioCount: Int {
        portfolio?.count ?? 0
    }

    var categoryNames: [String] {
        (serviceCategories ?? []).compactMap { cat in
            let n = cat.name?.trimmingCharacters(in: .whitespacesAndNewlines) ?? cat.displayName
            return n.isEmpty ? nil : n
        }
    }

    var jobsCompletedLabel: String {
        let n = jobsCompleted ?? 0
        return n == 1 ? "1 job completed" : "\(n) jobs completed"
    }
}

// MARK: - Properties (service locations)

struct PropertyAddress: Codable, Sendable, Hashable {
    var street: String?
    var city: String?
    var state: String?
    var zipCode: String?
    var latitude: Double?
    var longitude: Double?

    var singleLine: String {
        var parts: [String] = []
        if let street, !street.isEmpty { parts.append(street) }
        var cityState = ""
        if let city, !city.isEmpty { cityState = city }
        if let state, !state.isEmpty {
            cityState = cityState.isEmpty ? state : "\(cityState), \(state)"
        }
        if !cityState.isEmpty { parts.append(cityState) }
        if let zipCode, !zipCode.isEmpty { parts.append(zipCode) }
        return parts.isEmpty ? "Address" : parts.joined(separator: ", ")
    }
}

struct PropertyItem: Codable, Sendable, Hashable, Identifiable {
    let id: String
    var userId: String?
    var nickname: String?
    var notes: String?
    var isPrimary: Bool?
    var address: PropertyAddress?
    var createdAt: String?

    var displayName: String {
        let n = nickname?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !n.isEmpty { return n }
        return address?.singleLine ?? "Property"
    }

    /// Alias used by PropertiesView.
    var displayNickname: String { displayName }

    var addressLines: [String] {
        var lines: [String] = []
        if let street = address?.street?.trimmingCharacters(in: .whitespacesAndNewlines), !street.isEmpty {
            lines.append(street)
        }
        var cityStateZip: [String] = []
        if let city = address?.city?.trimmingCharacters(in: .whitespacesAndNewlines), !city.isEmpty {
            cityStateZip.append(city)
        }
        if let state = address?.state?.trimmingCharacters(in: .whitespacesAndNewlines), !state.isEmpty {
            cityStateZip.append(state)
        }
        if let zip = address?.zipCode?.trimmingCharacters(in: .whitespacesAndNewlines), !zip.isEmpty {
            cityStateZip.append(zip)
        }
        if !cityStateZip.isEmpty {
            if cityStateZip.count >= 2 {
                let city = cityStateZip[0]
                let rest = cityStateZip[1...]
                lines.append("\(city), " + rest.joined(separator: " "))
            } else {
                lines.append(cityStateZip.joined(separator: " "))
            }
        }
        return lines
    }

    var primaryLabel: String? {
        isPrimary == true ? "Primary" : nil
    }

    var notesDisplay: String? {
        let n = notes?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return n.isEmpty ? nil : n
    }
}

/// Active / upcoming job counts for one property (FR-19.2 summary cards).
struct PropertyJobCounts: Sendable, Hashable {
    var active: Int = 0
    var upcoming: Int = 0

    var hasAny: Bool { active > 0 || upcoming > 0 }

    static func from(jobs: [JobSummary]) -> PropertyJobCounts {
        var counts = PropertyJobCounts()
        for job in jobs {
            if job.isActiveWork { counts.active += 1 }
            if job.isUpcomingWork { counts.upcoming += 1 }
        }
        return counts
    }
}

struct PropertiesResponse: Codable, Sendable {
    var properties: [PropertyItem]

    enum CodingKeys: String, CodingKey {
        case properties
    }

    init(properties: [PropertyItem]) {
        self.properties = properties
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        properties = try c.decodeIfPresent([PropertyItem].self, forKey: .properties) ?? []
    }
}

// MARK: - Wishlist (buyer standing wants)

struct WishlistItem: Codable, Sendable, Hashable, Identifiable {
    let id: String
    var userId: String?
    var keyword: String?
    var categoryId: String?
    var categoryName: String?
    var maxPriceCents: Int64?
    /// ISO timestamp string; gateway may send RFC3339 Date-compatible JSON.
    var createdAt: String?

    enum CodingKeys: String, CodingKey {
        case id
        case userId
        case keyword
        case categoryId
        case categoryName
        case maxPriceCents
        case createdAt
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let rawId = try c.decodeIfPresent(String.self, forKey: .id) ?? ""
        guard !rawId.isEmpty else {
            throw DecodingError.dataCorruptedError(
                forKey: .id,
                in: c,
                debugDescription: "wishlist item id required"
            )
        }
        id = rawId
        userId = try c.decodeIfPresent(String.self, forKey: .userId)
        keyword = try c.decodeIfPresent(String.self, forKey: .keyword)
        categoryId = try c.decodeIfPresent(String.self, forKey: .categoryId)
        categoryName = try c.decodeIfPresent(String.self, forKey: .categoryName)
        maxPriceCents = Self.decodeFlexibleInt64(c, forKey: .maxPriceCents)
        createdAt = Self.decodeFlexibleTimestamp(c, forKey: .createdAt)
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

    private static func decodeFlexibleTimestamp(
        _ c: KeyedDecodingContainer<CodingKeys>,
        forKey key: CodingKeys
    ) -> String? {
        if let s = try? c.decodeIfPresent(String.self, forKey: key) {
            let trimmed = s.trimmingCharacters(in: .whitespacesAndNewlines)
            return trimmed.isEmpty ? nil : trimmed
        }
        if let d = try? c.decodeIfPresent(Date.self, forKey: key) {
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            let withFrac = formatter.string(from: d)
            if !withFrac.isEmpty { return withFrac }
            formatter.formatOptions = [.withInternetDateTime]
            return formatter.string(from: d)
        }
        return nil
    }

    var displayKeyword: String {
        let k = keyword?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return k.isEmpty ? "Wishlist item" : k
    }

    var displayMaxPrice: String {
        MoneyFormat.usd(cents: maxPriceCents ?? 0)
    }

    var displayCategory: String? {
        let n = categoryName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return n.isEmpty ? nil : n
    }

    var createdAtLabel: String? {
        guard let createdAt else { return nil }
        return CatalogDateFormat.friendlyDateTime(createdAt)
    }
}

struct WishlistResponse: Codable, Sendable {
    var wishlistItems: [WishlistItem]
    var pagination: PaginationMeta?

    enum CodingKeys: String, CodingKey {
        case wishlistItems
        case pagination
    }

    init(wishlistItems: [WishlistItem], pagination: PaginationMeta? = nil) {
        self.wishlistItems = wishlistItems
        self.pagination = pagination
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        wishlistItems = try c.decodeIfPresent([WishlistItem].self, forKey: .wishlistItems) ?? []
        pagination = try c.decodeIfPresent(PaginationMeta.self, forKey: .pagination)
    }
}

struct WishlistItemEnvelope: Codable, Sendable {
    var wishlistItem: WishlistItem?
}

// MARK: - User blocks

struct BlockedUser: Codable, Sendable, Hashable, Identifiable {
    let blockedId: String
    var displayName: String?
    var avatarUrl: String?
    var reason: String?
    var blockedAt: String?

    var id: String { blockedId }

    enum CodingKeys: String, CodingKey {
        case blockedId
        case displayName
        case avatarUrl
        case reason
        case blockedAt
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let raw = try c.decodeIfPresent(String.self, forKey: .blockedId) ?? ""
        guard !raw.isEmpty else {
            throw DecodingError.dataCorruptedError(
                forKey: .blockedId,
                in: c,
                debugDescription: "blocked_id required"
            )
        }
        blockedId = raw
        displayName = try c.decodeIfPresent(String.self, forKey: .displayName)
        avatarUrl = try c.decodeIfPresent(String.self, forKey: .avatarUrl)
        reason = try c.decodeIfPresent(String.self, forKey: .reason)
        if let s = try? c.decodeIfPresent(String.self, forKey: .blockedAt) {
            blockedAt = s
        } else if let d = try? c.decodeIfPresent(Date.self, forKey: .blockedAt) {
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            blockedAt = formatter.string(from: d)
        } else {
            blockedAt = nil
        }
    }

    var displayLabel: String {
        let n = displayName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return n.isEmpty ? "Blocked user" : n
    }

    var blockedAtLabel: String? {
        guard let blockedAt else { return nil }
        return CatalogDateFormat.friendlyDateTime(blockedAt)
    }
}

struct BlocksResponse: Codable, Sendable {
    var blocks: [BlockedUser]
    var pagination: PaginationMeta?

    enum CodingKeys: String, CodingKey {
        case blocks
        case pagination
    }

    init(blocks: [BlockedUser], pagination: PaginationMeta? = nil) {
        self.blocks = blocks
        self.pagination = pagination
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        blocks = try c.decodeIfPresent([BlockedUser].self, forKey: .blocks) ?? []
        pagination = try c.decodeIfPresent(PaginationMeta.self, forKey: .pagination)
    }
}

// MARK: - Referrals

struct ReferralCodeInfo: Codable, Sendable, Hashable {
    var code: String?
    var creditCents: Int64?
    var shareUrl: String?
    var shareMessage: String?

    var displayCode: String {
        let c = code?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return c.isEmpty ? "—" : c
    }

    var displayCredit: String {
        MoneyFormat.usd(cents: creditCents ?? 0)
    }
}

struct RedeemReferralResponse: Codable, Sendable {
    var status: String?
    var code: String?
    var message: String?
}

// MARK: - Notification preferences

struct NotificationPreferenceRow: Codable, Sendable, Hashable, Identifiable {
    var notificationType: String
    var pushEnabled: Bool
    var emailEnabled: Bool
    var smsEnabled: Bool
    var inAppEnabled: Bool

    var id: String { notificationType }

    var displayType: String {
        notificationType
            .replacingOccurrences(of: "_", with: " ")
            .capitalized
    }
}

struct NotificationPreferencesResponse: Codable, Sendable {
    var preferences: [NotificationPreferenceRow]
    var globalPushEnabled: Bool?
    var globalEmailEnabled: Bool?
    var globalSmsEnabled: Bool?

    enum CodingKeys: String, CodingKey {
        case preferences
        case globalPushEnabled
        case globalEmailEnabled
        case globalSmsEnabled
    }

    init(
        preferences: [NotificationPreferenceRow],
        globalPushEnabled: Bool? = nil,
        globalEmailEnabled: Bool? = nil,
        globalSmsEnabled: Bool? = nil
    ) {
        self.preferences = preferences
        self.globalPushEnabled = globalPushEnabled
        self.globalEmailEnabled = globalEmailEnabled
        self.globalSmsEnabled = globalSmsEnabled
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        preferences = try c.decodeIfPresent([NotificationPreferenceRow].self, forKey: .preferences) ?? []
        globalPushEnabled = try c.decodeIfPresent(Bool.self, forKey: .globalPushEnabled)
        globalEmailEnabled = try c.decodeIfPresent(Bool.self, forKey: .globalEmailEnabled)
        globalSmsEnabled = try c.decodeIfPresent(Bool.self, forKey: .globalSmsEnabled)
    }
}

// MARK: - Payment methods

struct PaymentMethodRow: Codable, Sendable, Hashable, Identifiable {
    let id: String
    var brand: String?
    var lastFour: String?
    var expMonth: Int?
    var expYear: Int?
    var type: String?
    var isDefault: Bool?

    var displayBrand: String {
        let b = brand?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return b.isEmpty ? (type ?? "Card") : b.capitalized
    }

    var displayLastFour: String {
        let last = lastFour?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return last.isEmpty ? "••••" : "•••• \(last)"
    }

    var displayLabel: String {
        "\(displayBrand) \(displayLastFour)"
    }

    var expiryLabel: String? {
        guard let expMonth, let expYear else { return nil }
        return String(format: "%02d/%d", expMonth, expYear)
    }

    /// Alias used by PaymentMethodsView.
    var displayExp: String? { expiryLabel }
}

struct PaymentMethodsResponse: Codable, Sendable {
    var methods: [PaymentMethodRow]

    enum CodingKeys: String, CodingKey {
        case methods
    }

    init(methods: [PaymentMethodRow]) {
        self.methods = methods
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        methods = try c.decodeIfPresent([PaymentMethodRow].self, forKey: .methods) ?? []
    }
}

// MARK: - Stripe Connect (provider)

struct StripeAccountStatus: Codable, Sendable, Hashable {
    var chargesEnabled: Bool?
    var detailsSubmitted: Bool?
    var payoutsEnabled: Bool?
    var requirements: [String]?
    var accountId: String?
    var stripeAccountId: String?

    var isReadyForPayouts: Bool {
        chargesEnabled == true && payoutsEnabled == true && detailsSubmitted == true
    }

    /// Aliases used by SellerPayoutsView.
    var hasChargesEnabled: Bool { chargesEnabled == true }
    var hasPayoutsEnabled: Bool { payoutsEnabled == true }
    var hasDetailsSubmitted: Bool { detailsSubmitted == true }
    var isFullyOnboarded: Bool { isReadyForPayouts }

    var needsOnboarding: Bool {
        detailsSubmitted != true || chargesEnabled != true
    }
}

/// Flexible decode of onboarding link (`url` | `onboarding_url` | `account_link`).
struct StripeOnboardingLink: Codable, Sendable, Hashable {
    var url: String?

    enum CodingKeys: String, CodingKey {
        case url
        case onboardingUrl
        case accountLink
        case link
    }

    init(url: String?) {
        self.url = url
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        if let u = try c.decodeIfPresent(String.self, forKey: .url), !u.isEmpty {
            url = u
        } else if let u = try c.decodeIfPresent(String.self, forKey: .onboardingUrl), !u.isEmpty {
            url = u
        } else if let u = try c.decodeIfPresent(String.self, forKey: .accountLink), !u.isEmpty {
            url = u
        } else if let u = try c.decodeIfPresent(String.self, forKey: .link), !u.isEmpty {
            url = u
        } else {
            url = nil
        }
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encodeIfPresent(url, forKey: .url)
    }

    var resolvedURL: URL? {
        guard let url, !url.isEmpty else { return nil }
        return URL(string: url)
    }
}

struct StripeAccountCreateResponse: Codable, Sendable {
    var stripeAccountId: String?
    var accountId: String?

    var resolvedAccountId: String? {
        let a = stripeAccountId?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !a.isEmpty { return a }
        let b = accountId?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return b.isEmpty ? nil : b
    }
}

// MARK: - Age verification

struct AgeStatus: Codable, Sendable, Hashable {
    var verified: Bool?
    var verifiedAt: String?

    var isVerified: Bool { verified == true }

    var verifiedAtLabel: String? {
        guard let verifiedAt, !verifiedAt.isEmpty else { return nil }
        return CatalogDateFormat.friendlyDateTime(verifiedAt)
    }
}

/// `PUT /api/v1/me/dob` → `{ "dob_verified": true }`.
struct SetDOBResponse: Codable, Sendable, Hashable {
    var dobVerified: Bool?

    var isVerified: Bool { dobVerified == true }
}

// MARK: - Markets (city catalog)

struct MarketRow: Codable, Sendable, Hashable, Identifiable {
    let id: String
    var slug: String?
    var name: String?
    var region: String?
    var regionCode: String?
    var country: String?
    var isActive: Bool?
    var lat: Double?
    var lng: Double?

    var displayName: String {
        let n = name?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !n.isEmpty { return n }
        let s = slug?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return s.isEmpty ? id : s
    }

    var regionLabel: String? {
        let r = region?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !r.isEmpty { return r }
        let code = regionCode?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return code.isEmpty ? nil : code
    }

    var hasCoordinate: Bool {
        lat != nil && lng != nil
    }
}

struct MarketsResponse: Codable, Sendable {
    var markets: [MarketRow]

    enum CodingKeys: String, CodingKey {
        case markets
    }

    init(markets: [MarketRow]) {
        self.markets = markets
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        markets = try c.decodeIfPresent([MarketRow].self, forKey: .markets) ?? []
    }
}

// MARK: - User report

struct UserReportResponse: Codable, Sendable {
    var id: String?
    var status: String?
    var message: String?
}

// MARK: - Similar listings envelope

/// `GET /api/v1/listings/{id}/similar` — accepts `{ listings: [...] }` or a bare array.
struct SimilarListingsResponse: Decodable, Sendable {
    var listings: [ListingSummary]

    enum CodingKeys: String, CodingKey {
        case listings
        case data
        case results
        case items
    }

    init(listings: [ListingSummary]) {
        self.listings = listings
    }

    init(from decoder: Decoder) throws {
        if let arr = try? decoder.singleValueContainer().decode([ListingSummary].self) {
            listings = arr
            return
        }
        let c = try decoder.container(keyedBy: CodingKeys.self)
        if let arr = try c.decodeIfPresent([ListingSummary].self, forKey: .listings) {
            listings = arr
        } else if let arr = try c.decodeIfPresent([ListingSummary].self, forKey: .data) {
            listings = arr
        } else if let arr = try c.decodeIfPresent([ListingSummary].self, forKey: .results) {
            listings = arr
        } else if let arr = try c.decodeIfPresent([ListingSummary].self, forKey: .items) {
            listings = arr
        } else {
            listings = []
        }
    }
}

// MARK: - Follows (seller social)

/// Row from `GET /api/v1/me/follows` → `{ "follows": [...] }`.
struct FollowedSeller: Codable, Sendable, Hashable, Identifiable {
    let sellerId: String
    var displayName: String?
    var avatarUrl: String?
    var followedAt: String?

    var id: String { sellerId }

    enum CodingKeys: String, CodingKey {
        case sellerId
        case displayName
        case avatarUrl
        case followedAt
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let raw = try c.decodeIfPresent(String.self, forKey: .sellerId) ?? ""
        guard !raw.isEmpty else {
            throw DecodingError.dataCorruptedError(
                forKey: .sellerId,
                in: c,
                debugDescription: "seller_id required"
            )
        }
        sellerId = raw
        displayName = try c.decodeIfPresent(String.self, forKey: .displayName)
        avatarUrl = try c.decodeIfPresent(String.self, forKey: .avatarUrl)
        if let s = try? c.decodeIfPresent(String.self, forKey: .followedAt) {
            followedAt = s
        } else if let d = try? c.decodeIfPresent(Date.self, forKey: .followedAt) {
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            followedAt = formatter.string(from: d)
        } else {
            followedAt = nil
        }
    }

    var displayLabel: String {
        let n = displayName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return n.isEmpty ? "Seller" : n
    }

    var followedAtLabel: String? {
        guard let followedAt else { return nil }
        return CatalogDateFormat.friendlyDateTime(followedAt)
    }
}

struct FollowsResponse: Decodable, Sendable {
    var follows: [FollowedSeller]
    var pagination: PaginationMeta?

    enum CodingKeys: String, CodingKey {
        case follows
        case pagination
    }

    init(follows: [FollowedSeller], pagination: PaginationMeta? = nil) {
        self.follows = follows
        self.pagination = pagination
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        follows = try c.decodeIfPresent([FollowedSeller].self, forKey: .follows) ?? []
        pagination = try c.decodeIfPresent(PaginationMeta.self, forKey: .pagination)
    }
}

/// `POST|DELETE /api/v1/users/{id}/follow` envelope.
struct FollowToggleResponse: Decodable, Sendable {
    var following: Bool?
    var followerCount: Int?
}

// MARK: - User reviews (public seller/provider)

/// Nested public response on a review (FR-6.5).
struct ReviewResponseSnippet: Decodable, Sendable, Hashable {
    var id: String?
    var reviewId: String?
    var responderId: String?
    var responderName: String?
    var comment: String?
    var createdAt: String?

    enum CodingKeys: String, CodingKey {
        case id
        case reviewId
        case responderId
        case responderName
        case comment
        case createdAt
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeIfPresent(String.self, forKey: .id)
        reviewId = try c.decodeIfPresent(String.self, forKey: .reviewId)
        responderId = try c.decodeIfPresent(String.self, forKey: .responderId)
        responderName = try c.decodeIfPresent(String.self, forKey: .responderName)
        comment = try c.decodeIfPresent(String.self, forKey: .comment)
        if let s = try? c.decodeIfPresent(String.self, forKey: .createdAt) {
            createdAt = s
        } else if let d = try? c.decodeIfPresent(Date.self, forKey: .createdAt) {
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            createdAt = formatter.string(from: d)
        } else {
            createdAt = nil
        }
    }

    var displayComment: String {
        let t = comment?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return t.isEmpty ? "—" : t
    }

    var displayResponder: String {
        let n = responderName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return n.isEmpty ? "Response" : n
    }
}

/// Row from `GET /api/v1/users/{id}/reviews` → `{ "reviews": [...] }`.
struct ReviewRow: Decodable, Sendable, Hashable, Identifiable {
    let id: String
    var rating: Int?
    var comment: String?
    var createdAt: String?
    var reviewerDisplayName: String?
    var reviewerId: String?
    var revieweeId: String?
    var isFlagged: Bool?
    var response: ReviewResponseSnippet?

    enum CodingKeys: String, CodingKey {
        case id
        case rating
        case overallRating
        case comment
        case createdAt
        case reviewerDisplayName
        case reviewerName
        case displayName
        case reviewerId
        case revieweeId
        case isFlagged
        case response
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let rawId = try c.decodeIfPresent(String.self, forKey: .id) ?? ""
        id = rawId.isEmpty ? UUID().uuidString : rawId

        if let v = try? c.decodeIfPresent(Int.self, forKey: .rating) {
            rating = v
        } else if let v = try? c.decodeIfPresent(Int.self, forKey: .overallRating) {
            rating = v
        } else if let v = try? c.decodeIfPresent(Int64.self, forKey: .overallRating) {
            rating = Int(v)
        } else if let v = try? c.decodeIfPresent(Double.self, forKey: .overallRating) {
            rating = Int(v)
        } else if let v = try? c.decodeIfPresent(Double.self, forKey: .rating) {
            rating = Int(v)
        } else {
            rating = nil
        }

        comment = try c.decodeIfPresent(String.self, forKey: .comment)

        if let s = try? c.decodeIfPresent(String.self, forKey: .createdAt) {
            createdAt = s
        } else if let d = try? c.decodeIfPresent(Date.self, forKey: .createdAt) {
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            createdAt = formatter.string(from: d)
        } else {
            createdAt = nil
        }

        let nameCandidates: [String?] = [
            try c.decodeIfPresent(String.self, forKey: .reviewerDisplayName),
            try c.decodeIfPresent(String.self, forKey: .reviewerName),
            try c.decodeIfPresent(String.self, forKey: .displayName),
        ]
        reviewerDisplayName = nameCandidates
            .compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }
            .first { !$0.isEmpty }

        reviewerId = try c.decodeIfPresent(String.self, forKey: .reviewerId)
        revieweeId = try c.decodeIfPresent(String.self, forKey: .revieweeId)
        isFlagged = try c.decodeIfPresent(Bool.self, forKey: .isFlagged)
        response = try c.decodeIfPresent(ReviewResponseSnippet.self, forKey: .response)
    }

    var displayReviewer: String {
        let n = reviewerDisplayName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return n.isEmpty ? "Reviewer" : n
    }

    var displayComment: String {
        let t = comment?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return t.isEmpty ? "No written comment." : t
    }

    var displayRating: String {
        guard let rating, rating > 0 else { return "—" }
        return "\(rating)/5"
    }

    var createdAtLabel: String? {
        guard let createdAt else { return nil }
        return CatalogDateFormat.friendlyDateTime(createdAt)
    }

    var hasResponse: Bool {
        guard let response else { return false }
        let c = response.comment?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return !c.isEmpty || response.id != nil
    }
}

struct UserReviewsResponse: Decodable, Sendable {
    var averageRating: Double?
    var totalReviews: Int?
    var reviews: [ReviewRow]
    var pagination: PaginationMeta?

    enum CodingKeys: String, CodingKey {
        case averageRating
        case totalReviews
        case reviews
        case pagination
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        if let d = try? c.decodeIfPresent(Double.self, forKey: .averageRating) {
            averageRating = d
        } else if let i = try? c.decodeIfPresent(Int.self, forKey: .averageRating) {
            averageRating = Double(i)
        } else {
            averageRating = nil
        }
        if let i = try? c.decodeIfPresent(Int.self, forKey: .totalReviews) {
            totalReviews = i
        } else if let i64 = try? c.decodeIfPresent(Int64.self, forKey: .totalReviews) {
            totalReviews = Int(i64)
        } else {
            totalReviews = nil
        }
        reviews = try c.decodeIfPresent([ReviewRow].self, forKey: .reviews) ?? []
        pagination = try c.decodeIfPresent(PaginationMeta.self, forKey: .pagination)
    }

    var displayAverage: String {
        guard let averageRating else { return "—" }
        return averageRating.formatted(.number.precision(.fractionLength(1)))
    }
}

// MARK: - Auth / password change

struct ChangePasswordResponse: Codable, Sendable {
    var success: Bool?
}

// MARK: - Connected OAuth accounts (ASR-5.1.1.v)

/// Linked social sign-in provider from `GET /api/v1/users/me/oauth-accounts`.
/// `provider_id` is never returned — opaque third-party subject.
struct OAuthAccount: Codable, Sendable, Hashable, Identifiable {
    var provider: String
    var email: String?
    var linkedAt: String?

    var id: String { provider.lowercased() }

    var displayName: String {
        switch provider.lowercased() {
        case "google": return "Google"
        case "apple": return "Apple"
        case "facebook": return "Facebook"
        default:
            guard let first = provider.first else { return provider }
            return String(first).uppercased() + provider.dropFirst().lowercased()
        }
    }

    var systemImage: String {
        switch provider.lowercased() {
        case "google": return "g.circle.fill"
        case "apple": return "apple.logo"
        case "facebook": return "f.circle.fill"
        default: return "link.circle.fill"
        }
    }
}

struct OAuthAccountsResponse: Codable, Sendable {
    var accounts: [OAuthAccount]
}

/// `DELETE /api/v1/users/me/oauth-accounts/{provider}` success body.
struct UnlinkOAuthAccountResponse: Codable, Sendable {
    var unlinked: Bool?
    var provider: String?

    var didUnlink: Bool { unlinked == true }
}

// MARK: - NPS surveys (post-transaction feedback)

/// Pending row from `GET /api/v1/me/nps/pending` → `{ "pending": [...] }`.
struct NPSPendingSurvey: Codable, Sendable, Hashable, Identifiable {
    let id: String
    var contextType: String?
    var contextId: String?
    var promptedAt: String?

    enum CodingKeys: String, CodingKey {
        case id
        case contextType
        case contextId
        case promptedAt
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let raw = try c.decodeIfPresent(String.self, forKey: .id) ?? ""
        guard !raw.isEmpty else {
            throw DecodingError.dataCorruptedError(
                forKey: .id,
                in: c,
                debugDescription: "nps survey id required"
            )
        }
        id = raw
        contextType = try c.decodeIfPresent(String.self, forKey: .contextType)
        contextId = try c.decodeIfPresent(String.self, forKey: .contextId)
        if let s = try? c.decodeIfPresent(String.self, forKey: .promptedAt) {
            promptedAt = s
        } else if let d = try? c.decodeIfPresent(Date.self, forKey: .promptedAt) {
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            var stamp = formatter.string(from: d)
            if stamp.isEmpty {
                formatter.formatOptions = [.withInternetDateTime]
                stamp = formatter.string(from: d)
            }
            promptedAt = stamp
        } else {
            promptedAt = nil
        }
    }

    var displayContext: String {
        let type = (contextType ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: "_", with: " ")
            .capitalized
        if type.isEmpty { return "Feedback survey" }
        return type
    }

    var promptedAtLabel: String? {
        guard let promptedAt, !promptedAt.isEmpty else { return nil }
        return CatalogDateFormat.friendlyDateTime(promptedAt)
    }
}

struct NPSPendingResponse: Decodable, Sendable {
    var pending: [NPSPendingSurvey]

    enum CodingKeys: String, CodingKey {
        case pending
    }

    init(pending: [NPSPendingSurvey]) {
        self.pending = pending
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        pending = try c.decodeIfPresent([NPSPendingSurvey].self, forKey: .pending) ?? []
    }
}

struct SubmitNPSResponse: Codable, Sendable {
    var submitted: Bool?
}

// MARK: - Referral history (list)

/// Entry from `GET /api/v1/me/referrals` → `referrals[]`.
struct ReferralHistoryEntry: Codable, Sendable, Hashable, Identifiable {
    let id: String
    var status: String?
    var referredId: String?
    var creditCents: Int64?
    var creditedAt: String?
    var createdAt: String?

    enum CodingKeys: String, CodingKey {
        case id
        case status
        case referredId
        case creditCents
        case creditedAt
        case createdAt
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let raw = try c.decodeIfPresent(String.self, forKey: .id) ?? ""
        guard !raw.isEmpty else {
            throw DecodingError.dataCorruptedError(
                forKey: .id,
                in: c,
                debugDescription: "referral history id required"
            )
        }
        id = raw
        status = try c.decodeIfPresent(String.self, forKey: .status)
        referredId = try c.decodeIfPresent(String.self, forKey: .referredId)
        if let v = try? c.decodeIfPresent(Int64.self, forKey: .creditCents) {
            creditCents = v
        } else if let v = try? c.decodeIfPresent(Int.self, forKey: .creditCents) {
            creditCents = Int64(v)
        } else {
            creditCents = nil
        }
        creditedAt = Self.decodeFlexibleTimestamp(c, forKey: .creditedAt)
        createdAt = Self.decodeFlexibleTimestamp(c, forKey: .createdAt)
    }

    private static func decodeFlexibleTimestamp(
        _ c: KeyedDecodingContainer<CodingKeys>,
        forKey key: CodingKeys
    ) -> String? {
        if let s = try? c.decodeIfPresent(String.self, forKey: key) {
            let trimmed = s.trimmingCharacters(in: .whitespacesAndNewlines)
            return trimmed.isEmpty ? nil : trimmed
        }
        if let d = try? c.decodeIfPresent(Date.self, forKey: key) {
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            let withFrac = formatter.string(from: d)
            if !withFrac.isEmpty { return withFrac }
            formatter.formatOptions = [.withInternetDateTime]
            return formatter.string(from: d)
        }
        return nil
    }

    var displayStatus: String {
        let s = status?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if s.isEmpty { return "Unknown" }
        return s.replacingOccurrences(of: "_", with: " ").capitalized
    }

    var displayCredit: String {
        MoneyFormat.usd(cents: creditCents ?? 0)
    }

    var createdAtLabel: String? {
        guard let createdAt, !createdAt.isEmpty else { return nil }
        return CatalogDateFormat.friendlyDateTime(createdAt)
    }
}

/// `GET /api/v1/me/referrals` — code + history + credit balance.
struct ReferralsListResponse: Codable, Sendable {
    var code: String?
    var referrals: [ReferralHistoryEntry]
    var creditBalanceCents: Int64?

    enum CodingKeys: String, CodingKey {
        case code
        case referrals
        case creditBalanceCents
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        code = try c.decodeIfPresent(String.self, forKey: .code)
        referrals = try c.decodeIfPresent([ReferralHistoryEntry].self, forKey: .referrals) ?? []
        if let v = try? c.decodeIfPresent(Int64.self, forKey: .creditBalanceCents) {
            creditBalanceCents = v
        } else if let v = try? c.decodeIfPresent(Int.self, forKey: .creditBalanceCents) {
            creditBalanceCents = Int64(v)
        } else {
            creditBalanceCents = nil
        }
    }

    var displayCode: String {
        let c = code?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return c.isEmpty ? "—" : c
    }

    var displayBalance: String {
        MoneyFormat.usd(cents: creditBalanceCents ?? 0)
    }
}

// MARK: - User savings (lifetime reverse-auction savings)

/// Row from bare-array `GET /api/v1/users/me/savings`.
struct SavingsEntry: Codable, Sendable, Hashable, Identifiable {
    let id: String
    var userId: String?
    var jobId: String?
    var awardedCents: Int64?
    var marketMedianCents: Int64?
    var savingsCents: Int64?
    var createdAt: String?

    enum CodingKeys: String, CodingKey {
        case id
        case userId
        case jobId
        case awardedCents
        case marketMedianCents
        case savingsCents
        case createdAt
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let raw = try c.decodeIfPresent(String.self, forKey: .id) ?? ""
        guard !raw.isEmpty else {
            throw DecodingError.dataCorruptedError(
                forKey: .id,
                in: c,
                debugDescription: "savings entry id required"
            )
        }
        id = raw
        userId = try c.decodeIfPresent(String.self, forKey: .userId)
        jobId = try c.decodeIfPresent(String.self, forKey: .jobId)
        awardedCents = Self.decodeFlexibleInt64(c, forKey: .awardedCents)
        marketMedianCents = Self.decodeFlexibleInt64(c, forKey: .marketMedianCents)
        savingsCents = Self.decodeFlexibleInt64(c, forKey: .savingsCents)
        if let s = try? c.decodeIfPresent(String.self, forKey: .createdAt) {
            createdAt = s
        } else if let d = try? c.decodeIfPresent(Date.self, forKey: .createdAt) {
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            var stamp = formatter.string(from: d)
            if stamp.isEmpty {
                formatter.formatOptions = [.withInternetDateTime]
                stamp = formatter.string(from: d)
            }
            createdAt = stamp
        } else {
            createdAt = nil
        }
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

    var displaySavings: String {
        MoneyFormat.usd(cents: savingsCents ?? 0)
    }

    var displayAwarded: String {
        MoneyFormat.usd(cents: awardedCents ?? 0)
    }

    var displayMarketMedian: String {
        MoneyFormat.usd(cents: marketMedianCents ?? 0)
    }

    var createdAtLabel: String? {
        guard let createdAt, !createdAt.isEmpty else { return nil }
        return CatalogDateFormat.friendlyDateTime(createdAt)
    }

    var shortJobID: String {
        let j = jobId?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if j.isEmpty { return "Job" }
        if j.count <= 12 { return j }
        return String(j.prefix(8)) + "…"
    }
}

/// Bare-array or wrapped decode for savings endpoint.
struct SavingsResponse: Decodable, Sendable {
    var entries: [SavingsEntry]

    enum CodingKeys: String, CodingKey {
        case savings
        case entries
        case data
        case items
    }

    init(entries: [SavingsEntry]) {
        self.entries = entries
    }

    init(from decoder: Decoder) throws {
        if let arr = try? decoder.singleValueContainer().decode([SavingsEntry].self) {
            entries = arr
            return
        }
        let c = try decoder.container(keyedBy: CodingKeys.self)
        if let arr = try c.decodeIfPresent([SavingsEntry].self, forKey: .savings) {
            entries = arr
        } else if let arr = try c.decodeIfPresent([SavingsEntry].self, forKey: .entries) {
            entries = arr
        } else if let arr = try c.decodeIfPresent([SavingsEntry].self, forKey: .data) {
            entries = arr
        } else if let arr = try c.decodeIfPresent([SavingsEntry].self, forKey: .items) {
            entries = arr
        } else {
            entries = []
        }
    }

    var lifetimeSavingsCents: Int64 {
        entries.reduce(0) { $0 + ($1.savingsCents ?? 0) }
    }
}

// MARK: - MFA enable setup

/// `POST /api/v1/auth/mfa/enable` → secret + QR URL + backup codes (setup not confirmed yet).
struct EnableMFAResponse: Codable, Sendable, Hashable {
    var secret: String?
    var qrCodeUrl: String?
    var backupCodes: [String]?

    var displaySecret: String {
        let s = secret?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return s.isEmpty ? "—" : s
    }

    var resolvedQRCodeURL: URL? {
        guard let qrCodeUrl, !qrCodeUrl.isEmpty else { return nil }
        return URL(string: qrCodeUrl)
    }

    var hasSetupMaterial: Bool {
        let s = secret?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return !s.isEmpty || !(backupCodes ?? []).isEmpty || resolvedQRCodeURL != nil
    }

    /// Codes to re-submit on verify-setup (gateway requires the same list from enable).
    var resolvedBackupCodes: [String] {
        (backupCodes ?? []).map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
    }
}

/// `POST /mfa/verify-setup` and `DELETE /mfa/disable` → `{ "success": true }`.
struct MFAActionResponse: Codable, Sendable, Hashable {
    var success: Bool?

    var isSuccess: Bool { success == true }
}

// MARK: - Age gate helpers

enum AgeGateMath {
    static let minimumAgeYears = 18

    /// Calendar-age in full years for a DOB on `reference` (device local calendar).
    static func ageYears(dob: Date, reference: Date = Date(), calendar: Calendar = .current) -> Int? {
        let comps = calendar.dateComponents([.year], from: calendar.startOfDay(for: dob), to: calendar.startOfDay(for: reference))
        return comps.year
    }

    /// Formats a date as gateway `YYYY-MM-DD` in the given calendar.
    static func yyyyMMdd(_ date: Date, calendar: Calendar = .current) -> String {
        let c = calendar.dateComponents([.year, .month, .day], from: date)
        let y = c.year ?? 0
        let m = c.month ?? 0
        let d = c.day ?? 0
        return String(format: "%04d-%02d-%02d", y, m, d)
    }

    /// Latest DOB that is still at least `minimumAgeYears` old on `reference`.
    static func maximumEligibleDOB(reference: Date = Date(), calendar: Calendar = .current) -> Date {
        calendar.date(byAdding: .year, value: -minimumAgeYears, to: calendar.startOfDay(for: reference))
            ?? reference
    }
}

// MARK: - Trust tiers (public ladder)

/// Row from `GET /api/v1/trust/tiers` → `{ "tiers": [...] }`.
struct TrustTier: Codable, Sendable, Hashable, Identifiable {
    var tier: String?
    var description: String?
    var minCompletedJobs: Int?
    var minOverallScore: Double?
    var minRating: Double?
    var minReviews: Int?
    var requiresVerification: Bool?

    var id: String {
        let t = tier?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return t.isEmpty ? UUID().uuidString : t
    }

    var displayName: String {
        let t = tier?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if t.isEmpty { return "Tier" }
        return t.replacingOccurrences(of: "_", with: " ").capitalized
    }

    var displayDescription: String {
        let d = description?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return d.isEmpty ? "No description provided for this tier." : d
    }

    var scoreLabel: String {
        guard let minOverallScore else { return "—" }
        // Gateway stores overall score on a 0…1 scale; show as percentage when ≤ 1.
        if minOverallScore <= 1.0 {
            let pct = minOverallScore * 100
            return pct.formatted(.number.precision(.fractionLength(0...1))) + "%"
        }
        return minOverallScore.formatted(.number.precision(.fractionLength(0...2)))
    }

    var ratingLabel: String {
        guard let minRating else { return "—" }
        return minRating.formatted(.number.precision(.fractionLength(0...1))) + "★"
    }

    var jobsLabel: String {
        guard let minCompletedJobs else { return "—" }
        return minCompletedJobs == 1 ? "1 job" : "\(minCompletedJobs) jobs"
    }

    var reviewsLabel: String {
        guard let minReviews else { return "—" }
        return minReviews == 1 ? "1 review" : "\(minReviews) reviews"
    }

    /// Sort key: lower ranks first (under_review / new → top_rated).
    var sortRank: Int {
        switch (tier ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
        case "under_review": return 0
        case "new", "unspecified": return 1
        case "rising": return 2
        case "trusted": return 3
        case "top_rated": return 4
        default: return 50
        }
    }
}

struct TrustTiersResponse: Codable, Sendable {
    var tiers: [TrustTier]

    enum CodingKeys: String, CodingKey {
        case tiers
    }

    init(tiers: [TrustTier]) {
        self.tiers = tiers
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        tiers = try c.decodeIfPresent([TrustTier].self, forKey: .tiers) ?? []
    }
}

// MARK: - Subscription tiers (display / limits only — no IAP)

/// Row from `GET /api/v1/subscriptions/tiers` → `{ "tiers": [...] }`.
/// Read-only in the iOS client: no purchase / StoreKit.
/// Paid tiers may surface **Manage on web** (billing management) — never a buy CTA.
struct SubscriptionTier: Codable, Sendable, Hashable, Identifiable {
    /// Wire `id` from the gateway (UUID). Stored separately from `Identifiable.id`.
    var remoteId: String?
    var name: String?
    var slug: String?
    var monthlyPriceCents: Int64?
    var annualPriceCents: Int64?
    var feeDiscountPercentage: Double?
    var maxActiveBids: Int?
    var maxServiceCategories: Int?
    var featuredPlacement: Bool?
    var analyticsAccess: Bool?
    var prioritySupport: Bool?
    var verifiedBadgeBoost: Bool?
    var portfolioImageLimit: Int?
    var instantEnabled: Bool?
    var sortOrder: Int?
    var isActive: Bool?

    enum CodingKeys: String, CodingKey {
        case remoteId = "id"
        case name
        case slug
        case monthlyPriceCents
        case annualPriceCents
        case feeDiscountPercentage
        case maxActiveBids
        case maxServiceCategories
        case featuredPlacement
        case analyticsAccess
        case prioritySupport
        case verifiedBadgeBoost
        case portfolioImageLimit
        case instantEnabled
        case sortOrder
        case isActive
    }

    /// Stable list identity (UUID / slug / name).
    var id: String {
        let raw = remoteId?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !raw.isEmpty { return raw }
        let s = slug?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !s.isEmpty { return s }
        let n = name?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return n.isEmpty ? UUID().uuidString : n
    }

    var displayName: String {
        let n = name?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !n.isEmpty { return n }
        let s = slug?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return s.isEmpty ? "Plan" : s.replacingOccurrences(of: "_", with: " ").capitalized
    }

    /// True when listed monthly price is zero or missing (free tier).
    var isFree: Bool {
        (monthlyPriceCents ?? 0) <= 0
    }

    /// Free vs paid label — never a purchase CTA (App Store 3.1.1).
    var planKindLabel: String {
        isFree ? "Free" : "Paid (web-only)"
    }

    var maxActiveBidsLabel: String {
        guard let maxActiveBids else { return "—" }
        if maxActiveBids <= 0 { return "Unlimited" }
        return "\(maxActiveBids)"
    }

    var maxServiceCategoriesLabel: String {
        guard let maxServiceCategories else { return "—" }
        if maxServiceCategories <= 0 { return "Unlimited" }
        return "\(maxServiceCategories)"
    }

    var portfolioImageLimitLabel: String {
        guard let portfolioImageLimit else { return "—" }
        if portfolioImageLimit <= 0 { return "Unlimited" }
        return "\(portfolioImageLimit)"
    }

    var sortKey: Int {
        sortOrder ?? 999
    }
}

struct SubscriptionTiersResponse: Codable, Sendable {
    var tiers: [SubscriptionTier]

    enum CodingKeys: String, CodingKey {
        case tiers
    }

    init(tiers: [SubscriptionTier]) {
        self.tiers = tiers
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        tiers = try c.decodeIfPresent([SubscriptionTier].self, forKey: .tiers) ?? []
    }
}

// MARK: - Terms of Service (current + acceptance)

/// `GET /api/v1/tos/current` — public current ToS pointer.
struct ToSCurrent: Codable, Sendable, Hashable {
    var version: String?
    var bodyUrl: String?
    var effectiveAt: String?

    enum CodingKeys: String, CodingKey {
        case version
        case bodyUrl
        case effectiveAt
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        version = try c.decodeIfPresent(String.self, forKey: .version)
        bodyUrl = try c.decodeIfPresent(String.self, forKey: .bodyUrl)
        // effective_at may arrive as ISO string (or be pre-decoded via date strategy elsewhere).
        if let s = try? c.decodeIfPresent(String.self, forKey: .effectiveAt) {
            effectiveAt = s
        } else if let d = try? c.decodeIfPresent(Date.self, forKey: .effectiveAt) {
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            effectiveAt = formatter.string(from: d)
        } else {
            effectiveAt = nil
        }
    }

    var displayVersion: String {
        let v = version?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return v.isEmpty ? "—" : v
    }

    var effectiveAtLabel: String? {
        guard let effectiveAt, !effectiveAt.isEmpty else { return nil }
        return CatalogDateFormat.friendlyDateTime(effectiveAt)
    }

    /// Resolves relative `body_url` (e.g. `/terms`) against the public web base.
    var resolvedBodyURL: URL? {
        let raw = bodyUrl?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if raw.isEmpty {
            return AppConfig.termsURL
        }
        if raw.hasPrefix("http://") || raw.hasPrefix("https://") {
            return URL(string: raw)
        }
        var path = raw
        if path.hasPrefix("/") {
            path = String(path.dropFirst())
        }
        return AppConfig.publicWebBaseURL.appending(path: path)
    }
}

/// `GET /api/v1/me/tos-acceptance` — caller's latest acceptance (fields may be null).
struct ToSAcceptance: Codable, Sendable, Hashable {
    var tosVersion: String?
    var acceptedAt: String?

    var displayVersion: String {
        let v = tosVersion?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return v.isEmpty ? "Not accepted" : v
    }

    var hasAcceptedAny: Bool {
        let v = tosVersion?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return !v.isEmpty
    }

    var acceptedAtLabel: String? {
        guard let acceptedAt, !acceptedAt.isEmpty else { return nil }
        return CatalogDateFormat.friendlyDateTime(acceptedAt)
    }

    /// True when accepted version matches the current platform version.
    func isCurrent(relativeTo current: ToSCurrent) -> Bool {
        let accepted = tosVersion?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let latest = current.version?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !accepted.isEmpty, !latest.isEmpty else { return false }
        return accepted == latest
    }
}

/// `POST /api/v1/me/tos-acceptance` response.
struct ToSAcceptResponse: Codable, Sendable {
    var accepted: Bool?
    var tosVersion: String?
}
