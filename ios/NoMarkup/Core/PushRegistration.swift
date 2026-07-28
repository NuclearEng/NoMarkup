import Foundation
import UIKit
import UserNotifications

/// APNs authorization + device-token registration with the NoMarkup gateway.
///
/// Permission policy (NT.2 / DES.8):
/// - Never auto-request on login.
/// - On login / cold session: if already authorized, re-register the device token only.
/// - Request after a value moment (first bid / first watchlist add) or Account settings toggle.
///
/// Flow once authorized:
/// 1. `UIApplication.registerForRemoteNotifications`
/// 2. `AppDelegate` receives the device token → `didReceiveDeviceToken`
/// 3. `POST /api/v1/notifications/devices` with platform `ios` (raw APNs hex)
@MainActor
final class PushRegistration: NSObject, ObservableObject {
    static let shared = PushRegistration()

    @Published private(set) var authorizationStatus: UNAuthorizationStatus = .notDetermined
    @Published private(set) var lastError: String?
    @Published private(set) var isRegisteredWithServer = false
    /// When true, host UI should show `NotificationPermissionCopy` pre-prompt, then call `confirmPrePrompt()`.
    @Published var shouldShowPermissionPrePrompt = false

    /// Hex APNs token (empty until system grants + delivers a token).
    private(set) var deviceTokenHex: String?
    private var pendingServerSync = false
    private var deviceID: String {
        UIDevice.current.identifierForVendor?.uuidString ?? UUID().uuidString
    }

    private override init() {
        super.init()
    }

    /// Configure notification center delegate, categories, and refresh auth status.
    func configure() {
        UNUserNotificationCenter.current().delegate = self
        registerNotificationCategories()
        Task { await refreshAuthorizationStatus() }
    }

    // MARK: - Public API (no login-time spam)

    /// After sign-in: re-register device if already authorized. Does **not** show the system prompt.
    func syncIfAuthorized(isAuthenticated: Bool, isScaffold: Bool) {
        guard isAuthenticated, !isScaffold else { return }
        Task {
            await refreshAuthorizationStatus()
            switch authorizationStatus {
            case .authorized, .provisional, .ephemeral:
                UIApplication.shared.registerForRemoteNotifications()
                await syncTokenWithServerIfNeeded()
            case .denied, .notDetermined:
                break
            @unknown default:
                break
            }
        }
    }

    /// Value moment (first bid placed, first watchlist add): pre-prompt if undetermined,
    /// register if already authorized. Never forces a second system dialog when denied.
    func noteValueMoment() {
        Task {
            await refreshAuthorizationStatus()
            switch authorizationStatus {
            case .authorized, .provisional, .ephemeral:
                UIApplication.shared.registerForRemoteNotifications()
                await syncTokenWithServerIfNeeded()
            case .notDetermined:
                shouldShowPermissionPrePrompt = true
            case .denied:
                lastError = NotificationPermissionCopy.deniedStatus
            @unknown default:
                break
            }
        }
    }

    /// Explicit Account / preferences toggle — same as value moment.
    func requestFromSettings() {
        noteValueMoment()
    }

    /// User confirmed the in-app pre-prompt → system authorization sheet.
    func confirmPrePrompt() {
        shouldShowPermissionPrePrompt = false
        Task {
            let granted = await requestAuthorizationIfNeeded()
            guard granted else { return }
            UIApplication.shared.registerForRemoteNotifications()
            await syncTokenWithServerIfNeeded()
        }
    }

    /// User dismissed the pre-prompt without requesting.
    func dismissPrePrompt() {
        shouldShowPermissionPrePrompt = false
    }

    /// Called from `AppDelegate` when APNs returns a device token.
    func didReceiveDeviceToken(_ deviceToken: Data) {
        let hex = deviceToken.map { String(format: "%02x", $0) }.joined()
        deviceTokenHex = hex
        pendingServerSync = true
        Task { await syncTokenWithServerIfNeeded() }
    }

    /// Called from `AppDelegate` when APNs registration fails.
    func didFailToRegister(error: Error) {
        lastError = error.localizedDescription
    }

    /// Clear app icon badge (NT.5) — call on become-active and mark-all-read.
    func clearBadge() {
        UNUserNotificationCenter.current().setBadgeCount(0) { error in
            if let error {
                // Best-effort; badge clear must not crash.
                Task { @MainActor in
                    self.lastError = error.localizedDescription
                }
            }
        }
    }

