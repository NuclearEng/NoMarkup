import AuthenticationServices
import Foundation
import SwiftUI

/// Auth state for the scaffold. Production will bind to gateway JWT + refresh cookies.
@MainActor
final class AuthViewModel: ObservableObject {
    @Published var isAuthenticated = false
    @Published var email = ""
    @Published var password = ""
    @Published var isLoading = false
    @Published var errorMessage: String?
    @Published var statusMessage: String?

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
            _ = try await api.login(email: trimmed, password: password)
            isScaffoldSession = false
            isAuthenticated = true
            password = ""
            statusMessage = "Signed in."
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    /// Local-only session so designers can browse native chrome without a running gateway.
    func enterScaffoldSession() {
        errorMessage = nil
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
