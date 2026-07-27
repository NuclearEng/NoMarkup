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
    /// NotificationCenter token for mid-session expiry (posted by APIClient).
    /// `nonisolated(unsafe)` so `deinit` can remove the observer without MainActor hop.
    nonisolated(unsafe) private var sessionExpiredObserver: NSObjectProtocol?

    init() {
        restoreSessionIfPossible()
        observeSessionExpired()
    }

    deinit {
        if let sessionExpiredObserver {
            NotificationCenter.default.removeObserver(sessionExpiredObserver)
        }
    }

    /// Restore from Keychain.
    ///
    /// - Access and/or refresh present → optimistic signed-in (no login flash).
    /// - Refresh present → always attempt background `refreshSession()` on cold start so an
    ///   expired access token never lands the user in a 401 storm on first authed call.
    /// - APIClient still single-flight-refreshes once on mid-session 401s.
    private func restoreSessionIfPossible() {
        do {
            let access = try tokenStore.read(.accessToken)
            let refresh = try tokenStore.read(.refreshToken)
            let hasAccess = access.map { !$0.isEmpty } ?? false
            let hasRefresh = refresh.map { !$0.isEmpty } ?? false

            guard hasAccess || hasRefresh else {
                isAuthenticated = false
                isScaffoldSession = false
                return
            }

            // Optimistic signed-in while (optional) refresh runs so RootView doesn't flash login.
            isAuthenticated = true
            isScaffoldSession = false

            if hasRefresh {
                Task { await restoreViaRefresh() }
            }
        } catch {
            // Non-fatal: start signed out.
            isAuthenticated = false
            isScaffoldSession = false
        }
    }

    /// Proactive / silent refresh on cold start (single-flight via APIClient).
    private func restoreViaRefresh() async {
        do {
            _ = try await api.refreshSession()
            isScaffoldSession = false
            isAuthenticated = true
        } catch let error as APIClientError where error.isUnauthorized {
            // Definitive auth failure — clear session so RootView returns to LoginView.
            handleDefinitiveAuthFailure(reason: .refreshRejected)
        } catch {
            // Transient (network / 5xx): keep optimistic session if tokens remain.
            // Mid-session 401s will re-attempt refresh via APIClient; if that fails
            // definitively, `NoMarkupSessionExpired` drives sign-out.
        }
    }

    // MARK: - Session expiry (APIClient → NotificationCenter → AuthViewModel)

    private func observeSessionExpired() {
        sessionExpiredObserver = NotificationCenter.default.addObserver(
            forName: .noMarkupSessionExpired,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor [weak self] in
                self?.handleSessionExpiredNotification()
            }
        }
    }

    /// Called when APIClient posts `.noMarkupSessionExpired` after a 401 that
    /// remains after (or without) a refresh attempt. Does not tear down scaffold browse.
    func handleSessionExpiredNotification() {
        guard !isScaffoldSession else { return }
        guard isAuthenticated else { return }
        handleDefinitiveAuthFailure(reason: .sessionExpired)
    }

    private enum AuthFailureReason {
        case refreshRejected
        case sessionExpired
    }

    /// Clear tokens + UI auth state. Only path that flips `isAuthenticated` false on
    /// server-confirmed auth death (not network blips).
    private func handleDefinitiveAuthFailure(reason: AuthFailureReason) {
        try? tokenStore.clearSession()
        isAuthenticated = false
        isScaffoldSession = false
        password = ""
        clearMFAState()
        errorMessage = nil
        switch reason {
        case .refreshRejected, .sessionExpired:
            statusMessage = "Your session expired. Please sign in again."
        }
    }

    // MARK: - Login (+ MFA)

    func login() async {
        guard !isLoading else { return }
        errorMessage = nil
        statusMessage = nil
        let trimmed = email.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !password.isEmpty else {
            errorMessage = "Enter email and password."
            return
        }
        guard trimmed.contains("@"), trimmed.contains(".") else {
            errorMessage = "Enter a valid email address."
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
        guard !isLoading else { return }
        errorMessage = nil
        statusMessage = nil
        let code = mfaCode.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let challenge = mfaChallengeToken, !challenge.isEmpty else {
            errorMessage = "MFA session expired. Sign in again."
            needsMFA = false
            return
        }
        guard code.count >= 6 else {
            errorMessage = "Enter the 6-digit authenticator code."
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
        guard !isLoading else { return }
        errorMessage = nil
        statusMessage = nil
        let trimmedEmail = email.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedName = displayName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedEmail.isEmpty, trimmedEmail.contains("@") else {
            errorMessage = "Enter a valid email."
            return
        }
        guard !trimmedName.isEmpty else {
            errorMessage = "Enter a display name."
            return
        }
        guard Self.isStrongPassword(password) else {
            errorMessage = "Password must be at least 8 characters and include a letter and a number or symbol."
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
        guard !isLoading else { return }
        errorMessage = nil
        statusMessage = nil
        let trimmed = email.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, trimmed.contains("@") else {
            errorMessage = "Enter a valid email."
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
        guard !isLoading else { return }
        errorMessage = nil
        statusMessage = nil
        let trimmedToken = token.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedToken.isEmpty else {
            errorMessage = "Paste the reset token from your email."
            return
        }
        guard Self.isStrongPassword(newPassword) else {
            errorMessage = "Password must be at least 8 characters and include a letter and a number or symbol."
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

    private static func isStrongPassword(_ password: String) -> Bool {
        guard password.count >= 8 else { return false }
        let hasLetter = password.rangeOfCharacter(from: .letters) != nil
        let hasDigitOrSymbol = password.rangeOfCharacter(from: .decimalDigits.union(.punctuationCharacters).union(.symbols)) != nil
        return hasLetter && hasDigitOrSymbol
    }

    private func exchangeAppleIdentityToken(_ identityToken: String, fullName: String?) async {
        guard !isLoading else { return }
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
