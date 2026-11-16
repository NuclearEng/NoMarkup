import AuthenticationServices
import Foundation
import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

/// DEBUG / UITest launch switches parsed from process env and argv.
///
/// Env (preferred for `devicectl` — use `DEVICECTL_CHILD_` prefix or
/// `--environment-variables`):
/// - `NOMARKUP_UI_TEST_EMAIL` / `NOMARKUP_UI_TEST_PASSWORD`
/// - `NOMARKUP_UI_TEST_SCAFFOLD=1`
/// - `NOMARKUP_UI_TESTING=1` (XCUITest harness; hides SIWA/passkey sheets)
/// Args: `-ui-test-email` value / `-ui-test-password` value / `-ui-test-scaffold` / `-ui-testing`
enum LaunchTestAuth {
    static var isUITestLaunch: Bool {
        shouldSkipKeychainRestore()
    }

    /// XCUITest process (`NOMARKUP_UI_TESTING=1` or `-ui-testing`) — not scaffold/auto-login.
    static var isHarness: Bool {
        isHarness(
            environment: ProcessInfo.processInfo.environment,
            arguments: ProcessInfo.processInfo.arguments
        )
    }

    static func isHarness(
        environment: [String: String],
        arguments: [String]
    ) -> Bool {
        isTruthyFlag(environment["NOMARKUP_UI_TESTING"]) || arguments.contains("-ui-testing")
    }

    static var wantsScaffold: Bool {
        wantsScaffold(
            environment: ProcessInfo.processInfo.environment,
            arguments: ProcessInfo.processInfo.arguments
        )
    }

    static func wantsScaffold(
        environment: [String: String],
        arguments: [String]
    ) -> Bool {
        arguments.contains("-ui-test-scaffold") || isTruthyFlag(environment["NOMARKUP_UI_TEST_SCAFFOLD"])
    }

    static func credentials(
        environment: [String: String] = ProcessInfo.processInfo.environment,
        arguments: [String] = ProcessInfo.processInfo.arguments
    ) -> (email: String, password: String)? {
        var testEmail = environment["NOMARKUP_UI_TEST_EMAIL"]
        var testPassword = environment["NOMARKUP_UI_TEST_PASSWORD"]
        if let i = arguments.firstIndex(of: "-ui-test-email"), arguments.index(after: i) < arguments.endIndex {
            testEmail = arguments[arguments.index(after: i)]
        }
        if let i = arguments.firstIndex(of: "-ui-test-password"), arguments.index(after: i) < arguments.endIndex {
            testPassword = arguments[arguments.index(after: i)]
        }
        let email = testEmail?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let password = testPassword ?? ""
        guard !email.isEmpty, !password.isEmpty else { return nil }
        return (email, password)
    }

    static var isActive: Bool { wantsScaffold || credentials() != nil }

    /// Harness (with or without credentials), scaffold, or env auto-login — never restore
    /// a leftover dogfood Keychain session. DEBUG dogfood (no flags) still restores.
    static func shouldSkipKeychainRestore(
        environment: [String: String] = ProcessInfo.processInfo.environment,
        arguments: [String] = ProcessInfo.processInfo.arguments
    ) -> Bool {
        isHarness(environment: environment, arguments: arguments)
            || wantsScaffold(environment: environment, arguments: arguments)
            || credentials(environment: environment, arguments: arguments) != nil
    }

    /// `1` / `true` / `yes` so a misspelled `NOMARKUP_UI_TESTING=true` still skips restore.
    private static func isTruthyFlag(_ raw: String?) -> Bool {
        switch (raw ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
        case "1", "true", "yes":
            return true
        default:
            return false
        }
    }
}

