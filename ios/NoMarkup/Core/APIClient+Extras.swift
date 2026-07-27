import Foundation

// MARK: - Consumer API extras
//
// Providers, properties, wishlist, blocks, referrals, notification prefs,
// payment methods, Stripe Connect, age status, markets, listing cancel,
// user report, similar listings. Reuses getJSON / postJSON / putJSON /
// deleteEmpty / postEmpty + AuthMode from APIClient.

extension APIClient {
    // MARK: Providers

    /// GET `/api/v1/providers/search?q=&page=&page_size=` — public directory.
    func searchProviders(
        q: String? = nil,
        page: Int = 1,
        pageSize: Int = 20
    ) async throws -> ProvidersSearchResponse {
        var items = [
            URLQueryItem(name: "page", value: String(max(1, page))),
            URLQueryItem(name: "page_size", value: String(min(max(1, pageSize), 100))),
        ]
        if let q {
            let trimmed = q.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmed.isEmpty {
                items.append(URLQueryItem(name: "q", value: trimmed))
            }
        }
        return try await getJSON(
            pathComponents: ["api", "v1", "providers", "search"],
            query: items,
            authorized: false
        )
    }

    /// GET `/api/v1/providers/{id}` — public provider profile.
    func fetchProvider(id: String) async throws -> ProviderProfileDetail {
        let trimmed = id.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "Provider id is required.")
        }
        return try await getJSON(
            pathComponents: ["api", "v1", "providers", trimmed],
            authorized: false
        )
    }

    // MARK: Properties

    /// GET `/api/v1/properties` — caller's service locations.
    func fetchProperties() async throws -> PropertiesResponse {
        try await getJSON(
            pathComponents: ["api", "v1", "properties"],
            authorized: true
        )
    }

    /// POST `/api/v1/properties` — create a service location.
    @discardableResult
    func createProperty(
        nickname: String,
        street: String,
        city: String,
        state: String,
        zip: String,
        notes: String = "",
        isPrimary: Bool = false
    ) async throws -> PropertyItem {
        let body = CreatePropertyRequestBody(
            nickname: nickname.trimmingCharacters(in: .whitespacesAndNewlines),
            address: CreatePropertyAddressBody(
                street: street.trimmingCharacters(in: .whitespacesAndNewlines),
                city: city.trimmingCharacters(in: .whitespacesAndNewlines),
                state: state.trimmingCharacters(in: .whitespacesAndNewlines),
                zipCode: zip.trimmingCharacters(in: .whitespacesAndNewlines)
            ),
            notes: notes.trimmingCharacters(in: .whitespacesAndNewlines),
            isPrimary: isPrimary
        )
        return try await postJSON(
            pathComponents: ["api", "v1", "properties"],
            body: body,
            authorized: .required
        )
    }

    /// DELETE `/api/v1/properties/{id}` — 204 No Content.
    func deleteProperty(id: String) async throws {
        let trimmed = id.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "Property id is required.")
        }
        try await deleteEmpty(
            pathComponents: ["api", "v1", "properties", trimmed],
            authorized: .required
        )
    }

    // MARK: Wishlist

    /// GET `/api/v1/me/wishlist`
    func fetchWishlist() async throws -> WishlistResponse {
        try await getJSON(
            pathComponents: ["api", "v1", "me", "wishlist"],
            authorized: true
        )
    }

    /// POST `/api/v1/me/wishlist` — body: keyword, max_price_cents, optional category_id.
    @discardableResult
    func createWishlistItem(
        keyword: String,
        maxPriceCents: Int64,
        categoryId: String? = nil
    ) async throws -> WishlistItem {
        let trimmedKeyword = keyword.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedKeyword.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "keyword is required")
        }
        guard maxPriceCents > 0 else {
            throw APIClientError.httpStatus(400, detail: "max_price_cents must be positive")
        }
        let cat = categoryId?.trimmingCharacters(in: .whitespacesAndNewlines)
        let body = CreateWishlistItemBody(
            keyword: trimmedKeyword,
            maxPriceCents: maxPriceCents,
            categoryId: (cat?.isEmpty == false) ? cat : nil
        )
        let wrapped: WishlistItemEnvelope = try await postJSON(
            pathComponents: ["api", "v1", "me", "wishlist"],
            body: body,
            authorized: .required
        )
        guard let item = wrapped.wishlistItem else {
            throw APIClientError.decoding("Create wishlist response missing wishlist_item")
        }
        return item
    }

    /// DELETE `/api/v1/me/wishlist/{id}`
    func deleteWishlistItem(id: String) async throws {
        let trimmed = id.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "Wishlist item id is required.")
        }
        try await deleteEmpty(
            pathComponents: ["api", "v1", "me", "wishlist", trimmed],
            authorized: .required
        )
    }

    // MARK: Blocks

    /// GET `/api/v1/me/blocks`
    func fetchBlocks() async throws -> BlocksResponse {
        try await getJSON(
            pathComponents: ["api", "v1", "me", "blocks"],
            authorized: true
        )
    }

    /// POST `/api/v1/users/{id}/block` — optional reason.
    func blockUser(id: String, reason: String? = nil) async throws {
        let trimmed = id.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "User id is required.")
        }
        let reasonTrimmed = reason?.trimmingCharacters(in: .whitespacesAndNewlines)
        if let reasonTrimmed, !reasonTrimmed.isEmpty {
            try await postEmpty(
                pathComponents: ["api", "v1", "users", trimmed, "block"],
                body: BlockUserBody(reason: reasonTrimmed),
                authorized: .required
            )
        } else {
            try await postEmpty(
                pathComponents: ["api", "v1", "users", trimmed, "block"],
                body: EmptyJSONObject(),
                authorized: .required
            )
        }
    }

    /// DELETE `/api/v1/users/{id}/block`
    func unblockUser(id: String) async throws {
        let trimmed = id.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "User id is required.")
        }
        try await deleteEmpty(
            pathComponents: ["api", "v1", "users", trimmed, "block"],
            authorized: .required
        )
    }

    // MARK: Referrals

    /// GET `/api/v1/me/referrals/code`
    func fetchReferralCode() async throws -> ReferralCodeInfo {
        try await getJSON(
            pathComponents: ["api", "v1", "me", "referrals", "code"],
            authorized: true
        )
    }

    /// POST `/api/v1/me/referrals/redeem` with `{"code":"..."}`.
    @discardableResult
    func redeemReferralCode(code: String) async throws -> RedeemReferralResponse {
        let trimmed = code.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "code is required")
        }
        return try await postJSON(
            pathComponents: ["api", "v1", "me", "referrals", "redeem"],
            body: RedeemReferralBody(code: trimmed),
            authorized: .required
        )
    }

    // MARK: Notification preferences

    /// GET `/api/v1/notifications/preferences`
    func fetchNotificationPreferences() async throws -> NotificationPreferencesResponse {
        try await getJSON(
            pathComponents: ["api", "v1", "notifications", "preferences"],
            authorized: true
        )
    }

    /// PUT `/api/v1/notifications/preferences` with `{"preferences":[...]}`.
    @discardableResult
    func updateNotificationPreferences(
        preferences: [NotificationPreferenceRow]
    ) async throws -> NotificationPreferencesResponse {
        let body = UpdateNotificationPreferencesBody(preferences: preferences)
        return try await putJSON(
            pathComponents: ["api", "v1", "notifications", "preferences"],
            body: body,
            authorized: .required
        )
    }

    // MARK: Payment methods

    /// GET `/api/v1/payments/methods`
    func fetchPaymentMethods() async throws -> PaymentMethodsResponse {
        try await getJSON(
            pathComponents: ["api", "v1", "payments", "methods"],
            authorized: true
        )
    }

    /// DELETE `/api/v1/payments/methods/{id}`
    func deletePaymentMethod(id: String) async throws {
        let trimmed = id.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "Payment method id is required.")
        }
        try await deleteEmpty(
            pathComponents: ["api", "v1", "payments", "methods", trimmed],
            authorized: .required
        )
    }

    // MARK: Stripe Connect (provider)

    /// GET `/api/v1/providers/me/stripe/status`
    func fetchStripeAccountStatus() async throws -> StripeAccountStatus {
        try await getJSON(
            pathComponents: ["api", "v1", "providers", "me", "stripe", "status"],
            authorized: true
        )
    }

    /// POST `/api/v1/providers/me/stripe/account` — optional email / business_name; empty body ok.
    @discardableResult
    func createStripeAccount(
        email: String? = nil,
        businessName: String? = nil
    ) async throws -> StripeAccountCreateResponse {
        let emailTrimmed = email?.trimmingCharacters(in: .whitespacesAndNewlines)
        let businessTrimmed = businessName?.trimmingCharacters(in: .whitespacesAndNewlines)
        let hasEmail = emailTrimmed.map { !$0.isEmpty } ?? false
        let hasBusiness = businessTrimmed.map { !$0.isEmpty } ?? false
        if hasEmail || hasBusiness {
            return try await postJSON(
                pathComponents: ["api", "v1", "providers", "me", "stripe", "account"],
                body: CreateStripeAccountBody(
                    email: hasEmail ? emailTrimmed : nil,
                    businessName: hasBusiness ? businessTrimmed : nil
                ),
                authorized: .required
            )
        }
        return try await postJSON(
            pathComponents: ["api", "v1", "providers", "me", "stripe", "account"],
            body: EmptyJSONObject(),
            authorized: .required
        )
    }

    /// GET `/api/v1/providers/me/stripe/onboarding?return_url=&refresh_url=`
    func fetchStripeOnboardingLink(
        returnURL: String,
        refreshURL: String
    ) async throws -> StripeOnboardingLink {
        let returnTrimmed = returnURL.trimmingCharacters(in: .whitespacesAndNewlines)
        let refreshTrimmed = refreshURL.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !returnTrimmed.isEmpty, !refreshTrimmed.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "return_url and refresh_url are required.")
        }
        return try await getJSON(
            pathComponents: ["api", "v1", "providers", "me", "stripe", "onboarding"],
            query: [
                URLQueryItem(name: "return_url", value: returnTrimmed),
                URLQueryItem(name: "refresh_url", value: refreshTrimmed),
            ],
            authorized: true
        )
    }

    // MARK: Security

    /// POST `/api/v1/auth/change-password` — body current_password, new_password.
    @discardableResult
    func changePassword(current: String, new: String) async throws -> ChangePasswordResponse {
        let currentTrimmed = current.trimmingCharacters(in: .whitespacesAndNewlines)
        // Do not trim new password (spaces may be intentional); only reject empty.
        guard !currentTrimmed.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "current_password is required")
        }
        guard !new.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "new_password is required")
        }
        return try await postJSON(
            pathComponents: ["api", "v1", "auth", "change-password"],
            body: ChangePasswordBody(currentPassword: currentTrimmed, newPassword: new),
            authorized: .required
        )
    }

    /// GET `/api/v1/me/age-status`
    func fetchAgeStatus() async throws -> AgeStatus {
        try await getJSON(
            pathComponents: ["api", "v1", "me", "age-status"],
            authorized: true
        )
    }

    // MARK: Markets

    /// GET `/api/v1/markets` — public launched city catalog.
    func fetchMarkets() async throws -> MarketsResponse {
        try await getJSON(
            pathComponents: ["api", "v1", "markets"],
            authorized: false
        )
    }

    // MARK: Listing cancel

    /// POST `/api/v1/listings/{id}/cancel` — seller cancels (empty body).
    func cancelListing(id: String) async throws {
        let trimmed = id.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "Listing id is required.")
        }
        try await postEmpty(
            pathComponents: ["api", "v1", "listings", trimmed, "cancel"],
            body: EmptyJSONObject(),
            authorized: .required
        )
    }

    // MARK: Report user

    /// POST `/api/v1/users/{id}/report` — body reason + description.
    @discardableResult
    func reportUser(
        id: String,
        reason: String,
        description: String
    ) async throws -> UserReportResponse {
        let trimmed = id.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "User id is required.")
        }
        let reasonTrimmed = reason.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !reasonTrimmed.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "reason is required")
        }
        let body = ReportUserBody(
            reason: reasonTrimmed,
            description: description.trimmingCharacters(in: .whitespacesAndNewlines)
        )
        return try await postJSON(
            pathComponents: ["api", "v1", "users", trimmed, "report"],
            body: body,
            authorized: .required
        )
    }

    // MARK: Similar listings

    /// GET `/api/v1/listings/{id}/similar` — flexible decode to `[ListingSummary]`.
    func fetchSimilarListings(id: String) async throws -> [ListingSummary] {
        let trimmed = id.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "Listing id is required.")
        }
        let response: SimilarListingsResponse = try await getJSON(
            pathComponents: ["api", "v1", "listings", trimmed, "similar"],
            authorized: false
        )
        return response.listings
    }
}

// MARK: - Request bodies (camelCase → snake_case via encoder)

private struct CreatePropertyAddressBody: Encodable {
    let street: String
    let city: String
    let state: String
    let zipCode: String
}

private struct CreatePropertyRequestBody: Encodable {
    let nickname: String
    let address: CreatePropertyAddressBody
    let notes: String
    let isPrimary: Bool
}

private struct CreateWishlistItemBody: Encodable {
    let keyword: String
    let maxPriceCents: Int64
    let categoryId: String?
}

private struct BlockUserBody: Encodable {
    let reason: String
}

private struct RedeemReferralBody: Encodable {
    let code: String
}

private struct UpdateNotificationPreferencesBody: Encodable {
    let preferences: [NotificationPreferenceRow]
}

private struct CreateStripeAccountBody: Encodable {
    var email: String?
    var businessName: String?

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        if let email { try c.encode(email, forKey: .email) }
        if let businessName { try c.encode(businessName, forKey: .businessName) }
    }

    private enum CodingKeys: String, CodingKey {
        case email
        case businessName
    }
}

private struct ChangePasswordBody: Encodable {
    let currentPassword: String
    let newPassword: String
}

private struct ReportUserBody: Encodable {
    let reason: String
    let description: String
}
