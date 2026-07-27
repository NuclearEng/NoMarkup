import Foundation

// MARK: - Provider workspace (me) APIs
//
// Gateway: GET/PATCH `/api/v1/providers/me`, terms/categories/availability,
// streaks, licenses. Role-gated (`RequireProvider`). Snake_case via
// `perform` convertToSnakeCase / decoder convertFromSnakeCase.

extension APIClient {
    // MARK: Profile

    /// GET `/api/v1/providers/me` — authenticated provider's own profile.
    func fetchMyProviderProfile() async throws -> ProviderMeProfile {
        try await getJSON(
            pathComponents: ["api", "v1", "providers", "me"],
            authorized: true
        )
    }

    /// PATCH `/api/v1/providers/me` — update bio / business name (and optional geo fields).
    /// Omitted keys stay unchanged server-side.
    @discardableResult
    func updateMyProviderProfile(
        businessName: String? = nil,
        bio: String? = nil,
        serviceAddress: String? = nil,
        latitude: Double? = nil,
        longitude: Double? = nil,
        serviceRadiusKm: Double? = nil
    ) async throws -> ProviderMeProfile {
        let body = UpdateProviderMeRequestBody(
            businessName: businessName.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) },
            bio: bio.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) },
            serviceAddress: serviceAddress.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) },
            latitude: latitude,
            longitude: longitude,
            serviceRadiusKm: serviceRadiusKm
        )
        return try await patchJSON(
            pathComponents: ["api", "v1", "providers", "me"],
            body: body,
            authorized: .required
        )
    }

    // MARK: Terms / categories / availability

    /// PUT `/api/v1/providers/me/terms` — default contract terms for new awards.
    @discardableResult
    func setMyProviderTerms(
        paymentTiming: String,
        cancellationPolicy: String,
        warrantyTerms: String,
        milestones: [ProviderMilestoneTemplate] = []
    ) async throws -> ProviderMeProfile {
        let body = SetProviderTermsRequestBody(
            paymentTiming: paymentTiming.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(),
            milestones: milestones,
            cancellationPolicy: cancellationPolicy.trimmingCharacters(in: .whitespacesAndNewlines),
            warrantyTerms: warrantyTerms.trimmingCharacters(in: .whitespacesAndNewlines)
        )
        return try await putJSON(
            pathComponents: ["api", "v1", "providers", "me", "terms"],
            body: body,
            authorized: .required
        )
    }

    /// PUT `/api/v1/providers/me/categories` — replace service category membership.
    @discardableResult
    func updateMyProviderCategories(categoryIDs: [String]) async throws -> ProviderCategoriesResponse {
        let cleaned = categoryIDs
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        let body = UpdateProviderCategoriesRequestBody(categoryIds: cleaned)
        return try await putJSON(
            pathComponents: ["api", "v1", "providers", "me", "categories"],
            body: body,
            authorized: .required
        )
    }

    /// PUT `/api/v1/providers/me/availability` — instant-match enablement + available-now.
    /// Response: `{ "instant_enabled", "instant_available" }`.
    @discardableResult
    func setMyProviderAvailability(
        enabled: Bool,
        availableNow: Bool,
        schedule: [ProviderAvailabilityWindow] = []
    ) async throws -> ProviderAvailabilityResponse {
        let body = SetProviderAvailabilityRequestBody(
            enabled: enabled,
            availableNow: availableNow,
            schedule: schedule
        )
        return try await putJSON(
            pathComponents: ["api", "v1", "providers", "me", "availability"],
            body: body,
            authorized: .required
        )
    }

    // MARK: Streaks

    /// GET `/api/v1/providers/me/streaks` — raw JSON array of streak rows.
    func fetchMyProviderStreaks() async throws -> ProviderStreaks {
        let items: [ProviderStreak] = try await getJSON(
            pathComponents: ["api", "v1", "providers", "me", "streaks"],
            authorized: true
        )
        return ProviderStreaks(items: items)
    }

    // MARK: Licenses

    /// GET `/api/v1/providers/me/licenses` → `{ "licenses": [...] }`.
    func fetchMyProviderLicenses() async throws -> [ProviderLicense] {
        let wrapped: ProviderLicensesResponse = try await getJSON(
            pathComponents: ["api", "v1", "providers", "me", "licenses"],
            authorized: true
        )
        return wrapped.licenses ?? []
    }

    /// POST `/api/v1/providers/me/licenses` — submit a professional license (pending review).
    /// Wire body: `license_type` (currently `bar`), `license_number`, `jurisdiction` (2-letter).
    @discardableResult
    func submitMyProviderLicense(
        licenseType: String,
        licenseNumber: String,
        jurisdiction: String
    ) async throws -> ProviderLicense {
        let type = licenseType.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let number = licenseNumber.trimmingCharacters(in: .whitespacesAndNewlines)
        let juris = jurisdiction.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        guard !type.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "license_type is required.")
        }
        guard !number.isEmpty, number.count <= 100 else {
            throw APIClientError.httpStatus(400, detail: "license_number is required (max 100 chars).")
        }
        guard juris.count == 2 else {
            throw APIClientError.httpStatus(400, detail: "jurisdiction must be a 2-letter state code.")
        }
        let body = SubmitProviderLicenseRequestBody(
            licenseType: type,
            licenseNumber: number,
            jurisdiction: juris
        )
        return try await postJSON(
            pathComponents: ["api", "v1", "providers", "me", "licenses"],
            body: body,
            authorized: .required
        )
    }
}

