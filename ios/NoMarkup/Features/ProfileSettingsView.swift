import SwiftUI

/// Profile editor — `GET/PATCH /api/v1/users/me`.
/// Display name is editable; email is read-only (auth lookup identity).
struct ProfileSettingsView: View {
    @EnvironmentObject private var auth: AuthViewModel
    @Environment(\.dismiss) private var dismiss

    @State private var profile: UserProfile?
    @State private var displayName = ""
    @State private var isLoading = false
    @State private var isSaving = false
    @State private var isEnablingProvider = false
    @State private var errorMessage: String?
    @State private var statusMessage: String?
    @State private var needsSignIn = false

    var body: some View {
        Group {
            if auth.isScaffoldSession {
                BrandEmptyState(
                    title: "Sign in required",
                    systemImage: "person.crop.circle.badge.exclamationmark",
                    message: "Browse-only mode has no API token. Sign in with a real account to edit your profile.",
                    actionTitle: "Sign out to log in",
                    action: { auth.signOut() }
                )
            } else if needsSignIn {
                BrandEmptyState(
                    title: "Sign in required",
                    systemImage: "lock.circle",
                    message: "Your session expired. Sign in again to manage profile settings.",
                    actionTitle: "Sign in",
                    action: { auth.signOut() }
                )
            } else if isLoading && profile == nil {
                BrandLoadingScreen(kind: .form, accessibilityLabel: "Loading profile…")
            } else if let errorMessage, profile == nil {
                BrandEmptyState(
                    title: "Couldn’t load profile",
                    systemImage: "wifi.exclamationmark",
                    message: errorMessage,
                    actionTitle: "Try again",
                    action: { Task { await load() } }
                )
            } else {
                formContent
            }
        }
        .navigationTitle("Profile")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .brandNavigationBarChrome()
        .task { await load() }
    }

