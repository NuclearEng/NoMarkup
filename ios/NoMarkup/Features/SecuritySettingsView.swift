import SwiftUI

/// Security settings — change password, full MFA setup/confirm/disable, age verification,
/// passkey enrollment (server-flagged).
struct SecuritySettingsView: View {
    @EnvironmentObject private var auth: AuthViewModel
    @EnvironmentObject private var featureFlags: FeatureFlags
    // Passkey enrollment (IOS-SEC.2) — section shown only when the `passkeys` flag is on.
    @StateObject private var passkeyAuth = PasskeyAuth()

    @State private var currentPassword = ""
    @State private var newPassword = ""
    @State private var confirmPassword = ""

    @State private var ageStatus: AgeStatus?
    @State private var isLoadingAge = false
    @State private var dobDate = Calendar.current.date(byAdding: .year, value: -21, to: Date()) ?? Date()
    @State private var isSubmittingAge = false
    @State private var ageError: String?
    @State private var ageStatusMessage: String?

    @State private var isChangingPassword = false
    @State private var errorMessage: String?
    @State private var statusMessage: String?
    @State private var needsSignIn = false

    @State private var mfaEnabled = false
    @State private var isLoadingMFAProfile = false
    @State private var mfaSetup: EnableMFAResponse?
    @State private var mfaVerifyCode = ""
    @State private var mfaDisableCode = ""
    @State private var showDisableMFA = false
    @State private var isEnablingMFA = false
    @State private var isConfirmingMFA = false
    @State private var isDisablingMFA = false
    @State private var mfaError: String?
    @State private var mfaStatus: String?

    // Connected OAuth accounts (ASR-5.1.1.v — list + lockout-safe unlink).
    @State private var oauthAccounts: [OAuthAccount] = []
    @State private var isLoadingOAuth = false
    @State private var oauthLoadError: String?
    @State private var oauthStatusMessage: String?
    @State private var oauthError: String?
    @State private var unlinkingProvider: String?
    @State private var confirmUnlinkProvider: String?

    var body: some View {
        Group {
            if auth.isScaffoldSession {
                BrandEmptyState(
                    title: "Sign in required",
                    systemImage: "lock.shield",
                    message: "Browse-only mode has no API credentials. Sign in with a real account to manage security.",
                    actionTitle: "Sign out to log in",
                    action: { auth.signOut() }
                )
            } else if needsSignIn || !auth.isAuthenticated {
                BrandEmptyState(
                    title: "Sign in required",
                    systemImage: "lock.circle",
                    message: "Your session expired. Sign in again to change your password, manage MFA, or verify age.",
                    actionTitle: "Sign in",
                    action: { auth.signOut() }
                )
            } else {
                formContent
            }
        }
        .navigationTitle("Security")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbarBackground(BrandTheme.navy, for: .navigationBar)
        .task {
            await loadAgeStatus()
            await loadMFAProfile()
            await loadOAuthAccounts()
        }
        .confirmationDialog(
            unlinkDialogTitle,
            isPresented: Binding(
                get: { confirmUnlinkProvider != nil },
                set: { if !$0 { confirmUnlinkProvider = nil } }
            ),
            titleVisibility: .visible
        ) {
            Button("Disconnect", role: .destructive) {
                if let provider = confirmUnlinkProvider {
                    Task { await unlinkOAuth(provider) }
                }
                confirmUnlinkProvider = nil
            }
            Button("Cancel", role: .cancel) {
                confirmUnlinkProvider = nil
            }
        } message: {
            Text(
                "You can reconnect later by signing in with that provider. Disconnecting is blocked if it would leave you with no way to sign in — set a password first if this is your only method."
            )
        }
    }

    private var unlinkDialogTitle: String {
        if let provider = confirmUnlinkProvider {
            let label = oauthAccounts.first(where: { $0.provider.lowercased() == provider })?.displayName
                ?? provider.capitalized
            return "Disconnect \(label)?"
        }
        return "Disconnect account?"
    }

