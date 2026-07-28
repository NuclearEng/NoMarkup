import AppIntents
import Foundation

/// Siri / Shortcuts phrases for NoMarkup App Intents (IOS-SYS.AI.1).
struct NoMarkupAppShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: OpenMyBidsIntent(),
            phrases: [
                "Open my bids in \(.applicationName)",
                "Show my bids in \(.applicationName)",
                "My bids on \(.applicationName)",
            ],
            shortTitle: "My Bids",
            systemImageName: "hammer.fill"
        )
        AppShortcut(
            intent: OpenWatchlistIntent(),
            phrases: [
                "Open my watchlist in \(.applicationName)",
                "Show watchlist in \(.applicationName)",
                "What am I watching on \(.applicationName)",
            ],
            shortTitle: "Watchlist",
            systemImageName: "eye.fill"
        )
        AppShortcut(
            intent: CheckInToJobIntent(),
            phrases: [
                "Check in to job with \(.applicationName)",
                "Job site check in on \(.applicationName)",
                "Check in with \(.applicationName)",
            ],
            shortTitle: "Check In",
            systemImageName: "mappin.and.ellipse"
        )
        AppShortcut(
            intent: OpenPostJobIntent(),
            phrases: [
                "Post a job on \(.applicationName)",
                "New job on \(.applicationName)",
                "Create a job with \(.applicationName)",
            ],
            shortTitle: "Post Job",
            systemImageName: "plus.circle.fill"
        )
    }
}
