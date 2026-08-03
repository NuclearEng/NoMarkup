import SwiftUI
import StoreKit

/// Free vs paid **plan limits** — `GET /api/v1/subscriptions/tiers` (public).
///
/// App Store 3.1.1 / v1 product cut (`docs/compliance/v1-ios-product-cut.md`,
/// `docs/compliance/storekit-scaffold.md`):
/// - **`AppConfig.storeKitEnabled == false` (default):** free-tier digital only.
///   Paid tiers are **read-only comparison**. No purchase CTA, no web digital
///   upgrade / “Manage on web” link that steers external digital purchase.
/// - **`storeKitEnabled == true`:** StoreKit 2 purchase / restore via
///   `StoreKitManager` (requires ASC products + Review Notes).
struct PlanLimitsView: View {
    @StateObject private var store = StoreKitManager.shared
    @State private var tiers: [SubscriptionTier] = []
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var purchasingProductID: String?

    private var storeKitOn: Bool { AppConfig.storeKitEnabled }

    private var sortedTiers: [SubscriptionTier] {
        tiers
            .filter { $0.isActive != false }
            .sorted { lhs, rhs in
                if lhs.sortKey != rhs.sortKey {
                    return lhs.sortKey < rhs.sortKey
                }
                return lhs.displayName.localizedCaseInsensitiveCompare(rhs.displayName) == .orderedAscending
            }
    }

    /// Free-tier-only binary: emphasize free rows; paid remain read-only for comparison.
    private var freeTiers: [SubscriptionTier] {
        sortedTiers.filter(\.isFree)
    }

    private var paidTiers: [SubscriptionTier] {
        sortedTiers.filter { !$0.isFree }
    }

    var body: some View {
        content
            .navigationTitle("Plan limits")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbarBackground(BrandTheme.navy, for: .navigationBar)
            .task {
                await load()
                if storeKitOn {
                    store.startIfEnabled()
                    await store.loadProducts()
                }
            }
            .refreshable {
                await load()
                if storeKitOn {
                    await store.loadProducts()
                    await store.refreshEntitlementsFromStore()
                }
            }
    }

    @ViewBuilder
    private var content: some View {
        if isLoading && tiers.isEmpty {
            ProgressView("Loading plan limits…")
                .tint(BrandTheme.accent)
                .foregroundStyle(BrandTheme.textSecondary)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .brandScreenBackground()
        } else if let errorMessage, tiers.isEmpty {
            BrandEmptyState(
                title: "Couldn’t load plans",
                systemImage: "exclamationmark.triangle",
                message: errorMessage,
                actionTitle: "Try again"
            ) {
                Task { await load() }
            }
        } else if sortedTiers.isEmpty {
            BrandEmptyState(
                title: "No plans published",
                systemImage: "list.bullet.rectangle",
                message: "Provider plan limits appear here when the catalog is available. Pull to refresh."
            )
        } else {
            listContent
        }
    }

    private var listContent: some View {
        List {
            complianceBannerSection

            if storeKitOn {
                storeKitSection
            }

            Section {
                ForEach(freeTiers) { tier in
                    tierLimitsRow(tier, showPurchase: false)
                        .listRowBackground(BrandTheme.navyElevated)
                }
                // If API returns no free tier, still show launch posture copy.
                if freeTiers.isEmpty {
                    Text("Launch free tier limits are enforced server-side when no free row is published.")
                        .font(.caption)
                        .foregroundStyle(BrandTheme.textSecondary)
                        .listRowBackground(BrandTheme.navyElevated)
                }
            } header: {
                Text(storeKitOn ? "Free plan" : "Included free for launch").brandSectionHeader()
            } footer: {
                Text("0 on a numeric limit means unlimited. Boolean features show On / Off.")
                    .foregroundStyle(BrandTheme.textSecondary)
            }

            if !paidTiers.isEmpty {
                Section {
                    ForEach(paidTiers) { tier in
                        tierLimitsRow(tier, showPurchase: storeKitOn)
                            .listRowBackground(BrandTheme.navyElevated)
                    }
                } header: {
                    Text(storeKitOn ? "Paid plans (In-App Purchase)" : "Paid plans (read-only)").brandSectionHeader()
                } footer: {
                    Group {
                        if storeKitOn {
                            Text("Purchase uses App Store In-App Purchase only. Physical goods and service jobs still use Apple Pay / Stripe escrow.")
                        } else {
                            Text("Paid digital tiers are not sold in this build. Comparison only — no upgrade or web checkout for digital unlocks (Guideline 3.1.1).")
                        }
                    }
                    .foregroundStyle(BrandTheme.textSecondary)
                }
            }
        }
        .brandListBackground()
    }

