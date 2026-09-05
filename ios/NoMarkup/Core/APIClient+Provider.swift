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

    /// PUT `/api/v1/providers/me/portfolio` — replace portfolio images (max ~20 server-side).
    /// Body: `{ "images": [ { "image_url", "caption", "sort_order" } ] }`.
    @discardableResult
    func updateMyProviderPortfolio(images: [ProviderPortfolioImageUpload]) async throws -> ProviderMeProfile {
        let body = UpdatePortfolioRequestBody(images: images)
        return try await putJSON(
            pathComponents: ["api", "v1", "providers", "me", "portfolio"],
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

    /// PUT `/api/v1/providers/me/availability` — instant-match enablement + available-now + weekly windows.
    ///
    /// Body: `{ enabled, available_now, schedule: [{ day, start_time, end_time }] }`.
    /// Day codes: `mon`…`sun`; times: `HH:MM`. Empty `schedule` writes SQL null and
    /// **clears** any previously saved windows — always re-send retained windows.
    /// Response: `{ "instant_enabled", "instant_available", "schedule" }`.
    /// Role: gateway `RequireProvider`. Hydrate saved windows from `GET /providers/me`
    /// (`schedule` array, owner-only gateway enrichment).
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

    // MARK: Instant match offers (provider inbox)

    /// GET `/api/v1/provider/offers` — pending Instant match jobs (provider role required).
    /// Server scans Redis for live offers; never fabricate offers client-side.
    func fetchProviderInstantOffers() async throws -> [ProviderInstantOffer] {
        let wrapped: ProviderInstantOffersResponse = try await getJSON(
            pathComponents: ["api", "v1", "provider", "offers"],
            authorized: true
        )
        return wrapped.offers ?? []
    }

    /// POST `/api/v1/provider/offers/{jobId}/accept` — first provider to accept wins.
    /// May mint a contract (`contract_id`). Provider role + live offer required.
    @discardableResult
    func acceptProviderInstantOffer(jobId: String) async throws -> ProviderInstantOfferActionResponse {
        let trimmed = jobId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "Job id is required.")
        }
        return try await postJSON(
            pathComponents: ["api", "v1", "provider", "offers", trimmed, "accept"],
            body: EmptyJSONObject(),
            authorized: .required
        )
    }

    /// POST `/api/v1/provider/offers/{jobId}/decline` — scoped to this provider only.
    @discardableResult
    func declineProviderInstantOffer(jobId: String) async throws -> ProviderInstantOfferActionResponse {
        let trimmed = jobId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "Job id is required.")
        }
        return try await postJSON(
            pathComponents: ["api", "v1", "provider", "offers", trimmed, "decline"],
            body: EmptyJSONObject(),
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

    // MARK: Quote templates

    /// GET `/api/v1/providers/me/quote-templates` → `{ "templates": [...] }`.
    func fetchMyQuoteTemplates() async throws -> [QuoteTemplate] {
        let wrapped: QuoteTemplatesResponse = try await getJSON(
            pathComponents: ["api", "v1", "providers", "me", "quote-templates"],
            authorized: true
        )
        return wrapped.templates ?? []
    }

    /// POST `/api/v1/providers/me/quote-templates` — create a reusable bid boilerplate.
    @discardableResult
    func createQuoteTemplate(
        name: String,
        body: String,
        defaultAmountCents: Int64? = nil,
        defaultDurationHours: Int? = nil
    ) async throws -> QuoteTemplate {
        let trimmedName = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedBody = body.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedName.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "Template name is required.")
        }
        guard !trimmedBody.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "Template body is required.")
        }
        guard trimmedBody.count <= 4000 else {
            throw APIClientError.httpStatus(400, detail: "Template body must be at most 4000 characters.")
        }
        if let defaultAmountCents, defaultAmountCents < 0 {
            throw APIClientError.httpStatus(400, detail: "Default amount must be non-negative.")
        }
        if let defaultDurationHours, defaultDurationHours < 0 {
            throw APIClientError.httpStatus(400, detail: "Default duration must be non-negative.")
        }
        let request = CreateQuoteTemplateRequestBody(
            name: trimmedName,
            body: trimmedBody,
            defaultAmountCents: defaultAmountCents,
            defaultDurationHours: defaultDurationHours
        )
        return try await postJSON(
            pathComponents: ["api", "v1", "providers", "me", "quote-templates"],
            body: request,
            authorized: .required
        )
    }

    /// DELETE `/api/v1/providers/me/quote-templates/{id}` — owner-scoped; 404 if missing.
    func deleteQuoteTemplate(id: String) async throws {
        let trimmed = id.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "Template id is required.")
        }
        let _: QuoteTemplateDeletedResponse = try await deleteJSON(
            pathComponents: ["api", "v1", "providers", "me", "quote-templates", trimmed],
            authorized: .required
        )
    }

    // MARK: Background check (FR-2.9 Checkr scaffold)

    /// GET `/api/v1/providers/me/background-check` — latest status or `not_started`.
    /// Gated by `background_checks` feature flag (503 when off / misconfigured).
    func fetchMyBackgroundCheck() async throws -> ProviderBackgroundCheck {
        try await getJSON(
            pathComponents: ["api", "v1", "providers", "me", "background-check"],
            authorized: true
        )
    }

    /// POST `/api/v1/providers/me/background-check` — request Checkr candidate/invitation.
    /// Fail-closed without `CHECKR_API_KEY` (503). Never invents a PASS client-side.
    @discardableResult
    func requestMyBackgroundCheck() async throws -> ProviderBackgroundCheck {
        try await postJSON(
            pathComponents: ["api", "v1", "providers", "me", "background-check"],
            body: EmptyJSONObject(),
            authorized: .required
        )
    }

    // MARK: Verification documents

    /// GET `/api/v1/providers/me/documents` → `{ "documents": [...] }`.
    func fetchMyProviderDocuments() async throws -> [ProviderVerificationDocument] {
        let wrapped: ProviderDocumentsResponse = try await getJSON(
            pathComponents: ["api", "v1", "providers", "me", "documents"],
            authorized: true
        )
        return wrapped.documents ?? []
    }

    /// POST `/api/v1/providers/me/documents` — register a previously uploaded storage object.
    ///
    /// Pipeline: `uploadImage(…, context: .document)` → this method.
    /// Gateway requires `file_url` under `documents/{callerUserID}/…` (owned object).
    /// Body: `{ document_type, file_url, file_name, mime_type, size_bytes, expires_at? }`.
    /// Response `201`: `{ document_id, status }`.
    @discardableResult
    func submitProviderDocument(
        documentType: String,
        fileURL: String,
        fileName: String,
        mimeType: String,
        sizeBytes: Int,
        expiresAt: String? = nil
    ) async throws -> ProviderDocumentUploadResult {
        let type = documentType.trimmingCharacters(in: .whitespacesAndNewlines)
        let url = fileURL.trimmingCharacters(in: .whitespacesAndNewlines)
        let name = fileName.trimmingCharacters(in: .whitespacesAndNewlines)
        let mime = mimeType.trimmingCharacters(in: .whitespacesAndNewlines)

        guard !type.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "document_type is required.")
        }
        guard ProviderDocumentType.isValidWireValue(type) else {
            throw APIClientError.httpStatus(400, detail: "Invalid document type.")
        }
        guard !url.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "file_url is required.")
        }
        guard !name.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "file_name is required.")
        }
        guard !mime.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "mime_type is required.")
        }
        guard sizeBytes > 0 else {
            throw APIClientError.httpStatus(400, detail: "size_bytes must be positive.")
        }
        // Match platform `MAX_FILE_SIZE_BYTES` / imaging 10 MB cap (also enforced on upload).
        let maxBytes = 10 * 1024 * 1024
        guard sizeBytes <= maxBytes else {
            throw APIClientError.httpStatus(400, detail: "Document must be 10 MB or smaller.")
        }

        let body = SubmitProviderDocumentRequest(
            documentType: type,
            fileUrl: url,
            fileName: name,
            mimeType: mime,
            sizeBytes: Int32(min(sizeBytes, Int(Int32.max))),
            expiresAt: expiresAt.flatMap { raw in
                let t = raw.trimmingCharacters(in: .whitespacesAndNewlines)
                return t.isEmpty ? nil : t
            }
        )
        return try await postJSON(
            pathComponents: ["api", "v1", "providers", "me", "documents"],
            body: body,
            authorized: .required
        )
    }

    /// Full verification-doc pipeline: imaging upload (`document` context) then register.
    ///
    /// Accepts image or PDF bytes (PDF is pass-through). Client enforces 10 MB;
    /// server re-validates MIME on confirm (magic bytes) and ownership on register.
    @discardableResult
    func uploadAndSubmitProviderDocument(
        data: Data,
        filename: String,
        mimeType: String,
        documentType: String,
        expiresAt: String? = nil
    ) async throws -> ProviderDocumentUploadResult {
        let confirmedURL = try await uploadImage(
            data: data,
            filename: filename,
            mimeType: mimeType,
            context: .document
        )
        return try await submitProviderDocument(
            documentType: documentType,
            fileURL: confirmedURL,
            fileName: filename,
            mimeType: mimeType,
            sizeBytes: data.count,
            expiresAt: expiresAt
        )
    }

    // MARK: Employees (team)

    /// GET `/api/v1/providers/me/employees` → `{ "employees": [...] }`.
    func fetchMyEmployees() async throws -> [ProviderEmployee] {
        let wrapped: ProviderEmployeesResponse = try await getJSON(
            pathComponents: ["api", "v1", "providers", "me", "employees"],
            authorized: true
        )
        return wrapped.employees ?? []
    }

    /// POST `/api/v1/providers/me/employees` — create a team member.
    @discardableResult
    func createEmployee(
        firstName: String,
        lastName: String,
        email: String? = nil,
        phone: String? = nil,
        role: String
    ) async throws -> ProviderEmployee {
        let first = firstName.trimmingCharacters(in: .whitespacesAndNewlines)
        let last = lastName.trimmingCharacters(in: .whitespacesAndNewlines)
        let roleTrimmed = role.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !first.isEmpty, !last.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "first_name and last_name are required.")
        }
        guard !roleTrimmed.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "role is required.")
        }
        struct Body: Encodable {
            var firstName: String
            var lastName: String
            var email: String?
            var phone: String?
            var role: String
            enum CodingKeys: String, CodingKey {
                case firstName = "first_name"
                case lastName = "last_name"
                case email, phone, role
            }
        }
        let emailTrimmed = email?.trimmingCharacters(in: .whitespacesAndNewlines)
        let phoneTrimmed = phone?.trimmingCharacters(in: .whitespacesAndNewlines)
        let body = Body(
            firstName: first,
            lastName: last,
            email: (emailTrimmed?.isEmpty == false) ? emailTrimmed : nil,
            phone: (phoneTrimmed?.isEmpty == false) ? phoneTrimmed : nil,
            role: roleTrimmed
        )
        let envelope: ProviderEmployeeEnvelope = try await postJSON(
            pathComponents: ["api", "v1", "providers", "me", "employees"],
            body: body,
            authorized: .required
        )
        return envelope.employee
    }

    /// DELETE `/api/v1/providers/me/employees/{id}`.
    func deleteEmployee(id: String) async throws {
        let trimmed = id.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "Employee id is required.")
        }
        try await deleteEmpty(
            pathComponents: ["api", "v1", "providers", "me", "employees", trimmed],
            authorized: .required
        )
    }

    // MARK: Challenges

    /// GET `/api/v1/challenges` — active challenges with optional progress (auth required).
    func fetchActiveChallenges() async throws -> [ProviderChallenge] {
        let wrapped: ChallengesResponse = try await getJSON(
            pathComponents: ["api", "v1", "challenges"],
            authorized: true
        )
        return wrapped.challenges ?? []
    }

    /// POST `/api/v1/challenges/{id}/join` — provider joins a challenge.
    @discardableResult
    func joinChallenge(id: String) async throws -> JoinChallengeResponse {
        let trimmed = id.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "Challenge id is required.")
        }
        return try await postJSON(
            pathComponents: ["api", "v1", "challenges", trimmed, "join"],
            body: EmptyJSONObject(),
            authorized: .required
        )
    }

}

