import AppIntents
import CoreSpotlight
import PassKit
import SwiftUI
import UniformTypeIdentifiers

/// Listing detail for a single goods **forward auction**.
/// Buyers bid **up** — highest bid leads; optional buy-now for instant win.
///
/// Live feed: public delayed spectator WS (`/ws/marketplace/{id}/spectate`) for
/// all viewers (there is no participant-privileged goods socket). Bid ladder
/// refreshes via hybrid HTTP poll; socket frames only carry anonymized amounts.
struct ListingDetailView: View {
    let listingID: String
    var preview: ListingSummary?

    @EnvironmentObject private var auth: AuthViewModel
    @Environment(\.scenePhase) private var scenePhase

    @State private var detail: ListingDetail?
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var showReportSheet = false
    @State private var showWebSafari = false

    @State private var bidRows: [ListingBidRow] = []
    @State private var ladderState: ListingLadderState = .idle
    @State private var ladderCurrentBidCents: Int64?
    @State private var ladderBidderCount: Int?

    /// Increments when leading (high) bid amount changes — drives `brandMoneyFlash` + light haptic.
    @State private var leadingFlashToken = 0
    @State private var lastFlashedLeadingCents: Int64?

    /// Public delayed marketplace spectator stream (anonymous; no JWT).
    @StateObject private var marketplaceSpectator = MarketplaceSpectatorWebSocketClient()
    /// Soft activity rows from WS frames (amounts only — no bidder identity).
    @State private var liveEvents: [MarketplaceLiveEvent] = []
    /// Concurrent public spectator count from WS (optional chrome).
    @State private var liveSpectatorCount: Int = 0
    /// Debounce ladder HTTP refresh after a WS bid tick.
    @State private var lastLadderInvalidateAt = Date.distantPast

    @State private var bidAmountText = ""
    /// Optional eBay-style proxy ceiling (dollars text). Empty = no max.
    @State private var maxBidAmountText = ""
    @State private var isPlacingBid = false
    @State private var bidStatusMessage: String?
    @State private var bidStatusIsError = false

    /// Place-bid 402 → user must post a one-time SetupIntent bond before retrying.
    @State private var showBidBondAlert = false
    @State private var pendingBidCents: Int64?
    @State private var pendingMaxBidCents: Int64?
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

    /// Seller paid placement (POST /listings/{id}/promote + /confirm).
    @State private var selectedPromoteHours: Int = 24
    @State private var isPromotingListing = false
    @State private var promoteStatusMessage: String?
    @State private var promoteStatusIsError = false
    @State private var confirmPromoteListing = false

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

    // MARK: - Spotlight donation (IOS-INT.2, donation half)

    /// `NSUserActivity` type donated when the user views a listing.
    private static let viewListingActivityType = "com.nomarkup.app.viewListing"

    /// One-sentence goods bid / BIN authorization (ToS §5, tos-2026-08-12-bid-auth).
    private static let bidAuthorizationDisclosure =
        "Placing a goods bid or Buy it now authorizes NoMarkup to charge your saved payment method if you win, for the winning amount plus disclosed fees and tax; if the charge fails, you can pay from the order page."

    /// On-device Spotlight summary — public-safe fields only (category + pickup area).
    private var spotlightDescription: String {
        var parts = ["Local marketplace auction on NoMarkup"]
        if let category = detail?.categoryName?.trimmingCharacters(in: .whitespacesAndNewlines),
           !category.isEmpty
        {
            parts.append(category)
        }
        if let area = detail?.locationLabel, !area.isEmpty {
            parts.append(area)
        }
        return parts.joined(separator: " · ")
    }

