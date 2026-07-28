import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

/// Notification channel preferences — globals + per-type rows.
/// When the server returns an empty per-type list, seed product-relevant defaults (NT.1).
struct NotificationPreferencesView: View {
    @EnvironmentObject private var auth: AuthViewModel
    @EnvironmentObject private var push: PushRegistration

    @State private var response: NotificationPreferencesResponse?
    @State private var editableRows: [NotificationPreferenceRow] = []
    @State private var globalPushEnabled = true
    @State private var globalEmailEnabled = true
    @State private var isLoading = false
    @State private var isSaving = false
    @State private var errorMessage: String?
    @State private var statusMessage: String?
    @State private var needsSignIn = false

    /// Seeded when server returns no per-type rows (matches notification service defaults).
    private static let defaultPreferenceTypes: [String] = [
        "bid_outbid",
        "bid_awarded",
        "new_bid",
        "auction_closing_soon",
        "auction_closed",
        "price_drop",
        "contract_created",
        "contract_accepted",
        "new_message",
        "payment_received",
        "payment_released",
        "payment_failed",
        "seller_new_listing",
        "job_matched",
    ]

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
        .task { await load() }
        .refreshable { await load() }
    }

    private var formContent: some View {
        Form {
            Section {
                if push.isDenied {
                    Text(NotificationPermissionCopy.deniedStatus)
                        .font(.footnote)
                        .foregroundStyle(BrandTheme.warning)
                        .fixedSize(horizontal: false, vertical: true)
                    Button(NotificationPermissionCopy.openSettings) {
                        #if canImport(UIKit)
                        if let url = URL(string: UIApplication.openSettingsURLString) {
                            UIApplication.shared.open(url)
                        }
                        #endif
                    }
                    .frame(minHeight: 44)
                } else if !push.isAuthorized {
                    Button(NotificationPermissionCopy.enableFromSettings) {
                        push.requestFromSettings()
                    }
                    .frame(minHeight: 44)
                    .accessibilityHint("Explains bid alerts, then requests notification permission")
                }

                Toggle("Push notifications", isOn: globalPushBinding)
                    .frame(minHeight: 44)
                    .accessibilityHint("Turns push on or off for all notification types below")

                Toggle("Email notifications", isOn: globalEmailBinding)
                    .frame(minHeight: 44)
                    .accessibilityHint("Turns email on or off for all notification types below")
            } header: {
                Text("Global").brandSectionHeader()
            } footer: {
                Text("Global toggles update every per-type row. Save to apply on the server.")
                    .foregroundStyle(BrandTheme.textSecondary)
            }

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
                .foregroundStyle(BrandTheme.ctaLabelOnGold)
                .disabled(isSaving || editableRows.isEmpty)
                .accessibilityHint("Updates notification channels on the server")
            }
        }
        .brandListBackground()
        .tint(BrandTheme.accent)
    }

    private var globalPushBinding: Binding<Bool> {
        Binding(
            get: { globalPushEnabled },
            set: { newValue in
                globalPushEnabled = newValue
                for i in editableRows.indices {
                    editableRows[i].pushEnabled = newValue
                }
                if newValue, !push.isAuthorized {
                    push.requestFromSettings()
                }
            }
        )
    }

    private var globalEmailBinding: Binding<Bool> {
        Binding(
            get: { globalEmailEnabled },
            set: { newValue in
                globalEmailEnabled = newValue
                for i in editableRows.indices {
                    editableRows[i].emailEnabled = newValue
                }
            }
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
                // Keep global push in sync with all-row consensus.
                if keyPath == \.pushEnabled {
                    globalPushEnabled = editableRows.allSatisfy(\.pushEnabled)
                }
                if keyPath == \.emailEnabled {
                    globalEmailEnabled = editableRows.allSatisfy(\.emailEnabled)
                }
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
            if loaded.preferences.isEmpty {
                editableRows = Self.seededDefaultRows()
            } else {
                editableRows = loaded.preferences
            }
            globalPushEnabled = loaded.globalPushEnabled
                ?? (editableRows.isEmpty ? true : editableRows.contains(where: \.pushEnabled))
            globalEmailEnabled = loaded.globalEmailEnabled
                ?? (editableRows.isEmpty ? true : editableRows.contains(where: \.emailEnabled))
            statusMessage = nil
            await push.refreshAuthorizationStatus()
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
            globalPushEnabled = updated.globalPushEnabled
                ?? editableRows.contains(where: \.pushEnabled)
            globalEmailEnabled = updated.globalEmailEnabled
                ?? editableRows.contains(where: \.emailEnabled)
            statusMessage = "Preferences saved."
        } catch let error as APIClientError where error.isUnauthorized {
            needsSignIn = true
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private static func seededDefaultRows() -> [NotificationPreferenceRow] {
        defaultPreferenceTypes.map { type in
            NotificationPreferenceRow(
                notificationType: type,
                pushEnabled: true,
                emailEnabled: Self.defaultEmail(for: type),
                smsEnabled: false,
                inAppEnabled: true
            )
        }
    }

    private static func defaultEmail(for type: String) -> Bool {
        switch type {
        case "bid_awarded", "contract_created", "contract_accepted",
             "payment_received", "payment_released", "payment_failed":
            return true
        default:
            return false
        }
    }
}

#Preview {
    NavigationStack {
        NotificationPreferencesView()
    }
    .environmentObject(AuthViewModel())
    .environmentObject(PushRegistration.shared)
    .preferredColorScheme(.dark)
    .tint(BrandTheme.accent)
}
