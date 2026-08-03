import Foundation
import StoreKit

/// StoreKit 2 scaffold for **Rail B** digital subscriptions (FR-12 / Guideline 3.1.1).
///
/// **Default posture:** `AppConfig.storeKitEnabled == false`. In that mode this type
/// never presents purchase sheets, never loads App Store products for UI, and never
/// claims an entitlement is server-verified.
///
/// Enable only after:
/// 1. ASC auto-renewable products exist (IDs match `AppConfig.storeKitProductIDs`)
/// 2. Review Notes describe IAP + free tier
/// 3. Prefer server JWS / ASN v2 verify before trusting paid unlocks (residual until backend ships)
///
/// See `docs/compliance/storekit-scaffold.md`.
@MainActor
final class StoreKitManager: ObservableObject {
    static let shared = StoreKitManager()

    @Published private(set) var products: [Product] = []
    @Published private(set) var purchasedProductIDs: Set<String> = []
    @Published private(set) var isLoadingProducts = false
    @Published private(set) var lastErrorMessage: String?
    /// Local-only flag written after a successful purchase / restore while no verify endpoint exists.
    @Published private(set) var localEntitlementActive = false

    private var updatesTask: Task<Void, Never>?
    private let localEntitlementKey = "nomarkup.storekit.localEntitlement.active"
    private let localProductIDsKey = "nomarkup.storekit.localEntitlement.productIDs"

    private init() {
        restoreLocalEntitlementFlag()
        if AppConfig.storeKitEnabled {
            updatesTask = listenForTransactions()
        }
    }

    deinit {
        updatesTask?.cancel()
    }

    // MARK: - Lifecycle

    /// Starts `Transaction.updates` listening when the flag is on. Safe to call multiple times.
    func startIfEnabled() {
        guard AppConfig.storeKitEnabled else { return }
        if updatesTask == nil {
            updatesTask = listenForTransactions()
        }
        Task { await refreshEntitlementsFromStore() }
    }

    // MARK: - Products

    /// Loads products for `AppConfig.storeKitProductIDs`. No-op when StoreKit is disabled.
    func loadProducts() async {
        guard AppConfig.storeKitEnabled else {
            products = []
            return
        }
        let ids = AppConfig.storeKitProductIDs
        guard !ids.isEmpty else {
            lastErrorMessage = "No StoreKit product IDs configured (Info.plist StoreKitProductIDs)."
            products = []
            return
        }

        isLoadingProducts = true
        lastErrorMessage = nil
        defer { isLoadingProducts = false }

        do {
            let loaded = try await Product.products(for: ids)
            products = loaded.sorted { lhs, rhs in
                lhs.displayName.localizedCaseInsensitiveCompare(rhs.displayName) == .orderedAscending
            }
            if loaded.isEmpty {
                lastErrorMessage = "App Store returned no products. Confirm ASC product IDs and agreements."
            }
        } catch {
            lastErrorMessage = error.localizedDescription
            products = []
        }
    }

    func product(for id: String) -> Product? {
        products.first { $0.id == id }
    }

    // MARK: - Purchase / restore

    /// Purchases a product. Returns `false` when disabled, canceled, or failed.
    @discardableResult
    func purchase(_ product: Product) async -> Bool {
        guard AppConfig.storeKitEnabled else {
            lastErrorMessage = "In-App Purchase is not enabled in this build."
            return false
        }

        lastErrorMessage = nil
        do {
            let result = try await product.purchase()
            switch result {
            case .success(let verification):
                let transaction = try checkVerified(verification)
                await applyEntitlement(for: transaction)
                await transaction.finish()
                return true
            case .userCancelled:
                return false
            case .pending:
                lastErrorMessage = "Purchase is pending approval (Ask to Buy / SCA)."
                return false
            @unknown default:
                lastErrorMessage = "Purchase ended with an unknown status."
                return false
            }
        } catch {
            lastErrorMessage = error.localizedDescription
            return false
        }
    }

