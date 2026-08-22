import SwiftUI

/// Primary signed-in chrome: Home, Marketplace, Jobs, Messages, Account.
/// Native TabView — not a WKWebView of the website (App Store Guideline 4.2).
struct RootTabView: View {
    @EnvironmentObject private var auth: AuthViewModel
    @EnvironmentObject private var deepLinks: DeepLinkRouter
    @State private var selectedTab: Tab = .home
    /// Post-register guided setup (FR-1.5) — sheet, never blocks register completion.
    @State private var showOnboardingWizard = false
    /// Destination presented from APNs tap / notification deep link (string path).
    @State private var deepLinkSheetID: String?
    @State private var deepLinkSheetView: AnyView?
    /// Typed App Intent / custom-scheme sheet (bids, post job, watchlist, …).
    @State private var presentedRoute: DeepLinkRoute?
    /// FR-8.10 / FR-17.1 — tab-level unread badges (messages + notifications).
    @State private var messagesUnread = 0
    @State private var notificationsUnread = 0

    enum Tab: Hashable {
        case home
        case marketplace
        case jobs
        case messages
        case account
    }

    var body: some View {
        TabView(selection: $selectedTab) {
            HomeView()
                .tabItem { Label(String(localized: "Home"), systemImage: "house.fill") }
                .tag(Tab.home)
                .accessibilityIdentifier("tab.home")

            MarketplaceView()
                .tabItem { Label(String(localized: "Marketplace"), systemImage: "bag.fill") }
                .tag(Tab.marketplace)
                .accessibilityIdentifier("tab.marketplace")

            JobsView()
                .tabItem { Label(String(localized: "Jobs"), systemImage: "wrench.and.screwdriver.fill") }
                .tag(Tab.jobs)
                .accessibilityIdentifier("tab.jobs")

            MessagesView()
                .tabItem { Label(String(localized: "Messages"), systemImage: "bubble.left.and.bubble.right.fill") }
                .tag(Tab.messages)
                .badge(messagesUnread > 0 ? messagesUnread : 0)
                .accessibilityIdentifier("tab.messages")

            AccountView()
                .tabItem { Label(String(localized: "Account"), systemImage: "person.crop.circle.fill") }
                .tag(Tab.account)
                .badge(notificationsUnread > 0 ? notificationsUnread : 0)
                .accessibilityIdentifier("tab.account")
        }
        .environment(\.selectedRootTab, $selectedTab)
        .accessibilityIdentifier("root.tabview")
        .task(id: auth.isAuthenticated) {
            await refreshUnreadBadges()
        }
        .onChange(of: selectedTab) { _, tab in
            BrandHaptics.selection()
            ClientActionLog.shared.recordUI(method: "TAB", path: "tab.\(String(describing: tab))", kind: "ui")
            // Refresh when leaving messages/account so badges stay honest after reads.
            if tab != .messages && tab != .account {
                Task { await refreshUnreadBadges() }
            } else {
                Task { await refreshUnreadBadges() }
            }
        }
        .onChange(of: auth.shouldPresentOnboarding) { _, shouldShow in
            guard shouldShow, !auth.isScaffoldSession else { return }
            auth.shouldPresentOnboarding = false
            showOnboardingWizard = true
        }
        .onAppear {
            // Cover the race where register sets the flag before RootTabView mounts.
            if auth.shouldPresentOnboarding, !auth.isScaffoldSession {
                auth.shouldPresentOnboarding = false
                showOnboardingWizard = true
            }
            presentPendingDeepLink()
            if let route = deepLinks.route {
                handleTypedRoute(route)
            }
            Task { await refreshUnreadBadges() }
        }
        .onChange(of: deepLinks.pendingActionURL) { _, _ in
            presentPendingDeepLink()
        }
        .onChange(of: deepLinks.sequence) { _, _ in
            if let route = deepLinks.route {
                handleTypedRoute(route)
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: .noMarkupOpenNotificationDeepLink)) { note in
            if let url = note.userInfo?["action_url"] as? String {
                deepLinks.open(actionURL: url)
            }
        }
        .sheet(isPresented: $showOnboardingWizard) {
            NavigationStack {
                OnboardingWizardView()
            }
            .environmentObject(auth)
            .tint(BrandTheme.accent)
        }
        .sheet(isPresented: Binding(
            get: { deepLinkSheetView != nil },
            set: { if !$0 {
                deepLinkSheetView = nil
                deepLinkSheetID = nil
                deepLinks.clear()
            } }
        )) {
            NavigationStack {
                Group {
                    if let deepLinkSheetView {
                        deepLinkSheetView
                    } else {
                        EmptyView()
                    }
                }
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Done") {
                            deepLinkSheetView = nil
                            deepLinkSheetID = nil
                            deepLinks.clear()
                        }
                        .frame(minHeight: 44)
                    }
                }
            }
            .environmentObject(auth)
            .tint(BrandTheme.accent)
        }
        .sheet(item: $presentedRoute) { route in
            NavigationStack {
                typedDeepLinkDestination(for: route)
                    .toolbar {
                        ToolbarItem(placement: .cancellationAction) {
                            Button("Close") {
                                presentedRoute = nil
                                deepLinks.clear()
                            }
                            .frame(minHeight: 44)
                        }
                    }
            }
            .environmentObject(auth)
            .tint(BrandTheme.accent)
        }
    }

    /// Push / string-path path (NotificationDeepLink).
    private func presentPendingDeepLink() {
        guard let url = deepLinks.pendingActionURL else { return }

        // If we already have a typed route, prefer that presentation path.
        if let route = deepLinks.route {
            handleTypedRoute(route)
            return
        }

        let path = url.lowercased()
        if path.contains("/messages") || path.contains("/chat") || path.contains("/channels") {
            selectedTab = .messages
            deepLinks.clear()
            return
        }
        if let dest = NotificationDeepLink.destination(from: url) {
            deepLinkSheetID = dest.kindLabel + "-" + url
            deepLinkSheetView = dest.view
            deepLinks.clear()
        } else if let route = DeepLinkRouter.route(fromActionString: url) {
            handleTypedRoute(route)
        } else {
            deepLinks.clear()
        }
    }

    private func handleTypedRoute(_ route: DeepLinkRoute) {
        switch route {
        case .messages:
            selectedTab = .messages
            deepLinks.clear()
        case .jobsBrowse:
            selectedTab = .jobs
            deepLinks.clear()
        case .account:
            selectedTab = .account
            deepLinks.clear()
        case .job, .listing, .contract, .bids, .watchlist, .notifications, .postJob, .checkIn, .orders:
            switch route {
            case .bids, .watchlist, .notifications, .checkIn, .orders:
                selectedTab = .account
            case .postJob, .job:
                selectedTab = .jobs
            case .listing:
                selectedTab = .marketplace
            default:
                break
            }
            presentedRoute = route
            deepLinks.clear()
        }
    }

    /// FR-8.10 / FR-17.1 — poll inbox + notification unread for tab badges.
    /// IOS-SYS.NT.5: keep app icon badge aligned with notification unread.
    @MainActor
    private func refreshUnreadBadges() async {
        guard auth.isAuthenticated, !auth.isScaffoldSession else {
            messagesUnread = 0
            notificationsUnread = 0
            PushRegistration.shared.clearBadge()
            return
        }
        async let channelsTask = APIClient.shared.fetchChatChannels(page: 1, pageSize: 40)
        async let notifTask = APIClient.shared.fetchUnreadNotificationCount()
        do {
            let channels = try await channelsTask
            let total = channels.channels.reduce(0) { partial, ch in
                partial + max(0, ch.unreadCount ?? 0)
            }
            messagesUnread = total
        } catch {
            // Keep last known count on transient failure.
        }
        do {
            notificationsUnread = try await notifTask
            PushRegistration.shared.setBadgeCount(notificationsUnread)
        } catch {
            // Keep last known count.
        }
    }

    @ViewBuilder
    private func typedDeepLinkDestination(for route: DeepLinkRoute) -> some View {
        switch route {
        case .job(let id):
            JobDetailView(jobID: id)
        case .listing(let id):
            ListingDetailView(listingID: id)
        case .contract(let id):
            ContractDetailView(contractID: id)
        case .bids:
            MyBidsView()
        case .watchlist:
            WatchlistView()
        case .notifications:
            NotificationsView()
        case .postJob:
            PostJobView()
        case .jobsBrowse:
            // Browse is tab selection only — this case is exhaustive, never a sheet.
            JobsView()
        case .account:
            AccountView()
        case .checkIn(let contractID):
            if let contractID, !contractID.isEmpty {
                ContractDetailView(contractID: contractID, autoCheckInOnAppear: true)
            } else {
                ContractsView()
            }
        case .orders:
            // Same surface for list and detail — mirrors the NotificationDeepLink
            // fallback (`/orders*` → `MyOrdersView`); no order-detail init exists yet.
            MyOrdersView()
        case .messages:
            MessagesView()
        }
    }
}

// MARK: - Tab selection environment (Home deep links)

private struct SelectedRootTabKey: EnvironmentKey {
    static let defaultValue: Binding<RootTabView.Tab>? = nil
}

extension EnvironmentValues {
    /// When set by `RootTabView`, lets child views switch tabs (e.g. Home → Marketplace).
    var selectedRootTab: Binding<RootTabView.Tab>? {
        get { self[SelectedRootTabKey.self] }
        set { self[SelectedRootTabKey.self] = newValue }
    }
}

#Preview {
    RootTabView()
        .environmentObject(AuthViewModel())
        .environmentObject(DeepLinkRouter.shared)
}