    private var formContent: some View {
        Form {
            Section {
                ageStatusRow
                if ageStatus?.isVerified != true {
                    DatePicker(
                        "Date of birth",
                        selection: $dobDate,
                        in: ...Date(),
                        displayedComponents: .date
                    )
                    .datePickerStyle(.compact)
                    .frame(minHeight: 44)
                    .accessibilityLabel("Date of birth")
                    .accessibilityHint("Must be at least 18 years old. Date is stored securely and never shown publicly.")

                    if let ageError {
                        Text(ageError)
                            .font(.footnote)
                            .foregroundStyle(BrandTheme.destructive)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    if let ageStatusMessage {
                        Text(ageStatusMessage)
                            .font(.footnote)
                            .foregroundStyle(BrandTheme.success)
                            .fixedSize(horizontal: false, vertical: true)
                    }

                    Button {
                        Task { await submitAge() }
                    } label: {
                        HStack {
                            if isSubmittingAge {
                                ProgressView()
                                    .tint(BrandTheme.ctaLabelOnGold)
                            }
                            Text(isSubmittingAge ? "Verifying…" : "Verify age")
                                .frame(maxWidth: .infinity)
                        }
                        .frame(minHeight: 48)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(BrandTheme.accent)
                    .disabled(isSubmittingAge)
                    .accessibilityHint("Sends your date of birth to the server. Age is verified server-side; DOB is never returned.")
                }
            } header: {
                Text("Age verification").brandSectionHeader()
            } footer: {
                Text("NoMarkup requires users to be 18+. Your date of birth is encrypted at rest and never shown publicly.")
                    .foregroundStyle(BrandTheme.textSecondary)
            }

            Section {
                Toggle(
                    "Require \(BiometricGate.biometryDisplayName) for sensitive actions",
                    isOn: Binding(
                        get: { BiometricGate.requireForSensitiveActions },
                        set: { BiometricGate.requireForSensitiveActions = $0 }
                    )
                )
                .frame(minHeight: 44)
                .accessibilityIdentifier("security.requireBiometric")
                .accessibilityHint(
                    "When on, \(BiometricGate.biometryDisplayName) is required to unlock the app, delete your account, and remove payment methods."
                )
                if !BiometricGate.canAuthenticate {
                    Text("This device has no Face ID, Touch ID, or passcode enrolled. The toggle is saved but authentication cannot run until you set one up in iOS Settings.")
                        .font(.footnote)
                        .foregroundStyle(BrandTheme.warning)
                        .fixedSize(horizontal: false, vertical: true)
                }
            } header: {
                Text("Device lock").brandSectionHeader()
            } footer: {
                Text("Uses \(BiometricGate.biometryDisplayName) (or device passcode) before destructive account and payment actions, and optionally locks the app when returning from background.")
                    .foregroundStyle(BrandTheme.textSecondary)
            }

            if PasskeyAuth.isEnabled(in: featureFlags) {
                Section {
                    passkeySectionBody
                } header: {
                    Text("Passkeys").brandSectionHeader()
                } footer: {
                    Text("Passkeys sign you in with \(BiometricGate.biometryDisplayName) — nothing to type or phish. Saved to iCloud Keychain and synced across your devices.")
                        .foregroundStyle(BrandTheme.textSecondary)
                }
            }

            Section {
                mfaSectionBody
            } header: {
                Text("Two-factor authentication").brandSectionHeader()
            } footer: {
                Text("Use an authenticator app (1Password, Authy, Google Authenticator). Store backup codes offline — each works once.")
                    .foregroundStyle(BrandTheme.textSecondary)
            }

            Section {
                connectedAccountsSection
            } header: {
                Text("Connected accounts").brandSectionHeader()
            } footer: {
                Text("Social sign-in providers linked to this account. Disconnect is blocked server-side if it would leave you with no way to sign in.")
                    .foregroundStyle(BrandTheme.textSecondary)
            }

            Section {
                SecureField("Current password", text: $currentPassword)
                    .textContentType(.password)
                    .foregroundStyle(BrandTheme.textPrimary)
                    .frame(minHeight: 44)
                    .accessibilityLabel("Current password")

                SecureField("New password", text: $newPassword)
                    .textContentType(.newPassword)
                    .foregroundStyle(BrandTheme.textPrimary)
                    .frame(minHeight: 44)
                    .accessibilityLabel("New password")
                    .accessibilityHint("At least 8 characters with letters and a number or symbol")

                SecureField("Confirm new password", text: $confirmPassword)
                    .textContentType(.newPassword)
                    .foregroundStyle(BrandTheme.textPrimary)
                    .frame(minHeight: 44)
                    .accessibilityLabel("Confirm new password")
            } header: {
                Text("Change password").brandSectionHeader()
            } footer: {
                Text("Use at least 8 characters with letters and a number or symbol. Changing password ends other sessions.")
                    .foregroundStyle(BrandTheme.textSecondary)
            }

            if let statusMessage {
                Section {
                    Text(statusMessage)
                        .font(.footnote)
                        .foregroundStyle(BrandTheme.success)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }

            if let errorMessage {
                Section {
                    Text(errorMessage)
                        .font(.footnote)
                        .foregroundStyle(BrandTheme.destructive)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }

            Section {
                Button {
                    Task { await changePassword() }
                } label: {
                    HStack {
                        if isChangingPassword {
                            ProgressView()
                                .tint(BrandTheme.ctaLabelOnGold)
                        }
                        Text(isChangingPassword ? "Updating…" : "Update password")
                            .frame(maxWidth: .infinity)
                    }
                    .frame(minHeight: 48)
                }
                .buttonStyle(.borderedProminent)
                .tint(BrandTheme.accent)
                .disabled(!canSubmitPassword || isChangingPassword)
                .accessibilityHint("Sends your new password to the server after verifying the current one")
            }
        }
        .brandListBackground()
        .scrollDismissesKeyboard(.interactively)
    }

    // MARK: - Passkeys section (IOS-SEC.2 enrollment)

    @ViewBuilder
    private var passkeySectionBody: some View {
        Button {
            guard !passkeyAuth.isBusy else { return }
            Task { await passkeyAuth.registerPasskey() }
        } label: {
            HStack(spacing: 10) {
                if passkeyAuth.isBusy {
                    ProgressView()
                        .tint(BrandTheme.accent)
                    Text("Adding passkey…")
                        .foregroundStyle(BrandTheme.textSecondary)
                } else {
                    Label("Add a passkey", systemImage: "person.badge.key.fill")
                }
                Spacer(minLength: 0)
            }
            .frame(minHeight: 44)
        }
        .disabled(passkeyAuth.isBusy)
        .accessibilityIdentifier("security.addPasskey")
        .accessibilityLabel("Add a passkey")
        .accessibilityHint("Creates a passkey for this account with \(BiometricGate.biometryDisplayName) and saves it to iCloud Keychain")

        if let status = passkeyAuth.statusMessage {
            Text(status)
                .font(.footnote)
                .foregroundStyle(BrandTheme.success)
                .fixedSize(horizontal: false, vertical: true)
        }
        if let error = passkeyAuth.errorMessage {
            Text(error)
                .font(.footnote)
                .foregroundStyle(BrandTheme.destructive)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityLabel("Error: \(error)")
        }
    }

    // MARK: - MFA section

    @ViewBuilder
    private var mfaSectionBody: some View {
        if isLoadingMFAProfile && mfaSetup == nil {
            HStack {
                ProgressView()
                    .tint(BrandTheme.accent)
                Text("Checking MFA status…")
                    .foregroundStyle(BrandTheme.textSecondary)
            }
            .frame(minHeight: 44)
        } else if let mfaSetup, mfaSetup.hasSetupMaterial {
            mfaSetupMaterial(mfaSetup)

            TextField("6-digit code", text: $mfaVerifyCode)
                #if os(iOS)
                .keyboardType(.numberPad)
                .textContentType(.oneTimeCode)
                #endif
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
                .font(.body.monospacedDigit())
                .frame(minHeight: 44)
                .accessibilityLabel("Authenticator verification code")
                .accessibilityHint("Enter the 6-digit code from your authenticator app to finish enabling MFA")

            if let mfaStatus {
                Text(mfaStatus)
                    .font(.footnote)
                    .foregroundStyle(BrandTheme.success)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if let mfaError {
                Text(mfaError)
                    .font(.footnote)
                    .foregroundStyle(BrandTheme.destructive)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Button {
                Task { await confirmMFASetup() }
            } label: {
                HStack {
                    if isConfirmingMFA {
                        ProgressView()
                            .tint(BrandTheme.ctaLabelOnGold)
                    }
                    Text(isConfirmingMFA ? "Confirming…" : "Confirm and enable MFA")
                        .frame(maxWidth: .infinity)
                }
                .frame(minHeight: 48)
            }
            .buttonStyle(.borderedProminent)
            .tint(BrandTheme.accent)
            .disabled(isConfirmingMFA || sanitizedTOTP(mfaVerifyCode).count < 6)
            .accessibilityHint("Verifies the code and activates two-factor authentication on your account")

            Button("Cancel setup") {
                self.mfaSetup = nil
                mfaVerifyCode = ""
                mfaError = nil
                mfaStatus = nil
            }
            .frame(minHeight: 44)
            .disabled(isConfirmingMFA || isEnablingMFA)
        } else if mfaEnabled {
            Label("MFA is enabled", systemImage: "checkmark.shield.fill")
                .foregroundStyle(BrandTheme.success)
                .font(.body.weight(.semibold))
                .frame(minHeight: 44)

            Text("You’ll be asked for an authenticator code when you sign in.")
                .font(.subheadline)
                .foregroundStyle(BrandTheme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)

            if showDisableMFA {
                SecureField("Authenticator code", text: $mfaDisableCode)
                    #if os(iOS)
                    .keyboardType(.numberPad)
                    .textContentType(.oneTimeCode)
                    #endif
                    .frame(minHeight: 44)
                    .accessibilityLabel("Code to disable MFA")

                if let mfaError {
                    Text(mfaError)
                        .font(.footnote)
                        .foregroundStyle(BrandTheme.destructive)
                        .fixedSize(horizontal: false, vertical: true)
                }

                HStack(spacing: 12) {
                    Button {
                        Task { await disableMFA() }
                    } label: {
                        if isDisablingMFA {
                            ProgressView()
                                .frame(maxWidth: .infinity, minHeight: 44)
                        } else {
                            Text("Disable MFA")
                                .frame(maxWidth: .infinity, minHeight: 44)
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(BrandTheme.destructive)
                    .disabled(isDisablingMFA || sanitizedTOTP(mfaDisableCode).count < 6)

                    Button("Cancel") {
                        showDisableMFA = false
                        mfaDisableCode = ""
                        mfaError = nil
                    }
                    .frame(minHeight: 44)
                    .disabled(isDisablingMFA)
                }
            } else {
                if let mfaStatus {
                    Text(mfaStatus)
                        .font(.footnote)
                        .foregroundStyle(BrandTheme.success)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Button("Disable MFA…") {
                    showDisableMFA = true
                    mfaError = nil
                    mfaStatus = nil
                }
                .frame(minHeight: 44)
                .foregroundStyle(BrandTheme.destructive)
            }
        } else {
            Text("Add a time-based authenticator (TOTP) for sign-in. You’ll scan or enter a secret, then confirm a 6-digit code to finish.")
                .font(.subheadline)
                .foregroundStyle(BrandTheme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)

            if let mfaStatus {
                Text(mfaStatus)
                    .font(.footnote)
                    .foregroundStyle(BrandTheme.success)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if let mfaError {
                Text(mfaError)
                    .font(.footnote)
                    .foregroundStyle(BrandTheme.destructive)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Button {
                Task { await enableMFA() }
            } label: {
                HStack {
                    if isEnablingMFA {
                        ProgressView()
                            .tint(BrandTheme.ctaLabelOnGold)
                    }
                    Text(isEnablingMFA ? "Starting MFA…" : "Enable MFA")
                        .frame(maxWidth: .infinity)
                }
                .frame(minHeight: 48)
            }
            .buttonStyle(.borderedProminent)
            .tint(BrandTheme.accent)
            .disabled(isEnablingMFA)
            .accessibilityHint("Requests a new authenticator secret and backup codes from the server")
        }
    }

    @ViewBuilder
    private func mfaSetupMaterial(_ setup: EnableMFAResponse) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            LabeledContent("Secret") {
                Text(setup.displaySecret)
                    .font(.caption.monospaced())
                    .foregroundStyle(BrandTheme.goldBright)
                    .textSelection(.enabled)
                    .multilineTextAlignment(.trailing)
            }
            .frame(minHeight: 44)

            if let url = setup.resolvedQRCodeURL {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Authenticator URL")
                        .font(.caption)
                        .foregroundStyle(BrandTheme.textSecondary)
                    Text(url.absoluteString)
                        .font(.caption2.monospaced())
                        .foregroundStyle(BrandTheme.textPrimary)
                        .textSelection(.enabled)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }

            if let codes = setup.backupCodes, !codes.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Backup codes")
                        .font(.caption)
                        .foregroundStyle(BrandTheme.textSecondary)
                    ForEach(codes, id: \.self) { code in
                        Text(code)
                            .font(.caption.monospaced())
                            .foregroundStyle(BrandTheme.textPrimary)
                            .textSelection(.enabled)
                    }
                    Text("Store these offline before confirming. Each code works once.")
                        .font(.caption2)
                        .foregroundStyle(BrandTheme.warning)
                }
            }
        }
    }

    @ViewBuilder
    private var ageStatusRow: some View {
        HStack(spacing: 12) {
            if isLoadingAge && ageStatus == nil {
                ProgressView()
                    .tint(BrandTheme.accent)
                Text("Checking age status…")
                    .foregroundStyle(BrandTheme.textSecondary)
            } else if ageStatus?.isVerified == true {
                Label("Verified", systemImage: "checkmark.seal.fill")
                    .foregroundStyle(BrandTheme.success)
                    .font(.body.weight(.semibold))
                Spacer()
                if let at = ageStatus?.verifiedAt, !at.isEmpty {
                    Text(CatalogDateFormat.friendlyDateTime(at))
                        .font(.caption)
                        .foregroundStyle(BrandTheme.textSecondary)
                }
            } else {
                Label("Not verified", systemImage: "exclamationmark.shield")
                    .foregroundStyle(BrandTheme.warning)
                Spacer()
                Text("Required · 18+")
                    .font(.caption)
                    .foregroundStyle(BrandTheme.textSecondary)
            }
        }
        .frame(minHeight: 44)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(ageStatus?.isVerified == true ? "Age verified" : "Age not verified")
    }

    private var canSubmitPassword: Bool {
        let current = currentPassword.trimmingCharacters(in: .whitespacesAndNewlines)
        let next = newPassword
        let confirm = confirmPassword
        guard !current.isEmpty, next.count >= 8, next == confirm, next != current else {
            return false
        }
        return true
    }

    private func sanitizedTOTP(_ raw: String) -> String {
        raw.filter(\.isNumber)
    }

    // MARK: - Connected accounts

    @ViewBuilder
    private var connectedAccountsSection: some View {
        if isLoadingOAuth && oauthAccounts.isEmpty {
            HStack {
                ProgressView()
                    .tint(BrandTheme.accent)
                Text("Loading connected accounts…")
                    .foregroundStyle(BrandTheme.textSecondary)
            }
            .frame(minHeight: 44)
        } else if let oauthLoadError {
            VStack(alignment: .leading, spacing: 8) {
                Text(oauthLoadError)
                    .font(.footnote)
                    .foregroundStyle(BrandTheme.destructive)
                    .fixedSize(horizontal: false, vertical: true)
                Button("Retry") {
                    Task { await loadOAuthAccounts() }
                }
                .frame(minHeight: 44)
            }
        } else if oauthAccounts.isEmpty {
            Text("No social accounts connected. You sign in with email and password (or Sign in with Apple / Google when you use them).")
                .font(.subheadline)
                .foregroundStyle(BrandTheme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                .accessibilityIdentifier("connectedAccounts.empty")
        } else {
            ForEach(oauthAccounts) { account in
                HStack(spacing: 12) {
                    Image(systemName: account.systemImage)
                        .foregroundStyle(BrandTheme.goldBright)
                        .frame(width: 28, height: 28)
                        .accessibilityHidden(true)

                    VStack(alignment: .leading, spacing: 2) {
                        Text(account.displayName)
                            .font(.body.weight(.semibold))
                            .foregroundStyle(BrandTheme.textPrimary)
                        if let email = account.email, !email.isEmpty {
                            Text(email)
                                .font(.caption)
                                .foregroundStyle(BrandTheme.textSecondary)
                                .lineLimit(1)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)

                    Button {
                        confirmUnlinkProvider = account.provider.lowercased()
                    } label: {
                        if unlinkingProvider == account.provider.lowercased() {
                            ProgressView()
                                .frame(minWidth: 88, minHeight: 44)
                        } else {
                            Text("Disconnect")
                                .frame(minWidth: 88, minHeight: 44)
                        }
                    }
                    .buttonStyle(.bordered)
                    .tint(BrandTheme.destructive)
                    .disabled(unlinkingProvider != nil)
                    .accessibilityLabel("Disconnect \(account.displayName)")
                    .accessibilityHint("Removes this social sign-in method. Blocked if it is your only way to sign in.")
                    .accessibilityIdentifier("connectedAccounts.unlink.\(account.provider.lowercased())")
                }
                .frame(minHeight: 44)
            }
        }

        if let oauthStatusMessage {
            Text(oauthStatusMessage)
                .font(.footnote)
                .foregroundStyle(BrandTheme.success)
                .fixedSize(horizontal: false, vertical: true)
        }
        if let oauthError {
            Text(oauthError)
                .font(.footnote)
                .foregroundStyle(BrandTheme.destructive)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isStaticText)
        }
    }

    // MARK: - Actions

    @MainActor
    private func loadOAuthAccounts() async {
        guard auth.isAuthenticated, !auth.isScaffoldSession else { return }
        isLoadingOAuth = true
        oauthLoadError = nil
        defer { isLoadingOAuth = false }
        do {
            oauthAccounts = try await APIClient.shared.fetchOAuthAccounts()
        } catch let error as APIClientError where error.isUnauthorized {
            needsSignIn = true
        } catch {
            oauthLoadError = error.localizedDescription
        }
    }

    @MainActor
    private func unlinkOAuth(_ provider: String) async {
        oauthError = nil
        oauthStatusMessage = nil
        let key = provider.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !key.isEmpty else { return }

        unlinkingProvider = key
        defer { unlinkingProvider = nil }

        do {
            let response = try await APIClient.shared.unlinkOAuthAccount(provider: key)
            if response.didUnlink {
                let priorLabel = oauthAccounts.first(where: { $0.provider.lowercased() == key })?.displayName
                    ?? key.capitalized
                oauthAccounts.removeAll { $0.provider.lowercased() == key }
                oauthStatusMessage = "\(priorLabel) account disconnected."
                // Refresh to stay in sync with the server.
                await loadOAuthAccounts()
            } else {
                oauthError = "Could not disconnect that account. Try again."
            }
        } catch let error as APIClientError where error.isUnauthorized {
            needsSignIn = true
        } catch let error as APIClientError where error.isConflict {
            // Gateway 409: only remaining sign-in method (lockout prevention).
            let detail = error.localizedDescription
            oauthError = detail.isEmpty
                ? "Cannot disconnect your only sign-in method — set a password first, or link another account."
                : detail
        } catch {
            oauthError = error.localizedDescription
        }
    }

    @MainActor
    private func loadAgeStatus() async {
        guard auth.isAuthenticated, !auth.isScaffoldSession else { return }
        isLoadingAge = true
        defer { isLoadingAge = false }
        do {
            ageStatus = try await APIClient.shared.fetchAgeStatus()
        } catch let error as APIClientError where error.isUnauthorized {
            needsSignIn = true
        } catch {
            // Non-blocking — password / MFA still work if age endpoint fails.
            ageStatus = AgeStatus(verified: false, verifiedAt: nil)
        }
    }

    @MainActor
    private func loadMFAProfile() async {
        guard auth.isAuthenticated, !auth.isScaffoldSession else { return }
        isLoadingMFAProfile = true
        defer { isLoadingMFAProfile = false }
        do {
            let profile = try await APIClient.shared.fetchMe()
            mfaEnabled = profile.mfaEnabled == true
        } catch let error as APIClientError where error.isUnauthorized {
            needsSignIn = true
        } catch {
            // Leave mfaEnabled as-is; enable flow still works without profile.
        }
    }

    @MainActor
    private func submitAge() async {
        ageError = nil
        ageStatusMessage = nil

        if let years = AgeGateMath.ageYears(dob: dobDate), years < AgeGateMath.minimumAgeYears {
            ageError = "You must be at least \(AgeGateMath.minimumAgeYears) to use NoMarkup."
            return
        }

        isSubmittingAge = true
        defer { isSubmittingAge = false }

        do {
            let response = try await APIClient.shared.setDateOfBirth(AgeGateMath.yyyyMMdd(dobDate))
            if response.isVerified {
                ageStatus = AgeStatus(verified: true, verifiedAt: ISO8601DateFormatter().string(from: Date()))
                ageStatusMessage = "Age verified."
                NotificationCenter.default.post(name: .noMarkupAgeVerified, object: nil)
            } else {
                ageStatusMessage = "Age recorded."
                await loadAgeStatus()
            }
        } catch let error as APIClientError where error.isUnauthorized {
            needsSignIn = true
        } catch {
            ageError = error.localizedDescription
        }
    }

    @MainActor
    private func enableMFA() async {
        mfaError = nil
        mfaStatus = nil
        isEnablingMFA = true
        defer { isEnablingMFA = false }

        do {
            let response = try await APIClient.shared.enableMFA()
            mfaSetup = response
            mfaVerifyCode = ""
            if response.hasSetupMaterial {
                mfaStatus = "Add the secret to your authenticator app, then enter a 6-digit code below to finish."
            } else {
                mfaError = "MFA enable succeeded, but no secret was returned. Try again."
            }
        } catch let error as APIClientError where error.isUnauthorized {
            needsSignIn = true
        } catch {
            mfaError = error.localizedDescription
        }
    }

    @MainActor
    private func confirmMFASetup() async {
        guard let setup = mfaSetup else { return }
        mfaError = nil
        mfaStatus = nil
        let code = sanitizedTOTP(mfaVerifyCode)
        guard code.count >= 6 else {
            mfaError = "Enter the 6-digit code from your authenticator app."
            return
        }

        isConfirmingMFA = true
        defer { isConfirmingMFA = false }

        do {
            _ = try await APIClient.shared.confirmMFASetup(
                totpCode: code,
                backupCodes: setup.resolvedBackupCodes
            )
            mfaSetup = nil
            mfaVerifyCode = ""
            mfaEnabled = true
            showDisableMFA = false
            mfaStatus = "Two-factor authentication is enabled."
        } catch let error as APIClientError where error.isUnauthorized {
            needsSignIn = true
        } catch {
            mfaError = error.localizedDescription
        }
    }

    @MainActor
    private func disableMFA() async {
        mfaError = nil
        mfaStatus = nil
        let code = sanitizedTOTP(mfaDisableCode)
        guard code.count >= 6 else {
            mfaError = "Enter your current authenticator code to disable MFA."
            return
        }

        isDisablingMFA = true
        defer { isDisablingMFA = false }

        do {
            _ = try await APIClient.shared.disableMFA(totpCode: code)
            mfaEnabled = false
            showDisableMFA = false
            mfaDisableCode = ""
            mfaStatus = "Two-factor authentication has been disabled."
        } catch let error as APIClientError where error.isUnauthorized {
            needsSignIn = true
        } catch {
            mfaError = error.localizedDescription
        }
    }

    @MainActor
    private func changePassword() async {
        errorMessage = nil
        statusMessage = nil

        let current = currentPassword
        let next = newPassword
        let confirm = confirmPassword

        guard !current.isEmpty else {
            errorMessage = "Enter your current password."
            return
        }
        guard next.count >= 8 else {
            errorMessage = "New password must be at least 8 characters."
            return
        }
        guard next == confirm else {
            errorMessage = "New password and confirmation do not match."
            return
        }
        guard next != current else {
            errorMessage = "New password must be different from your current password."
            return
        }

        isChangingPassword = true
        defer { isChangingPassword = false }

        do {
            _ = try await APIClient.shared.changePassword(current: current, new: next)
            currentPassword = ""
            newPassword = ""
            confirmPassword = ""
            statusMessage = "Password updated. Other sessions may be signed out."
        } catch let error as APIClientError where error.isUnauthorized {
            // Wrong current password also surfaces as 401 from gateway.
            let detail = error.localizedDescription
            if detail.localizedCaseInsensitiveContains("current password")
                || detail.localizedCaseInsensitiveContains("incorrect") {
                errorMessage = "Current password is incorrect."
            } else {
                needsSignIn = true
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

#Preview {
    NavigationStack {
        SecuritySettingsView()
    }
    .environmentObject(AuthViewModel())
    .environmentObject(FeatureFlags())
    .preferredColorScheme(.dark)
    .tint(BrandTheme.accent)
}
