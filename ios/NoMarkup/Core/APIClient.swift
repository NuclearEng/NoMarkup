import Foundation

/// Lightweight URLSession client for the Go API gateway.
///
/// Stage B3: public marketplace listings + jobs list/detail (no auth).
/// Auth (login / refresh / Apple / account deletion) remains separate.
actor APIClient {
    static let shared = APIClient()

    private let session: URLSession
    private let tokenStore: KeychainTokenStore
    private let decoder: JSONDecoder

    init(
        session: URLSession = .shared,
        tokenStore: KeychainTokenStore? = nil
    ) {
        self.session = session
        self.tokenStore = tokenStore ?? KeychainTokenStore()
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        decoder.dateDecodingStrategy = .iso8601
        self.decoder = decoder
    }

    // MARK: - Health

    /// GET `{base}/health` (or `/api/v1/health` depending on gateway route).
    /// Returns true when the gateway responds 2xx.
    func health() async throws -> Bool {
        // Prefer common gateway health paths; first success wins.
        let candidates = [
            AppConfig.apiBaseURL.appending(path: "health"),
            AppConfig.apiBaseURL.appending(path: "api/v1/health"),
        ]

        var lastError: Error = APIClientError.unreachable
        for url in candidates {
            var request = URLRequest(url: url)
            request.httpMethod = "GET"
            request.timeoutInterval = 8
            do {
                let (_, response) = try await session.data(for: request)
                if let http = response as? HTTPURLResponse, (200 ... 299).contains(http.statusCode) {
                    return true
                }
                lastError = APIClientError.httpStatus((response as? HTTPURLResponse)?.statusCode ?? -1)
            } catch {
                lastError = error
            }
        }
        throw lastError
    }

    // MARK: - Auth hooks (stubs)

    /// POST email/password login — structure only; not fully wired to gateway DTO.
    func login(email: String, password: String) async throws -> AuthTokenPair {
        let url = AppConfig.apiBaseURL.appending(path: "api/v1/auth/login")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")

        let body = LoginRequestBody(email: email, password: password)
        request.httpBody = try JSONEncoder().encode(body)

        let (data, response) = try await session.data(for: request)
        try Self.throwIfNeeded(response: response, data: data)

        // Flexible decode: accept either nested or flat token shapes; fall back to scaffold mode.
        if let pair = try? decoder.decode(AuthTokenPair.self, from: data) {
            try tokenStore.save(pair.accessToken, for: .accessToken)
            if let refresh = pair.refreshToken {
                try tokenStore.save(refresh, for: .refreshToken)
            }
            return pair
        }

        // Scaffold: when gateway is down or shape differs, surface a clear error.
        throw APIClientError.decoding("Unexpected login response shape")
    }

    /// Refresh access token using stored refresh token.
    func refreshSession() async throws -> AuthTokenPair {
        guard let refresh = try tokenStore.read(.refreshToken), !refresh.isEmpty else {
            throw APIClientError.unauthorized
        }

        let url = AppConfig.apiBaseURL.appending(path: "api/v1/auth/refresh")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.httpBody = try JSONEncoder().encode(RefreshRequestBody(refreshToken: refresh))

        let (data, response) = try await session.data(for: request)
        try Self.throwIfNeeded(response: response, data: data)

        let pair = try decoder.decode(AuthTokenPair.self, from: data)
        try tokenStore.save(pair.accessToken, for: .accessToken)
        if let newRefresh = pair.refreshToken {
            try tokenStore.save(newRefresh, for: .refreshToken)
        }
        return pair
    }

    /// Attach Bearer token for authenticated calls (future feature clients).
    func authorizedRequest(url: URL, method: String = "GET") throws -> URLRequest {
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let access = try tokenStore.read(.accessToken), !access.isEmpty {
            request.setValue("Bearer \(access)", forHTTPHeaderField: "Authorization")
        }
        return request
    }

    /// POST /api/v1/auth/apple/native — AuthenticationServices identityToken exchange.
    func signInWithApple(identityToken: String, fullName: String?) async throws -> AuthTokenPair {
        let url = AppConfig.apiBaseURL.appending(path: "api/v1/auth/apple/native")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        var body: [String: String] = ["identity_token": identityToken]
        if let fullName, !fullName.isEmpty {
            body["full_name"] = fullName
        }
        request.httpBody = try JSONEncoder().encode(body)

        let (data, response) = try await session.data(for: request)
        try Self.throwIfNeeded(response: response, data: data)
        let pair = try decoder.decode(AuthTokenPair.self, from: data)
        try tokenStore.save(pair.accessToken, for: .accessToken)
        if let refresh = pair.refreshToken {
            try tokenStore.save(refresh, for: .refreshToken)
        }
        return pair
    }

    /// DELETE /api/v1/users/me — schedule account deletion (30-day grace).
    func requestAccountDeletion(reason: String) async throws {
        let url = AppConfig.apiBaseURL.appending(path: "api/v1/users/me")
        var request = try authorizedRequest(url: url, method: "DELETE")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let body = DeletionRequestBody(reason: reason, confirmation: "DELETE")
        request.httpBody = try JSONEncoder().encode(body)
        let (data, response) = try await session.data(for: request)
        try Self.throwIfNeeded(response: response, data: data)
    }

    /// GET /api/v1/users/me/export — download owner-scoped data export JSON.
    func exportMyData() async throws -> Data {
        let url = AppConfig.apiBaseURL.appending(path: "api/v1/users/me/export")
        let request = try authorizedRequest(url: url, method: "GET")
        let (data, response) = try await session.data(for: request)
        try Self.throwIfNeeded(response: response, data: data)
        return data
    }

    /// GET /api/v1/flags — public flat map of flag key → enabled.
    /// Alias `/api/v1/feature-flags` exists on the gateway; primary path is `/flags`.
    func fetchFeatureFlags() async throws -> [String: Bool] {
        let url = AppConfig.apiBaseURL.appending(path: "api/v1/flags")
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.timeoutInterval = 8

        let (data, response) = try await session.data(for: request)
        try Self.throwIfNeeded(response: response, data: data)

        // Plain decoder: flag keys are snake_case identifiers and must not be rewritten.
        let plain = JSONDecoder()
        do {
            return try plain.decode([String: Bool].self, from: data)
        } catch {
            throw APIClientError.decoding("Unexpected feature-flags response shape")
        }
    }

    func clearTokens() throws {
        try tokenStore.clearSession()
    }

    // MARK: - Public catalog (no auth)

    /// GET `/api/v1/listings?page=&page_size=&q=`
    func fetchListings(page: Int = 1, pageSize: Int = 20, q: String? = nil) async throws -> ListingsResponse {
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
        return try await getJSON(pathComponents: ["api", "v1", "listings"], query: items)
    }

    /// GET `/api/v1/listings/{id}` → `{ "listing": ... }`
    func fetchListing(id: String) async throws -> ListingDetail {
        let wrapped: ListingDetailResponse = try await getJSON(
            pathComponents: ["api", "v1", "listings", id]
        )
        return wrapped.listing
    }

    /// GET `/api/v1/jobs?page=&page_size=&q=`
    func fetchJobs(page: Int = 1, pageSize: Int = 20, q: String? = nil) async throws -> JobsResponse {
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
        return try await getJSON(pathComponents: ["api", "v1", "jobs"], query: items)
    }

    /// GET `/api/v1/jobs/{id}` → `{ "job": ... }`
    func fetchJob(id: String) async throws -> JobDetail {
        let wrapped: JobDetailResponse = try await getJSON(
            pathComponents: ["api", "v1", "jobs", id]
        )
        return wrapped.job
    }

    // MARK: - Authenticated catalog / chat

    /// GET `/api/v1/jobs/mine?page=&page_size=` — owner-scoped jobs (Bearer required).
    func fetchMyJobs(page: Int = 1, pageSize: Int = 20) async throws -> JobsMineResponse {
        let items = [
            URLQueryItem(name: "page", value: String(max(1, page))),
            URLQueryItem(name: "page_size", value: String(min(max(1, pageSize), 100))),
        ]
        return try await getJSON(
            pathComponents: ["api", "v1", "jobs", "mine"],
            query: items,
            authorized: true
        )
    }

    /// GET `/api/v1/channels?page=&page_size=` — chat inbox (Bearer required).
    func fetchChatChannels(page: Int = 1, pageSize: Int = 40) async throws -> ChatChannelsResponse {
        let items = [
            URLQueryItem(name: "page", value: String(max(1, page))),
            URLQueryItem(name: "page_size", value: String(min(max(1, pageSize), 100))),
        ]
        return try await getJSON(
            pathComponents: ["api", "v1", "channels"],
            query: items,
            authorized: true
        )
    }

    /// GET `/api/v1/channels/{id}/messages?page_size=` — thread messages (Bearer required).
    func fetchChannelMessages(channelID: String, pageSize: Int = 50) async throws -> ChatMessagesResponse {
        let items = [
            URLQueryItem(name: "page_size", value: String(min(max(1, pageSize), 100))),
        ]
        return try await getJSON(
            pathComponents: ["api", "v1", "channels", channelID, "messages"],
            query: items,
            authorized: true
        )
    }

    /// POST `/api/v1/channels/{id}/messages` — send a text message (Bearer required).
    /// Body: `{ "content": "...", "message_type": "text" }`. Returns the created message (201).
    @discardableResult
    func sendChannelMessage(
        channelID: String,
        content: String,
        messageType: String = "text"
    ) async throws -> ChatMessage {
        let trimmed = content.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "Message cannot be empty.")
        }
        guard trimmed.count <= 2000 else {
            throw APIClientError.httpStatus(400, detail: "Message must be at most 2000 characters.")
        }
        let body = SendMessageRequestBody(content: trimmed, messageType: messageType)
        return try await postJSON(
            pathComponents: ["api", "v1", "channels", channelID, "messages"],
            body: body,
            authorized: .required
        )
    }

    /// Best-effort current user id from the access-token JWT `sub` claim (no signature verify).
    /// Used only for UI alignment (outgoing bubbles), not for auth decisions.
    func currentUserID() -> String? {
        guard let token = try? tokenStore.read(.accessToken), !token.isEmpty else {
            return nil
        }
        return JWTPayload.userID(from: token)
    }

    // MARK: - Mutations (report + bids)

    /// POST `/api/v1/listings/{id}/report` — optional auth (Bearer attached when present).
    /// Body: `{ "reason": "...", "description": "..." }`
    @discardableResult
    func reportListing(id: String, reason: String, description: String) async throws -> ListingReportResponse {
        let body = ListingReportRequestBody(reason: reason, description: description)
        return try await postJSON(
            pathComponents: ["api", "v1", "listings", id, "report"],
            body: body,
            authorized: .optional
        )
    }

    /// POST `/api/v1/jobs/{id}/bids` — auth required (provider role on server).
    /// Body: `{ "amount_cents": N }`
    @discardableResult
    func placeJobBid(jobId: String, amountCents: Int64) async throws -> Data {
        let body = AmountCentsBody(amountCents: amountCents)
        return try await postData(
            pathComponents: ["api", "v1", "jobs", jobId, "bids"],
            body: body,
            authorized: .required
        )
    }

    /// POST `/api/v1/listings/{id}/bids` — auth required.
    /// Body: `{ "amount_cents": N }` (optional `max_bid_cents` omitted for MVP).
    @discardableResult
    func placeListingBid(listingId: String, amountCents: Int64) async throws -> Data {
        let body = AmountCentsBody(amountCents: amountCents)
        return try await postData(
            pathComponents: ["api", "v1", "listings", listingId, "bids"],
            body: body,
            authorized: .required
        )
    }

    // MARK: - Rail A payments (Stripe / Apple Pay)

    /// POST `/api/v1/listings/{id}/buy-now` — auth required.
    /// Returns order + PaymentIntent `client_secret` for Apple Pay confirmation.
    /// Idempotency-Key: `buy-now:{listingId}` (MON-06/22).
    func buyNow(listingId: String) async throws -> BuyNowResponse {
        try await postJSON(
            pathComponents: ["api", "v1", "listings", listingId, "buy-now"],
            body: EmptyJSONObject(),
            authorized: .required,
            headers: ["Idempotency-Key": "buy-now:\(listingId)"]
        )
    }

    /// POST `/api/v1/orders/{id}/pay` — mint/resume PI for `pending_payment` orders.
    /// Idempotency-Key: `order-pay:{orderId}`.
    func payOrder(orderId: String) async throws -> PaymentIntentEnvelope {
        try await postJSON(
            pathComponents: ["api", "v1", "orders", orderId, "pay"],
            body: EmptyJSONObject(),
            authorized: .required,
            headers: ["Idempotency-Key": "order-pay:\(orderId)"]
        )
    }

    /// GET `/api/v1/me/orders` — buyer/seller order list (Bearer required).
    func fetchMyOrders() async throws -> MyOrdersResponse {
        try await getJSON(
            pathComponents: ["api", "v1", "me", "orders"],
            authorized: true
        )
    }

    // MARK: - Helpers

    private enum AuthMode {
        /// Never attach Bearer; public endpoint.
        case none
        /// Attach Bearer when a token exists; do not fail if missing.
        case optional
        /// Require a non-empty access token; throw `.unauthorized` otherwise.
        case required
    }

    /// JSON GET with path components + query. When `authorized` is true, attaches Bearer.
    private func getJSON<T: Decodable>(
        pathComponents: [String],
        query: [URLQueryItem] = [],
        authorized: Bool = false
    ) async throws -> T {
        let data = try await perform(
            method: "GET",
            pathComponents: pathComponents,
            query: query,
            body: nil as EmptyBody?,
            auth: authorized ? .required : .none
        )
        do {
            return try decoder.decode(T.self, from: data)
        } catch {
            throw APIClientError.decoding("Could not decode response: \(error.localizedDescription)")
        }
    }

    private func postJSON<Body: Encodable, T: Decodable>(
        pathComponents: [String],
        body: Body,
        authorized: AuthMode,
        headers: [String: String] = [:]
    ) async throws -> T {
        let data = try await postData(
            pathComponents: pathComponents,
            body: body,
            authorized: authorized,
            headers: headers
        )
        do {
            return try decoder.decode(T.self, from: data)
        } catch {
            // Some mutation endpoints return flexible shapes; prefer empty success over hard fail
            // when status was already 2xx. Fall through only if decode fails entirely.
            throw APIClientError.decoding("Could not decode response: \(error.localizedDescription)")
        }
    }

    private func postData<Body: Encodable>(
        pathComponents: [String],
        body: Body,
        authorized: AuthMode,
        headers: [String: String] = [:]
    ) async throws -> Data {
        try await perform(
            method: "POST",
            pathComponents: pathComponents,
            query: [],
            body: body,
            auth: authorized,
            headers: headers
        )
    }

    private func perform<Body: Encodable>(
        method: String,
        pathComponents: [String],
        query: [URLQueryItem],
        body: Body?,
        auth: AuthMode,
        headers: [String: String] = [:]
    ) async throws -> Data {
        var url = AppConfig.apiBaseURL
        for component in pathComponents {
            url = url.appending(path: component)
        }
        guard var components = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
            throw APIClientError.unreachable
        }
        if !query.isEmpty {
            components.queryItems = query
        }
        guard let finalURL = components.url else {
            throw APIClientError.unreachable
        }

        var request: URLRequest
        switch auth {
        case .none:
            request = URLRequest(url: finalURL)
            request.httpMethod = method
            request.setValue("application/json", forHTTPHeaderField: "Accept")
        case .optional:
            request = try authorizedRequest(url: finalURL, method: method)
        case .required:
            request = try authorizedRequest(url: finalURL, method: method)
            if request.value(forHTTPHeaderField: "Authorization") == nil {
                throw APIClientError.unauthorized
            }
        }
        request.timeoutInterval = 30

        for (key, value) in headers {
            request.setValue(value, forHTTPHeaderField: key)
        }

        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            let encoder = JSONEncoder()
            // Gateway expects snake_case keys (amount_cents, etc.).
            encoder.keyEncodingStrategy = .convertToSnakeCase
            request.httpBody = try encoder.encode(body)
        }

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw APIClientError.unreachable
        }
        try Self.throwIfNeeded(response: response, data: data)
        return data
    }

    private static func throwIfNeeded(response: URLResponse, data: Data) throws {
        guard let http = response as? HTTPURLResponse else {
            throw APIClientError.unreachable
        }
        guard (200 ... 299).contains(http.statusCode) else {
            if http.statusCode == 401 {
                throw APIClientError.unauthorized
            }
            // Prefer gateway `{ "error": "..." }` message when present.
            if let apiMessage = Self.extractAPIErrorMessage(from: data), !apiMessage.isEmpty {
                throw APIClientError.httpStatus(http.statusCode, detail: apiMessage)
            }
            let snippet = String(data: data, encoding: .utf8)?.prefix(200) ?? ""
            throw APIClientError.httpStatus(http.statusCode, detail: String(snippet))
        }
    }

    private static func extractAPIErrorMessage(from data: Data) -> String? {
        struct APIErrorBody: Decodable {
            let error: String?
            let message: String?
        }
        guard let body = try? JSONDecoder().decode(APIErrorBody.self, from: data) else {
            return nil
        }
        if let error = body.error, !error.isEmpty { return error }
        if let message = body.message, !message.isEmpty { return message }
        return nil
    }
}

