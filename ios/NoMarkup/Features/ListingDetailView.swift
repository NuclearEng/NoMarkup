import SwiftUI

/// Listing detail for a single goods auction. Public read; native report + optional bid.
struct ListingDetailView: View {
    let listingID: String
    var preview: ListingSummary?

    @EnvironmentObject private var auth: AuthViewModel

    @State private var detail: ListingDetail?
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var showReportSheet = false
    @State private var showWebSafari = false

    @State private var bidAmountText = ""
    @State private var isPlacingBid = false
    @State private var bidStatusMessage: String?
    @State private var bidStatusIsError = false

    @State private var isBuyingNow = false
    @State private var buyNowStatusMessage: String?
    @State private var buyNowStatusIsError = false

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
        .sheet(isPresented: $showReportSheet) {
            ListingReportSheet(listingID: listingID) {
                showReportSheet = false
            }
        }
        .sheet(isPresented: $showWebSafari) {
            NavigationStack {
                LegalWebView(title: "Listing on web", url: webListingURL)
                    .toolbar {
                        ToolbarItem(placement: .cancellationAction) {
                            Button("Done") { showWebSafari = false }
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

            buyNowSection(listing)

            placeBidSection(listing)

            Section {
                Button {
                    showReportSheet = true
                } label: {
                    Label("Report listing", systemImage: "flag")
                        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                }

                Button {
                    showWebSafari = true
                } label: {
                    Label("Open on web", systemImage: "safari")
                        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                }
            }
        }
        .listStyle(.insetGrouped)
    }

    @ViewBuilder
    private func buyNowSection(_ listing: ListingDetail) -> some View {
        if let buyNowCents = listing.buyNowPriceCents, buyNowCents > 0 {
            let priceLabel = MoneyFormat.usd(cents: buyNowCents)
            let isActive = (listing.status ?? "").lowercased() == "active"

            Section {
                if !auth.isAuthenticated {
                    Text("Sign in to buy now with Apple Pay.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                } else if auth.isScaffoldSession {
                    Text("Scaffold session has no API credentials. Sign in against a live gateway to pay.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                    Button {} label: {
                        Label("Buy now \(priceLabel)", systemImage: "apple.logo")
                            .frame(maxWidth: .infinity, minHeight: 44)
                    }
                    .disabled(true)
                } else if !isActive {
                    Text("Buy now is only available while the auction is active.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                } else {
                    Text("Pays \(priceLabel) via Apple Pay (or card). Funds are held in escrow until you confirm pickup. Local pickup only.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)

                    if let buyNowStatusMessage {
                        Text(buyNowStatusMessage)
                            .font(.footnote)
                            .foregroundStyle(buyNowStatusIsError ? .red : .secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }

                    Button {
                        Task { await buyNow() }
                    } label: {
                        if isBuyingNow {
                            ProgressView()
                                .frame(maxWidth: .infinity, minHeight: 44)
                        } else {
                            Label("Buy now \(priceLabel)", systemImage: "apple.logo")
                                .frame(maxWidth: .infinity, minHeight: 44)
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(Color("AccentColor"))
                    .disabled(isBuyingNow || isPlacingBid)
                    .accessibilityLabel("Buy now for \(priceLabel) with Apple Pay")
                }
            } header: {
                Text("Buy now")
            }
        }
    }

    @ViewBuilder
    private func placeBidSection(_ listing: ListingDetail) -> some View {
        Section {
            if !auth.isAuthenticated {
                Text("Sign in to place a bid on this listing.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            } else if auth.isScaffoldSession {
                Text("Scaffold session has no API credentials. Sign in against a live gateway to place bids.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                TextField("Bid amount (USD)", text: $bidAmountText)
                    .keyboardType(.decimalPad)
                    .textContentType(.none)
                    .disabled(true)
                    .frame(minHeight: 44)
                Button("Place bid") {}
                    .disabled(true)
                    .frame(maxWidth: .infinity, minHeight: 44)
            } else {
                Text("Enter your bid in dollars. Current price is \(listing.displayPrice).")
                    .font(.footnote)
                    .foregroundStyle(.secondary)

                TextField("Bid amount (USD)", text: $bidAmountText)
                    .keyboardType(.decimalPad)
                    .textContentType(.none)
                    .autocorrectionDisabled()
                    .frame(minHeight: 44)
                    .accessibilityLabel("Bid amount in dollars")

                if let bidStatusMessage {
                    Text(bidStatusMessage)
                        .font(.footnote)
                        .foregroundStyle(bidStatusIsError ? .red : .secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }

                Button {
                    Task { await placeListingBid() }
                } label: {
                    if isPlacingBid {
                        ProgressView()
                            .frame(maxWidth: .infinity, minHeight: 44)
                    } else {
                        Text("Place bid")
                            .frame(maxWidth: .infinity, minHeight: 44)
                    }
                }
                .buttonStyle(.borderedProminent)
                .tint(Color("AccentColor"))
                .disabled(
                    isPlacingBid
                        || isBuyingNow
                        || bidAmountText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                )
            }
        } header: {
            Text("Place a bid")
        }
    }

    @MainActor
    private func buyNow() async {
        buyNowStatusMessage = nil
        buyNowStatusIsError = false

        guard !auth.isScaffoldSession else {
            buyNowStatusIsError = true
            buyNowStatusMessage =
                "Scaffold session has no API credentials. Sign in against a live gateway to pay."
            return
        }

        isBuyingNow = true
        defer { isBuyingNow = false }

        do {
            let response = try await APIClient.shared.buyNow(listingId: listingID)
            let envelope = response.envelope

            if let secret = envelope.clientSecret, envelope.hasConfirmableSecret {
                try await RailACheckout.presentPaymentSheet(clientSecret: secret)
                buyNowStatusIsError = false
                buyNowStatusMessage =
                    "Payment complete — order \(response.orderId ?? "") is held in escrow until pickup."
                await load()
                return
            }

            // Order created but PI not attachable — buyer can retry from Orders.
            if let orderId = response.orderId, !orderId.isEmpty {
                buyNowStatusIsError = true
                if let chargeError = response.chargeError, !chargeError.isEmpty {
                    buyNowStatusMessage =
                        "Order \(orderId) created, but payment could not start (\(chargeError)). Open Account → Orders to pay with Apple Pay."
                } else {
                    buyNowStatusMessage =
                        "Order \(orderId) created and awaits payment. Open Account → Orders to pay with Apple Pay."
                }
                await load()
                return
            }

            buyNowStatusIsError = true
            buyNowStatusMessage = "Buy now did not return an order. Please try again."
        } catch let error as RailACheckout.CheckoutError where error.isCanceled {
            buyNowStatusIsError = false
            buyNowStatusMessage =
                "Payment canceled. If an order was created, finish paying under Account → Orders."
            await load()
        } catch let error as APIClientError where error.isUnauthorized {
            buyNowStatusIsError = true
            buyNowStatusMessage = "Sign in required. Your session is missing or expired — please sign in again."
        } catch {
            buyNowStatusIsError = true
            buyNowStatusMessage = error.localizedDescription
        }
    }

    @MainActor
    private func placeListingBid() async {
        bidStatusMessage = nil
        bidStatusIsError = false

        guard !auth.isScaffoldSession else {
            bidStatusIsError = true
            bidStatusMessage =
                "Scaffold session has no API credentials. Sign in against a live gateway to place bids."
            return
        }

        guard let cents = MoneyFormat.cents(fromDollarsText: bidAmountText) else {
            bidStatusIsError = true
            bidStatusMessage = "Enter a valid bid amount in dollars (for example 25.00)."
            return
        }

        isPlacingBid = true
        defer { isPlacingBid = false }

        do {
            _ = try await APIClient.shared.placeListingBid(listingId: listingID, amountCents: cents)
            bidStatusIsError = false
            bidStatusMessage = "Bid placed: \(MoneyFormat.usd(cents: cents))."
            bidAmountText = ""
            await load()
        } catch let error as APIClientError where error.isUnauthorized {
            bidStatusIsError = true
            bidStatusMessage = "Sign in required. Your session is missing or expired — please sign in again."
        } catch {
            bidStatusIsError = true
            bidStatusMessage = error.localizedDescription
        }
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

// MARK: - Report sheet

private struct ListingReportSheet: View {
    let listingID: String
    var onDone: () -> Void

    @State private var reason: ListingReportReason = .misleading
    @State private var descriptionText = ""
    @State private var isSubmitting = false
    @State private var statusMessage: String?
    @State private var statusIsError = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("Reason", selection: $reason) {
                        ForEach(ListingReportReason.allCases) { item in
                            Text(item.displayName).tag(item)
                        }
                    }
                    .frame(minHeight: 44)
                    .accessibilityLabel("Report reason")
                } header: {
                    Text("Why are you reporting this?")
                }

                Section {
                    TextEditor(text: $descriptionText)
                        .frame(minHeight: 120)
                        .accessibilityLabel("Additional details")
                } header: {
                    Text("Details (optional)")
                } footer: {
                    Text("Reports help keep the marketplace safe. False reports may lead to account action.")
                }

                if let statusMessage {
                    Section {
                        Text(statusMessage)
                            .font(.footnote)
                            .foregroundStyle(statusIsError ? .red : .secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }

                Section {
                    Button {
                        Task { await submit() }
                    } label: {
                        if isSubmitting {
                            ProgressView()
                                .frame(maxWidth: .infinity, minHeight: 44)
                        } else {
                            Text("Submit report")
                                .frame(maxWidth: .infinity, minHeight: 44)
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(isSubmitting)
                }
            }
            .navigationTitle("Report listing")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { onDone() }
                        .frame(minHeight: 44)
                }
            }
        }
    }

    @MainActor
    private func submit() async {
        statusMessage = nil
        statusIsError = false
        isSubmitting = true
        defer { isSubmitting = false }

        do {
            let response = try await APIClient.shared.reportListing(
                id: listingID,
                reason: reason.rawValue,
                description: descriptionText.trimmingCharacters(in: .whitespacesAndNewlines)
            )
            statusIsError = false
            statusMessage = response.userFacingMessage
            // Brief pause so the user can read the confirmation, then dismiss.
            try? await Task.sleep(nanoseconds: 900_000_000)
            onDone()
        } catch let error as APIClientError where error.isUnauthorized {
            // Report allows anonymous; 401 would be unexpected. Surface clearly.
            statusIsError = true
            statusMessage = "Sign in required. Your session is missing or expired — please sign in again."
        } catch {
            statusIsError = true
            statusMessage = error.localizedDescription
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
        .environmentObject(AuthViewModel())
    }
}