// MARK: - Models (provider me)

/// `GET|PATCH /api/v1/providers/me` (and terms response) profile shape.
///
/// `schedule` is owner-only gateway enrichment on **GET** `/providers/me`
/// (from `provider_profiles.instant_schedule`). PATCH/terms responses omit it
/// — treat nil as "unchanged", empty array as "no windows saved".
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
    /// Owner GET only — weekly Instant windows (`day` mon…sun, times HH:MM)
    /// from SQL `instant_schedule`. Nil on PATCH/terms responses.
    var schedule: [ProviderAvailabilityWindow]?
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
        case schedule
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
        schedule = try c.decodeIfPresent([ProviderAvailabilityWindow].self, forKey: .schedule)
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
    /// Echoed from PUT body / post-write read (same shape as GET `/providers/me`).
    var schedule: [ProviderAvailabilityWindow]?
}

// MARK: - Instant match offer models

/// One pending Instant offer from `GET /api/v1/provider/offers`.
struct ProviderInstantOffer: Codable, Sendable, Hashable, Identifiable {
    var jobId: String?
    var jobTitle: String?
    var expiresAt: String?
    var amountCents: Int64?
    /// Approximate job site latitude (WGS84). Present when the job has geo.
    var approxLat: Double?
    /// Approximate job site longitude (WGS84). Present when the job has geo.
    var approxLng: Double?
    /// Soft urban-drive ETA minutes (server haversine heuristic). Nil when provider or job coords missing.
    /// Prefer MapKit on iOS when coords exist; display as "approx. drive time" — never claim live GPS tracking.
    var approxTravelMinutes: Int?

