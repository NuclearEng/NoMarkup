import AuthenticationServices
import Foundation
import UIKit

/// Passkey (WebAuthn) client scaffolding (IOS-SEC.2 / SEC.3).
///
/// **Status:** structural foundation only.
/// - No gateway WebAuthn endpoints are live yet (grep: zero `passkey`/`webauthn` server code).
/// - Associated Domains `webcredentials:` is owned by a separate agent; without it ASAuthorization
///   platform credentials cannot complete against `no-markup.com`.
///
/// When server endpoints ship at:
/// - `POST /api/v1/auth/passkey/options`  (assertion / registration options)
/// - `POST /api/v1/auth/passkey/verify`   (credential response → session tokens)
/// flip `isServerReady` (or a feature flag) and the real `ASAuthorizationController` path runs.
@MainActor
final class PasskeyAuth: NSObject, ObservableObject {
    /// Client kill-switch until AASA + gateway WebAuthn exist. Prefer server flag later.
    static var isServerReady: Bool {
        // Emergency / dogfood override for local experiments only.
        if ProcessInfo.processInfo.environment["NOMARKUP_PASSKEYS"] == "1" {
            return true
        }
        return false
    }

    @Published var isBusy = false
    @Published var statusMessage: String?
    @Published var errorMessage: String?
    /// Set when assertion + verify succeed so LoginView can flip `AuthViewModel`.
    @Published private(set) var didCompleteSignIn = false

    private var authorizationContinuation: CheckedContinuation<ASAuthorization, Error>?
    private let api: APIClient

    init(api: APIClient = .shared) {
        self.api = api
    }

    func consumeSignInFlag() {
        didCompleteSignIn = false
    }

    /// Entry from LoginView. Shows honest "Coming soon" until server + associated domains ship.
    func signInWithPasskey() async {
        statusMessage = nil
        errorMessage = nil
        didCompleteSignIn = false

        guard Self.isServerReady else {
            statusMessage =
                "Passkey sign-in is coming soon. Server WebAuthn and Associated Domains are not live yet — use email, Sign in with Apple, or Google."
            return
        }

        isBusy = true
        defer { isBusy = false }

        do {
            let options = try await api.fetchPasskeyAssertionOptions()
            let assertion = try await performAssertion(options: options)
            // Persists access/refresh tokens to Keychain (same path as password login).
            _ = try await api.verifyPasskeyAssertion(assertion)
            statusMessage = "Signed in with passkey."
            didCompleteSignIn = true
        } catch let error as PasskeyAuthError {
            errorMessage = error.localizedDescription
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    // MARK: - ASAuthorization (real controller path)

    private func performAssertion(options: PasskeyAssertionOptions) async throws -> PasskeyAssertionResult {
        let challenge = try Self.decodeBase64URL(options.challenge)
        let rpID = options.rpId

        let provider = ASAuthorizationPlatformPublicKeyCredentialProvider(relyingPartyIdentifier: rpID)
        let request = provider.createCredentialAssertionRequest(challenge: challenge)

        if let allow = options.allowCredentials, !allow.isEmpty {
            request.allowedCredentials = allow.compactMap { cred in
                guard let idData = try? Self.decodeBase64URL(cred.id) else { return nil }
                return ASAuthorizationPlatformPublicKeyCredentialDescriptor(credentialID: idData)
            }
        }

        let controller = ASAuthorizationController(authorizationRequests: [request])
        controller.delegate = self
        controller.presentationContextProvider = self

        let authorization: ASAuthorization = try await withCheckedThrowingContinuation { continuation in
            self.authorizationContinuation = continuation
            controller.performRequests()
        }

        guard let credential = authorization.credential as? ASAuthorizationPlatformPublicKeyCredentialAssertion else {
            throw PasskeyAuthError.unexpectedCredential
        }

        return PasskeyAssertionResult(
            credentialID: credential.credentialID.base64URLEncodedString(),
            clientDataJSON: credential.rawClientDataJSON.base64URLEncodedString(),
            authenticatorData: credential.rawAuthenticatorData.base64URLEncodedString(),
            signature: credential.signature.base64URLEncodedString(),
            userHandle: credential.userID.map { $0.base64URLEncodedString() }
        )
    }

    private static func decodeBase64URL(_ string: String) throws -> Data {
        var s = string.replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        let pad = 4 - s.count % 4
        if pad < 4 {
            s.append(String(repeating: "=", count: pad))
        }
        guard let data = Data(base64Encoded: s) else {
            throw PasskeyAuthError.invalidChallenge
        }
        return data
    }
}

// MARK: - ASAuthorizationControllerDelegate

extension PasskeyAuth: ASAuthorizationControllerDelegate {
    nonisolated func authorizationController(
        controller: ASAuthorizationController,
        didCompleteWithAuthorization authorization: ASAuthorization
    ) {
        Task { @MainActor in
            authorizationContinuation?.resume(returning: authorization)
            authorizationContinuation = nil
        }
    }

    nonisolated func authorizationController(
        controller: ASAuthorizationController,
        didCompleteWithError error: Error
    ) {
        Task { @MainActor in
            authorizationContinuation?.resume(throwing: error)
            authorizationContinuation = nil
        }
    }
}

// MARK: - Presentation

extension PasskeyAuth: ASAuthorizationControllerPresentationContextProviding {
    nonisolated func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        MainActor.assumeIsolated {
            let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            if let key = scenes.flatMap(\.windows).first(where: \.isKeyWindow) {
                return key
            }
            return scenes.flatMap(\.windows).first ?? ASPresentationAnchor()
        }
    }
}

// MARK: - DTOs

struct PasskeyAssertionOptions: Decodable, Sendable {
    let challenge: String
    let rpId: String
    let allowCredentials: [PasskeyAllowedCredential]?
    let timeout: Int?

    enum CodingKeys: String, CodingKey {
        case challenge
        case rpId
        case rpID = "rp_id"
        case allowCredentials
        case allow_credentials
        case timeout
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        challenge = try c.decode(String.self, forKey: .challenge)
        rpId = try c.decodeIfPresent(String.self, forKey: .rpId)
            ?? c.decodeIfPresent(String.self, forKey: .rpID)
            ?? "no-markup.com"
        allowCredentials = try c.decodeIfPresent([PasskeyAllowedCredential].self, forKey: .allowCredentials)
            ?? c.decodeIfPresent([PasskeyAllowedCredential].self, forKey: .allow_credentials)
        timeout = try c.decodeIfPresent(Int.self, forKey: .timeout)
    }
}

struct PasskeyAllowedCredential: Decodable, Sendable {
    let id: String
    let type: String?
}

struct PasskeyAssertionResult: Encodable, Sendable {
    let credentialID: String
    let clientDataJSON: String
    let authenticatorData: String
    let signature: String
    let userHandle: String?

    enum CodingKeys: String, CodingKey {
        case credentialID = "credential_id"
        case clientDataJSON = "client_data_json"
        case authenticatorData = "authenticator_data"
        case signature
        case userHandle = "user_handle"
    }
}

enum PasskeyAuthError: Error, LocalizedError {
    case invalidChallenge
    case unexpectedCredential
    case notConfigured

    var errorDescription: String? {
        switch self {
        case .invalidChallenge:
            return "Passkey challenge from the server was invalid."
        case .unexpectedCredential:
            return "Unexpected credential type from Apple authorization."
        case .notConfigured:
            return "Passkeys are not configured on this build."
        }
    }
}

private extension Data {
    func base64URLEncodedString() -> String {
        base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}
