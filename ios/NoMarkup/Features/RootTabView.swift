import SwiftUI

/// Primary signed-in chrome: Home, Marketplace, Jobs, Messages, Account.
/// Native TabView — not a WKWebView of the website (App Store Guideline 4.2).
struct RootTabView: View {
    @EnvironmentObject private var auth: AuthViewModel
    @State private var selectedTab: Tab = .home
    /// Post-register guided setup (FR-1.5) — sheet, never blocks register completion.
    @State private var showOnboardingWizard = false

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
                .tabItem { Label("Home", systemImage: "house.fill") }
                .tag(Tab.home)
                .accessibilityIdentifier("tab.home")

            MarketplaceView()
                .tabItem { Label("Marketplace", systemImage: "bag.fill") }
                .tag(Tab.marketplace)
                .accessibilityIdentifier("tab.marketplace")

            JobsView()
                .tabItem { Label("Jobs", systemImage: "wrench.and.screwdriver.fill") }
                .tag(Tab.jobs)
                .accessibilityIdentifier("tab.jobs")

            MessagesView()
                .tabItem { Label("Messages", systemImage: "bubble.left.and.bubble.right.fill") }
                .tag(Tab.messages)
                .accessibilityIdentifier("tab.messages")

            AccountView()
                .tabItem { Label("Account", systemImage: "person.crop.circle.fill") }
                .tag(Tab.account)
                .accessibilityIdentifier("tab.account")
        }
        .environment(\.selectedRootTab, $selectedTab)
        .accessibilityIdentifier("root.tabview")
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
        }
        .sheet(isPresented: $showOnboardingWizard) {
            NavigationStack {
                OnboardingWizardView()
            }
            .environmentObject(auth)
            .preferredColorScheme(.dark)
            .tint(BrandTheme.accent)
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
}