    /// Stable list identity — must never mint a fresh UUID per access (breaks ForEach).
    /// Incomplete wire rows use a deterministic fallback; UI filters them via `hasValidJobId`.
    var id: String {
        let j = jobId?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !j.isEmpty { return j }
        let title = jobTitle?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let exp = expiresAt?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let amount = amountCents.map(String.init) ?? ""
        let composite = [title, exp, amount].joined(separator: "|")
        return composite.isEmpty ? "instant-offer-unknown" : "instant-offer-\(composite)"
    }

    var displayTitle: String {
        let t = jobTitle?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return t.isEmpty ? "Emergency job" : t
    }

    var displayAmount: String {
        MoneyFormat.usd(cents: amountCents ?? 0)
    }

    /// Honest soft ETA label from server minutes only (haversine). Prefer
    /// `SoftTravelETA.resolve` + MapKit when caller has provider service coords.
    var approxTravelLabel: String? {
        SoftTravelETA.label(minutes: approxTravelMinutes, source: .server)
    }

    /// Parsed expiry; nil if missing / unparseable.
    var expiresAtDate: Date? {
        guard let raw = expiresAt?.trimmingCharacters(in: .whitespacesAndNewlines), !raw.isEmpty else {
            return nil
        }
        return CatalogDateFormat.parseISO(raw)
    }

