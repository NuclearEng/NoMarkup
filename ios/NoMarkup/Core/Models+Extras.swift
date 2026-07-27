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
struct ProviderTrustSummary: Codable, Sendable, Hashable {
    var overallScore: Double?
    var tier: String?

    var displayTier: String {
        let t = tier?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return t.isEmpty ? "—" : t.replacingOccurrences(of: "_", with: " ").capitalized
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

// MARK: - Auth / password change

struct ChangePasswordResponse: Codable, Sendable {
    var success: Bool?
}
