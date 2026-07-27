import SwiftUI

/// Security settings — change password, MFA enable setup, age verification status.
struct SecuritySettingsView: View {
    @EnvironmentObject private var auth: AuthViewModel

    @State private var currentPassword = ""
    @State private var newPassword = ""
    @State private var confirmPassword = ""

    @State private var ageStatus: AgeStatus?
    @State private var isLoadingAge = false
    @State private var isChangingPassword = false
    @State private var errorMessage: String?
    @State private var statusMessage: String?
    @State private var needsSignIn = false

    @State private var mfaSetup: EnableMFAResponse?
    @State private var isEnablingMFA = false
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
                    message: "Your session expired. Sign in again to change your password or view age status.",
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
        .task { await loadAgeStatus() }
    }

    private var formContent: some View {
        Form {
            Section {
                ageStatusRow
            } header: {
                Text("Age verification").brandSectionHeader()
            } footer: {
                Text("Age is verified once on the server. NoMarkup never shows your date of birth here.")
                    .foregroundStyle(BrandTheme.textSecondary)
            }

            Section {
                if let mfaSetup, mfaSetup.hasSetupMaterial {
                    mfaSetupMaterial(mfaSetup)
                } else {
                    Text("Add a time-based authenticator (TOTP) for sign-in. You’ll confirm the code on the next step after enabling.")
                        .font(.subheadline)
                        .foregroundStyle(BrandTheme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }

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
                        Text(isEnablingMFA ? "Starting MFA…" : (mfaSetup == nil ? "Enable MFA" : "Regenerate MFA secret"))
                            .frame(maxWidth: .infinity)
                    }
                    .frame(minHeight: 48)
                }
                .buttonStyle(.borderedProminent)
                .tint(BrandTheme.accent)
                .disabled(isEnablingMFA)
                .accessibilityHint("Requests a new authenticator secret and backup codes from the server")
            } header: {
                Text("Two-factor authentication").brandSectionHeader()
            } footer: {
                Text("After enabling, add the secret to your authenticator app. Complete setup by verifying a code on the web if this app does not prompt for it yet.")
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
                    Text("Store these offline. Each code works once.")
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
                Text("Complete on web if needed")
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
            // Non-blocking — password change still works if age endpoint fails.
            ageStatus = AgeStatus(verified: false, verifiedAt: nil)
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
            if response.hasSetupMaterial {
                mfaStatus = "MFA secret ready. Add it to your authenticator app, then verify setup when prompted."
            } else {
                mfaStatus = "MFA enable succeeded, but no secret was returned. Try again or complete setup on the web."
            }
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
