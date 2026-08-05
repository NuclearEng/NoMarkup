import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

struct AccountView: View {
    @EnvironmentObject private var auth: AuthViewModel
    @EnvironmentObject private var push: PushRegistration
    @EnvironmentObject private var featureFlags: FeatureFlags
    @State private var exportMessage: String?
    @State private var exportIsError = false
    @State private var isExporting = false
    @State private var sessionEmail: String?
    @State private var sessionUserID: String?
    @State private var unreadNotificationCount = 0
    @State private var exportShareItem: ExportShareItem?
    /// Held separately so dismiss can delete the temp file after `sheet(item:)` clears the item.
    @State private var exportTempFileURL: URL?
    /// Profile missing display name and/or phone — show “Finish setup” (FR-1.5/1.6).
    @State private var profileNeedsSetup = false
    @State private var showOnboardingWizard = false

    var body: some View {
        NavigationStack {
            List {
                if profileNeedsSetup && auth.isAuthenticated && !auth.isScaffoldSession {
                    Section {
                        Button {
                            showOnboardingWizard = true
                        } label: {
                            HStack(alignment: .center, spacing: 12) {
                                Image(systemName: "list.bullet.clipboard.fill")
                                    .font(.title3)
                                    .foregroundStyle(BrandTheme.goldBright)
                                    .accessibilityHidden(true)
                                VStack(alignment: .leading, spacing: 4) {
                                    Text("Finish setup")
                                        .font(.body.weight(.semibold))
                                        .foregroundStyle(BrandTheme.textPrimary)
                                    Text("Add a display name and phone, or enable provider — takes a minute.")
                                        .font(.caption)
                                        .foregroundStyle(BrandTheme.textSecondary)
                                        .fixedSize(horizontal: false, vertical: true)
                                }
                                Spacer(minLength: 8)
                                Image(systemName: "chevron.right")
                                    .font(.caption.weight(.semibold))
                                    .foregroundStyle(BrandTheme.textSecondary)
                                    .accessibilityHidden(true)
                            }
                            .frame(minHeight: 44)
                        }
                        .listRowBackground(BrandTheme.surfaceRaised)
                        .accessibilityHint("Opens the guided setup wizard")
                        .accessibilityIdentifier("account.finishSetup")
                    }
                }

                // Institutional desk — wiring status (API + Rail A Stripe/Apple Pay).
                Section {
                    LabeledContent("API desk") {
                        Text(AppConfig.apiBaseHostDisplay)
                            .font(.caption.monospaced())
                            .foregroundStyle(BrandTheme.goldBright)
                            .textSelection(.enabled)
                    }
                    LabeledContent("Stripe (Rail A)") {
                        Text(AppConfig.stripePublishableKey.isEmpty ? "Not configured" : "Configured")
                            .font(.caption.weight(.semibold).monospaced())
                            .foregroundStyle(
                                AppConfig.stripePublishableKey.isEmpty
                                    ? BrandTheme.warning
                                    : BrandTheme.success
                            )
                    }
                    LabeledContent("Apple Pay merchant") {
                        Text(AppConfig.applePayMerchantId.isEmpty ? "—" : AppConfig.applePayMerchantId)
                            .font(.caption2.monospaced())
                            .foregroundStyle(BrandTheme.textSecondary)
                            .lineLimit(1)
                            .minimumScaleFactor(0.7)
                    }
                    if AppConfig.stripePublishableKey.isEmpty {
                        Text(
                            "Payments & Apple Pay need a real pk_test key via NOMARKUP_STRIPE_PUBLISHABLE_KEY (Debug scheme) and matching sk_test on the payment service. Placeholder Stripe stays DevMode — promote/pay fail closed without a real charge."
                        )
                        .font(.caption2)
                        .foregroundStyle(BrandTheme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                    }
                } header: {
                    Text("Market wiring").brandSectionHeader()
                } footer: {
                    Text("Champagne M↓ icon · navy institutional desk · mono prices. Fail closed on money.")
                        .foregroundStyle(BrandTheme.textSecondary)
                }

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
                        // Push status + Settings CTA when denied (NT.2 / DES.8).
                        if push.isRegisteredWithServer {
                            Label("Push notifications on", systemImage: "bell.badge.fill")
                                .font(.caption)
                                .foregroundStyle(BrandTheme.textSecondary)
                        } else if push.isDenied {
                            VStack(alignment: .leading, spacing: 8) {
                                Text(NotificationPermissionCopy.deniedStatus)
                                    .font(.caption)
                                    .foregroundStyle(BrandTheme.warning)
                                    .fixedSize(horizontal: false, vertical: true)
                                Button(NotificationPermissionCopy.openSettings) {
                                    #if canImport(UIKit)
                                    if let url = URL(string: UIApplication.openSettingsURLString) {
                                        UIApplication.shared.open(url)
                                    }
                                    #endif
                                }
                                .font(.caption.weight(.semibold))
                                .frame(minHeight: 44)
                                .accessibilityHint("Opens iOS Settings for NoMarkup")
                            }
                        } else if !push.isAuthorized {
                            Button(NotificationPermissionCopy.enableFromSettings) {
                                push.requestFromSettings()
                            }
                            .font(.caption.weight(.semibold))
                            .frame(minHeight: 44)
                            .accessibilityHint("Explains bid alerts, then requests notification permission")
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
                        ProviderWorkspaceView()
                    } label: {
                        Label("Provider workspace", systemImage: "wrench.and.screwdriver")
                    }
                    .frame(minHeight: 44)
                    .disabled(auth.isScaffoldSession || !auth.isAuthenticated)
                    .accessibilityHint("Edit provider bio, availability, streaks, and licenses")

                    NavigationLink {
                        ProviderInstantOffersView()
                    } label: {
                        Label("Instant offers", systemImage: "bolt.badge.clock")
                    }
                    .frame(minHeight: 44)
                    .disabled(auth.isScaffoldSession || !auth.isAuthenticated)
                    .accessibilityHint("Provider inbox: accept or decline emergency Instant match jobs")

                    NavigationLink {
                        SecuritySettingsView()
                    } label: {
                        Label("Security", systemImage: "lock.shield")
                    }
                    .frame(minHeight: 44)
                    .disabled(auth.isScaffoldSession || !auth.isAuthenticated)
                    .accessibilityHint("Change password and view age verification status")

                    NavigationLink {
                        VerificationCenterView()
                    } label: {
                        Label("Verify email & phone", systemImage: "checkmark.shield")
                    }
                    .frame(minHeight: 44)
                    .disabled(auth.isScaffoldSession)
                    .accessibilityHint("Resend email verification and complete phone OTP")

                    Button("Sign out", role: .destructive) {
                        // Device unregister + widget wipe run inside signOut()
                        // (IOS-SYS.NT.4 / OBS-3) so every sign-out path is covered.
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
                        JobDraftsView()
                    } label: {
                        Label("Job drafts", systemImage: "doc.text")
                    }
                    .frame(minHeight: 44)
                    .disabled(auth.isScaffoldSession || !auth.isAuthenticated)
                    .accessibilityHint("Review unpublished service job drafts and publish them")

                    NavigationLink {
                        CreateListingView()
                    } label: {
                        Label("Sell an item", systemImage: "tag")
                    }
                    .frame(minHeight: 44)
                    .accessibilityHint("Native form to list a local goods item for auction")

                    Text("Jobs and goods create flows include photo library and camera capture in-app.")
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
                        BusinessFeaturesHubView()
                    } label: {
                        Label("Business & finance", systemImage: "building.2")
                    }
                    .frame(minHeight: 44)
                    .disabled(auth.isScaffoldSession || !auth.isAuthenticated)
                    .accessibilityHint("BNPL, insurance, advances, instant payout, expenses, and tax — full web parity")

                    NavigationLink {
                        SalesExportView()
                    } label: {
                        Label("Sales export (CSV)", systemImage: "tablecells")
                    }
                    .frame(minHeight: 44)
                    .disabled(auth.isScaffoldSession || !auth.isAuthenticated)
                    .accessibilityHint("Download completed sales as a CSV file and share it")

                    NavigationLink {
                        CalendarExportView()
                    } label: {
                        Label("Calendar export", systemImage: "calendar")
                    }
                    .frame(minHeight: 44)
                    .disabled(auth.isScaffoldSession || !auth.isAuthenticated)
                    .accessibilityHint("Download an iCal file of jobs, contracts, and pickups")

                    NavigationLink {
                        EmployeesView()
                    } label: {
                        Label("Team", systemImage: "person.3")
                    }
                    .frame(minHeight: 44)
                    .disabled(auth.isScaffoldSession || !auth.isAuthenticated)
                    .accessibilityHint("Manage provider employees")

                    NavigationLink {
                        ChallengesView()
                    } label: {
                        Label("Challenges", systemImage: "flag.checkered")
                    }
                    .frame(minHeight: 44)
                    .disabled(auth.isScaffoldSession || !auth.isAuthenticated)
                    .accessibilityHint("Join provider challenges and track progress")

                    if featureFlags.isEnabled("legal_services") {
                        NavigationLink {
                            LegalServicesView()
                        } label: {
                            Label("Legal services", systemImage: "scalemass")
                        }
                        .frame(minHeight: 44)
                        .accessibilityHint("Attorney reverse-auction vertical")
                    }

                    NavigationLink {
                        QuoteTemplatesView()
                    } label: {
                        Label("Quote templates", systemImage: "doc.text")
                    }
                    .frame(minHeight: 44)
                    .disabled(auth.isScaffoldSession || !auth.isAuthenticated)
                    .accessibilityHint("Create and manage reusable service bid quote templates")

                    NavigationLink {
                        VerificationDocumentsView()
                    } label: {
                        Label("Verification documents", systemImage: "checkmark.shield")
                    }
                    .frame(minHeight: 44)
                    .disabled(auth.isScaffoldSession || !auth.isAuthenticated)
                    .accessibilityHint("View status and upload provider verification documents")

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
                        FollowingView()
                    } label: {
                        Label("Following", systemImage: "person.2")
                    }
                    .frame(minHeight: 44)
                    .disabled(auth.isScaffoldSession || !auth.isAuthenticated)
                    .accessibilityHint("Sellers you follow")

                    NavigationLink {
                        FeedView()
                    } label: {
                        Label("Following feed", systemImage: "rectangle.stack")
                    }
                    .frame(minHeight: 44)
                    .disabled(auth.isScaffoldSession || !auth.isAuthenticated)
                    .accessibilityHint("Active auctions from sellers you follow")

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

                    NavigationLink {
                        NPSSurveysView()
                    } label: {
                        Label("Feedback surveys", systemImage: "bubble.left.and.bubble.right")
                    }
                    .frame(minHeight: 44)
                    .disabled(auth.isScaffoldSession || !auth.isAuthenticated)
                    .accessibilityHint("Answer pending Net Promoter Score surveys")

                    NavigationLink {
                        SavingsView()
                    } label: {
                        Label("Savings", systemImage: "chart.line.uptrend.xyaxis")
                    }
                    .frame(minHeight: 44)
                    .disabled(auth.isScaffoldSession || !auth.isAuthenticated)
                    .accessibilityHint("View lifetime reverse-auction savings versus market median")

                    NavigationLink {
                        MarketsView()
                    } label: {
                        Label("Markets", systemImage: "building.2")
                    }
                    .frame(minHeight: 44)
                    .accessibilityHint("Browse launched city markets for services and goods")

                    NavigationLink {
                        TrustTiersView()
                    } label: {
                        Label("Trust tiers", systemImage: "shield.lefthalf.filled")
                    }
                    .frame(minHeight: 44)
                    .accessibilityHint("How provider trust scores and ladder requirements work")
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
                        TermsAcceptanceView()
                    } label: {
                        Label("Terms acceptance", systemImage: "checkmark.seal")
                    }
                    .frame(minHeight: 44)
                    .disabled(auth.isScaffoldSession || !auth.isAuthenticated)
                    .accessibilityHint("Compare current Terms version with what you accepted")
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
                    NavigationLink {
                        PlanLimitsView()
                    } label: {
                        Label("Plan limits", systemImage: "list.bullet.rectangle")
                    }
                    .frame(minHeight: 44)
                    .accessibilityHint(AppConfig.storeKitEnabled
                        ? "Compare plan limits and subscribe with In-App Purchase when products are available."
                        : "Compare free launch limits and read-only paid tiers. Digital plans are not sold in this app.")

                    NavigationLink {
                        RegulatedRailsStatusView()
                    } label: {
                        Label("Feature flag status", systemImage: "flag")
                    }
                    .frame(minHeight: 44)
                    .accessibilityHint("Server feature flags for BNPL, insurance, advances, and related rails")

                    Text(AppConfig.storeKitEnabled
                        ? "Digital Pro / Business plans use App Store In-App Purchase when enabled. BNPL, insurance, advances, and instant payout use server flags — open Business & finance when enabled."
                        : "Digital plans are included free for launch in this app (no In-App Purchase, no web digital upgrade). BNPL, insurance, advances, and instant payout use server flags — open Business & finance when enabled.")
                        .font(.caption)
                        .foregroundStyle(BrandTheme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
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
                    Text(AppConfig.storeKitEnabled
                        ? "Pay for jobs and goods with Apple Pay. Digital subscriptions use App Store In-App Purchase when products are live."
                        : "Pay for jobs and goods with Apple Pay. Digital feature unlocks are free-tier only in this build — no subscription purchase.")
                        .font(.caption)
                        .foregroundStyle(BrandTheme.textSecondary)
                } header: {
                    Text("About").brandSectionHeader()
                }
            }
            .brandListBackground()
            .navigationTitle("Account")
            .brandNavigationBarChrome()
            .task {
                await refreshSessionHints()
                await refreshUnreadCount()
                await refreshOnboardingBanner()
            }
            .onChange(of: auth.isAuthenticated) { _, _ in
                Task {
                    await refreshSessionHints()
                    await refreshUnreadCount()
                    await refreshOnboardingBanner()
                }
            }
            .onChange(of: auth.isScaffoldSession) { _, _ in
                Task {
                    await refreshSessionHints()
                    await refreshUnreadCount()
                    await refreshOnboardingBanner()
                }
            }
            .sheet(isPresented: $showOnboardingWizard, onDismiss: {
                Task { await refreshOnboardingBanner() }
            }) {
                NavigationStack {
                    OnboardingWizardView()
                }
                .environmentObject(auth)
                .tint(BrandTheme.accent)
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

    /// Show Account “Finish setup” when display name or phone is missing (FR-1.5/1.6).
    @MainActor
    private func refreshOnboardingBanner() async {
        guard auth.isAuthenticated, !auth.isScaffoldSession else {
            profileNeedsSetup = false
            return
        }
        do {
            let me = try await APIClient.shared.fetchMe()
            profileNeedsSetup = me.isOnboardingIncomplete
            if let email = me.email, !email.isEmpty, auth.email.isEmpty {
                auth.email = email
            }
        } catch {
            // Non-blocking banner — leave previous value on transient failure.
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

// ActivityShareSheet lives in SalesExportView.swift (shared for CSV/ICS/JSON share).

#Preview {
    AccountView()
        .environmentObject(AuthViewModel())
        .environmentObject(FeatureFlags())
        .environmentObject(PushRegistration.shared)
        .preferredColorScheme(.dark)
        .tint(BrandTheme.accent)
}
