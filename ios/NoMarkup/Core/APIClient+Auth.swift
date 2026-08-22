import Foundation

// MARK: - Auth DTOs

/// Outcome of email/password login when MFA may be required.
enum AuthLoginResult: Sendable {
    /// Full session established; tokens already persisted to Keychain.
    case signedIn(AuthTokenPair)
    /// Gateway returned `mfa_required` — caller must collect TOTP and call `verifyMFA`.
    case mfaRequired(challengeToken: String, userID: String?)
}

/// Flexible decode of gateway `authResponse` (login / register / verify-MFA).
struct AuthGatewayResponse: Decodable, Sendable {
    let userID: String?
    let accessToken: String?
    let accessTokenExpiresAt: String?
    let refreshToken: String?
    let mfaRequired: Bool
    let mfaChallengeToken: String?

    enum CodingKeys: String, CodingKey {
        case userID = "user_id"
        case accessToken = "access_token"
        case accessTokenExpiresAt = "access_token_expires_at"
        case refreshToken = "refresh_token"
        case mfaRequired = "mfa_required"
        case mfaChallengeToken = "mfa_challenge_token"
        // Camel fallbacks
        case userIdCamel = "userId"
        case accessTokenCamel = "accessToken"
        case refreshTokenCamel = "refreshToken"
        case mfaRequiredCamel = "mfaRequired"
        case mfaChallengeTokenCamel = "mfaChallengeToken"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        userID = try c.decodeIfPresent(String.self, forKey: .userID)
            ?? c.decodeIfPresent(String.self, forKey: .userIdCamel)
        accessToken = try c.decodeIfPresent(String.self, forKey: .accessToken)
            ?? c.decodeIfPresent(String.self, forKey: .accessTokenCamel)
        accessTokenExpiresAt = try c.decodeIfPresent(String.self, forKey: .accessTokenExpiresAt)
        refreshToken = try c.decodeIfPresent(String.self, forKey: .refreshToken)
            ?? c.decodeIfPresent(String.self, forKey: .refreshTokenCamel)
        mfaRequired = try c.decodeIfPresent(Bool.self, forKey: .mfaRequired)
            ?? c.decodeIfPresent(Bool.self, forKey: .mfaRequiredCamel)
            ?? false
        mfaChallengeToken = try c.decodeIfPresent(String.self, forKey: .mfaChallengeToken)
            ?? c.decodeIfPresent(String.self, forKey: .mfaChallengeTokenCamel)
    }
}

// MARK: - Request bodies (explicit snake_case — no convertToSnakeCase dependency)

private struct RegisterRequestBody: Encodable {
    let email: String
    let password: String
    let displayName: String
    let roles: [String]

    enum CodingKeys: String, CodingKey {
        case email
        case password
        case displayName = "display_name"
        case roles
    }
}

private struct PasswordResetRequestBody: Encodable {
    let email: String
}

private struct ResetPasswordRequestBody: Encodable {
    let token: String
    let newPassword: String

    enum CodingKeys: String, CodingKey {
        case token
        case newPassword = "new_password"
    }
}

private struct VerifyMFARequestBody: Encodable {
    let mfaChallengeToken: String
    let totpCode: String

    enum CodingKeys: String, CodingKey {
        case mfaChallengeToken = "mfa_challenge_token"
        case totpCode = "totp_code"
    }
}

private struct EmailPasswordBody: Encodable {
    let email: String
    let password: String
}

private struct VerifyEmailTokenBody: Encodable {
    let token: String
}

private struct PhoneBody: Encodable {
    let phone: String
}

private struct OTPCodeBody: Encodable {
    let otpCode: String

    enum CodingKeys: String, CodingKey {
        case otpCode = "otp_code"
    }
}

/// `assert/options` body — optional email hint narrows `allowCredentials` server-side.
/// Plain-encoded (nil omitted → `{}`); never snake_cased.
private struct PasskeyAssertOptionsRequestBody: Encodable {
    let email: String?
}

// MARK: - APIClient auth extension

extension APIClient {
    /// POST `/api/v1/auth/login` with full MFA handling.
    ///
    /// Prefer this over the scaffold `login(email:password:)` which requires a non-empty
    /// `access_token` and fails when the gateway returns `mfa_required`.
    func loginWithMFAHandling(email: String, password: String) async throws -> AuthLoginResult {
        let data = try await postAuthJSON(
            path: "api/v1/auth/login",
            body: EmailPasswordBody(email: email, password: password)
        )
        let response = try decodeAuthResponse(data)

        if response.mfaRequired {
            let challenge = response.mfaChallengeToken?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            guard !challenge.isEmpty else {
                throw APIClientError.decoding("MFA required but challenge token was empty")
            }
            // No session yet — do not write tokens.
            return .mfaRequired(challengeToken: challenge, userID: response.userID)
        }

        let pair = try persistTokens(from: response)
        return .signedIn(pair)
    }

