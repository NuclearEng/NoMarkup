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
}
