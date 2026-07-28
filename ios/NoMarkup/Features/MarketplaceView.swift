import SwiftUI

/// Goods forward-auction surface. Loads active listings from the gateway.
///
/// DES.12 / MP.1: on regular horizontal size class (iPad landscape / large),
/// use `NavigationSplitView` (sidebar list + detail). Compact (iPhone) keeps
/// a single `NavigationStack`. Detail forms use `brandReadableWidth` elsewhere.
struct MarketplaceView: View {
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass

    @State private var listings: [ListingSummary] = []
    @State private var pagination: PaginationMeta?
    @State private var isLoading = false
    @State private var isLoadingMore = false
    @State private var errorMessage: String?
    @State private var loadMoreError: String?
    @State private var searchText = ""
    @State private var categorySlugFilter: String?
    @State private var suggestions: [ListingAutocompleteSuggestion] = []
    @State private var isLoadingSuggestions = false
    @State private var autocompleteTask: Task<Void, Never>?
    @State private var selectedListingRoute: ListingIDRoute?
    /// Split-view selection (regular width only).
    @State private var selectedListing: ListingSummary?

    private var usesSplitView: Bool { horizontalSizeClass == .regular }

    var body: some View {
        Group {
            if usesSplitView {
                NavigationSplitView {
                    listRoot
                } detail: {
                    NavigationStack {
                        if let selectedListing {
                            ListingDetailView(listingID: selectedListing.id, preview: selectedListing)
                        } else if let route = selectedListingRoute {
                            ListingDetailView(listingID: route.id, preview: nil)
                        } else {
                            ContentUnavailableView(
                                "Select a listing",
                                systemImage: "bag",
                                description: Text("Choose an item from the marketplace list.")
                            )
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                            .brandScreenBackground()
                        }
                    }
                }
            } else {
                NavigationStack {
                    listRoot
                        .navigationDestination(for: ListingSummary.self) { listing in
                            ListingDetailView(listingID: listing.id, preview: listing)
                        }
                        .navigationDestination(item: $selectedListingRoute) { route in
                            ListingDetailView(listingID: route.id, preview: nil)
                        }
                }
            }
        }
    }