    var isExpired: Bool {
        guard let date = expiresAtDate else { return false }
        return date.timeIntervalSinceNow <= 0
    }

    var hasValidJobId: Bool {
        let j = jobId?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return !j.isEmpty
    }
}

struct ProviderInstantOffersResponse: Codable, Sendable {
    var offers: [ProviderInstantOffer]?
}

/// Accept/decline response (`status`, optional `contract_id`).
struct ProviderInstantOfferActionResponse: Codable, Sendable, Hashable {
    var status: String?
    var contractId: String?

    var displayStatus: String {
        let s = status?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return s.isEmpty ? "ok" : s
    }
}

/// Weekly Instant window for `PUT|GET /providers/me` availability schedule.
/// `day`: mon|tue|wed|thu|fri|sat|sun · `startTime`/`endTime`: `HH:MM` (local).
struct ProviderAvailabilityWindow: Codable, Sendable, Hashable {
    var day: String
    var startTime: String
    var endTime: String

    enum CodingKeys: String, CodingKey {
        case day
        case startTime
        case endTime
    }

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

/// Portfolio image for `PUT /providers/me/portfolio`.
struct ProviderPortfolioImageUpload: Encodable, Sendable, Hashable {
    let imageUrl: String
    let caption: String
    let sortOrder: Int32
}

private struct UpdatePortfolioRequestBody: Encodable {
    let images: [ProviderPortfolioImageUpload]
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

// MARK: - Quote templates

/// Row from `GET|POST /api/v1/providers/me/quote-templates`.
struct QuoteTemplate: Codable, Sendable, Hashable, Identifiable {
    let id: String
    var userId: String?
    var name: String?
    var body: String?
    var defaultAmountCents: Int64?
    var defaultDurationHours: Int?
    var useCount: Int?
    var createdAt: String?

