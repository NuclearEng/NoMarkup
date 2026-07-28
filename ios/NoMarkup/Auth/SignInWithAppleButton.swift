import AuthenticationServices
import CryptoKit
import SwiftUI

/// Thin wrapper around the system Sign in with Apple control.
/// Requires the `com.apple.developer.applesignin` entitlement (see NoMarkup.entitlements).
///
/// Sets `request.nonce` to the SHA256 hex of a random raw nonce (Apple requirement).
/// The **raw** value is returned with the completion and sent in the
/// `POST /api/v1/auth/apple/native` body: the gateway re-hashes it and requires
/// `sha256hex(body.nonce) == id_token.nonce` for native exchanges (IOS-SEC.1 replay binding).
struct SignInWithAppleButtonView: View {
    /// Completion: authorization result + RAW nonce used on the request (nil on cancel/error before request).
    var onCompletion: (Result<ASAuthorization, Error>, String?) -> Void

    @Environment(\.colorScheme) private var colorScheme
    /// Raw nonce for the in-flight request; its SHA256 hex was set on `request.nonce`
    /// (and therefore appears as the id_token `nonce` claim).
    @State private var pendingRawNonce: String?

    var body: some View {
        SignInWithAppleButton(.signIn) { request in
            let raw = Self.randomNonceString()
            pendingRawNonce = raw
            request.requestedScopes = [.fullName, .email]
            // Only the digest goes to Apple; the raw nonce stays client-side until the
            // gateway exchange, which re-hashes and compares against the token claim.
            request.nonce = Self.sha256Hex(raw)
        } onCompletion: { result in
            let nonce = pendingRawNonce
            pendingRawNonce = nil
            onCompletion(result, nonce)
        }
        .signInWithAppleButtonStyle(colorScheme == .dark ? .white : .black)
        .frame(height: 48)
        .accessibilityLabel("Sign in with Apple")
    }

    // MARK: - Nonce helpers (CryptoKit + SecRandomCopyBytes)

    /// Cryptographically random raw nonce (URL-safe charset). Never sent to Apple as-is —
    /// only its SHA256 hex is set on `ASAuthorizationAppleIDRequest.nonce`.
    private static func randomNonceString(length: Int = 32) -> String {
        precondition(length > 0)
        let charset = Array("0123456789ABCDEFGHIJKLMNOPQRSTUVXYZabcdefghijklmnopqrstuvwxyz-._")
        var result = ""
        result.reserveCapacity(length)
        var remaining = length
        while remaining > 0 {
            var randoms = [UInt8](repeating: 0, count: 16)
            let status = SecRandomCopyBytes(kSecRandomDefault, randoms.count, &randoms)
            if status != errSecSuccess {
                // Extremely rare; fall back to UUID entropy rather than crash auth UX.
                return UUID().uuidString.replacingOccurrences(of: "-", with: "")
            }
            for byte in randoms where remaining > 0 {
                if byte < charset.count {
                    result.append(charset[Int(byte)])
                    remaining -= 1
                }
            }
        }
        return result
    }

    private static func sha256Hex(_ input: String) -> String {
        let digest = SHA256.hash(data: Data(input.utf8))
        return digest.map { String(format: "%02x", $0) }.joined()
    }
}

#Preview {
    SignInWithAppleButtonView { _, _ in }
        .padding()
}