// MARK: - Models (provider me)

/// `GET|PATCH /api/v1/providers/me` (and terms response) profile shape.
struct ProviderMeProfile: Codable, Sendable, Hashable, Identifiable {
    var id: String
    var userId: String?
    var businessName: String?
    var bio: String?
    var serviceAddress: String?
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
    var serviceCategories: [ProviderCategorySummary]?
    var defaultMilestones: [ProviderMilestoneTemplate]?
    var portfolio: [ProviderPortfolioImage]?
    var serviceLocation: ProviderServiceLocation?

    enum CodingKeys: String, CodingKey {
        case id
        case userId
        case businessName
        case bio
        case serviceAddress
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
        case serviceCategories
        case defaultMilestones
        case portfolio
        case serviceLocation
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
        businessName = try c.decodeIfPresent(String.self, forKey: .businessName)
        bio = try c.decodeIfPresent(String.self, forKey: .bio)
        serviceAddress = try c.decodeIfPresent(String.self, forKey: .serviceAddress)
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
        serviceCategories = try c.decodeIfPresent([ProviderCategorySummary].self, forKey: .serviceCategories)
        defaultMilestones = try c.decodeIfPresent([ProviderMilestoneTemplate].self, forKey: .defaultMilestones)
        portfolio = try c.decodeIfPresent([ProviderPortfolioImage].self, forKey: .portfolio)
        serviceLocation = try c.decodeIfPresent(ProviderServiceLocation.self, forKey: .serviceLocation)
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

    var displayBusinessName: String {
        let name = businessName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return name.isEmpty ? "Your business" : name
    }

    var isInstantAvailable: Bool {
        instantAvailable == true
    }

    var isInstantEnabled: Bool {
        instantEnabled == true
    }
}

struct ProviderServiceLocation: Codable, Sendable, Hashable {
    var latitude: Double?
    var longitude: Double?
}

struct ProviderMilestoneTemplate: Codable, Sendable, Hashable {
    var description: String?
    var percentage: Int?

    init(description: String? = nil, percentage: Int? = nil) {
        self.description = description
        self.percentage = percentage
    }
}

/// Single row from `GET /api/v1/providers/me/streaks` (raw array).
struct ProviderStreak: Codable, Sendable, Hashable, Identifiable {
    let id: String
    var providerId: String?
    var categoryId: String?
    var currentStreak: Int?
    var longestStreak: Int?
    var totalWins: Int?
    var categoryRank: Int?
    var updatedAt: String?

    enum CodingKeys: String, CodingKey {
        case id
        case providerId
        case categoryId
        case currentStreak
        case longestStreak
        case totalWins
        case categoryRank
        case updatedAt
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let rawId = try c.decodeIfPresent(String.self, forKey: .id) ?? ""
        id = rawId.isEmpty ? UUID().uuidString : rawId
        providerId = try c.decodeIfPresent(String.self, forKey: .providerId)
        categoryId = try c.decodeIfPresent(String.self, forKey: .categoryId)
        currentStreak = Self.decodeFlexibleInt(c, forKey: .currentStreak)
        longestStreak = Self.decodeFlexibleInt(c, forKey: .longestStreak)
        totalWins = Self.decodeFlexibleInt(c, forKey: .totalWins)
        categoryRank = Self.decodeFlexibleInt(c, forKey: .categoryRank)
        updatedAt = try c.decodeIfPresent(String.self, forKey: .updatedAt)
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

    var displayCategory: String {
        let cat = categoryId?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if cat.isEmpty { return "Overall" }
        if cat.count <= 12 { return cat }
        return String(cat.prefix(8)) + "…"
    }
}

/// Aggregate for the me/streaks endpoint.
struct ProviderStreaks: Codable, Sendable, Hashable {
    let items: [ProviderStreak]

    init(items: [ProviderStreak]) {
        self.items = items
    }

