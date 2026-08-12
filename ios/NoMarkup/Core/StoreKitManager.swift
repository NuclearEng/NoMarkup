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
/// 3. Prefer server JWS verify (`POST /api/v1/iap/app-store/verify`) before trusting paid unlocks.
///    The gateway is fail-closed (503) until `APP_STORE_IAP_VERIFY` + Apple-root crypto land.
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
                await applyEntitlement(for: transaction, jwsRepresentation: verification.jwsRepresentation)
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
    /// Server grant still requires gateway JWS crypto (`APP_STORE_IAP_VERIFY` +
    /// Apple roots). Until that attests, we only set a **local** UI flag —
    /// do not grant paid server features from this alone.
    func refreshEntitlementsFromStore() async {
        guard AppConfig.storeKitEnabled else {
            purchasedProductIDs = []
            return
        }

        var active: Set<String> = []
        var lastJWS: String?
        for await result in Transaction.currentEntitlements {
            guard let transaction = try? checkVerified(result) else { continue }
            if transaction.revocationDate == nil {
                active.insert(transaction.productID)
                lastJWS = result.jwsRepresentation
            }
        }
        purchasedProductIDs = active
        if !active.isEmpty {
            persistLocalEntitlement(active: true, productIDs: active)
            await notifyBackendIfAvailable(productIDs: active, jwsRepresentation: lastJWS)
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
                    await self.applyEntitlement(for: transaction, jwsRepresentation: result.jwsRepresentation)
                    await transaction.finish()
                } catch {
                    await MainActor.run {
                        self.lastErrorMessage = error.localizedDescription
                    }
                }
            }
        }
    }

    private func applyEntitlement(for transaction: Transaction, jwsRepresentation: String?) async {
        var next = purchasedProductIDs
        if transaction.revocationDate == nil {
            next.insert(transaction.productID)
        } else {
            next.remove(transaction.productID)
        }
        purchasedProductIDs = next
        persistLocalEntitlement(active: !next.isEmpty, productIDs: next)
        await notifyBackendIfAvailable(productIDs: next, jwsRepresentation: jwsRepresentation)
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

    /// POSTs the StoreKit JWS to `POST /api/v1/iap/app-store/verify` when IAP is on.
    /// Never called when `AppConfig.storeKitEnabled == false`.
    /// A 503 / non-200 is expected until Apple-root crypto is configured — do not
    /// treat local entitlement as a server grant.
    private func notifyBackendIfAvailable(productIDs: Set<String>, jwsRepresentation: String?) async {
        guard AppConfig.storeKitEnabled else { return }
        guard let jws = jwsRepresentation?.trimmingCharacters(in: .whitespacesAndNewlines), !jws.isEmpty else {
            return
        }

        let url = AppConfig.apiBaseURL.appending(path: "api/v1/iap/app-store/verify")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.timeoutInterval = 15

        guard let token = try? KeychainTokenStore().read(.accessToken), !token.isEmpty else {
            lastErrorMessage = "Sign in required to verify In-App Purchase with the server."
            return
        }
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        let body = AppStoreVerifyRequest(jws: jws, productIDs: Array(productIDs).sorted())
        let encoder = JSONEncoder()
        encoder.keyEncodingStrategy = .convertToSnakeCase
        do {
            request.httpBody = try encoder.encode(body)
            let (_, response) = try await URLSession.shared.data(for: request)
            let code = (response as? HTTPURLResponse)?.statusCode ?? -1
            // Gateway is fail-closed: 503 until APP_STORE_IAP_VERIFY + Apple roots.
            // Never interpret a 2xx as a paid unlock from this local flag alone.
            if code == 401 || code == 403 {
                lastErrorMessage = "Server rejected In-App Purchase verification (sign in again)."
            } else if code != 503 && !(200 ... 299).contains(code) {
                lastErrorMessage = "IAP verify failed (\(code))."
            }
        } catch {
            lastErrorMessage = error.localizedDescription
        }
    }
}

private struct AppStoreVerifyRequest: Encodable {
    let jws: String
    let productIDs: [String]
}
