import SwiftUI

/// Activity feed of active listings from followed sellers — `GET /api/v1/me/feed`.
struct FeedView: View {
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
        .toolbarBackground(.visible, for: .navigationBar)
        .task { await load() }
        .refreshable { await load() }
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
                Task { await load() }
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
                    }
                } header: {
                    if let total = pagination?.resolvedTotal, total > 0 {
                        Text("\(listings.count) of \(total)").brandSectionHeader()
                    } else {
                        Text("\(listings.count) listing\(listings.count == 1 ? "" : "s")")
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
            let response = try await APIClient.shared.fetchFeed(page: 1, pageSize: 40)
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
        FeedView()
            .environmentObject(AuthViewModel())
    }
    .preferredColorScheme(.dark)
    .tint(BrandTheme.accent)
}
