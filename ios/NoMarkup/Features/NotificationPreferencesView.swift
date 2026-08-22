import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

/// Notification channel preferences — globals + per-type rows.
/// When the server returns an empty per-type list, seed product-relevant defaults (NT.1).
///
/// FR-17.3: critical types (payment failures, disputes, guarantee) cannot be disabled.
struct NotificationPreferencesView: View {
    @EnvironmentObject private var auth: AuthViewModel
    @EnvironmentObject private var push: PushRegistration

    @State private var response: NotificationPreferencesResponse?
    @State private var editableRows: [NotificationPreferenceRow] = []
    @State private var globalPushEnabled = true
    @State private var globalEmailEnabled = true
    /// ASR-4.5.4 — explicit in-app opt-in. Enabling consent turns marketing
    /// push types on; disabling it forces them off. Global Push never grants this.
    @State private var marketingConsent = false
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
        "dispute_opened",
        "dispute_resolved",
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
                BrandLoadingScreen(kind: .form, accessibilityLabel: "Loading preferences…")
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
        .navigationTitle("Notification preferences")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .brandNavigationBarChrome()
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
                    .accessibilityHint("Turns push on or off for transactional types. Does not enable marketing alerts.")

                Toggle("Email notifications", isOn: globalEmailBinding)
                    .frame(minHeight: 44)
                    .accessibilityHint("Turns email on or off for non-critical notification types below")
            } header: {
                Text("Global").brandSectionHeader()
            } footer: {
                Text(
                    "Global Push updates transactional types only. Payment failures, disputes, and guarantee alerts stay on (FR-17.3). Marketing push stays off unless you opt in below. Save to apply on the server."
                )
                .foregroundStyle(BrandTheme.textSecondary)
            }

            Section {
                Toggle(NotificationPermissionCopy.marketingConsentTitle, isOn: marketingConsentBinding)
                    .frame(minHeight: 44)
                    .accessibilityIdentifier("notifications.marketingConsent")
                    .accessibilityHint("Optional. Enables promotional push types; not required to use the app.")
            } header: {
                Text("Marketing").brandSectionHeader()
            } footer: {
                Text(NotificationPermissionCopy.marketingConsentBody)
                    .foregroundStyle(BrandTheme.textSecondary)
            }

            ForEach(Array(editableRows.enumerated()), id: \.element.id) { index, row in
                let critical = Self.isCriticalNotificationType(row.notificationType)
                let marketing = Self.isMarketingNotificationType(row.notificationType)
                Section {
                    Toggle("Push", isOn: binding(for: index, keyPath: \.pushEnabled))
                        .frame(minHeight: 44)
                        .disabled(critical || (marketing && !marketingConsent))
                    Toggle("Email", isOn: binding(for: index, keyPath: \.emailEnabled))
                        .frame(minHeight: 44)
                        .disabled(critical)
                    Toggle("In-app", isOn: binding(for: index, keyPath: \.inAppEnabled))
                        .frame(minHeight: 44)
                        .disabled(critical)
                } header: {
                    HStack(spacing: 8) {
                        Text(row.displayType).brandSectionHeader()
                        if critical {
                            Text("Required")
                                .font(.caption2.weight(.semibold))
                                .foregroundStyle(BrandTheme.goldBright)
                                .padding(.horizontal, 8)
                                .padding(.vertical, 2)
                                .background(BrandTheme.navyElevated, in: Capsule())
                                .accessibilityLabel("Required — cannot turn off")
                        }
                    }
                } footer: {
                    if critical {
                        Text("Critical alerts cannot be turned off.")
                            .foregroundStyle(BrandTheme.textSecondary)
                    } else if marketing && !marketingConsent {
                        Text("Turn on Marketing and recommendations above to enable this promotional push.")
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
                    let type = editableRows[i].notificationType
                    if Self.isCriticalNotificationType(type) {
                        editableRows[i].pushEnabled = true
                    } else if Self.isMarketingNotificationType(type) {
                        // ASR-4.5.4 — global Push must not grant marketing.
                        editableRows[i].pushEnabled = newValue && marketingConsent
                    } else {
                        editableRows[i].pushEnabled = newValue
                    }
                }
                if newValue, !push.isAuthorized {
                    push.requestFromSettings()
                }
            }
        )
    }

    private var marketingConsentBinding: Binding<Bool> {
        Binding(
            get: { marketingConsent },
            set: { newValue in
                marketingConsent = newValue
                applyMarketingPush(enabled: newValue)
            }
        )
    }

    private var globalEmailBinding: Binding<Bool> {
        Binding(
            get: { globalEmailEnabled },
            set: { newValue in
                globalEmailEnabled = newValue
                for i in editableRows.indices {
                    if Self.isCriticalNotificationType(editableRows[i].notificationType) {
                        editableRows[i].emailEnabled = true
                    } else {
                        editableRows[i].emailEnabled = newValue
                    }
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
                let type = editableRows[index].notificationType
                if Self.isCriticalNotificationType(type), newValue == false {
                    // FR-17.3 — ignore disable attempts for critical types.
                    editableRows[index][keyPath: keyPath] = true
                    return
                }
                if keyPath == \.pushEnabled,
                   Self.isMarketingNotificationType(type),
                   !marketingConsent {
                    // ASR-4.5.4 — marketing push requires dedicated consent.
                    editableRows[index].pushEnabled = false
                    return
                }
                editableRows[index][keyPath: keyPath] = newValue
                // Global Push tracks transactional rows only (critical always on; marketing is gated).
                if keyPath == \.pushEnabled {
                    globalPushEnabled = Self.transactionalPushConsensus(editableRows)
                }
                if keyPath == \.emailEnabled {
                    globalEmailEnabled = editableRows
                        .filter { !Self.isCriticalNotificationType($0.notificationType) }
                        .allSatisfy(\.emailEnabled)
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
                editableRows = Self.forceCriticalEnabled(loaded.preferences)
            }
            marketingConsent = Self.marketingConsent(from: editableRows)
            globalPushEnabled = loaded.globalPushEnabled
                ?? (editableRows.isEmpty ? true : Self.transactionalPushEnabled(editableRows))
            globalEmailEnabled = loaded.globalEmailEnabled
                ?? (editableRows.isEmpty ? true : editableRows
                    .filter { !Self.isCriticalNotificationType($0.notificationType) }
                    .contains(where: \.emailEnabled))
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

        // FR-17.3 — never send disabled critical prefs.
        let payload = Self.forceCriticalEnabled(editableRows)

        do {
            let updated = try await APIClient.shared.updateNotificationPreferences(preferences: payload)
            response = updated
            if !updated.preferences.isEmpty {
                editableRows = Self.forceCriticalEnabled(updated.preferences)
            } else {
                editableRows = payload
            }
            marketingConsent = Self.marketingConsent(from: editableRows)
            globalPushEnabled = updated.globalPushEnabled
                ?? Self.transactionalPushEnabled(editableRows)
            globalEmailEnabled = updated.globalEmailEnabled
                ?? editableRows
                    .filter { !Self.isCriticalNotificationType($0.notificationType) }
                    .contains(where: \.emailEnabled)
            statusMessage = "Preferences saved."
        } catch let error as APIClientError where error.isUnauthorized {
            needsSignIn = true
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    /// Product-relevant defaults when the server returns no per-type rows.
    /// Marketing types seed Push **off** (ASR-4.5.4); transactional types seed on.
    static func seededDefaultRows() -> [NotificationPreferenceRow] {
        forceCriticalEnabled(
            defaultPreferenceTypes.map { type in
                NotificationPreferenceRow(
                    notificationType: type,
                    pushEnabled: !isMarketingNotificationType(type),
                    emailEnabled: defaultEmail(for: type),
                    smsEnabled: false,
                    inAppEnabled: true
                )
            }
        )
    }

    private static func defaultEmail(for type: String) -> Bool {
        switch type {
        case "bid_awarded", "contract_created", "contract_accepted",
             "payment_received", "payment_released", "payment_failed",
             "dispute_opened", "dispute_resolved":
            return true
        default:
            return isCriticalNotificationType(type)
        }
    }

    /// FR-17.3 — payment failures, disputes, guarantee, account flags cannot be disabled.
    static func isCriticalNotificationType(_ type: String) -> Bool {
        let t = type.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if t.isEmpty { return false }
        if t == "payment_failed" { return true }
        if t.hasPrefix("dispute_") { return true }
        if t.contains("guarantee") { return true }
        if t == "account_flag" || t.hasPrefix("account_flag") { return true }
        return false
    }

    /// ASR-4.5.4 promotional / retention types. Matches `PushRegistration.shouldPlaySound`
    /// silent class plus `welcome_day*` prefixes.
    static func isMarketingNotificationType(_ type: String) -> Bool {
        let t = type.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if t.isEmpty { return false }
        switch t {
        case "price_drop", "seller_new_listing", "promotional", "marketing":
            return true
        default:
            return t.hasPrefix("welcome_day")
        }
    }

    private static func forceCriticalEnabled(_ rows: [NotificationPreferenceRow]) -> [NotificationPreferenceRow] {
        rows.map { row in
            guard isCriticalNotificationType(row.notificationType) else { return row }
            var copy = row
            copy.pushEnabled = true
            copy.emailEnabled = true
            copy.inAppEnabled = true
            return copy
        }
    }

    private func applyMarketingPush(enabled: Bool) {
        for i in editableRows.indices {
            guard Self.isMarketingNotificationType(editableRows[i].notificationType) else { continue }
            // Consent enables marketing types; global Push still has to be on.
            editableRows[i].pushEnabled = enabled && globalPushEnabled
        }
    }

    static func marketingConsent(from rows: [NotificationPreferenceRow]) -> Bool {
        rows.contains { isMarketingNotificationType($0.notificationType) && $0.pushEnabled }
    }

    /// Any transactional (non-critical, non-marketing) row with push on.
    private static func transactionalPushEnabled(_ rows: [NotificationPreferenceRow]) -> Bool {
        rows.contains { isGlobalPushManagedType($0.notificationType) && $0.pushEnabled }
    }

    /// All transactional rows have push on (empty → true, matching `allSatisfy`).
    private static func transactionalPushConsensus(_ rows: [NotificationPreferenceRow]) -> Bool {
        rows.filter { isGlobalPushManagedType($0.notificationType) }.allSatisfy(\.pushEnabled)
    }

    private static func isGlobalPushManagedType(_ type: String) -> Bool {
        !isCriticalNotificationType(type) && !isMarketingNotificationType(type)
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
