import Foundation

// MARK: - Commerce API (Best-Offer, saved searches, seller analytics, order disputes)

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