    enum CodingKeys: String, CodingKey {
        case id
        case userId
        case name
        case body
        case defaultAmountCents
        case defaultDurationHours
        case useCount
        case createdAt
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let rawId = try c.decodeIfPresent(String.self, forKey: .id) ?? ""
        id = rawId.isEmpty ? UUID().uuidString : rawId
        userId = try c.decodeIfPresent(String.self, forKey: .userId)
        name = try c.decodeIfPresent(String.self, forKey: .name)
        body = try c.decodeIfPresent(String.self, forKey: .body)
        if let v = try? c.decodeIfPresent(Int64.self, forKey: .defaultAmountCents) {
            defaultAmountCents = v
        } else if let v = try? c.decodeIfPresent(Int.self, forKey: .defaultAmountCents) {
            defaultAmountCents = Int64(v)
        } else {
            defaultAmountCents = nil
        }
        if let v = try? c.decodeIfPresent(Int.self, forKey: .defaultDurationHours) {
            defaultDurationHours = v
        } else if let v = try? c.decodeIfPresent(Int64.self, forKey: .defaultDurationHours) {
            defaultDurationHours = Int(v)
        } else {
            defaultDurationHours = nil
        }
        if let v = try? c.decodeIfPresent(Int.self, forKey: .useCount) {
            useCount = v
        } else if let v = try? c.decodeIfPresent(Int64.self, forKey: .useCount) {
            useCount = Int(v)
        } else {
            useCount = nil
        }
        // created_at may be ISO8601 string or decoded via flexible strategies.
        if let s = try? c.decodeIfPresent(String.self, forKey: .createdAt) {
            createdAt = s
        } else if let d = try? c.decodeIfPresent(Date.self, forKey: .createdAt) {
            createdAt = ISO8601DateFormatter().string(from: d)
        } else {
            createdAt = nil
        }
    }

    var displayName: String {
        let n = name?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return n.isEmpty ? "Untitled template" : n
    }

    var displayBodyPreview: String {
        let b = body?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if b.isEmpty { return "No body" }
        if b.count <= 120 { return b }
        return String(b.prefix(117)) + "…"
    }

    var displayDefaultAmount: String? {
        guard let cents = defaultAmountCents else { return nil }
        return MoneyFormat.usd(cents: cents)
    }

    var displayUseCount: String {
        let n = useCount ?? 0
        return String(localized: "Used \(n) times")
    }
}

struct QuoteTemplatesResponse: Codable, Sendable {
    var templates: [QuoteTemplate]?
}

struct QuoteTemplateDeletedResponse: Codable, Sendable {
    var deleted: Bool?
}

private struct CreateQuoteTemplateRequestBody: Encodable {
    let name: String
    let body: String
    let defaultAmountCents: Int64?
    let defaultDurationHours: Int?

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(name, forKey: .name)
        try c.encode(body, forKey: .body)
        if let defaultAmountCents {
            try c.encode(defaultAmountCents, forKey: .defaultAmountCents)
        }
        if let defaultDurationHours {
            try c.encode(defaultDurationHours, forKey: .defaultDurationHours)
        }
    }