    /// Sign-out: DELETE device on gateway (best-effort), then clear local session flags.
    /// Call **before** `auth.signOut()` so the access token is still in the keychain.
    func unregisterAndReset() async {
        let token = deviceTokenHex
        let id = deviceID
        // Prefer APNs token; gateway DELETE matches token OR device_id.
        let key = (token?.isEmpty == false) ? token! : id
        if let access = try? KeychainTokenStore().read(.accessToken), !access.isEmpty {
            try? await APIClient.shared.unregisterPushDevice(deviceTokenOrID: key)
        }
        isRegisteredWithServer = false
        pendingServerSync = false
        lastError = nil
        shouldShowPermissionPrePrompt = false
    }

    /// Clear local registration flag only (when keychain already cleared).
    func resetSessionState() {
        isRegisteredWithServer = false
        pendingServerSync = deviceTokenHex != nil
        lastError = nil
        shouldShowPermissionPrePrompt = false
    }

    var isDenied: Bool {
        authorizationStatus == .denied
    }

    var isAuthorized: Bool {
        switch authorizationStatus {
        case .authorized, .provisional, .ephemeral:
            return true
        default:
            return false
        }
    }

    // MARK: - Categories (NT.3)

    /// Category action identifiers — shared by registration and `didReceive` branching.
    nonisolated static var viewActionIdentifier: String { "VIEW" }
    nonisolated static var dismissActionIdentifier: String { "DISMISS" }

    private func registerNotificationCategories() {
        let viewAction = UNNotificationAction(
            identifier: Self.viewActionIdentifier,
            title: "View",
            options: [.foreground]
        )
        let dismissAction = UNNotificationAction(
            identifier: Self.dismissActionIdentifier,
            title: "Dismiss",
            options: [.destructive]
        )

        let categories: Set<UNNotificationCategory> = [
            UNNotificationCategory(
                identifier: "bid_outbid",
                actions: [viewAction, dismissAction],
                intentIdentifiers: [],
                options: []
            ),
            UNNotificationCategory(
                identifier: "bid_awarded",
                actions: [viewAction],
                intentIdentifiers: [],
                options: []
            ),
            UNNotificationCategory(
                identifier: "auction_closing_soon",
                actions: [viewAction],
                intentIdentifiers: [],
                options: []
            ),
            UNNotificationCategory(
                identifier: "contract_created",
                actions: [viewAction],
                intentIdentifiers: [],
                options: []
            ),
        ]
        UNUserNotificationCenter.current().setNotificationCategories(categories)
    }

    // MARK: - Private

    func refreshAuthorizationStatus() async {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        authorizationStatus = settings.authorizationStatus
    }

    private func requestAuthorizationIfNeeded() async -> Bool {
        await refreshAuthorizationStatus()
        switch authorizationStatus {
        case .authorized, .provisional, .ephemeral:
            return true
        case .denied:
            lastError = NotificationPermissionCopy.deniedStatus
            return false
        case .notDetermined:
            do {
                let granted = try await UNUserNotificationCenter.current().requestAuthorization(
                    options: [.alert, .badge, .sound]
                )
                await refreshAuthorizationStatus()
                if !granted {
                    lastError = NotificationPermissionCopy.deniedStatus
                }
                return granted
            } catch {
                lastError = error.localizedDescription
                return false
            }
        @unknown default:
            return false
        }
    }

    private func syncTokenWithServerIfNeeded() async {
        guard let token = deviceTokenHex, !token.isEmpty else { return }
        // Only register when we have a real session token available.
        guard let access = try? KeychainTokenStore().read(.accessToken), !access.isEmpty else {
            pendingServerSync = true
            return
        }

        do {
            _ = try await APIClient.shared.registerPushDevice(
                deviceToken: token,
                deviceID: deviceID,
                platform: "ios"
            )
            isRegisteredWithServer = true
            pendingServerSync = false
            lastError = nil
        } catch {
            pendingServerSync = true
            lastError = error.localizedDescription
        }
    }
}

// MARK: - UNUserNotificationCenterDelegate

