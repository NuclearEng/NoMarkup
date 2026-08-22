import XCTest
@testable import NoMarkup

// IOS-TEST.1 (coverage half): the two named missing test areas —
// (a) `KeychainTokenStore` round-trips against the real simulator keychain
//     (test host = NoMarkup.app), isolated under test-only service names;
// (b) `APIClient` 401 → single-flight refresh → retry, via a scripted
//     `URLProtocol` mock injected through `APIClient.init(session:tokenStore:)`.

// MARK: - URLProtocol mock

/// Thread-safe log of requests the mock served (path + Authorization header).
final class RequestLog: @unchecked Sendable {
    private let lock = NSLock()
    private var entries: [(path: String, authorization: String?)] = []

    func append(path: String, authorization: String?) {
        lock.lock()
        defer { lock.unlock() }
        entries.append((path, authorization))
    }

    /// Number of recorded requests whose path ends with `pathSuffix`.
    func count(pathSuffix: String) -> Int {
        lock.lock()
        defer { lock.unlock() }
        return entries.filter { $0.path.hasSuffix(pathSuffix) }.count
    }

    /// Authorization headers of recorded requests matching `pathSuffix`, in order.
    func authorizations(pathSuffix: String) -> [String?] {
        lock.lock()
        defer { lock.unlock() }
        return entries.filter { $0.path.hasSuffix(pathSuffix) }.map(\.authorization)
    }
}

/// Scripted in-process HTTP stub. Register on an ephemeral
/// `URLSessionConfiguration.protocolClasses` so no request leaves the process.
final class MockURLProtocol: URLProtocol {
    typealias Handler = @Sendable (URLRequest) -> (status: Int, body: String)

    /// Guarded by `handlerLock`; test classes run serially within one process, and
    /// simulator parallel testing isolates classes in separate runner processes.
    nonisolated(unsafe) private static var handler: Handler?
    private static let handlerLock = NSLock()

    static func setHandler(_ newHandler: Handler?) {
        handlerLock.lock()
        defer { handlerLock.unlock() }
        handler = newHandler
    }

    private static func currentHandler() -> Handler? {
        handlerLock.lock()
        defer { handlerLock.unlock() }
        return handler
    }

    override class func canInit(with request: URLRequest) -> Bool { true }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        guard let url = request.url, let handler = Self.currentHandler() else {
            client?.urlProtocol(self, didFailWithError: URLError(.badServerResponse))
            return
        }
        let (status, body) = handler(request)
        guard let response = HTTPURLResponse(
            url: url,
            statusCode: status,
            httpVersion: "HTTP/1.1",
            headerFields: ["Content-Type": "application/json"]
        ) else {
            client?.urlProtocol(self, didFailWithError: URLError(.badServerResponse))
            return
        }
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(body.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}

// MARK: - KeychainTokenStore round-trips (real simulator keychain)

final class KeychainTokenStoreTests: XCTestCase {
    /// Test-only service so these tests never touch the app's real token entries
    /// (default service is the host bundle id).
    private static let service = "com.nomarkup.tests.keychain"

    private var store: KeychainTokenStore!

    override func setUpWithError() throws {
        try super.setUpWithError()
        store = KeychainTokenStore(service: Self.service)
        // Defensive: drop leftovers from any previously aborted run.
        try? store.clearSession()
    }

    override func tearDownWithError() throws {
        try? store.clearSession()
        store = nil
        try super.tearDownWithError()
    }

    func testSaveReadRoundTripBothKeys() throws {
        try store.save("access-abc", for: .accessToken)
        try store.save("refresh-xyz", for: .refreshToken)

        XCTAssertEqual(try store.read(.accessToken), "access-abc")
        XCTAssertEqual(try store.read(.refreshToken), "refresh-xyz")
    }

    func testSaveOverwritesExistingValue() throws {
        // Second save exercises the SecItemUpdate branch (item already present).
        try store.save("first", for: .accessToken)
        try store.save("second", for: .accessToken)

        XCTAssertEqual(try store.read(.accessToken), "second")
    }

