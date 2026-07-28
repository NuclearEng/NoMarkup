import AppIntents
import Foundation

/// Opens check-in flow for a job contract (IOS-SYS.AI.1 / INT.7).
///
/// With a contract ID, navigates to that contract (where GPS check-in lives).
/// Without one, opens Contracts / notifications so the user can pick a job.
struct CheckInToJobIntent: AppIntent {
    static var title: LocalizedStringResource { "Check In to Job" }
    static var description: IntentDescription {
        IntentDescription("Opens NoMarkup so you can check in at a job site for dispute protection.")
    }
    static var openAppWhenRun: Bool { true }

    @Parameter(title: "Contract ID", description: "Optional contract UUID to open directly.")
    var contractID: String?

    @MainActor
    func perform() async throws -> some IntentResult {
        let trimmed = contractID?.trimmingCharacters(in: .whitespacesAndNewlines)
        if let trimmed, !trimmed.isEmpty {
            DeepLinkRouter.shared.open(.checkIn(contractID: trimmed))
        } else {
            DeepLinkRouter.shared.open(.checkIn(contractID: nil))
        }
        return .result()
    }
}
