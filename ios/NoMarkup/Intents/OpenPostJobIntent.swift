import AppIntents
import Foundation

/// Opens the native post-job flow (IOS-SYS.AI.1 / INT.7).
struct OpenPostJobIntent: AppIntent {
    static var title: LocalizedStringResource { "Post a Job" }
    static var description: IntentDescription { IntentDescription("Start a new reverse-auction service job on NoMarkup.") }
    static var openAppWhenRun: Bool { true }

    @MainActor
    func perform() async throws -> some IntentResult {
        DeepLinkRouter.shared.open(.postJob)
        return .result()
    }
}
