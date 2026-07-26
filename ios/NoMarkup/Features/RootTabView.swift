import SwiftUI

/// Primary signed-in chrome: Home, Marketplace, Jobs, Messages, Account.
/// Native TabView — not a WKWebView of the website (App Store Guideline 4.2).
struct RootTabView: View {
    @State private var selectedTab: Tab = .home

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

            MarketplaceView()
                .tabItem { Label("Marketplace", systemImage: "bag.fill") }
                .tag(Tab.marketplace)

            JobsView()
                .tabItem { Label("Jobs", systemImage: "wrench.and.screwdriver.fill") }
                .tag(Tab.jobs)

            MessagesView()
                .tabItem { Label("Messages", systemImage: "bubble.left.and.bubble.right.fill") }
                .tag(Tab.messages)

            AccountView()
                .tabItem { Label("Account", systemImage: "person.crop.circle.fill") }
                .tag(Tab.account)
        }
    }
}

#Preview {
    RootTabView()
        .environmentObject(AuthViewModel())
}
