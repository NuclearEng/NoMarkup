import Foundation
import SwiftUI

/// Client-side feature-flag store with first-binary iOS hard-off for regulated rails.
///
/// Server: `GET /api/v1/flags` → flat JSON map `{ "customer_bnpl": true, ... }` (public, no auth).
///
/// Product rule (docs/compliance/ios-payment-rails-design.md + Stage B4):
/// keys in `iOSHardOffKeys` are **always off** in this binary regardless of server
/// (equivalent to ANDing the server value with `false`).
///
/// **Blocked UI (not implemented in this scaffold):**
/// - Customer BNPL / installment plans (`customer_bnpl`)
/// - Working-capital advances (`working_capital`)
/// - Per-job insurance purchase / competition (`per_job_insurance`, `insurance_competition`)
/// - Legal services marketplace (`legal_services`)
/// - Lead-gen fee surfaces (`lead_gen`)
/// - Instant payout CTA (`instant_payout`)
/// Do not add navigation to those product screens until licenses + hard-off set are revised.
@MainActor
final class FeatureFlags: ObservableObject {
    /// Flags that must stay OFF in the first App Store binary regardless of server values.
    static let iOSHardOffKeys: Set<String> = [
        "customer_bnpl",
        "working_capital",
        "per_job_insurance",
        "insurance_competition",
        "legal_services",
        "lead_gen",
        "instant_payout",
    ]

    /// Raw server map (unfiltered). Useful for debug / Launch gates UI.
    @Published private(set) var serverFlags: [String: Bool] = [:]
    @Published private(set) var lastFetchError: String?
    @Published private(set) var isLoading = false
    @Published private(set) var lastFetchedAt: Date?

    private let api: APIClient

    init(api: APIClient = .shared) {
        self.api = api
    }

    /// Effective enablement for product gates.
    /// Hard-off keys always return `false`; all other keys follow the server (default `false` if unknown).
    func isEnabled(_ key: String) -> Bool {
        if Self.iOSHardOffKeys.contains(key) {
            return false
        }
        return serverFlags[key] ?? false
    }

    /// Server-reported value without applying hard-off (debug UI only).
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