    private var formContent: some View {
        Form {
            Section {
                TextField("Display name", text: $displayName, prompt: Text("How you appear to others"))
                    .textInputAutocapitalization(.words)
                    .autocorrectionDisabled(false)
                    .foregroundStyle(BrandTheme.textPrimary)
                    .frame(minHeight: 44)
                    .accessibilityLabel("Display name")

                if let email = profile?.email, !email.isEmpty {
                    LabeledContent("Email") {
                        Text(email)
                            .foregroundStyle(BrandTheme.textSecondary)
                            .textSelection(.enabled)
                    }
                    .frame(minHeight: 44)
                    .accessibilityHint("Email is used to sign in and cannot be changed here")
                } else if let authEmail = displayEmail {
                    LabeledContent("Email") {
                        Text(authEmail)
                            .foregroundStyle(BrandTheme.textSecondary)
                    }
                    .frame(minHeight: 44)
                }
            } header: {
                Text("Identity").brandSectionHeader()
            } footer: {
                Text("Display name is public on bids and chat. Email stays private for sign-in.")
                    .foregroundStyle(BrandTheme.textSecondary)
            }

            if let profile {
                Section {
                    if let status = profile.status, !status.isEmpty {
                        LabeledContent("Status", value: StatusChipStyle.displayLabel(status))
                    }
                    if let roles = profile.roles, !roles.isEmpty {
                        LabeledContent("Roles", value: roles.joined(separator: ", ").capitalized)
                    } else {
                        LabeledContent("Roles", value: "Customer")
                    }
                    if let created = profile.createdAt, !created.isEmpty {
                        LabeledContent("Member since", value: CatalogDateFormat.friendlyDateTime(created))
                    }
                    LabeledContent("User ID") {
                        Text(shortID(profile.id))
                            .font(.caption.monospaced())
                            .foregroundStyle(BrandTheme.textSecondary)
                            .textSelection(.enabled)
                    }
                } header: {
                    Text("Account").brandSectionHeader()
                }

                if !profile.hasProviderRole {
                    Section {
                        Text(
                            "Customers can bid and buy. Enabling the provider role lets you bid on service jobs and complete reverse-auction contracts."
                        )
                        .font(.footnote)
                        .foregroundStyle(BrandTheme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)

                        Button {
                            Task { await enableProviderRole() }
                        } label: {
                            HStack {
                                if isEnablingProvider {
                                    ProgressView()
                                        .tint(BrandTheme.ctaLabelOnGold)
                                }
                                Text(isEnablingProvider ? "Enabling…" : "Enable provider role")
                                    .frame(maxWidth: .infinity)
                            }
                            .frame(minHeight: 48)
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(BrandTheme.accent)
                        .foregroundStyle(BrandTheme.ctaLabelOnGold)
                        .disabled(isEnablingProvider || isSaving)
                        .accessibilityHint("Adds the provider role so you can bid on service jobs")
                    } header: {
                        Text("Provider").brandSectionHeader()
                    } footer: {
                        Text("Self-service only grants customer or provider. Admin cannot be self-assigned.")
                            .foregroundStyle(BrandTheme.textSecondary)
                    }
                }
            }

            if let statusMessage {
                Section {
                    Text(statusMessage)
                        .font(.footnote)
                        .foregroundStyle(BrandTheme.success)
                }
            }

            if let errorMessage, profile != nil {
                Section {
                    Text(errorMessage)
                        .font(.footnote)
                        .foregroundStyle(BrandTheme.destructive)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }

            Section {
                Button {
                    Task { await save() }
                } label: {
                    HStack {
                        if isSaving {
                            ProgressView()
                                .tint(BrandTheme.ctaLabelOnGold)
                        }
                        Text("Save changes")
                            .frame(maxWidth: .infinity)
                    }
                    .frame(minHeight: 48)
                }
                .buttonStyle(.borderedProminent)
                .tint(BrandTheme.accent)
                .foregroundStyle(BrandTheme.ctaLabelOnGold)
                .disabled(!canSave || isSaving)
                .accessibilityHint("Updates your display name on the server")
            }
        }
        .brandListBackground()
        .scrollDismissesKeyboard(.interactively)
    }

    private var displayEmail: String? {
        let fromAuth = auth.email.trimmingCharacters(in: .whitespacesAndNewlines)
        return fromAuth.isEmpty ? nil : fromAuth
    }

    private var canSave: Bool {
        let trimmed = displayName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, trimmed.count <= 80 else { return false }
        let original = profile?.displayName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return trimmed != original && !isSaving
    }

    private func shortID(_ id: String) -> String {
        if id.count <= 12 { return id }
        return String(id.prefix(8)) + "…"
    }

    @MainActor
    private func load() async {
        if auth.isScaffoldSession {
            profile = nil
            return
        }

        isLoading = true
        errorMessage = nil
        needsSignIn = false
        defer { isLoading = false }

        do {
            let me = try await APIClient.shared.fetchMe()
            profile = me
            displayName = me.displayName ?? ""
            if let email = me.email, !email.isEmpty, auth.email.isEmpty {
                auth.email = email
            }
        } catch let error as APIClientError where error.isUnauthorized {
            needsSignIn = true
            profile = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    @MainActor
    private func save() async {
        errorMessage = nil
        statusMessage = nil

        let trimmed = displayName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            errorMessage = "Display name cannot be empty."
            return
        }
        guard trimmed.count <= 80 else {
            errorMessage = "Display name must be at most 80 characters."
            return
        }

        isSaving = true
        defer { isSaving = false }

        do {
            let updated = try await APIClient.shared.updateMe(displayName: trimmed)
            profile = updated
            displayName = updated.displayName ?? trimmed
            statusMessage = "Profile saved."
        } catch let error as APIClientError where error.isUnauthorized {
            needsSignIn = true
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    /// POST `/api/v1/users/me/roles` with `{ "role": "provider" }`.
    @MainActor
    private func enableProviderRole() async {
        errorMessage = nil
        statusMessage = nil

        guard !auth.isScaffoldSession else {
            errorMessage = "Browse-only mode cannot change roles."
            return
        }
        guard !(profile?.hasProviderRole ?? false) else {
            statusMessage = "Provider role is already enabled."
            return
        }

        isEnablingProvider = true
        defer { isEnablingProvider = false }

        do {
            let updated = try await APIClient.shared.enableRole("provider")
            profile = updated
            if let name = updated.displayName, !name.isEmpty {
                displayName = name
            }
            statusMessage = "Provider role enabled. You can bid on service jobs."
        } catch let error as APIClientError where error.isUnauthorized {
            needsSignIn = true
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

#Preview {
    NavigationStack {
        ProfileSettingsView()
    }
    .environmentObject(AuthViewModel())
    .preferredColorScheme(.dark)
    .tint(BrandTheme.accent)
}