    func testReadMissingReturnsNilAndDeleteIsIdempotent() throws {
        XCTAssertNil(try store.read(.accessToken))

        try store.save("to-delete", for: .refreshToken)
        try store.delete(.refreshToken)
        XCTAssertNil(try store.read(.refreshToken))

        // Deleting an absent item must not throw (errSecItemNotFound tolerated).
        XCTAssertNoThrow(try store.delete(.refreshToken))
    }

    func testHasTokenHelpersAndClearSession() throws {
        XCTAssertFalse(store.hasAccessToken())
        XCTAssertFalse(store.hasRefreshToken())

        try store.save("a", for: .accessToken)
        try store.save("r", for: .refreshToken)
        XCTAssertTrue(store.hasAccessToken())
        XCTAssertTrue(store.hasRefreshToken())

        try store.clearSession()
        XCTAssertNil(try store.read(.accessToken))
        XCTAssertNil(try store.read(.refreshToken))
        XCTAssertFalse(store.hasAccessToken())
        XCTAssertFalse(store.hasRefreshToken())
    }
}

// MARK: - APIClient 401 → refresh → retry

final class APIClientAuthRetryTests: XCTestCase {
    /// Distinct service from KeychainTokenStoreTests so the suites cannot interact.
    private static let service = "com.nomarkup.tests.apiclient"

    private var store: KeychainTokenStore!
    private var client: APIClient!

    override func setUpWithError() throws {
        try super.setUpWithError()
        store = KeychainTokenStore(service: Self.service)
        try? store.clearSession()

        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [MockURLProtocol.self]
        client = APIClient(session: URLSession(configuration: configuration), tokenStore: store)
    }

    override func tearDownWithError() throws {
        MockURLProtocol.setHandler(nil)
        try? store.clearSession()
        client = nil
        store = nil
        try super.tearDownWithError()
    }

    /// One authed GET through the internal `perform` plumbing every feature call uses.
    private func performAuthedOrdersGET() async throws -> Data {
        try await client.perform(
            method: "GET",
            pathComponents: ["api", "v1", "me", "orders"],
            query: [],
            body: nil as EmptyBody?,
            auth: .required
        )
    }

