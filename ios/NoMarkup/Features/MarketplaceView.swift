import SwiftUI

/// Goods forward-auction surface. Loads active listings from the gateway.
struct MarketplaceView: View {
    @State private var listings: [ListingSummary] = []
    @State private var pagination: PaginationMeta?
    @State private var isLoading = false
    @State private var errorMessage: String?
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
                .navigationDestination(for: ListingSummary.self) { listing in
                    ListingDetailView(listingID: listing.id, preview: listing)
                }
        }
    }

    @ViewBuilder
    private var content: some View {
        if isLoading && listings.isEmpty {
            ProgressView("Loading listings…")
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if let errorMessage, listings.isEmpty {
            ContentUnavailableView {
                Label("Couldn’t load listings", systemImage: "wifi.exclamationmark")
            } description: {
                Text(errorMessage)
            } actions: {
                Button("Try again") {
                    Task { await load(reset: true) }
                }
                .buttonStyle(.borderedProminent)
                .frame(minHeight: 44)
            }
        } else if listings.isEmpty {
            ContentUnavailableView(
                "No listings",
                systemImage: "bag",
                description: Text("No active listings match your search. Pull to refresh or try again later.")
            )
        } else {
            List {
                Section {
                    Text("Local pickup · forward auction · 25 mi model")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }

                Section {
                    ForEach(listings) { listing in
                        NavigationLink(value: listing) {
                            ListingRowView(listing: listing)
                        }
                        .frame(minHeight: 44)
                        .accessibilityHint("Opens listing detail")
                    }
                } header: {
                    if let total = pagination?.resolvedTotal, total > 0 {
                        Text("\(listings.count) of \(total)")
                    } else {
                        Text("Listings")
                    }
                }
            }
            .listStyle(.insetGrouped)
        }
    }

    @MainActor
    private func load(reset: Bool) async {
        if reset {
            isLoading = true
        }
        errorMessage = nil
        defer { isLoading = false }

        do {
            let response = try await APIClient.shared.fetchListings(
                page: 1,
                pageSize: 40,
                q: searchText
            )
            listings = response.listings
            pagination = response.pagination
        } catch {
            if listings.isEmpty {
                errorMessage = error.localizedDescription
            }
            // Keep previous rows on refresh failure; surface via error only when empty.
        }
    }
}

// MARK: - Row

private struct ListingRowView: View {
    let listing: ListingSummary

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline) {
                Text(listing.displayTitle)
                    .font(.body.weight(.medium))
                    .foregroundStyle(.primary)
                    .lineLimit(2)
                Spacer(minLength: 8)
                Text(listing.displayPrice)
                    .font(.body.weight(.semibold))
                    .foregroundStyle(.primary)
                    .monospacedDigit()
            }

            HStack(spacing: 8) {
                if let status = listing.status, !status.isEmpty {
                    Text(status.replacingOccurrences(of: "_", with: " ").capitalized)
                        .font(.caption.weight(.medium))
                        .foregroundStyle(.secondary)
                }
                if let category = listing.categoryName, !category.isEmpty {
                    Text("·")
                        .foregroundStyle(.tertiary)
                    Text(category)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                if let location = listing.locationLabel {
                    Text("·")
                        .foregroundStyle(.tertiary)
                    Text(location)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }

            HStack(spacing: 12) {
                if let bids = listing.bidCount {
                    Label("\(bids)", systemImage: "hammer")
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }
                if let ends = listing.auctionEndsAt {
                    Label(ends.formatted(date: .abbreviated, time: .shortened), systemImage: "clock")
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }
            }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
    }
}

#Preview {
    MarketplaceView()
}
