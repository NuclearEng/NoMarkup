import Foundation
import SwiftUI

/// Client-side feature-flag store.
///
/// Server: `GET /api/v1/flags` → flat JSON map `{ "customer_bnpl": true, ... }` (public, no auth).
///
/// Product rule (full web parity): **no permanent iOS hard-offs**. Server flags +
/// gateway `RequireFlag` gate money rails. UI shows disabled rails with
/// clear copy when the flag is off (fail-closed UI).
@MainActor
final class FeatureFlags: ObservableObject {
    /// Reserved for emergency kill-switches only. Empty = full product surface
    /// available when server enables the flag.
    static let iOSHardOffKeys: Set<String> = []

    /// Known product flag keys (for Account hub + regulated rails UI).
    static let productFlagKeys: [String] = [
        "customer_bnpl",
        "working_capital",
        "per_job_insurance",
        "insurance_competition",
        "legal_services",
        "lead_gen",
        "instant_payout",
        "background_checks",
    ]

    /// Raw server map.
    @Published private(set) var serverFlags: [String: Bool] = [:]
    @Published private(set) var lastFetchError: String?
    @Published private(set) var isLoading = false
    @Published private(set) var lastFetchedAt: Date?

    private let api: APIClient

    init(api: APIClient = .shared) {
        self.api = api
    }

    /// Effective enablement for product gates (server value; default false).
    func isEnabled(_ key: String) -> Bool {
        if Self.iOSHardOffKeys.contains(key) {
            return false
        }
        return serverFlags[key] ?? false
    }

    /// Server-reported value without applying hard-off (debug UI).
    func serverValue(_ key: String) -> Bool? {
        serverFlags[key]
    }

    /// Fetch the public flag map and replace local state.
    func refresh() async {
        isLoading = true
        lastFetchError = nil
        defer { isLoading = false }
        do {
            serverFlags = try await api.fetchFeatureFlags()
            lastFetchedAt = Date()
        } catch {
            lastFetchError = error.localizedDescription
        }
    }
}
