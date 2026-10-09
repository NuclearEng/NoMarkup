import AppIntents
import Foundation

/// Opens the My Bids surface (IOS-SYS.AI.1 / INT.7).
///
/// Returns the active bid count (INT.6c) read from the existing app-group widget
/// snapshot (`WidgetSharedStore`, read-only, no network) so the intent is
/// chainable in Shortcuts and Siri can speak a real answer while the app opens.
struct OpenMyBidsIntent: AppIntent {
    static var title: LocalizedStringResource { "Open My Bids" }
    static var description: IntentDescription { IntentDescription("Shows your active service and marketplace bids in NoMarkup.") }
    static var openAppWhenRun: Bool { true }

    /// Session source — injectable for tests; never refreshes tokens (INT.1).
    var session: any IntentSessionProviding = KeychainTokenStore()

    @MainActor
    func perform() async throws -> some IntentResult & ReturnsValue<Int> & ProvidesDialog {
        try IntentAuthGuard.requireSession(session)
        DeepLinkRouter.shared.open(.bids)
        let count = WidgetSharedStore.load().activeBidCount
        // L10N.5: plural via the string-catalog variation for "You have %lld active bids."
        let dialog: IntentDialog = "You have \(count) active bids."
        return .result(value: count, dialog: dialog)
    }
}
