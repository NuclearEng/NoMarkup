import SwiftUI

/// Read-only status of regulated product rails that are **hard-off** in this binary.
///
/// App Review education only: explains that BNPL, advances, insurance purchase,
/// legal marketplace, lead-gen, and instant payout are **not available** here and
/// require compliance / licenses. Does **not** deep-link to purchase, web checkout,
/// or any money CTA for these rails.
///
/// Authoritative off-switch: `FeatureFlags.iOSHardOffKeys` (always `isEnabled` → false).
struct RegulatedRailsStatusView: View {
    @EnvironmentObject private var featureFlags: FeatureFlags

    private static let rows: [RegulatedRailRow] = [
        RegulatedRailRow(
            flagKey: "customer_bnpl",
            title: "Customer installments (BNPL)",
            detail: "Consumer credit / installment plans on contracts."
        ),
        RegulatedRailRow(
            flagKey: "working_capital",
            title: "Provider working capital",
            detail: "Advances against awarded work for materials and labor."
        ),
        RegulatedRailRow(
            flagKey: "per_job_insurance",
            title: "Per-job insurance",
            detail: "Quote, purchase, and claims for per-contract coverage."
        ),
        RegulatedRailRow(
            flagKey: "insurance_competition",
            title: "Insurance quote competition",
            detail: "Multi-carrier competitive insurance quotes."
        ),
        RegulatedRailRow(
            flagKey: "legal_services",
            title: "Legal services marketplace",
            detail: "Legal vertical browse and related marketplace surfaces."
        ),
        RegulatedRailRow(
            flagKey: "lead_gen",
            title: "Outcome lead generation",
            detail: "Qualified-lead / outcome referral fee product."
        ),
        RegulatedRailRow(
            flagKey: "instant_payout",
            title: "Instant payout",
            detail: "Instant settlement of cleared provider earnings."
        ),
    ]

    var body: some View {
        List {
            Section {
                Text("Not available in this build")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(BrandTheme.warning)
                    .fixedSize(horizontal: false, vertical: true)
                    .listRowBackground(BrandTheme.navyElevated)
                    .accessibilityLabel("Regulated capabilities are not available in this build")

                Text("These capabilities require licenses, partner agreements, or risk review before they can ship. This iOS app forces them off even if a server flag is on. There is no in-app purchase path and no link to buy or enable them here.")
                    .font(.caption)
                    .foregroundStyle(BrandTheme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .listRowBackground(BrandTheme.navyElevated)
            } header: {
                Text("App Review").brandSectionHeader()
            }

            Section {
                ForEach(Self.rows) { row in
                    railRow(row)
                        .listRowBackground(BrandTheme.navyElevated)
                }
            } header: {
                Text("Regulated capabilities").brandSectionHeader()
            } footer: {
                Text("Status is always unavailable for hard-off keys in this binary. Core jobs, goods marketplace, and escrow payments use Stripe (not these rails).")
                    .foregroundStyle(BrandTheme.textSecondary)
            }

            Section {
                LabeledContent("Hard-off keys") {
                    Text("\(FeatureFlags.iOSHardOffKeys.count)")
                        .font(.body.monospacedDigit())
                        .foregroundStyle(BrandTheme.textPrimary)
                }
                .listRowBackground(BrandTheme.navyElevated)

                if let fetched = featureFlags.lastFetchedAt {
                    LabeledContent("Flags fetched") {
                        Text(fetched, style: .time)
                            .font(.caption)
                            .foregroundStyle(BrandTheme.textSecondary)
                    }
                    .listRowBackground(BrandTheme.navyElevated)
                }

                if let err = featureFlags.lastFetchError {
                    Text(err)
                        .font(.caption)
                        .foregroundStyle(BrandTheme.warning)
                        .fixedSize(horizontal: false, vertical: true)
                        .listRowBackground(BrandTheme.navyElevated)
                }
            } header: {
                Text("Client gate").brandSectionHeader()
            } footer: {
                Text("Server flag values are informational only. Effective enablement for hard-off keys is always off.")
                    .foregroundStyle(BrandTheme.textSecondary)
            }
        }
        .brandListBackground()
        .navigationTitle("Regulated capabilities")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbarBackground(BrandTheme.navy, for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
        .task {
            await featureFlags.refresh()
        }
        .refreshable {
            await featureFlags.refresh()
        }
    }

    @ViewBuilder
    private func railRow(_ row: RegulatedRailRow) -> some View {
        let effectiveOn = featureFlags.isEnabled(row.flagKey)
        let serverOn = featureFlags.serverValue(row.flagKey)

        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(row.title)
                    .font(.body.weight(.semibold))
                    .foregroundStyle(BrandTheme.textPrimary)
                Spacer(minLength: 8)
                statusChip(available: effectiveOn)
            }

            Text(row.detail)
                .font(.caption)
                .foregroundStyle(BrandTheme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)

            Text("Requires compliance · not available in this build")
                .font(.caption2.weight(.medium))
                .foregroundStyle(BrandTheme.warning)
                .fixedSize(horizontal: false, vertical: true)

            HStack(spacing: 12) {
                Text("Flag: \(row.flagKey)")
                    .font(.caption2.monospaced())
                    .foregroundStyle(BrandTheme.textSecondary)
                Spacer(minLength: 8)
                Text(serverLabel(serverOn))
                    .font(.caption2)
                    .foregroundStyle(BrandTheme.textSecondary)
            }
        }
        .frame(minHeight: 44)
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(row.title). Not available in this build, requires compliance.")
        .accessibilityValue(effectiveOn ? "Available" : "Unavailable")
    }

    private func statusChip(available: Bool) -> some View {
        Text(available ? "Available" : "Unavailable")
            .font(.caption2.weight(.semibold))
            .foregroundStyle(available ? BrandTheme.success : BrandTheme.textSecondary)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(
                (available ? BrandTheme.success : BrandTheme.textSecondary).opacity(0.15),
                in: Capsule()
            )
    }

    private func serverLabel(_ value: Bool?) -> String {
        switch value {
        case .some(true): return "Server: on (ignored)"
        case .some(false): return "Server: off"
        case .none: return "Server: unknown"
        }
    }
}

private struct RegulatedRailRow: Identifiable {
    var id: String { flagKey }
    let flagKey: String
    let title: String
    let detail: String
}

#Preview {
    NavigationStack {
        RegulatedRailsStatusView()
    }
    .environmentObject(FeatureFlags())
    .preferredColorScheme(.dark)
    .tint(BrandTheme.accent)
}