    /// POST `/api/v1/auth/register` — body: email, password, display_name, roles.
    /// On success (201) persists tokens and returns the pair.
    @discardableResult
    func register(
        email: String,
        password: String,
        displayName: String,
        roles: [String] = ["customer"]
    ) async throws -> AuthTokenPair {
        let body = RegisterRequestBody(
            email: email,
            password: password,
            displayName: displayName,
            roles: roles.isEmpty ? ["customer"] : roles
        )
        let data = try await postAuthJSON(path: "api/v1/auth/register", body: body)
        let response = try decodeAuthResponse(data)
        return try persistTokens(from: response)
    }

    /// POST `/api/v1/auth/request-password-reset` — body: `{ "email" }`.
    /// Gateway always returns 200 to avoid email enumeration.
    func requestPasswordReset(email: String) async throws {
        _ = try await postAuthJSON(
            path: "api/v1/auth/request-password-reset",
            body: PasswordResetRequestBody(email: email)
        )
    }

    /// POST `/api/v1/auth/reset-password` — body: `{ "token", "new_password" }`.
    func resetPassword(token: String, newPassword: String) async throws {
        _ = try await postAuthJSON(
            path: "api/v1/auth/reset-password",
            body: ResetPasswordRequestBody(token: token, newPassword: newPassword)
        )
    }

    /// POST `/api/v1/auth/mfa/verify` — body: `{ "mfa_challenge_token", "totp_code" }`.
    /// On success persists access (and refresh if present) tokens.
    @discardableResult
    func verifyMFA(challengeToken: String, totpCode: String) async throws -> AuthTokenPair {
        let body = VerifyMFARequestBody(
            mfaChallengeToken: challengeToken,
            totpCode: totpCode
        )
        let data = try await postAuthJSON(path: "api/v1/auth/mfa/verify", body: body)
        let response = try decodeAuthResponse(data)
        return try persistTokens(from: response)
    }

