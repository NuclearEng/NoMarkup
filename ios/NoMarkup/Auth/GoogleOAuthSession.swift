import AuthenticationServices
import CryptoKit
import Foundation
import UIKit

/// Google Sign-In via **ASWebAuthenticationSession** + **PKCE** (no Google SDK).
///
/// Flow:
/// 1. Generate `code_verifier` / S256 `code_challenge` + `state`
/// 2. Open Google authorize URL in the system auth session
/// 3. On `redirect_uri` callback, exchange `code` + verifier at Google's token endpoint
/// 4. Return the OIDC `id_token` for gateway `POST /api/v1/auth/google/native`
///
/// Requires a Google Cloud **iOS** OAuth client ID (`AppConfig.googleIosClientID`) and
/// its reverse-client-id URL scheme registered in Info.plist `CFBundleURLTypes`.
@MainActor
final class GoogleOAuthSession: NSObject, ASWebAuthenticationPresentationContextProviding {
    enum SessionError: LocalizedError {
        case notConfigured
        case canceled
        case invalidCallback
        case stateMismatch
        case missingAuthorizationCode
        case tokenExchangeFailed(String)
        case missingIDToken

        var errorDescription: String? {
            switch self {
            case .notConfigured:
                return "Google Sign-In is not configured. Set GoogleIosClientID (Info.plist / NOMARKUP_GOOGLE_IOS_CLIENT_ID) and register the reverse-client-id URL scheme."
            case .canceled:
                return "Google Sign-In was canceled."
            case .invalidCallback:
                return "Google Sign-In returned an invalid callback."
            case .stateMismatch:
                return "Google Sign-In state mismatch. Try again."
            case .missingAuthorizationCode:
                return "Google Sign-In did not return an authorization code."
            case .tokenExchangeFailed(let detail):
                return "Google token exchange failed: \(detail)"
            case .missingIDToken:
                return "Google did not return an identity token."
            }
        }
    }

    private var authSession: ASWebAuthenticationSession?

    /// Runs the full authorize → code exchange path and returns a Google OIDC `id_token`.
    func signIn() async throws -> String {
        guard let clientID = AppConfig.googleIosClientID,
              let redirectURI = AppConfig.googleOAuthRedirectURI,
              let callbackScheme = AppConfig.googleOAuthCallbackScheme
        else {
            throw SessionError.notConfigured
        }

        let codeVerifier = Self.randomURLSafeString(byteCount: 32)
        let codeChallenge = Self.sha256Base64URL(codeVerifier)
        let state = Self.randomURLSafeString(byteCount: 16)

        var components = URLComponents(string: "https://accounts.google.com/o/oauth2/v2/auth")!
        components.queryItems = [
            URLQueryItem(name: "client_id", value: clientID),
            URLQueryItem(name: "redirect_uri", value: redirectURI),
            URLQueryItem(name: "response_type", value: "code"),
            URLQueryItem(name: "scope", value: "openid email profile"),
            URLQueryItem(name: "code_challenge", value: codeChallenge),
            URLQueryItem(name: "code_challenge_method", value: "S256"),
            URLQueryItem(name: "state", value: state),
            // Force account picker so multi-account users can switch.
            URLQueryItem(name: "prompt", value: "select_account"),
        ]
        guard let authURL = components.url else {
            throw SessionError.notConfigured
        }

        let callbackURL: URL = try await withCheckedThrowingContinuation { continuation in
            let session = ASWebAuthenticationSession(
                url: authURL,
                callbackURLScheme: callbackScheme
            ) { url, error in
                if let error {
                    let ns = error as NSError
                    if ns.domain == ASWebAuthenticationSessionError.errorDomain,
                       ns.code == ASWebAuthenticationSessionError.canceledLogin.rawValue {
                        continuation.resume(throwing: SessionError.canceled)
                        return
                    }
                    continuation.resume(throwing: error)
                    return
                }
                guard let url else {
                    continuation.resume(throwing: SessionError.invalidCallback)
                    return
                }
                continuation.resume(returning: url)
            }
            session.presentationContextProvider = self
            // Shared Safari cookies improve Google login UX; session is still app-bound.
            session.prefersEphemeralWebBrowserSession = false
            self.authSession = session
            if !session.start() {
                continuation.resume(throwing: SessionError.notConfigured)
            }
        }

        defer { authSession = nil }

        guard let items = URLComponents(url: callbackURL, resolvingAgainstBaseURL: false)?.queryItems else {
            throw SessionError.invalidCallback
        }
        var query: [String: String] = [:]
        for item in items {
            guard let value = item.value else { continue }
            // First wins if Google repeats a key.
            if query[item.name] == nil {
                query[item.name] = value
            }
        }

        if let error = query["error"], !error.isEmpty {
            if error == "access_denied" {
                throw SessionError.canceled
            }
            throw SessionError.tokenExchangeFailed(error)
        }

        guard query["state"] == state else {
            throw SessionError.stateMismatch
        }
        guard let code = query["code"], !code.isEmpty else {
            throw SessionError.missingAuthorizationCode
        }

        return try await exchangeCodeForIDToken(
            code: code,
            codeVerifier: codeVerifier,
            clientID: clientID,
            redirectURI: redirectURI
        )
    }

    @MainActor
    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        // Prefer the key window on the active scene; fall back to first window.
        // @MainActor: UIWindowScene.windows / isKeyWindow are main-actor isolated.
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        for scene in scenes {
            if let key = scene.windows.first(where: { $0.isKeyWindow }) {
                return key
            }
        }
        for scene in scenes {
            if let any = scene.windows.first {
                return any
            }
        }
        return ASPresentationAnchor()
    }

    // MARK: - Token exchange (public client + PKCE, no client secret)

    private func exchangeCodeForIDToken(
        code: String,
        codeVerifier: String,
        clientID: String,
        redirectURI: String
    ) async throws -> String {
        var request = URLRequest(url: URL(string: "https://oauth2.googleapis.com/token")!)
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.timeoutInterval = 20

        var body = URLComponents()
        body.queryItems = [
            URLQueryItem(name: "grant_type", value: "authorization_code"),
            URLQueryItem(name: "code", value: code),
            URLQueryItem(name: "redirect_uri", value: redirectURI),
            URLQueryItem(name: "client_id", value: clientID),
            URLQueryItem(name: "code_verifier", value: codeVerifier),
        ]
        request.httpBody = body.percentEncodedQuery?.data(using: .utf8)

        let (data, response) = try await URLSession.shared.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? -1
        guard (200 ... 299).contains(status) else {
            let snippet = String(data: data, encoding: .utf8)?
                .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            let detail = snippet.isEmpty ? "HTTP \(status)" : String(snippet.prefix(200))
            throw SessionError.tokenExchangeFailed(detail)
        }

        struct TokenResponse: Decodable {
            let idToken: String?
            enum CodingKeys: String, CodingKey {
                case idToken = "id_token"
            }
        }
        let decoded = try JSONDecoder().decode(TokenResponse.self, from: data)
        guard let idToken = decoded.idToken, !idToken.isEmpty else {
            throw SessionError.missingIDToken
        }
        return idToken
    }

    // MARK: - PKCE helpers

    private static func randomURLSafeString(byteCount: Int) -> String {
        var bytes = [UInt8](repeating: 0, count: byteCount)
        let status = SecRandomCopyBytes(kSecRandomDefault, byteCount, &bytes)
        precondition(status == errSecSuccess, "SecRandomCopyBytes failed")
        return Data(bytes).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    private static func sha256Base64URL(_ input: String) -> String {
        let digest = SHA256.hash(data: Data(input.utf8))
        return Data(digest).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}
