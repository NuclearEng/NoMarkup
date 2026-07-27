import Foundation

// MARK: - Commerce API (Best-Offer, bid bond, retract, saved searches, seller analytics, order disputes)

extension APIClient {
    // MARK: Best-Offer

    /// POST `/api/v1/listings/{id}/offers` — buyer creates a Best-Offer.
    @discardableResult
    func createListingOffer(
        listingId: String,
        amountCents: Int64,
        message: String = ""
    ) async throws -> ListingOffer {
        let body = CreateListingOfferBody(
            amountCents: amountCents,
            message: message.trimmingCharacters(in: .whitespacesAndNewlines)
        )
        let wrapped: ListingOfferEnvelope = try await postJSON(
            pathComponents: ["api", "v1", "listings", listingId, "offers"],
            body: body,
            authorized: .required
        )
        guard let offer = wrapped.offer else {
            throw APIClientError.decoding("Create offer response missing offer")
        }
        return offer
    }

    /// GET `/api/v1/listings/{id}/offers` — sellers see all; buyers see only their own.
    func fetchListingOffers(listingId: String) async throws -> [ListingOffer] {
        let response: ListingOffersResponse = try await getJSON(
            pathComponents: ["api", "v1", "listings", listingId, "offers"],
            authorized: true
        )
        return response.offers
    }

    /// PATCH `/api/v1/offers/{id}` — accept | reject | counter | withdraw.
    @discardableResult
    func updateOffer(
        offerId: String,
        action: ListingOfferAction,
        counterAmountCents: Int64? = nil,
        message: String = ""
    ) async throws -> ListingOffer {
        let body = UpdateListingOfferBody(
            action: action.rawValue,
            counterAmountCents: counterAmountCents ?? 0,
            message: message.trimmingCharacters(in: .whitespacesAndNewlines)
        )
        let wrapped: ListingOfferEnvelope = try await patchJSON(
            pathComponents: ["api", "v1", "offers", offerId],
            body: body,
            authorized: .required
        )
        guard let offer = wrapped.offer else {
            throw APIClientError.decoding("Update offer response missing offer")
        }
        return offer
    }

    // MARK: Saved searches

    /// POST `/api/v1/me/saved-searches`
    @discardableResult
    func createSavedSearch(
        name: String,
        query: String,
        alertFrequency: String = "daily"
    ) async throws -> SavedSearch {
        let trimmedName = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedQuery = query.trimmingCharacters(in: .whitespacesAndNewlines)
        let body = CreateSavedSearchBody(
            name: trimmedName,
            query: SavedSearchQueryPayload(q: trimmedQuery.isEmpty ? nil : trimmedQuery),
            alertFrequency: alertFrequency
        )
        let wrapped: SavedSearchEnvelope = try await postJSON(
            pathComponents: ["api", "v1", "me", "saved-searches"],
            body: body,
            authorized: .required
        )
        guard let saved = wrapped.savedSearch else {
            throw APIClientError.decoding("Create saved search response missing saved_search")
        }
        return saved
    }

    /// GET `/api/v1/me/saved-searches`
    func fetchSavedSearches() async throws -> [SavedSearch] {
        let response: SavedSearchesResponse = try await getJSON(
            pathComponents: ["api", "v1", "me", "saved-searches"],
            authorized: true
        )
        return response.savedSearches
    }

    /// DELETE `/api/v1/me/saved-searches/{id}` — 204 No Content.
    func deleteSavedSearch(id: String) async throws {
        try await deleteEmpty(
            pathComponents: ["api", "v1", "me", "saved-searches", id],
            authorized: .required
        )
    }

    // MARK: Seller listings

    /// GET `/api/v1/listings/mine` — seller's own goods listings (Bearer required).
    /// Optional `status` filter matches gateway (`active`, `ended`, `draft`, …).
    func fetchMyListings(
        page: Int = 1,
        pageSize: Int = 40,
        status: String? = nil
    ) async throws -> ListingsResponse {
        var items = [
            URLQueryItem(name: "page", value: String(max(1, page))),
            URLQueryItem(name: "page_size", value: String(min(max(1, pageSize), 100))),
        ]
        if let status {
            let trimmed = status.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmed.isEmpty {
                items.append(URLQueryItem(name: "status", value: trimmed))
            }
        }
        return try await getJSON(
            pathComponents: ["api", "v1", "listings", "mine"],
            query: items,
            authorized: true
        )
    }

    // MARK: Seller analytics

    /// GET `/api/v1/me/seller-analytics?range=7d|30d|90d`
    func fetchSellerAnalytics(range: String = "30d") async throws -> SellerAnalytics {
        try await getJSON(
            pathComponents: ["api", "v1", "me", "seller-analytics"],
            query: [URLQueryItem(name: "range", value: range)],
            authorized: true
        )
    }

    // MARK: Listing order disputes / no-show