    /// POST `/api/v1/auth/resend-verification` — body: `{ "email" }`.
    /// Always returns success shape (anti-enumeration); no auth required.
    func resendEmailVerification(email: String) async throws {
        let trimmed = email.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "Email is required.")
        }
        _ = try await postAuthJSON(
            path: "api/v1/auth/resend-verification",
            body: PasswordResetRequestBody(email: trimmed)
        )
    }

    /// POST `/api/v1/auth/verify-email` — body: `{ "token" }` from email link.
    func verifyEmail(token: String) async throws {
        let trimmed = token.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "Verification token is required.")
        }
        _ = try await postAuthJSON(
            path: "api/v1/auth/verify-email",
            body: VerifyEmailTokenBody(token: trimmed)
        )
    }

    /// POST `/api/v1/auth/send-phone-otp` — auth required. Body: `{ "phone" }`.
    func sendPhoneOTP(phone: String) async throws {
        let trimmed = phone.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "Phone number is required.")
        }
        try await postEmpty(
            pathComponents: ["api", "v1", "auth", "send-phone-otp"],
            body: PhoneBody(phone: trimmed),
            authorized: .required
        )
    }

    /// POST `/api/v1/auth/verify-phone` — auth required. Body: `{ "otp_code" }`.
    func verifyPhone(otpCode: String) async throws {
        let trimmed = otpCode.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "OTP code is required.")
        }
        try await postEmpty(
            pathComponents: ["api", "v1", "auth", "verify-phone"],
            body: OTPCodeBody(otpCode: trimmed),
            authorized: .required
        )
    }

    // MARK: - Passkeys (WebAuthn) — gateway endpoints under /auth/passkeys/*

    /// POST `/api/v1/auth/passkeys/assert/options` — public assertion options.
    /// Response: `{ "publicKey": <PublicKeyCredentialRequestOptions> }`.
    /// - Parameter email: optional hint so the server can narrow `allowCredentials`.
    func fetchPasskeyAssertionOptions(email: String? = nil) async throws -> PasskeyAssertionOptions {
        let trimmed = email?.trimmingCharacters(in: .whitespacesAndNewlines)
        let data = try await postPasskeyJSON(
            pathComponents: ["api", "v1", "auth", "passkeys", "assert", "options"],
            body: PasskeyAssertOptionsRequestBody(email: (trimmed?.isEmpty == false) ? trimmed : nil),
            requiresAuth: false
        )
        do {
            return try JSONDecoder().decode(PasskeyAssertionOptionsEnvelope.self, from: data).publicKey
        } catch {
            throw APIClientError.decoding("Unexpected passkey options response")
        }
    }

    /// POST `/api/v1/auth/passkeys/assert/verify` — assertion credential → session tokens
    /// (same response shape + persistence path as password login).
    @discardableResult
    func verifyPasskeyAssertion(_ credential: PasskeyAssertionCredential) async throws -> AuthTokenPair {
        let data = try await postPasskeyJSON(
            pathComponents: ["api", "v1", "auth", "passkeys", "assert", "verify"],
            body: credential,
            requiresAuth: false
        )
        let response = try decodeAuthResponse(data)
        return try persistTokens(from: response)
    }

    /// POST `/api/v1/auth/passkeys/register/options` — authed; creation options for enrollment.
    /// Response: `{ "publicKey": <PublicKeyCredentialCreationOptions> }`.
    func fetchPasskeyRegistrationOptions() async throws -> PasskeyRegistrationOptions {
        let data = try await postPasskeyJSON(
            pathComponents: ["api", "v1", "auth", "passkeys", "register", "options"],
            body: EmptyJSONObject(),
            requiresAuth: true
        )
        do {
            return try JSONDecoder().decode(PasskeyRegistrationOptionsEnvelope.self, from: data).publicKey
        } catch {
            throw APIClientError.decoding("Unexpected passkey registration options response")
        }
    }

    /// POST `/api/v1/auth/passkeys/register/verify` — authed; attestation credential → 204.
    func registerPasskeyCredential(_ credential: PasskeyRegistrationCredential) async throws {
        _ = try await postPasskeyJSON(
            pathComponents: ["api", "v1", "auth", "passkeys", "register", "verify"],
            body: credential,
            requiresAuth: true
        )
    }

    // MARK: - Private helpers (file-local; APIClient internals are private to APIClient.swift)

    private func postAuthJSON<Body: Encodable>(path: String, body: Body) async throws -> Data {
        let url = AppConfig.apiBaseURL.appending(path: path)
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.timeoutInterval = 30
        request.httpBody = try JSONEncoder().encode(body)
        ClientActionLog.stamp(&request)

        let started = Date()
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await URLSession.shared.data(for: request)
            ClientActionLog.shared.record(request: request, response: response, error: nil, started: started)
        } catch {
            ClientActionLog.shared.record(request: request, response: nil, error: error, started: started)
            throw APIClientError.unreachable
        }
        try AuthHTTP.throwIfNeeded(response: response, data: data)
        return data
    }

    /// POST for passkey endpoints. Uses a **plain** `JSONEncoder` — WebAuthn credential
    /// JSON keys are camelCase per spec and must not be snake_cased by the shared
    /// `perform` encoder. Authed calls attach Bearer and retry once after a
    /// single-flight refresh on 401 (mirrors `perform`).
    private func postPasskeyJSON<Body: Encodable>(
        pathComponents: [String],
        body: Body,
        requiresAuth: Bool,
        didRefresh: Bool = false
    ) async throws -> Data {
        var url = AppConfig.apiBaseURL
        for component in pathComponents {
            url = url.appending(path: component)
        }

        var request: URLRequest
        if requiresAuth {
            request = try authorizedRequest(url: url, method: "POST")
            guard request.value(forHTTPHeaderField: "Authorization") != nil else {
                throw APIClientError.unauthorized
            }
        } else {
            request = URLRequest(url: url)
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Accept")
        }
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.timeoutInterval = 30
        request.httpBody = try JSONEncoder().encode(body)
        ClientActionLog.stamp(&request)

        let started = Date()
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await URLSession.shared.data(for: request)
            ClientActionLog.shared.record(request: request, response: response, error: nil, started: started)
        } catch {
            ClientActionLog.shared.record(request: request, response: nil, error: error, started: started)
            throw APIClientError.unreachable
        }

        if requiresAuth, !didRefresh,
           let http = response as? HTTPURLResponse, http.statusCode == 401
        {
            do {
                _ = try await refreshSession()
            } catch {
                throw APIClientError.unauthorized
            }
            return try await postPasskeyJSON(
                pathComponents: pathComponents,
                body: body,
                requiresAuth: true,
                didRefresh: true
            )
        }

        try AuthHTTP.throwIfNeeded(response: response, data: data)
        return data
    }

    private func decodeAuthResponse(_ data: Data) throws -> AuthGatewayResponse {
        do {
            return try JSONDecoder().decode(AuthGatewayResponse.self, from: data)
        } catch {
            throw APIClientError.decoding("Unexpected auth response shape")
        }
    }

    private func persistTokens(from response: AuthGatewayResponse) throws -> AuthTokenPair {
        let access = response.accessToken?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !access.isEmpty else {
            throw APIClientError.decoding("Auth response missing access_token")
        }
        let store = tokenStoreForAuth
        try store.save(access, for: .accessToken)
        if let refresh = response.refreshToken, !refresh.isEmpty {
            try store.save(refresh, for: .refreshToken)
        }
        return AuthTokenPair(accessToken: access, refreshToken: response.refreshToken)
    }
}

// MARK: - HTTP error mapping (mirrors APIClient.throwIfNeeded without accessing private API)

private enum AuthHTTP {
    static func throwIfNeeded(response: URLResponse, data: Data) throws {
        guard let http = response as? HTTPURLResponse else {
            throw APIClientError.unreachable
        }
        guard (200 ... 299).contains(http.statusCode) else {
            if http.statusCode == 401 {
                throw APIClientError.unauthorized
            }
            if let message = extractAPIErrorMessage(from: data), !message.isEmpty {
                throw APIClientError.httpStatus(http.statusCode, detail: message)
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