    var isEmpty: Bool { items.isEmpty }
}

/// Owner-scoped professional license row (`GET|POST /providers/me/licenses`).
struct ProviderLicense: Codable, Sendable, Hashable, Identifiable {
    let id: String
    var providerId: String?
    var licenseType: String?
    var licenseNumber: String?
    var jurisdiction: String?
    var status: String?
    var verifiedBy: String?
    var verifiedAt: String?
    var createdAt: String?
    var updatedAt: String?

    enum CodingKeys: String, CodingKey {
        case id
        case providerId
        case licenseType
        case licenseNumber
        case jurisdiction
        case status
        case verifiedBy
        case verifiedAt
        case createdAt
        case updatedAt
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let rawId = try c.decodeIfPresent(String.self, forKey: .id) ?? ""
        id = rawId.isEmpty ? UUID().uuidString : rawId
        providerId = try c.decodeIfPresent(String.self, forKey: .providerId)
        licenseType = try c.decodeIfPresent(String.self, forKey: .licenseType)
        licenseNumber = try c.decodeIfPresent(String.self, forKey: .licenseNumber)
        jurisdiction = try c.decodeIfPresent(String.self, forKey: .jurisdiction)
        status = try c.decodeIfPresent(String.self, forKey: .status)
        verifiedBy = try c.decodeIfPresent(String.self, forKey: .verifiedBy)
        verifiedAt = try c.decodeIfPresent(String.self, forKey: .verifiedAt)
        createdAt = try c.decodeIfPresent(String.self, forKey: .createdAt)
        updatedAt = try c.decodeIfPresent(String.self, forKey: .updatedAt)
    }

    var displayType: String {
        let t = licenseType?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return t.isEmpty ? "License" : t.replacingOccurrences(of: "_", with: " ").capitalized
    }

    var displayStatus: String {
        StatusChipStyle.displayLabel(status ?? "unknown")
    }

    var statusStyle: StatusChipStyle {
        StatusChipStyle.forStatus(status)
    }

    /// Last-4 projection for list UI (owner responses may include full number).
    var maskedNumber: String {
        let n = licenseNumber?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if n.isEmpty { return "—" }
        if n.count <= 4 { return n }
        return "••••" + String(n.suffix(4))
    }

    var displayJurisdiction: String {
        let j = jurisdiction?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return j.isEmpty ? "—" : j.uppercased()
    }
}

struct ProviderLicensesResponse: Codable, Sendable {
    var licenses: [ProviderLicense]?
}

struct ProviderCategoriesResponse: Codable, Sendable {
    var categories: [ProviderCategorySummary]?
}

struct ProviderAvailabilityResponse: Codable, Sendable, Hashable {
    var instantEnabled: Bool?
    var instantAvailable: Bool?
}

struct ProviderAvailabilityWindow: Codable, Sendable, Hashable {
    var day: String
    var startTime: String
    var endTime: String

    init(day: String, startTime: String, endTime: String) {
        self.day = day
        self.startTime = startTime
        self.endTime = endTime
    }
}

// MARK: - Request bodies

private struct UpdateProviderMeRequestBody: Encodable {
    var businessName: String?
    var bio: String?
    var serviceAddress: String?
    var latitude: Double?
    var longitude: Double?
    var serviceRadiusKm: Double?

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        // Only emit present keys so omitted fields stay unchanged server-side.
        if let businessName { try c.encode(businessName, forKey: .businessName) }
        if let bio { try c.encode(bio, forKey: .bio) }
        if let serviceAddress { try c.encode(serviceAddress, forKey: .serviceAddress) }
        if let latitude { try c.encode(latitude, forKey: .latitude) }
        if let longitude { try c.encode(longitude, forKey: .longitude) }
        if let serviceRadiusKm { try c.encode(serviceRadiusKm, forKey: .serviceRadiusKm) }
    }

    private enum CodingKeys: String, CodingKey {
        case businessName
        case bio
        case serviceAddress
        case latitude
        case longitude
        case serviceRadiusKm
    }
}

private struct SetProviderTermsRequestBody: Encodable {
    let paymentTiming: String
    let milestones: [ProviderMilestoneTemplate]
    let cancellationPolicy: String
    let warrantyTerms: String
}

private struct UpdateProviderCategoriesRequestBody: Encodable {
    let categoryIds: [String]
}

private struct SetProviderAvailabilityRequestBody: Encodable {
    let enabled: Bool
    let availableNow: Bool
    let schedule: [ProviderAvailabilityWindow]
}

private struct SubmitProviderLicenseRequestBody: Encodable {
    let licenseType: String
    let licenseNumber: String
    let jurisdiction: String
}