    /// POST `/api/v1/orders/{id}/file-dispute` — buyer only.
    @discardableResult
    func fileOrderDispute(
        orderId: String,
        reason: ListingDisputeReason,
        description: String
    ) async throws -> FileListingDisputeResponse {
        let body = FileListingDisputeBody(
            reason: reason.rawValue,
            description: description.trimmingCharacters(in: .whitespacesAndNewlines)
        )
        return try await postJSON(
            pathComponents: ["api", "v1", "orders", orderId, "file-dispute"],
            body: body,
            authorized: .required
        )
    }

    /// POST `/api/v1/orders/{id}/report-no-show` — either party while escrow is held.
    @discardableResult
    func reportOrderNoShow(orderId: String, notes: String = "") async throws -> ReportNoShowResponse {
        let trimmed = notes.trimmingCharacters(in: .whitespacesAndNewlines)
        let body = ReportNoShowBody(notes: trimmed)
        return try await postJSON(
            pathComponents: ["api", "v1", "orders", orderId, "report-no-show"],
            body: body,
            authorized: .required
        )
    }

    // MARK: Listing bid bond + retract

    /// POST `/api/v1/listings/{id}/bid-bond` — mint SetupIntent + pending bond row.
    /// First-time bidders hit this after place-bid returns 402 `requires_bid_bond`.
    @discardableResult
    func createListingBidBond(
        listingId: String,
        intendedBidCents: Int64
    ) async throws -> CreateListingBidBondResponse {
        guard intendedBidCents > 0 else {
            throw APIClientError.httpStatus(400, detail: "intended_bid_cents must be positive")
        }
        let body = CreateListingBidBondBody(intendedBidCents: intendedBidCents)
        return try await postJSON(
            pathComponents: ["api", "v1", "listings", listingId, "bid-bond"],
            body: body,
            authorized: .required
        )
    }

    /// POST `/api/v1/listings/{id}/bid-bond/confirm` — flip pending → authorized after Stripe SetupIntent succeeds.
    @discardableResult
    func confirmListingBidBond(
        listingId: String,
        bondId: String
    ) async throws -> ConfirmListingBidBondResponse {
        let trimmed = bondId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "bond_id is required")
        }
        let body = ConfirmListingBidBondBody(bondId: trimmed)
        return try await postJSON(
            pathComponents: ["api", "v1", "listings", listingId, "bid-bond", "confirm"],
            body: body,
            authorized: .required
        )
    }

    /// POST `/api/v1/listings/{id}/bids/{bidId}/retract` — eBay-style 60s window for the leading active bid.
    @discardableResult
    func retractListingBid(
        listingId: String,
        bidId: String
    ) async throws -> RetractListingBidResponse {
        try await postJSON(
            pathComponents: ["api", "v1", "listings", listingId, "bids", bidId, "retract"],
            body: EmptyJSONObject(),
            authorized: .required
        )
    }
}

// MARK: - Request bodies (snake_case via encoder)

private struct CreateListingOfferBody: Encodable {
    let amountCents: Int64
    let message: String
}

private struct UpdateListingOfferBody: Encodable {
    let action: String
    let counterAmountCents: Int64
    let message: String
}

private struct SavedSearchQueryPayload: Encodable {
    let q: String?
}

private struct CreateSavedSearchBody: Encodable {
    let name: String
    let query: SavedSearchQueryPayload
    let alertFrequency: String
}

private struct FileListingDisputeBody: Encodable {
    let reason: String
    let description: String
}

private struct ReportNoShowBody: Encodable {
    let notes: String
}

private struct CreateListingBidBondBody: Encodable {
    let intendedBidCents: Int64
}

private struct ConfirmListingBidBondBody: Encodable {
    let bondId: String
}

// MARK: - Bid bond / retract response models

/// `POST /api/v1/listings/{id}/bid-bond` success body.
struct CreateListingBidBondResponse: Codable, Sendable {
    let bondId: String
    let setupIntentClientSecret: String
    let bondAmountCents: Int64

    /// Dev stacks return sentinel secrets when Stripe is not wired.
    var isDevSetupSecret: Bool {
        let secret = setupIntentClientSecret.trimmingCharacters(in: .whitespacesAndNewlines)
        return secret.hasPrefix("dev_bond_seti_") || secret.hasPrefix("dev_seti_")
    }

    /// Real Stripe SetupIntent client secrets start with `seti_`.
    var isStripeSetupSecret: Bool {
        let secret = setupIntentClientSecret.trimmingCharacters(in: .whitespacesAndNewlines)
        return secret.hasPrefix("seti_") && secret.contains("_secret_")
    }
}

/// `POST /api/v1/listings/{id}/bid-bond/confirm` success body.
struct ConfirmListingBidBondResponse: Codable, Sendable {
    var authorized: Bool?
    var bondId: String?

    var isAuthorized: Bool {
        authorized == true
    }
}

/// `POST /api/v1/listings/{id}/bids/{bidId}/retract` success body.
struct RetractListingBidResponse: Codable, Sendable {
    var bidId: String?
    var listing: ListingDetail?
}
