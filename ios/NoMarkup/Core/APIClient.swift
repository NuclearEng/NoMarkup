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

    // MARK: - Helpers

    /// JSON GET with path components + query. When `authorized` is true, attaches Bearer.
    private func getJSON<T: Decodable>(
        pathComponents: [String],
        query: [URLQueryItem] = [],
        authorized: Bool = false
    ) async throws -> T {
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

        let request: URLRequest
        if authorized {
            var authorizedRequest = try authorizedRequest(url: finalURL, method: "GET")
            authorizedRequest.timeoutInterval = 20
            // authorizedRequest already sets Accept; ensure Bearer was present when required.
            if authorizedRequest.value(forHTTPHeaderField: "Authorization") == nil {
                throw APIClientError.unauthorized
            }
            request = authorizedRequest
        } else {
            var publicRequest = URLRequest(url: finalURL)
            publicRequest.httpMethod = "GET"
            publicRequest.setValue("application/json", forHTTPHeaderField: "Accept")
            publicRequest.timeoutInterval = 20
            request = publicRequest
        }

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw APIClientError.unreachable
        }
        try Self.throwIfNeeded(response: response, data: data)
        do {
            return try decoder.decode(T.self, from: data)
        } catch {
            throw APIClientError.decoding("Could not decode response: \(error.localizedDescription)")
        }
    }

    private static func throwIfNeeded(response: URLResponse, data: Data) throws {
        guard let http = response as? HTTPURLResponse else {
            throw APIClientError.unreachable
        }
        guard (200 ... 299).contains(http.statusCode) else {
            if http.statusCode == 401 {
                throw APIClientError.unauthorized
            }
            let snippet = String(data: data, encoding: .utf8)?.prefix(200) ?? ""
            throw APIClientError.httpStatus(http.statusCode, detail: String(snippet))
        }
    }
}

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
            return "Session expired. Please sign in again."
        case .httpStatus(let code, let detail):
            return detail.isEmpty ? "API error (\(code))." : "API error (\(code)): \(detail)"
        case .decoding(let message):
            return message
        }
    }
}