    /// Restores / re-syncs current entitlements from the App Store.
    func restorePurchases() async {
        guard AppConfig.storeKitEnabled else {
            lastErrorMessage = "In-App Purchase is not enabled in this build."
            return
        }
        lastErrorMessage = nil
        do {
            try await AppStore.sync()
            await refreshEntitlementsFromStore()
        } catch {
            lastErrorMessage = error.localizedDescription
        }
    }

    // MARK: - Entitlements

    /// Walks current entitlements and updates local state.
    ///
    /// **Residual:** There is no backend `POST /subscriptions/apple/verify` (or similar)
    /// in this tree. Until server JWS verification ships, we only set a **local** flag
    /// for UI scaffolding — do not grant paid server features from this alone.
    func refreshEntitlementsFromStore() async {
        guard AppConfig.storeKitEnabled else {
            purchasedProductIDs = []
            return
        }

        var active: Set<String> = []
        for await result in Transaction.currentEntitlements {
            guard let transaction = try? checkVerified(result) else { continue }
            if transaction.revocationDate == nil {
                active.insert(transaction.productID)
            }
        }
        purchasedProductIDs = active
        if !active.isEmpty {
            persistLocalEntitlement(active: true, productIDs: active)
            await notifyBackendIfAvailable(productIDs: active, jwsRepresentation: nil)
        } else {
            persistLocalEntitlement(active: false, productIDs: [])
        }
    }

    var hasActiveLocalSubscription: Bool {
        localEntitlementActive || !purchasedProductIDs.isEmpty
    }

    // MARK: - Private

    private func listenForTransactions() -> Task<Void, Never> {
        Task { [weak self] in
            for await result in Transaction.updates {
                guard let self else { return }
                guard AppConfig.storeKitEnabled else { continue }
                do {
                    let transaction = try self.checkVerified(result)
                    await self.applyEntitlement(for: transaction)
                    await transaction.finish()
                } catch {
                    await MainActor.run {
                        self.lastErrorMessage = error.localizedDescription
                    }
                }
            }
        }
    }

    private func applyEntitlement(for transaction: Transaction) async {
        var next = purchasedProductIDs
        if transaction.revocationDate == nil {
            next.insert(transaction.productID)
        } else {
            next.remove(transaction.productID)
        }
        purchasedProductIDs = next
        persistLocalEntitlement(active: !next.isEmpty, productIDs: next)
        // StoreKit 2 `Transaction` exposes `jwsRepresentation` on VerificationResult in
        // some SDK versions; pass nil until server verify exists (see residual note).
        await notifyBackendIfAvailable(productIDs: next, jwsRepresentation: nil)
    }

    private func checkVerified<T>(_ result: VerificationResult<T>) throws -> T {
        switch result {
        case .unverified(_, let error):
            throw error
        case .verified(let safe):
            return safe
        }
    }

    private func restoreLocalEntitlementFlag() {
        localEntitlementActive = UserDefaults.standard.bool(forKey: localEntitlementKey)
        if let ids = UserDefaults.standard.array(forKey: localProductIDsKey) as? [String] {
            purchasedProductIDs = Set(ids)
        }
    }

    private func persistLocalEntitlement(active: Bool, productIDs: Set<String>) {
        localEntitlementActive = active
        UserDefaults.standard.set(active, forKey: localEntitlementKey)
        UserDefaults.standard.set(Array(productIDs).sorted(), forKey: localProductIDsKey)
    }

    /// Placeholder for future server verify. Currently a no-op with structured residual.
    ///
    /// When a gateway endpoint exists (e.g. `POST /api/v1/subscriptions/apple/verify`
    /// with App Store Server API / JWS), call it here and only then trust paid unlocks.
    private func notifyBackendIfAvailable(productIDs: Set<String>, jwsRepresentation: String?) async {
        // Residual B2: no verify endpoint in monorepo today (Stripe Subscriptions only on web).
        // Keep signature so wiring is a single call when backend lands.
        _ = productIDs
        _ = jwsRepresentation
    }
}
