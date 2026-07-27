import SwiftUI

/// Notification channel preferences — globals (read) + per-type rows when the server returns them.
struct NotificationPreferencesView: View {
    @EnvironmentObject private var auth: AuthViewModel

    @State private var response: NotificationPreferencesResponse?
    @State private var editableRows: [NotificationPreferenceRow] = []
    @State private var isLoading = false
    @State private var isSaving = false
    @State private var errorMessage: String?
    @State private var statusMessage: String?
    @State private var needsSignIn = false

    var body: some View {
        Group {
            if auth.isScaffoldSession {
                BrandEmptyState(
                    title: "Sign in required",
                    systemImage: "bell.badge",
                    message: "Browse-only mode has no API credentials. Sign in to manage notification preferences.",
                    actionTitle: "Sign out to log in",
                    action: { auth.signOut() }
                )
            } else if needsSignIn || !auth.isAuthenticated {
                BrandEmptyState(
                    title: "Sign in required",
                    systemImage: "lock.circle",
                    message: "Sign in to choose push, email, and in-app notification channels.",
                    actionTitle: "Sign in",
                    action: { auth.signOut() }
                )
            } else if isLoading && response == nil {
                ProgressView("Loading preferences…")
                    .tint(BrandTheme.accent)
                    .foregroundStyle(BrandTheme.textSecondary)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .brandScreenBackground()
            } else if let errorMessage, response == nil {
                BrandEmptyState(
                    title: "Couldn’t load preferences",
                    systemImage: "wifi.exclamationmark",
                    message: errorMessage,
                    actionTitle: "Try again",
                    action: { Task { await load() } }
                )
            } else {
                formContent
            }
        }
        .navigationTitle("Notifications")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbarBackground(BrandTheme.navy, for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
        .task { await load() }
        .refreshable { await load() }
    }

    private var formContent: some View {
        Form {
            Section {
                Toggle("Push notifications", isOn: globalPushBinding)
                    .frame(minHeight: 44)
                    .disabled(true)
                    .accessibilityHint("Global push is set by the server; per-type rows below can be edited when present")

                Toggle("Email notifications", isOn: globalEmailBinding)
                    .frame(minHeight: 44)
                    .disabled(true)
                    .accessibilityHint("Global email is set by the server; per-type rows below can be edited when present")
            } header: {
                Text("Global").brandSectionHeader()
            } footer: {
                Text(
                    editableRows.isEmpty
                        ? "Per-type prefs appear when server returns rows"
                        : "Global channels are server-managed. Edit per-type rows below, then save."
                )
                .foregroundStyle(BrandTheme.textSecondary)
            }

            if editableRows.isEmpty {
                Section {
                    Text("Per-type prefs appear when server returns rows")
                        .font(.subheadline)
                        .foregroundStyle(BrandTheme.textSecondary)
                        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                } header: {
                    Text("By type").brandSectionHeader()
                }
            } else {
                ForEach(Array(editableRows.enumerated()), id: \.element.id) { index, row in
                    Section {
                        Toggle("Push", isOn: binding(for: index, keyPath: \.pushEnabled))
                            .frame(minHeight: 44)
                        Toggle("Email", isOn: binding(for: index, keyPath: \.emailEnabled))
                            .frame(minHeight: 44)
                        Toggle("In-app", isOn: binding(for: index, keyPath: \.inAppEnabled))
                            .frame(minHeight: 44)
                    } header: {
                        Text(row.displayType).brandSectionHeader()
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

            if let errorMessage, response != nil {
                Section {
                    Text(errorMessage)
                        .font(.footnote)
                        .foregroundStyle(BrandTheme.destructive)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }

            if !editableRows.isEmpty {
                Section {
                    Button {
                        Task { await save() }
                    } label: {
                        HStack {
                            if isSaving {
                                ProgressView()
                                    .tint(BrandTheme.ctaLabelOnGold)
                            }
                            Text(isSaving ? "Saving…" : "Save preferences")
                                .frame(maxWidth: .infinity)
                        }
                        .frame(minHeight: 48)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(BrandTheme.accent)
                    .disabled(isSaving)
                    .accessibilityHint("Updates per-type notification channels on the server")
                }
            }
        }
        .brandListBackground()
        .tint(BrandTheme.accent)
    }

    private var globalPushBinding: Binding<Bool> {
        Binding(
            get: { response?.globalPushEnabled ?? true },
            set: { _ in }
        )
    }

    private var globalEmailBinding: Binding<Bool> {
        Binding(
            get: { response?.globalEmailEnabled ?? true },
            set: { _ in }
        )
    }

    private func binding(for index: Int, keyPath: WritableKeyPath<NotificationPreferenceRow, Bool>) -> Binding<Bool> {
        Binding(
            get: {
                guard editableRows.indices.contains(index) else { return false }
                return editableRows[index][keyPath: keyPath]
            },
            set: { newValue in
                guard editableRows.indices.contains(index) else { return }
                editableRows[index][keyPath: keyPath] = newValue
            }
        )
    }

    @MainActor
    private func load() async {
        guard auth.isAuthenticated, !auth.isScaffoldSession else { return }
        isLoading = true
        errorMessage = nil
        needsSignIn = false
        defer { isLoading = false }

        do {
            let loaded = try await APIClient.shared.fetchNotificationPreferences()
            response = loaded
            editableRows = loaded.preferences
            statusMessage = nil
        } catch let error as APIClientError where error.isUnauthorized {
            needsSignIn = true
            response = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    @MainActor
    private func save() async {
        errorMessage = nil
        statusMessage = nil
        isSaving = true
        defer { isSaving = false }

        do {
            let updated = try await APIClient.shared.updateNotificationPreferences(preferences: editableRows)
            response = updated
            if !updated.preferences.isEmpty {
                editableRows = updated.preferences
            }
            statusMessage = "Preferences saved."
        } catch let error as APIClientError where error.isUnauthorized {
            needsSignIn = true
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

#Preview {
    NavigationStack {
        NotificationPreferencesView()
    }
    .environmentObject(AuthViewModel())
    .preferredColorScheme(.dark)
    .tint(BrandTheme.accent)
}
