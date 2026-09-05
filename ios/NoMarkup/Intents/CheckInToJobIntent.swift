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

/// Opens the in-app check-in surface (IOS-SYS.AI.1 / INT.7).
///
/// Production Siri/Shortcuts never POST check-in: location already authorized
/// is not consent. The contract workspace UI confirms before
/// `POST /contracts/{id}/checkin`. Tests inject `checkInAPI` to exercise the
/// API path without a confirmation sheet.
///
/// Without a contract, opens Contracts so the user can pick a job.
struct CheckInToJobIntent: AppIntent {
    static var title: LocalizedStringResource { "Check In to Job" }
    static var description: IntentDescription {
        IntentDescription("Checks you in at a job site for dispute protection, or opens NoMarkup so you can check in.")
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

    /// Session source — injectable for tests; never refreshes tokens in the guard (INT.1).
    var session: any IntentSessionProviding = KeychainTokenStore()

    /// Optional injectables for tests. Production never POSTs; `checkInAPI` is the
    /// only path that calls the check-in API (tests).
    var locationCoordinateProvider: (@Sendable () async throws -> (lat: Double, lng: Double))?
    var checkInAPI: (@Sendable (_ contractId: String, _ lat: Double, _ lng: Double) async throws -> Void)?

    @MainActor
    func perform() async throws -> some IntentResult & ReturnsValue<String> & ProvidesDialog {
        try IntentAuthGuard.requireSession(session)
        let trimmed = contract?.id.trimmingCharacters(in: .whitespacesAndNewlines)

        guard let trimmed, !trimmed.isEmpty else {
            DeepLinkRouter.shared.open(.checkIn(contractID: nil))
            return .result(
                value: "opened",
                dialog: IntentDialog("Opening contracts so you can pick a job to check in to.")
            )
        }

        var dialogMessage = "Opening contract check-in."
        var value = "opened"

        // Production: deep-link only. In-app UI confirms before POST.
        // Tests: `checkInAPI` injection keeps the GPS + POST path.
        if let checkInAPI {
            do {
                let coord: (lat: Double, lng: Double)
                if let locationCoordinateProvider {
                    coord = try await locationCoordinateProvider()
                } else {
                    let provider = JobSiteLocationProvider()
                    let c = try await provider.currentCoordinate(timeoutSeconds: 8)
                    coord = (c.latitude, c.longitude)
                }
                try await checkInAPI(trimmed, coord.lat, coord.lng)
                dialogMessage = "Checked in to the job site."
                value = "checked_in"
            } catch {
                // Fail soft — deep link still opens the workspace UI for a manual retry.
                dialogMessage = "Couldn’t check in automatically: \(error.localizedDescription). Opening the contract so you can try again."
                value = "fallback"
            }
        }

        DeepLinkRouter.shared.open(.checkIn(contractID: trimmed))
        return .result(value: value, dialog: IntentDialog(stringLiteral: dialogMessage))
    }
}
