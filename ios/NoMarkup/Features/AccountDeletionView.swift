import SwiftUI

/// Account deletion entry (App Store Guideline 5.1.1(v)).
/// Confirms intent in-app; full 30-day grace flow is server-side (web already has it).
struct AccountDeletionView: View {
    @EnvironmentObject private var auth: AuthViewModel
    @Environment(\.dismiss) private var dismiss

    @State private var confirmPhrase = ""
    @State private var acknowledge = false
    @State private var isSubmitting = false
    @State private var resultMessage: String?
    @State private var resultIsError = false

    private let requiredPhrase = "DELETE"

    var body: some View {
        Form {
            Section {
                Text("Requesting deletion schedules permanent removal of your NoMarkup account after a grace period (typically 30 days on the server). You can cancel during the grace window on web or a future app build.")
                    .font(.subheadline)
                    .foregroundStyle(BrandTheme.textSecondary)
            } header: {
                Text("What happens").brandSectionHeader()
            }

            Section {
                Toggle("I understand this cannot be undone after the grace period ends.", isOn: $acknowledge)
                    .frame(minHeight: 44)
                TextField("Type \(requiredPhrase) to confirm", text: $confirmPhrase)
                    .textInputAutocapitalization(.characters)
                    .autocorrectionDisabled()
                    .foregroundStyle(BrandTheme.textPrimary)
                    .frame(minHeight: 44)
            } header: {
                Text("Confirm").brandSectionHeader()
            }

            Section {
                Button(role: .destructive) {
                    Task {
                        let ok = await BiometricGate.authenticateIfRequired(
                            reason: "Confirm account deletion with \(BiometricGate.biometryDisplayName)."
                        )
                        guard ok else {
                            resultIsError = true
                            resultMessage = "Authentication canceled — deletion was not requested."
                            return
                        }
                        await submitDeletionRequest()
                    }
                } label: {
                    HStack {
                        if isSubmitting {
                            ProgressView()
                                .tint(BrandTheme.destructive)
                        }
                        Text("Request account deletion")
                            .frame(maxWidth: .infinity)
                    }
                    .frame(minHeight: 48)
                }
                .disabled(!canSubmit || isSubmitting)
            }

            if let resultMessage {
                Section {
                    Text(resultMessage)
                        .font(.footnote)
                        .foregroundStyle(resultIsError ? BrandTheme.destructive : BrandTheme.textSecondary)
                }
            }

            Section {
                Link("Open web account settings", destination: AppConfig.publicWebBaseURL.appending(path: "settings/account"))
                Link("Privacy Policy", destination: AppConfig.privacyURL)
            } header: {
                Text("Also available").brandSectionHeader()
            }
        }
        .brandListBackground()
        .navigationTitle("Delete Account")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbarBackground(BrandTheme.navy, for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
        .tint(BrandTheme.accent)
    }

    private var canSubmit: Bool {
        acknowledge && confirmPhrase.trimmingCharacters(in: .whitespacesAndNewlines).uppercased() == requiredPhrase
    }

    private func submitDeletionRequest() async {
        resultMessage = nil
        resultIsError = false
        isSubmitting = true
        defer { isSubmitting = false }

        // Stage B: POST account-deletion schedule endpoint with Bearer token.
        // Scaffold: do not fake a successful server deletion when offline.
        if auth.isScaffoldSession {
            resultIsError = true
            resultMessage =
                "Browse-only mode has no API credentials. Sign in against a live gateway, or use web Settings → Account to request deletion."
            return
        }

        do {
            // Gateway: DELETE /api/v1/users/me  body { reason, confirmation: "DELETE" }
            try await APIClient.shared.requestAccountDeletion(reason: "user_requested_ios")
            resultIsError = false
            resultMessage = "Deletion request accepted. You will be signed out. You can restore within 30 days via web or app."
            auth.signOut()
            dismiss()
        } catch {
            resultIsError = true
            resultMessage = error.localizedDescription
        }
    }
}

#Preview {
    NavigationStack {
        AccountDeletionView()
            .environmentObject(AuthViewModel())
    }
}