/// Auth state for email/password, MFA, register, password reset, SIWA, and Google (ASWebAuth + PKCE).
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

    /// After register, RootTabView presents `OnboardingWizardView` once (non-blocking).
    /// Cleared when the sheet is presented or on sign-out.
    @Published var shouldPresentOnboarding = false

    /// True while any auth network operation is in flight.
    /// LoginView uses this to disable email submit, SIWA, and scaffold while loading.
    var isBusy: Bool { isLoading }

    private let tokenStore = KeychainTokenStore()
    private let api = APIClient.shared
    /// Shown for the last 20 seconds of the role idle window, with Stay signed in.
    @Published var sessionEndingSoon = false

    /// NotificationCenter token for mid-session expiry (posted by APIClient).
    // SAFETY: written on the main actor in init and removed in deinit of this instance. Not shared across tasks.
    nonisolated(unsafe) private var sessionExpiredObserver: NSObjectProtocol?
    // SAFETY: same lifetime as sessionExpiredObserver. Removed in deinit. Not shared across tasks.
    nonisolated(unsafe) private var sessionActivityObserver: NSObjectProtocol?

    private var idleTouchAt: Date?
    private var idleWindow: TimeInterval = SessionIdleWindow.defaultSeconds
    private var idleWatchTask: Task<Void, Never>?

    /// Bumped on every successful auth write and on sign-out. In-flight Keychain
    /// restore / stale `.noMarkupSessionExpired` handlers compare against this so
    /// they cannot wipe a login that completed while they were in flight.
    private var sessionEpoch: UInt64 = 0

    init() {
        #if DEBUG
        if LaunchTestAuth.shouldSkipKeychainRestore() {
            // UITest / sim role launches must not restore a previous dogfood session.
            // Stale refresh 401s used to post "Your session expired" *after* env login
            // wrote fresh tokens and bounce XCUITest back to Sign in.
            // Harness with no credentials (login a11y) must also skip Keychain restore.
            try? tokenStore.clearSession()
            isAuthenticated = false
            isScaffoldSession = false
            observeSessionExpired()
            return
        }
        #endif
        restoreSessionIfPossible()
        observeSessionExpired()
    }

    /// DEBUG / UITest: auto-login from launch environment or process arguments.
    @discardableResult
    func applyLaunchTestCredentialsIfNeeded() async -> Bool {
        #if DEBUG
        if LaunchTestAuth.wantsScaffold {
            enterScaffoldSession()
            return true
        }

        guard let creds = LaunchTestAuth.credentials() else {
            return false
        }

        // Invalidate any in-flight restore and drop leftover tokens before login
        // so a delayed refresh 401 cannot clear the session we are about to write.
        beginNewSessionEpoch()
        try? tokenStore.clearSession()
        isAuthenticated = false
        isScaffoldSession = false
        statusMessage = nil
        errorMessage = nil

        self.email = creds.email
        self.password = creds.password

        if isBusy {
            let deadline = Date().addingTimeInterval(8)
            while isBusy, Date() < deadline {
                try? await Task.sleep(nanoseconds: 100_000_000)
            }
        }
        if isAuthenticated, !isScaffoldSession {
            return true
        }
        await login()
        return isAuthenticated && !isScaffoldSession
        #else
        return false
        #endif
    }

    @discardableResult
    private func beginNewSessionEpoch() -> UInt64 {
        sessionEpoch += 1
        return sessionEpoch
    }

    deinit {
        if let sessionExpiredObserver {
            NotificationCenter.default.removeObserver(sessionExpiredObserver)
        }
        if let sessionActivityObserver {
            NotificationCenter.default.removeObserver(sessionActivityObserver)
        }
    }

    /// Restore from Keychain.
    ///
    /// - Access and/or refresh present → optimistic signed-in (no login flash).
    /// - Refresh present → always attempt background `refreshSession()` on cold start so an
    ///   expired access token never lands the user in a 401 storm on first authed call.
    /// - APIClient still single-flight-refreshes once on mid-session 401s.
    private func restoreSessionIfPossible() {
        let hasAccess = tokenStore.hasAccessToken()
        let hasRefresh = tokenStore.hasRefreshToken()

        guard hasAccess || hasRefresh else {
            isAuthenticated = false
            isScaffoldSession = false
            return
        }

        // Optimistic signed-in while (optional) refresh runs so RootView doesn't flash login.
        isAuthenticated = true
        isScaffoldSession = false
        noteAuthenticatedActivity()

        if hasRefresh {
            Task { await restoreViaRefresh() }
        }
    }

    /// Proactive / silent refresh on cold start (single-flight via APIClient).
    private func restoreViaRefresh() async {
        let epoch = sessionEpoch
        do {
            _ = try await api.refreshSession()
            guard epoch == sessionEpoch else { return }
            isScaffoldSession = false
            isAuthenticated = true
            noteAuthenticatedActivity()
        } catch let error as APIClientError where error.isUnauthorized {
            guard epoch == sessionEpoch else { return }
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
        sessionActivityObserver = NotificationCenter.default.addObserver(
            forName: .noMarkupAuthenticatedActivity,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor [weak self] in
                self?.noteAuthenticatedActivity()
            }
        }
    }

    /// Called when APIClient posts `.noMarkupSessionExpired` after a 401 that
    /// remains after (or without) a refresh attempt. Does not tear down scaffold browse.
    func handleSessionExpiredNotification() {
        guard !isScaffoldSession else { return }
        guard isAuthenticated else { return }
        let epoch = sessionEpoch
        Task { @MainActor in
            // A login that completed while this notification was in flight bumped the
            // epoch; keep that session. APIClient also suppresses the post when the
            // refresh token was replaced, but this is the last line of defense.
            guard epoch == sessionEpoch else { return }
            guard !isScaffoldSession, isAuthenticated else { return }
            handleDefinitiveAuthFailure(reason: .sessionExpired)
        }
    }

    private enum AuthFailureReason {
        case refreshRejected
        case sessionExpired
    }

    /// Clear tokens + UI auth state. Only path that flips `isAuthenticated` false on
    /// server-confirmed auth death (not network blips).
    /// RootView observes `isAuthenticated` → false and already calls `push.resetSessionState()`.
    private func handleDefinitiveAuthFailure(reason: AuthFailureReason) {
        idleWatchTask?.cancel()
        idleWatchTask = nil
        idleTouchAt = nil
        sessionEndingSoon = false
        beginNewSessionEpoch()
        // Capture Bearer and end activities before Keychain clear. Unregister
        // must not re-read Keychain or block the signed-out UI flip.
        let accessForUnregister = (try? tokenStore.read(.accessToken))
            .flatMap { $0.isEmpty ? nil : $0 }
        let deviceKey = PushRegistration.shared.deviceTokenHex.flatMap { $0.isEmpty ? nil : $0 }
        let liveActivityAuctionIDs = AuctionLiveActivityController.endAllLocal()
        try? tokenStore.clearSession()
        WidgetSharedStore.clear()
        PushRegistration.shared.clearBadge()
        Task { await SpotlightIndex.deleteAll() }
        isAuthenticated = false
        isScaffoldSession = false
        shouldPresentOnboarding = false
        clearSensitiveInMemoryFields()
        errorMessage = nil
        switch reason {
        case .refreshRejected, .sessionExpired:
            statusMessage = "Your session expired. Please sign in again."
            AccessibilityNotification.Announcement("Your session expired. Please sign in again.").post()
        }
        Task {
            await Self.unregisterPushDevice(
                deviceKey: deviceKey,
                accessToken: accessForUnregister
            )
            for auctionID in liveActivityAuctionIDs {
                await Self.unregisterPushDevice(
                    deviceKey: "liveactivity:\(auctionID)",
                    accessToken: accessForUnregister
                )
            }
        }
    }

    /// Wipe password + MFA challenge material from memory (never log these).
    private func clearSensitiveInMemoryFields() {
        password = ""
        clearMFAState()
    }

    /// Notify app root to re-fetch feature flags after a successful interactive sign-in.
    private func notifyAuthSucceeded() {
        noteAuthenticatedActivity()
        NotificationCenter.default.post(name: .noMarkupAuthDidSucceed, object: nil)
    }

    /// Reset the idle clock from a successful sign-in or an authenticated response.
    /// The window matches the server role timeout. Stay signed in can extend it.
    func noteAuthenticatedActivity(accessToken: String? = nil) {
        guard isAuthenticated, !isScaffoldSession else { return }
        idleTouchAt = Date()
        let token = accessToken ?? (try? tokenStore.read(.accessToken))
        if let token, let roles = AccessTokenClaimsReader.roles(in: token), !roles.isEmpty {
            idleWindow = SessionIdleWindow.seconds(for: roles)
        }
        sessionEndingSoon = false
        scheduleIdleWarning()
    }

    func staySignedIn() async {
        let epoch = sessionEpoch
        do {
            let pair = try await api.refreshSession()
            guard epoch == sessionEpoch else { return }
            noteAuthenticatedActivity(accessToken: pair.accessToken)
            AccessibilityNotification.Announcement("You stayed signed in.").post()
        } catch {
            guard epoch == sessionEpoch else { return }
            handleDefinitiveAuthFailure(reason: .sessionExpired)
        }
    }

    private func scheduleIdleWarning() {
        idleWatchTask?.cancel()
        guard isAuthenticated, !isScaffoldSession, let touch = idleTouchAt else {
            sessionEndingSoon = false
            return
        }
        let epoch = sessionEpoch
        let warnAt = touch.addingTimeInterval(idleWindow - SessionIdleWindow.warningLead)
        let endAt = touch.addingTimeInterval(idleWindow)
        idleWatchTask = Task { @MainActor [weak self] in
            let warnDelay = warnAt.timeIntervalSinceNow
            if warnDelay > 0 {
                try? await Task.sleep(nanoseconds: UInt64(warnDelay * 1_000_000_000))
            }
            guard !Task.isCancelled, let self, self.sessionEpoch == epoch, self.isAuthenticated, !self.isScaffoldSession else { return }
            self.sessionEndingSoon = true
            AccessibilityNotification.Announcement("Your session will end soon. Choose Stay signed in to keep your place.").post()
            let endDelay = endAt.timeIntervalSinceNow
            if endDelay > 0 {
                try? await Task.sleep(nanoseconds: UInt64(endDelay * 1_000_000_000))
            }
            guard !Task.isCancelled, self.sessionEpoch == epoch, self.isAuthenticated, !self.isScaffoldSession else { return }
            self.handleDefinitiveAuthFailure(reason: .sessionExpired)
        }
    }

    /// Adopt a session already written to Keychain (e.g. passkey verify).
    func adoptExistingSession(status: String = "Signed in.") {
        beginNewSessionEpoch()
        clearSensitiveInMemoryFields()
        isScaffoldSession = false
        isAuthenticated = true
        statusMessage = status
        errorMessage = nil
        notifyAuthSucceeded()
    }

    // MARK: - Login (+ MFA)

    func login() async {
        guard !isBusy else { return }
        errorMessage = nil
        statusMessage = nil
        let trimmed = email.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !password.isEmpty else {
            BrandHaptics.warning()
            errorMessage = "Enter email and password."
            return
        }
        guard trimmed.contains("@"), trimmed.contains(".") else {
            BrandHaptics.warning()
            errorMessage = "Enter a valid email address."
            return
        }

        isLoading = true
        defer { isLoading = false }

        do {
            // Password is only sent over the wire; never logged.
            let result = try await api.loginWithMFAHandling(email: trimmed, password: password)
            switch result {
            case .signedIn:
                BrandHaptics.success()
                beginNewSessionEpoch()
                clearSensitiveInMemoryFields()
                isScaffoldSession = false
                isAuthenticated = true
                statusMessage = "Signed in."
                notifyAuthSucceeded()
            case .mfaRequired(let challengeToken, _):
                // Hold challenge; do not mark authenticated until TOTP succeeds.
                // Clear password once the challenge is open — only TOTP is needed next.
                BrandHaptics.light()
                password = ""
                mfaChallengeToken = challengeToken
                needsMFA = true
                isAuthenticated = false
                isScaffoldSession = false
                statusMessage = "Enter the code from your authenticator app."
            }
        } catch {
            BrandHaptics.error()
            errorMessage = error.localizedDescription
        }
    }

    func verifyMFA() async {
        guard !isBusy else { return }
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
            beginNewSessionEpoch()
            clearSensitiveInMemoryFields()
            isScaffoldSession = false
            isAuthenticated = true
            statusMessage = "Signed in."
            notifyAuthSucceeded()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func cancelMFA() {
        clearSensitiveInMemoryFields()
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
        guard !isBusy else { return }
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
            // Password is only sent over the wire; never logged.
            _ = try await api.register(
                email: trimmedEmail,
                password: password,
                displayName: trimmedName,
                roles: roles
            )
            self.email = trimmedEmail
            beginNewSessionEpoch()
            clearSensitiveInMemoryFields()
            isScaffoldSession = false
            isAuthenticated = true
            statusMessage = "Account created. You’re signed in."
            // FR-1.5: guided setup (phone / optional provider) without blocking register.
            shouldPresentOnboarding = true
            notifyAuthSucceeded()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    // MARK: - Password reset

    func requestPasswordReset(email: String) async {
        guard !isBusy else { return }
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
        guard !isBusy else { return }
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
            // New password is only sent over the wire; never logged.
            try await api.resetPassword(token: trimmedToken, newPassword: newPassword)
            statusMessage = "Password updated. You can sign in with your new password."
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    // MARK: - Scaffold / sign-out / SIWA

    /// Local-only session so designers can browse native chrome without a running gateway.
    func enterScaffoldSession() {
        guard !isBusy else { return }
        errorMessage = nil
        beginNewSessionEpoch()
        clearSensitiveInMemoryFields()
        isScaffoldSession = true
        isAuthenticated = true
        statusMessage = "Browse-only mode — API calls still need a real login."
    }

    func signOut() {
        idleWatchTask?.cancel()
        idleWatchTask = nil
        idleTouchAt = nil
        sessionEndingSoon = false
        beginNewSessionEpoch()
        // Capture tokens first — Keychain must be empty before this returns so a
        // force-quit cannot restore the session, and a fast re-login cannot be
        // wiped by a deferred clearSession.
        let accessForUnregister = (try? tokenStore.read(.accessToken))
            .flatMap { $0.isEmpty ? nil : $0 }
        let refreshForLogout = try? tokenStore.read(.refreshToken)
        let shouldCallServer = !isScaffoldSession
        let deviceKey = PushRegistration.shared.deviceTokenHex.flatMap { $0.isEmpty ? nil : $0 }
        // End activities before Keychain clear. Their device keys unregister
        // below with the captured Bearer — never via APIClient.
        let liveActivityAuctionIDs = AuctionLiveActivityController.endAllLocal()

        do {
            try tokenStore.clearSession()
        } catch {
            // Still clear UI state even if Keychain delete partially failed.
        }

        // OBS-3: widgets must not keep rendering auction data after sign-out.
        WidgetSharedStore.clear()

        // Drop the icon badge before RootView tears down the signed-in shell.
        PushRegistration.shared.clearBadge()
        isAuthenticated = false
        isScaffoldSession = false
        shouldPresentOnboarding = false
        clearSensitiveInMemoryFields()
        errorMessage = nil
        statusMessage = nil

        PushRegistration.shared.resetSessionState()

        // IOS-INT.2: purge Spotlight so donated jobs/listings do not outlive the session.
        Task { await SpotlightIndex.deleteAll() }

        guard shouldCallServer else { return }
        Task {
            // Unregister with the captured access token — never re-read Keychain
            // (a new login may already have written fresh tokens).
            await Self.withTimeout(seconds: 3) {
                await Self.unregisterPushDevice(
                    deviceKey: deviceKey,
                    accessToken: accessForUnregister
                )
            }
            for auctionID in liveActivityAuctionIDs {
                await Self.unregisterPushDevice(
                    deviceKey: "liveactivity:\(auctionID)",
                    accessToken: accessForUnregister
                )
            }
            try? await self.api.logout(refreshToken: refreshForLogout)
        }
    }

    /// Best-effort DELETE `/api/v1/notifications/devices/{token}` using a captured
    /// Bearer. Does not touch Keychain — sign-out already wiped the session.
    private static func unregisterPushDevice(deviceKey: String?, accessToken: String?) async {
        guard let accessToken, !accessToken.isEmpty else { return }
        #if canImport(UIKit)
        let fallbackID = UIDevice.current.identifierForVendor?.uuidString
        #else
        let fallbackID: String? = nil
        #endif
        let key = deviceKey ?? fallbackID ?? ""
        guard !key.isEmpty else { return }
        var url = AppConfig.apiBaseURL
        for component in ["api", "v1", "notifications", "devices", key] {
            url = url.appending(path: component)
        }
        var request = URLRequest(url: url)
        request.httpMethod = "DELETE"
        request.timeoutInterval = 8
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        _ = try? await URLSession.shared.data(for: request)
    }

    /// Run `operation`, giving up (and cancelling it) after `seconds`.
    /// Used to cap best-effort sign-out network cleanup.
    private static func withTimeout(
        seconds: TimeInterval,
        _ operation: @escaping @Sendable () async -> Void
    ) async {
        await withTaskGroup(of: Void.self) { group in
            group.addTask { await operation() }
            group.addTask {
                try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
            }
            await group.next()
            group.cancelAll()
        }
    }

    /// Called when AuthenticationServices completes SIWA.
    /// - Parameters:
    ///   - result: Authorization outcome from the system button.
    ///   - nonce: RAW nonce whose SHA256 hex was set on the request. Sent to the
    ///     gateway, which re-hashes and requires it to match the id_token claim
    ///     (IOS-SEC.1) — so it must be non-empty for a native exchange.
    func handleSignInWithApple(result: Result<ASAuthorization, Error>, nonce: String?) {
        guard !isBusy else { return }
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
            // Gateway rejects nonce-less native exchanges — fail fast with clear copy.
            guard let rawNonce = nonce?.trimmingCharacters(in: .whitespacesAndNewlines),
                  !rawNonce.isEmpty
            else {
                errorMessage = "Sign in with Apple could not be verified on this attempt. Please try again."
                return
            }
            guard let codeData = credential.authorizationCode,
                  let authorizationCode = String(data: codeData, encoding: .utf8),
                  !authorizationCode.isEmpty
            else {
                errorMessage = "Sign in with Apple did not return an authorization code."
                return
            }
            let appleUserID = credential.user.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !appleUserID.isEmpty else {
                errorMessage = "Sign in with Apple did not return a user id."
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
                await exchangeAppleIdentityToken(
                    identityToken,
                    authorizationCode: authorizationCode,
                    appleUserID: appleUserID,
                    fullName: fullName,
                    nonce: rawNonce
                )
            }
        case .failure(let error):
            if let authError = error as? ASAuthorizationError, authError.code == .canceled {
                return
            }
            errorMessage = error.localizedDescription
        }
    }

    /// FR-1.1 Google: ASWebAuthenticationSession + PKCE → Google id_token → gateway native exchange.
    func signInWithGoogle() async {
        guard !isBusy else { return }
        errorMessage = nil
        statusMessage = nil

        isLoading = true
        defer { isLoading = false }

        do {
            let session = GoogleOAuthSession()
            let identityToken = try await session.signIn()
            let result = try await api.signInWithGoogle(identityToken: identityToken)
            applyOAuthLoginResult(result, successMessage: "Signed in with Google.")
        } catch let error as GoogleOAuthSession.SessionError {
            if case .canceled = error {
                return
            }
            errorMessage = error.localizedDescription
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    /// FR-1.1 Facebook: ASWebAuthenticationSession → authorization code → gateway native exchange.
    func signInWithFacebook() async {
        guard !isBusy else { return }
        errorMessage = nil
        statusMessage = nil

        isLoading = true
        defer { isLoading = false }

        do {
            let session = FacebookOAuthSession()
            let auth = try await session.signIn()
            let result = try await api.signInWithFacebook(
                authorizationCode: auth.authorizationCode,
                redirectURI: auth.redirectURI
            )
            applyOAuthLoginResult(result, successMessage: "Signed in with Facebook.")
        } catch let error as FacebookOAuthSession.SessionError {
            if case .canceled = error {
                return
            }
            errorMessage = error.localizedDescription
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private static func isStrongPassword(_ password: String) -> Bool {
        guard password.count >= 8 else { return false }
        let hasLetter = password.rangeOfCharacter(from: .letters) != nil
        let hasDigitOrSymbol = password.rangeOfCharacter(from: .decimalDigits.union(.punctuationCharacters).union(.symbols)) != nil
        return hasLetter && hasDigitOrSymbol
    }

    private func applyOAuthLoginResult(_ result: AuthLoginResult, successMessage: String) {
        switch result {
        case .signedIn:
            beginNewSessionEpoch()
            clearSensitiveInMemoryFields()
            isScaffoldSession = false
            isAuthenticated = true
            needsMFA = false
            statusMessage = successMessage
            notifyAuthSucceeded()
        case .mfaRequired(let challengeToken, _):
            password = ""
            mfaChallengeToken = challengeToken
            needsMFA = true
            isAuthenticated = false
            isScaffoldSession = false
            statusMessage = "Enter the code from your authenticator app."
        }
    }

    /// - Parameter nonce: RAW request nonce (gateway re-hashes; required for native).
    private func exchangeAppleIdentityToken(
        _ identityToken: String,
        authorizationCode: String,
        appleUserID: String,
        fullName: String?,
        nonce: String?
    ) async {
        guard !isBusy else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            let result = try await api.signInWithApple(
                identityToken: identityToken,
                authorizationCode: authorizationCode,
                appleUserID: appleUserID,
                fullName: fullName,
                nonce: nonce
            )
            applyOAuthLoginResult(result, successMessage: "Signed in with Apple.")
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

/// Role idle windows. Matches gateway `idleTTLForRoles`: the smallest recognized role wins.
enum SessionIdleWindow {
    static let warningLead: TimeInterval = 20
    static let defaultSeconds: TimeInterval = 30 * 60

    static func seconds(for roles: [String]) -> TimeInterval {
        var ttl: TimeInterval = 0
        for role in roles {
            let candidate: TimeInterval
            switch role {
            case "customer":
                candidate = 60 * 60
            case "provider":
                candidate = 120 * 60
            case "admin":
                candidate = 30 * 60
            default:
                continue
            }
            if ttl == 0 || candidate < ttl {
                ttl = candidate
            }
        }
        return ttl == 0 ? defaultSeconds : ttl
    }
}

/// Reads `roles` from an access-token payload to pick the idle window.
/// This does not authenticate the token. The server still enforces the window.
enum AccessTokenClaimsReader {
    struct Payload: Decodable {
        var roles: [String]?
    }

    static func roles(in jwt: String) -> [String]? {
        let parts = jwt.split(separator: ".")
        guard parts.count >= 2 else { return nil }
        var base64 = String(parts[1])
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        let remainder = base64.count % 4
        if remainder != 0 {
            base64 += String(repeating: "=", count: 4 - remainder)
        }
        guard let data = Data(base64Encoded: base64) else { return nil }
        return try? JSONDecoder().decode(Payload.self, from: data).roles
    }
}
