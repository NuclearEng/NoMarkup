import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

struct AccountView: View {
    @EnvironmentObject private var auth: AuthViewModel
    @EnvironmentObject private var push: PushRegistration
    @State private var exportMessage: String?
    @State private var exportIsError = false
    @State private var isExporting = false
    @State private var sessionEmail: String?
    @State private var sessionUserID: String?
    @State private var unreadNotificationCount = 0
    @State private var exportShareItem: ExportShareItem?
    /// Held separately so dismiss can delete the temp file after `sheet(item:)` clears the item.
    @State private var exportTempFileURL: URL?

    var body: some View {
        NavigationStack {
            List {
                Section {
                    if auth.isScaffoldSession {
                        Label("Browse-only session", systemImage: "hammer.fill")
                            .foregroundStyle(BrandTheme.warning)
                        Text("Layout preview only — API mutations and chat send stay disabled until you sign in with a real account.")
                            .font(.caption)
                            .foregroundStyle(BrandTheme.textSecondary)
                    } else if auth.isAuthenticated {
                        Label("Signed in", systemImage: "checkmark.seal.fill")
                            .foregroundStyle(BrandTheme.success)
                        if let sessionUserID, !sessionUserID.isEmpty {
                            LabeledContent("User") {
                                Text(shortID(sessionUserID))
                                    .font(.caption.monospaced())
                                    .foregroundStyle(BrandTheme.textSecondary)
                                    .textSelection(.enabled)
                            }
                        }
                        if push.isRegisteredWithServer {
                            Label("Push notifications on", systemImage: "bell.badge.fill")
                                .font(.caption)
                                .foregroundStyle(BrandTheme.textSecondary)
                        } else if let pushError = push.lastError {
                            Text(pushError)
                                .font(.caption)
                                .foregroundStyle(BrandTheme.warning)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    } else {
                        Label("Not signed in", systemImage: "person.crop.circle.badge.questionmark")
                            .foregroundStyle(BrandTheme.textSecondary)
                    }

                    if let email = displayEmail {
                        LabeledContent("Email", value: email)
                    }

                    NavigationLink {
                        ProfileSettingsView()
                    } label: {
                        Label("Profile settings", systemImage: "person.text.rectangle")
                    }
                    .frame(minHeight: 44)
                    .disabled(auth.isScaffoldSession || !auth.isAuthenticated)
                    .accessibilityHint("Edit display name and view account profile")

                    NavigationLink {
                        SecuritySettingsView()
                    } label: {
                        Label("Security", systemImage: "lock.shield")
                    }
                    .frame(minHeight: 44)
                    .disabled(auth.isScaffoldSession || !auth.isAuthenticated)
                    .accessibilityHint("Change password and view age verification status")

                    Button("Sign out", role: .destructive) {
                        PushRegistration.shared.resetSessionState()
                        auth.signOut()
                    }
                    .frame(minHeight: 44)
                } header: {
                    Text("Session").brandSectionHeader()
                }

                Section {
                    NavigationLink {
                        PostJobView()
                    } label: {
                        Label("Post a job", systemImage: "plus.circle")
                    }
                    .frame(minHeight: 44)
                    .accessibilityHint("Native form to post a reverse-auction service job")

                    NavigationLink {
                        CreateListingView()
                    } label: {
                        Label("Sell an item", systemImage: "tag")
                    }
                    .frame(minHeight: 44)
                    .accessibilityHint("Native form to list a local goods item for auction")

                    Text("Jobs and goods create flows call the gateway. Each form also links to the full web editor when you need photos or advanced options.")
                        .font(.caption)
                        .foregroundStyle(BrandTheme.textSecondary)
                } header: {
                    Text("Create").brandSectionHeader()
                }

                Section {
                    NavigationLink {
                        MyOrdersView()
                    } label: {
                        Label("Orders", systemImage: "bag")
                    }
                    .frame(minHeight: 44)
                    .accessibilityHint("View marketplace orders, pay pending ones, and confirm escrow pickup")

                    NavigationLink {
                        ContractsView()
                    } label: {
                        Label("Contracts", systemImage: "doc.text")
                    }
                    .frame(minHeight: 44)
                    .accessibilityHint("View service contracts from awarded job bids, milestones, and completion")

                    NavigationLink {
                        MyBidsView()
                    } label: {
                        Label("My bids", systemImage: "hammer")
                    }
                    .frame(minHeight: 44)
                    .accessibilityHint("View goods and service bids you have placed")

                    NavigationLink {
                        MyListingsView()
                    } label: {
                        Label("My listings", systemImage: "tag")
                    }
                    .frame(minHeight: 44)
                    .accessibilityHint("View goods listings you have posted as a seller")

                    NavigationLink {
                        WatchlistView()
                    } label: {
                        Label("Watchlist", systemImage: "heart")
                    }
                    .frame(minHeight: 44)
                    .accessibilityHint("Listings you are watching for auction updates")

                    NavigationLink {
                        SavedSearchesView()
                    } label: {
                        Label("Saved searches", systemImage: "bell.badge")
                    }
                    .frame(minHeight: 44)
                    .accessibilityHint("Manage marketplace search alerts")

                    NavigationLink {
                        SellerAnalyticsView()
                    } label: {
                        Label("Seller analytics", systemImage: "chart.bar")
                    }
                    .frame(minHeight: 44)
                    .accessibilityHint("View sales revenue, sell-through, and top categories")

                    NavigationLink {
                        SellerPayoutsView()
                    } label: {
                        Label("Seller payouts", systemImage: "banknote")
                    }
                    .frame(minHeight: 44)
                    .disabled(auth.isScaffoldSession || !auth.isAuthenticated)
                    .accessibilityHint("Connect Stripe and view payout readiness for providers")

                    NavigationLink {
                        PaymentMethodsView()
                    } label: {
                        Label("Payment methods", systemImage: "creditcard")
                    }
                    .frame(minHeight: 44)
                    .disabled(auth.isScaffoldSession || !auth.isAuthenticated)
                    .accessibilityHint("View and remove saved cards used at checkout")

                    NavigationLink {
                        NotificationsView()
                    } label: {
                        HStack {
                            Label("Notifications", systemImage: "bell")
                            Spacer()
                            if unreadNotificationCount > 0 {
                                Text("\(unreadNotificationCount)")
                                    .font(.caption.weight(.semibold).monospacedDigit())
                                    .foregroundStyle(BrandTheme.ctaLabelOnGold)
                                    .padding(.horizontal, 8)
                                    .padding(.vertical, 3)
                                    .background(BrandTheme.accent, in: Capsule())
                                    .accessibilityLabel("\(unreadNotificationCount) unread")
                            }
                        }
                    }
                    .frame(minHeight: 44)
                    .accessibilityHint("View account notifications and mark them read")

                    NavigationLink {
                        NotificationPreferencesView()
                    } label: {
                        Label("Notification preferences", systemImage: "bell.badge")
                    }
                    .frame(minHeight: 44)
                    .disabled(auth.isScaffoldSession || !auth.isAuthenticated)
                    .accessibilityHint("Choose push, email, and in-app channels per notification type")

                    Text("Jobs and local goods use Apple Pay / Stripe escrow (not App Store IAP). The market sets the price — not a platform markup.")
                        .font(.caption)
                        .foregroundStyle(BrandTheme.textSecondary)
                } header: {
                    Text("Orders, bids & alerts").brandSectionHeader()
                }

                Section {
                    NavigationLink {
                        ProvidersView()
                    } label: {
                        Label("Providers", systemImage: "wrench.and.screwdriver")
                    }
                    .frame(minHeight: 44)
                    .accessibilityHint("Browse and follow service providers")

                    NavigationLink {
                        PropertiesView()
                    } label: {
                        Label("Properties", systemImage: "house")
                    }
                    .frame(minHeight: 44)
                    .disabled(auth.isScaffoldSession || !auth.isAuthenticated)
                    .accessibilityHint("Manage saved service addresses for jobs")

                    NavigationLink {
                        WishlistView()
                    } label: {
                        Label("Wishlist", systemImage: "star")
                    }
                    .frame(minHeight: 44)
                    .disabled(auth.isScaffoldSession || !auth.isAuthenticated)
                    .accessibilityHint("Goods you are watching or wishlisted")

                    NavigationLink {
                        BlockedUsersView()
                    } label: {
                        Label("Blocked users", systemImage: "hand.raised")
                    }
                    .frame(minHeight: 44)
                    .disabled(auth.isScaffoldSession || !auth.isAuthenticated)
                    .accessibilityHint("Review accounts you have blocked")

                    NavigationLink {
                        ReferralsView()
                    } label: {
                        Label("Referrals", systemImage: "gift")
                    }
                    .frame(minHeight: 44)
                    .disabled(auth.isScaffoldSession || !auth.isAuthenticated)
                    .accessibilityHint("Invite friends and track referral rewards")
                } header: {
                    Text("Network & safety").brandSectionHeader()
                }

                Section {
                    NavigationLink {
                        LegalWebView(title: "Privacy Policy", url: AppConfig.privacyURL)
                    } label: {
                        Label("Privacy Policy", systemImage: "hand.raised")
                    }
                    .frame(minHeight: 44)
                    NavigationLink {
                        LegalWebView(title: "Terms of Service", url: AppConfig.termsURL)
                    } label: {
                        Label("Terms of Service", systemImage: "doc.text")
                    }
                    .frame(minHeight: 44)
                    NavigationLink {
                        LegalWebView(title: "Community Guidelines", url: AppConfig.communityGuidelinesURL)
                    } label: {
                        Label("Community Guidelines", systemImage: "person.3")
                    }
                    .frame(minHeight: 44)
                    NavigationLink {
                        LegalWebView(title: "Support", url: AppConfig.supportURL)
                    } label: {
                        Label("Support", systemImage: "lifepreserver")
                    }
                    .frame(minHeight: 44)
                } header: {
                    Text("Legal & support").brandSectionHeader()
                }

                Section {
                    Button {
                        Task { await exportData() }
                    } label: {
                        HStack {
                            Label("Export Data", systemImage: "square.and.arrow.up")
                            Spacer()
                            if isExporting {
                                ProgressView()
                                    .tint(BrandTheme.accent)
                            }
                        }
                        .frame(minHeight: 44)
                    }
                    .disabled(auth.isScaffoldSession || isExporting || !auth.isAuthenticated)
                    .accessibilityHint("Downloads your account data export and opens the system share sheet.")

                    if let exportMessage {
                        Text(exportMessage)
                            .font(.footnote)
                            .foregroundStyle(exportIsError ? BrandTheme.destructive : BrandTheme.textSecondary)
                    }

                    NavigationLink {
                        AccountDeletionView()
                    } label: {
                        Label("Delete Account", systemImage: "trash")
                            .foregroundStyle(BrandTheme.destructive)
                    }
                    .frame(minHeight: 44)
                } header: {
                    Text("Your data").brandSectionHeader()
                }

                Section {
                    Label(
                        "Digital subscriptions (StoreKit) — not in this build",
                        systemImage: "bag.badge.minus"
                    )
                    .foregroundStyle(BrandTheme.textSecondary)
                    .frame(minHeight: 44)
                    .accessibilityLabel("Digital subscriptions via StoreKit are not in this build")
                } header: {
                    Text("Subscriptions").brandSectionHeader()
                }

                Section {
                    LabeledContent("Version", value: "\(AppConfig.shortVersion) (\(AppConfig.buildNumber))")
                    LabeledContent("API", value: AppConfig.apiBaseHostDisplay)
                    LabeledContent(
                        "Stripe key",
                        value: AppConfig.stripePublishableKey.isEmpty ? "not set" : "configured"
                    )
                    Text("Rail A: Apple Pay via Stripe. StoreKit / IAP intentionally omitted (digital free-tier only).")
                        .font(.caption)
                        .foregroundStyle(BrandTheme.textSecondary)
                } header: {
                    Text("About").brandSectionHeader()
                }
            }
            .brandListBackground()
            .navigationTitle("Account")
            .toolbarBackground(BrandTheme.navy, for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
            .task {
                await refreshSessionHints()
                await refreshUnreadCount()
            }
            .onChange(of: auth.isAuthenticated) { _, _ in
                Task {
                    await refreshSessionHints()
                    await refreshUnreadCount()
                }
            }
            .onChange(of: auth.isScaffoldSession) { _, _ in
                Task {
                    await refreshSessionHints()
                    await refreshUnreadCount()
                }
            }
            #if canImport(UIKit)
            .sheet(item: $exportShareItem, onDismiss: {
                cleanupExportShareFile()
            }) { item in
                ActivityShareSheet(items: [item.url])
            }
            #endif
        }
    }

    private var displayEmail: String? {
        let fromAuth = auth.email.trimmingCharacters(in: .whitespacesAndNewlines)
        if !fromAuth.isEmpty { return fromAuth }
        if let sessionEmail, !sessionEmail.isEmpty { return sessionEmail }
        return nil
    }

    private func shortID(_ id: String) -> String {
        if id.count <= 12 { return id }
        return String(id.prefix(8)) + "…"
    }

    @MainActor
    private func refreshSessionHints() async {
        if auth.isScaffoldSession || !auth.isAuthenticated {
            sessionEmail = nil
            sessionUserID = nil
            return
        }
        sessionUserID = await APIClient.shared.currentUserID()
        // Email may already be on AuthViewModel after password login; JWT may carry it too.
        if auth.email.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            if let token = try? KeychainTokenStore().read(.accessToken) {
                sessionEmail = JWTPayload.email(from: token)
            }
        }
    }

    @MainActor
    private func refreshUnreadCount() async {
        guard auth.isAuthenticated, !auth.isScaffoldSession else {
            unreadNotificationCount = 0
            return
        }
        do {
            unreadNotificationCount = try await APIClient.shared.fetchUnreadNotificationCount()
        } catch {
            // Non-blocking badge — leave previous value on transient failure.
        }
    }

    @MainActor
    private func exportData() async {
        exportMessage = nil
        exportIsError = false
        isExporting = true
        defer { isExporting = false }

        do {
            let data = try await APIClient.shared.exportMyData()
            let url = try writeExportTempFile(data: data)
            exportIsError = false
            exportMessage = "Export ready (\(data.count) bytes). Choose where to save or share."
            exportTempFileURL = url
            exportShareItem = ExportShareItem(url: url)
        } catch {
            exportIsError = true
            exportMessage = error.localizedDescription
        }
    }

    private func writeExportTempFile(data: Data) throws -> URL {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyyMMdd-HHmmss"
        let stamp = formatter.string(from: Date())
        let filename = "nomarkup-export-\(stamp).json"
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(filename)
        try data.write(to: url, options: .atomic)
        return url
    }

    private func cleanupExportShareFile() {
        if let exportTempFileURL {
            try? FileManager.default.removeItem(at: exportTempFileURL)
        }
        exportTempFileURL = nil
        exportShareItem = nil
    }
}

/// Identifiable wrapper so export uses `sheet(item:)` and never presents an empty sheet.
private struct ExportShareItem: Identifiable {
    let id = UUID()
    let url: URL
}

#if canImport(UIKit)
/// System share sheet for export JSON (and other activity items).
private struct ActivityShareSheet: UIViewControllerRepresentable {
    let items: [Any]

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }

    func updateUIViewController(_ uiViewController: UIActivityViewController, context: Context) {}
}
#endif

#Preview {
    AccountView()
        .environmentObject(AuthViewModel())
        .preferredColorScheme(.dark)
        .tint(BrandTheme.accent)
}
