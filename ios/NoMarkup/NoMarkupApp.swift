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
                .environmentObject(NetworkMonitor.shared)
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
///
/// Session expiry: `APIClient` posts `.noMarkupSessionExpired` → `AuthViewModel`
/// clears tokens and sets `isAuthenticated = false` → this view swaps to `LoginView`
/// and `onChange` below resets push registration state.
struct RootView: View {
    @EnvironmentObject private var auth: AuthViewModel
    @EnvironmentObject private var push: PushRegistration
    @EnvironmentObject private var network: NetworkMonitor
    @EnvironmentObject private var featureFlags: FeatureFlags

    var body: some View {
        Group {
            if auth.isAuthenticated {
                RootTabView()
            } else {
                LoginView()
            }
        }
        .animation(.easeInOut(duration: 0.2), value: auth.isAuthenticated)
        // 18+ age gate for signed-in sessions (server-authoritative DOB via PUT /me/dob).
        .ageGateWhenNeeded()
        .safeAreaInset(edge: .top, spacing: 0) {
            if !network.isOnline {
                OfflineNetworkBanner()
                    .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
        .animation(.easeInOut(duration: 0.25), value: network.isOnline)
        .onChange(of: auth.isAuthenticated) { _, isAuthed in
            if isAuthed {
                push.requestAndRegisterIfAuthenticated(
                    isAuthenticated: true,
                    isScaffold: auth.isScaffoldSession
                )
            } else {
                // Session expired / sign-out — tear down push session for the next login.
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
        .onReceive(NotificationCenter.default.publisher(for: .noMarkupAuthDidSucceed)) { _ in
            // Fresh login / register / MFA / SIWA — re-fetch flags for the new session.
            Task { await featureFlags.refresh() }
        }
        .task(id: auth.isAuthenticated) {
            // Cold launch with restored session — register for APNs once signed in.
            push.requestAndRegisterIfAuthenticated(
                isAuthenticated: auth.isAuthenticated,
                isScaffold: auth.isScaffoldSession
            )
        }
        .task {
            // DEBUG/UITest: env-driven auto-login after restore settles.
            _ = await auth.applyLaunchTestCredentialsIfNeeded()
        }
    }
}

/// Non-blocking top strip when the device path is unsatisfied.
private struct OfflineNetworkBanner: View {
    var body: some View {
        HStack(alignment: .center, spacing: 10) {
            Image(systemName: "wifi.slash")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(BrandTheme.ctaLabelOnGold)
                .accessibilityHidden(true)
            Text("You're offline — some actions won't work until connection returns.")
                .font(.subheadline.weight(.medium))
                .foregroundStyle(BrandTheme.ctaLabelOnGold)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(BrandTheme.warning)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("banner.offline")
        .accessibilityAddTraits(.isStaticText)
    }
}
