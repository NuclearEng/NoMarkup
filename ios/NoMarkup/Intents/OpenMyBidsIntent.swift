import AppIntents
import Foundation

/// Opens the My Bids surface (IOS-SYS.AI.1 / INT.7).
struct OpenMyBidsIntent: AppIntent {
    static var title: LocalizedStringResource { "Open My Bids" }
    static var description: IntentDescription { IntentDescription("Shows your active service and marketplace bids in NoMarkup.") }
    static var openAppWhenRun: Bool { true }

    @MainActor
    func perform() async throws -> some IntentResult {
        DeepLinkRouter.shared.open(.bids)
        return .result()
    }
}
