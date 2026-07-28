import AppIntents
import Foundation

/// Opens the Watchlist surface (IOS-SYS.AI.1 / INT.7).
struct OpenWatchlistIntent: AppIntent {
    static var title: LocalizedStringResource { "Open Watchlist" }
    static var description: IntentDescription { IntentDescription("Shows jobs and listings you are watching in NoMarkup.") }
    static var openAppWhenRun: Bool { true }

    @MainActor
    func perform() async throws -> some IntentResult {
        DeepLinkRouter.shared.open(.watchlist)
        return .result()
    }
}
