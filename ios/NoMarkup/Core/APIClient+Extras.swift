import Foundation

// MARK: - Consumer API extras
//
// Providers, properties, wishlist, blocks, follows/feed, reviews, referrals,
// notification prefs, payment methods, Stripe Connect, age status / DOB,
// MFA enable/confirm/disable, markets, listing cancel, user report (optional
// chat context), similar listings. Reuses getJSON / postJSON / putJSON /
// deleteJSON / deleteEmpty / postEmpty + AuthMode from APIClient.

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
    /// Uses optional auth so `is_following` is accurate for signed-in callers.
    func fetchProvider(id: String) async throws -> ProviderProfileDetail {
        let trimmed = id.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "Provider id is required.")
        }
        return try await getJSON(
            pathComponents: ["api", "v1", "providers", trimmed],
            authorized: .optional
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

    /// PUT `/api/v1/properties/{id}` — update nickname, notes, and/or primary flag.
    /// Gateway has no PATCH; address is immutable on update (create a new property to change street).
    @discardableResult
    func updateProperty(
        id: String,
        nickname: String? = nil,
        notes: String? = nil,
        isPrimary: Bool? = nil
    ) async throws -> PropertyItem {
        let trimmed = id.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "Property id is required.")
        }
        let body = UpdatePropertyRequestBody(
            nickname: nickname.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) },
            notes: notes.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) },
            isPrimary: isPrimary
        )
        return try await putJSON(
            pathComponents: ["api", "v1", "properties", trimmed],
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

    // MARK: Customer spending (FR-19.2)

    /// GET `/api/v1/analytics/customers/me/spending?start_date=&end_date=&group_by=`
    ///
    /// Account-wide services spend (not per-property — no `property_id` on gateway).
    /// Default date window when omitted is last ~3 months (analytics service default).
    /// - Parameters:
    ///   - startDate: `YYYY-MM-DD` optional
    ///   - endDate: `YYYY-MM-DD` optional
    ///   - groupBy: e.g. `month` / `week` / `day` when supported server-side
    func fetchCustomerSpending(
        startDate: String? = nil,
        endDate: String? = nil,
        groupBy: String? = nil
    ) async throws -> CustomerSpendingResponse {
        var items: [URLQueryItem] = []
        if let startDate {
            let t = startDate.trimmingCharacters(in: .whitespacesAndNewlines)
            if !t.isEmpty {
                items.append(URLQueryItem(name: "start_date", value: t))
            }
        }
        if let endDate {
            let t = endDate.trimmingCharacters(in: .whitespacesAndNewlines)
            if !t.isEmpty {
                items.append(URLQueryItem(name: "end_date", value: t))
            }
        }
        if let groupBy {
            let t = groupBy.trimmingCharacters(in: .whitespacesAndNewlines)
            if !t.isEmpty {
                items.append(URLQueryItem(name: "group_by", value: t))
            }
        }
        return try await getJSON(
            pathComponents: ["api", "v1", "analytics", "customers", "me", "spending"],
            query: items,
            authorized: true
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

    /// GET `/api/v1/me/referrals` — code, history rows, credit balance.
    func listReferrals() async throws -> ReferralsListResponse {
        try await getJSON(
            pathComponents: ["api", "v1", "me", "referrals"],
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

    // MARK: NPS surveys

    /// GET `/api/v1/me/nps/pending` → `{ "pending": [...] }`.
    func fetchPendingNPS() async throws -> NPSPendingResponse {
        try await getJSON(
            pathComponents: ["api", "v1", "me", "nps", "pending"],
            authorized: true
        )
    }

    /// POST `/api/v1/me/nps/{id}` with `{ "score": 0-10, "comment": "..." }`.
    @discardableResult
    func submitNPS(id: String, score: Int, comment: String = "") async throws -> SubmitNPSResponse {
        let trimmed = id.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "NPS survey id is required.")
        }
        guard (0 ... 10).contains(score) else {
            throw APIClientError.httpStatus(400, detail: "score must be between 0 and 10")
        }
        return try await postJSON(
            pathComponents: ["api", "v1", "me", "nps", trimmed],
            body: SubmitNPSBody(score: score, comment: comment.trimmingCharacters(in: .whitespacesAndNewlines)),
            authorized: .required
        )
    }

    // MARK: Savings

    /// GET `/api/v1/users/me/savings` — bare array of reverse-auction savings rows.
    func fetchMySavings() async throws -> SavingsResponse {
        try await getJSON(
            pathComponents: ["api", "v1", "users", "me", "savings"],
            authorized: true
        )
    }

    // MARK: MFA enable / confirm / disable

    /// POST `/api/v1/auth/mfa/enable` — returns TOTP secret, QR URL, backup codes (setup not confirmed).
    @discardableResult
    func enableMFA() async throws -> EnableMFAResponse {
        try await postJSON(
            pathComponents: ["api", "v1", "auth", "mfa", "enable"],
            body: EmptyJSONObject(),
            authorized: .required
        )
    }

    /// POST `/api/v1/auth/mfa/verify-setup` — confirms TOTP + persists backup codes; MFA becomes active.
    @discardableResult
    func confirmMFASetup(totpCode: String, backupCodes: [String]) async throws -> MFAActionResponse {
        let code = totpCode.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !code.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "Authenticator code is required.")
        }
        return try await postJSON(
            pathComponents: ["api", "v1", "auth", "mfa", "verify-setup"],
            body: ConfirmMFASetupBody(totpCode: code, backupCodes: backupCodes),
            authorized: .required
        )
    }

    /// DELETE `/api/v1/auth/mfa/disable` — body `{ "totp_code" }` required.
    @discardableResult
    func disableMFA(totpCode: String) async throws -> MFAActionResponse {
        let code = totpCode.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !code.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "Authenticator code is required.")
        }
        return try await deleteJSON(
            pathComponents: ["api", "v1", "auth", "mfa", "disable"],
            body: DisableMFABody(totpCode: code),
            authorized: .required
        )
    }

    // MARK: Logout (server-side revoke)

    /// POST `/api/v1/auth/logout` — best-effort; public route, may send refresh_token body. 204.
    /// Uses `.none` so a 401 never kicks the mid-session refresh / session-expired path during sign-out.
    func logout(refreshToken: String? = nil) async throws {
        let trimmed = refreshToken?.trimmingCharacters(in: .whitespacesAndNewlines)
        if let trimmed, !trimmed.isEmpty {
            try await postEmpty(
                pathComponents: ["api", "v1", "auth", "logout"],
                body: LogoutRequestBody(refreshToken: trimmed),
                authorized: .none
            )
        } else {
            try await postEmpty(
                pathComponents: ["api", "v1", "auth", "logout"],
                body: EmptyJSONObject(),
                authorized: .none
            )
        }
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

    /// GET `/api/v1/users/me/oauth-accounts` — linked social sign-in providers (ASR-5.1.1.v).
    func fetchOAuthAccounts() async throws -> [OAuthAccount] {
        let response: OAuthAccountsResponse = try await getJSON(
            pathComponents: ["api", "v1", "users", "me", "oauth-accounts"],
            authorized: true
        )
        return response.accounts
    }

    /// DELETE `/api/v1/users/me/oauth-accounts/{provider}` — lockout-safe unlink.
    /// Server returns 409 when this is the only remaining sign-in method.
    @discardableResult
    func unlinkOAuthAccount(provider: String) async throws -> UnlinkOAuthAccountResponse {
        let trimmed = provider.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !trimmed.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "provider is required")
        }
        // Only allow known providers client-side (gateway re-validates).
        let allowed: Set<String> = ["google", "apple", "facebook"]
        guard allowed.contains(trimmed) else {
            throw APIClientError.httpStatus(400, detail: "unsupported provider")
        }
        return try await deleteJSON(
            pathComponents: ["api", "v1", "users", "me", "oauth-accounts", trimmed],
            authorized: .required
        )
    }

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

    /// PUT `/api/v1/me/dob` — body `{ "dob": "YYYY-MM-DD" }`. Server validates ≥18; DOB never returned.
    @discardableResult
    func setDateOfBirth(_ dob: String) async throws -> SetDOBResponse {
        let trimmed = dob.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "Date of birth is required.")
        }
        // Client-side shape check only — age math is server-authoritative.
        let parts = trimmed.split(separator: "-")
        guard parts.count == 3,
              parts[0].count == 4,
              parts[1].count == 2,
              parts[2].count == 2
        else {
            throw APIClientError.httpStatus(400, detail: "Date of birth must be YYYY-MM-DD.")
        }
        return try await putJSON(
            pathComponents: ["api", "v1", "me", "dob"],
            body: SetDOBBody(dob: trimmed),
            authorized: .required
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

    /// POST `/api/v1/users/{id}/report` — body reason + description + optional chat context.
    @discardableResult
    func reportUser(
        id: String,
        reason: String,
        description: String,
        channelId: String? = nil,
        messageId: String? = nil
    ) async throws -> UserReportResponse {
        let trimmed = id.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "User id is required.")
        }
        let reasonTrimmed = reason.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !reasonTrimmed.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "reason is required")
        }
        let channel = channelId?.trimmingCharacters(in: .whitespacesAndNewlines)
        let message = messageId?.trimmingCharacters(in: .whitespacesAndNewlines)
        let body = ReportUserBody(
            reason: reasonTrimmed,
            description: description.trimmingCharacters(in: .whitespacesAndNewlines),
            channelId: (channel?.isEmpty == false) ? channel : nil,
            messageId: (message?.isEmpty == false) ? message : nil
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

    // MARK: Follows + feed

    /// GET `/api/v1/me/follows` — sellers the caller follows.
    func fetchFollows(page: Int = 1, pageSize: Int = 40) async throws -> FollowsResponse {
        try await getJSON(
            pathComponents: ["api", "v1", "me", "follows"],
            query: [
                URLQueryItem(name: "page", value: String(max(1, page))),
                URLQueryItem(name: "page_size", value: String(min(max(1, pageSize), 100))),
            ],
            authorized: true
        )
    }

    /// POST `/api/v1/users/{id}/follow` — idempotent follow.
    @discardableResult
    func followUser(id: String) async throws -> FollowToggleResponse {
        let trimmed = id.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "User id is required.")
        }
        return try await postJSON(
            pathComponents: ["api", "v1", "users", trimmed, "follow"],
            body: EmptyJSONObject(),
            authorized: .required
        )
    }

    /// DELETE `/api/v1/users/{id}/follow` — idempotent unfollow.
    @discardableResult
    func unfollowUser(id: String) async throws -> FollowToggleResponse {
        let trimmed = id.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "User id is required.")
        }
        return try await deleteJSON(
            pathComponents: ["api", "v1", "users", trimmed, "follow"],
            authorized: .required
        )
    }

    /// GET `/api/v1/me/feed` — active listings from followed sellers.
    func fetchFeed(page: Int = 1, pageSize: Int = 40) async throws -> ListingsResponse {
        try await getJSON(
            pathComponents: ["api", "v1", "me", "feed"],
            query: [
                URLQueryItem(name: "page", value: String(max(1, page))),
                URLQueryItem(name: "page_size", value: String(min(max(1, pageSize), 100))),
            ],
            authorized: true
        )
    }

    // MARK: User reviews

    /// GET `/api/v1/users/{id}/reviews` — public reviews for a user (seller/provider).
    func fetchUserReviews(
        userId: String,
        page: Int = 1,
        pageSize: Int = 20
    ) async throws -> UserReviewsResponse {
        let trimmed = userId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "User id is required.")
        }
        return try await getJSON(
            pathComponents: ["api", "v1", "users", trimmed, "reviews"],
            query: [
                URLQueryItem(name: "page", value: String(max(1, page))),
                URLQueryItem(name: "page_size", value: String(min(max(1, pageSize), 100))),
            ],
            authorized: false
        )
    }

    // MARK: Trust score (authed)

    /// GET `/api/v1/users/{id}/trust-score` — full composite + four dimensions (Bearer).
    func fetchUserTrustScore(userId: String) async throws -> UserTrustScore {
        let trimmed = userId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "User id is required.")
        }
        return try await getJSON(
            pathComponents: ["api", "v1", "users", trimmed, "trust-score"],
            authorized: true
        )
    }

    /// GET `/api/v1/users/{id}/trust-history` → `{ "snapshots": [...], "pagination": ... }` (Bearer).
    func fetchUserTrustHistory(
        userId: String,
        page: Int = 1,
        pageSize: Int = 20
    ) async throws -> UserTrustHistoryResponse {
        let trimmed = userId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "User id is required.")
        }
        return try await getJSON(
            pathComponents: ["api", "v1", "users", trimmed, "trust-history"],
            query: [
                URLQueryItem(name: "page", value: String(max(1, page))),
                URLQueryItem(name: "page_size", value: String(min(max(1, pageSize), 100))),
            ],
            authorized: true
        )
    }

    // MARK: Trust tiers (public)

    /// GET `/api/v1/trust/tiers` → `{ "tiers": [...] }` — public ladder requirements.
    func fetchTrustTiers() async throws -> TrustTiersResponse {
        try await getJSON(
            pathComponents: ["api", "v1", "trust", "tiers"],
            authorized: false
        )
    }

    // MARK: Subscription tiers (public, display-only)

    /// GET `/api/v1/subscriptions/tiers` → `{ "tiers": [...] }`.
    /// iOS uses this for limits comparison only — no purchase / StoreKit / web checkout.
    func fetchSubscriptionTiers() async throws -> SubscriptionTiersResponse {
        try await getJSON(
            pathComponents: ["api", "v1", "subscriptions", "tiers"],
            authorized: false
        )
    }

    // MARK: Terms of Service

    /// GET `/api/v1/tos/current` — public current ToS version pointer.
    func fetchCurrentToS() async throws -> ToSCurrent {
        try await getJSON(
            pathComponents: ["api", "v1", "tos", "current"],
            authorized: false
        )
    }

    /// GET `/api/v1/me/tos-acceptance` — caller's latest accepted version (Bearer).
    func fetchMyToSAcceptance() async throws -> ToSAcceptance {
        try await getJSON(
            pathComponents: ["api", "v1", "me", "tos-acceptance"],
            authorized: true
        )
    }

    /// POST `/api/v1/me/tos-acceptance` with `{ "tos_version": "..." }` — idempotent accept.
    @discardableResult
    func acceptToS(version: String) async throws -> ToSAcceptResponse {
        let trimmed = version.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "tos_version is required")
        }
        return try await postJSON(
            pathComponents: ["api", "v1", "me", "tos-acceptance"],
            body: AcceptToSBody(tosVersion: trimmed),
            authorized: .required
        )
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