/// Empty body placeholder for GET-style `perform` calls.
private struct EmptyBody: Encodable {}

/// Encodes as `{}` for POSTs that require a JSON content-type but no fields.
private struct EmptyJSONObject: Encodable {}

// MARK: - Models

struct AuthTokenPair: Codable, Sendable {
    let accessToken: String
    let refreshToken: String?

    enum CodingKeys: String, CodingKey {
        case accessToken = "access_token"
        case refreshToken = "refresh_token"
        case accessTokenCamel = "accessToken"
        case refreshTokenCamel = "refreshToken"
        case token
    }

    init(accessToken: String, refreshToken: String?) {
        self.accessToken = accessToken
        self.refreshToken = refreshToken
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        if let a = try c.decodeIfPresent(String.self, forKey: .accessToken) {
            accessToken = a
        } else if let a = try c.decodeIfPresent(String.self, forKey: .accessTokenCamel) {
            accessToken = a
        } else if let a = try c.decodeIfPresent(String.self, forKey: .token) {
            accessToken = a
        } else {
            throw DecodingError.keyNotFound(
                CodingKeys.accessToken,
                .init(codingPath: c.codingPath, debugDescription: "missing access token")
            )
        }
        if let refresh = try c.decodeIfPresent(String.self, forKey: .refreshToken) {
            refreshToken = refresh
        } else {
            refreshToken = try c.decodeIfPresent(String.self, forKey: .refreshTokenCamel)
        }
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(accessToken, forKey: .accessToken)
        try c.encodeIfPresent(refreshToken, forKey: .refreshToken)
    }
}

