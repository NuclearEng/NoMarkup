import Foundation

/// Pre-prompt copy for notification permission (mirrors `LocationPurposeCopy`).
/// Value-moment approach: never spam the system dialog on login — ask after the
/// user places a first bid, watches a listing, or enables push in Account settings.
enum NotificationPermissionCopy {
    /// In-app pre-prompt title before the system authorization sheet.
    static let prePromptTitle = "Stay ahead on bids"

    /// In-app pre-prompt body — bid / outbid / auction closing value.
    static let prePromptBody =
        "Get alerts when you’re outbid, when an auction is about to close, or when a bid is awarded. You can change this anytime in Settings."

    /// Confirm button that proceeds to the system permission dialog.
    static let prePromptConfirm = "Enable notifications"

    /// Dismiss without requesting system permission.
    static let prePromptNotNow = "Not now"

    /// Account status when authorization is denied.
    static let deniedStatus =
        "Notifications are off. Enable them in iOS Settings to get outbid and auction alerts."

    /// Button that opens the system Settings app for this app.
    static let openSettings = "Open Settings"

    /// Account / preferences toggle affordance when not yet authorized.
    static let enableFromSettings = "Turn on push notifications"
}