/// PUT body for `/api/v1/properties/{id}` — all fields optional; gateway merges non-nil.
private struct UpdatePropertyRequestBody: Encodable {
    let nickname: String?
    let notes: String?
    let isPrimary: Bool?
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

private struct SubmitNPSBody: Encodable {
    let score: Int
    let comment: String
}

private struct LogoutRequestBody: Encodable {
    let refreshToken: String

    enum CodingKeys: String, CodingKey {
        case refreshToken = "refresh_token"
    }
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
    var channelId: String?
    var messageId: String?

    enum CodingKeys: String, CodingKey {
        case reason
        case description
        case channelId = "channel_id"
        case messageId = "message_id"
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(reason, forKey: .reason)
        try c.encode(description, forKey: .description)
        // Always send keys so gateway sees empty-vs-set consistently (web sends "").
        try c.encode(channelId ?? "", forKey: .channelId)
        try c.encode(messageId ?? "", forKey: .messageId)
    }
}

private struct ConfirmMFASetupBody: Encodable {
    let totpCode: String
    let backupCodes: [String]

    enum CodingKeys: String, CodingKey {
        case totpCode = "totp_code"
        case backupCodes = "backup_codes"
    }
}

private struct DisableMFABody: Encodable {
    let totpCode: String

    enum CodingKeys: String, CodingKey {
        case totpCode = "totp_code"
    }
}

private struct SetDOBBody: Encodable {
    let dob: String
}

private struct AcceptToSBody: Encodable {
    let tosVersion: String
}
