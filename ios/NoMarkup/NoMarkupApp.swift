import SwiftUI

@main
struct NoMarkupApp: App {
    @UIApplicationDelegateAdaptor(NoMarkupAppDelegate.self) private var appDelegate
    @StateObject private var authViewModel = AuthViewModel()
    @StateObject private var featureFlags = FeatureFlags()

    init() {
        // Navy + gold chrome for TabView / NavigationStack / lists (matches web dark terminal).
        BrandTheme.applyGlobalChrome()
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(authViewModel)
                .environmentObject(featureFlags)
                .environmentObject(PushRegistration.shared)
                // Brand gold from AccentColor.colorset (showcase --gold: #c9a84c).
                .tint(BrandTheme.accent)
                // Luxury shell is dark navy — force dark so system fills match brand, not light gray.
                .preferredColorScheme(.dark)
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
    @EnvironmentObject private var push: PushRegistration

    var body: some View {
        Group {
            if auth.isAuthenticated {
                RootTabView()
            } else {
                LoginView()
            }
        }
        .animation(.easeInOut(duration: 0.2), value: auth.isAuthenticated)
        .onChange(of: auth.isAuthenticated) { _, isAuthed in
            if isAuthed {
                push.requestAndRegisterIfAuthenticated(
                    isAuthenticated: true,
                    isScaffold: auth.isScaffoldSession
                )
            } else {
                push.resetSessionState()
            }
        }
        .onChange(of: auth.isScaffoldSession) { _, isScaffold in
            if auth.isAuthenticated, !isScaffold {
                push.requestAndRegisterIfAuthenticated(
                    isAuthenticated: true,
                    isScaffold: false
                )
            }
        }
        .task(id: auth.isAuthenticated) {
            // Cold launch with restored session — register for APNs once signed in.
            push.requestAndRegisterIfAuthenticated(
                isAuthenticated: auth.isAuthenticated,
                isScaffold: auth.isScaffoldSession
            )
        }
    }
}