private struct LoginRequestBody: Encodable {
    let email: String
    let password: String
}

private struct RefreshRequestBody: Encodable {
    let refreshToken: String

    enum CodingKeys: String, CodingKey {
        case refreshToken = "refresh_token"
    }
}

private struct DeletionRequestBody: Encodable {
    let reason: String
    let confirmation: String
}

private struct ListingReportRequestBody: Encodable {
    let reason: String
    let description: String
}

private struct AmountCentsBody: Encodable {
    let amountCents: Int64
}

private struct SendMessageRequestBody: Encodable {
    let content: String
    let messageType: String
}

/// Unverified JWT payload decode for client UI hints only (subject / email).
enum JWTPayload {
    /// Extracts `sub` (user id) from a compact JWT without verifying the signature.
    static func userID(from jwt: String) -> String? {
        payload(from: jwt)?["sub"] as? String
    }

    /// Extracts `email` when present on the access token.
    static func email(from jwt: String) -> String? {
        payload(from: jwt)?["email"] as? String
    }

    private static func payload(from jwt: String) -> [String: Any]? {
        let parts = jwt.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count >= 2 else { return nil }
        var base64 = String(parts[1])
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        let pad = (4 - base64.count % 4) % 4
        if pad > 0 {
            base64.append(String(repeating: "=", count: pad))
        }
        guard let data = Data(base64Encoded: base64),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else {
            return nil
        }
        return obj
    }
}

/// Flexible decode for `POST /listings/{id}/report` success / already_reported shapes.
struct ListingReportResponse: Codable, Sendable {
    let id: String?
    let status: String?
    let message: String?

    var isAlreadyReported: Bool {
        status == "already_reported"
    }

    var userFacingMessage: String {
        if isAlreadyReported {
            return message ?? "You've already flagged this listing."
        }
        if let message, !message.isEmpty {
            return message
        }
        return "Thanks — your report was submitted."
    }
}

enum APIClientError: Error, LocalizedError {
    case unreachable
    case unauthorized
    case httpStatus(Int, detail: String = "")
    case decoding(String)

    var isUnauthorized: Bool {
        if case .unauthorized = self { return true }
        return false
    }

    var errorDescription: String? {
        switch self {
        case .unreachable:
            return "Could not reach the NoMarkup API at \(AppConfig.apiBaseURLString)."
        case .unauthorized:
            return "Sign in required. Your session is missing or expired — please sign in again."
        case .httpStatus(let code, let detail):
            if code == 403 {
                return detail.isEmpty
                    ? "You don’t have permission for this action."
                    : detail
            }
            return detail.isEmpty ? "API error (\(code))." : detail
        case .decoding(let message):
            return message
        }
    }
}