    private enum CodingKeys: String, CodingKey {
        case name
        case body
        case defaultAmountCents
        case defaultDurationHours
    }
}

// MARK: - Verification documents

/// Wire values accepted by user-service `isValidDocumentType`.
enum ProviderDocumentType: String, CaseIterable, Sendable, Identifiable {
    case driversLicense = "drivers_license"
    case businessLicense = "business_license"
    case ein = "ein"
    case insurance = "insurance"
    case tradeLicense = "trade_license"

    var id: String { rawValue }

    var displayLabel: String {
        switch self {
        case .driversLicense: return "Driver’s license / ID"
        case .businessLicense: return "Business license"
        case .ein: return "EIN / tax ID document"
        case .insurance: return "Proof of insurance"
        case .tradeLicense: return "Trade license"
        }
    }

    var detail: String {
        switch self {
        case .driversLicense:
            return "Government-issued photo ID used to verify your identity."
        case .businessLicense:
            return "Business registration or operating license certificate."
        case .ein:
            return "EIN letter or tax ID paperwork for your business."
        case .insurance:
            return "Liability insurance or bonding documentation."
        case .tradeLicense:
            return "Electrician, plumber, contractor, or other trade credential."
        }
    }

    static func isValidWireValue(_ value: String) -> Bool {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return allCases.contains { $0.rawValue == trimmed }
    }
}

/// `POST /api/v1/providers/me/documents` body (snake_case via encoder).
struct SubmitProviderDocumentRequest: Encodable, Sendable {
    let documentType: String
    let fileUrl: String
    let fileName: String
    let mimeType: String
    let sizeBytes: Int32
    var expiresAt: String?
}

/// `201` create response from document register.
struct ProviderDocumentUploadResult: Codable, Sendable, Hashable {
    var documentId: String?
    var status: String?

    var displayStatus: String {
        StatusChipStyle.displayLabel(status ?? "pending")
    }
}

/// Row from `GET /api/v1/providers/me/documents`.
// MARK: - Background check (FR-2.9)

/// Latest provider background-check status from Checkr scaffold.
/// Status values are vendor-shaped (`pending`, `clear`, `consider`, …) —
/// never invent "passed" / PASS client-side.
struct ProviderBackgroundCheck: Codable, Sendable, Hashable {
    var status: String?
    var checkrId: String?
    var reportUrl: String?
    var invitationUrl: String?
    var createdAt: String?
    var updatedAt: String?

    var normalizedStatus: String {
        let s = status?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() ?? ""
        return s.isEmpty ? "not_started" : s
    }

    var isNotStarted: Bool {
        let s = normalizedStatus
        return s == "not_started" || s == "none"
    }

    var isPending: Bool {
        let s = normalizedStatus
        return s == "pending" || s == "complete"
    }

    /// Human status for UI — mirrors Checkr wording; never "PASS".
    var displayStatus: String {
        switch normalizedStatus {
        case "not_started", "none": return "Not started"
        case "pending": return "Pending"
        case "clear": return "Clear"
        case "consider": return "Consider"
        case "suspended": return "Suspended"
        case "canceled", "cancelled": return "Canceled"
        case "dispute": return "Dispute"
        case "complete": return "Complete (awaiting result)"
        default: return normalizedStatus.replacingOccurrences(of: "_", with: " ").capitalized
        }
    }

    var canRequest: Bool {
        switch normalizedStatus {
        case "not_started", "none", "canceled", "cancelled", "suspended":
            return true
        default:
            return false
        }
    }

    /// Checkr hosted invitation when the gateway returned one. Never synthesized.
    var openableInvitationURL: URL? {
        let raw = (invitationUrl ?? reportUrl)?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard let url = URL(string: raw),
              let scheme = url.scheme?.lowercased(),
              scheme == "https" || scheme == "http"
        else { return nil }
        return url
    }
}

struct ProviderVerificationDocument: Codable, Sendable, Hashable, Identifiable {
    let id: String
    var documentType: String?
    var status: String?
    var resubmissionCount: Int?
    var rejectionReason: String?
    var expiresAt: String?

