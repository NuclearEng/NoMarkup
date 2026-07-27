import SwiftUI

/// Security settings — change password + age verification status.
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
