import SwiftUI

/// Goods forward-auction surface. Loads active listings from the gateway.
struct MarketplaceView: View {
    @State private var listings: [ListingSummary] = []
    @State private var pagination: PaginationMeta?
    @State private var isLoading = false
    @State private var isLoadingMore = false
    @State private var errorMessage: String?
    @State private var loadMoreError: String?
    @State private var searchText = ""

    var body: some View {
        NavigationStack {
            content
                .navigationTitle("Marketplace")
                .searchable(text: $searchText, prompt: "Search listings")
                .onSubmit(of: .search) {
                    Task { await load(reset: true) }
                }
                .refreshable { await load(reset: true) }
                .task { await load(reset: true) }
                .toolbarBackground(BrandTheme.navy, for: .navigationBar)
                .toolbarBackground(.visible, for: .navigationBar)
                .navigationDestination(for: ListingSummary.self) { listing in
                    ListingDetailView(listingID: listing.id, preview: listing)
                }
        }
    }

    @ViewBuilder
    private var content: some View {
        if isLoading && listings.isEmpty {
            ProgressView("Loading listings…")
                .tint(BrandTheme.accent)
                .foregroundStyle(BrandTheme.textSecondary)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .brandScreenBackground()
        } else if let errorMessage, listings.isEmpty {
            BrandEmptyState(
                title: "Couldn’t load listings",
                systemImage: "wifi.exclamationmark",
                message: errorMessage,
                actionTitle: "Try again"
            ) {
                Task { await load(reset: true) }
            }
        } else if listings.isEmpty {
            BrandEmptyState(
                title: "No listings nearby",
                systemImage: "bag",
                message: "Local goods auctions (forward bid-up, pickup within 25 mi) show up here when sellers list. Pull to refresh or clear search."
            )
        } else {
            List {
                Section {
                    Text("Local goods · buyers bid up · pickup within 25 mi. Escrow holds funds until pickup — fair price discovery, no middleman markup.")
                        .font(.subheadline)
                        .foregroundStyle(BrandTheme.textSecondary)
                        .listRowBackground(BrandTheme.navyElevated)
                }

                Section {
                    ForEach(listings) { listing in
                        NavigationLink(value: listing) {
                            ListingRowView(listing: listing)
                        }
                        .frame(minHeight: 44)
                        .listRowBackground(BrandTheme.navyElevated)
                        .accessibilityHint("Opens listing detail")
                    }
                } header: {
                    if let total = pagination?.resolvedTotal, total > 0 {
                        Text("\(listings.count) of \(total)").brandSectionHeader()
                    } else {
                        Text("Listings").brandSectionHeader()
                    }
                }

                if pagination?.resolvedHasNext == true {
                    Section {
                        VStack(alignment: .leading, spacing: 8) {
                            if let loadMoreError, !loadMoreError.isEmpty {
                                Text(loadMoreError)
                                    .font(.caption)
                                    .foregroundStyle(BrandTheme.destructive)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                            Button {
                                Task { await load(reset: false) }
                            } label: {
                                if isLoadingMore {
                                    ProgressView()
                                        .tint(BrandTheme.accent)
                                        .frame(maxWidth: .infinity, minHeight: 44)
                                } else {
                                    Text("Load more")
                                        .font(.body.weight(.semibold))
                                        .frame(maxWidth: .infinity, minHeight: 44)
                                }
                            }
                            .buttonStyle(.bordered)
                            .tint(BrandTheme.accent)
                            .disabled(isLoadingMore)
                            .accessibilityLabel("Load more listings")
                            .accessibilityHint("Fetches the next page and appends to the list")
                        }
                        .listRowBackground(BrandTheme.navyElevated)
                    }
                }
            }
            .brandListBackground()
        }
    }

    @MainActor
    private func load(reset: Bool) async {
        if reset {
            isLoading = true
            loadMoreError = nil
        } else {
            guard !isLoadingMore else { return }
            guard pagination?.resolvedHasNext == true else { return }
            isLoadingMore = true
            loadMoreError = nil
        }
        errorMessage = nil
        defer {
            isLoading = false
            isLoadingMore = false
        }

        let pageSize = 40
        let nextPage = reset ? 1 : (pagination?.resolvedPage ?? 1) + 1

        do {
            let response = try await APIClient.shared.fetchListings(
                page: nextPage,
                pageSize: pageSize,
                q: searchText
            )
            if reset {
                listings = response.listings
            } else {
                let existing = Set(listings.map(\.id))
                listings.append(contentsOf: response.listings.filter { !existing.contains($0.id) })
            }
            pagination = response.pagination
        } catch {
            if reset, listings.isEmpty {
                errorMessage = error.localizedDescription
            } else if !reset {
                loadMoreError = error.localizedDescription
            }
            // Keep previous rows on refresh failure; surface via error only when empty.
        }
    }
}

// MARK: - Row

private struct ListingRowView: View {
    let listing: ListingSummary

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(listing.displayTitle)
                    .font(.body.weight(.semibold))
                    .foregroundStyle(BrandTheme.textPrimary)
                    .lineLimit(2)
                Spacer(minLength: 8)
                VStack(alignment: .trailing, spacing: 2) {
                    Text(listing.displayPrice)
                        .font(.body.weight(.bold).monospacedDigit())
                        .foregroundStyle(BrandTheme.goldBright)
                    Text(listing.priceCaption)
                        .font(.caption2)
                        .foregroundStyle(BrandTheme.textSecondary)
                }
            }

            HStack(spacing: 8) {
                if let status = listing.status, !status.isEmpty {
                    StatusChipView(
                        label: StatusChipStyle.displayLabel(status),
                        style: StatusChipStyle.forStatus(status)
                    )
                }
                if let condition = listing.condition, !condition.isEmpty {
                    Text(condition.replacingOccurrences(of: "_", with: " ").capitalized)
                        .font(.caption)
                        .foregroundStyle(BrandTheme.textSecondary)
                        .lineLimit(1)
                }
                if let category = listing.categoryName, !category.isEmpty {
                    Text(category)
                        .font(.caption)
                        .foregroundStyle(BrandTheme.textSecondary)
                        .lineLimit(1)
                }
            }

            HStack(spacing: 12) {
                if let location = listing.locationLabel {
                    Label(location, systemImage: "mappin.and.ellipse")
                        .font(.caption)
                        .foregroundStyle(BrandTheme.textSecondary)
                        .lineLimit(1)
                }
                if let bids = listing.bidCount {
                    Label("\(bids) bids", systemImage: "hammer")
                        .font(.caption)
                        .foregroundStyle(BrandTheme.textSecondary)
                }
                if let countdown = listing.auctionCountdown {
                    Label(countdown, systemImage: "clock")
                        .font(.caption.weight(.medium))
                        .foregroundStyle(countdown == "Ended" ? BrandTheme.textSecondary : BrandTheme.goldBright)
                        .lineLimit(1)
                }
            }
        }
        .padding(.vertical, 6)
        .accessibilityElement(children: .combine)
    }
}

#Preview {
    MarketplaceView()
        .preferredColorScheme(.dark)
        .tint(BrandTheme.accent)
}
