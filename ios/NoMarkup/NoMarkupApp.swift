import SwiftUI

@main
struct NoMarkupApp: App {
    @StateObject private var authViewModel = AuthViewModel()
    @StateObject private var featureFlags = FeatureFlags()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(authViewModel)
                .environmentObject(featureFlags)
                // Brand gold from AccentColor.colorset (web --brand-gold: #c9a84c / #d4af57).
                .tint(Color("AccentColor"))
                .task {
                    await featureFlags.refresh()
                }
        }
    }
}

/// Chooses signed-in chrome vs login shell.
/// `FeatureFlags` is injected at the app root and available to all descendants.
struct RootView: View {
    @EnvironmentObject private var auth: AuthViewModel

    var body: some View {
        Group {
            if auth.isAuthenticated {
                RootTabView()
            } else {
                LoginView()
            }
        }
        .animation(.easeInOut(duration: 0.2), value: auth.isAuthenticated)
    }
}
