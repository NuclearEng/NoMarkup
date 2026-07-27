import SwiftUI

/// Provider trust ladder — `GET /api/v1/trust/tiers` (public).
/// Explains min jobs / score / rating / reviews / verification per tier.
struct TrustTiersView: View {
    @State private var tiers: [TrustTier] = []
    @State private var isLoading = false
    @State private var errorMessage: String?

    private var sortedTiers: [TrustTier] {
        tiers.sorted { lhs, rhs in
            if lhs.sortRank != rhs.sortRank {
                return lhs.sortRank < rhs.sortRank
            }
            return lhs.displayName.localizedCaseInsensitiveCompare(rhs.displayName) == .orderedAscending
        }
    }

    var body: some View {
        content
            .navigationTitle("Trust tiers")
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
            ProgressView("Loading trust tiers…")
                .tint(BrandTheme.accent)
                .foregroundStyle(BrandTheme.textSecondary)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .brandScreenBackground()
        } else if let errorMessage, tiers.isEmpty {
            BrandEmptyState(
                title: "Couldn’t load tiers",
                systemImage: "exclamationmark.triangle",
                message: errorMessage,
                actionTitle: "Try again"
            ) {
                Task { await load() }
            }
        } else if sortedTiers.isEmpty {
            BrandEmptyState(
                title: "No tiers published",
                systemImage: "shield.lefthalf.filled",
                message: "Trust ladder requirements appear here when the platform publishes them. Pull to refresh."
            )
        } else {
            listContent
        }
    }

    private var listContent: some View {
        List {
            Section {
                Text("Providers earn trust by completing jobs, collecting strong reviews, and staying verified. Higher tiers unlock more visibility and lower friction on NoMarkup.")
                    .font(.subheadline)
                    .foregroundStyle(BrandTheme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .listRowBackground(BrandTheme.navyElevated)
            }

            Section {
                ForEach(sortedTiers) { tier in
                    tierRow(tier)
                        .listRowBackground(BrandTheme.navyElevated)
                }
            } header: {
                Text("Ladder").brandSectionHeader()
            } footer: {
                Text("Scores and thresholds are set by the platform. Your personal score appears on provider profiles after jobs complete.")
                    .foregroundStyle(BrandTheme.textSecondary)
            }
        }
        .brandListBackground()
    }

    @ViewBuilder
    private func tierRow(_ tier: TrustTier) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Image(systemName: iconName(for: tier))
                    .foregroundStyle(BrandTheme.goldBright)
                    .accessibilityHidden(true)
                Text(tier.displayName)
                    .font(.body.weight(.semibold))
                    .foregroundStyle(BrandTheme.textPrimary)
                Spacer(minLength: 8)
                if tier.requiresVerification == true {
                    Text("Verified")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(BrandTheme.navy)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(BrandTheme.gold, in: Capsule())
                        .accessibilityLabel("Requires verification")
                }
            }

            Text(tier.displayDescription)
                .font(.subheadline)
                .foregroundStyle(BrandTheme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)

            VStack(alignment: .leading, spacing: 6) {
                requirementLine(title: "Min score", value: tier.scoreLabel)
                requirementLine(title: "Min jobs", value: tier.jobsLabel)
                requirementLine(title: "Min rating", value: tier.ratingLabel)
                requirementLine(title: "Min reviews", value: tier.reviewsLabel)
                if tier.requiresVerification == true {
                    requirementLine(title: "Verification", value: "Required")
                }
            }
        }
        .frame(minHeight: 44)
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(tier.displayName). \(tier.displayDescription)")
    }

    private func requirementLine(title: String, value: String) -> some View {
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

    private func iconName(for tier: TrustTier) -> String {
        switch (tier.tier ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
        case "top_rated": return "star.circle.fill"
        case "trusted": return "checkmark.shield.fill"
        case "rising": return "arrow.up.circle.fill"
        case "under_review": return "eye.circle"
        default: return "shield"
        }
    }

    @MainActor
    private func load() async {
        isLoading = tiers.isEmpty
        errorMessage = nil
        defer { isLoading = false }
        do {
            let response = try await APIClient.shared.fetchTrustTiers()
            tiers = response.tiers
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

#Preview {
    NavigationStack {
        TrustTiersView()
    }
    .preferredColorScheme(.dark)
    .tint(BrandTheme.accent)
}
