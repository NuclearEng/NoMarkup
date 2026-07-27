import SwiftUI

/// Server feature-flag status for money rails (BNPL, advances, insurance, etc.).
///
/// Product surfaces live under **Business & finance**. This view is diagnostic:
/// shows whether each flag is enabled on the server. No permanent hard-offs.
struct RegulatedRailsStatusView: View {
    @EnvironmentObject private var flags: FeatureFlags

    private let rows: [(key: String, title: String, detail: String)] = [
        ("customer_bnpl", "Customer installments (BNPL)", "Payment plans on service contracts."),
        ("working_capital", "Provider working capital", "Advances against completed work."),
        ("per_job_insurance", "Per-job insurance", "Quote and purchase coverage on contracts."),
        ("insurance_competition", "Insurance competition", "Multi-carrier competitive quotes."),
        ("legal_services", "Legal services marketplace", "Legal vertical catalog."),
        ("lead_gen", "Outcome lead-gen", "Qualified-lead fee surface."),
        ("instant_payout", "Instant payout", "Express Connect instant withdrawals."),
    ]

    var body: some View {
        List {
            Section {
                Text("These rails follow live server flags. Open Business & finance to use enabled products.")
                    .font(.footnote)
                    .foregroundStyle(BrandTheme.textSecondary)
                    .listRowBackground(BrandTheme.navyElevated)
            }

            Section {
                ForEach(rows, id: \.key) { row in
                    HStack(alignment: .top, spacing: 12) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(row.title)
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(BrandTheme.textPrimary)
                            Text(row.detail)
                                .font(.caption)
                                .foregroundStyle(BrandTheme.textSecondary)
                            Text(row.key)
                                .font(.caption2.monospaced())
                                .foregroundStyle(BrandTheme.textSecondary.opacity(0.8))
                        }
                        Spacer(minLength: 8)
                        let on = flags.isEnabled(row.key)
                        Text(on ? "ON" : "OFF")
                            .font(.caption.weight(.bold))
                            .foregroundStyle(on ? BrandTheme.success : BrandTheme.textSecondary)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 4)
                            .background(
                                Capsule().fill(
                                    on ? BrandTheme.success.opacity(0.15) : BrandTheme.surfaceRaised
                                )
                            )
                    }
                    .listRowBackground(BrandTheme.navyElevated)
                    .accessibilityElement(children: .combine)
                    .accessibilityLabel("\(row.title), \(flags.isEnabled(row.key) ? "on" : "off")")
                }
            } header: {
                Text("Server flags").brandSectionHeader()
            }

            Section {
                NavigationLink {
                    BusinessFeaturesHubView()
                } label: {
                    Label("Open Business & finance", systemImage: "building.2")
                }
                .frame(minHeight: 44)
                .listRowBackground(BrandTheme.navyElevated)
            }
        }
        .brandListBackground()
        .navigationTitle("Feature flags")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbarBackground(BrandTheme.navy, for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
        .task { await flags.refresh() }
        .refreshable { await flags.refresh() }
    }
}
