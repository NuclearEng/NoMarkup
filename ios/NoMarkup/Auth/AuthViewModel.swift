import AuthenticationServices
import Foundation
import SwiftUI

/// Auth state for email/password, MFA challenge, register, password reset, and SIWA.
@MainActor
final class AuthViewModel: ObservableObject {
    @Published var isAuthenticated = false
    @Published var email = ""
    @Published var password = ""
    @Published var isLoading = false
    @Published var errorMessage: String?
    @Published var statusMessage: String?

    /// When login returns `mfa_required`, UI shows the TOTP field.
    @Published var needsMFA = false
    /// TOTP / authenticator code entered by the user.
    @Published var mfaCode = ""
    /// Challenge token from login; required for `verifyMFA`.
    @Published private(set) var mfaChallengeToken: String?

    /// Scaffold-only: when true, "Continue offline (scaffold)" enables tab chrome without tokens.
    @Published private(set) var isScaffoldSession = false

    private let tokenStore = KeychainTokenStore()
    private let api = APIClient.shared

    init() {
        restoreSessionIfPossible()
    }

    /// Restore from Keychain. If access is missing but a refresh token remains, attempt
    /// a silent refresh (APIClient also retries once on 401 mid-session).
    private func restoreSessionIfPossible() {
        do {
            if let access = try tokenStore.read(.accessToken), !access.isEmpty {
                isAuthenticated = true
                isScaffoldSession = false
                return
            }
            if let refresh = try tokenStore.read(.refreshToken), !refresh.isEmpty {
                // Optimistic signed-in while refresh runs so tabs don't flash login.
                isAuthenticated = true
                isScaffoldSession = false
                Task { await restoreViaRefresh() }
                return
            }
            isAuthenticated = false
            isScaffoldSession = false
        } catch {
            // Non-fatal: start signed out.
            isAuthenticated = false
            isScaffoldSession = false
        }
    }

    /// Silent token refresh when only the refresh token survived (access expired/cleared).
    private func restoreViaRefresh() async {
        do {
            _ = try await api.refreshSession()
            isScaffoldSession = false
            isAuthenticated = true
        } catch {
            try? tokenStore.clearSession()
            isAuthenticated = false
            isScaffoldSession = false
        }
    }

    // MARK: - Login (+ MFA)

