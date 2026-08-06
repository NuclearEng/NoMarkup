import SwiftUI

/// Public provider search — `GET /api/v1/providers/search`.
/// Rows navigate to `ProviderDetailView` for bio, reviews, block/report.
struct ProvidersView: View {
    @State private var providers: [ProviderSearchResult] = []
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var searchText = ""

    var body: some View {
        content
            .navigationTitle("Providers")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .brandNavigationBarChrome()
            .searchable(text: $searchText, prompt: "Search providers")
            .onSubmit(of: .search) {
                Task { await load() }
            }
            .onChange(of: searchText) { _, newValue in
                // Empty search reloads the default public list.
                if newValue.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    Task { await load() }
                }
            }
            .task { await load() }
            .refreshable { await load() }
    }

    @ViewBuilder
    private var content: some View {
        if isLoading && providers.isEmpty {
            BrandLoadingScreen(kind: .catalog, rows: 5, accessibilityLabel: "Loading providers…")
        } else if let errorMessage, providers.isEmpty {
            BrandEmptyState(
                title: "Couldn’t load providers",
                systemImage: "exclamationmark.triangle",
                message: errorMessage,
                actionTitle: "Try again"
            ) {
                Task { await load() }
            }
        } else if providers.isEmpty {
            BrandEmptyState(
                title: "No providers found",
                systemImage: "person.2.slash",
                message: searchText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                    ? "Qualified local providers appear here when they complete onboarding. Pull to refresh or try a different search."
                    : "No providers matched “\(searchText.trimmingCharacters(in: .whitespacesAndNewlines))”. Try fewer keywords or clear search."
            )
        } else {
            List {
                Section {
                    Text("Browse local service providers. Reverse-auction jobs let them compete on price — fair market rates, not lead-gen markup.")
                        .font(.subheadline)
                        .foregroundStyle(BrandTheme.textSecondary)
                        .listRowBackground(BrandTheme.navyElevated)
                }

                Section {
                    ForEach(providers) { provider in
                        NavigationLink {
                            // Lazy: Account → Providers list can be long; avoid specializing
                            // every ProviderDetailView at list build (stack / tab-shell pressure).
                            LazyView {
                                ProviderDetailView(providerID: provider.id, preview: provider)
                            }
                        } label: {
                            providerRow(provider)
                        }
                        .frame(minHeight: 44)
                        .listRowBackground(BrandTheme.navyElevated)
                        .accessibilityHint("Opens provider profile")
                    }
                } header: {
                    Text(String(localized: "\(providers.count) providers"))
                        .brandSectionHeader()
                }
            }
            .brandListBackground()
        }
    }

    @ViewBuilder
    private func providerRow(_ provider: ProviderSearchResult) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(provider.displayLabel)
                    .font(.body.weight(.medium))
                    .foregroundStyle(BrandTheme.textPrimary)
                    .lineLimit(2)
                Spacer(minLength: 8)
                if provider.instantAvailable == true {
                    BrandGlassStatusChip(title: "LIVE", kind: .live, showPulse: true)
                        .accessibilityLabel("Instant available")
                }
            }

            if let business = provider.businessName?.trimmingCharacters(in: .whitespacesAndNewlines),
               !business.isEmpty {
                Text(business)
                    .font(.subheadline)
                    .foregroundStyle(BrandTheme.textSecondary)
                    .lineLimit(1)
            }

            HStack(spacing: 10) {
                if let jobs = provider.jobsCompleted, jobs > 0 {
                    Label(String(localized: "\(jobs) jobs"), systemImage: "checkmark.seal")
                        .font(.caption)
                        .foregroundStyle(BrandTheme.textSecondary)
                }
                if let rating = provider.averageRating, rating > 0 {
                    Label(String(format: "%.1f", rating), systemImage: "star.fill")
                        .font(.caption.weight(.semibold).monospacedDigit())
                        .foregroundStyle(BrandTheme.goldBright)
                }
                if let distance = provider.distanceLabel {
                    Label(distance, systemImage: "location")
                        .font(.caption)
                        .foregroundStyle(BrandTheme.textSecondary)
                }
                if let response = provider.responseTimeLabel, !response.isEmpty {
                    Label(response, systemImage: "clock")
                        .font(.caption)
                        .foregroundStyle(BrandTheme.textSecondary)
                }
            }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(accessibilityLabel(for: provider))
    }

    private func accessibilityLabel(for provider: ProviderSearchResult) -> String {
        var parts = [provider.displayLabel]
        if let business = provider.businessName?.trimmingCharacters(in: .whitespacesAndNewlines),
           !business.isEmpty {
            parts.append(business)
        }
        if let jobs = provider.jobsCompleted, jobs > 0 {
            parts.append("\(jobs) jobs completed")
        }
        if let rating = provider.averageRating, rating > 0 {
            parts.append(String(format: "rating %.1f", rating))
        }
        if provider.instantAvailable == true {
            parts.append("instant available")
        }
        return parts.joined(separator: ", ")
    }

    @MainActor
    private func load() async {
        isLoading = providers.isEmpty
        errorMessage = nil
        defer { isLoading = false }

        let q = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        do {
            let response = try await APIClient.shared.searchProviders(
                q: q.isEmpty ? nil : q
            )
            providers = response.providers
        } catch {
            if providers.isEmpty {
                errorMessage = error.localizedDescription
            }
        }
    }
}

#Preview {
    NavigationStack {
        ProvidersView()
    }
    .preferredColorScheme(.dark)
    .tint(BrandTheme.accent)
}