    private var listRoot: some View {
        content
            .navigationTitle("Marketplace")
            .searchable(text: $searchText, prompt: "Search listings")
            .onSubmit(of: .search) {
                // Free-text search clears a prior category-slug filter so q= wins.
                categorySlugFilter = nil
                suggestions = []
                Task { await load(reset: true) }
            }
            .onChange(of: searchText) { _, newValue in
                scheduleAutocomplete(for: newValue)
                // Clearing the search field also clears the category filter.
                if newValue.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    categorySlugFilter = nil
                }
            }
            .refreshable { await load(reset: true) }
            .task { await load(reset: true) }
            .toolbarBackground(BrandTheme.navy, for: .navigationBar)
    }

    @ViewBuilder
    private var content: some View {
        if isLoading && listings.isEmpty && !showsSuggestions {
            ProgressView("Loading listings…")
                .tint(BrandTheme.accent)
                .foregroundStyle(BrandTheme.textSecondary)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .brandScreenBackground()
        } else if let errorMessage, listings.isEmpty, !showsSuggestions {
            BrandEmptyState(
                title: "Couldn’t load listings",
                systemImage: "wifi.exclamationmark",
                message: errorMessage,
                actionTitle: "Try again"
            ) {
                Task { await load(reset: true) }
            }
        } else if listings.isEmpty, !showsSuggestions {
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

                if showsSuggestions {
                    suggestionsSection
                }

                if let categorySlugFilter, !categorySlugFilter.isEmpty {
                    Section {
                        HStack(spacing: 10) {
                            Image(systemName: "tag.fill")
                                .foregroundStyle(BrandTheme.goldBright)
                                .accessibilityHidden(true)
                            Text("Category: \(categorySlugFilter)")
                                .font(.subheadline.weight(.medium))
                                .foregroundStyle(BrandTheme.textPrimary)
                                .lineLimit(1)
                            Spacer(minLength: 8)
                            Button("Clear") {
                                self.categorySlugFilter = nil
                                searchText = ""
                                suggestions = []
                                Task { await load(reset: true) }
                            }
                            .font(.subheadline.weight(.medium))
                            .foregroundStyle(BrandTheme.destructive)
                            .frame(minHeight: 44)
                            .accessibilityLabel("Clear category filter")
                        }
                        .listRowBackground(BrandTheme.navyElevated)
                    }
                }

                Section {
                    ForEach(listings) { listing in
                        if usesSplitView {
                            Button {
                                selectedListing = listing
                                selectedListingRoute = nil
                            } label: {
                                ListingRowView(listing: listing)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            .frame(minHeight: 44)
                            .listRowBackground(
                                selectedListing?.id == listing.id
                                    ? BrandTheme.surfaceRaised
                                    : BrandTheme.navyElevated
                            )
                            .accessibilityHint("Shows listing detail in the side panel")
                        } else {
                            NavigationLink(value: listing) {
                                ListingRowView(listing: listing)
                            }
                            .frame(minHeight: 44)
                            .listRowBackground(BrandTheme.navyElevated)
                            .accessibilityHint("Opens listing detail")
                        }
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

    private var showsSuggestions: Bool {
        searchText.trimmingCharacters(in: .whitespacesAndNewlines).count >= 2
            && (!suggestions.isEmpty || isLoadingSuggestions)
    }

    @ViewBuilder
    private var suggestionsSection: some View {
        Section {
            if isLoadingSuggestions && suggestions.isEmpty {
                HStack(spacing: 10) {
                    ProgressView()
                        .tint(BrandTheme.accent)
                    Text("Searching…")
                        .font(.subheadline)
                        .foregroundStyle(BrandTheme.textSecondary)
                }
                .frame(minHeight: 44)
                .listRowBackground(BrandTheme.navyElevated)
            } else {
                ForEach(suggestions, id: \.suggestionKey) { suggestion in
                    Button {
                        handleSuggestion(suggestion)
                    } label: {
                        SuggestionRowView(suggestion: suggestion)
                    }
                    .buttonStyle(.plain)
                    .frame(minHeight: 44)
                    .listRowBackground(BrandTheme.navyElevated)
                    .accessibilityHint(
                        suggestion.isCategory
                            ? "Filters marketplace by this category"
                            : "Opens listing detail"
                    )
                }
            }
        } header: {
            Text("Suggestions").brandSectionHeader()
        }
    }

    private func scheduleAutocomplete(for raw: String) {
        autocompleteTask?.cancel()
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.count >= 2 else {
            suggestions = []
            isLoadingSuggestions = false
            return
        }
        autocompleteTask = Task { @MainActor in
            // Light debounce so we don't fire on every keystroke.
            try? await Task.sleep(nanoseconds: 220_000_000)
            guard !Task.isCancelled else { return }
            isLoadingSuggestions = true
            defer { isLoadingSuggestions = false }
            do {
                let hits = try await APIClient.shared.autocompleteListings(q: trimmed, limit: 10)
                guard !Task.isCancelled else { return }
                // Ignore stale responses if the field changed while in flight.
                let current = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
                guard current == trimmed else { return }
                suggestions = hits
            } catch {
                guard !Task.isCancelled else { return }
                // Soft-fail: typeahead is non-critical.
                suggestions = []
            }
        }
    }

    @MainActor
    private func handleSuggestion(_ suggestion: ListingAutocompleteSuggestion) {
        if suggestion.isCategory {
            let slug = suggestion.categorySlug?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            let label = suggestion.displayLabel
            categorySlugFilter = slug.isEmpty ? nil : slug
            // Show the friendly label in the search field; list filters by slug.
            searchText = label
            suggestions = []
            Task { await load(reset: true) }
            return
        }

        if suggestion.isListing {
            let listingID = suggestion.id?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            guard !listingID.isEmpty else { return }
            suggestions = []
            selectedListingRoute = ListingIDRoute(id: listingID)
            return
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

        // When filtering by category slug, skip free-text `q` so the slug is authoritative
        // (search field holds the friendly label, not a Meili query).
        let qParam: String? = {
            if let slug = categorySlugFilter, !slug.isEmpty { return nil }
            return searchText
        }()

        // Optional AppConfig browse center → gateway lat/lng + 25 mi radius
        // (populates `distance_km` when PostGIS center resolves).
        let center = AppConfig.browseCoordinate

        do {
            let response = try await APIClient.shared.fetchListings(
                page: nextPage,
                pageSize: pageSize,
                q: qParam,
                categorySlug: categorySlugFilter,
                latitude: center?.lat,
                longitude: center?.lng,
                radiusKm: center.map { _ in AppConfig.marketplaceRadiusKm }
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
                let live = (listing.status ?? "").lowercased() == "active"
                    && (listing.auctionCountdown.map { $0 != "Ended" } ?? true)
                if live {
                    HStack(spacing: 4) {
                        Circle()
                            .fill(BrandTheme.success)
                            .frame(width: 6, height: 6)
                        Text("LIVE")
                            .font(.caption2.weight(.bold))
                            .foregroundStyle(BrandTheme.success)
                    }
                }
                Text("Bid up")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(BrandTheme.goldBright)
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
                // Server `distance_km` when browse center was supplied (AppConfig lat/lng).
                if let distance = listing.distanceLabel {
                    Label(distance, systemImage: "location.fill")
                        .font(.caption.weight(.medium))
                        .foregroundStyle(BrandTheme.teal)
                        .lineLimit(1)
                }
                // City/state, else pickup ZIP (`locationLabel` already falls back to ZIP).
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

// MARK: - Suggestion row

private struct SuggestionRowView: View {
    let suggestion: ListingAutocompleteSuggestion

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: suggestion.isCategory ? "tag.fill" : "bag.fill")
                .font(.body)
                .foregroundStyle(suggestion.isCategory ? BrandTheme.goldBright : BrandTheme.teal)
                .frame(width: 24, alignment: .center)
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 2) {
                Text(suggestion.displayLabel)
                    .font(.body.weight(.medium))
                    .foregroundStyle(BrandTheme.textPrimary)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
                if let secondary = suggestion.secondaryLabel {
                    Text(secondary)
                        .font(.caption)
                        .foregroundStyle(BrandTheme.textSecondary)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 8)
            Image(systemName: "chevron.right")
                .font(.caption.weight(.semibold))
                .foregroundStyle(BrandTheme.textSecondary.opacity(0.6))
                .accessibilityHidden(true)
        }
        .contentShape(Rectangle())
        .frame(minHeight: 44)
        .accessibilityElement(children: .combine)
    }
}

/// Lightweight route for autocomplete → listing detail navigation.
private struct ListingIDRoute: Hashable, Identifiable {
    let id: String
}

#Preview {
    MarketplaceView()
        .preferredColorScheme(.dark)
        .tint(BrandTheme.accent)
}
