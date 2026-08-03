import Foundation

/// Lightweight URLSession client for the Go API gateway.
///
/// Stage B3: public marketplace listings + jobs list/detail (no auth).
/// Auth (login / refresh / Apple / account deletion) remains separate.
actor APIClient {
    static let shared = APIClient()

    private let session: URLSession
    /// Shared keychain store — also used by auth helpers via `tokenStoreForAuth`.
    private let tokenStore: KeychainTokenStore
    private let decoder: JSONDecoder
    /// Single-flight refresh so parallel 401s don't rotate the refresh token twice.
    private var refreshTask: Task<AuthTokenPair, Error>?

    /// Sticky Idempotency-Key map (web `idempotencyHeader` parity).
    /// Logical operation id → header value. Retries reuse the same key until
    /// `clearIdempotencyKey` after a terminal success so intentional re-attempts mint fresh.
    private var idempotencyKeyByOperation: [String: String] = [:]

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

    // MARK: - Sticky Idempotency-Key (money mutations)

    /// Returns `Idempotency-Key` header for a stable logical operation id.
    /// Same `operationKey` reuses one UUID across retries / double-taps until cleared.
    func idempotencyHeader(for operationKey: String) -> [String: String] {
        let trimmed = operationKey.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            return ["Idempotency-Key": UUID().uuidString]
        }
        if let existing = idempotencyKeyByOperation[trimmed] {
            return ["Idempotency-Key": existing]
        }
        let minted = UUID().uuidString
        idempotencyKeyByOperation[trimmed] = minted
        return ["Idempotency-Key": minted]
    }

    /// Drop a stored key so the next call for this operation mints a fresh one.
    func clearIdempotencyKey(_ operationKey: String) {
        let trimmed = operationKey.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        idempotencyKeyByOperation.removeValue(forKey: trimmed)
    }

    /// Shared keychain for extension modules (auth) so login/refresh share one store.
    nonisolated var tokenStoreForAuth: KeychainTokenStore {
        // Keychain is process-global by service; returning a new store with default
        // service is equivalent, but prefer reading via actor when possible.
        KeychainTokenStore()
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

    /// Refresh access token using stored refresh token (single-flight).
    /// Parallel 401s share one refresh so rotated refresh tokens aren't burned twice.
    func refreshSession() async throws -> AuthTokenPair {
        if let existing = refreshTask {
            return try await existing.value
        }
        let task = Task<AuthTokenPair, Error> {
            try await self.performRefreshSession()
        }
        refreshTask = task
        do {
            let pair = try await task.value
            refreshTask = nil
            return pair
        } catch {
            refreshTask = nil
            throw error
        }
    }

    private func performRefreshSession() async throws -> AuthTokenPair {
        guard let refresh = try tokenStore.read(.refreshToken), !refresh.isEmpty else {
            throw APIClientError.unauthorized
        }

        let url = AppConfig.apiBaseURL.appending(path: "api/v1/auth/refresh")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.timeoutInterval = 20
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
    /// - Parameter nonce: RAW nonce whose SHA256 hex was set on
    ///   `ASAuthorizationAppleIDRequest.nonce` (and therefore appears as the id_token
    ///   `nonce` claim). REQUIRED by the gateway for native exchanges (absent → 400);
    ///   it re-hashes and verifies `sha256hex(body.nonce) == id_token.nonce`
    ///   (IOS-SEC.1 replay binding).
    func signInWithApple(
        identityToken: String,
        fullName: String?,
        nonce: String? = nil
    ) async throws -> AuthTokenPair {
        let url = AppConfig.apiBaseURL.appending(path: "api/v1/auth/apple/native")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        var body: [String: String] = ["identity_token": identityToken]
        if let fullName, !fullName.isEmpty {
            body["full_name"] = fullName
        }
        if let nonce, !nonce.isEmpty {
            body["nonce"] = nonce
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

    /// POST /api/v1/auth/google/native — Google OIDC id_token from ASWebAuth + PKCE.
    ///
    /// The id_token must be a real Google-signed JWT (aud = GOOGLE_IOS_CLIENT_ID /
    /// GOOGLE_CLIENT_ID). Do not invent or self-sign tokens.
    func signInWithGoogle(identityToken: String, fullName: String? = nil) async throws -> AuthTokenPair {
        let url = AppConfig.apiBaseURL.appending(path: "api/v1/auth/google/native")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.timeoutInterval = 20
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

    /// POST /api/v1/auth/facebook/native — authorization code (+ redirect_uri) server exchange.
    ///
    /// Client never holds FACEBOOK_CLIENT_SECRET. Code comes from ASWebAuthenticationSession.
    func signInWithFacebook(authorizationCode: String, redirectURI: String) async throws -> AuthTokenPair {
        let url = AppConfig.apiBaseURL.appending(path: "api/v1/auth/facebook/native")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.timeoutInterval = 20
        let body: [String: String] = [
            "authorization_code": authorizationCode,
            "redirect_uri": redirectURI,
        ]
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

    /// GET `/api/v1/listings?page=&page_size=&q=&category_slug=&lat=&lng=&radius_km=`
    ///
    /// When `latitude` + `longitude` + `radiusKm` are all provided, the gateway
    /// applies the local pickup radius (`ST_DWithin`, capped ~25 mi / 40 km) and
    /// populates `distance_km` on each listing. Omit geo params for unscoped browse.
    func fetchListings(
        page: Int = 1,
        pageSize: Int = 20,
        q: String? = nil,
        categorySlug: String? = nil,
        latitude: Double? = nil,
        longitude: Double? = nil,
        radiusKm: Double? = nil
    ) async throws -> ListingsResponse {
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
        if let categorySlug {
            let slug = categorySlug.trimmingCharacters(in: .whitespacesAndNewlines)
            if !slug.isEmpty {
                items.append(URLQueryItem(name: "category_slug", value: slug))
            }
        }
        // Gateway requires both center and radius for geo filter; lat/lng alone
        // still projects distance_km when a center resolves.
        if let latitude, let longitude,
           latitude >= -90, latitude <= 90,
           longitude >= -180, longitude <= 180
        {
            items.append(URLQueryItem(name: "lat", value: String(latitude)))
            items.append(URLQueryItem(name: "lng", value: String(longitude)))
            if let radiusKm, radiusKm > 0 {
                items.append(URLQueryItem(name: "radius_km", value: String(radiusKm)))
            }
        }
        return try await getJSON(pathComponents: ["api", "v1", "listings"], query: items)
    }

    /// GET `/api/v1/listings/autocomplete?q=&limit=` — typeahead (categories + listings).
    func autocompleteListings(q: String, limit: Int = 10) async throws -> [ListingAutocompleteSuggestion] {
        let trimmed = q.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.count >= 2 else { return [] }
        let capped = min(max(1, limit), 25)
        let items = [
            URLQueryItem(name: "q", value: trimmed),
            URLQueryItem(name: "limit", value: String(capped)),
        ]
        let response: ListingsAutocompleteResponse = try await getJSON(
            pathComponents: ["api", "v1", "listings", "autocomplete"],
            query: items
        )
        return response.suggestions ?? []
    }

    /// GET `/api/v1/listings/{id}` → `{ "listing": ... }`
    func fetchListing(id: String) async throws -> ListingDetail {
        let wrapped: ListingDetailResponse = try await getJSON(
            pathComponents: ["api", "v1", "listings", id]
        )
        return wrapped.listing
    }

    /// GET `/api/v1/jobs?page=&page_size=&q=&category_ids=&latitude=&longitude=&radius_km=`
    /// - Parameter categoryIds: optional comma-joined filter (`category_ids` query; gateway splits on commas).
    /// - Parameter latitude/longitude: when both set, server returns `distance_km` (FR-10.7).
    func fetchJobs(
        page: Int = 1,
        pageSize: Int = 20,
        q: String? = nil,
        categoryIds: [String]? = nil,
        latitude: Double? = nil,
        longitude: Double? = nil,
        radiusKm: Double? = nil
    ) async throws -> JobsResponse {
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
        if let categoryIds {
            let cleaned = categoryIds
                .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
                .filter { !$0.isEmpty }
            if !cleaned.isEmpty {
                items.append(URLQueryItem(name: "category_ids", value: cleaned.joined(separator: ",")))
            }
        }
        if let latitude, let longitude {
            items.append(URLQueryItem(name: "latitude", value: String(latitude)))
            items.append(URLQueryItem(name: "longitude", value: String(longitude)))
            if let radiusKm, radiusKm > 0 {
                items.append(URLQueryItem(name: "radius_km", value: String(radiusKm)))
            }
        }
        return try await getJSON(pathComponents: ["api", "v1", "jobs"], query: items)
    }

    /// GET `/api/v1/jobs/{id}` → `{ "job": ... }`
    ///
    /// Uses **optional** auth: public callers still load the job; signed-in
    /// parties receive server-gated `exact_address` (owner / awarded provider).
    func fetchJob(id: String) async throws -> JobDetail {
        let wrapped: JobDetailResponse = try await getJSON(
            pathComponents: ["api", "v1", "jobs", id],
            authorized: .optional
        )
        return wrapped.job
    }

    // MARK: - Authenticated catalog / chat

    /// GET `/api/v1/jobs/mine?page=&page_size=&property_id=&status=` — owner-scoped jobs (Bearer required).
    /// `property_id` filters to one saved service location (FR-19 property dashboard).
    func fetchMyJobs(
        page: Int = 1,
        pageSize: Int = 20,
        propertyId: String? = nil,
        status: String? = nil
    ) async throws -> JobsMineResponse {
        var items = [
            URLQueryItem(name: "page", value: String(max(1, page))),
            URLQueryItem(name: "page_size", value: String(min(max(1, pageSize), 100))),
        ]
        if let propertyId {
            let trimmed = propertyId.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmed.isEmpty {
                items.append(URLQueryItem(name: "property_id", value: trimmed))
            }
        }
        if let status {
            let trimmed = status.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmed.isEmpty {
                items.append(URLQueryItem(name: "status", value: trimmed))
            }
        }
        return try await getJSON(
            pathComponents: ["api", "v1", "jobs", "mine"],
            query: items,
            authorized: true
        )
    }

    /// GET `/api/v1/jobs/mine?property_id=` — job history for one property (FR-19.3).
    ///
    /// Gateway filters customer jobs by `property_id` on the mine route (not the public list).
    func fetchJobs(
        propertyId: String,
        page: Int = 1,
        pageSize: Int = 50
    ) async throws -> JobsMineResponse {
        let trimmed = propertyId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "Property id is required.")
        }
        return try await fetchMyJobs(page: page, pageSize: pageSize, propertyId: trimmed)
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

    /// POST `/api/v1/channels` — FR-8.1 open inquiry (pre-bid) or bid channel.
    /// Body: `{ "job_id", "channel_type": "inquiry"|"bid" }`. Caller must be provider (not job owner).
    @discardableResult
    func createChatChannel(jobId: String, channelType: String = "inquiry") async throws -> ChatChannelSummary {
        struct Body: Encodable {
            var jobId: String
            var channelType: String
        }
        struct Envelope: Decodable {
            var channel: ChatChannelSummary?
        }
        let type = channelType.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let wireType = type.isEmpty ? "inquiry" : type
        let response: Envelope = try await postJSON(
            pathComponents: ["api", "v1", "channels"],
            body: Body(jobId: jobId, channelType: wireType),
            authorized: .required
        )
        guard let channel = response.channel else {
            throw APIClientError.httpStatus(502, detail: "Channel missing from create response.")
        }
        return channel
    }

    /// POST `/api/v1/channels/{id}/share-contact` — FR-8.8 explicit opt-in contact share.
    @discardableResult
    func shareChannelContact(channelID: String, phone: String?, email: String?) async throws {
        struct Body: Encodable {
            var phone: String?
            var email: String?
        }
        let phoneTrim = phone?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let emailTrim = email?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !phoneTrim.isEmpty || !emailTrim.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "Phone or email is required.")
        }
        struct ContactEnvelope: Decodable {
            var contact: SharedContactPayload?
        }
        struct SharedContactPayload: Decodable {
            var userId: String?
            var phone: String?
            var email: String?
        }
        let _: ContactEnvelope = try await postJSON(
            pathComponents: ["api", "v1", "channels", channelID, "share-contact"],
            body: Body(
                phone: phoneTrim.isEmpty ? nil : phoneTrim,
                email: emailTrim.isEmpty ? nil : emailTrim
            ),
            authorized: .required
        )
    }

    /// GET `/api/v1/channels/{id}` — single channel (Bearer required).
    /// Includes `customer_last_read_at` / `provider_last_read_at` for read receipts.
    func fetchChatChannel(channelID: String) async throws -> ChatChannelSummary {
        try await getJSON(
            pathComponents: ["api", "v1", "channels", channelID],
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

    /// POST `/api/v1/channels/{id}/messages` — send a message (Bearer required).
    /// Body: `{ "content": "...", "message_type": "text"|"image"|"file" }`.
    /// - **text**: plain body (no HTML). Empty rejected.
    /// - **image**: `content` is the public CDN URL from our imaging upload pipeline
    ///   (`ImageUploader` → upload-url → PUT → confirm, usually `job_photo` context).
    /// - **file**: absolute URL from imaging `chat_attachment` context (PDF pass-through
    ///   or image). Prefer `sendChannelFileMessage` after `ImageUploader.uploadPDF`.
    /// Returns the created message (201).
    @discardableResult
    func sendChannelMessage(
        channelID: String,
        content: String,
        messageType: String = "text"
    ) async throws -> ChatMessage {
        let type = messageType.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let wireType = (type.isEmpty || type == "text") ? "text" : type
        let trimmed = content.trimmingCharacters(in: .whitespacesAndNewlines)

        if wireType == "text" {
            guard !trimmed.isEmpty else {
                throw APIClientError.httpStatus(400, detail: "Message cannot be empty.")
            }
        } else if wireType == "image" || wireType == "file" {
            // Image/file messages must carry a URL from our upload flow (https preferred).
            guard !trimmed.isEmpty else {
                throw APIClientError.httpStatus(
                    400,
                    detail: wireType == "file" ? "File URL is required." : "Image URL is required."
                )
            }
            guard let url = URL(string: trimmed),
                  let scheme = url.scheme?.lowercased(),
                  scheme == "https" || scheme == "http",
                  url.host != nil
            else {
                throw APIClientError.httpStatus(
                    400,
                    detail: wireType == "file"
                        ? "File URL must be an absolute http(s) URL from upload."
                        : "Image URL must be an absolute http(s) URL from upload."
                )
            }
        } else {
            guard !trimmed.isEmpty else {
                throw APIClientError.httpStatus(400, detail: "Message cannot be empty.")
            }
        }

        guard trimmed.count <= 2000 else {
            throw APIClientError.httpStatus(400, detail: "Message must be at most 2000 characters.")
        }
        let body = SendMessageRequestBody(content: trimmed, messageType: wireType)
        return try await postJSON(
            pathComponents: ["api", "v1", "channels", channelID, "messages"],
            body: body,
            authorized: .required
        )
    }

    /// Upload via imaging pipeline then POST chat message with `message_type: image`.
    /// Uses `job_photo` storage context for public photos.
    @discardableResult
    func sendChannelImageMessage(channelID: String, imageURL: String) async throws -> ChatMessage {
        try await sendChannelMessage(
            channelID: channelID,
            content: imageURL,
            messageType: "image"
        )
    }

    /// POST chat message with `message_type: file` after imaging `chat_attachment` upload.
    @discardableResult
    func sendChannelFileMessage(channelID: String, fileURL: String) async throws -> ChatMessage {
        try await sendChannelMessage(
            channelID: channelID,
            content: fileURL,
            messageType: "file"
        )
    }

    /// POST `/api/v1/channels/{id}/read` — mark channel messages read for the caller (empty body).
    /// Gateway returns `{ "status": "ok" }`. Failures are caller-owned (UI usually best-effort).
    func markChannelRead(channelID: String) async throws {
        _ = try await postData(
            pathComponents: ["api", "v1", "channels", channelID, "read"],
            body: EmptyJSONObject(),
            authorized: .required
        )
    }

    /// POST `/api/v1/channels/{id}/terms/respond` — customer Accept/Reject local terms (FR-8.9 / FR-5.4).
    /// Body: `{ "accepted": true|false }`. Party check is server-side (customer-only).
    /// Explicit consent only — never omit `accepted` (gateway 400 if missing).
    /// Returns the created `terms_accepted` / `terms_rejected` message (201).
    @discardableResult
    func respondToProposedTerms(channelID: String, accepted: Bool) async throws -> ChatMessage {
        let body = RespondToTermsRequestBody(accepted: accepted)
        return try await postJSON(
            pathComponents: ["api", "v1", "channels", channelID, "terms", "respond"],
            body: body,
            authorized: .required
        )
    }

    /// POST `/api/v1/channels/{id}/proposed-terms` — provider proposes local terms (FR-5.4 / FR-8.9).
    ///
    /// - Parameter amountCents: Integer cents only (never dollars/float). UI converts dollars → cents
    ///   before calling; gateway body field `amount` is a display string derived from cents.
    /// - Note: Auth required; chat service enforces **provider-only**. Does not bind contract terms —
    ///   customer Accept/Reject is a separate `terms/respond` call.
    @discardableResult
    func sendProposedTerms(
        channelID: String,
        paymentType: String,
        amountCents: Int64,
        milestones: String = "",
        description: String = ""
    ) async throws -> ChatMessage {
        guard amountCents > 0 else {
            throw APIClientError.httpStatus(400, detail: "amount_cents must be positive.")
        }
        let trimmedType = paymentType.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedType.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "payment_type is required.")
        }
        // Wire `amount` is human-readable USD built only from validated integer cents
        // (no client float money math; matches money-as-cents project rule).
        let body = SendProposedTermsRequestBody(
            paymentType: trimmedType,
            amount: MoneyFormat.usd(cents: amountCents),
            milestones: milestones.trimmingCharacters(in: .whitespacesAndNewlines),
            description: description.trimmingCharacters(in: .whitespacesAndNewlines)
        )
        return try await postJSON(
            pathComponents: ["api", "v1", "channels", channelID, "proposed-terms"],
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

    /// Access token for WebSocket upgrade (`Authorization: Bearer`).
    /// Caller must not log the returned value.
    func accessTokenForWebSocket() throws -> String? {
        let token = try tokenStore.read(.accessToken)
        guard let token, !token.isEmpty else { return nil }
        return token
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
    /// Idempotency-Key: sticky UUID keyed by `job-bid:{jobId}:{amountCents}` (web parity).
    /// Retries reuse the same key; cleared only after definitive success.
    @discardableResult
    func placeJobBid(jobId: String, amountCents: Int64) async throws -> Data {
        let body = AmountCentsBody(amountCents: amountCents)
        let opKey = "job-bid:\(jobId):\(amountCents)"
        let headers = idempotencyHeader(for: opKey)
        do {
            let data = try await postData(
                pathComponents: ["api", "v1", "jobs", jobId, "bids"],
                body: body,
                authorized: .required,
                headers: headers
            )
            clearIdempotencyKey(opKey)
            return data
        } catch {
            // Keep sticky key so network/double-tap retries can dedupe.
            throw error
        }
    }

    /// POST `/api/v1/listings/{id}/bids` — auth required.
    /// Body: `{ "amount_cents": N }` (optional `max_bid_cents` omitted for MVP).
    /// Idempotency-Key sticky by `listing-bid:{listingId}:{amountCents}` (MON-06/22 + web parity).
    @discardableResult
    func placeListingBid(listingId: String, amountCents: Int64) async throws -> Data {
        let body = AmountCentsBody(amountCents: amountCents)
        let opKey = "listing-bid:\(listingId):\(amountCents)"
        let headers = idempotencyHeader(for: opKey)
        do {
            let data = try await postData(
                pathComponents: ["api", "v1", "listings", listingId, "bids"],
                body: body,
                authorized: .required,
                headers: headers
            )
            clearIdempotencyKey(opKey)
            return data
        } catch {
            throw error
        }
    }

    /// GET `/api/v1/jobs/{id}/bids` — reverse-auction ladder (job owner / auth required).
    func fetchJobBids(jobId: String) async throws -> JobBidsResponse {
        try await getJSON(
            pathComponents: ["api", "v1", "jobs", jobId, "bids"],
            authorized: true
        )
    }

    /// GET `/api/v1/listings/{id}/bids` — public bid history (forward auction, ascending).
    func fetchListingBids(listingId: String) async throws -> ListingBidsResponse {
        try await getJSON(pathComponents: ["api", "v1", "listings", listingId, "bids"])
    }

    /// POST `/api/v1/jobs/{id}/bids/{bidID}/award` — customer awards a bid (creates contract).
    @discardableResult
    func awardJobBid(jobId: String, bidId: String) async throws -> Data {
        try await postData(
            pathComponents: ["api", "v1", "jobs", jobId, "bids", bidId, "award"],
            body: EmptyJSONObject(),
            authorized: .required
        )
    }

    // MARK: - Watchlist

    /// POST `/api/v1/listings/{id}/watch` — add listing to the signed-in user's watchlist.
    /// Returns `{ watching: true, watcher_count?: N }`. Idempotent.
    @discardableResult
    func watchListing(id: String) async throws -> WatchToggleResponse {
        try await postJSON(
            pathComponents: ["api", "v1", "listings", id, "watch"],
            body: EmptyJSONObject(),
            authorized: .required
        )
    }

    /// DELETE `/api/v1/listings/{id}/watch` — remove listing from watchlist.
    /// Returns `{ watching: false }`.
    @discardableResult
    func unwatchListing(id: String) async throws -> WatchToggleResponse {
        try await deleteJSON(
            pathComponents: ["api", "v1", "listings", id, "watch"],
            authorized: .required
        )
    }

    /// GET `/api/v1/me/watchlist?page=&page_size=` — watched listings (same shape as listings list).
    func fetchWatchlist(page: Int = 1, pageSize: Int = 20) async throws -> ListingsResponse {
        let items = [
            URLQueryItem(name: "page", value: String(max(1, page))),
            URLQueryItem(name: "page_size", value: String(min(max(1, pageSize), 100))),
        ]
        return try await getJSON(
            pathComponents: ["api", "v1", "me", "watchlist"],
            query: items,
            authorized: true
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

    /// GET `/api/v1/listings/bids/mine` — goods auction bids placed by the signed-in user.
    func fetchMyListingBids(page: Int = 1, pageSize: Int = 40) async throws -> MyListingBidsResponse {
        let items = [
            URLQueryItem(name: "page", value: String(max(1, page))),
            URLQueryItem(name: "page_size", value: String(min(max(1, pageSize), 100))),
        ]
        return try await getJSON(
            pathComponents: ["api", "v1", "listings", "bids", "mine"],
            query: items,
            authorized: true
        )
    }

    /// GET `/api/v1/bids/mine` — service (job) bids placed by the signed-in provider.
    func fetchMyJobBids(page: Int = 1, pageSize: Int = 40) async throws -> MyJobBidsResponse {
        let items = [
            URLQueryItem(name: "page", value: String(max(1, page))),
            URLQueryItem(name: "page_size", value: String(min(max(1, pageSize), 100))),
        ]
        return try await getJSON(
            pathComponents: ["api", "v1", "bids", "mine"],
            query: items,
            authorized: true
        )
    }

    /// GET `/api/v1/notifications` — in-app notification inbox (Bearer required).
    func fetchNotifications(page: Int = 1, pageSize: Int = 40) async throws -> NotificationsResponse {
        let items = [
            URLQueryItem(name: "page", value: String(max(1, page))),
            URLQueryItem(name: "page_size", value: String(min(max(1, pageSize), 100))),
        ]
        return try await getJSON(
            pathComponents: ["api", "v1", "notifications"],
            query: items,
            authorized: true
        )
    }

    /// POST `/api/v1/notifications/{id}/read` — mark one notification read (empty body).
    func markNotificationRead(id: String) async throws {
        _ = try await postData(
            pathComponents: ["api", "v1", "notifications", id, "read"],
            body: EmptyJSONObject(),
            authorized: .required
        )
    }

    /// POST `/api/v1/notifications/read-all` — mark all notifications read for the caller.
    @discardableResult
    func markAllNotificationsRead() async throws -> MarkAllNotificationsReadResponse {
        try await postJSON(
            pathComponents: ["api", "v1", "notifications", "read-all"],
            body: EmptyJSONObject(),
            authorized: .required
        )
    }

    /// GET `/api/v1/notifications/unread-count` — `{ "count": N }` (snake_case via decoder).
    func fetchUnreadNotificationCount() async throws -> Int {
        let response: UnreadNotificationCountResponse = try await getJSON(
            pathComponents: ["api", "v1", "notifications", "unread-count"],
            authorized: true
        )
        return response.value
    }

    /// POST `/api/v1/orders/{id}/confirm-pickup` — buyer half of the mutual escrow handshake.
    /// Body optional on the gateway; we send `{}`.
    @discardableResult
    func confirmOrderPickup(orderId: String) async throws -> OrderEscrowActionResponse {
        try await postJSON(
            pathComponents: ["api", "v1", "orders", orderId, "confirm-pickup"],
            body: EmptyJSONObject(),
            authorized: .required
        )
    }

    /// POST `/api/v1/orders/{id}/seller-confirm` — seller half of the mutual escrow handshake.
    @discardableResult
    func sellerConfirmOrder(orderId: String) async throws -> OrderEscrowActionResponse {
        try await postJSON(
            pathComponents: ["api", "v1", "orders", orderId, "seller-confirm"],
            body: EmptyJSONObject(),
            authorized: .required
        )
    }

    // MARK: - Taxonomy (public)

    /// GET `/api/v1/categories?level=` — public service-category list (id + slug + name).
    func fetchServiceCategories(level: Int? = 1) async throws -> [ServiceCategorySummary] {
        var query: [URLQueryItem] = []
        if let level {
            query.append(URLQueryItem(name: "level", value: String(level)))
        }
        let wrapped: ServiceCategoriesResponse = try await getJSON(
            pathComponents: ["api", "v1", "categories"],
            query: query
        )
        return wrapped.categories
    }

    /// GET `/api/v1/categories/tree` — nested taxonomy for pickers (`id`, `name`, `slug`, `children[]`).
    func fetchCategoryTree() async throws -> [CategoryNode] {
        let wrapped: CategoryTreeResponse = try await getJSON(
            pathComponents: ["api", "v1", "categories", "tree"]
        )
        return wrapped.categories
    }

    /// Walks the category tree for a node whose slug matches (case-insensitive).
    func resolveCategoryId(slug: String) async throws -> String? {
        let target = slug.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !target.isEmpty else { return nil }
        let tree = try await fetchCategoryTree()
        func find(_ nodes: [CategoryNode]) -> String? {
            for node in nodes {
                if (node.slug ?? "").lowercased() == target {
                    return node.id
                }
                if let kids = node.children, let hit = find(kids) {
                    return hit
                }
            }
            return nil
        }
        return find(tree)
    }

    /// GET `/api/v1/analytics/fair-price?category_id=` / `category_slug=` — optional social proof.
    /// Soft-fails to `has_data=false` on server errors; never blocks create flows.
    /// - Parameter side: `1` = service (default), `2` = goods.
    func fetchFairPrice(
        categoryId: String? = nil,
        categorySlug: String? = nil,
        zip: String? = nil,
        side: Int = 1
    ) async throws -> FairPriceResponse {
        var query: [URLQueryItem] = []
        if let categoryId {
            let id = categoryId.trimmingCharacters(in: .whitespacesAndNewlines)
            if !id.isEmpty {
                query.append(URLQueryItem(name: "category_id", value: id))
            }
        }
        if let categorySlug {
            let slug = categorySlug.trimmingCharacters(in: .whitespacesAndNewlines)
            if !slug.isEmpty {
                query.append(URLQueryItem(name: "category_slug", value: slug))
            }
        }
        guard !query.isEmpty else {
            return FairPriceResponse(hasData: false)
        }
        if let zip {
            let z = zip.trimmingCharacters(in: .whitespacesAndNewlines)
            if !z.isEmpty {
                query.append(URLQueryItem(name: "zip", value: z))
            }
        }
        if side == 1 || side == 2 {
            query.append(URLQueryItem(name: "side", value: String(side)))
        }
        return try await getJSON(
            pathComponents: ["api", "v1", "analytics", "fair-price"],
            query: query
        )
    }

    /// GET `/api/v1/analytics/market/range?category_id=` — FR-11 market band (public, edge-cached).
    /// Soft-fails to `{ has_data: false }` on empty category, 404, or transport errors so the
    /// range bar can hide entirely (never blocks post-job / bid flows).
    func fetchMarketRange(
        categoryId: String,
        subcategoryId: String? = nil,
        serviceTypeId: String? = nil,
        latitude: Double? = nil,
        longitude: Double? = nil,
        radiusKm: Double? = nil
    ) async -> MarketRangeResponse {
        let trimmed = categoryId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            return MarketRangeResponse(hasData: false)
        }
        var query: [URLQueryItem] = [
            URLQueryItem(name: "category_id", value: trimmed),
        ]
        if let subcategoryId {
            let sid = subcategoryId.trimmingCharacters(in: .whitespacesAndNewlines)
            if !sid.isEmpty {
                query.append(URLQueryItem(name: "subcategory_id", value: sid))
            }
        }
        if let serviceTypeId {
            let stid = serviceTypeId.trimmingCharacters(in: .whitespacesAndNewlines)
            if !stid.isEmpty {
                query.append(URLQueryItem(name: "service_type_id", value: stid))
            }
        }
        if let latitude, let longitude,
           latitude >= -90, latitude <= 90,
           longitude >= -180, longitude <= 180
        {
            query.append(URLQueryItem(name: "lat", value: String(latitude)))
            query.append(URLQueryItem(name: "lng", value: String(longitude)))
        }
        if let radiusKm, radiusKm > 0 {
            query.append(URLQueryItem(name: "radius_km", value: String(radiusKm)))
        }
        do {
            let response: MarketRangeResponse = try await getJSON(
                pathComponents: ["api", "v1", "analytics", "market", "range"],
                query: query,
                authorized: false
            )
            return response
        } catch {
            // Predictable empty / older 404 gateways / offline — FR-11 soft-hide.
            return MarketRangeResponse(hasData: false)
        }
    }

    // MARK: - Create (jobs + listings)

    /// POST `/api/v1/jobs` — create a service reverse-auction job (Bearer required).
    /// Response is the job JSON map (not wrapped). Idempotency-Key for safe retries.
    @discardableResult
    func createJob(
        title: String,
        description: String,
        categoryId: String? = nil,
        auctionDurationHours: Int = 24,
        startingBidCents: Int64,
        locationAddress: String? = nil,
        locationLat: Double? = nil,
        locationLng: Double? = nil,
        publish: Bool = true,
        scheduleType: String = "flexible",
        photoUrls: [String] = [],
        propertyId: String? = nil,
        offerAcceptedCents: Int64? = nil,
        isRecurring: Bool = false,
        recurrenceFrequency: String? = nil
    ) async throws -> JobDetail {
        let trimmedTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedTitle.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "Title is required.")
        }
        if let offer = offerAcceptedCents, offer > 0, offer > startingBidCents {
            throw APIClientError.httpStatus(
                400,
                detail: "Offer-accepted price must be at or below the starting bid."
            )
        }
        let body = CreateJobRequestBody(
            title: trimmedTitle,
            description: description.trimmingCharacters(in: .whitespacesAndNewlines),
            categoryId: categoryId.flatMap { t in
                let s = t.trimmingCharacters(in: .whitespacesAndNewlines)
                return s.isEmpty ? nil : s
            },
            auctionDurationHours: auctionDurationHours,
            startingBidCents: startingBidCents,
            // Prefer live reverse auctions so the owner ladder + countdown feel real-time.
            auctionType: "live",
            locationAddress: locationAddress.flatMap { t in
                let s = t.trimmingCharacters(in: .whitespacesAndNewlines)
                return s.isEmpty ? nil : s
            },
            locationLat: locationLat,
            locationLng: locationLng,
            publish: publish,
            scheduleType: scheduleType,
            photoUrls: photoUrls,
            propertyId: propertyId.flatMap { t in
                let s = t.trimmingCharacters(in: .whitespacesAndNewlines)
                return s.isEmpty ? nil : s
            },
            offerAcceptedCents: (offerAcceptedCents ?? 0) > 0 ? offerAcceptedCents : nil,
            isRecurring: isRecurring,
            recurrenceFrequency: isRecurring
                ? (recurrenceFrequency?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty ?? "monthly")
                : nil
        )
        let idem = "create-job:\(UUID().uuidString)"
        return try await postJSON(
            pathComponents: ["api", "v1", "jobs"],
            body: body,
            authorized: .required,
            headers: ["Idempotency-Key": idem]
        )
    }

    /// POST `/api/v1/listings` — create a goods marketplace listing (Bearer required).
    /// Duration must be 24, 48, or 168. Condition: new|like_new|very_good|good|acceptable|for_parts.
    /// Response is the listing JSON (not wrapped). Idempotency-Key for safe retries.
    @discardableResult
    func createListing(
        categoryId: String,
        title: String,
        description: String,
        photoUrls: [String] = [],
        pickupZip: String,
        startingPriceCents: Int64,
        buyNowPriceCents: Int64? = nil,
        condition: String = "good",
        auctionDurationHours: Int = 48,
        publish: Bool = true
    ) async throws -> ListingDetail {
        let trimmedTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedTitle.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "Title is required.")
        }
        let trimmedCategory = categoryId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedCategory.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "Category is required.")
        }
        let trimmedZip = pickupZip.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedZip.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "Pickup ZIP is required.")
        }
        let body = CreateListingRequestBody(
            categoryId: trimmedCategory,
            title: trimmedTitle,
            description: description.trimmingCharacters(in: .whitespacesAndNewlines),
            photoUrls: photoUrls,
            pickupZip: trimmedZip,
            startingPriceCents: startingPriceCents,
            buyNowPriceCents: buyNowPriceCents,
            condition: condition.trimmingCharacters(in: .whitespacesAndNewlines),
            auctionDurationHours: auctionDurationHours,
            publish: publish
        )
        let idem = "create-listing:\(UUID().uuidString)"
        return try await postJSON(
            pathComponents: ["api", "v1", "listings"],
            body: body,
            authorized: .required,
            headers: ["Idempotency-Key": idem]
        )
    }

    // MARK: - Helpers
    //
    // Internal (not private) so same-module extensions such as
    // `APIClient+Commerce` can share HTTP plumbing without duplicating it.

    enum AuthMode {
        /// Never attach Bearer; public endpoint.
        case none
        /// Attach Bearer when a token exists; do not fail if missing.
        case optional
        /// Require a non-empty access token; throw `.unauthorized` otherwise.
        case required
    }

    /// JSON GET with path components + query. When `authorized` is true, attaches Bearer.
    func getJSON<T: Decodable>(
        pathComponents: [String],
        query: [URLQueryItem] = [],
        authorized: Bool = false
    ) async throws -> T {
        try await getJSON(
            pathComponents: pathComponents,
            query: query,
            authorized: authorized ? .required : .none
        )
    }

    /// JSON GET with explicit `AuthMode` (e.g. `.optional` for public routes that enrich for signed-in callers).
    func getJSON<T: Decodable>(
        pathComponents: [String],
        query: [URLQueryItem] = [],
        authorized: AuthMode
    ) async throws -> T {
        let data = try await perform(
            method: "GET",
            pathComponents: pathComponents,
            query: query,
            body: nil as EmptyBody?,
            auth: authorized
        )
        return try decodeFlexible(data)
    }

    func postJSON<Body: Encodable, T: Decodable>(
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
        return try decodeFlexible(data)
    }

    /// Decode JSON, or synthesize `{}` for empty / non-JSON 2xx success bodies.
    private func decodeFlexible<T: Decodable>(_ data: Data) throws -> T {
        let trimmed = data.trimmingASCIIWhitespace
        if trimmed.isEmpty {
            if let empty = try? decoder.decode(T.self, from: Data("{}".utf8)) {
                return empty
            }
        }
        do {
            return try decoder.decode(T.self, from: data)
        } catch {
            if let empty = try? decoder.decode(T.self, from: Data("{}".utf8)) {
                return empty
            }
            throw APIClientError.decoding("Could not decode response: \(error.localizedDescription)")
        }
    }

    func postData<Body: Encodable>(
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

    func patchData<Body: Encodable>(
        pathComponents: [String],
        body: Body,
        authorized: AuthMode,
        headers: [String: String] = [:]
    ) async throws -> Data {
        try await perform(
            method: "PATCH",
            pathComponents: pathComponents,
            query: [],
            body: body,
            auth: authorized,
            headers: headers
        )
    }

    func deleteJSON<T: Decodable>(
        pathComponents: [String],
        authorized: AuthMode,
        headers: [String: String] = [:]
    ) async throws -> T {
        let data = try await perform(
            method: "DELETE",
            pathComponents: pathComponents,
            query: [],
            body: nil as EmptyBody?,
            auth: authorized,
            headers: headers
        )
        return try decodeFlexible(data)
    }

    /// DELETE with a JSON body (e.g. `DELETE /auth/mfa/disable` requires `totp_code`).
    func deleteJSON<Body: Encodable, T: Decodable>(
        pathComponents: [String],
        body: Body,
        authorized: AuthMode,
        headers: [String: String] = [:]
    ) async throws -> T {
        let data = try await perform(
            method: "DELETE",
            pathComponents: pathComponents,
            query: [],
            body: body,
            auth: authorized,
            headers: headers
        )
        return try decodeFlexible(data)
    }

    /// DELETE that tolerates empty / 204 bodies (no JSON decode).
    func deleteEmpty(
        pathComponents: [String],
        authorized: AuthMode = .required,
        headers: [String: String] = [:]
    ) async throws {
        _ = try await perform(
            method: "DELETE",
            pathComponents: pathComponents,
            query: [],
            body: nil as EmptyBody?,
            auth: authorized,
            headers: headers
        )
    }

    func patchJSON<Body: Encodable, T: Decodable>(
        pathComponents: [String],
        body: Body,
        authorized: AuthMode,
        headers: [String: String] = [:]
    ) async throws -> T {
        let data = try await perform(
            method: "PATCH",
            pathComponents: pathComponents,
            query: [],
            body: body,
            auth: authorized,
            headers: headers
        )
        return try decodeFlexible(data)
    }

    /// PUT JSON → decode response body (notification prefs, property updates, etc.).
    func putJSON<Body: Encodable, T: Decodable>(
        pathComponents: [String],
        body: Body,
        authorized: AuthMode,
        headers: [String: String] = [:]
    ) async throws -> T {
        let data = try await perform(
            method: "PUT",
            pathComponents: pathComponents,
            query: [],
            body: body,
            auth: authorized,
            headers: headers
        )
        return try decodeFlexible(data)
    }

    /// PUT that tolerates empty / 204 bodies.
    func putEmpty<Body: Encodable>(
        pathComponents: [String],
        body: Body,
        authorized: AuthMode = .required,
        headers: [String: String] = [:]
    ) async throws {
        _ = try await perform(
            method: "PUT",
            pathComponents: pathComponents,
            query: [],
            body: body,
            auth: authorized,
            headers: headers
        )
    }

    /// POST with no response body expected (treats empty 2xx as success).
    func postEmpty<Body: Encodable>(
        pathComponents: [String],
        body: Body,
        authorized: AuthMode = .required,
        headers: [String: String] = [:]
    ) async throws {
        _ = try await postData(
            pathComponents: pathComponents,
            body: body,
            authorized: authorized,
            headers: headers
        )
    }

    /// POST `multipart/form-data` (completion photos, etc.). Does **not** set JSON Content-Type.
    /// Caller supplies fully-encoded body + boundary. Reuses auth + 401 refresh path.
    func postMultipart(
        pathComponents: [String],
        body: Data,
        boundary: String,
        authorized: AuthMode = .required,
        headers: [String: String] = [:]
    ) async throws -> Data {
        var extra = headers
        extra["Content-Type"] = "multipart/form-data; boundary=\(boundary)"
        return try await performRaw(
            method: "POST",
            pathComponents: pathComponents,
            query: [],
            rawBody: body,
            auth: authorized,
            headers: extra
        )
    }

    /// GET that returns raw bytes (HTML tax form / invoice downloads).
    func getData(
        pathComponents: [String],
        query: [URLQueryItem] = [],
        authorized: AuthMode = .required
    ) async throws -> Data {
        try await perform(
            method: "GET",
            pathComponents: pathComponents,
            query: query,
            body: nil as EmptyBody?,
            auth: authorized
        )
    }

    /// Transport-level backoff schedule (seconds) before retry attempts 1 and 2.
    private static let transportRetryDelays: [TimeInterval] = [0.4, 1.0]
    /// Maximum number of *retries* after the initial attempt (total attempts = 1 + this).
    private static let maxTransportRetries = 2

    func perform<Body: Encodable>(
        method: String,
        pathComponents: [String],
        query: [URLQueryItem],
        body: Body?,
        auth: AuthMode,
        headers: [String: String] = [:],
        didRefresh: Bool = false,
        transportAttempt: Int = 0
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
            // Transient transport failures only — never retry HTTP 4xx (except 401 refresh below).
            // GET/DELETE: full auto-retry. POST/PATCH/PUT: only when there was no response at all
            // (this catch path), so we never re-POST after a server already answered.
            if Self.shouldRetryTransport(error: error, method: method, attempt: transportAttempt) {
                let delayIndex = min(transportAttempt, Self.transportRetryDelays.count - 1)
                let delay = Self.transportRetryDelays[delayIndex]
                try await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
                return try await perform(
                    method: method,
                    pathComponents: pathComponents,
                    query: query,
                    body: body,
                    auth: auth,
                    headers: headers,
                    didRefresh: didRefresh,
                    transportAttempt: transportAttempt + 1
                )
            }
            throw APIClientError.unreachable
        }

        // Single retry on 401 for authenticated calls: single-flight refresh, then re-issue.
        // On definitive failure (refresh rejected / no refresh token / still 401 after retry),
        // post `.noMarkupSessionExpired` so AuthViewModel can sign out on the main actor.
        // APIClient never clears Keychain / UI state itself (actor boundary + scaffold safety).
        if auth != .none,
           let http = response as? HTTPURLResponse,
           http.statusCode == 401
        {
            if !didRefresh {
                let hasRefresh = (try? tokenStore.read(.refreshToken)).map { !$0.isEmpty } ?? false
                if hasRefresh {
                    do {
                        _ = try await refreshSession()
                        return try await perform(
                            method: method,
                            pathComponents: pathComponents,
                            query: query,
                            body: body,
                            auth: auth,
                            headers: headers,
                            didRefresh: true,
                            transportAttempt: 0
                        )
                    } catch {
                        // Refresh failed completely — notify AuthViewModel; surface original 401.
                        Self.postSessionExpired()
                    }
                } else {
                    // No refresh token — session cannot be recovered.
                    Self.postSessionExpired()
                }
            } else {
                // Already refreshed once for this request; still 401 → definitive.
                Self.postSessionExpired()
            }
        }

        try Self.throwIfNeeded(response: response, data: data)
        return data
    }

    /// Like `perform`, but sends a pre-encoded body without forcing JSON Content-Type.
    /// Used for multipart uploads. Auth + 401 refresh mirror `perform`.
    func performRaw(
        method: String,
        pathComponents: [String],
        query: [URLQueryItem],
        rawBody: Data?,
        auth: AuthMode,
        headers: [String: String] = [:],
        didRefresh: Bool = false,
        transportAttempt: Int = 0
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
        case .optional, .required:
            request = try authorizedRequest(url: finalURL, method: method)
            if auth == .required, request.value(forHTTPHeaderField: "Authorization") == nil {
                throw APIClientError.unauthorized
            }
        }
        request.timeoutInterval = 60

        for (key, value) in headers {
            request.setValue(value, forHTTPHeaderField: key)
        }
        if let rawBody {
            request.httpBody = rawBody
        }

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            if Self.shouldRetryTransport(error: error, method: method, attempt: transportAttempt) {
                let delayIndex = min(transportAttempt, Self.transportRetryDelays.count - 1)
                let delay = Self.transportRetryDelays[delayIndex]
                try await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
                return try await performRaw(
                    method: method,
                    pathComponents: pathComponents,
                    query: query,
                    rawBody: rawBody,
                    auth: auth,
                    headers: headers,
                    didRefresh: didRefresh,
                    transportAttempt: transportAttempt + 1
                )
            }
            throw APIClientError.unreachable
        }

        if auth != .none,
           let http = response as? HTTPURLResponse,
           http.statusCode == 401
        {
            if !didRefresh {
                let hasRefresh = (try? tokenStore.read(.refreshToken)).map { !$0.isEmpty } ?? false
                if hasRefresh {
                    do {
                        _ = try await refreshSession()
                        return try await performRaw(
                            method: method,
                            pathComponents: pathComponents,
                            query: query,
                            rawBody: rawBody,
                            auth: auth,
                            headers: headers,
                            didRefresh: true,
                            transportAttempt: 0
                        )
                    } catch {
                        Self.postSessionExpired()
                    }
                } else {
                    Self.postSessionExpired()
                }
            } else {
                Self.postSessionExpired()
            }
        }

        try Self.throwIfNeeded(response: response, data: data)
        return data
    }

    /// Whether a failed `URLSession` call should be retried with backoff.
    ///
    /// - GET/DELETE: retriable on transient URLErrors up to `maxTransportRetries`.
    /// - POST/PATCH/PUT: same, but only reachable here when no HTTP response was received.
    /// - Never retries based on HTTP status (4xx/5xx handled separately; 401 has its own path).
    private static func shouldRetryTransport(error: Error, method: String, attempt: Int) -> Bool {
        guard attempt < maxTransportRetries else { return false }

        let verb = method.uppercased()
        switch verb {
        case "GET", "DELETE", "POST", "PATCH", "PUT", "HEAD":
            break
        default:
            return false
        }

        if let urlError = error as? URLError {
            return isRetriableURLError(urlError.code)
        }
        let ns = error as NSError
        if ns.domain == NSURLErrorDomain {
            return isRetriableURLError(URLError.Code(rawValue: ns.code))
        }
        return false
    }

    private static func isRetriableURLError(_ code: URLError.Code) -> Bool {
        switch code {
        case .timedOut,
             .cannotConnectToHost,
             .networkConnectionLost,
             .dnsLookupFailed,
             .cannotFindHost,
             .notConnectedToInternet:
            return true
        default:
            return false
        }
    }

    /// Notify the main-actor auth layer that the session is dead. Does not clear tokens.
    private static func postSessionExpired() {
        NotificationCenter.default.post(name: .noMarkupSessionExpired, object: nil)
    }

    private static func throwIfNeeded(response: URLResponse, data: Data) throws {
        guard let http = response as? HTTPURLResponse else {
            throw APIClientError.unreachable
        }
        guard (200 ... 299).contains(http.statusCode) else {
            if http.statusCode == 401 {
                throw APIClientError.unauthorized
            }
            // Place-bid (and bond confirm) may return 402 with requires_bid_bond.
            if http.statusCode == 402,
               let bondCents = Self.extractBidBondAmountCents(from: data)
            {
                throw APIClientError.bidBondRequired(bondAmountCents: bondCents)
            }
            // Prefer gateway `{ "error": "..." }` message when present and human-readable.
            if let apiMessage = Self.extractAPIErrorMessage(from: data),
               let clean = Self.sanitizeErrorDetail(apiMessage),
               !clean.isEmpty
            {
                throw APIClientError.httpStatus(http.statusCode, detail: clean)
            }
            let snippet = String(data: data, encoding: .utf8) ?? ""
            let cleanSnippet = Self.sanitizeErrorDetail(snippet) ?? ""
            throw APIClientError.httpStatus(http.statusCode, detail: cleanSnippet)
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

    /// Drops empty / HTML / pure-JSON garbage so UI can fall back to friendly status copy.
    private static func sanitizeErrorDetail(_ raw: String) -> String? {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }

        // Empty JSON shells / bare null.
        let lower = trimmed.lowercased()
        if lower == "{}" || lower == "null" || lower == "[]" || lower == "\"\"" {
            return nil
        }

        // HTML / XML error pages (gateway 502 HTML, nginx, etc.).
        if trimmed.hasPrefix("<") || lower.hasPrefix("<!doctype") || lower.contains("<html") {
            return nil
        }

        // Pure numeric status echoes are not useful to users.
        if trimmed.allSatisfy(\.isNumber), trimmed.count <= 3 {
            return nil
        }

        // Cap runaway dumps; keep a short human-looking prefix when possible.
        if trimmed.count > 280 {
            let prefix = String(trimmed.prefix(200)).trimmingCharacters(in: .whitespacesAndNewlines)
            // Prefer ending on a word boundary-ish cut.
            if prefix.contains(" ") {
                return prefix + "…"
            }
            return nil
        }

        return trimmed
    }

    /// Parses Wave-4 bid-bond 402 body: `{ "requires_bid_bond": true, "bond_amount_cents": N }`.
    private static func extractBidBondAmountCents(from data: Data) -> Int64? {
        struct BidBondBody: Decodable {
            let requiresBidBond: Bool?
            let bondAmountCents: Int64?
        }
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        guard let body = try? decoder.decode(BidBondBody.self, from: data),
              body.requiresBidBond == true,
              let cents = body.bondAmountCents,
              cents > 0
        else {
            return nil
        }
        return cents
    }
}