    @ViewBuilder
    private var complianceBannerSection: some View {
        Section {
            if storeKitOn {
                Text("Digital Pro / Business unlocks use App Store In-App Purchase when products are available. Physical goods and service jobs use Apple Pay / Stripe escrow — not IAP.")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(BrandTheme.warning)
                    .fixedSize(horizontal: false, vertical: true)
                    .listRowBackground(BrandTheme.navyElevated)
            } else {
                Text("Included free for launch. Digital feature unlocks in this app use the free tier only — no In-App Purchase and no web purchase path for digital plans.")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(BrandTheme.warning)
                    .fixedSize(horizontal: false, vertical: true)
                    .listRowBackground(BrandTheme.navyElevated)
                    .accessibilityLabel("Included free for launch. Digital plans are not sold in this app.")

                Text("This screen lists free limits and a read-only comparison of paid tiers. There is no upgrade button. Jobs and local goods still use Apple Pay / Stripe escrow for real-world payments.")
                    .font(.caption)
                    .foregroundStyle(BrandTheme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .listRowBackground(BrandTheme.navyElevated)
            }
        } header: {
            Text("Important").brandSectionHeader()
        }
    }

    @ViewBuilder
    private var storeKitSection: some View {
        Section {
            if store.isLoadingProducts && store.products.isEmpty {
                ProgressView("Loading App Store products…")
                    .tint(BrandTheme.accent)
                    .listRowBackground(BrandTheme.navyElevated)
            }

            if let err = store.lastErrorMessage, !err.isEmpty {
                Text(err)
                    .font(.caption)
                    .foregroundStyle(BrandTheme.destructive)
                    .listRowBackground(BrandTheme.navyElevated)
            }

            if store.hasActiveLocalSubscription {
                Label("Local entitlement active (device). Server verify residual until backend ships.", systemImage: "checkmark.seal")
                    .font(.caption)
                    .foregroundStyle(BrandTheme.success)
                    .listRowBackground(BrandTheme.navyElevated)
            }

            ForEach(store.products, id: \.id) { product in
                HStack(alignment: .center, spacing: 12) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(product.displayName)
                            .font(.body.weight(.semibold))
                            .foregroundStyle(BrandTheme.textPrimary)
                        Text(product.description)
                            .font(.caption)
                            .foregroundStyle(BrandTheme.textSecondary)
                            .lineLimit(3)
                        Text(product.displayPrice)
                            .font(.caption.weight(.medium).monospacedDigit())
                            .foregroundStyle(BrandTheme.accent)
                    }
                    Spacer(minLength: 8)
                    Button {
                        Task {
                            purchasingProductID = product.id
                            _ = await store.purchase(product)
                            purchasingProductID = nil
                        }
                    } label: {
                        if purchasingProductID == product.id {
                            ProgressView()
                                .tint(BrandTheme.ctaLabelOnGold)
                        } else if store.purchasedProductIDs.contains(product.id) {
                            Text("Owned")
                        } else {
                            Text("Subscribe")
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(BrandTheme.accent)
                    .disabled(purchasingProductID != nil || store.purchasedProductIDs.contains(product.id))
                    .frame(minHeight: 44)
                }
                .listRowBackground(BrandTheme.navyElevated)
                .accessibilityElement(children: .combine)
            }

            Button {
                Task { await store.restorePurchases() }
            } label: {
                Label("Restore purchases", systemImage: "arrow.clockwise")
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .frame(minHeight: 44)
            }
            .tint(BrandTheme.accent)
            .listRowBackground(BrandTheme.navyElevated)
            .accessibilityHint("Restores App Store subscription entitlements on this device.")
        } header: {
            Text("In-App Purchase").brandSectionHeader()
        } footer: {
            Text("Product IDs: \(AppConfig.storeKitProductIDs.joined(separator: ", ")). Entitlements require server JWS verify before production grant (see storekit-scaffold.md).")
                .foregroundStyle(BrandTheme.textSecondary)
        }
    }

    @ViewBuilder
    private func tierLimitsRow(_ tier: SubscriptionTier, showPurchase: Bool) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(tier.displayName)
                    .font(.body.weight(.semibold))
                    .foregroundStyle(BrandTheme.textPrimary)
                Spacer(minLength: 8)
                Text(tier.planKindLabel(storeKitEnabled: storeKitOn))
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(tier.isFree ? BrandTheme.success : BrandTheme.textSecondary)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(
                        (tier.isFree ? BrandTheme.success : BrandTheme.textSecondary).opacity(0.15),
                        in: Capsule()
                    )
            }