    enum CodingKeys: String, CodingKey {
        case id
        case documentType
        case status
        case resubmissionCount
        case rejectionReason
        case expiresAt
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let rawId = try c.decodeIfPresent(String.self, forKey: .id) ?? ""
        let type = try c.decodeIfPresent(String.self, forKey: .documentType)
        // Some status-only rows may omit id; fall back to type for list identity.
        if rawId.isEmpty {
            let fallback = type?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            id = fallback.isEmpty ? UUID().uuidString : fallback
        } else {
            id = rawId
        }
        documentType = type
        status = try c.decodeIfPresent(String.self, forKey: .status)
        if let v = try? c.decodeIfPresent(Int.self, forKey: .resubmissionCount) {
            resubmissionCount = v
        } else if let v = try? c.decodeIfPresent(Int64.self, forKey: .resubmissionCount) {
            resubmissionCount = Int(v)
        } else {
            resubmissionCount = nil
        }
        rejectionReason = try c.decodeIfPresent(String.self, forKey: .rejectionReason)
        expiresAt = try c.decodeIfPresent(String.self, forKey: .expiresAt)
    }

    var displayType: String {
        let t = documentType?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if t.isEmpty { return "Document" }
        return t.replacingOccurrences(of: "_", with: " ").capitalized
    }

    var displayStatus: String {
        StatusChipStyle.displayLabel(status ?? "unknown")
    }

    var statusStyle: StatusChipStyle {
        StatusChipStyle.forStatus(status)
    }

    // MARK: FR-2.8 — document expiration

    /// Parsed `expires_at` from the documents API; nil if missing / unparseable.
    var expiresAtDate: Date? {
        guard let raw = expiresAt?.trimmingCharacters(in: .whitespacesAndNewlines), !raw.isEmpty else {
            return nil
        }
        return CatalogDateFormat.parseISO(raw)
    }

    /// True when `expires_at` is present and ≤ now.
    var isExpired: Bool {
        guard let date = expiresAtDate else { return false }
        return date.timeIntervalSinceNow <= 0
    }

    /// FR-2.8: alert window — present, not yet expired, and within 30 days.
    var isExpiringWithin30Days: Bool {
        guard let date = expiresAtDate, !isExpired else { return false }
        let thirtyDays: TimeInterval = 30 * 24 * 60 * 60
        return date.timeIntervalSinceNow <= thirtyDays
    }

    /// Days remaining until expiry (0 if expired today or past; nil if no date).
    var daysUntilExpiry: Int? {
        guard let date = expiresAtDate else { return nil }
        if date.timeIntervalSinceNow <= 0 { return 0 }
        return Int(ceil(date.timeIntervalSinceNow / (24 * 60 * 60)))
    }

    // MARK: FR-2.10 — resubmission hard lockout

    /// Max rejections/resubmits per document type (server enforces the same).
    static let maxResubmissions = 3

    /// True when `resubmission_count >= 3` — further uploads for this type are blocked.
    var isResubmissionLocked: Bool {
        (resubmissionCount ?? 0) >= Self.maxResubmissions
    }

    /// Remaining re-uploads after rejections (0 when locked or unknown count treated as unlimited remaining for display only).
    var resubmissionsRemaining: Int {
        max(0, Self.maxResubmissions - (resubmissionCount ?? 0))
    }
}

struct ProviderDocumentsResponse: Codable, Sendable {
    var documents: [ProviderVerificationDocument]?
}

// MARK: - Bid analytics (job reverse-auction)

/// `GET /api/v1/bids/analytics?job_id=` response.
struct BidAnalytics: Codable, Sendable, Hashable {
    var totalBids: Int?
    var lowestBidCents: Int64?
    var highestBidCents: Int64?
    var medianBidCents: Int64?
    var offerAcceptedCount: Int?
    var firstBidAt: String?
    var lastBidAt: String?

    var displayLowest: String {
        MoneyFormat.usd(cents: lowestBidCents ?? 0)
    }

    var displayHighest: String {
        MoneyFormat.usd(cents: highestBidCents ?? 0)
    }

    var displayMedian: String {
        MoneyFormat.usd(cents: medianBidCents ?? 0)
    }
}
