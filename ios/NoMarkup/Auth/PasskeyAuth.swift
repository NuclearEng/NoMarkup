import AuthenticationServices
import Foundation
import UIKit

/// Passkey (WebAuthn) client — sign-in assertion + enrollment (IOS-SEC.2 / SEC.3).
///
/// Gateway endpoints (all JSON, WebAuthn-spec shapes, camelCase keys):
/// - `POST /api/v1/auth/passkeys/assert/options`   (public; optional `{ "email" }`)
/// - `POST /api/v1/auth/passkeys/assert/verify`    (public; assertion credential → session tokens)
/// - `POST /api/v1/auth/passkeys/register/options` (authed; creation options)
/// - `POST /api/v1/auth/passkeys/register/verify`  (authed; attestation credential → 204)
///
/// Availability is server-driven: public flag map key `"passkeys"`
/// (`GET /api/v1/flags` via `FeatureFlags`; default false when absent). UI hides
/// passkey entry points entirely while the flag is off (IOS-SEC.3 — no dead-ends).
@MainActor
final class PasskeyAuth: NSObject, ObservableObject {
    /// Server flag key gating all passkey UI + flows.
    static let featureFlagKey = "passkeys"

    /// Whether passkey UI should be shown and flows attempted.
    /// Reads the shared `FeatureFlags` store; absent key → false.
    static func isEnabled(in flags: FeatureFlags) -> Bool {
        flags.isEnabled(featureFlagKey)
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

    /// Entry from LoginView (button rendered only while the `passkeys` flag is on).
    /// - Parameter email: optional hint so the server can narrow `allowCredentials`.
    func signInWithPasskey(email: String? = nil) async {
        statusMessage = nil
        errorMessage = nil
        didCompleteSignIn = false

        isBusy = true
        defer { isBusy = false }

        do {
            let options = try await api.fetchPasskeyAssertionOptions(email: email)
            let credential = try await performAssertion(options: options)
            // Persists access/refresh tokens to Keychain (same decode path as password login).
            _ = try await api.verifyPasskeyAssertion(credential)
            statusMessage = "Signed in with passkey."
            didCompleteSignIn = true
        } catch let error as ASAuthorizationError where error.code == .canceled {
            // User dismissed the system sheet — not an error state.
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    /// Enrollment from Security settings or the post-register offer (`RegisterView`):
    /// register/options → platform key → register/verify.
    /// Requires a signed-in session (register endpoints are authed).
    func registerPasskey() async {
        statusMessage = nil
        errorMessage = nil

        isBusy = true
        defer { isBusy = false }

        do {
            let options = try await api.fetchPasskeyRegistrationOptions()
            let credential = try await performRegistration(options: options)
            try await api.registerPasskeyCredential(credential)
            statusMessage = "Passkey added. You can now sign in with Face ID or Touch ID on your devices."
        } catch let error as ASAuthorizationError where error.code == .canceled {
            // User dismissed the system sheet — not an error state.
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    // MARK: - ASAuthorization (real controller paths)

    private func performAssertion(options: PasskeyAssertionOptions) async throws -> PasskeyAssertionCredential {
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

        let authorization = try await performAuthorizationRequests([request])

        guard let credential = authorization.credential as? ASAuthorizationPlatformPublicKeyCredentialAssertion else {
            throw PasskeyAuthError.unexpectedCredential
        }

        let credentialID = credential.credentialID.base64URLEncodedString()
        return PasskeyAssertionCredential(
            id: credentialID,
            rawId: credentialID,
            type: "public-key",
            response: PasskeyAssertionCredential.Response(
                authenticatorData: credential.rawAuthenticatorData.base64URLEncodedString(),
                clientDataJSON: credential.rawClientDataJSON.base64URLEncodedString(),
                signature: credential.signature.base64URLEncodedString(),
                userHandle: credential.userID.map { $0.base64URLEncodedString() }
            )
        )
    }

    private func performRegistration(options: PasskeyRegistrationOptions) async throws -> PasskeyRegistrationCredential {
        let challenge = try Self.decodeBase64URL(options.challenge)
        let userID = try Self.decodeBase64URL(options.user.id)
        let rpID = options.rp?.id ?? "no-markup.com"
        // Account label shown in the system passkey sheet / iCloud Keychain.
        let accountName = options.user.name ?? options.user.displayName ?? "NoMarkup"

        let provider = ASAuthorizationPlatformPublicKeyCredentialProvider(relyingPartyIdentifier: rpID)
        let request = provider.createCredentialRegistrationRequest(
            challenge: challenge,
            name: accountName,
            userID: userID
        )

        let authorization = try await performAuthorizationRequests([request])

        guard let credential = authorization.credential as? ASAuthorizationPlatformPublicKeyCredentialRegistration else {
            throw PasskeyAuthError.unexpectedCredential
        }
        guard let attestationObject = credential.rawAttestationObject else {
            throw PasskeyAuthError.unexpectedCredential
        }

        let credentialID = credential.credentialID.base64URLEncodedString()
        return PasskeyRegistrationCredential(
            id: credentialID,
            rawId: credentialID,
            type: "public-key",
            response: PasskeyRegistrationCredential.Response(
                attestationObject: attestationObject.base64URLEncodedString(),
                clientDataJSON: credential.rawClientDataJSON.base64URLEncodedString()
            )
        )
    }

    private func performAuthorizationRequests(
        _ requests: [ASAuthorizationRequest]
    ) async throws -> ASAuthorization {
        let controller = ASAuthorizationController(authorizationRequests: requests)
        controller.delegate = self
        controller.presentationContextProvider = self

        return try await withCheckedThrowingContinuation { continuation in
            self.authorizationContinuation = continuation
            controller.performRequests()
        }
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

// MARK: - DTOs (WebAuthn JSON — camelCase keys per spec; never snake_cased on the wire)

/// Server wrapper: `{ "publicKey": <PublicKeyCredentialRequestOptions> }`.
struct PasskeyAssertionOptionsEnvelope: Decodable, Sendable {
    let publicKey: PasskeyAssertionOptions
}

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

/// Server wrapper: `{ "publicKey": <PublicKeyCredentialCreationOptions> }`.
struct PasskeyRegistrationOptionsEnvelope: Decodable, Sendable {
    let publicKey: PasskeyRegistrationOptions
}

struct PasskeyRegistrationOptions: Decodable, Sendable {
    struct RelyingParty: Decodable, Sendable {
        let id: String?
        let name: String?
    }

    struct User: Decodable, Sendable {
        /// base64url user handle.
        let id: String
        let name: String?
        let displayName: String?
    }

    let challenge: String
    let rp: RelyingParty?
    let user: User
    let timeout: Int?
}

/// Standard WebAuthn assertion credential JSON for `assert/verify`.
struct PasskeyAssertionCredential: Encodable, Sendable {
    struct Response: Encodable, Sendable {
        let authenticatorData: String
        let clientDataJSON: String
        let signature: String
        let userHandle: String?
    }

    let id: String
    let rawId: String
    let type: String
    let response: Response
}

/// Standard WebAuthn registration credential JSON for `register/verify`.
struct PasskeyRegistrationCredential: Encodable, Sendable {
    struct Response: Encodable, Sendable {
        let attestationObject: String
        let clientDataJSON: String
    }

    let id: String
    let rawId: String
    let type: String
    let response: Response
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