    func test401TriggersExactlyOneRefreshThenRetryWithNewToken() async throws {
        try store.save("old-access", for: .accessToken)
        try store.save("refresh-1", for: .refreshToken)

        let log = RequestLog()
        MockURLProtocol.setHandler { request in
            let path = request.url?.path ?? ""
            log.append(path: path, authorization: request.value(forHTTPHeaderField: "Authorization"))
            if path.hasSuffix("/api/v1/auth/refresh") {
                return (200, #"{"access_token":"new-access","refresh_token":"refresh-2"}"#)
            }
            if path.hasSuffix("/api/v1/me/orders") {
                // First attempt (stale token) is rejected; the post-refresh retry succeeds.
                if log.count(pathSuffix: "/me/orders") == 1 {
                    return (401, #"{"error":"token expired"}"#)
                }
                return (200, #"{"ok":true}"#)
            }
            return (404, "{}")
        }

        let noExpiry = expectation(forNotification: .noMarkupSessionExpired, object: nil)
        noExpiry.isInverted = true

        let data = try await performAuthedOrdersGET()

        XCTAssertEqual(String(decoding: data, as: UTF8.self), #"{"ok":true}"#)
        XCTAssertEqual(log.count(pathSuffix: "/me/orders"), 2, "401 must be retried exactly once")
        XCTAssertEqual(log.count(pathSuffix: "/auth/refresh"), 1, "exactly one refresh call")

        let orderAuths = log.authorizations(pathSuffix: "/me/orders")
        XCTAssertEqual(orderAuths.first, "Bearer old-access")
        XCTAssertEqual(orderAuths.last, "Bearer new-access", "retry must carry the refreshed token")
        // The refresh call itself authenticates by body, not Bearer header.
        XCTAssertEqual(log.authorizations(pathSuffix: "/auth/refresh"), [nil])

        // Rotated pair persisted for subsequent calls.
        XCTAssertEqual(try store.read(.accessToken), "new-access")
        XCTAssertEqual(try store.read(.refreshToken), "refresh-2")

        // A recovered session must not signal expiry.
        await fulfillment(of: [noExpiry], timeout: 0.3)
    }

    func testRefreshFailureSurfacesUnauthorizedAndPostsSessionExpired() async throws {
        try store.save("old-access", for: .accessToken)
        try store.save("refresh-1", for: .refreshToken)

        let log = RequestLog()
        MockURLProtocol.setHandler { request in
            let path = request.url?.path ?? ""
            log.append(path: path, authorization: request.value(forHTTPHeaderField: "Authorization"))
            if path.hasSuffix("/api/v1/auth/refresh") {
                return (401, #"{"error":"invalid refresh token"}"#)
            }
            return (401, #"{"error":"token expired"}"#)
        }

        let expiry = expectation(forNotification: .noMarkupSessionExpired, object: nil)

        do {
            _ = try await performAuthedOrdersGET()
            XCTFail("Expected unauthorized error after failed refresh")
        } catch let error as APIClientError {
            XCTAssertTrue(error.isUnauthorized, "original 401 must surface, got \(error)")
        }

        await fulfillment(of: [expiry], timeout: 2.0)
        XCTAssertEqual(log.count(pathSuffix: "/me/orders"), 1, "no retry after a failed refresh")
        XCTAssertEqual(log.count(pathSuffix: "/auth/refresh"), 1)
    }

    func testStill401AfterSuccessfulRefreshIsDefinitiveExpiry() async throws {
        try store.save("old-access", for: .accessToken)
        try store.save("refresh-1", for: .refreshToken)

        let log = RequestLog()
        MockURLProtocol.setHandler { request in
            let path = request.url?.path ?? ""
            log.append(path: path, authorization: request.value(forHTTPHeaderField: "Authorization"))
            if path.hasSuffix("/api/v1/auth/refresh") {
                return (200, #"{"access_token":"new-access","refresh_token":"refresh-2"}"#)
            }
            // Server keeps rejecting even the refreshed token (e.g. revoked account).
            return (401, #"{"error":"token expired"}"#)
        }

        let expiry = expectation(forNotification: .noMarkupSessionExpired, object: nil)

        do {
            _ = try await performAuthedOrdersGET()
            XCTFail("Expected unauthorized error when retry is still 401")
        } catch let error as APIClientError {
            XCTAssertTrue(error.isUnauthorized)
        }

        await fulfillment(of: [expiry], timeout: 2.0)
        XCTAssertEqual(log.count(pathSuffix: "/me/orders"), 2, "exactly one retry, then definitive")
        XCTAssertEqual(log.count(pathSuffix: "/auth/refresh"), 1, "refresh must not loop")
        XCTAssertEqual(
            log.authorizations(pathSuffix: "/me/orders").last,
            "Bearer new-access",
            "retry must have used the refreshed token before giving up"
        )
    }

    func test401WithoutRefreshTokenPostsSessionExpiredWithoutRefreshCall() async throws {
        try store.save("old-access", for: .accessToken)
        // No refresh token stored — session is unrecoverable.

        let log = RequestLog()
        MockURLProtocol.setHandler { request in
            let path = request.url?.path ?? ""
            log.append(path: path, authorization: request.value(forHTTPHeaderField: "Authorization"))
            return (401, #"{"error":"token expired"}"#)
        }

        let expiry = expectation(forNotification: .noMarkupSessionExpired, object: nil)

        do {
            _ = try await performAuthedOrdersGET()
            XCTFail("Expected unauthorized error without refresh token")
        } catch let error as APIClientError {
            XCTAssertTrue(error.isUnauthorized)
        }

        await fulfillment(of: [expiry], timeout: 2.0)
        XCTAssertEqual(log.count(pathSuffix: "/me/orders"), 1)
        XCTAssertEqual(log.count(pathSuffix: "/auth/refresh"), 0, "no refresh attempt without a token")
    }

    func testStaleRefreshFailureDoesNotExpireAReplacedSession() async throws {
        try store.save("old-access", for: .accessToken)
        try store.save("refresh-1", for: .refreshToken)

        let log = RequestLog()
        MockURLProtocol.setHandler { [store] request in
            let path = request.url?.path ?? ""
            log.append(path: path, authorization: request.value(forHTTPHeaderField: "Authorization"))
            if path.hasSuffix("/api/v1/auth/refresh") {
                // Concurrent login replaced the session while this refresh was in flight.
                try? store?.save("new-access", for: .accessToken)
                try? store?.save("refresh-2", for: .refreshToken)
                return (401, #"{"error":"invalid refresh token"}"#)
            }
            return (401, #"{"error":"token expired"}"#)
        }

        let noExpiry = expectation(forNotification: .noMarkupSessionExpired, object: nil)
        noExpiry.isInverted = true

        do {
            _ = try await performAuthedOrdersGET()
            XCTFail("Expected unauthorized from the original 401")
        } catch let error as APIClientError {
            XCTAssertTrue(error.isUnauthorized)
        }

        await fulfillment(of: [noExpiry], timeout: 0.4)
        XCTAssertEqual(try store.read(.accessToken), "new-access")
        XCTAssertEqual(try store.read(.refreshToken), "refresh-2")
        XCTAssertEqual(log.count(pathSuffix: "/auth/refresh"), 1)
    }
}

// MARK: - F4 Checkr invitation_url

final class ProviderBackgroundCheckDecodingTests: XCTestCase {
    func testDecodesInvitationURLAndNeverInventsPass() throws {
        let json = """
        {"status":"pending","checkr_id":"inv_1","invitation_url":"https://apply.checkr.com/invite/abc","report_url":"https://apply.checkr.com/invite/abc"}
        """
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        let row = try decoder.decode(ProviderBackgroundCheck.self, from: Data(json.utf8))
        XCTAssertEqual(row.status, "pending")
        XCTAssertEqual(row.invitationUrl, "https://apply.checkr.com/invite/abc")
        XCTAssertEqual(row.openableInvitationURL?.absoluteString, "https://apply.checkr.com/invite/abc")
        XCTAssertEqual(row.displayStatus, "Pending")
        XCTAssertFalse(row.displayStatus.lowercased().contains("pass"))
    }

    func testFallsBackToReportURLForOpenCheckr() throws {
        let json = #"{"status":"pending","report_url":"https://apply.checkr.com/invite/from-report"}"#
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        let row = try decoder.decode(ProviderBackgroundCheck.self, from: Data(json.utf8))
        XCTAssertNil(row.invitationUrl)
        XCTAssertEqual(row.openableInvitationURL?.host, "apply.checkr.com")
    }

    func testClearIsNotRelabeledPass() throws {
        let json = #"{"status":"clear"}"#
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        let row = try decoder.decode(ProviderBackgroundCheck.self, from: Data(json.utf8))
        XCTAssertEqual(row.displayStatus, "Clear")
        XCTAssertFalse(row.displayStatus.lowercased().contains("pass"))
        XCTAssertNil(row.openableInvitationURL)
    }
}

// MARK: - List vs detail bid heat

final class CatalogBidCountTests: XCTestCase {
    private var decoder: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }

    func testPrefersPublishedHeatOverNestedTrailLength() throws {
        let json = """
        {
          "bids": [
            {"id":"1"},{"id":"2"},{"id":"3"},{"id":"4"},
            {"id":"5"},{"id":"6"},{"id":"7"}
          ],
          "bidder_count": 3,
          "bid_count": 1
        }
        """
        let payload = try decoder.decode(ListingBidsResponse.self, from: Data(json.utf8))
        XCTAssertEqual(payload.bids.count, 7)
        XCTAssertEqual(payload.resolvedBidCount, 3)
        XCTAssertEqual(CatalogBidCount.resolved(bidCount: 1, bidderCount: 3), 3)
    }

    func testListingSummaryHeatUsesBidCountAndBidderCount() throws {
        let json = """
        {
          "id": "00000000-0000-0000-0000-000000009102",
          "title": "Snap-on socket set",
          "bid_count": 1,
          "bidder_count": 3
        }
        """
        let row = try decoder.decode(ListingSummary.self, from: Data(json.utf8))
        XCTAssertEqual(row.bidCount, 1)
        XCTAssertEqual(row.bidderCount, 3)
        XCTAssertEqual(row.resolvedBidCount, 3)
    }
}

// MARK: - Goods auction replay (`GET /api/v1/listings/{id}/replay`)

final class ListingReplayDecodingTests: XCTestCase {
    private var decoder: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }

    func testDecodesClosedListingReplayEnvelopeAndEvents() throws {
        let json = """
        {
          "listing_id": "00000000-0000-0000-0000-000000000099",
          "started_at": "2026-04-01T12:00:00Z",
          "ended_at": "2026-04-02T12:00:00Z",
          "winner_id": "00000000-0000-0000-0000-000000000001",
          "events": [
            {
              "type": "bid_placed",
              "at": "2026-04-01T12:05:00Z",
              "amount_cents": 2500,
              "anonymized_bidder": "Bidder #1"
            },
            {
              "type": "bid_placed",
              "at": "2026-04-01T12:05:01Z",
              "amount_cents": 2750,
              "anonymized_bidder": "Bidder #1"
            },
            {
              "type": "auto_bid_cascade",
              "at": "2026-04-01T12:05:01Z",
              "from": 2500,
              "to": 2750
            },
            {
              "type": "snipe_extension",
              "at": "2026-04-02T12:00:00Z",
              "extended_to": "2026-04-02T12:00:00Z"
            }
          ]
        }
        """
        let replay = try decoder.decode(ListingAuctionReplay.self, from: Data(json.utf8))
        XCTAssertEqual(replay.listingId, "00000000-0000-0000-0000-000000000099")
        XCTAssertEqual(replay.startedAt, "2026-04-01T12:00:00Z")
        XCTAssertEqual(replay.endedAt, "2026-04-02T12:00:00Z")
        XCTAssertEqual(replay.winnerId, "00000000-0000-0000-0000-000000000001")
        XCTAssertEqual(replay.events.count, 4)

        let placed = replay.events[0]
        XCTAssertEqual(placed.type, "bid_placed")
        XCTAssertEqual(placed.amountCents, 2500)
        XCTAssertEqual(placed.anonymizedBidder, "Bidder #1")
        XCTAssertEqual(placed.displayEventLabel, "Bid placed · Bidder #1")
        XCTAssertEqual(placed.displayAmountCents, 2500)

        let cascade = replay.events[2]
        XCTAssertEqual(cascade.type, "auto_bid_cascade")
        XCTAssertEqual(cascade.fromCents, 2500)
        XCTAssertEqual(cascade.toCents, 2750)
        XCTAssertEqual(cascade.displayEventLabel, "Auto-bid cascade")
        XCTAssertEqual(cascade.displayAmountCents, 2750)

        let snipe = replay.events[3]
        XCTAssertEqual(snipe.type, "snipe_extension")
        XCTAssertEqual(snipe.extendedTo, "2026-04-02T12:00:00Z")
        XCTAssertEqual(snipe.displayEventLabel, "Time extended")
        XCTAssertNil(snipe.displayAmountCents)
    }

    func testNullWinnerAndMissingEventsDecodeAsEmpty() throws {
        let json = """
        {
          "listing_id": "00000000-0000-0000-0000-000000000099",
          "started_at": "2026-04-01T12:00:00Z",
          "ended_at": null,
          "winner_id": null
        }
        """
        let replay = try decoder.decode(ListingAuctionReplay.self, from: Data(json.utf8))
        XCTAssertNil(replay.endedAt)
        XCTAssertNil(replay.winnerId)
        XCTAssertTrue(replay.events.isEmpty)
    }
}