    func login() async {
        errorMessage = nil
        statusMessage = nil
        let trimmed = email.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !password.isEmpty else {
            errorMessage = "Enter email and password."
            return
        }

        isLoading = true
        defer { isLoading = false }

        do {
            let result = try await api.loginWithMFAHandling(email: trimmed, password: password)
            switch result {
            case .signedIn:
                clearMFAState()
                isScaffoldSession = false
                isAuthenticated = true
                password = ""
                statusMessage = "Signed in."
            case .mfaRequired(let challengeToken, _):
                // Hold challenge; do not mark authenticated until TOTP succeeds.
                mfaChallengeToken = challengeToken
                needsMFA = true
                isAuthenticated = false
                isScaffoldSession = false
                statusMessage = "Enter the code from your authenticator app."
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func verifyMFA() async {
        errorMessage = nil
        statusMessage = nil
        let code = mfaCode.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let challenge = mfaChallengeToken, !challenge.isEmpty else {
            errorMessage = "MFA session expired. Sign in again."
            needsMFA = false
            return
        }
        guard !code.isEmpty else {
            errorMessage = "Enter your authenticator code."
            return
        }

        isLoading = true
        defer { isLoading = false }

        do {
            _ = try await api.verifyMFA(challengeToken: challenge, totpCode: code)
            clearMFAState()
            isScaffoldSession = false
            isAuthenticated = true
            password = ""
            statusMessage = "Signed in."
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func cancelMFA() {
        clearMFAState()
        statusMessage = nil
        errorMessage = nil
    }

    private func clearMFAState() {
        needsMFA = false
        mfaCode = ""
        mfaChallengeToken = nil
    }

    // MARK: - Register

    func register(
        email: String,
        password: String,
        displayName: String,
        roles: [String] = ["customer"]
    ) async {
        errorMessage = nil
        statusMessage = nil
        let trimmedEmail = email.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedName = displayName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedEmail.isEmpty else {
            errorMessage = "Enter your email."
            return
        }
        guard !trimmedName.isEmpty else {
            errorMessage = "Enter a display name."
            return
        }
        guard password.count >= 8 else {
            errorMessage = "Password must be at least 8 characters."
            return
        }

        isLoading = true
        defer { isLoading = false }

        do {
            _ = try await api.register(
                email: trimmedEmail,
                password: password,
                displayName: trimmedName,
                roles: roles
            )
            self.email = trimmedEmail
            clearMFAState()
            isScaffoldSession = false
            isAuthenticated = true
            self.password = ""
            statusMessage = "Account created. You’re signed in."
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    // MARK: - Password reset

    func requestPasswordReset(email: String) async {
        errorMessage = nil
        statusMessage = nil
        let trimmed = email.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            errorMessage = "Enter your email."
            return
        }

        isLoading = true
        defer { isLoading = false }

        do {
            try await api.requestPasswordReset(email: trimmed)
            // Always success copy — gateway avoids email enumeration.
            statusMessage = "If an account exists for that email, a reset link is on the way. Check your inbox."
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func resetPassword(token: String, newPassword: String) async {
        errorMessage = nil
        statusMessage = nil
        let trimmedToken = token.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedToken.isEmpty else {
            errorMessage = "Paste the reset token from your email."
            return
        }
        guard newPassword.count >= 8 else {
            errorMessage = "Password must be at least 8 characters."
            return
        }

        isLoading = true
        defer { isLoading = false }

        do {
            try await api.resetPassword(token: trimmedToken, newPassword: newPassword)
            statusMessage = "Password updated. You can sign in with your new password."
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    // MARK: - Scaffold / sign-out / SIWA

    /// Local-only session so designers can browse native chrome without a running gateway.
    func enterScaffoldSession() {
        errorMessage = nil
        clearMFAState()
        isScaffoldSession = true
        isAuthenticated = true
        statusMessage = "Browse-only mode — API calls still need a real login."
    }

    func signOut() {
        do {
            try tokenStore.clearSession()
        } catch {
            // Still clear UI state.
        }
        isAuthenticated = false
        isScaffoldSession = false
        password = ""
        clearMFAState()
        errorMessage = nil
        statusMessage = nil
    }

    /// Called when AuthenticationServices completes SIWA.
    func handleSignInWithApple(result: Result<ASAuthorization, Error>) {
        errorMessage = nil
        statusMessage = nil
        switch result {
        case .success(let authorization):
            guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential else {
                errorMessage = "Sign in with Apple returned an unexpected credential."
                return
            }
            guard let tokenData = credential.identityToken,
                  let identityToken = String(data: tokenData, encoding: .utf8),
                  !identityToken.isEmpty
            else {
                errorMessage = "Sign in with Apple did not return an identity token."
                return
            }

            var fullName: String?
            if let name = credential.fullName {
                let parts = [name.givenName, name.familyName].compactMap { $0 }.filter { !$0.isEmpty }
                if !parts.isEmpty {
                    fullName = parts.joined(separator: " ")
                }
            }

            Task {
                await exchangeAppleIdentityToken(identityToken, fullName: fullName)
            }
        case .failure(let error):
            if let authError = error as? ASAuthorizationError, authError.code == .canceled {
                return
            }
            errorMessage = error.localizedDescription
        }
    }

    private func exchangeAppleIdentityToken(_ identityToken: String, fullName: String?) async {
        isLoading = true
        defer { isLoading = false }
        do {
            _ = try await api.signInWithApple(identityToken: identityToken, fullName: fullName)
            clearMFAState()
            isScaffoldSession = false
            isAuthenticated = true
            if let emailHint = fullName, email.isEmpty {
                // Prefer identity email from token when server returns it later.
                _ = emailHint
            }
            statusMessage = "Signed in with Apple."
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