    /// Populates the donated activity: searchable title, stable id, canonical web URL.
    private func configureViewActivity(_ activity: NSUserActivity) {
        let title = detail?.displayTitle ?? preview?.title ?? "Marketplace listing"
        activity.title = title
        activity.isEligibleForSearch = true
        activity.persistentIdentifier = listingID
        activity.webpageURL = webListingURL
        let attributes = CSSearchableItemAttributeSet(contentType: .item)
        attributes.title = title
        attributes.contentDescription = spotlightDescription
        activity.contentAttributeSet = attributes
        // IOS-INT.4 (view annotation): associate the on-screen view with its App
        // Intents entity via the SDK's NSUserActivity bridge —
        // `NSUserActivity.appEntityIdentifier` (`AppEntityAnnotatable`, iOS 18.2+ in
        // the installed AppIntents swiftinterface). No SwiftUI `.appEntity`-style view
        // modifier exists in this SDK, so the activity property is the verified API.
        if #available(iOS 18.2, *) {
            activity.appEntityIdentifier = EntityIdentifier(for: ListingEntity.self, identifier: listingID)
        }
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
                BrandLoadingScreen(kind: .detail, accessibilityLabel: "Loading…")
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
                BrandLoadingScreen(kind: .detail, accessibilityLabel: "Loading listing")
            }
        }
        .navigationTitle(detail?.displayTitle ?? "Listing")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .brandNavigationBarChrome()
        .toolbar { listingDetailToolbar }
        .task { await load() }
        .task(id: marketplaceSpectatorIdentity) {
            await runMarketplaceSpectatorLifecycle()
        }
        .task(id: ladderPollIdentity) {
            await pollBidLadderLoop()
        }
        .onChange(of: scenePhase) { _, phase in
            handleScenePhaseChange(phase)
        }
        .onDisappear {
            teardownMarketplaceSpectator()
        }
        .refreshable { await load() }
        // IOS-INT.2 — donate the viewed listing to Spotlight (deep-linkable via the web URL).
        .userActivity(Self.viewListingActivityType, isActive: detail != nil) { activity in
            configureViewActivity(activity)
        }
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
        .confirmationDialog(
            "Promote this listing?",
            isPresented: $confirmPromoteListing,
            titleVisibility: .visible
        ) {
            Button(promoteConfirmButtonTitle) {
                Task { await promoteOwnedListing() }
            }
            Button("Not now", role: .cancel) {}
        } message: {
            Text(promoteConfirmMessage)
        }
    }

    private var promoteConfirmButtonTitle: String {
        let price = ListingPromotionTier.tier(for: selectedPromoteHours)?.priceLabel
            ?? MoneyFormat.usd(cents: 0)
        return "Pay \(price) to promote"
    }

    private var promoteConfirmMessage: String {
        let tier = ListingPromotionTier.tier(for: selectedPromoteHours)
        let label = tier?.label ?? "the selected duration"
        let price = tier?.priceLabel ?? MoneyFormat.usd(cents: 0)
        return "You’ll save a card (or use Apple Pay), then we’ll charge \(price) for a \(label) placement boost. The listing is promoted only after payment succeeds."
    }

    /// Sticky RH-style bid CTA when the auction is open and the viewer can bid.
    private func showStickyBidDock(for listing: ListingDetail) -> Bool {
        guard auth.isAuthenticated, !auth.isScaffoldSession else { return false }
        let status = (listing.status ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if status == "sold" || status == "cancelled" || status == "expired" || status == "ended" {
            return false
        }
        if let ends = listing.auctionEndsAt, ends < Date() {
            return false
        }
        // Seller cannot bid on own listing.
        if isViewerSeller(of: listing) { return false }
        return true
    }

    @ViewBuilder
    private func stickyBidDock(for listing: ListingDetail) -> some View {
        VStack(spacing: 8) {
            if let leading = leadingBidCents {
                Text("High \(MoneyFormat.usd(cents: leading))")
                    .font(.caption.weight(.semibold).monospacedDigit())
                    .foregroundStyle(BrandTheme.textSecondary)
                    .contentTransition(.numericText())
                    .brandMoneyFlash(token: leadingFlashToken, isDown: false)
                    .animation(.easeOut(duration: 0.2), value: leading)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            HStack(spacing: 10) {
                DollarAmountField(
                    text: $bidAmountText,
                    placeholder: "Bid $",
                    accessibilityLabelText: "Your bid in dollars"
                )
                Button {
                    Task { await placeListingBid() }
                } label: {
                    if isPlacingBid {
                        ProgressView()
                            .tint(BrandTheme.ctaLabelOnGold)
                            .frame(minWidth: 88, minHeight: 44)
                    } else {
                        Text("Bid")
                            .font(.body.weight(.semibold))
                            .frame(minWidth: 88, minHeight: 44)
                    }
                }
                .buttonStyle(.borderedProminent)
                .tint(BrandTheme.accent)
                .foregroundStyle(BrandTheme.ctaLabelOnGold)
                .disabled(
                    isPlacingBid
                        || isPostingBond
                        || isBuyingNow
                        || MoneyFormat.cents(fromDollarsText: bidAmountText) == nil
                )
                .accessibilityHint("Place bid at the amount entered")
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(.ultraThinMaterial)
        .overlay(alignment: .top) {
            Rectangle()
                .fill(BrandTheme.gold.opacity(0.25))
                .frame(height: 1)
        }
    }

    @ViewBuilder
    private func detailContent(_ listing: ListingDetail) -> some View {
        List {
            // Auction arena first: hero → place bid (dollars) → live ladder → soft feed.
            auctionHeroSection(listing)
            spectateTerminalSection(listing)
            placeBidSection(listing)
            bidLadderSection(listing)
            liveFeedSection
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

            if isViewerSeller(of: listing), canManageOwnedListing(listing) {
                Section {
                    if listing.hasActivePromotion {
                        if let until = listing.promotedUntil {
                            Label(
                                "Promoted until \(until.formatted(date: .abbreviated, time: .shortened))",
                                systemImage: "flame.fill"
                            )
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(BrandTheme.goldBright)
                            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                            .accessibilityLabel(
                                "Promoted until \(until.formatted(date: .abbreviated, time: .shortened))"
                            )
                        } else {
                            Label("Promoted", systemImage: "flame.fill")
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(BrandTheme.goldBright)
                                .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                        }
                    }

                    if canPromoteListing(listing) {
                        if let promoteStatusMessage {
                            Text(promoteStatusMessage)
                                .font(.footnote)
                                .foregroundStyle(promoteStatusIsError ? BrandTheme.destructive : BrandTheme.success)
                                .fixedSize(horizontal: false, vertical: true)
                        }

                        Picker("Promotion duration", selection: $selectedPromoteHours) {
                            ForEach(ListingPromotionTier.all) { tier in
                                Text(tier.pickerLabel).tag(tier.durationHours)
                            }
                        }
                        .pickerStyle(.menu)
                        .disabled(isPromotingListing)
                        .accessibilityLabel("Promotion duration")
                        .accessibilityHint("Choose how long this listing stays at the top of the marketplace")

                        Button {
                            confirmPromoteListing = true
                        } label: {
                            if isPromotingListing {
                                ProgressView()
                                    .tint(BrandTheme.accent)
                                    .frame(maxWidth: .infinity, minHeight: 44)
                            } else {
                                let price = ListingPromotionTier.tier(for: selectedPromoteHours)?.priceLabel
                                    ?? MoneyFormat.usd(cents: 0)
                                Label("Promote listing — \(price)", systemImage: "flame")
                                    .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                            }
                        }
                        .disabled(isPromotingListing || isCancellingListing)
                        .tint(BrandTheme.accent)
                        .accessibilityHint("Pay to boost this listing in marketplace ranking for the selected duration")
                    }

                    if let cancelListingMessage {
                        Text(cancelListingMessage)
                            .font(.footnote)
                            .foregroundStyle(cancelListingIsError ? BrandTheme.destructive : BrandTheme.success)
                            .fixedSize(horizontal: false, vertical: true)
                    }

                    if canCancelListing(listing) {
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
                        .disabled(isCancellingListing || isPromotingListing)
                        .accessibilityHint("Cancels your goods listing if there are no active bids")
                    }
                } header: {
                    Text("Manage listing").brandSectionHeader()
                } footer: {
                    Text(manageListingFooter(listing))
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
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if showStickyBidDock(for: listing) {
                stickyBidDock(for: listing)
            }
        }
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

    /// Gateway only promotes `status == active` listings.
    private func canPromoteListing(_ listing: ListingDetail) -> Bool {
        guard auth.isAuthenticated, !auth.isScaffoldSession else { return false }
        guard isViewerSeller(of: listing) else { return false }
        let status = (listing.status ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return status == "active"
    }

    private func canManageOwnedListing(_ listing: ListingDetail) -> Bool {
        canCancelListing(listing) || canPromoteListing(listing)
    }

    private func manageListingFooter(_ listing: ListingDetail) -> String {
        if canPromoteListing(listing) && canCancelListing(listing) {
            return "You own this listing. Promote floats it higher on the marketplace scoreboard for a fixed fee. Cancel only works with no active bids."
        }
        if canPromoteListing(listing) {
            return "You own this listing. Promote floats it higher on the marketplace scoreboard for a fixed fee charged to your card."
        }
        return "You own this listing. Cancel only works for draft/active auctions with no active bids."
    }

    // MARK: - Spectate terminal entry

    private var spectateTerminalTarget: SpectateTerminalView.Target {
        .listing(
            id: listingID,
            title: detail?.displayTitle ?? preview?.title ?? "Listing",
            leadingCents: leadingBidCents
                ?? detail?.currentBidCents
                ?? detail?.startingPriceCents
                ?? preview?.currentBidCents
                ?? preview?.startingPriceCents,
            endsAt: detail?.auctionEndsAt ?? preview?.auctionEndsAt
        )
    }

    private var auctionReplayTarget: AuctionReplayView.Target {
        .listing(
            id: listingID,
            title: detail?.displayTitle ?? preview?.title
        )
    }

    @ToolbarContentBuilder
    private var listingDetailToolbar: some ToolbarContent {
        ToolbarItem(placement: .topBarTrailing) {
            HStack(spacing: 4) {
                NavigationLink {
                    SpectateTerminalView(target: spectateTerminalTarget)
                } label: {
                    Image(systemName: "dot.radiowaves.left.and.right")
                        .foregroundStyle(BrandTheme.goldBright)
                }
                .frame(minWidth: 44, minHeight: 44)
                .accessibilityLabel("Spectate terminal")
                .accessibilityIdentifier("listingDetail.spectate")
                .accessibilityHint("Opens the live spectator desk for this forward auction")

                NavigationLink {
                    AuctionReplayView(target: auctionReplayTarget)
                } label: {
                    Image(systemName: "clock.arrow.circlepath")
                        .foregroundStyle(BrandTheme.goldBright)
                }
                .frame(minWidth: 44, minHeight: 44)
                .accessibilityLabel("Auction replay")
                .accessibilityIdentifier("listingDetail.replay")
                .accessibilityHint("Opens a static bid-ladder replay for this forward auction")

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
    }

    @ViewBuilder
    private func spectateTerminalSection(_ listing: ListingDetail) -> some View {
        Section {
            NavigationLink {
                SpectateTerminalView(
                    target: .listing(
                        id: listingID,
                        title: listing.displayTitle,
                        leadingCents: leadingBidCents
                            ?? listing.currentBidCents
                            ?? listing.startingPriceCents,
                        endsAt: listing.auctionEndsAt
                    )
                )
            } label: {
                Label {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Spectate terminal")
                            .font(.body.weight(.semibold))
                            .foregroundStyle(BrandTheme.textPrimary)
                        Text("Live leading price · delayed public feed")
                            .font(.caption)
                            .foregroundStyle(BrandTheme.textSecondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                } icon: {
                    Image(systemName: "dot.radiowaves.left.and.right")
                        .foregroundStyle(BrandTheme.accent)
                }
                .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                .contentShape(Rectangle())
            }
            .accessibilityIdentifier("listingDetail.spectateSection")
            .accessibilityHint("Opens a focused live spectator desk for this auction")

            NavigationLink {
                AuctionReplayView(
                    target: .listing(id: listingID, title: listing.displayTitle)
                )
            } label: {
                Label {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Auction replay")
                            .font(.body.weight(.semibold))
                            .foregroundStyle(BrandTheme.textPrimary)
                        Text("Static bid ladder · amount · time")
                            .font(.caption)
                            .foregroundStyle(BrandTheme.textSecondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                } icon: {
                    Image(systemName: "clock.arrow.circlepath")
                        .foregroundStyle(BrandTheme.accent)
                }
                .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                .contentShape(Rectangle())
            }
            .accessibilityIdentifier("listingDetail.replaySection")
            .accessibilityHint("Opens a static bid-ladder replay for this forward auction")
        } header: {
            Text("Watch live").brandSectionHeader()
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
                    .font(.largeTitle.weight(.bold).monospacedDigit())
                    .foregroundStyle(BrandTheme.goldBright)
                    .minimumScaleFactor(0.5)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
                    .contentTransition(.numericText())
                    // Forward auction: bids climb — blue wash (`isDown: false`), not reverse green.
                    .brandMoneyFlash(token: leadingFlashToken, isDown: false)
                    .animation(.easeOut(duration: 0.2), value: heroPriceAmount(listing))
                    .accessibilityLabel("\(heroPriceCaption(listing)): \(heroPriceAmount(listing))")
                    .onChange(of: leadingBidCents) { _, newValue in
                        guard let newValue, newValue > 0 else { return }
                        if let prev = lastFlashedLeadingCents, prev != newValue {
                            leadingFlashToken += 1
                            BrandHaptics.light()
                        }
                        lastFlashedLeadingCents = newValue
                    }

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
                    if max(liveSpectatorCount, listing.watcherCount ?? 0) > 0 {
                        spectatorCountChip
                    }
                }
            }
            .padding(.vertical, 6)
            .accessibilityElement(children: .combine)
        }
    }

    private var forwardAuctionBadge: some View {
        let live: Bool = isAuctionActiveForLive
        return HStack(spacing: 6) {
            if live {
                Circle()
                    .fill(isMarketplaceSocketLive ? BrandTheme.accent : BrandTheme.success)
                    .frame(width: 7, height: 7)
                    .accessibilityHidden(true)
            }
            Text(forwardAuctionBadgeLabel(live: live))
                .font(.caption.weight(.bold))
                .foregroundStyle(BrandTheme.goldBright)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .overlay(
            Capsule()
                .strokeBorder(BrandTheme.gold, lineWidth: 1.5)
        )
        .accessibilityLabel(forwardAuctionBadgeAccessibility(live: live))
    }

    private func forwardAuctionBadgeLabel(live: Bool) -> String {
        if !live { return "Forward auction · goods" }
        if isMarketplaceSocketLive { return "LIVE · stream · forward auction" }
        return "LIVE · forward auction"
    }

    private func forwardAuctionBadgeAccessibility(live: Bool) -> String {
        if !live { return "Forward auction, goods" }
        if isMarketplaceSocketLive {
            return "Live forward auction with WebSocket stream connected"
        }
        return "Live forward auction, goods"
    }

    private var spectatorCountChip: some View {
        let displayCount = max(liveSpectatorCount, detail?.watcherCount ?? 0)
        return Label("\(displayCount) live", systemImage: "eye")
            .font(.caption.weight(.semibold))
            .foregroundStyle(BrandTheme.textPrimary)
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(BrandTheme.navyElevated, in: Capsule())
            .overlay(
                Capsule()
                    .strokeBorder(BrandTheme.gold.opacity(0.2), lineWidth: 1)
            )
            .accessibilityLabel("\(displayCount) people watching live")
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
        Label(String(localized: "\(count) bids"), systemImage: "arrow.up.circle")
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
        let published = listing.resolvedBidCount
        if published > 0 { return published }
        if case .loaded = ladderState {
            return CatalogBidCount.resolved(
                bidCount: listing.bidCount,
                bidderCount: listing.bidderCount ?? ladderBidderCount
            )
        }
        return 0
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
            HStack(spacing: 6) {
                if isAuctionActiveForLive {
                    Circle()
                        .fill(isMarketplaceSocketLive ? BrandTheme.accent : BrandTheme.success)
                        .frame(width: 6, height: 6)
                        .accessibilityHidden(true)
                }
                Text("Auction · bid ladder").brandSectionHeader()
                if isMarketplaceSocketLive {
                    Text("LIVE")
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(BrandTheme.accent)
                        .accessibilityLabel("Live stream connected")
                }
            }
        } footer: {
            Text(bidLadderFooterCopy)
                .foregroundStyle(BrandTheme.textSecondary)
        }
    }

    private var bidLadderFooterCopy: String {
        if isMarketplaceSocketLive {
            return "Highest dollar bid leads. Live stream is connected — ladder reconciles over the public bid book (briefly delayed over WebSocket)."
        }
        if isAuctionActiveForLive {
            return "Highest dollar bid leads. Refreshing the public bid book every few seconds while the auction is open."
        }
        return "Highest dollar bid leads in a forward auction. The winning bid is highlighted."
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
                        .contentTransition(.numericText())
                        .brandMoneyFlash(
                            token: isWinning ? leadingFlashToken : 0,
                            isDown: false
                        )
                        .animation(.easeOut(duration: 0.2), value: row.displayAmount)
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
        guard let remaining = retractSecondsRemaining(row, now: now) else { return false }
        return remaining > 0 && remaining <= 60
    }

    private func retractSecondsRemaining(_ row: ListingBidRow, now: Date) -> Int? {
        guard let createdAt = row.createdAt,
              let created = CatalogDateFormat.parseISO(createdAt)
        else {
            return nil
        }
        let elapsed = now.timeIntervalSince(created)
        guard elapsed >= 0 else { return nil }
        let remaining = 60 - Int(elapsed)
        return remaining > 0 && remaining <= 60 ? remaining : nil
    }

    // MARK: - Soft live feed (marketplace spectator WS + HTTP poll fallback)

    /// Auction still open for live stream / poll (status + ends-at).
    private var isAuctionActiveForLive: Bool {
        let status = (detail?.status ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        switch status {
        case "active", "open", "bidding":
            break
        default:
            // No status yet (preview shell) — still allow stream while ends-at is future.
            if detail?.status == nil, let ends = detail?.auctionEndsAt, ends > Date() {
                return true
            }
            if detail?.status == nil, detail?.auctionEndsAt == nil {
                // Soft-allow until first full load settles.
                return true
            }
            return false
        }
        if let ends = detail?.auctionEndsAt, ends < Date() {
            return false
        }
        return true
    }

    private var isMarketplaceSocketLive: Bool {
        marketplaceSpectator.status == .connected
    }

    /// Public delayed spectate for all viewers (participants share the same feed).
    private var shouldAttemptMarketplaceSpectator: Bool {
        guard scenePhase == .active else { return false }
        return isAuctionActiveForLive
    }

    private var shouldShowLiveFeed: Bool {
        isAuctionActiveForLive || !liveEvents.isEmpty
    }

    private var marketplaceSpectatorIdentity: String {
        "\(listingID)|spectate|\(isAuctionActiveForLive)|\(scenePhase == .active)"
    }

    private var ladderPollIdentity: String {
        "\(listingID)|ladder|\(isAuctionActiveForLive)|\(isMarketplaceSocketLive)|\(scenePhase == .active)"
    }

    private var liveFeedFooterCopy: String {
        if isMarketplaceSocketLive {
            return "Public live feed (briefly delayed · no bidder names on the stream). Ladder identities come from the public bid book."
        }
        if isAuctionActiveForLive {
            return "Stream reconnecting or offline — bid ladder polls the public book every few seconds."
        }
        return "Auction closed — last activity retained."
    }

    @ViewBuilder
    private var liveFeedSection: some View {
        if shouldShowLiveFeed {
            Section {
                if liveEvents.isEmpty {
                    Text("No recent bid activity on the live stream yet.")
                        .font(.footnote)
                        .foregroundStyle(BrandTheme.textSecondary)
                        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                        .accessibilityLabel("No recent bid activity on the live stream yet")
                } else {
                    ForEach(liveEvents.prefix(12)) { event in
                        liveFeedRow(event)
                    }
                }
            } header: {
                HStack(spacing: 6) {
                    if isAuctionActiveForLive {
                        Circle()
                            .fill(isMarketplaceSocketLive ? BrandTheme.accent : BrandTheme.success)
                            .frame(width: 6, height: 6)
                            .accessibilityHidden(true)
                    }
                    Text("Live feed").brandSectionHeader()
                    if isMarketplaceSocketLive {
                        Text("LIVE")
                            .font(.caption2.weight(.bold))
                            .foregroundStyle(BrandTheme.accent)
                            .accessibilityLabel("WebSocket connected")
                    }
                }
            } footer: {
                Text(liveFeedFooterCopy)
                    .foregroundStyle(BrandTheme.textSecondary)
            }
        }
    }

    @ViewBuilder
    private func liveFeedRow(_ event: MarketplaceLiveEvent) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text(event.displayEventLabel)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(BrandTheme.textPrimary)
                if let created = event.createdAt, !created.isEmpty {
                    Text(CatalogDateFormat.friendlyDateTime(created))
                        .font(.caption)
                        .foregroundStyle(BrandTheme.textSecondary)
                }
            }
            Spacer(minLength: 8)
            // Amounts are public on goods forward auctions (and on this delayed stream).
            if let cents = event.amountCents, cents > 0 {
                Text(MoneyFormat.usd(cents: cents))
                    .font(.subheadline.weight(.semibold).monospacedDigit())
                    .foregroundStyle(BrandTheme.goldBright)
            }
        }
        .padding(.vertical, 2)
        .frame(minHeight: 44)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(liveFeedAccessibilityLabel(event))
    }

    private func liveFeedAccessibilityLabel(_ event: MarketplaceLiveEvent) -> String {
        var parts: [String] = [event.displayEventLabel]
        if let cents = event.amountCents, cents > 0 {
            parts.append(MoneyFormat.usd(cents: cents))
        }
        if let created = event.createdAt, !created.isEmpty {
            parts.append(CatalogDateFormat.friendlyDateTime(created))
        }
        return parts.joined(separator: ", ")
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
                        Label("Pay \(priceLabel)", systemImage: "creditcard.fill")
                            .frame(maxWidth: .infinity, minHeight: 44)
                    }
                    .disabled(true)
                    .accessibilityLabel("Pay \(priceLabel)")
                } else if !isActive {
                    Text("Buy now is only available while the auction is active.")
                        .font(.footnote)
                        .foregroundStyle(BrandTheme.textSecondary)
                } else {
                    Text("Pays \(priceLabel) via Apple Pay (or card). Funds are held in escrow until you confirm pickup. Local pickup only.")
                        .font(.footnote)
                        .foregroundStyle(BrandTheme.textSecondary)
                    Text(Self.bidAuthorizationDisclosure)
                        .font(.footnote)
                        .foregroundStyle(BrandTheme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityIdentifier("listingDetail.bidAuthDisclosure")

                    if let buyNowStatusMessage {
                        Text(buyNowStatusMessage)
                            .font(.footnote)
                            .foregroundStyle(buyNowStatusIsError ? BrandTheme.destructive : BrandTheme.success)
                            .fixedSize(horizontal: false, vertical: true)
                    }

                    if isBuyingNow {
                        ProgressView()
                            .frame(maxWidth: .infinity, minHeight: 44)
                            .accessibilityLabel("Processing buy now")
                    } else {
                        PayWithApplePayButton(.buy) {
                            Task { await buyNow() }
                        }
                        .frame(maxWidth: .infinity, minHeight: 44)
                        .payWithApplePayButtonStyle(.automatic)
                        .disabled(isPlacingBid || isPostingBond)
                        .buttonStyle(.plain)
                        .accessibilityLabel("Buy now with Apple Pay")
                    }
                }
            } header: {
                Text("Buy now").brandSectionHeader()
            }
        }
    }

    // MARK: - Place bid (forward auction)

    /// Same gate as the sticky dock: no dollar form after close / expire / seller view.
    private func auctionAcceptsBids(_ listing: ListingDetail) -> Bool {
        let status = (listing.status ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if status == "sold" || status == "cancelled" || status == "expired" || status == "ended" {
            return false
        }
        if let ends = listing.auctionEndsAt, ends < Date() {
            return false
        }
        return true
    }

    @ViewBuilder
    private func placeBidSection(_ listing: ListingDetail) -> some View {
        if !auctionAcceptsBids(listing) {
            Section {
                Text("This auction has ended. New bids are closed.")
                    .font(.footnote)
                    .foregroundStyle(BrandTheme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            } header: {
                Text("Auction closed").brandSectionHeader()
            }
        } else {
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

                DollarAmountField(
                    text: $maxBidAmountText,
                    placeholder: "Max (optional)",
                    accessibilityLabelText: "Maximum bid in dollars, optional proxy ceiling"
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

                Text(Self.bidAuthorizationDisclosure)
                    .font(.footnote)
                    .foregroundStyle(BrandTheme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("listingDetail.bidAuthDisclosure")

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
                    BrandHaptics.medium()
                    Task { await placeListingBid() }
                } label: {
                    if isPlacingBid {
                        ProgressView()
                            .tint(BrandTheme.ctaLabelOnGold)
                            .frame(maxWidth: .infinity, minHeight: 44)
                    } else if let cents = MoneyFormat.cents(fromDollarsText: bidAmountText) {
                        Text("Place bid · \(MoneyFormat.usd(cents: cents))")
                            .frame(maxWidth: .infinity, minHeight: 44)
                    } else {
                        Text("Place bid")
                            .frame(maxWidth: .infinity, minHeight: 44)
                    }
                }
                .glassProminentBrandCTA()
                .tint(BrandTheme.accent)
                .foregroundStyle(BrandTheme.ctaLabelOnGold)
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
            Text("Goods are forward auctions — enter dollars (for example 95.00), not cents. Bid above the current high to take the lead. Set an optional max bid to auto-defend your lead (proxy bid). First-time bidders may need a refundable bid bond.")
                .foregroundStyle(BrandTheme.textSecondary)
        }
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
        // Gateway authz: only the party the offer *awaits* may accept/reject/counter.
        // Even depth → seller's move; odd depth (seller's own counter) → buyer.
        let awaiting = ListingOfferChain.awaitingParty(for: offer, in: offers)
        let sellerCanAct = offer.statusEnum == .pending && awaiting == .seller

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

            if offer.statusEnum == .pending, awaiting == .buyer {
                Text("Waiting for the buyer to respond to your counter.")
                    .font(.caption)
                    .foregroundStyle(BrandTheme.textSecondary)
            }

            if sellerCanAct {
                HStack(spacing: 8) {
                    Button {
                        Task { await updateOffer(offer, action: .accept) }
                    } label: {
                        if actingOfferID == offer.id {
                            ProgressView().tint(BrandTheme.ctaLabelOnGold)
                        } else {
                            Text("Accept")
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(BrandTheme.success)
                    .frame(minHeight: 44)
                    .disabled(actingOfferID != nil)
                    .accessibilityLabel("Accept offer \(offer.displayAmount)")

                    Button {
                        Task { await updateOffer(offer, action: .reject) }
                    } label: {
                        Text("Reject")
                    }
                    .buttonStyle(.bordered)
                    .frame(minHeight: 44)
                    .disabled(actingOfferID != nil)
                    .accessibilityLabel("Reject offer \(offer.displayAmount)")

                    Button {
                        counteringOfferID = counteringOfferID == offer.id ? nil : offer.id
                        counterAmountText = ""
                    } label: {
                        Text("Counter")
                    }
                    .buttonStyle(.bordered)
                    .frame(minHeight: 44)
                    .disabled(actingOfferID != nil)
                    .accessibilityLabel("Counter offer \(offer.displayAmount)")
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
                                .tint(BrandTheme.ctaLabelOnGold)
                                .frame(maxWidth: .infinity, minHeight: 44)
                        } else {
                            Text("Send counter")
                                .frame(maxWidth: .infinity, minHeight: 44)
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(BrandTheme.accent)
                    .foregroundStyle(BrandTheme.ctaLabelOnGold)
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
                        .tint(BrandTheme.ctaLabelOnGold)
                        .frame(maxWidth: .infinity, minHeight: 44)
                } else {
                    Text("Send offer")
                        .frame(maxWidth: .infinity, minHeight: 44)
                }
            }
            .buttonStyle(.borderedProminent)
            .tint(BrandTheme.accent)
            .foregroundStyle(BrandTheme.ctaLabelOnGold)
            .disabled(
                isSubmittingOffer
                    || offerAmountText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            )
            .accessibilityHint("Sends a Best Offer to the seller")
        }

        // Buyer's own offer history for this listing (newest first from API).
        // Depth parity: even → withdraw (awaiting seller); odd pending → accept/reject counter.
        if !offers.isEmpty {
            ForEach(offers) { offer in
                let awaiting = ListingOfferChain.awaitingParty(for: offer, in: offers)
                let isMine = offer.buyerId == currentUserID
                let isPending = offer.statusEnum == .pending
                let buyerCanAcceptReject = isMine && isPending && awaiting == .buyer
                let buyerCanWithdraw = isMine && isPending && awaiting == .seller

                VStack(alignment: .leading, spacing: 8) {
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
                            Text(buyerOfferStatusLabel(offer: offer, awaiting: awaiting))
                                .font(.caption)
                                .foregroundStyle(BrandTheme.textSecondary)
                        }
                        Spacer()
                        Text(offer.displayStatus)
                            .font(.caption.weight(.medium))
                            .foregroundStyle(BrandTheme.textSecondary)
                    }
                    .frame(minHeight: 44)

                    if buyerCanAcceptReject {
                        HStack(spacing: 8) {
                            Button {
                                Task { await updateOffer(offer, action: .accept) }
                            } label: {
                                if actingOfferID == offer.id {
                                    ProgressView()
                                        .tint(BrandTheme.ctaLabelOnGold)
                                        .frame(maxWidth: .infinity, minHeight: 44)
                                } else {
                                    Text("Accept counter")
                                        .frame(maxWidth: .infinity, minHeight: 44)
                                }
                            }
                            .buttonStyle(.borderedProminent)
                            .tint(BrandTheme.success)
                            .disabled(actingOfferID != nil)
                            .accessibilityLabel("Accept counter offer \(offer.displayAmount)")
                            .accessibilityHint("Creates an order and opens payment when a client secret is returned")

                            Button(role: .destructive) {
                                Task { await updateOffer(offer, action: .reject) }
                            } label: {
                                Text("Reject")
                                    .frame(maxWidth: .infinity, minHeight: 44)
                            }
                            .buttonStyle(.bordered)
                            .disabled(actingOfferID != nil)
                            .accessibilityLabel("Reject counter offer \(offer.displayAmount)")
                        }
                    }

                    if buyerCanWithdraw {
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
                        .accessibilityHint("Cancels your open offer before the seller responds")
                    }
                }
            }
        }
    }

    private func buyerOfferStatusLabel(
        offer: ListingOffer,
        awaiting: ListingOfferAwaitingParty
    ) -> String {
        switch offer.statusEnum {
        case .pending:
            return awaiting == .seller
                ? "Waiting for the seller to respond"
                : "The seller countered — your move"
        case .countered:
            return "You countered this offer"
        case .accepted:
            return "Accepted — order created"
        case .rejected:
            return "Declined"
        case .withdrawn:
            return "You withdrew this offer"
        case .expired:
            return "This offer expired"
        case .unknown:
            return offer.displayStatus
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
            if listing.resolvedBidCount > 0 {
                LabeledContent("Bids", value: "\(listing.resolvedBidCount)")
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

    /// Mint promotion → SetupIntent (or dev short-circuit) → confirm off-session charge.
    /// Fail closed: never show success unless confirm returns `is_promoted=true`.
    @MainActor
    private func promoteOwnedListing() async {
        promoteStatusMessage = nil
        promoteStatusIsError = false

        guard !auth.isScaffoldSession else {
            promoteStatusIsError = true
            promoteStatusMessage =
                "Browse-only mode has no API credentials. Sign in against a live gateway to promote."
            return
        }

        guard ListingPromotionTier.isAllowed(selectedPromoteHours) else {
            promoteStatusIsError = true
            promoteStatusMessage = "Choose a valid promotion duration."
            return
        }

        let expectedCents = ListingPromotionTier.expectedAmountCents(for: selectedPromoteHours) ?? 0
        isPromotingListing = true
        defer { isPromotingListing = false }

        do {
            let minted = try await APIClient.shared.createListingPromotion(
                listingId: listingID,
                durationHours: selectedPromoteHours
            )

            // Money safety: refuse to present a sheet if server amount diverges from pricebook.
            guard minted.matchesExpectedPricebook(), minted.amountCents == expectedCents else {
                promoteStatusIsError = true
                promoteStatusMessage =
                    "Promotion price from the server didn’t match the expected fee. Nothing was charged — try again later."
                return
            }

            if minted.isDevSetupSecret {
                // Fail closed: never claim "promoted" without a real charge. Gateway
                // also refuses dev secrets unless ALLOW_DEV_PROMOTE_WITHOUT_PAYMENT=true.
                promoteStatusIsError = true
                promoteStatusMessage =
                    "Promotion requires a real card payment. Stripe is not configured on this environment — nothing was charged and the listing was not promoted."
                return
            } else if minted.isStripeSetupSecret {
                try await RailACheckout.presentSetupIntent(
                    clientSecret: minted.stripeClientSecret
                )
                let confirmed = try await APIClient.shared.confirmListingPromotion(
                    listingId: listingID,
                    chargeId: minted.chargeId
                )
                applyPromotionSuccess(confirmed)
            } else {
                promoteStatusIsError = true
                promoteStatusMessage =
                    "Could not start card setup for promotion on this device. Open the listing on the web to promote, or try again later."
            }
        } catch let error as RailACheckout.CheckoutError where error.isCanceled {
            promoteStatusIsError = false
            promoteStatusMessage = "Promotion canceled. Your card was not charged."
        } catch let error as RailACheckout.CheckoutError {
            promoteStatusIsError = true
            switch error {
            case .stripeNotConfigured, .missingClientSecret:
                promoteStatusMessage =
                    "Apple Pay / card setup isn’t available in this build. Open the listing on the web to promote."
            default:
                promoteStatusMessage = error.localizedDescription
            }
        } catch let error as APIClientError where error.isUnauthorized {
            promoteStatusIsError = true
            promoteStatusMessage = "Sign in required. Your session is missing or expired — please sign in again."
        } catch let error as APIClientError where error.isPaymentRequired {
            promoteStatusIsError = true
            promoteStatusMessage =
                error.errorDescription
                ?? "We could not complete the payment for this promotion. Confirm your card and try again."
        } catch {
            promoteStatusIsError = true
            promoteStatusMessage = error.localizedDescription
        }
    }

    @MainActor
    private func applyPromotionSuccess(_ confirmed: ConfirmPromotionResponse) {
        // Fail closed already enforced in confirmListingPromotion; still only mutate on truthy flag.
        guard confirmed.isPromoted == true else {
            promoteStatusIsError = true
            promoteStatusMessage = "Promotion was not activated. Nothing will show as promoted."
            return
        }
        promoteStatusIsError = false
        if let until = confirmed.promotedUntilDate {
            promoteStatusMessage =
                "Listing promoted until \(until.formatted(date: .abbreviated, time: .shortened))."
            detail?.isPromoted = true
            detail?.promotedUntil = until
        } else if let raw = confirmed.promotedUntil, !raw.isEmpty {
            promoteStatusMessage = "Listing promoted until \(raw)."
            detail?.isPromoted = true
        } else {
            promoteStatusMessage = "Listing promoted."
            detail?.isPromoted = true
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
            BrandHaptics.error()
            bidStatusIsError = true
            bidStatusMessage =
                "Browse-only mode has no API credentials. Sign in against a live gateway to place bids."
            return
        }

        guard let cents = MoneyFormat.cents(fromDollarsText: bidAmountText) else {
            BrandHaptics.warning()
            bidStatusIsError = true
            bidStatusMessage =
                "Enter a valid dollar amount (for example 25.00). Do not enter cents — $25 is 25, not 2500."
            return
        }

        if let leading = leadingBidCents, cents <= leading {
            BrandHaptics.warning()
            bidStatusIsError = true
            bidStatusMessage =
                "Forward auction: bid above the current high of \(MoneyFormat.usd(cents: leading))."
            return
        }

        var maxCents: Int64? = nil
        let maxTrimmed = maxBidAmountText.trimmingCharacters(in: .whitespacesAndNewlines)
        if !maxTrimmed.isEmpty {
            guard let parsedMax = MoneyFormat.cents(fromDollarsText: maxTrimmed) else {
                bidStatusIsError = true
                bidStatusMessage = "Enter a valid max bid in dollars, or leave max blank."
                return
            }
            if parsedMax < cents {
                bidStatusIsError = true
                bidStatusMessage = "Max bid must be at least your bid amount."
                return
            }
            if parsedMax > cents {
                maxCents = parsedMax
            }
        }

        await submitListingBid(amountCents: cents, maxBidCents: maxCents, clearBondGate: true)
    }

    /// Shared place-bid path used by the form and post-bond retry.
    @MainActor
    private func submitListingBid(
        amountCents: Int64,
        maxBidCents: Int64? = nil,
        clearBondGate: Bool
    ) async {
        isPlacingBid = true
        defer { isPlacingBid = false }

        do {
            _ = try await APIClient.shared.placeListingBid(
                listingId: listingID,
                amountCents: amountCents,
                maxBidCents: maxBidCents
            )
            BrandHaptics.success()
            bidStatusIsError = false
            if let maxBidCents, maxBidCents > amountCents {
                bidStatusMessage =
                    "Bid placed: \(MoneyFormat.usd(cents: amountCents)) (max \(MoneyFormat.usd(cents: maxBidCents)))."
            } else {
                bidStatusMessage = "Bid placed: \(MoneyFormat.usd(cents: amountCents))."
            }
            bidAmountText = ""
            maxBidAmountText = ""
            clearBidBondUIState()
            // Value moment: invite push permission after first successful bid (NT.2).
            PushRegistration.shared.noteValueMoment()
            // Live Activity + widget snapshot (best-effort; never fails the bid path).
            let title = detail?.title ?? preview?.title ?? "Marketplace auction"
            AuctionLiveActivityController.startOrUpdate(
                auctionID: listingID,
                title: title,
                kind: "listing",
                leadingBidCents: amountCents,
                endsAt: detail?.auctionEndsAt ?? preview?.auctionEndsAt
            )
            #if DEBUG
            if let note = AuctionLiveActivityController.debugUnavailableReason {
                let placed = bidStatusMessage ?? "Bid placed."
                bidStatusMessage = "\(placed) \(note)."
            }
            #endif
            await load()
        } catch let error as APIClientError where error.isBidBondRequired {
            BrandHaptics.warning()
            let bondCents = error.bidBondAmountCents ?? 0
            pendingBidCents = amountCents
            pendingMaxBidCents = maxBidCents
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
            BrandHaptics.error()
            bidStatusIsError = true
            bidStatusMessage = "Sign in required. Your session is missing or expired — please sign in again."
        } catch {
            BrandHaptics.error()
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
            await submitListingBid(
                amountCents: intendedCents,
                maxBidCents: pendingMaxBidCents,
                clearBondGate: false
            )
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
        pendingMaxBidCents = nil
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
            // IOS-INT.2: drop Spotlight donation when the listing is gone.
            if let apiError = error as? APIClientError, apiError.isNotFound {
                await SpotlightIndex.delete(identifiers: [listingID])
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
            let response = try await APIClient.shared.updateOffer(offerId: offer.id, action: action)
            offerStatusIsError = false
            counteringOfferID = nil

            switch action {
            case .accept:
                // Buyer accepting a counter may receive their own PI secret — pay now.
                // Seller accepting never receives client_secret (gateway withholding).
                let envelope = response.envelope
                if let secret = envelope.clientSecret, envelope.hasConfirmableSecret {
                    do {
                        try await RailACheckout.presentPaymentSheet(clientSecret: secret)
                        offerStatusIsError = false
                        offerStatusMessage =
                            "Payment complete — order \(response.orderId ?? "") is held in escrow until pickup."
                    } catch let error as RailACheckout.CheckoutError where error.isCanceled {
                        offerStatusIsError = false
                        offerStatusMessage =
                            "Offer accepted (order \(response.orderId ?? "")). Payment canceled — finish under Account → Orders."
                    } catch {
                        offerStatusIsError = true
                        offerStatusMessage =
                            "Offer accepted (order \(response.orderId ?? "")), but payment failed: \(error.localizedDescription). Pay under Account → Orders."
                    }
                } else if let orderId = response.orderId, !orderId.isEmpty {
                    // Seller accept (or buyer accept without PI): order is pending_payment.
                    let isBuyer = offer.buyerId == currentUserID
                    if isBuyer {
                        if let chargeError = response.chargeError, !chargeError.isEmpty {
                            offerStatusIsError = true
                            offerStatusMessage =
                                "Order \(orderId) created, but payment could not start (\(chargeError)). Open Account → Orders to pay."
                        } else {
                            offerStatusMessage =
                                "Counter accepted — order \(orderId) awaits payment. Open Account → Orders to pay with Apple Pay."
                        }
                    } else {
                        offerStatusMessage =
                            "Offer accepted — order \(orderId) created. The buyer pays under Account → Orders."
                    }
                } else {
                    offerStatusMessage = "Offer accepted."
                }
            case .reject:
                offerStatusMessage = "Offer rejected."
            case .withdraw:
                offerStatusMessage = "Offer withdrawn."
            case .counter:
                offerStatusMessage = "Counter offer sent."
            }
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
    private func loadBids(soft: Bool = false) async {
        // Soft poll: keep the last ladder visible (no loading flash).
        if !soft || bidRows.isEmpty {
            if case .loaded = ladderState, soft {
                // Keep prior rows while refreshing.
            } else if !soft {
                ladderState = .loading
            } else if bidRows.isEmpty {
                ladderState = .loading
            }
        }
        do {
            let response = try await APIClient.shared.fetchListingBids(listingId: listingID)
            bidRows = response.bids
            ladderCurrentBidCents = response.currentBidCents
            ladderBidderCount = response.bidderCount
            if var listing = detail {
                if let current = response.currentBidCents, current > 0 {
                    listing.currentBidCents = current
                }
                if let bidders = response.bidderCount {
                    listing.bidderCount = bidders
                }
                // Heat is bid_count / bidder_count — not the nested trail length.
                if listing.bidCount == nil || listing.bidCount == 0 {
                    let published = response.resolvedBidCount
                    if published > 0 {
                        listing.bidCount = published
                    }
                }
                detail = listing
            }
            ladderState = .loaded
        } catch {
            if soft, case .loaded = ladderState {
                // Keep last good ladder on transient poll failure.
                return
            }
            bidRows = []
            ladderState = .failed(error.localizedDescription)
        }
    }

    // MARK: - Marketplace spectator lifecycle

    /// HTTP fallback while the marketplace spectator socket is down (IOS-PERF.5).
    private static let liveAuctionFallbackPollNanoseconds: UInt64 = 5_000_000_000

    /// Hybrid REST poll for the public bid ladder.
    ///
    /// - **WS connected:** slow reconcile (~15s) so missed frames still surface.
    /// - **WS down:** faster poll while the auction is open (5s — IOS-PERF.5).
    /// - Auction closed: single pass then stop.
    private func pollBidLadderLoop() async {
        guard scenePhase == .active else { return }
        // Seed once immediately when task (re)starts.
        await loadBids(soft: ladderState == .loaded || !bidRows.isEmpty)
        guard isAuctionActiveForLive else { return }
        while !Task.isCancelled {
            let interval: UInt64 = isMarketplaceSocketLive
                ? 15_000_000_000
                : Self.liveAuctionFallbackPollNanoseconds
            do {
                try await Task.sleep(nanoseconds: interval)
            } catch {
                return
            }
            guard !Task.isCancelled else { return }
            guard scenePhase == .active else { return }
            if !isAuctionActiveForLive {
                await loadBids(soft: true)
                return
            }
            await loadBids(soft: true)
        }
    }

    @MainActor
    private func runMarketplaceSpectatorLifecycle() async {
        guard shouldAttemptMarketplaceSpectator else {
            marketplaceSpectator.disconnect()
            return
        }

        marketplaceSpectator.onEvent = { [listingID] event in
            handleMarketplaceSpectatorEvent(event, expectedListingID: listingID)
        }
        marketplaceSpectator.connect(listingID: listingID)

        while !Task.isCancelled {
            do {
                try await Task.sleep(nanoseconds: 1_000_000_000)
            } catch {
                break
            }
            if !shouldAttemptMarketplaceSpectator {
                break
            }
        }
        marketplaceSpectator.disconnect()
    }

    @MainActor
    private func handleScenePhaseChange(_ phase: ScenePhase) {
        if phase == .active {
            if shouldAttemptMarketplaceSpectator {
                marketplaceSpectator.connect(listingID: listingID)
            }
        } else {
            marketplaceSpectator.disconnect()
        }
    }

    @MainActor
    private func teardownMarketplaceSpectator() {
        marketplaceSpectator.onEvent = nil
        marketplaceSpectator.disconnect()
    }

    @MainActor
    private func handleMarketplaceSpectatorEvent(
        _ event: MarketplaceSpectatorWebSocketClient.ServerEvent,
        expectedListingID: String
    ) {
        switch event {
        case .bidEvent(let bidEvent):
            applyMarketplaceBidSignal(bidEvent, expectedListingID: expectedListingID)
        case .spectatorCount(let count):
            // Public concurrent-viewer count (gateway: max of page pings + WS).
            // Never decrease below listing seed while still connected.
            let seeded = detail?.watcherCount ?? 0
            liveSpectatorCount = max(0, max(count, seeded))
        case .error:
            // Non-fatal; HTTP poll covers recovery.
            break
        }
    }

    /// Merge a public bid tick into soft feed + leading price; debounced ladder refresh.
    @MainActor
    private func applyMarketplaceBidSignal(
        _ bidEvent: MarketplaceLiveEvent,
        expectedListingID: String
    ) {
        if let lid = bidEvent.listingId, !lid.isEmpty, lid != expectedListingID {
            return
        }
        mergeLiveEvent(bidEvent)

        // Forward auction: highest amount leads (public signal).
        if let cents = bidEvent.amountCents, cents > 0 {
            if ladderCurrentBidCents == nil || cents > (ladderCurrentBidCents ?? 0) {
                ladderCurrentBidCents = cents
            }
            if var listing = detail {
                if let current = listing.currentBidCents {
                    if cents > current {
                        listing.currentBidCents = cents
                        detail = listing
                    }
                } else {
                    listing.currentBidCents = cents
                    detail = listing
                }
            }
        }

        // Anti-snipe: extend countdown from server-provided ends-at (ISO).
        if bidEvent.snipeExtension,
           let ends = bidEvent.newAuctionEndsAt,
           let date = CatalogDateFormat.parseISO(ends)
        {
            if var listing = detail {
                listing.auctionEndsAt = date
                detail = listing
            }
        }

        let now = Date()
        if now.timeIntervalSince(lastLadderInvalidateAt) >= 2.0 {
            lastLadderInvalidateAt = now
            Task { await loadBids(soft: true) }
        }
    }

    @MainActor
    private func mergeLiveEvent(_ event: MarketplaceLiveEvent) {
        if liveEvents.contains(where: { $0.id == event.id }) {
            return
        }
        liveEvents.insert(event, at: 0)
        if liveEvents.count > 40 {
            liveEvents = Array(liveEvents.prefix(40))
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
            // Value moment: first watchlist add invites push for price-drop / closing (NT.2).
            if response.watching, !previous {
                PushRegistration.shared.noteValueMoment()
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
                                .tint(BrandTheme.ctaLabelOnGold)
                                .frame(maxWidth: .infinity, minHeight: 44)
                        } else {
                            Text("Submit report")
                                .frame(maxWidth: .infinity, minHeight: 44)
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(BrandTheme.accent)
                    .foregroundStyle(BrandTheme.ctaLabelOnGold)
                    .disabled(isSubmitting)
                }
            }
            .brandListBackground()
            .navigationTitle("Report listing")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .brandNavigationBarChrome()
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