extension PushRegistration: UNUserNotificationCenterDelegate {
    /// Foreground presentation (NT.6): sound for bid/auction urgency; silent banner for promotional/price_drop.
    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        let userInfo = notification.request.content.userInfo
        let type = Self.notificationType(from: userInfo)
        if Self.shouldPlaySound(for: type) {
            completionHandler([.banner, .sound, .badge])
        } else {
            completionHandler([.banner, .badge])
        }
    }

    /// Tap / action routing (NT.3) → deep link router.
    ///
    /// Branches on `response.actionIdentifier`: only the default tap and the
    /// foreground VIEW action deep-link (and clear the badge on that open). The
    /// destructive DISMISS action — and any other non-opening identifier — is an
    /// acknowledgement: it must never navigate, and the badge stays (the server
    /// computes it from the unread count, which dismissing does not change).
    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        guard Self.shouldDeepLink(forActionIdentifier: response.actionIdentifier) else {
            completionHandler()
            return
        }
        let userInfo = response.notification.request.content.userInfo
        let actionURL = Self.actionURL(from: userInfo)
        // Route on MainActor, then complete on this isolation so the non-Sendable
        // completion handler is not sent across actors (Swift 6).
        Task { @MainActor in
            if let actionURL {
                DeepLinkRouter.shared.open(actionURL: actionURL)
                NotificationCenter.default.post(
                    name: .noMarkupOpenNotificationDeepLink,
                    object: nil,
                    userInfo: ["action_url": actionURL]
                )
            }
            PushRegistration.shared.clearBadge()
        }
        completionHandler()
    }

    /// NT.3: whether a notification response should open the deep-linked surface.
    /// True only for the system default tap and the explicit VIEW action; DISMISS
    /// (destructive category action), the system dismiss identifier, and unknown
    /// future action identifiers never navigate.
    nonisolated static func shouldDeepLink(forActionIdentifier identifier: String) -> Bool {
        switch identifier {
        case UNNotificationDefaultActionIdentifier, viewActionIdentifier:
            return true
        default:
            return false
        }
    }

    nonisolated private static func notificationType(from userInfo: [AnyHashable: Any]) -> String {
        if let type = userInfo["type"] as? String { return type.lowercased() }
        if let aps = userInfo["aps"] as? [String: Any], let cat = aps["category"] as? String {
            return cat.lowercased()
        }
        return (userInfo["category"] as? String)?.lowercased() ?? ""
    }

    nonisolated private static func actionURL(from userInfo: [AnyHashable: Any]) -> String? {
        if let url = userInfo["action_url"] as? String, !url.isEmpty { return url }
        if let url = userInfo["actionUrl"] as? String, !url.isEmpty { return url }
        // Nested data (FCM-style) if present.
        if let data = userInfo["data"] as? [String: Any] {
            if let url = data["action_url"] as? String, !url.isEmpty { return url }
        }
        return nil
    }

    /// Sound for competitive / time-sensitive types; silent for soft promotional (NT.6).
    nonisolated private static func shouldPlaySound(for type: String) -> Bool {
        switch type {
        case "bid_outbid", "bid_awarded", "auction_closing_soon", "auction_closed",
             "new_bid", "contract_created", "contract_accepted", "payment_failed",
             "new_message":
            return true
        case "price_drop", "seller_new_listing", "welcome_day_1", "welcome_day_3",
             "welcome_day_7", "promotional", "marketing":
            return false
        default:
            // Unknown: soft banner only (avoid noisy marketing).
            return type.isEmpty ? true : false
        }
    }
}

// MARK: - UIApplicationDelegate adaptor

/// Thin adaptor so APNs device-token callbacks reach `PushRegistration`.
final class NoMarkupAppDelegate: NSObject, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        Task { @MainActor in
            PushRegistration.shared.configure()
        }
        return true
    }

    func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        Task { @MainActor in
            PushRegistration.shared.didReceiveDeviceToken(deviceToken)
        }
    }

    func application(
        _ application: UIApplication,
        didFailToRegisterForRemoteNotificationsWithError error: Error
    ) {
        Task { @MainActor in
            PushRegistration.shared.didFailToRegister(error: error)
        }
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        Task { @MainActor in
            PushRegistration.shared.clearBadge()
            await PushRegistration.shared.refreshAuthorizationStatus()
        }
    }
}
