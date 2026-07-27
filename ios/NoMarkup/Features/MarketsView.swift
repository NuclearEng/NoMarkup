import SwiftUI

/// Active city markets — `GET /api/v1/markets` (public catalog).
struct MarketsView: View {
    @State private var markets: [MarketRow] = []
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var searchText = ""

    private var filtered: [MarketRow] {
        let active = markets.filter { $0.isActive != false }
        let q = searchText.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !q.isEmpty else { return active }
        return active.filter { market in
            market.displayName.lowercased().contains(q)
                || (market.regionLabel?.lowercased().contains(q) ?? false)
                || (market.slug?.lowercased().contains(q) ?? false)
                || (market.country?.lowercased().contains(q) ?? false)
        }
    }

    var body: some View {
        content
            .navigationTitle("Markets")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbarBackground(BrandTheme.navy, for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
            .searchable(text: $searchText, prompt: "Search cities or regions")
            .task { await load() }
            .refreshable { await load() }
    }

    @ViewBuilder
    private var content: some View {
        if isLoading && markets.isEmpty {
            ProgressView("Loading markets…")
                .tint(BrandTheme.accent)
                .foregroundStyle(BrandTheme.textSecondary)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .brandScreenBackground()
        } else if let errorMessage, markets.isEmpty {
            BrandEmptyState(
                title: "Couldn’t load markets",
                systemImage: "exclamationmark.triangle",
                message: errorMessage,
                actionTitle: "Try again"
            ) {
                Task { await load() }
            }
        } else if filtered.isEmpty {
            BrandEmptyState(
                title: searchText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                    ? "No markets yet"
                    : "No matches",
                systemImage: "mappin.and.ellipse",
                message: searchText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                    ? "Launched city markets appear here when the catalog is published. Pull to refresh."
                    : "No active markets matched your search. Try a city name or region."
            )
        } else {
            List {
                Section {
                    Text("NoMarkup runs local reverse-auction services and goods markets city by city. Browse launched markets below.")
                        .font(.subheadline)
                        .foregroundStyle(BrandTheme.textSecondary)
                        .listRowBackground(BrandTheme.navyElevated)
                }

                Section {
                    ForEach(filtered) { market in
                        marketRow(market)
                            .listRowBackground(BrandTheme.navyElevated)
                    }
                } header: {
                    Text("\(filtered.count) market\(filtered.count == 1 ? "" : "s")")
                        .brandSectionHeader()
                }
            }
            .brandListBackground()
        }
    }

    @ViewBuilder
    private func marketRow(_ market: MarketRow) -> some View {
        HStack(alignment: .center, spacing: 12) {
            Image(systemName: "building.2")
                .font(.title3)
                .foregroundStyle(BrandTheme.goldBright)
                .frame(width: 32, alignment: .center)
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 4) {
                Text(market.displayName)
                    .font(.body.weight(.medium))
                    .foregroundStyle(BrandTheme.textPrimary)
                    .lineLimit(2)

                HStack(spacing: 8) {
                    if let region = market.regionLabel {
                        Text(region)
                            .font(.subheadline)
                            .foregroundStyle(BrandTheme.textSecondary)
                    }
                    if let country = market.country?.trimmingCharacters(in: .whitespacesAndNewlines),
                       !country.isEmpty
                    {
                        Text(country.uppercased())
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(BrandTheme.gold.opacity(0.9))
                    }
                }

                if market.isActive == true {
                    Text("Active")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(BrandTheme.success)
                }
            }

            Spacer(minLength: 8)

            if market.hasCoordinate {
                Image(systemName: "location.fill")
                    .font(.caption)
                    .foregroundStyle(BrandTheme.teal)
                    .accessibilityLabel("Has map coordinates")
            }
        }
        .frame(minHeight: 44)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(market.displayName)\(market.regionLabel.map { ", \($0)" } ?? "")")
    }

    @MainActor
    private func load() async {
        isLoading = markets.isEmpty
        errorMessage = nil
        defer { isLoading = false }

        do {
            let response = try await APIClient.shared.fetchMarkets()
            markets = response.markets
        } catch {
            if markets.isEmpty {
                errorMessage = error.localizedDescription
            }
        }
    }
}

#Preview {
    NavigationStack {
        MarketsView()
    }
    .preferredColorScheme(.dark)
    .tint(BrandTheme.accent)
}
