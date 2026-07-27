import SwiftUI

/// Security settings — change password, full MFA setup/confirm/disable, age verification.
struct SecuritySettingsView: View {
    @EnvironmentObject private var auth: AuthViewModel

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
        .toolbarBackground(.visible, for: .navigationBar)
        .task {
            await loadAgeStatus()
            await loadMFAProfile()
        }
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
                mfaSectionBody
            } header: {
                Text("Two-factor authentication").brandSectionHeader()
            } footer: {
                Text("Use an authenticator app (1Password, Authy, Google Authenticator). Store backup codes offline — each works once.")
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

    // MARK: - Actions

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
    .preferredColorScheme(.dark)
    .tint(BrandTheme.accent)
}
