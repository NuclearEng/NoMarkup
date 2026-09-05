import Foundation
import SwiftUI

/// Client-side feature-flag store.
///
/// Server: `GET /api/v1/flags` → flat JSON map `{ "customer_bnpl": true, ... }` (public, no auth).
///
/// Server flags + gateway `RequireFlag` remain the production gate. This v1
/// App Store binary additionally hard-offs regulated money rails so a seed-true
/// flag cannot expose purchase CTAs. UI diagnostic surfaces still show "Flag off"
/// because `isEnabled` returns false for keys in `iOSHardOffKeys`.
@MainActor
final class FeatureFlags: ObservableObject {
    /// v1 App Store binary hard-offs these until licenses + live-flagged exit.
    /// Server flags remain the production gate; iOS additionally hard-offs so a
    /// seed-true flag cannot expose purchase CTAs. `isEnabled` already returns
    /// false for keys in this set.
    static let iOSHardOffKeys: Set<String> = [
        "customer_bnpl",
        "working_capital",
        "per_job_insurance",
        "insurance_competition",
        "legal_services",
        "lead_gen",
        "instant_payout",
    ]

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
