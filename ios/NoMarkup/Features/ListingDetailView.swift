import SwiftUI

/// Listing detail for a single goods **forward auction**.
/// Buyers bid **up** — highest bid leads; optional buy-now for instant win.
struct ListingDetailView: View {
    let listingID: String
    var preview: ListingSummary?

    @EnvironmentObject private var auth: AuthViewModel

    @State private var detail: ListingDetail?
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var showReportSheet = false
    @State private var showWebSafari = false

    @State private var bidRows: [ListingBidRow] = []
    @State private var ladderState: ListingLadderState = .idle
    @State private var ladderCurrentBidCents: Int64?
    @State private var ladderBidderCount: Int?

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

    /// Forward auction: highest amount first; winning bid (or #1) is leading.
    private var sortedLadder: [ListingBidRow] {
        bidRows.sorted { lhs, rhs in
            let a = lhs.amountCents ?? 0
            let b = rhs.amountCents ?? 0
            if a != b { return a > b }
            // Prefer isWinning when amounts tie.
            if (lhs.isWinning ?? false) != (rhs.isWinning ?? false) {
                return lhs.isWinning ?? false
            }
            return lhs.displayName.localizedCaseInsensitiveCompare(rhs.displayName) == .orderedAscending
        }
    }

    private var leadingBidCents: Int64? {
        if let winning = sortedLadder.first(where: { $0.isWinning == true })?.amountCents {
            return winning
        }
        if let first = sortedLadder.first?.amountCents {
            return first
        }
        return ladderCurrentBidCents ?? detail?.currentBidCents
    }

