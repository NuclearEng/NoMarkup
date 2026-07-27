import SwiftUI

/// Seller's own goods listings — `GET /api/v1/listings/mine`.
/// Rows navigate to `ListingDetailView` for ladder, offers, and status.
struct MyListingsView: View {
    @EnvironmentObject private var auth: AuthViewModel

    @State private var listings: [ListingSummary] = []
    @State private var pagination: PaginationMeta?
    @State private var statusFilter: String = ""
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var needsSignIn = false

    private let statusFilters: [(id: String, label: String)] = [
        ("", "All"),
        ("active", "Active"),
        ("ended", "Ended"),
        ("sold", "Sold"),
        ("draft", "Draft"),
    ]

    var body: some View {
        Group {
            if auth.isScaffoldSession {
                BrandEmptyState(
                    title: "Sign in required",
                    systemImage: "tag",
                    message: "Browse-only mode has no API credentials. Sign in against a live gateway to load your listings."
                )
            } else if needsSignIn || !auth.isAuthenticated {
                BrandEmptyState(
                    title: "Sign in required",
                    systemImage: "person.crop.circle.badge.exclamationmark",
                    message: "Sign in to see goods listings you’ve posted as a seller.",
                    actionTitle: "Sign in"
                ) {
                    auth.signOut()
                }
            } else {
                content
            }
        }
        .navigationTitle("My listings")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbarBackground(BrandTheme.navy, for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
        .task { await load() }
        .refreshable { await load() }
        .onChange(of: statusFilter) { _, _ in
            Task { await load() }
        }
        .navigationDestination(for: ListingSummary.self) { listing in
            ListingDetailView(listingID: listing.id, preview: listing)
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
                systemImage: "exclamationmark.triangle",
                message: errorMessage,
                actionTitle: "Try again"
            ) {
                Task { await load() }
            }
        } else {
            List {
                Section {
                    Picker("Status", selection: $statusFilter) {
                        ForEach(statusFilters, id: \.id) { item in
                            Text(item.label).tag(item.id)
                        }
                    }
                    .pickerStyle(.menu)
                    .listRowBackground(BrandTheme.navyElevated)
                    .accessibilityLabel("Filter listings by status")
                }

                if listings.isEmpty {
                    Section {
                        Text(emptyFilterMessage)
                            .font(.subheadline)
                            .foregroundStyle(BrandTheme.textSecondary)
                            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                            .listRowBackground(BrandTheme.navyElevated)
                    }
                } else {
                    Section {
                        ForEach(listings) { listing in
                            NavigationLink(value: listing) {
                                listingRow(listing)
                            }
                            .frame(minHeight: 44)
                            .listRowBackground(BrandTheme.navyElevated)
                            .accessibilityHint("Opens listing detail")
                        }
                    } header: {
                        if let total = pagination?.resolvedTotal, total > 0 {
                            Text("\(listings.count) of \(total)").brandSectionHeader()
                        } else {
                            Text("\(listings.count) listing\(listings.count == 1 ? "" : "s")")
                                .brandSectionHeader()
                        }
                    } footer: {
                        Text("Forward auctions you sell. Open a row for bids, Best Offers, and auction status. Local pickup only.")
                            .foregroundStyle(BrandTheme.textSecondary)
                    }
                }
            }
            .brandListBackground()
        }
    }

    private var emptyFilterMessage: String {
        if statusFilter.isEmpty {
            return "No listings yet. Use Account → Sell an item to post a local goods auction."
        }
        let label = statusFilters.first(where: { $0.id == statusFilter })?.label ?? statusFilter
        return "No \(label.lowercased()) listings."
    }

    @ViewBuilder
    private func listingRow(_ listing: ListingSummary) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline) {
                Text(listing.displayTitle)
                    .font(.body.weight(.medium))
                    .foregroundStyle(BrandTheme.textPrimary)
                    .lineLimit(2)
                Spacer(minLength: 8)
                Text(listing.displayPrice)
                    .font(.subheadline.weight(.semibold).monospacedDigit())
                    .foregroundStyle(BrandTheme.goldBright)
            }

            HStack(spacing: 8) {
                if let status = listing.status, !status.isEmpty {
                    StatusChipView(
                        label: StatusChipStyle.displayLabel(status),
                        style: StatusChipStyle.forStatus(status)
                    )
                }
                Text(listing.priceCaption)
                    .font(.caption)
                    .foregroundStyle(BrandTheme.textSecondary)
                if let bids = listing.bidCount {
                    Text("· \(bids) bid\(bids == 1 ? "" : "s")")
                        .font(.caption)
                        .foregroundStyle(BrandTheme.textSecondary)
                }
                if let location = listing.locationLabel {
                    Text("· \(location)")
                        .font(.caption)
                        .foregroundStyle(BrandTheme.textSecondary)
                        .lineLimit(1)
                }
            }

            if let countdown = listing.auctionCountdown {
                Label(countdown, systemImage: "clock")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(countdown == "Ended" ? BrandTheme.textSecondary : BrandTheme.goldBright)
            }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(listing.displayTitle), \(listing.displayPrice)")
    }

    @MainActor
    private func load() async {
        guard auth.isAuthenticated, !auth.isScaffoldSession else {
            needsSignIn = !auth.isAuthenticated || auth.isScaffoldSession
            listings = []
            return
        }

        needsSignIn = false
        isLoading = listings.isEmpty
        errorMessage = nil
        defer { isLoading = false }

        do {
            let filter = statusFilter.isEmpty ? nil : statusFilter
            let response = try await APIClient.shared.fetchMyListings(
                page: 1,
                pageSize: 40,
                status: filter
            )
            listings = response.listings
            pagination = response.pagination
        } catch let error as APIClientError where error.isUnauthorized {
            needsSignIn = true
            listings = []
            errorMessage = nil
        } catch {
            if listings.isEmpty {
                errorMessage = error.localizedDescription
            }
        }
    }
}

#Preview {
    NavigationStack {
        MyListingsView()
            .environmentObject(AuthViewModel())
    }
    .preferredColorScheme(.dark)
    .tint(BrandTheme.accent)
}
