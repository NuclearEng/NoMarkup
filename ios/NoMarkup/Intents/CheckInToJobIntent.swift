import AppIntents
import Foundation

/// Job contract as an App Intents entity (INT.6b). The identifier is the contract
/// UUID — the same id `DeepLinkRouter` deep-links via `/contracts/{id}` / check-in.
struct ContractEntity: AppEntity {
    static var typeDisplayRepresentation: TypeDisplayRepresentation { "Contract" }
    static var defaultQuery: ContractEntityQuery { ContractEntityQuery() }

    /// Contract UUID (deep-linkable: `/contracts/{id}`).
    var id: String

    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(
            title: "Contract \(String(id.prefix(8)))",
            subtitle: "Job contract"
        )
    }
}

/// Identifier-first resolution for contracts. Unlike jobs/listings there is **no
/// clean non-network contract source** available to the intent process — the
/// app-group widget snapshot only carries auctions the user bid on, and contracts
/// are otherwise network-backed — so `suggestedEntities()` is empty by design
/// (intents must not hit the network, INT.1) and the optional-parameter design is
/// kept, wrapped in the entity: a donated / pasted contract UUID still resolves.
struct ContractEntityQuery: EntityQuery {
    func entities(for identifiers: [String]) async throws -> [ContractEntity] {
        identifiers
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
            .map { ContractEntity(id: $0) }
    }

    /// Empty by design — see the type doc: no non-network contract source exists.
    func suggestedEntities() async throws -> [ContractEntity] {
        []
    }
}

/// Opens check-in flow for a job contract (IOS-SYS.AI.1 / INT.7).
///
/// With a contract, navigates to that contract (where GPS check-in lives).
/// Without one, opens Contracts so the user can pick a job.
struct CheckInToJobIntent: AppIntent {
    static var title: LocalizedStringResource { "Check In to Job" }
    static var description: IntentDescription {
        IntentDescription("Opens NoMarkup so you can check in at a job site for dispute protection.")
    }
    static var openAppWhenRun: Bool { true }

    static var parameterSummary: some ParameterSummary {
        Summary("Check in to \(\.$contract)")
    }

    @Parameter(
        title: "Contract",
        description: "Contract to check in to. Leave empty to pick one in the app."
    )
    var contract: ContractEntity?

    /// Session source — injectable for tests; never refreshes tokens (INT.1).
    var session: any IntentSessionProviding = KeychainTokenStore()

    @MainActor
    func perform() async throws -> some IntentResult {
        try IntentAuthGuard.requireSession(session)
        let trimmed = contract?.id.trimmingCharacters(in: .whitespacesAndNewlines)
        if let trimmed, !trimmed.isEmpty {
            DeepLinkRouter.shared.open(.checkIn(contractID: trimmed))
        } else {
            DeepLinkRouter.shared.open(.checkIn(contractID: nil))
        }
        return .result()
    }
}