/// Empty body placeholder for GET-style `perform` calls.
struct EmptyBody: Encodable {}

/// Encodes as `{}` for POSTs that require a JSON content-type but no fields.
struct EmptyJSONObject: Encodable {}

private extension Data {
    var trimmingASCIIWhitespace: Data {
        guard !isEmpty else { return self }
        let ws = Set<UInt8>([0x09, 0x0A, 0x0D, 0x20])
        var start = startIndex
        var end = endIndex
        while start < end, ws.contains(self[start]) { start = index(after: start) }
        while end > start, ws.contains(self[index(before: end)]) { end = index(before: end) }
        return self[start ..< end]
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

private struct ListingReportRequestBody: Encodable {
    let reason: String
    let description: String
}

struct AmountCentsBody: Encodable {
    let amountCents: Int64
}

private struct RespondToTermsRequestBody: Encodable {
    let accepted: Bool
}

private struct SendProposedTermsRequestBody: Encodable {
    let paymentType: String
    let amount: String
    let milestones: String
    let description: String
}

private struct SendMessageRequestBody: Encodable {
    let content: String
    let messageType: String
}

/// Body for `POST /api/v1/jobs` (snake_case via encoder).
private struct CreateJobRequestBody: Encodable {
    let title: String
    let description: String
    let categoryId: String?
    let auctionDurationHours: Int
    let startingBidCents: Int64
    let auctionType: String
    let locationAddress: String?
    let locationLat: Double?
    let locationLng: Double?
    let publish: Bool
    let scheduleType: String
    let photoUrls: [String]
    let propertyId: String?
    let offerAcceptedCents: Int64?
    let isRecurring: Bool
    let recurrenceFrequency: String?
}

private extension String {
    var nilIfEmpty: String? {
        let t = trimmingCharacters(in: .whitespacesAndNewlines)
        return t.isEmpty ? nil : t
    }
}

/// Body for `POST /api/v1/listings` (snake_case via encoder).
private struct CreateListingRequestBody: Encodable {
    let categoryId: String
    let title: String
    let description: String
    let photoUrls: [String]
    let pickupZip: String
    let startingPriceCents: Int64
    let buyNowPriceCents: Int64?
    let condition: String
    let auctionDurationHours: Int
    let publish: Bool
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

// MARK: - Session notifications

extension Notification.Name {
    /// Posted by `APIClient` when an authenticated request gets 401 after refresh fails
    /// (or there is no refresh token). `AuthViewModel` observes this and signs out.
    /// Raw name: `NoMarkupSessionExpired`.
    static let noMarkupSessionExpired = Notification.Name("NoMarkupSessionExpired")

    /// Posted by `AuthViewModel` after a successful login / register / MFA / SIWA.
    /// App root observes this to re-fetch feature flags for the new session.
    /// Raw name: `NoMarkupAuthDidSucceed`.
    static let noMarkupAuthDidSucceed = Notification.Name("NoMarkupAuthDidSucceed")

    /// Posted after a successful `PUT /me/dob` so the global age gate can dismiss.
    /// Raw name: `noMarkupAgeVerified`.
    static let noMarkupAgeVerified = Notification.Name("noMarkupAgeVerified")
}

enum APIClientError: Error, LocalizedError {
    case unreachable
    case unauthorized
    case httpStatus(Int, detail: String = "")
    case decoding(String)
    /// Place-bid returned 402 with `requires_bid_bond: true` and a bond amount.
    case bidBondRequired(bondAmountCents: Int64)

    var isUnauthorized: Bool {
        if case .unauthorized = self { return true }
        return false
    }

    /// 403 Forbidden — e.g. job bid ladder visible only to the job owner.
    var isForbidden: Bool {
        if case .httpStatus(let code, _) = self, code == 403 { return true }
        return false
    }

    /// 409 Conflict — e.g. OAuth unlink would leave no sign-in method, offer already actioned.
    var isConflict: Bool {
        if case .httpStatus(let code, _) = self, code == 409 { return true }
        return false
    }

    /// First-time listing bid needs a Stripe SetupIntent bond (Wave 4).
    var isBidBondRequired: Bool {
        if case .bidBondRequired = self { return true }
        return false
    }

    /// Bond amount from a 402 place-bid response, if present.
    var bidBondAmountCents: Int64? {
        if case .bidBondRequired(let cents) = self { return cents }
        return nil
    }

    var errorDescription: String? {
        switch self {
        case .unreachable:
            return "Could not reach the NoMarkup API. Check your connection and try again."
        case .unauthorized:
            return "Sign in required. Your session is missing or expired — please sign in again."
        case .httpStatus(let code, let detail):
            let cleaned = detail.trimmingCharacters(in: .whitespacesAndNewlines)
            // Prefer gateway detail when present and not empty garbage.
            if !cleaned.isEmpty, Self.isUsableDetail(cleaned) {
                return cleaned
            }
            return Self.friendlyMessage(for: code)
        case .decoding(let message):
            return message
        case .bidBondRequired(let cents):
            return "A bid bond of \(MoneyFormat.usd(cents: cents)) is required before your first bid on this listing."
        }
    }

    /// User-facing copy for common HTTP statuses when the gateway sent no usable detail.
    /// 402 here is non-bond payment required (bond 402s use `.bidBondRequired`).
    private static func friendlyMessage(for statusCode: Int) -> String {
        switch statusCode {
        case 400:
            return "That request wasn’t valid. Check your input and try again."
        case 402:
            return "Payment required"
        case 403:
            return "You don’t have permission for this action."
        case 404:
            return "We couldn’t find that resource."
        case 409:
            return "Conflict — refresh and try again"
        case 422:
            return "Request couldn’t be completed"
        case 429:
            return "Too many requests — wait a moment"
        case 500:
            return "Something went wrong on our side. Try again shortly."
        case 503:
            return "Service temporarily unavailable"
        default:
            return "API error (\(statusCode))."
        }
    }

    private static func isUsableDetail(_ detail: String) -> Bool {
        let lower = detail.lowercased()
        if lower == "{}" || lower == "null" || lower == "[]" { return false }
        if detail.hasPrefix("<") || lower.contains("<html") { return false }
        return true
    }
}
