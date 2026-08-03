import AppIntents
import CoreLocation
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

/// Checks in at a job contract when possible (GPS + API), otherwise opens the app
/// check-in surface (IOS-SYS.AI.1 / INT.7).
///
/// With a contract:
/// 1. Attempt one-shot GPS + `POST /contracts/{id}/checkin` (real API path).
/// 2. Always deep-link into the contract so the workspace UI can confirm state.
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

    /// Optional injectables for tests (location + check-in). Defaults hit CoreLocation + API.
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

        // Only attempt the API path when GPS is already authorized (or a test injects
        // coordinates). Never prompt for location from a headless Siri/Shortcuts run —
        // that hangs tests and is a poor UX; the contract UI still does the full flow.
        let canAttemptAPI: Bool
        if locationCoordinateProvider != nil || checkInAPI != nil {
            canAttemptAPI = true
        } else {
            let status = CLLocationManager().authorizationStatus
            canAttemptAPI = (status == .authorizedWhenInUse || status == .authorizedAlways)
        }

        if canAttemptAPI {
            do {
                let coord: (lat: Double, lng: Double)
                if let locationCoordinateProvider {
                    coord = try await locationCoordinateProvider()
                } else {
                    let provider = JobSiteLocationProvider()
                    let c = try await provider.currentCoordinate(timeoutSeconds: 8)
                    coord = (c.latitude, c.longitude)
                }

                if let checkInAPI {
                    try await checkInAPI(trimmed, coord.lat, coord.lng)
                } else {
                    _ = try await APIClient.shared.checkInToContract(
                        id: trimmed,
                        lat: coord.lat,
                        lng: coord.lng
                    )
                }
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