            limitLine(title: "Active bids", value: tier.maxActiveBidsLabel)
            limitLine(title: "Service categories", value: tier.maxServiceCategoriesLabel)
            limitLine(title: "Portfolio images", value: tier.portfolioImageLimitLabel)
            limitLine(title: "Featured placement", value: boolLabel(tier.featuredPlacement))
            limitLine(title: "Analytics access", value: boolLabel(tier.analyticsAccess))
            limitLine(title: "Priority support", value: boolLabel(tier.prioritySupport))
            limitLine(title: "Verified badge boost", value: boolLabel(tier.verifiedBadgeBoost))
            limitLine(title: "Instant jobs", value: boolLabel(tier.instantEnabled))

            // Purchase only when StoreKit is enabled and a matching product is loaded.
            // Never open web checkout for digital tiers (3.1.1).
            if showPurchase, !tier.isFree {
                storeKitPurchaseHint(for: tier)
            }
        }
        .frame(minHeight: 44)
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(tier.displayName), \(tier.planKindLabel(storeKitEnabled: storeKitOn))")
    }

    @ViewBuilder
    private func storeKitPurchaseHint(for tier: SubscriptionTier) -> some View {
        let matched = matchedStoreProduct(for: tier)
        if let product = matched {
            Button {
                Task {
                    purchasingProductID = product.id
                    _ = await store.purchase(product)
                    purchasingProductID = nil
                }
            } label: {
                Text(store.purchasedProductIDs.contains(product.id) ? "Owned · \(product.displayPrice)" : "Subscribe · \(product.displayPrice)")
                    .font(.caption.weight(.semibold))
                    .frame(minHeight: 44, alignment: .leading)
            }
            .tint(BrandTheme.accent)
            .disabled(purchasingProductID != nil || store.purchasedProductIDs.contains(product.id))
            .accessibilityHint("Starts App Store In-App Purchase for this plan.")
        } else {
            Text("In-App Purchase product not loaded for this tier yet.")
                .font(.caption)
                .foregroundStyle(BrandTheme.textSecondary)
        }
    }

    /// Best-effort map from API tier slug/name → ASC product id prefix.
    private func matchedStoreProduct(for tier: SubscriptionTier) -> Product? {
        let slug = (tier.slug ?? tier.name ?? "").lowercased()
        let candidates = store.products
        if slug.contains("business") {
            return candidates.first { $0.id.contains("business") && $0.id.contains("monthly") }
                ?? candidates.first { $0.id.contains("business") }
        }
        if slug.contains("pro") || slug.contains("professional") {
            return candidates.first { $0.id.contains(".pro.") && $0.id.contains("monthly") }
                ?? candidates.first { $0.id.contains(".pro.") }
        }
        return nil
    }

    private func limitLine(title: String, value: String) -> some View {
        HStack {
            Text(title)
                .font(.caption)
                .foregroundStyle(BrandTheme.textSecondary)
            Spacer(minLength: 8)
            Text(value)
                .font(.caption.weight(.medium).monospacedDigit())
                .foregroundStyle(BrandTheme.textPrimary)
        }
    }

    private func boolLabel(_ value: Bool?) -> String {
        guard let value else { return "—" }
        return value ? "On" : "Off"
    }

    @MainActor
    private func load() async {
        isLoading = tiers.isEmpty
        errorMessage = nil
        defer { isLoading = false }
        do {
            let response = try await APIClient.shared.fetchSubscriptionTiers()
            tiers = response.tiers
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

#Preview {
    NavigationStack {
        PlanLimitsView()
    }
    .preferredColorScheme(.dark)
    .tint(BrandTheme.accent)
}
