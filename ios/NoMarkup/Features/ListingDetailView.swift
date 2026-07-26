import SwiftUI

/// Listing detail for a single goods auction. Public read; report on web for now.
struct ListingDetailView: View {
    let listingID: String
    var preview: ListingSummary?

    @State private var detail: ListingDetail?
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var showReportSafari = false

    init(listingID: String, preview: ListingSummary? = nil) {
        self.listingID = listingID
        self.preview = preview
        if let preview {
            _detail = State(initialValue: ListingDetail(from: preview))
        }
    }

    private var webListingURL: URL {
        AppConfig.publicWebBaseURL
            .appending(path: "marketplace")
            .appending(path: listingID)
    }

    var body: some View {
        Group {
            if let detail {
                detailContent(detail)
            } else if isLoading {
                ProgressView("Loading…")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let errorMessage {
                ContentUnavailableView {
                    Label("Couldn’t load listing", systemImage: "exclamationmark.triangle")
                } description: {
                    Text(errorMessage)
                } actions: {
                    Button("Try again") {
                        Task { await load() }
                    }
                    .buttonStyle(.borderedProminent)
                    .frame(minHeight: 44)
                }
            } else {
                ProgressView()
            }
        }
        .navigationTitle(detail?.displayTitle ?? "Listing")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .task { await load() }
        .refreshable { await load() }
        .sheet(isPresented: $showReportSafari) {
            NavigationStack {
                LegalWebView(title: "Report on web", url: webListingURL)
                    .toolbar {
                        ToolbarItem(placement: .cancellationAction) {
                            Button("Done") { showReportSafari = false }
                                .frame(minHeight: 44)
                        }
                    }
            }
        }
    }

    @ViewBuilder
    private func detailContent(_ listing: ListingDetail) -> some View {
        List {
            Section {
                VStack(alignment: .leading, spacing: 8) {
                    Text(listing.displayTitle)
                        .font(.title2.weight(.semibold))
                        .fixedSize(horizontal: false, vertical: true)

                    Text(listing.displayPrice)
                        .font(.title3.weight(.bold).monospacedDigit())

                    if let start = listing.startingPriceCents, start != listing.displayPriceCents {
                        Text("Started at \(MoneyFormat.usd(cents: start))")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                .padding(.vertical, 4)
                .accessibilityElement(children: .combine)
            }

            Section("Details") {
                if let status = listing.status {
                    LabeledContent("Status") {
                        Text(status.replacingOccurrences(of: "_", with: " ").capitalized)
                    }
                }
                if let category = listing.categoryName, !category.isEmpty {
                    LabeledContent("Category", value: category)
                }
                if let condition = listing.condition, !condition.isEmpty {
                    LabeledContent("Condition") {
                        Text(condition.replacingOccurrences(of: "_", with: " ").capitalized)
                    }
                }
                if let location = listing.locationLabel {
                    LabeledContent("Pickup", value: location)
                }
                if let ends = listing.auctionEndsAt {
                    LabeledContent("Ends") {
                        Text(ends.formatted(date: .abbreviated, time: .shortened))
                    }
                }
                if let bids = listing.bidCount {
                    LabeledContent("Bids", value: "\(bids)")
                }
                if let bidders = listing.bidderCount {
                    LabeledContent("Bidders", value: "\(bidders)")
                }
                if let buyNow = listing.buyNowPriceCents {
                    LabeledContent("Buy now", value: MoneyFormat.usd(cents: buyNow))
                }
            }

            if let description = listing.description?.trimmingCharacters(in: .whitespacesAndNewlines),
               !description.isEmpty {
                Section("Description") {
                    Text(description)
                        .font(.body)
                        .foregroundStyle(.primary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }

            if listing.sellerDisplayName != nil || listing.sellerListingsCount != nil {
                Section("Seller") {
                    if let name = listing.sellerDisplayName, !name.isEmpty {
                        LabeledContent("Name", value: name)
                    }
                    if let count = listing.sellerListingsCount {
                        LabeledContent("Listings", value: "\(count)")
                    }
                    if let tier = listing.sellerTrustTier, !tier.isEmpty {
                        LabeledContent("Trust", value: tier.capitalized)
                    }
                }
            }

            Section {
                Text("Report a problem with this listing on the website for now. In-app reporting ships later.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                Button {
                    showReportSafari = true
                } label: {
                    Label("Report on web", systemImage: "safari")
                        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                }
            }
        }
        .listStyle(.insetGrouped)
    }

    @MainActor
    private func load() async {
        isLoading = detail == nil
        errorMessage = nil
        defer { isLoading = false }

        do {
            detail = try await APIClient.shared.fetchListing(id: listingID)
        } catch {
            if detail == nil {
                errorMessage = error.localizedDescription
            }
        }
    }
}

#Preview {
    NavigationStack {
        ListingDetailView(
            listingID: "00000000-0000-0000-0000-000000000001",
            preview: ListingSummary(
                id: "00000000-0000-0000-0000-000000000001",
                sellerId: nil,
                categoryId: nil,
                categoryName: "Tools",
                categorySlug: nil,
                title: "Sample drill set",
                description: "Barely used.",
                status: "active",
                photos: nil,
                pickupZip: nil,
                pickupCity: "Austin",
                pickupState: "TX",
                pickupAddress: nil,
                startingPriceCents: 2500,
                currentBidCents: 4000,
                minIncrementCents: nil,
                reservePriceCents: nil,
                buyNowPriceCents: nil,
                bidderCount: 2,
                bidCount: 3,
                auctionDurationHours: nil,
                auctionEndsAt: Date().addingTimeInterval(3600),
                watcherCount: nil,
                condition: "like_new",
                distanceKm: nil,
                createdAt: nil,
                updatedAt: nil
            )
        )
    }
}