    var body: some View {
        Group {
            if let detail {
                detailContent(detail)
            } else if isLoading {
                ProgressView("Loading…")
                    .tint(BrandTheme.accent)
                    .foregroundStyle(BrandTheme.textSecondary)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .brandScreenBackground()
            } else if let errorMessage {
                BrandEmptyState(
                    title: "Couldn’t load listing",
                    systemImage: "exclamationmark.triangle",
                    message: errorMessage,
                    actionTitle: "Try again"
                ) {
                    Task { await load() }
                }
            } else {
                ProgressView()
                    .tint(BrandTheme.accent)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .brandScreenBackground()
            }
        }
        .navigationTitle(detail?.displayTitle ?? "Listing")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbarBackground(BrandTheme.navy, for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
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
            auctionHeroSection(listing)
            bidLadderSection(listing)
            buyNowSection(listing)
            placeBidSection(listing)
            detailsSection(listing)

            if let description = listing.description?.trimmingCharacters(in: .whitespacesAndNewlines),
               !description.isEmpty {
                Section {
                    Text(description)
                        .font(.body)
                        .foregroundStyle(BrandTheme.textPrimary)
                        .fixedSize(horizontal: false, vertical: true)
                } header: {
                    Text("Description").brandSectionHeader()
                }
            }

            if listing.sellerDisplayName != nil || listing.sellerListingsCount != nil {
                Section {
                    if let name = listing.sellerDisplayName, !name.isEmpty {
                        LabeledContent("Name", value: name)
                    }
                    if let count = listing.sellerListingsCount {
                        LabeledContent("Listings", value: "\(count)")
                    }
                    if let tier = listing.sellerTrustTier, !tier.isEmpty {
                        LabeledContent("Trust", value: tier.capitalized)
                    }
                } header: {
                    Text("Seller").brandSectionHeader()
                }
            }

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
        .brandListBackground()
    }

    // MARK: - Auction hero (forward auction)

    @ViewBuilder
    private func auctionHeroSection(_ listing: ListingDetail) -> some View {
        Section {
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 8) {
                    forwardAuctionBadge
                    Spacer(minLength: 8)
                    if let status = listing.status, !status.isEmpty {
                        StatusChipView(
                            label: StatusChipStyle.displayLabel(status),
                            style: StatusChipStyle.forStatus(status)
                        )
                    }
                }

                Text(listing.displayTitle)
                    .font(.title2.weight(.semibold))
                    .foregroundStyle(BrandTheme.textPrimary)
                    .fixedSize(horizontal: false, vertical: true)

                Text(heroPriceAmount(listing))
                    .font(.system(size: 34, weight: .bold, design: .rounded).monospacedDigit())
                    .foregroundStyle(BrandTheme.goldBright)
                    .accessibilityLabel("\(heroPriceCaption(listing)): \(heroPriceAmount(listing))")

                Text(heroPriceCaption(listing))
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(BrandTheme.textSecondary)
                    .textCase(.uppercase)

                if let start = listing.startingPriceCents,
                   start != listing.displayPriceCents,
                   leadingBidCents == nil || start != leadingBidCents {
                    Text("Started at \(MoneyFormat.usd(cents: start))")
                        .font(.caption)
                        .foregroundStyle(BrandTheme.textSecondary)
                }

                (
                    Text("Buyers bid ")
                        + Text("up").fontWeight(.semibold)
                        + Text(" — highest bid leads")
                )
                .font(.subheadline)
                .foregroundStyle(BrandTheme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)

                HStack(spacing: 12) {
                    if listing.auctionEndsAt != nil {
                        liveCountdownChip(date: listing.auctionEndsAt)
                    }
                    bidCountChip(listing: listing)
                }
            }
            .padding(.vertical, 6)
            .accessibilityElement(children: .combine)
        }
    }

    private var forwardAuctionBadge: some View {
        Text("Forward auction · goods")
            .font(.caption.weight(.bold))
            .foregroundStyle(BrandTheme.goldBright)
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .overlay(
                Capsule()
                    .strokeBorder(BrandTheme.gold, lineWidth: 1.5)
            )
            .accessibilityLabel("Forward auction, goods")
    }

    @ViewBuilder
    private func liveCountdownChip(date: Date?) -> some View {
        if let date {
            TimelineView(.periodic(from: .now, by: 1)) { context in
                let label = CatalogDateFormat.countdownLabel(until: date, now: context.date)
                Label(label, systemImage: "clock.fill")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(label == "Ended" ? BrandTheme.textSecondary : BrandTheme.goldBright)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .background(BrandTheme.navyElevated, in: Capsule())
                    .overlay(
                        Capsule()
                            .strokeBorder(BrandTheme.gold.opacity(0.25), lineWidth: 1)
                    )
                    .accessibilityLabel("Auction \(label)")
            }
        }
    }

    @ViewBuilder
    private func bidCountChip(listing: ListingDetail) -> some View {
        let count = effectiveBidCount(listing: listing)
        Label("\(count) bid\(count == 1 ? "" : "s")", systemImage: "arrow.up.circle")
            .font(.caption.weight(.semibold))
            .foregroundStyle(BrandTheme.textPrimary)
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(BrandTheme.navyElevated, in: Capsule())
            .overlay(
                Capsule()
                    .strokeBorder(BrandTheme.gold.opacity(0.2), lineWidth: 1)
            )
            .accessibilityLabel("\(count) bids")
    }

    private func effectiveBidCount(listing: ListingDetail) -> Int {
        if case .loaded = ladderState, !bidRows.isEmpty {
            return bidRows.count
        }
        return listing.bidCount ?? bidRows.count
    }

    private func heroPriceAmount(_ listing: ListingDetail) -> String {
        if let leading = leadingBidCents {
            return MoneyFormat.usd(cents: leading)
        }
        return listing.displayPrice
    }

    private func heroPriceCaption(_ listing: ListingDetail) -> String {
        if leadingBidCents != nil || listing.currentBidCents != nil {
            return "Current high bid"
        }
        return "Starting price"
    }

    // MARK: - Bid ladder (public)

    @ViewBuilder
    private func bidLadderSection(_ listing: ListingDetail) -> some View {
        Section {
            switch ladderState {
            case .idle, .loading:
                HStack(spacing: 10) {
                    ProgressView()
                        .tint(BrandTheme.accent)
                    Text("Loading bid ladder…")
                        .font(.footnote)
                        .foregroundStyle(BrandTheme.textSecondary)
                }
                .frame(minHeight: 44)

            case .failed(let message):
                VStack(alignment: .leading, spacing: 8) {
                    Text(message)
                        .font(.footnote)
                        .foregroundStyle(BrandTheme.destructive)
                        .fixedSize(horizontal: false, vertical: true)
                    Button("Retry") {
                        Task { await loadBids() }
                    }
                    .frame(minHeight: 44)
                }

            case .loaded:
                if sortedLadder.isEmpty {
                    Text("No bids yet — be first to bid")
                        .font(.subheadline)
                        .foregroundStyle(BrandTheme.textSecondary)
                        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                        .accessibilityLabel("No bids yet — be first to bid")
                } else {
                    ForEach(Array(sortedLadder.enumerated()), id: \.element.id) { index, row in
                        listingBidRow(row: row, rank: index + 1)
                    }
                }
            }
        } header: {
            Text("Bid ladder").brandSectionHeader()
        } footer: {
            Text("Highest bid leads in a forward auction. The winning bid is highlighted.")
                .foregroundStyle(BrandTheme.textSecondary)
        }
    }

    @ViewBuilder
    private func listingBidRow(row: ListingBidRow, rank: Int) -> some View {
        let isWinning = row.isWinning == true || (rank == 1 && sortedLadder.first?.id == row.id)

        HStack(alignment: .center, spacing: 12) {
            Text("#\(rank)")
                .font(.caption.weight(.bold).monospacedDigit())
                .foregroundStyle(isWinning ? BrandTheme.success : BrandTheme.textSecondary)
                .frame(width: 28, alignment: .leading)

            Text(row.displayName)
                .font(.body.weight(.medium))
                .foregroundStyle(BrandTheme.textPrimary)
                .lineLimit(1)

            Spacer(minLength: 8)

            VStack(alignment: .trailing, spacing: 4) {
                Text(row.displayAmount)
                    .font(.body.weight(.bold).monospacedDigit())
                    .foregroundStyle(BrandTheme.goldBright)
                if isWinning {
                    Text("Winning")
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(BrandTheme.success)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(BrandTheme.success.opacity(0.15), in: Capsule())
                        .accessibilityLabel("Winning bid")
                }
            }
        }
        .padding(.vertical, 4)
        .frame(minHeight: 44)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(
            isWinning
                ? "Rank \(rank), winning, \(row.displayName), \(row.displayAmount)"
                : "Rank \(rank), \(row.displayName), \(row.displayAmount)"
        )
    }

    // MARK: - Buy now

    @ViewBuilder
    private func buyNowSection(_ listing: ListingDetail) -> some View {
        if let buyNowCents = listing.buyNowPriceCents, buyNowCents > 0 {
            let priceLabel = MoneyFormat.usd(cents: buyNowCents)
            let isActive = (listing.status ?? "").lowercased() == "active"

            Section {
                if !auth.isAuthenticated {
                    Text("Sign in to buy now with Apple Pay.")
                        .font(.footnote)
                        .foregroundStyle(BrandTheme.textSecondary)
                } else if auth.isScaffoldSession {
                    Text("Scaffold session has no API credentials. Sign in against a live gateway to pay.")
                        .font(.footnote)
                        .foregroundStyle(BrandTheme.textSecondary)
                    Button {} label: {
                        Label("Buy now \(priceLabel)", systemImage: "apple.logo")
                            .frame(maxWidth: .infinity, minHeight: 44)
                    }
                    .disabled(true)
                } else if !isActive {
                    Text("Buy now is only available while the auction is active.")
                        .font(.footnote)
                        .foregroundStyle(BrandTheme.textSecondary)
                } else {
                    Text("Pays \(priceLabel) via Apple Pay (or card). Funds are held in escrow until you confirm pickup. Local pickup only.")
                        .font(.footnote)
                        .foregroundStyle(BrandTheme.textSecondary)

                    if let buyNowStatusMessage {
                        Text(buyNowStatusMessage)
                            .font(.footnote)
                            .foregroundStyle(buyNowStatusIsError ? BrandTheme.destructive : BrandTheme.success)
                            .fixedSize(horizontal: false, vertical: true)
                    }

                    Button {
                        Task { await buyNow() }
                    } label: {
                        if isBuyingNow {
                            ProgressView()
                                .tint(BrandTheme.navy)
                                .frame(maxWidth: .infinity, minHeight: 44)
                        } else {
                            Label("Buy now \(priceLabel)", systemImage: "apple.logo")
                                .frame(maxWidth: .infinity, minHeight: 44)
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(BrandTheme.accent)
                    .disabled(isBuyingNow || isPlacingBid)
                    .accessibilityLabel("Buy now for \(priceLabel) with Apple Pay")
                }
            } header: {
                Text("Buy now").brandSectionHeader()
            }
        }
    }

    // MARK: - Place bid (forward auction)

    @ViewBuilder
    private func placeBidSection(_ listing: ListingDetail) -> some View {
        Section {
            if !auth.isAuthenticated {
                Text("Sign in to place a bid on this listing.")
                    .font(.footnote)
                    .foregroundStyle(BrandTheme.textSecondary)
            } else if auth.isScaffoldSession {
                Text("Scaffold session has no API credentials. Sign in against a live gateway to place bids.")
                    .font(.footnote)
                    .foregroundStyle(BrandTheme.textSecondary)
                TextField("Bid amount (USD)", text: $bidAmountText)
                    .keyboardType(.decimalPad)
                    .textContentType(.none)
                    .disabled(true)
                    .frame(minHeight: 44)
                Button("Place bid") {}
                    .disabled(true)
                    .frame(maxWidth: .infinity, minHeight: 44)
            } else {
                Text(bidHint(for: listing))
                    .font(.footnote)
                    .foregroundStyle(BrandTheme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)

                TextField("Your bid (USD) — higher wins", text: $bidAmountText)
                    .keyboardType(.decimalPad)
                    .textContentType(.none)
                    .autocorrectionDisabled()
                    .frame(minHeight: 44)
                    .accessibilityLabel("Bid amount in dollars — forward auction, higher wins")

                if let bidStatusMessage {
                    Text(bidStatusMessage)
                        .font(.footnote)
                        .foregroundStyle(bidStatusIsError ? BrandTheme.destructive : BrandTheme.success)
                        .fixedSize(horizontal: false, vertical: true)
                }

                Button {
                    Task { await placeListingBid() }
                } label: {
                    if isPlacingBid {
                        ProgressView()
                            .tint(BrandTheme.navy)
                            .frame(maxWidth: .infinity, minHeight: 44)
                    } else {
                        Text("Place bid")
                            .frame(maxWidth: .infinity, minHeight: 44)
                    }
                }
                .buttonStyle(.borderedProminent)
                .tint(BrandTheme.accent)
                .disabled(
                    isPlacingBid
                        || isBuyingNow
                        || bidAmountText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                )
                .accessibilityHint("Submit a higher bid to lead this forward auction")
            }
        } header: {
            Text("Place a bid").brandSectionHeader()
        } footer: {
            Text("Goods are forward auctions — bid above the current high bid to take the lead.")
                .foregroundStyle(BrandTheme.textSecondary)
        }
    }

    private func bidHint(for listing: ListingDetail) -> String {
        if let leading = leadingBidCents {
            let minHint: String
            if let inc = listing.minIncrementCents, inc > 0 {
                minHint = " Minimum next bid is about \(MoneyFormat.usd(cents: leading + inc))."
            } else {
                minHint = ""
            }
            return "Forward auction: enter more than the current high bid (\(MoneyFormat.usd(cents: leading))).\(minHint)"
        }
        return "Forward auction: enter your bid in dollars. Current price is \(listing.displayPrice)."
    }

    // MARK: - Details

    @ViewBuilder
    private func detailsSection(_ listing: ListingDetail) -> some View {
        Section {
            if let status = listing.status {
                LabeledContent("Status") {
                    Text(StatusChipStyle.displayLabel(status))
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
            if let bidders = listing.bidderCount ?? ladderBidderCount {
                LabeledContent("Bidders", value: "\(bidders)")
            }
            if let buyNow = listing.buyNowPriceCents {
                LabeledContent("Buy now", value: MoneyFormat.usd(cents: buyNow))
            }
        } header: {
            Text("Details").brandSectionHeader()
        }
    }

    // MARK: - Actions

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

        if let leading = leadingBidCents, cents <= leading {
            bidStatusIsError = true
            bidStatusMessage =
                "Forward auction: bid above the current high of \(MoneyFormat.usd(cents: leading))."
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

        await loadBids()
    }

    @MainActor
    private func loadBids() async {
        ladderState = .loading
        do {
            let response = try await APIClient.shared.fetchListingBids(listingId: listingID)
            bidRows = response.bids
            ladderCurrentBidCents = response.currentBidCents
            ladderBidderCount = response.bidderCount
            ladderState = .loaded
        } catch {
            bidRows = []
            ladderState = .failed(error.localizedDescription)
        }
    }
}

// MARK: - Ladder load state

private enum ListingLadderState: Equatable {
    case idle
    case loading
    case loaded
    case failed(String)
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
                    Text("Why are you reporting this?").brandSectionHeader()
                }

                Section {
                    TextEditor(text: $descriptionText)
                        .frame(minHeight: 120)
                        .accessibilityLabel("Additional details")
                } header: {
                    Text("Details (optional)").brandSectionHeader()
                } footer: {
                    Text("Reports help keep the marketplace safe. False reports may lead to account action.")
                        .foregroundStyle(BrandTheme.textSecondary)
                }

                if let statusMessage {
                    Section {
                        Text(statusMessage)
                            .font(.footnote)
                            .foregroundStyle(statusIsError ? BrandTheme.destructive : BrandTheme.textSecondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }

                Section {
                    Button {
                        Task { await submit() }
                    } label: {
                        if isSubmitting {
                            ProgressView()
                                .tint(BrandTheme.navy)
                                .frame(maxWidth: .infinity, minHeight: 44)
                        } else {
                            Text("Submit report")
                                .frame(maxWidth: .infinity, minHeight: 44)
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(BrandTheme.accent)
                    .disabled(isSubmitting)
                }
            }
            .brandListBackground()
            .navigationTitle("Report listing")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbarBackground(BrandTheme.navy, for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
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
