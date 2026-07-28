import SwiftUI

/// Activity feed of active listings from followed sellers — `GET /api/v1/me/feed`.
struct FeedView: View {
    @EnvironmentObject private var auth: AuthViewModel

    @State private var listings: [ListingSummary] = []
    @State private var pagination: PaginationMeta?
    @State private var page = 1
    @State private var isLoading = false
    @State private var isLoadingMore = false
    @State private var errorMessage: String?
    @State private var needsSignIn = false

    private let pageSize = 40

    private var canLoadMore: Bool {
        guard let pagination else {
            // Unknown total — allow another page only when last fetch was full.
            return listings.count >= page * pageSize
        }
        if pagination.resolvedHasNext {
            return true
        }
        let total = pagination.resolvedTotal
        if total > 0 {
            return listings.count < total
        }
        return listings.count >= page * pageSize
    }

    var body: some View {
        Group {
            if auth.isScaffoldSession {
                BrandEmptyState(
                    title: "Sign in required",
                    systemImage: "rectangle.stack",
                    message: "Browse-only mode has no API credentials. Sign in against a live gateway to load your following feed."
                )
            } else if needsSignIn || !auth.isAuthenticated {
                BrandEmptyState(
                    title: "Sign in required",
                    systemImage: "person.crop.circle.badge.exclamationmark",
                    message: "Sign in to see active auctions from sellers you follow.",
                    actionTitle: "Sign in"
                ) {
                    auth.signOut()
                }
            } else {
                content
            }
        }
        .navigationTitle("Following feed")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbarBackground(BrandTheme.navy, for: .navigationBar)
        .task { await load(reset: true) }
        .refreshable { await load(reset: true) }
        .navigationDestination(for: ListingSummary.self) { listing in
            ListingDetailView(listingID: listing.id, preview: listing)
        }
    }

    @ViewBuilder
    private var content: some View {
        if isLoading && listings.isEmpty {
            ProgressView("Loading feed…")
                .tint(BrandTheme.accent)
                .foregroundStyle(BrandTheme.textSecondary)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .brandScreenBackground()
        } else if let errorMessage, listings.isEmpty {
            BrandEmptyState(
                title: "Couldn’t load feed",
                systemImage: "exclamationmark.triangle",
                message: errorMessage,
                actionTitle: "Try again"
            ) {
                Task { await load(reset: true) }
            }
        } else if listings.isEmpty {
            BrandEmptyState(
                title: "Feed is quiet",
                systemImage: "rectangle.stack.badge.person.crop",
                message: "When sellers you follow list active auctions, they appear here. Follow people from provider profiles."
            )
        } else {
            List {
                Section {
                    Text("Active auctions from sellers you follow, closing soonest first.")
                        .font(.subheadline)
                        .foregroundStyle(BrandTheme.textSecondary)
                        .listRowBackground(BrandTheme.navyElevated)
                }

                Section {
                    ForEach(listings) { listing in
                        NavigationLink(value: listing) {
                            feedRow(listing)
                        }
                        .frame(minHeight: 44)
                        .listRowBackground(BrandTheme.navyElevated)
                        .accessibilityHint("Opens listing detail")
                        .onAppear {
                            if listing.id == listings.last?.id, canLoadMore, !isLoadingMore {
                                Task { await loadMore() }
                            }
                        }
                    }

                    if isLoadingMore {
                        HStack {
                            Spacer()
                            ProgressView()
                                .tint(BrandTheme.accent)
                            Spacer()
                        }
                        .listRowBackground(BrandTheme.navyElevated)
                        .accessibilityLabel("Loading more listings")
                    }
                } header: {
                    if let total = pagination?.resolvedTotal, total > 0 {
                        Text("\(listings.count) of \(total)").brandSectionHeader()
                    } else {
                        Text(String(localized: "\(listings.count) listings"))
                            .brandSectionHeader()
                    }
                } footer: {
                    Text("Local pickup only · pull to refresh · follow more sellers from Account → Following.")
                        .foregroundStyle(BrandTheme.textSecondary)
                }
            }
            .brandListBackground()
        }
    }

    @ViewBuilder
    private func feedRow(_ listing: ListingSummary) -> some View {
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
    private func load(reset: Bool) async {
        guard auth.isAuthenticated, !auth.isScaffoldSession else {
            needsSignIn = !auth.isAuthenticated || auth.isScaffoldSession
            listings = []
            return
        }

        needsSignIn = false
        if reset {
            page = 1
            isLoading = listings.isEmpty
            errorMessage = nil
        }
        defer { isLoading = false }

        do {
            let response = try await APIClient.shared.fetchFeed(page: page, pageSize: pageSize)
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

    @MainActor
    private func loadMore() async {
        guard canLoadMore, !isLoadingMore, !isLoading else { return }
        isLoadingMore = true
        defer { isLoadingMore = false }

        let nextPage = page + 1
        do {
            let response = try await APIClient.shared.fetchFeed(page: nextPage, pageSize: pageSize)
            let existing = Set(listings.map(\.id))
            let appended = response.listings.filter { !existing.contains($0.id) }
            listings.append(contentsOf: appended)
            pagination = response.pagination
            page = nextPage
        } catch let error as APIClientError where error.isUnauthorized {
            needsSignIn = true
        } catch {
            // Keep existing rows; user can pull to refresh.
        }
    }
}

#Preview {
    NavigationStack {
        FeedView()
            .environmentObject(AuthViewModel())
    }
    .preferredColorScheme(.dark)
    .tint(BrandTheme.accent)
}
