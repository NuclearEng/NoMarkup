import SwiftUI

/// Free vs paid **plan limits** — `GET /api/v1/subscriptions/tiers` (public).
///
/// App Store 3.1.1: digital paid plans are **not sold in this app**.
/// No StoreKit, no purchase buttons, no links to web digital checkout.
struct PlanLimitsView: View {
    @State private var tiers: [SubscriptionTier] = []
    @State private var isLoading = false
    @State private var errorMessage: String?

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

    var body: some View {
        content
            .navigationTitle("Plan limits")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbarBackground(BrandTheme.navy, for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
            .task { await load() }
            .refreshable { await load() }
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
            Section {
                Text("Paid digital plans are web-only / not sold in this app.")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(BrandTheme.warning)
                    .fixedSize(horizontal: false, vertical: true)
                    .listRowBackground(BrandTheme.navyElevated)
                    .accessibilityLabel("Paid digital plans are web-only and not sold in this app")

                Text("This screen shows feature limits for free and paid provider plans so you know what each tier includes. Physical goods and service jobs still use Apple Pay / Stripe escrow — not App Store subscriptions.")
                    .font(.caption)
                    .foregroundStyle(BrandTheme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .listRowBackground(BrandTheme.navyElevated)
            } header: {
                Text("Important").brandSectionHeader()
            }

            Section {
                ForEach(sortedTiers) { tier in
                    tierLimitsRow(tier)
                        .listRowBackground(BrandTheme.navyElevated)
                }
            } header: {
                Text("Limits by plan").brandSectionHeader()
            } footer: {
                Text("0 on a numeric limit means unlimited. Boolean features show On / Off. Purchasing or changing paid digital plans is not available in this iOS app.")
                    .foregroundStyle(BrandTheme.textSecondary)
            }
        }
        .brandListBackground()
    }

    @ViewBuilder
    private func tierLimitsRow(_ tier: SubscriptionTier) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(tier.displayName)
                    .font(.body.weight(.semibold))
                    .foregroundStyle(BrandTheme.textPrimary)
                Spacer(minLength: 8)
                Text(tier.planKindLabel)
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
        }
        .frame(minHeight: 44)
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(tier.displayName), \(tier.planKindLabel)")
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
