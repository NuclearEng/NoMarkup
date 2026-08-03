import AuthenticationServices
import Foundation
import UIKit

/// Facebook Login via **ASWebAuthenticationSession** (no Facebook SDK).
///
/// Flow:
/// 1. Generate CSRF `state`
/// 2. Open Facebook authorize URL in the system auth session
/// 3. On custom-scheme callback, extract `code`
/// 4. Caller posts `authorization_code` + `redirect_uri` to gateway
///    `POST /api/v1/auth/facebook/native` (server holds `FACEBOOK_CLIENT_SECRET`)
///
/// Requires Meta App ID (`AppConfig.facebookAppID`) and Valid OAuth Redirect URI
/// `nomarkup://oauth2redirect/facebook` registered on the Facebook app.
///
/// Note: no client-side PKCE — Facebook code exchange requires the app secret
/// on the server. Client secret never ships in the iOS binary.
@MainActor
final class FacebookOAuthSession: NSObject, ASWebAuthenticationPresentationContextProviding {
    enum SessionError: LocalizedError {
        case notConfigured
        case canceled
        case invalidCallback
        case stateMismatch
        case missingAuthorizationCode
        case providerError(String)

        var errorDescription: String? {
            switch self {
            case .notConfigured:
                return "Facebook Sign-In is not configured. Set FacebookAppID (Info.plist / NOMARKUP_FACEBOOK_APP_ID) and register nomarkup://oauth2redirect/facebook in the Meta app settings."
            case .canceled:
                return "Facebook Sign-In was canceled."
            case .invalidCallback:
                return "Facebook Sign-In returned an invalid callback."
            case .stateMismatch:
                return "Facebook Sign-In state mismatch. Try again."
            case .missingAuthorizationCode:
                return "Facebook Sign-In did not return an authorization code."
            case .providerError(let detail):
                return "Facebook Sign-In failed: \(detail)"
            }
        }
    }

    /// Result of a successful authorize step — exchange on the gateway.
    struct AuthorizationResult: Sendable {
        let authorizationCode: String
        let redirectURI: String
    }

    private var authSession: ASWebAuthenticationSession?

    /// Runs authorize and returns the authorization code for gateway exchange.
    func signIn() async throws -> AuthorizationResult {
        guard let appID = AppConfig.facebookAppID,
              let redirectURI = AppConfig.facebookOAuthRedirectURI,
              let callbackScheme = AppConfig.facebookOAuthCallbackScheme
        else {
            throw SessionError.notConfigured
        }

        let state = Self.randomURLSafeString(byteCount: 16)

        var components = URLComponents(string: "https://www.facebook.com/v18.0/dialog/oauth")!
        components.queryItems = [
            URLQueryItem(name: "client_id", value: appID),
            URLQueryItem(name: "redirect_uri", value: redirectURI),
            URLQueryItem(name: "response_type", value: "code"),
            URLQueryItem(name: "scope", value: "email,public_profile"),
            URLQueryItem(name: "state", value: state),
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
            if query[item.name] == nil {
                query[item.name] = value
            }
        }

        if let error = query["error"], !error.isEmpty {
            if error == "access_denied" {
                throw SessionError.canceled
            }
            let desc = query["error_description"] ?? error
            throw SessionError.providerError(desc)
        }

        guard query["state"] == state else {
            throw SessionError.stateMismatch
        }
        guard let code = query["code"], !code.isEmpty else {
            throw SessionError.missingAuthorizationCode
        }

        return AuthorizationResult(authorizationCode: code, redirectURI: redirectURI)
    }

    @MainActor
    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
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

    // MARK: - Helpers

    private static func randomURLSafeString(byteCount: Int) -> String {
        var bytes = [UInt8](repeating: 0, count: byteCount)
        let status = SecRandomCopyBytes(kSecRandomDefault, byteCount, &bytes)
        precondition(status == errSecSuccess, "SecRandomCopyBytes failed")
        return Data(bytes).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}
