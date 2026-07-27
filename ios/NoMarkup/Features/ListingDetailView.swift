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

    /// Place-bid 402 → user must post a one-time SetupIntent bond before retrying.
    @State private var showBidBondAlert = false
    @State private var pendingBidCents: Int64?
    @State private var bidBondAmountCents: Int64?
    @State private var isPostingBond = false

    @State private var retractingBidID: String?
    @State private var isRetractingBid = false

    @State private var isBuyingNow = false
    @State private var buyNowStatusMessage: String?
    @State private var buyNowStatusIsError = false

    @State private var isWatching = false
    @State private var isTogglingWatch = false

    @State private var currentUserID: String?
    @State private var offers: [ListingOffer] = []
    @State private var offersState: ListingOffersLoadState = .idle
    @State private var offerAmountText = ""
    @State private var offerMessageText = ""
    @State private var isSubmittingOffer = false
    @State private var offerStatusMessage: String?
    @State private var offerStatusIsError = false
    @State private var actingOfferID: String?
    @State private var counterAmountText = ""
    @State private var counteringOfferID: String?

    @State private var isCancellingListing = false
    @State private var cancelListingMessage: String?
    @State private var cancelListingIsError = false
    @State private var confirmCancelListing = false

    @State private var similarListings: [ListingSummary] = []
    @State private var similarState: SimilarListingsLoadState = .idle

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
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                if auth.isAuthenticated && !auth.isScaffoldSession {
                    Button {
                        Task { await toggleWatch() }
                    } label: {
                        if isTogglingWatch {
                            ProgressView()
                                .tint(BrandTheme.accent)
                        } else {
                            Image(systemName: isWatching ? "heart.fill" : "heart")
                                .foregroundStyle(isWatching ? BrandTheme.accent : BrandTheme.goldBright)
                        }
                    }
                    .disabled(isTogglingWatch)
                    .frame(minWidth: 44, minHeight: 44)
                    .accessibilityLabel(isWatching ? "Remove from watchlist" : "Add to watchlist")
                    .accessibilityHint(
                        isWatching
                            ? "Stops watching this listing"
                            : "Saves this listing to your watchlist"
                    )
                }
            }
        }
        .task { await load() }
        .task(id: listingID) {
            // Soft re-poll the public bid ladder so the auction book feels live.
            while !Task.isCancelled {
                do {
                    try await Task.sleep(nanoseconds: 10_000_000_000)
                } catch {
                    return
                }
                guard !Task.isCancelled else { return }
                await loadBids()
            }
        }
        .refreshable { await load() }
        .onChange(of: auth.isAuthenticated) { _, _ in
            Task { await refreshWatchState() }
        }
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
        .alert("Bid bond required", isPresented: $showBidBondAlert) {
            Button("Post bond") {
                Task { await postBidBondAndRetry() }
            }
            Button("Open on web") {
                showWebSafari = true
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            let amount = bidBondAmountCents.map { MoneyFormat.usd(cents: $0) } ?? "a small deposit"
            Text(
                "First-time bidders post a one-time bond of \(amount) so auctions stay honest. "
                    + "It’s released when you complete or lose the auction. Authorize a card, then your bid is placed."
            )
        }
        .confirmationDialog(
            "Cancel this listing?",
            isPresented: $confirmCancelListing,
            titleVisibility: .visible
        ) {
            Button("Cancel listing", role: .destructive) {
                Task { await cancelOwnedListing() }
            }
            Button("Keep listing", role: .cancel) {}
        } message: {
            Text("Ends this auction for buyers. Listings with active bids cannot be cancelled from the app.")
        }
    }

    @ViewBuilder
    private func detailContent(_ listing: ListingDetail) -> some View {
        List {
            // Auction arena first: hero → place bid (dollars) → live ladder.
            auctionHeroSection(listing)
            placeBidSection(listing)
            bidLadderSection(listing)
            buyNowSection(listing)
            offersSection(listing)
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

            similarListingsSection()

            if isViewerSeller(of: listing), canCancelListing(listing) {
                Section {
                    if let cancelListingMessage {
                        Text(cancelListingMessage)
                            .font(.footnote)
                            .foregroundStyle(cancelListingIsError ? BrandTheme.destructive : BrandTheme.success)
                            .fixedSize(horizontal: false, vertical: true)
                    }

                    Button(role: .destructive) {
                        confirmCancelListing = true
                    } label: {
                        if isCancellingListing {
                            ProgressView()
                                .tint(BrandTheme.destructive)
                                .frame(maxWidth: .infinity, minHeight: 44)
                        } else {
                            Label("Cancel listing", systemImage: "xmark.circle")
                                .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                        }
                    }
                    .disabled(isCancellingListing)
                    .accessibilityHint("Cancels your goods listing if there are no active bids")
                } header: {
                    Text("Manage listing").brandSectionHeader()
                } footer: {
                    Text("You own this listing. Cancel only works for draft/active auctions with no active bids.")
                        .foregroundStyle(BrandTheme.textSecondary)
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
        .navigationDestination(for: ListingSummary.self) { similar in
            ListingDetailView(listingID: similar.id, preview: similar)
        }
    }

    @ViewBuilder
    private func similarListingsSection() -> some View {
        if !similarListings.isEmpty {
            Section {
                ForEach(similarListings) { item in
                    NavigationLink(value: item) {
                        VStack(alignment: .leading, spacing: 4) {
                            HStack(alignment: .firstTextBaseline) {
                                Text(item.displayTitle)
                                    .font(.body.weight(.medium))
                                    .foregroundStyle(BrandTheme.textPrimary)
                                    .lineLimit(2)
                                Spacer(minLength: 8)
                                Text(item.displayPrice)
                                    .font(.subheadline.weight(.semibold).monospacedDigit())
                                    .foregroundStyle(BrandTheme.goldBright)
                            }
                            if let location = item.locationLabel {
                                Text(location)
                                    .font(.caption)
                                    .foregroundStyle(BrandTheme.textSecondary)
                                    .lineLimit(1)
                            }
                        }
                        .padding(.vertical, 4)
                    }
                    .frame(minHeight: 44)
                    .accessibilityHint("Opens similar listing")
                }
            } header: {
                Text("Similar listings").brandSectionHeader()
            } footer: {
                Text("Suggestions based on this item’s category and market.")
                    .foregroundStyle(BrandTheme.textSecondary)
            }
        } else {
            switch similarState {
            case .idle, .loading:
                Section {
                    HStack(spacing: 10) {
                        ProgressView()
                            .tint(BrandTheme.accent)
                        Text("Loading similar listings…")
                            .font(.subheadline)
                            .foregroundStyle(BrandTheme.textSecondary)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .frame(minHeight: 44)
                } header: {
                    Text("Similar listings").brandSectionHeader()
                }
            case .failed(let message):
                Section {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(message)
                            .font(.footnote)
                            .foregroundStyle(BrandTheme.textSecondary)
                            .fixedSize(horizontal: false, vertical: true)
                        Button("Try again") {
                            Task { await loadSimilar() }
                        }
                        .frame(minHeight: 44)
                        .tint(BrandTheme.accent)
                    }
                } header: {
                    Text("Similar listings").brandSectionHeader()
                }
            case .loaded:
                EmptyView()
            }
        }
    }

    private func canCancelListing(_ listing: ListingDetail) -> Bool {
        guard auth.isAuthenticated, !auth.isScaffoldSession else { return false }
        let status = (listing.status ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        switch status {
        case "active", "open", "draft", "scheduled":
            return true
        default:
            return false
        }
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
        let live: Bool = {
            guard let ends = detail?.auctionEndsAt else { return detail?.status?.lowercased() == "active" }
            return ends > Date()
        }()
        return HStack(spacing: 6) {
            if live {
                Circle()
                    .fill(BrandTheme.success)
                    .frame(width: 7, height: 7)
                    .accessibilityHidden(true)
            }
            Text(live ? "LIVE · forward auction" : "Forward auction · goods")
                .font(.caption.weight(.bold))
                .foregroundStyle(BrandTheme.goldBright)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .overlay(
            Capsule()
                .strokeBorder(BrandTheme.gold, lineWidth: 1.5)
        )
        .accessibilityLabel(live ? "Live forward auction, goods" : "Forward auction, goods")
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
            Text("Auction · bid ladder").brandSectionHeader()
        } footer: {
            Text("Highest dollar bid leads in a forward auction. The winning bid is highlighted.")
                .foregroundStyle(BrandTheme.textSecondary)
        }
    }

    @ViewBuilder
    private func listingBidRow(row: ListingBidRow, rank: Int) -> some View {
        let isWinning = row.isWinning == true || (rank == 1 && sortedLadder.first?.id == row.id)

        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .center, spacing: 12) {
                Text("#\(rank)")
                    .font(.caption.weight(.bold).monospacedDigit())
                    .foregroundStyle(isWinning ? BrandTheme.bidWinning : BrandTheme.textSecondary)
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
                            .foregroundStyle(BrandTheme.bidWinning)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 3)
                            .background(BrandTheme.bidWinning.opacity(0.15), in: Capsule())
                            .accessibilityLabel("Winning bid")
                    }
                }
            }
            .frame(minHeight: 44)
            .accessibilityElement(children: .combine)
            .accessibilityLabel(
                isWinning
                    ? "Rank \(rank), winning, \(row.displayName), \(row.displayAmount)"
                    : "Rank \(rank), \(row.displayName), \(row.displayAmount)"
            )

            // eBay-style 60s retract for the viewer's leading active bid only.
            TimelineView(.periodic(from: .now, by: 1)) { context in
                if canRetract(row, now: context.date) {
                    Button(role: .destructive) {
                        Task { await retractListingBid(row) }
                    } label: {
                        if retractingBidID == row.id {
                            ProgressView()
                                .tint(BrandTheme.destructive)
                                .frame(maxWidth: .infinity, minHeight: 44)
                        } else {
                            let remaining = retractSecondsRemaining(row, now: context.date)
                            Label(
                                remaining.map { "Retract bid (\($0)s)" } ?? "Retract bid",
                                systemImage: "arrow.uturn.backward"
                            )
                            .frame(maxWidth: .infinity, minHeight: 44)
                        }
                    }
                    .buttonStyle(.bordered)
                    .tint(BrandTheme.destructive)
                    .disabled(isRetractingBid || isPlacingBid || isPostingBond)
                    .accessibilityHint("Retract your high bid within 60 seconds of placing it")
                }
            }
        }
        .padding(.vertical, 4)
    }

    /// Only the signed-in user's current high bid within 60s of creation may retract.
    private func canRetract(_ row: ListingBidRow, now: Date = Date()) -> Bool {
        guard auth.isAuthenticated, !auth.isScaffoldSession else { return false }
        guard let me = currentUserID, !me.isEmpty else { return false }
        guard let bidder = row.bidderId, bidder == me else { return false }
        let isLeading = row.isWinning == true || sortedLadder.first?.id == row.id
        guard isLeading else { return false }
        guard let createdAt = row.createdAt,
              let created = CatalogDateFormat.parseISO(createdAt)
        else {
            return false
        }
        return now.timeIntervalSince(created) < 60
    }

    private func retractSecondsRemaining(_ row: ListingBidRow, now: Date) -> Int? {
        guard let createdAt = row.createdAt,
              let created = CatalogDateFormat.parseISO(createdAt)
        else {
            return nil
        }
        let remaining = 60 - Int(now.timeIntervalSince(created))
        return remaining > 0 ? remaining : nil
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
                    Text("Browse-only mode has no API credentials. Sign in against a live gateway to pay.")
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
                    .disabled(isBuyingNow || isPlacingBid || isPostingBond)
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
                Text("Browse-only mode has no API credentials. Sign in against a live gateway to place bids.")
                    .font(.footnote)
                    .foregroundStyle(BrandTheme.textSecondary)
                DollarAmountField(
                    text: $bidAmountText,
                    placeholder: "0.00",
                    accessibilityLabelText: "Bid amount in dollars",
                    isEnabled: false
                )
                Button("Place bid") {}
                    .disabled(true)
                    .frame(maxWidth: .infinity, minHeight: 44)
            } else {
                Text(bidHint(for: listing))
                    .font(.footnote)
                    .foregroundStyle(BrandTheme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)

                DollarAmountField(
                    text: $bidAmountText,
                    placeholder: "0.00",
                    accessibilityLabelText: "Your bid in dollars — forward auction, higher wins"
                )

                if let bidStatusMessage {
                    Text(bidStatusMessage)
                        .font(.footnote)
                        .foregroundStyle(bidStatusIsError ? BrandTheme.destructive : BrandTheme.success)
                        .fixedSize(horizontal: false, vertical: true)
                }

                if isPostingBond {
                    HStack(spacing: 10) {
                        ProgressView()
                            .tint(BrandTheme.accent)
                        Text("Authorizing bid bond…")
                            .font(.footnote)
                            .foregroundStyle(BrandTheme.warning)
                    }
                    .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                    .accessibilityLabel("Authorizing bid bond")
                }

                if let bondCents = bidBondAmountCents, pendingBidCents != nil, !isPostingBond {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(
                            "One-time bid bond \(MoneyFormat.usd(cents: bondCents)) is required before this bid."
                        )
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(BrandTheme.warning)
                        .fixedSize(horizontal: false, vertical: true)

                        Button {
                            Task { await postBidBondAndRetry() }
                        } label: {
                            Text("Post bond")
                                .frame(maxWidth: .infinity, minHeight: 44)
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(BrandTheme.warning)
                        .disabled(isPlacingBid || isBuyingNow)
                        .accessibilityHint("Authorize a card for the bid bond, then place your bid")

                        Button {
                            showWebSafari = true
                        } label: {
                            Text("Post bond on web instead")
                                .frame(maxWidth: .infinity, minHeight: 44)
                        }
                        .buttonStyle(.bordered)
                        .tint(BrandTheme.goldBright)
                    }
                }

                Button {
                    Task { await placeListingBid() }
                } label: {
                    if isPlacingBid {
                        ProgressView()
                            .tint(BrandTheme.navy)
                            .frame(maxWidth: .infinity, minHeight: 44)
                    } else if let cents = MoneyFormat.cents(fromDollarsText: bidAmountText) {
                        Text("Place bid · \(MoneyFormat.usd(cents: cents))")
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
                        || isPostingBond
                        || isBuyingNow
                        || MoneyFormat.cents(fromDollarsText: bidAmountText) == nil
                )
                .accessibilityHint("Submit a higher dollar bid to lead this forward auction")
            }
        } header: {
            Text("Place a bid (dollars)").brandSectionHeader()
        } footer: {
            Text("Goods are forward auctions — enter dollars (for example 95.00), not cents. Bid above the current high to take the lead. First-time bidders may need a refundable bid bond.")
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
            return "Forward auction: enter a higher dollar amount than \(MoneyFormat.usd(cents: leading)). Example: if high is $85, try 90.00 — not 9000.\(minHint)"
        }
        return "Forward auction: enter your bid in dollars (e.g. 25.00), not cents. Current price is \(listing.displayPrice)."
    }

    // MARK: - Best-Offer

    @ViewBuilder
    private func offersSection(_ listing: ListingDetail) -> some View {
        let seller = isViewerSeller(of: listing)
        let isActive = (listing.status ?? "").lowercased() == "active"

        Section {
            if !auth.isAuthenticated {
                Text("Sign in to make a Best Offer or manage offers on this listing.")
                    .font(.footnote)
                    .foregroundStyle(BrandTheme.textSecondary)
            } else if auth.isScaffoldSession {
                Text("Browse-only mode has no API credentials. Sign in against a live gateway for Best Offers.")
                    .font(.footnote)
                    .foregroundStyle(BrandTheme.textSecondary)
            } else if seller {
                sellerOffersContent
            } else {
                buyerOfferContent(isActive: isActive)
            }
        } header: {
            Text(seller ? "Offers received" : "Make an offer").brandSectionHeader()
        } footer: {
            Text(
                seller
                    ? "Accept, reject, or counter pending offers. Accepting mints an order awaiting payment."
                    : "Best Offer is separate from the public bid ladder. The seller has 24 hours to respond."
            )
            .foregroundStyle(BrandTheme.textSecondary)
        }
    }

    @ViewBuilder
    private var sellerOffersContent: some View {
        switch offersState {
        case .idle, .loading:
            HStack(spacing: 10) {
                ProgressView()
                    .tint(BrandTheme.accent)
                Text("Loading offers…")
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
                    Task { await loadOffers() }
                }
                .frame(minHeight: 44)
            }

        case .loaded:
            if offers.isEmpty {
                Text("No offers yet.")
                    .font(.subheadline)
                    .foregroundStyle(BrandTheme.textSecondary)
                    .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            } else {
                if let offerStatusMessage {
                    Text(offerStatusMessage)
                        .font(.footnote)
                        .foregroundStyle(offerStatusIsError ? BrandTheme.destructive : BrandTheme.success)
                        .fixedSize(horizontal: false, vertical: true)
                }
                ForEach(offers) { offer in
                    sellerOfferRow(offer)
                }
            }
        }
    }

    @ViewBuilder
    private func sellerOfferRow(_ offer: ListingOffer) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(offer.displayAmount)
                    .font(.headline.monospacedDigit())
                    .foregroundStyle(BrandTheme.goldBright)
                Spacer()
                StatusChipView(
                    label: offer.displayStatus,
                    style: StatusChipStyle.forStatus(offer.status)
                )
            }

            if let message = offer.displayMessage {
                Text(message)
                    .font(.footnote)
                    .foregroundStyle(BrandTheme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            if let expires = offer.expiresAt, !expires.isEmpty {
                Text("Expires \(CatalogDateFormat.friendlyDateTime(expires))")
                    .font(.caption2)
                    .foregroundStyle(BrandTheme.textSecondary)
            }

            if offer.statusEnum.isActionable {
                HStack(spacing: 8) {
                    Button {
                        Task { await updateOffer(offer, action: .accept) }
                    } label: {
                        if actingOfferID == offer.id {
                            ProgressView().tint(BrandTheme.navy)
                        } else {
                            Text("Accept")
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(BrandTheme.success)
                    .frame(minHeight: 44)
                    .disabled(actingOfferID != nil)

                    Button {
                        Task { await updateOffer(offer, action: .reject) }
                    } label: {
                        Text("Reject")
                    }
                    .buttonStyle(.bordered)
                    .frame(minHeight: 44)
                    .disabled(actingOfferID != nil)

                    Button {
                        counteringOfferID = counteringOfferID == offer.id ? nil : offer.id
                        counterAmountText = ""
                    } label: {
                        Text("Counter")
                    }
                    .buttonStyle(.bordered)
                    .frame(minHeight: 44)
                    .disabled(actingOfferID != nil)
                }

                if counteringOfferID == offer.id {
                    TextField("Counter amount (USD)", text: $counterAmountText)
                        .keyboardType(.decimalPad)
                        .frame(minHeight: 44)
                        .accessibilityLabel("Counter offer amount in dollars")
                    Button {
                        Task { await counterOffer(offer) }
                    } label: {
                        if actingOfferID == offer.id {
                            ProgressView()
                                .tint(BrandTheme.navy)
                                .frame(maxWidth: .infinity, minHeight: 44)
                        } else {
                            Text("Send counter")
                                .frame(maxWidth: .infinity, minHeight: 44)
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(BrandTheme.accent)
                    .disabled(
                        actingOfferID != nil
                            || counterAmountText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                    )
                }
            }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder
    private func buyerOfferContent(isActive: Bool) -> some View {
        if !isActive {
            Text("Offers are only accepted while the listing is active.")
                .font(.footnote)
                .foregroundStyle(BrandTheme.textSecondary)
        } else {
            Text("Propose a price below asking. The seller can accept, reject, or counter within 24 hours.")
                .font(.footnote)
                .foregroundStyle(BrandTheme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)

            TextField("Offer amount (USD)", text: $offerAmountText)
                .keyboardType(.decimalPad)
                .textContentType(.none)
                .autocorrectionDisabled()
                .frame(minHeight: 44)
                .accessibilityLabel("Offer amount in dollars")

            TextField("Message (optional)", text: $offerMessageText)
                .textContentType(.none)
                .frame(minHeight: 44)
                .accessibilityLabel("Optional message to the seller")

            if let offerStatusMessage {
                Text(offerStatusMessage)
                    .font(.footnote)
                    .foregroundStyle(offerStatusIsError ? BrandTheme.destructive : BrandTheme.success)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Button {
                Task { await submitOffer() }
            } label: {
                if isSubmittingOffer {
                    ProgressView()
                        .tint(BrandTheme.navy)
                        .frame(maxWidth: .infinity, minHeight: 44)
                } else {
                    Text("Send offer")
                        .frame(maxWidth: .infinity, minHeight: 44)
                }
            }
            .buttonStyle(.borderedProminent)
            .tint(BrandTheme.accent)
            .disabled(
                isSubmittingOffer
                    || offerAmountText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            )
            .accessibilityHint("Sends a Best Offer to the seller")
        }

        // Buyer's own offer history for this listing.
        if !offers.isEmpty {
            ForEach(offers) { offer in
                HStack {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(offer.displayAmount)
                            .font(.subheadline.weight(.semibold).monospacedDigit())
                            .foregroundStyle(BrandTheme.goldBright)
                        if let message = offer.displayMessage {
                            Text(message)
                                .font(.caption)
                                .foregroundStyle(BrandTheme.textSecondary)
                                .lineLimit(2)
                        }
                    }
                    Spacer()
                    Text(offer.displayStatus)
                        .font(.caption.weight(.medium))
                        .foregroundStyle(BrandTheme.textSecondary)
                }
                .frame(minHeight: 44)

                if offer.statusEnum.isActionable, offer.buyerId == currentUserID {
                    Button(role: .destructive) {
                        Task { await updateOffer(offer, action: .withdraw) }
                    } label: {
                        if actingOfferID == offer.id {
                            ProgressView().frame(maxWidth: .infinity, minHeight: 44)
                        } else {
                            Text("Withdraw offer")
                                .frame(maxWidth: .infinity, minHeight: 44)
                        }
                    }
                    .disabled(actingOfferID != nil)
                }
            }
        }
    }

    private func isViewerSeller(of listing: ListingDetail) -> Bool {
        guard let me = currentUserID, !me.isEmpty else { return false }
        guard let seller = listing.sellerId, !seller.isEmpty else { return false }
        return me == seller
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
    private func cancelOwnedListing() async {
        cancelListingMessage = nil
        cancelListingIsError = false
        guard !auth.isScaffoldSession else {
            cancelListingIsError = true
            cancelListingMessage =
                "Browse-only mode has no API credentials. Sign in against a live gateway to cancel."
            return
        }
        isCancellingListing = true
        defer { isCancellingListing = false }
        do {
            try await APIClient.shared.cancelListing(id: listingID)
            cancelListingIsError = false
            cancelListingMessage = "Listing cancelled."
            await load()
        } catch let error as APIClientError where error.isUnauthorized {
            cancelListingIsError = true
            cancelListingMessage = "Sign in required. Your session is missing or expired — please sign in again."
        } catch {
            cancelListingIsError = true
            cancelListingMessage = error.localizedDescription
        }
    }

    @MainActor
    private func buyNow() async {
        buyNowStatusMessage = nil
        buyNowStatusIsError = false

        guard !auth.isScaffoldSession else {
            buyNowStatusIsError = true
            buyNowStatusMessage =
                "Browse-only mode has no API credentials. Sign in against a live gateway to pay."
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
                "Browse-only mode has no API credentials. Sign in against a live gateway to place bids."
            return
        }

        guard let cents = MoneyFormat.cents(fromDollarsText: bidAmountText) else {
            bidStatusIsError = true
            bidStatusMessage =
                "Enter a valid dollar amount (for example 25.00). Do not enter cents — $25 is 25, not 2500."
            return
        }

        if let leading = leadingBidCents, cents <= leading {
            bidStatusIsError = true
            bidStatusMessage =
                "Forward auction: bid above the current high of \(MoneyFormat.usd(cents: leading))."
            return
        }

        await submitListingBid(amountCents: cents, clearBondGate: true)
    }

    /// Shared place-bid path used by the form and post-bond retry.
    @MainActor
    private func submitListingBid(amountCents: Int64, clearBondGate: Bool) async {
        isPlacingBid = true
        defer { isPlacingBid = false }

        do {
            _ = try await APIClient.shared.placeListingBid(
                listingId: listingID,
                amountCents: amountCents
            )
            bidStatusIsError = false
            bidStatusMessage = "Bid placed: \(MoneyFormat.usd(cents: amountCents))."
            bidAmountText = ""
            clearBidBondUIState()
            await load()
        } catch let error as APIClientError where error.isBidBondRequired {
            let bondCents = error.bidBondAmountCents ?? 0
            pendingBidCents = amountCents
            bidBondAmountCents = bondCents > 0 ? bondCents : nil
            bidStatusIsError = true
            if bondCents > 0 {
                bidStatusMessage =
                    "A one-time bid bond of \(MoneyFormat.usd(cents: bondCents)) is required before your first bid."
            } else {
                bidStatusMessage = error.localizedDescription
            }
            // Surface bond gate after a fresh place-bid (not mid bond-retry).
            if clearBondGate {
                showBidBondAlert = true
            }
        } catch let error as APIClientError where error.isUnauthorized {
            bidStatusIsError = true
            bidStatusMessage = "Sign in required. Your session is missing or expired — please sign in again."
        } catch {
            bidStatusIsError = true
            bidStatusMessage = error.localizedDescription
        }
    }

    /// Mint bond → SetupIntent (or dev short-circuit) → `confirmListingBidBond` → retry place bid.
    @MainActor
    private func postBidBondAndRetry() async {
        bidStatusMessage = nil
        bidStatusIsError = false

        guard !auth.isScaffoldSession else {
            bidStatusIsError = true
            bidStatusMessage =
                "Browse-only mode has no API credentials. Sign in against a live gateway to post a bond."
            return
        }

        let intendedCents: Int64
        if let pending = pendingBidCents {
            intendedCents = pending
        } else if let fromField = MoneyFormat.cents(fromDollarsText: bidAmountText) {
            intendedCents = fromField
        } else {
            bidStatusIsError = true
            bidStatusMessage = "Enter a valid bid amount before posting a bond."
            return
        }

        isPostingBond = true
        defer { isPostingBond = false }

        do {
            let bond = try await APIClient.shared.createListingBidBond(
                listingId: listingID,
                intendedBidCents: intendedCents
            )
            bidBondAmountCents = bond.bondAmountCents
            pendingBidCents = intendedCents

            // After SetupIntent succeeds (or dev sentinel), always confirm on the gateway
            // so the pending bond row flips to authorized before place-bid retry.
            if bond.isDevSetupSecret {
                _ = try await APIClient.shared.confirmListingBidBond(
                    listingId: listingID,
                    bondId: bond.bondId
                )
            } else if bond.isStripeSetupSecret {
                try await RailACheckout.presentSetupIntent(
                    clientSecret: bond.setupIntentClientSecret
                )
                _ = try await APIClient.shared.confirmListingBidBond(
                    listingId: listingID,
                    bondId: bond.bondId
                )
            } else {
                bidStatusIsError = true
                bidStatusMessage =
                    "Could not authorize the bond on this device. Open the listing on the web to post your bond, then retry the bid here."
                return
            }

            // Bond is authorized — drop the Post-bond gate so it doesn’t reappear
            // when isPostingBond becomes false, then place the bid. clearBondGate
            // on success/failure of place-bid still resets remaining state.
            bidBondAmountCents = nil
            showBidBondAlert = false
            pendingBidCents = intendedCents
            bidStatusIsError = false
            bidStatusMessage = "Bond authorized. Placing your bid…"
            // clearBondGate: false — avoid re-alerting mid-retry if gateway races;
            // success path still clears via clearBidBondUIState().
            await submitListingBid(amountCents: intendedCents, clearBondGate: false)
        } catch let error as RailACheckout.CheckoutError where error.isCanceled {
            bidStatusIsError = false
            bidStatusMessage = "Bond authorization canceled. Post the bond to place your bid."
        } catch let error as RailACheckout.CheckoutError {
            bidStatusIsError = true
            switch error {
            case .stripeNotConfigured, .missingClientSecret:
                bidStatusMessage =
                    "Apple Pay / card setup isn’t available in this build. Open the listing on the web to post your bond, then retry here."
            default:
                bidStatusMessage = error.localizedDescription
            }
        } catch let error as APIClientError where error.isUnauthorized {
            bidStatusIsError = true
            bidStatusMessage = "Sign in required. Your session is missing or expired — please sign in again."
        } catch let error as APIClientError where error.isBidBondRequired {
            // Confirm returned 402 — SetupIntent not succeeded yet; keep bond UI for retry.
            bidStatusIsError = true
            bidStatusMessage =
                "Your payment method isn’t confirmed yet. Try Post bond again, or open the listing on the web."
        } catch {
            bidStatusIsError = true
            bidStatusMessage = error.localizedDescription
        }
    }

    /// Clears 402 bond gate state (pending amount + bond cents + alert).
    @MainActor
    private func clearBidBondUIState() {
        pendingBidCents = nil
        bidBondAmountCents = nil
        showBidBondAlert = false
    }

    @MainActor
    private func retractListingBid(_ row: ListingBidRow) async {
        bidStatusMessage = nil
        bidStatusIsError = false

        guard !auth.isScaffoldSession else {
            bidStatusIsError = true
            bidStatusMessage = "Browse-only mode cannot retract bids."
            return
        }

        isRetractingBid = true
        retractingBidID = row.id
        defer {
            isRetractingBid = false
            retractingBidID = nil
        }

        do {
            let response = try await APIClient.shared.retractListingBid(
                listingId: listingID,
                bidId: row.id
            )
            if let listing = response.listing {
                detail = listing
            }
            bidStatusIsError = false
            bidStatusMessage = "Bid retracted."
            await loadBids()
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

        if currentUserID == nil, auth.isAuthenticated, !auth.isScaffoldSession {
            currentUserID = await APIClient.shared.currentUserID()
        }

        do {
            detail = try await APIClient.shared.fetchListing(id: listingID)
        } catch {
            if detail == nil {
                errorMessage = error.localizedDescription
            }
        }

        await loadBids()
        await loadOffers()
        await refreshWatchState()
        await loadSimilar()
    }

    @MainActor
    private func loadSimilar() async {
        similarState = .loading
        do {
            let rows = try await APIClient.shared.fetchSimilarListings(id: listingID)
            // Drop self if the gateway echoes the current listing.
            similarListings = rows.filter { $0.id != listingID }
            similarState = .loaded
        } catch {
            if similarListings.isEmpty {
                similarState = .failed(error.localizedDescription)
            } else {
                similarState = .loaded
            }
        }
    }

    @MainActor
    private func loadOffers() async {
        guard auth.isAuthenticated, !auth.isScaffoldSession else {
            offers = []
            offersState = .idle
            return
        }
        offersState = .loading
        do {
            offers = try await APIClient.shared.fetchListingOffers(listingId: listingID)
            offersState = .loaded
        } catch let error as APIClientError where error.isUnauthorized {
            offers = []
            offersState = .failed("Sign in required to load offers.")
        } catch let error as APIClientError where error.isForbidden {
            offers = []
            offersState = .loaded
        } catch {
            offers = []
            offersState = .failed(error.localizedDescription)
        }
    }

    @MainActor
    private func submitOffer() async {
        offerStatusMessage = nil
        offerStatusIsError = false

        guard !auth.isScaffoldSession else {
            offerStatusIsError = true
            offerStatusMessage =
                "Browse-only mode has no API credentials. Sign in against a live gateway to make offers."
            return
        }

        guard let cents = MoneyFormat.cents(fromDollarsText: offerAmountText) else {
            offerStatusIsError = true
            offerStatusMessage = "Enter a valid offer amount in dollars (for example 20.00)."
            return
        }

        isSubmittingOffer = true
        defer { isSubmittingOffer = false }

        do {
            _ = try await APIClient.shared.createListingOffer(
                listingId: listingID,
                amountCents: cents,
                message: offerMessageText
            )
            offerStatusIsError = false
            offerStatusMessage = "Offer sent: \(MoneyFormat.usd(cents: cents)). The seller has 24 hours to respond."
            offerAmountText = ""
            offerMessageText = ""
            await loadOffers()
        } catch let error as APIClientError where error.isUnauthorized {
            offerStatusIsError = true
            offerStatusMessage = "Sign in required. Your session is missing or expired — please sign in again."
        } catch {
            offerStatusIsError = true
            offerStatusMessage = error.localizedDescription
        }
    }

    @MainActor
    private func updateOffer(_ offer: ListingOffer, action: ListingOfferAction) async {
        offerStatusMessage = nil
        offerStatusIsError = false
        actingOfferID = offer.id
        defer { actingOfferID = nil }

        do {
            _ = try await APIClient.shared.updateOffer(offerId: offer.id, action: action)
            offerStatusIsError = false
            switch action {
            case .accept:
                offerStatusMessage = "Offer accepted — an order was created. The buyer can pay under Account → Orders."
            case .reject:
                offerStatusMessage = "Offer rejected."
            case .withdraw:
                offerStatusMessage = "Offer withdrawn."
            case .counter:
                offerStatusMessage = "Counter offer sent."
            }
            counteringOfferID = nil
            await loadOffers()
            if action == .accept {
                await load()
            }
        } catch let error as APIClientError where error.isUnauthorized {
            offerStatusIsError = true
            offerStatusMessage = "Sign in required. Your session is missing or expired — please sign in again."
        } catch {
            offerStatusIsError = true
            offerStatusMessage = error.localizedDescription
        }
    }

    @MainActor
    private func counterOffer(_ offer: ListingOffer) async {
        offerStatusMessage = nil
        offerStatusIsError = false

        guard let cents = MoneyFormat.cents(fromDollarsText: counterAmountText) else {
            offerStatusIsError = true
            offerStatusMessage = "Enter a valid counter amount in dollars."
            return
        }

        actingOfferID = offer.id
        defer { actingOfferID = nil }

        do {
            _ = try await APIClient.shared.updateOffer(
                offerId: offer.id,
                action: .counter,
                counterAmountCents: cents,
                message: ""
            )
            offerStatusIsError = false
            offerStatusMessage = "Counter sent: \(MoneyFormat.usd(cents: cents))."
            counterAmountText = ""
            counteringOfferID = nil
            await loadOffers()
        } catch let error as APIClientError where error.isUnauthorized {
            offerStatusIsError = true
            offerStatusMessage = "Sign in required. Your session is missing or expired — please sign in again."
        } catch {
            offerStatusIsError = true
            offerStatusMessage = error.localizedDescription
        }
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

    @MainActor
    private func refreshWatchState() async {
        guard auth.isAuthenticated, !auth.isScaffoldSession else {
            isWatching = false
            return
        }
        do {
            // Hydrate heart from first page of watchlist (up to 100). Good enough for MVP.
            let response = try await APIClient.shared.fetchWatchlist(page: 1, pageSize: 100)
            isWatching = response.listings.contains { $0.id == listingID }
        } catch {
            // Leave prior local state; toggle still works offline of this probe.
        }
    }

    @MainActor
    private func toggleWatch() async {
        guard auth.isAuthenticated, !auth.isScaffoldSession else { return }
        isTogglingWatch = true
        defer { isTogglingWatch = false }

        let previous = isWatching
        // Optimistic flip for responsive toolbar feedback.
        isWatching = !previous
        do {
            let response: WatchToggleResponse
            if !previous {
                response = try await APIClient.shared.watchListing(id: listingID)
            } else {
                response = try await APIClient.shared.unwatchListing(id: listingID)
            }
            isWatching = response.watching
            if let count = response.watcherCount {
                detail?.watcherCount = count
            }
        } catch {
            isWatching = previous
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

private enum ListingOffersLoadState: Equatable {
    case idle
    case loading
    case loaded
    case failed(String)
}

private enum SimilarListingsLoadState: Equatable {
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
