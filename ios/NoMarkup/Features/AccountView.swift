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
    /// From `UserProfile.roles` — gates Admin console row.
    @State private var hasAdminRole = false
    /// Legal/support HTML opens as a sheet (`SFSafariViewController`), not a
    /// NavigationLink push — Safari is modal chrome; pushing it via the nav stack
    /// can hide the tab bar and leave Close/Back stuck after dismiss.
    @State private var legalSheet: LegalSheetTarget?
    /// Sign out sits next to Verify / Security — require a confirm so a fat-finger
    /// does not dump a signed-in provider onto LoginView.
    @State private var confirmSignOut = false

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
                        LazyView {
                            ProfileSettingsView()
                        }
                    } label: {
                        Label("Profile settings", systemImage: "person.text.rectangle")
                    }
                    .frame(minHeight: 44)
                    .disabled(auth.isScaffoldSession || !auth.isAuthenticated)
                    .accessibilityHint("Edit display name and view account profile")
                    .accessibilityIdentifier("account.row.profile")

                    NavigationLink {
                        LazyView {
                            ProviderWorkspaceView()
                        }
                    } label: {
                        Label("Provider workspace", systemImage: "wrench.and.screwdriver")
                    }
                    .frame(minHeight: 44)
                    .disabled(auth.isScaffoldSession || !auth.isAuthenticated)
                    .accessibilityHint("Edit provider bio, availability, streaks, and licenses")
                    .accessibilityIdentifier("account.row.providerWorkspace")

                    NavigationLink {
                        LazyView {
                            ProviderInstantOffersView()
                        }
                    } label: {
                        Label("Instant offers", systemImage: "bolt.badge.clock")
                    }
                    .frame(minHeight: 44)
                    .disabled(auth.isScaffoldSession || !auth.isAuthenticated)
                    .accessibilityHint("Provider inbox: accept or decline emergency Instant match jobs")
                    .accessibilityIdentifier("account.row.instantOffers")

                    NavigationLink {
                        LazyView {
                            SecuritySettingsView()
                        }
                    } label: {
                        Label("Security", systemImage: "lock.shield")
                    }
                    .frame(minHeight: 44)
                    .disabled(auth.isScaffoldSession || !auth.isAuthenticated)
                    .accessibilityHint("Change password and view age verification status")
                    .accessibilityIdentifier("account.row.security")

                    NavigationLink {
                        LazyView {
                            VerificationCenterView()
                        }
                    } label: {
                        Label("Verify email & phone", systemImage: "checkmark.shield")
                    }
                    .frame(minHeight: 44)
                    .disabled(auth.isScaffoldSession)
                    .accessibilityHint("Resend email verification and complete phone OTP")
                    .accessibilityIdentifier("account.row.verification")

                    Button("Sign out", role: .destructive) {
                        confirmSignOut = true
                    }
                    .frame(minHeight: 44)
                    .accessibilityLabel("Sign out")
                    .accessibilityHint("Asks to confirm, then signs you out of this device")
                    .accessibilityIdentifier("account.row.signOut")
                } header: {
                    Text("Session").brandSectionHeader()
                }

                Section {
                    NavigationLink {
                        LazyView {
                            PostJobView()
                        }
                    } label: {
                        Label("Post a job", systemImage: "plus.circle")
                    }
                    .frame(minHeight: 44)
                    .disabled(auth.isScaffoldSession || !auth.isAuthenticated)
                    .accessibilityHint("Native form to post a reverse-auction service job")
                    .accessibilityIdentifier("account.row.postJob")

                    NavigationLink {
                        LazyView {
                            JobDraftsView()
                        }
                    } label: {
                        Label("Job drafts", systemImage: "doc.text")
                    }
                    .frame(minHeight: 44)
                    .disabled(auth.isScaffoldSession || !auth.isAuthenticated)
                    .accessibilityHint("Review unpublished service job drafts and publish them")
                    .accessibilityIdentifier("account.row.drafts")

                    NavigationLink {
                        LazyView {
                            CreateListingView()
                        }
                    } label: {
                        Label("Sell an item", systemImage: "tag")
                    }
                    .frame(minHeight: 44)
                    .disabled(auth.isScaffoldSession || !auth.isAuthenticated)
                    .accessibilityHint("Native form to list a local goods item for auction")
                    .accessibilityIdentifier("account.row.sell")

                    Text("Jobs and goods create flows include photo library and camera capture in-app.")
                        .font(.caption)
                        .foregroundStyle(BrandTheme.textSecondary)
                } header: {
                    Text("Create").brandSectionHeader()
                }

                Section {
                    NavigationLink {
                        LazyView {
                            MyOrdersView()
                        }
                    } label: {
                        Label("Orders", systemImage: "bag")
                    }
                    .frame(minHeight: 44)
                    .disabled(auth.isScaffoldSession || !auth.isAuthenticated)
                    .accessibilityHint("View marketplace orders, pay pending ones, and confirm escrow pickup")
                    .accessibilityIdentifier("account.row.orders")

                    NavigationLink {
                        LazyView {
                            ContractsView()
                        }
                    } label: {
                        Label("Contracts", systemImage: "doc.text")
                    }
                    .frame(minHeight: 44)
                    .disabled(auth.isScaffoldSession || !auth.isAuthenticated)
                    .accessibilityHint("View service contracts from awarded job bids, milestones, and completion")
                    .accessibilityIdentifier("account.row.contracts")

                    NavigationLink {
                        LazyView {
                            RecurringJobsView()
                        }
                    } label: {
                        Label("Recurring jobs", systemImage: "arrow.triangle.2.circlepath")
                    }
                    .frame(minHeight: 44)
                    .disabled(auth.isScaffoldSession || !auth.isAuthenticated)
                    .accessibilityHint("Manage recurring service schedules — frequency, next visit, pause, resume, cancel")
                    .accessibilityIdentifier("account.row.recurringJobs")

                    NavigationLink {
                        LazyView {
                            MyBidsView()
                        }
                    } label: {
                        Label("My bids", systemImage: "hammer")
                    }
                    .frame(minHeight: 44)
                    .disabled(auth.isScaffoldSession || !auth.isAuthenticated)
                    .accessibilityHint("View goods and service bids you have placed")
                    .accessibilityIdentifier("account.row.myBids")

                    NavigationLink {
                        LazyView {
                            PositionsBlotterView()
                        }
                    } label: {
                        Label("Positions blotter", systemImage: "chart.bar.doc.horizontal")
                    }
                    .frame(minHeight: 44)
                    .disabled(auth.isScaffoldSession || !auth.isAuthenticated)
                    .accessibilityHint("Open market exposure — service bids, goods bids, and watchlist")
                    .accessibilityIdentifier("account.row.positions")

                    NavigationLink {
                        LazyView {
                            MyListingsView()
                        }
                    } label: {
                        Label("My listings", systemImage: "tag")
                    }
                    .frame(minHeight: 44)
                    .disabled(auth.isScaffoldSession || !auth.isAuthenticated)
                    .accessibilityHint("View goods listings you have posted as a seller")
                    .accessibilityIdentifier("account.row.myListings")

                    NavigationLink {
                        LazyView {
                            WatchlistView()
                        }
                    } label: {
                        Label("Watchlist", systemImage: "heart")
                    }
                    .frame(minHeight: 44)
                    .disabled(auth.isScaffoldSession || !auth.isAuthenticated)
                    .accessibilityHint("Listings you are watching for auction updates")
                    .accessibilityIdentifier("account.row.watchlist")

                    NavigationLink {
                        LazyView {
                            SavedSearchesView()
                        }
                    } label: {
                        Label("Saved searches", systemImage: "bell.badge")
                    }
                    .frame(minHeight: 44)
                    .disabled(auth.isScaffoldSession || !auth.isAuthenticated)
                    .accessibilityHint("Manage marketplace search alerts")
                    .accessibilityIdentifier("account.row.savedSearches")

                    NavigationLink {
                        LazyView {
                            SellerAnalyticsView()
                        }
                    } label: {
                        Label("Seller analytics", systemImage: "chart.bar")
                    }
                    .frame(minHeight: 44)
                    .disabled(auth.isScaffoldSession || !auth.isAuthenticated)
                    .accessibilityHint("View sales revenue, sell-through, and top categories")
                    .accessibilityIdentifier("account.row.sellerAnalytics")

                    NavigationLink {
                        LazyView {
                            SellerPayoutsView()
                        }
                    } label: {
                        Label("Seller payouts", systemImage: "banknote")
                    }
                    .frame(minHeight: 44)
                    .disabled(auth.isScaffoldSession || !auth.isAuthenticated)
                    .accessibilityHint("Connect Stripe and view payout readiness for providers")
                    .accessibilityIdentifier("account.row.sellerPayouts")

                    NavigationLink {
                        LazyView {
                            BusinessFeaturesHubView()
                        }
                    } label: {
                        Label("Business & finance", systemImage: "building.2")
                    }
                    .frame(minHeight: 44)
                    .disabled(auth.isScaffoldSession || !auth.isAuthenticated)
                    .accessibilityHint("Expenses, invoices, and tax. BNPL, insurance, advances, and instant payout are off in this App Store build.")
                    .accessibilityIdentifier("account.row.businessFinance")

                    // Hidden while FeatureFlags.isEnabled is false (iOS hard-off + server).
                    if featureFlags.isEnabled("per_job_insurance")
                        || featureFlags.isEnabled("insurance_competition") {
                        NavigationLink {
                            LazyView {
                                InsuranceQuoteFlowView()
                            }
                        } label: {
                            Label("Insurance quote", systemImage: "shield.lefthalf.filled")
                        }
                        .frame(minHeight: 44)
                        .disabled(auth.isScaffoldSession || !auth.isAuthenticated)
                        .accessibilityHint("Request a per-job insurance quote for a contract")
                        .accessibilityIdentifier("account.row.insuranceQuote")
                    }

                    NavigationLink {
                        LazyView {
                            SalesExportView()
                        }
                    } label: {
                        Label("Sales export (CSV)", systemImage: "tablecells")
                    }
                    .frame(minHeight: 44)
                    .disabled(auth.isScaffoldSession || !auth.isAuthenticated)
                    .accessibilityHint("Download completed sales as a CSV file and share it")
                    .accessibilityIdentifier("account.row.salesExport")

                    NavigationLink {
                        LazyView {
                            CalendarExportView()
                        }
                    } label: {
                        Label("Calendar export", systemImage: "calendar")
                    }
                    .frame(minHeight: 44)
                    .disabled(auth.isScaffoldSession || !auth.isAuthenticated)
                    .accessibilityHint("Download an iCal file of jobs, contracts, and pickups")
                    .accessibilityIdentifier("account.row.calendarExport")

                    NavigationLink {
                        LazyView {
                            EmployeesView()
                        }
                    } label: {
                        Label("Team", systemImage: "person.3")
                    }
                    .frame(minHeight: 44)
                    .disabled(auth.isScaffoldSession || !auth.isAuthenticated)
                    .accessibilityHint("Manage provider employees")
                    .accessibilityIdentifier("account.row.team")

                    NavigationLink {
                        LazyView {
                            ChallengesView()
                        }
                    } label: {
                        Label("Challenges", systemImage: "flag.checkered")
                    }
                    .frame(minHeight: 44)
                    .disabled(auth.isScaffoldSession || !auth.isAuthenticated)
                    .accessibilityHint("Join provider challenges and track progress")
                    .accessibilityIdentifier("account.row.challenges")

                    if featureFlags.isEnabled("legal_services") {
                        NavigationLink {
                            LazyView {
                                LegalServicesView()
                            }
                        } label: {
                            Label("Legal services", systemImage: "scalemass")
                        }
                        .frame(minHeight: 44)
                        .disabled(auth.isScaffoldSession || !auth.isAuthenticated)
                        .accessibilityHint("Attorney reverse-auction vertical")
                        .accessibilityIdentifier("account.row.legalServices")
                    }

                    NavigationLink {
                        LazyView {
                            QuoteTemplatesView()
                        }
                    } label: {
                        Label("Quote templates", systemImage: "doc.text")
                    }
                    .frame(minHeight: 44)
                    .disabled(auth.isScaffoldSession || !auth.isAuthenticated)
                    .accessibilityHint("Create and manage reusable service bid quote templates")
                    .accessibilityIdentifier("account.row.quoteTemplates")

                    NavigationLink {
                        LazyView {
                            VerificationDocumentsView()
                        }
                    } label: {
                        Label("Verification documents", systemImage: "checkmark.shield")
                    }
                    .frame(minHeight: 44)
                    .disabled(auth.isScaffoldSession || !auth.isAuthenticated)
                    .accessibilityHint("View status and upload provider verification documents")
                    .accessibilityIdentifier("account.row.verificationDocuments")

                    NavigationLink {
                        LazyView {
                            PaymentMethodsView()
                        }
                    } label: {
                        Label("Payment methods", systemImage: "creditcard")
                    }
                    .frame(minHeight: 44)
                    .disabled(auth.isScaffoldSession || !auth.isAuthenticated)
                    .accessibilityHint("View and remove saved cards used at checkout")
                    .accessibilityIdentifier("account.row.paymentMethods")

                    NavigationLink {
                        LazyView {
                            PaymentsHistoryView()
                        }
                    } label: {
                        Label("Payments history", systemImage: "list.bullet.rectangle")
                    }
                    .frame(minHeight: 44)
                    .disabled(auth.isScaffoldSession || !auth.isAuthenticated)
                    .accessibilityHint("View escrow payments, releases, and refunds")
                    .accessibilityIdentifier("account.row.paymentsHistory")

                    NavigationLink {
                        LazyView {
                            NotificationsView()
                        }
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
                    .disabled(auth.isScaffoldSession || !auth.isAuthenticated)
                    .accessibilityHint("View account notifications and mark them read")
                    .accessibilityIdentifier("account.row.notifications")

                    NavigationLink {
                        LazyView {
                            NotificationPreferencesView()
                        }
                    } label: {
                        Label("Notification preferences", systemImage: "bell.badge")
                    }
                    .frame(minHeight: 44)
                    .disabled(auth.isScaffoldSession || !auth.isAuthenticated)
                    .accessibilityHint("Choose push, email, and in-app channels per notification type")
                    .accessibilityIdentifier("account.row.notificationPreferences")

                    Text("Jobs and local goods use Apple Pay / Stripe escrow (not App Store IAP). The market sets the price — not a platform markup.")
                        .font(.caption)
                        .foregroundStyle(BrandTheme.textSecondary)
                } header: {
                    Text("Orders, bids & alerts").brandSectionHeader()
                }

                Section {
                    NavigationLink {
                        LazyView {
                            ProvidersView()
                        }
                    } label: {
                        Label("Providers", systemImage: "wrench.and.screwdriver")
                    }
                    .frame(minHeight: 44)
                    .accessibilityHint("Browse and follow service providers")
                    .accessibilityIdentifier("account.row.providers")

                    NavigationLink {
                        LazyView {
                            FollowingView()
                        }
                    } label: {
                        Label("Following", systemImage: "person.2")
                    }
                    .frame(minHeight: 44)
                    .disabled(auth.isScaffoldSession || !auth.isAuthenticated)
                    .accessibilityHint("Sellers you follow")
                    .accessibilityIdentifier("account.row.following")

                    NavigationLink {
                        LazyView {
                            FeedView()
                        }
                    } label: {
                        Label("Following feed", systemImage: "rectangle.stack")
                    }
                    .frame(minHeight: 44)
                    .disabled(auth.isScaffoldSession || !auth.isAuthenticated)
                    .accessibilityHint("Active auctions from sellers you follow")
                    .accessibilityIdentifier("account.row.followingFeed")

                    NavigationLink {
                        LazyView {
                            PropertiesView()
                        }
                    } label: {
                        Label("Properties", systemImage: "house")
                    }
                    .frame(minHeight: 44)
                    .disabled(auth.isScaffoldSession || !auth.isAuthenticated)
                    .accessibilityHint("Manage saved service addresses for jobs")
                    .accessibilityIdentifier("account.row.properties")

                    NavigationLink {
                        LazyView {
                            WishlistView()
                        }
                    } label: {
                        Label("Wishlist", systemImage: "star")
                    }
                    .frame(minHeight: 44)
                    .disabled(auth.isScaffoldSession || !auth.isAuthenticated)
                    .accessibilityHint("Goods you are watching or wishlisted")
                    .accessibilityIdentifier("account.row.wishlist")

                    NavigationLink {
                        LazyView {
                            BlockedUsersView()
                        }
                    } label: {
                        Label("Blocked users", systemImage: "hand.raised")
                    }
                    .frame(minHeight: 44)
                    .disabled(auth.isScaffoldSession || !auth.isAuthenticated)
                    .accessibilityHint("Review accounts you have blocked")
                    .accessibilityIdentifier("account.row.blockedUsers")

                    NavigationLink {
                        LazyView {
                            ReferralsView()
                        }
                    } label: {
                        Label("Referrals", systemImage: "gift")
                    }
                    .frame(minHeight: 44)
                    .disabled(auth.isScaffoldSession || !auth.isAuthenticated)
                    .accessibilityHint("Invite friends and track referral rewards")
                    .accessibilityIdentifier("account.row.referrals")

                    NavigationLink {
                        LazyView {
                            NPSSurveysView()
                        }
                    } label: {
                        Label("Feedback surveys", systemImage: "bubble.left.and.bubble.right")
                    }
                    .frame(minHeight: 44)
                    .disabled(auth.isScaffoldSession || !auth.isAuthenticated)
                    .accessibilityHint("Answer pending Net Promoter Score surveys")
                    .accessibilityIdentifier("account.row.feedbackSurveys")

                    NavigationLink {
                        LazyView {
                            SavingsView()
                        }
                    } label: {
                        Label("Savings", systemImage: "chart.line.uptrend.xyaxis")
                    }
                    .frame(minHeight: 44)
                    .disabled(auth.isScaffoldSession || !auth.isAuthenticated)
                    .accessibilityHint("View lifetime reverse-auction savings versus market median")
                    .accessibilityIdentifier("account.row.savings")

                    NavigationLink {
                        LazyView {
                            MarketsView()
                        }
                    } label: {
                        Label("Markets", systemImage: "building.2")
                    }
                    .frame(minHeight: 44)
                    .accessibilityHint("Browse launched city markets for services and goods")
                    .accessibilityIdentifier("account.row.markets")

                    NavigationLink {
                        LazyView {
                            FairPriceIndexView()
                        }
                    } label: {
                        Label("Fair price index", systemImage: "chart.line.uptrend.xyaxis")
                    }
                    .frame(minHeight: 44)
                    .accessibilityHint("Look up market median and p25–p75 bands by category")
                    .accessibilityIdentifier("account.row.fairPrice")

                    NavigationLink {
                        LazyView {
                            MarketplaceMapView()
                        }
                    } label: {
                        Label("Marketplace map", systemImage: "map")
                    }
                    .frame(minHeight: 44)
                    .accessibilityHint("Browse local goods auctions on a map")
                    .accessibilityIdentifier("account.row.marketplaceMap")

                    NavigationLink {
                        LazyView {
                            TrustTiersView()
                        }
                    } label: {
                        Label("Trust tiers", systemImage: "shield.lefthalf.filled")
                    }
                    .frame(minHeight: 44)
                    .accessibilityHint("How provider trust scores and ladder requirements work")
                    .accessibilityIdentifier("account.row.trustTiers")
                } header: {
                    Text("Network & safety").brandSectionHeader()
                }

                Section {
                    Button {
                        legalSheet = LegalSheetTarget(title: "Privacy Policy", url: AppConfig.privacyURL)
                    } label: {
                        Label("Privacy Policy", systemImage: "hand.raised")
                    }
                    .frame(minHeight: 44)
                    .accessibilityIdentifier("account.row.privacyPolicy")
                    Button {
                        legalSheet = LegalSheetTarget(title: "Terms of Service", url: AppConfig.termsURL)
                    } label: {
                        Label("Terms of Service", systemImage: "doc.text")
                    }
                    .frame(minHeight: 44)
                    .accessibilityIdentifier("account.row.termsOfService")
                    NavigationLink {
                        LazyView {
                            TermsAcceptanceView()
                        }
                    } label: {
                        Label("Terms acceptance", systemImage: "checkmark.seal")
                    }
                    .frame(minHeight: 44)
                    .disabled(auth.isScaffoldSession || !auth.isAuthenticated)
                    .accessibilityHint("Compare current Terms version with what you accepted")
                    .accessibilityIdentifier("account.row.termsAcceptance")
                    Button {
                        legalSheet = LegalSheetTarget(
                            title: "Community Guidelines",
                            url: AppConfig.communityGuidelinesURL
                        )
                    } label: {
                        Label("Community Guidelines", systemImage: "person.3")
                    }
                    .frame(minHeight: 44)
                    .accessibilityIdentifier("account.row.communityGuidelines")
                    Button {
                        legalSheet = LegalSheetTarget(title: "Support", url: AppConfig.supportURL)
                    } label: {
                        Label("Support", systemImage: "lifepreserver")
                    }
                    .frame(minHeight: 44)
                    .accessibilityIdentifier("account.row.support")
                    VStack(alignment: .leading, spacing: 6) {
                        Label("Widgets & Live Activities", systemImage: "rectangle.on.rectangle")
                        Text(
                            "Long-press the Home Screen, tap Edit, then Widgets, and add NoMarkup. Active Bids and Next Closing show your auctions. Live Activities appear on the Lock Screen after you place a bid. On iOS 18 you can add NoMarkup controls in Control Center."
                        )
                        .font(.caption)
                        .foregroundStyle(BrandTheme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                    }
                    .frame(minHeight: 44, alignment: .leading)
                    .accessibilityElement(children: .combine)
                    .accessibilityIdentifier("account.row.widgets")
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
                    .accessibilityIdentifier("account.row.exportData")

                    if let exportMessage {
                        Text(exportMessage)
                            .font(.footnote)
                            .foregroundStyle(exportIsError ? BrandTheme.destructive : BrandTheme.textSecondary)
                    }

                    NavigationLink {
                        LazyView {
                            AccountDeletionView()
                        }
                    } label: {
                        Label("Delete Account", systemImage: "trash")
                            .foregroundStyle(BrandTheme.destructive)
                    }
                    .frame(minHeight: 44)
                    .disabled(auth.isScaffoldSession || !auth.isAuthenticated)
                    .accessibilityIdentifier("account.row.deleteAccount")
                } header: {
                    Text("Your data").brandSectionHeader()
                }

                Section {
                    NavigationLink {
                        LazyView {
                            PlanLimitsView()
                        }
                    } label: {
                        Label("Plan limits", systemImage: "list.bullet.rectangle")
                    }
                    .frame(minHeight: 44)
                    .accessibilityHint(AppConfig.storeKitEnabled
                        ? "Compare plan limits and subscribe with In-App Purchase when products are available."
                        : "Compare free launch limits and read-only paid tiers. Digital plans are not sold in this app.")
                    .accessibilityIdentifier("account.row.planLimits")

                    NavigationLink {
                        LazyView {
                            RegulatedRailsStatusView()
                        }
                    } label: {
                        Label("Feature flag status", systemImage: "flag")
                    }
                    .frame(minHeight: 44)
                    .accessibilityHint("Diagnostic ON/OFF for regulated rails. Off in this App Store build until licensed.")
                    .accessibilityIdentifier("account.row.featureFlags")

                    if hasAdminRole {
                        NavigationLink {
                            LazyView {
                                AdminConsoleView()
                            }
                        } label: {
                            Label("Admin console", systemImage: "shield.checkered")
                        }
                        .frame(minHeight: 44)
                        .disabled(auth.isScaffoldSession || !auth.isAuthenticated)
                        .accessibilityHint("Platform admin: flags, disputes, users, reports, fraud")
                        .accessibilityIdentifier("account.row.admin")
                    }

                    Text(AppConfig.storeKitEnabled
                        ? "Digital Pro / Business plans use App Store In-App Purchase when enabled. BNPL, insurance, advances, and instant payout are off in this App Store build until licensed."
                        : "Digital plans are included free for launch in this app (no In-App Purchase, no web digital upgrade). BNPL, insurance, advances, and instant payout are off in this App Store build until licensed.")
                        .font(.caption)
                        .foregroundStyle(BrandTheme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                } header: {
                    Text("Subscriptions").brandSectionHeader()
                }

                Section {
                    LabeledContent("Version") {
                        Text("\(AppConfig.shortVersion) (\(AppConfig.buildNumber))")
                            .font(.body.monospacedDigit())
                            .foregroundStyle(BrandTheme.textSecondary)
                    }
                    LabeledContent("API") {
                        Text(AppConfig.apiBaseHostDisplay)
                            .font(.caption.monospaced())
                            .foregroundStyle(BrandTheme.goldBright)
                    }
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
            // Floating iOS 26 tab bar overlays the last List rows (same as JobDetailView).
            .brandTabBarClearance()
            .navigationTitle("Account")
            .brandNavigationBarChrome()
            .keepRootTabBarVisible()
            .confirmationDialog(
                "Sign out of this device?",
                isPresented: $confirmSignOut,
                titleVisibility: .visible
            ) {
                Button("Sign out", role: .destructive) {
                    // Device unregister + widget wipe run inside signOut()
                    // (IOS-SYS.NT.4 / OBS-3) so every sign-out path is covered.
                    auth.signOut()
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("You’ll need your password to sign back in. Active bids stay on the account.")
            }
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
            .sheet(item: $legalSheet) { target in
                LegalWebView(title: target.title, url: target.url)
                    .ignoresSafeArea()
            }
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
    /// Also refreshes admin-role gate for the Admin console row.
    @MainActor
    private func refreshOnboardingBanner() async {
        guard auth.isAuthenticated, !auth.isScaffoldSession else {
            profileNeedsSetup = false
            hasAdminRole = false
            return
        }
        do {
            let me = try await APIClient.shared.fetchMe()
            profileNeedsSetup = me.isOnboardingIncomplete
            hasAdminRole = me.hasAdminRole
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

/// Sheet target for Privacy / Terms / Guidelines / Support (`SFSafariViewController`).
private struct LegalSheetTarget: Identifiable {
    let id = UUID()
    let title: String
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
