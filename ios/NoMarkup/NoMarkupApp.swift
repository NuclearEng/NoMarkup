import SwiftUI

@main
struct NoMarkupApp: App {
    @UIApplicationDelegateAdaptor(NoMarkupAppDelegate.self) private var appDelegate
    @StateObject private var authViewModel = AuthViewModel()
    @StateObject private var featureFlags = FeatureFlags()

    init() {
        // Navy + gold chrome for TabView / NavigationStack / lists (matches web dark terminal).
        // DES.4/9: iOS 26+ scroll-edge stays system/Liquid Glass (see BrandTheme.applyGlobalChrome).
        BrandTheme.applyGlobalChrome()
        // IOS-PERF.3: bounded URLCache for AsyncImage / default URL loading + purge on memory pressure.
        ImageUploader.configureCache()
        ImageUploader.installMemoryWarningPurge()
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(authViewModel)
                .environmentObject(featureFlags)
                .environmentObject(PushRegistration.shared)
                .environmentObject(DeepLinkRouter.shared)
                .environmentObject(NetworkMonitor.shared)
                // Brand gold from AccentColor.colorset (showcase --gold: #c9a84c).
                .tint(BrandTheme.accent)
                // DES.3: follow system light/dark — brand surfaces still paint navy/gold explicitly.
                // (Previously forced .dark; removed so appearance + Dynamic Type adapt.)
                .task {
                    await featureFlags.refresh()
                    // Rail B: only listens / refreshes when AppConfig.storeKitEnabled.
                    StoreKitManager.shared.startIfEnabled()
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
///
/// Push permission is **not** requested on login (NT.2 / DES.8). We only re-sync an
/// already-authorized device token; the system dialog is reserved for value moments
/// (first bid / watchlist) or Account settings.
struct RootView: View {
    @EnvironmentObject private var auth: AuthViewModel
    @EnvironmentObject private var push: PushRegistration
    @EnvironmentObject private var network: NetworkMonitor
    @EnvironmentObject private var featureFlags: FeatureFlags
    @EnvironmentObject private var deepLinks: DeepLinkRouter
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// Optional app lock when "Require Face ID for sensitive actions" is on (IOS-SEC.7).
    @State private var isBiometricallyUnlocked = !BiometricGate.requireForSensitiveActions

    var body: some View {
        Group {
            if auth.isAuthenticated {
                ZStack {
                    RootTabView()
                    if BiometricGate.requireForSensitiveActions, !isBiometricallyUnlocked {
                        biometricLockOverlay
                    }
                }
            } else {
                LoginView()
            }
        }
        // A11Y.3 — gate chrome transitions when Reduce Motion is on.
        .animation(BrandTheme.animation(.easeInOut(duration: 0.2), reduceMotion: reduceMotion), value: auth.isAuthenticated)
        // 18+ age gate for signed-in sessions (server-authoritative DOB via PUT /me/dob).
        .ageGateWhenNeeded()
        .safeAreaInset(edge: .top, spacing: 0) {
            if !network.isOnline {
                OfflineNetworkBanner()
                    .transition(
                        reduceMotion
                            ? .opacity
                            : .move(edge: .top).combined(with: .opacity)
                    )
            }
        }
        .animation(BrandTheme.animation(.easeInOut(duration: 0.25), reduceMotion: reduceMotion), value: network.isOnline)
        .onOpenURL { url in
            _ = deepLinks.handle(url: url)
        }
        .onChange(of: auth.isAuthenticated) { _, isAuthed in
            if isAuthed {
                isBiometricallyUnlocked = !BiometricGate.requireForSensitiveActions
                // No system permission spam — register only if already authorized.
                push.syncIfAuthorized(
                    isAuthenticated: true,
                    isScaffold: auth.isScaffoldSession
                )
            } else {
                push.resetSessionState()
                isBiometricallyUnlocked = true
            }
        }
        .onChange(of: auth.isScaffoldSession) { _, isScaffold in
            if auth.isAuthenticated, !isScaffold {
                push.syncIfAuthorized(
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
            // Cold launch with restored session — sync APNs if already authorized (no prompt).
            push.syncIfAuthorized(
                isAuthenticated: auth.isAuthenticated,
                isScaffold: auth.isScaffoldSession
            )
            // IOS-SYS.LA.1: end Live Activities whose auctions already closed (stale
            // after relaunch). Controller self-guards ActivityKit availability, same
            // pattern as the bid-path `startOrUpdate` call sites.
            AuctionLiveActivityController.sweepStaleActivities()
            if auth.isAuthenticated, BiometricGate.requireForSensitiveActions, !isBiometricallyUnlocked {
                await unlockWithBiometrics()
            }
            // IOS-SYS.WD.3: refresh the widget snapshot with the real active-bid count
            // once a session is established (cold launch or fresh sign-in). Best-effort.
            if auth.isAuthenticated, !auth.isScaffoldSession {
                await refreshWidgetBidSnapshot()
            }
        }
        .task {
            // DEBUG/UITest: env-driven auto-login after restore settles.
            _ = await auth.applyLaunchTestCredentialsIfNeeded()
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active {
                push.clearBadge()
            }
            guard auth.isAuthenticated, BiometricGate.requireForSensitiveActions else { return }
            if phase == .background {
                isBiometricallyUnlocked = false
            } else if phase == .active, !isBiometricallyUnlocked {
                Task { await unlockWithBiometrics() }
            }
        }
        .alert(
            NotificationPermissionCopy.prePromptTitle,
            isPresented: Binding(
                get: { push.shouldShowPermissionPrePrompt },
                set: { if !$0 { push.dismissPrePrompt() } }
            )
        ) {
            Button(NotificationPermissionCopy.prePromptConfirm) {
                push.confirmPrePrompt()
            }
            Button(NotificationPermissionCopy.prePromptNotNow, role: .cancel) {
                push.dismissPrePrompt()
            }
        } message: {
            Text(NotificationPermissionCopy.prePromptBody)
        }
    }

    private var biometricLockOverlay: some View {
        ZStack {
            BrandTheme.navy.ignoresSafeArea()
            VStack(spacing: 20) {
                Image(systemName: "lock.fill")
                    .font(.largeTitle.weight(.semibold))
                    .imageScale(.large)
                    .foregroundStyle(BrandTheme.gold)
                    .accessibilityHidden(true)
                Text("NoMarkup is locked")
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(BrandTheme.textPrimary)
                Text("Use \(BiometricGate.biometryDisplayName) to continue.")
                    .font(.subheadline)
                    .foregroundStyle(BrandTheme.textSecondary)
                    .multilineTextAlignment(.center)
                Button {
                    Task { await unlockWithBiometrics() }
                } label: {
                    Text("Unlock")
                        .fontWeight(.semibold)
                        .frame(maxWidth: 240)
                        .frame(minHeight: 48)
                }
                .buttonStyle(.borderedProminent)
                .tint(BrandTheme.accent)
                .foregroundStyle(BrandTheme.ctaLabelOnGold)
                .accessibilityIdentifier("lock.unlock")
            }
            .padding(32)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("lock.overlay")
    }

    private func unlockWithBiometrics() async {
        let ok = await BiometricGate.authenticate(
            reason: "Unlock NoMarkup to view your account and bids."
        )
        isBiometricallyUnlocked = ok
    }

    /// IOS-SYS.WD.3: cold-launch widget snapshot — count distinct auctions with an
    /// active bid via the same endpoints `MyBidsView.load()` uses. Failure-tolerant:
    /// when both calls fail (offline), the last snapshot is left untouched.
    private func refreshWidgetBidSnapshot() async {
        var auctionIDs = Set<String>()
        var sawResponse = false

        if let goods = try? await APIClient.shared.fetchMyListingBids(page: 1, pageSize: 40) {
            sawResponse = true
            for entry in goods.bids {
                guard let listingID = entry.listingIdForAPI,
                      let endsISO = entry.listing?.auctionEndsAt,
                      let endsAt = CatalogDateFormat.parseISO(endsISO),
                      endsAt > Date()
                else { continue }
                auctionIDs.insert("listing:\(listingID)")
            }
        }

        if let services = try? await APIClient.shared.fetchMyJobBids(page: 1, pageSize: 40) {
            sawResponse = true
            for bid in services.bids where bid.isWithdrawable {
                auctionIDs.insert("job:\(bid.jobId ?? bid.id)")
            }
        }

        if sawResponse {
            WidgetSharedStore.setActiveBidCount(auctionIDs.count)
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
        .background(BrandTheme.warningFill)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("banner.offline")
        .accessibilityAddTraits(.isStaticText)
    }
}
