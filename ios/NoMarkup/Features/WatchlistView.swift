import SwiftUI

/// Signed-in buyer's watched marketplace listings (`GET /api/v1/me/watchlist`).
/// Navigate to `ListingDetailView` for each row; unwatch from detail toolbar.
struct WatchlistView: View {
    @EnvironmentObject private var auth: AuthViewModel

    @State private var listings: [ListingSummary] = []
    @State private var pagination: PaginationMeta?
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var needsSignIn = false

    var body: some View {
        Group {
            if auth.isScaffoldSession {
                BrandEmptyState(
                    title: "Sign in required",
                    systemImage: "heart",
                    message: "Browse-only mode has no API credentials. Sign in against a live gateway to load your watchlist."
                )
            } else if needsSignIn || !auth.isAuthenticated {
                BrandEmptyState(
                    title: "Sign in required",
                    systemImage: "person.crop.circle.badge.exclamationmark",
                    message: "Sign in to see goods auctions you’ve saved with the heart on listing detail.",
                    actionTitle: "Sign in"
                ) {
                    auth.signOut()
                }
            } else {
                content
            }
        }
        .navigationTitle("Watchlist")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .brandNavigationBarChrome()
        .task { await load() }
        .refreshable { await load() }
        .navigationDestination(for: ListingSummary.self) { listing in
            ListingDetailView(listingID: listing.id, preview: listing)
        }
    }

    @ViewBuilder
    private var content: some View {
        if isLoading && listings.isEmpty {
            BrandLoadingScreen(kind: .catalog, rows: 4, accessibilityLabel: "Loading watchlist…")
        } else if let errorMessage, listings.isEmpty {
            BrandEmptyState(
                title: "Couldn’t load watchlist",
                systemImage: "exclamationmark.triangle",
                message: errorMessage,
                actionTitle: "Try again"
            ) {
                Task { await load() }
            }
        } else if listings.isEmpty {
            BrandEmptyState(
                title: "No watched listings",
                systemImage: "heart.circle",
                message: "Tap the heart on a marketplace listing to watch it. Closing-soon and outbid alerts use this list."
            )
        } else {
            List {
                Section {
                    Text("Forward auctions you’re following. Open a row for bid ladder, buy now, or to unwatch.")
                        .font(.subheadline)
                        .foregroundStyle(BrandTheme.textSecondary)
                        .listRowBackground(BrandTheme.navyElevated)
                }

                Section {
                    ForEach(listings) { listing in
                        NavigationLink(value: listing) {
                            watchlistRow(listing)
                        }
                        .frame(minHeight: 44)
                        .listRowBackground(BrandTheme.navyElevated)
                        .accessibilityHint("Opens listing detail")
                    }
                } header: {
                    if let total = pagination?.resolvedTotal, total > 0 {
                        Text("\(listings.count) of \(total)").brandSectionHeader()
                    } else {
                        Text(String(localized: "\(listings.count) listings"))
                            .brandSectionHeader()
                    }
                } footer: {
                    Text("Local pickup only · buyers bid up · heart toggle lives on listing detail.")
                        .foregroundStyle(BrandTheme.textSecondary)
                }
            }
            .brandListBackground()
        }
    }

    @ViewBuilder
    private func watchlistRow(_ listing: ListingSummary) -> some View {
        let live = Self.isLiveAuction(listing)
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline) {
                Text(listing.displayTitle)
                    .font(.body.weight(.medium))
                    .foregroundStyle(BrandTheme.textPrimary)
                    .lineLimit(2)
                Spacer(minLength: 8)
                Text(listing.displayPrice)
                    .font(.subheadline.weight(.bold).monospacedDigit())
                    .foregroundStyle(BrandTheme.goldBright)
                    .contentTransition(.numericText())
            }

            HStack(spacing: 8) {
                if live {
                    HStack(spacing: 4) {
                        LivePulseDot()
                        Text("LIVE")
                            .font(.caption2.weight(.bold).monospaced())
                            .tracking(0.4)
                            .foregroundStyle(BrandTheme.success)
                    }
                    .accessibilityElement(children: .combine)
                    .accessibilityLabel("Live auction")
                }
                if let status = listing.status, !status.isEmpty, !live {
                    StatusChipView(
                        label: StatusChipStyle.displayLabel(status),
                        style: StatusChipStyle.forStatus(status)
                    )
                }
                Text(listing.priceCaption)
                    .font(.caption)
                    .foregroundStyle(BrandTheme.textSecondary)
                if let location = listing.locationLabel {
                    Text("· \(location)")
                        .font(.caption)
                        .foregroundStyle(BrandTheme.textSecondary)
                        .lineLimit(1)
                }
            }

            if let countdown = listing.auctionCountdown {
                Label(countdown, systemImage: "clock")
                    .font(.caption.weight(.semibold).monospacedDigit())
                    .foregroundStyle(countdown == "Ended" ? BrandTheme.textSecondary : BrandTheme.goldBright)
            }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(
            live
                ? "Live auction, \(listing.displayTitle), \(listing.displayPrice)"
                : "\(listing.displayTitle), \(listing.displayPrice)"
        )
    }

    private static func isLiveAuction(_ listing: ListingSummary) -> Bool {
        (listing.status ?? "").lowercased() == "active"
            && (listing.auctionCountdown.map { $0 != "Ended" } ?? true)
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
            let response = try await APIClient.shared.fetchWatchlist(page: 1, pageSize: 40)
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
        WatchlistView()
            .environmentObject(AuthViewModel())
    }
    .preferredColorScheme(.dark)
    .tint(BrandTheme.accent)
}
