import Foundation
import UIKit
import UserNotifications

/// APNs authorization + device-token registration with the NoMarkup gateway.
///
/// Flow:
/// 1. Request notification permission (`UNUserNotificationCenter`).
/// 2. Call `UIApplication.registerForRemoteNotifications`.
/// 3. `AppDelegate` receives the device token → `didReceiveDeviceToken`.
/// 4. When authenticated, `POST /api/v1/notifications/devices` with platform `ios`.
@MainActor
final class PushRegistration: NSObject, ObservableObject {
    static let shared = PushRegistration()

    @Published private(set) var authorizationStatus: UNAuthorizationStatus = .notDetermined
    @Published private(set) var lastError: String?
    @Published private(set) var isRegisteredWithServer = false

    /// Hex APNs token (empty until system grants + delivers a token).
    private(set) var deviceTokenHex: String?
    private var pendingServerSync = false

    private override init() {
        super.init()
    }

    /// Configure notification center delegate and refresh auth status.
    func configure() {
        UNUserNotificationCenter.current().delegate = self
        Task { await refreshAuthorizationStatus() }
    }

    /// Request permission and register for remote notifications when the user is signed in.
    func requestAndRegisterIfAuthenticated(isAuthenticated: Bool, isScaffold: Bool) {
        guard isAuthenticated, !isScaffold else { return }
        Task {
            await refreshAuthorizationStatus()
            let granted = await requestAuthorizationIfNeeded()
            guard granted else { return }
            UIApplication.shared.registerForRemoteNotifications()
            // If we already have a token (re-login), sync immediately.
            await syncTokenWithServerIfNeeded()
        }
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

    /// Clear local registration flag on sign-out (server token may linger until expiry).
    func resetSessionState() {
        isRegisteredWithServer = false
        pendingServerSync = deviceTokenHex != nil
        lastError = nil
    }

    // MARK: - Private

    private func refreshAuthorizationStatus() async {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        authorizationStatus = settings.authorizationStatus
    }

    private func requestAuthorizationIfNeeded() async -> Bool {
        await refreshAuthorizationStatus()
        switch authorizationStatus {
        case .authorized, .provisional, .ephemeral:
            return true
        case .denied:
            lastError = "Notifications are disabled in Settings."
            return false
        case .notDetermined:
            do {
                let granted = try await UNUserNotificationCenter.current().requestAuthorization(
                    options: [.alert, .badge, .sound]
                )
                await refreshAuthorizationStatus()
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

        let deviceID = UIDevice.current.identifierForVendor?.uuidString
            ?? UUID().uuidString

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
    /// Show banners while the app is foregrounded.
    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.banner, .sound, .badge])
    }

    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        completionHandler()
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
}
