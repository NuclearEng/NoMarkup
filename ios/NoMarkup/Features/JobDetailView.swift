import SwiftUI

/// Job detail for a single services **reverse auction**.
/// Providers bid **down** — lowest trusted bid can win.
struct JobDetailView: View {
    let jobID: String
    var preview: JobSummary?

    @EnvironmentObject private var auth: AuthViewModel
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.openURL) private var openURL

    @State private var detail: JobDetail?
    @State private var isLoading = false
    @State private var errorMessage: String?

    @State private var bidEntries: [JobBidEntry] = []
    @State private var ladderState: BidLadderState = .idle
    @State private var showWebSafari = false

    @State private var bidAmountText = ""
    @State private var isPlacingBid = false
    @State private var bidStatusMessage: String?
    @State private var bidStatusIsError = false

    /// Provider's own active service bid on this job (from ladder or `GET /bids/mine`).
    @State private var ownActiveServiceBid: MyJobBidRow?
    @State private var isAcceptingOffer = false
    @State private var acceptOfferMessage: String?
    @State private var acceptOfferIsError = false
    @State private var confirmAcceptOffer = false

    /// FR-4.6 lite: ladder sort — price (default reverse-auction lead) or trust.
    private enum LadderSort: String, CaseIterable, Identifiable {
        case price = "Price"
        case trust = "Trust"
        var id: String { rawValue }
    }

    @State private var ladderSort: LadderSort = .price

    @State private var currentUserID: String?
    @State private var pendingAwardEntry: JobBidEntry?
    @State private var isAwarding = false
    @State private var awardStatusMessage: String?
    @State private var awardStatusIsError = false

    @State private var withdrawingBidID: String?
    @State private var withdrawStatusMessage: String?
    @State private var withdrawStatusIsError = false

    @State private var isManagingAuction = false
    @State private var manageAuctionMessage: String?
    @State private var manageAuctionIsError = false
    @State private var confirmCloseBidding = false
    @State private var confirmCancelJob = false

    /// Soft live-auction overlay (lowest bid / ends-at) from optional poll.
    @State private var liveLowestBidCents: Int64?
    /// True once `GET …/auction/state` succeeds (feature on + live job).
    @State private var liveAuctionStateAvailable = false
    /// Recent activity from soft poll of `GET …/auction/events` (HTTP, not WS).
    @State private var auctionEvents: [AuctionEvent] = []

    /// Showcase H1.4/H1.5 — FPI when usable (median savings); soft-fail otherwise.
    @State private var fairPrice: FairPriceResponse?
    /// Resolved band: FPI → category starting-bid sample → reverse-auction 60–100% estimate.
    @State private var marketRange: MarketRangeEstimate?

    init(jobID: String, preview: JobSummary? = nil) {
        self.jobID = jobID
        self.preview = preview
        if let preview {
            _detail = State(initialValue: JobDetail(from: preview))
        }
    }

    private var webJobURL: URL {
        AppConfig.publicWebBaseURL
            .appending(path: "jobs")
            .appending(path: jobID)
    }

    /// Reverse auction ladder. Default: lowest amount first (rank #1 leading).
    /// Trust sort: highest trust first when scores exist. Withdrawn bids always last.
    private var sortedLadder: [JobBidEntry] {
        bidEntries.sorted { lhs, rhs in
            let leftWithdrawn = bidStatusIsWithdrawn(lhs)
            let rightWithdrawn = bidStatusIsWithdrawn(rhs)
            if leftWithdrawn != rightWithdrawn {
                return !leftWithdrawn
            }
            switch ladderSort {
            case .price:
                let a = lhs.bid?.amountCents ?? Int64.max
                let b = rhs.bid?.amountCents ?? Int64.max
                if a != b { return a < b }
                return lhs.displayName.localizedCaseInsensitiveCompare(rhs.displayName) == .orderedAscending
            case .trust:
                let ta = trustSortKey(lhs)
                let tb = trustSortKey(rhs)
                if ta != tb { return ta > tb }
                // Tie-break on price (lower better) then name.
                let a = lhs.bid?.amountCents ?? Int64.max
                let b = rhs.bid?.amountCents ?? Int64.max
                if a != b { return a < b }
                return lhs.displayName.localizedCaseInsensitiveCompare(rhs.displayName) == .orderedAscending
            }
        }
    }

    /// 0…1 trust score for sort; missing scores sort to the bottom of the active group.
    private func trustSortKey(_ entry: JobBidEntry) -> Double {
        if let n = entry.trustScore?.normalizedScore { return n }
        if let v = entry.trustScoreValue {
            return TrustScoreScale.normalized(v) ?? -1
        }
        return -1
    }

    /// Provider's active bid amount on this job (for lower-only validation).
    private var ownActiveBidAmountCents: Int64? {
        if let own = ownActiveServiceBid, own.isLowerable, let cents = own.amountCents, cents > 0 {
            return cents
        }
        if let entry = bidEntries.first(where: { isOwnWithdrawableBid($0) }),
           let cents = entry.bid?.amountCents, cents > 0
        {
            return cents
        }
        return nil
    }

    private var ownActiveBidId: String? {
        if let own = ownActiveServiceBid, own.isLowerable, !own.id.isEmpty {
            return own.id
        }
        return bidEntries.first(where: { isOwnWithdrawableBid($0) })?.bid?.id
    }

    private var hasOwnActiveBid: Bool {
        ownActiveBidId != nil
    }

    /// Lowest active bid amount (reverse-auction lead). Independent of ladder sort mode.
    private var leadingBidCents: Int64? {
        let activeAmounts = bidEntries
            .filter { !bidStatusIsWithdrawn($0) }
            .compactMap { $0.bid?.amountCents }
            .filter { $0 > 0 }
        if let lowest = activeAmounts.min() {
            return lowest
        }
        if let live = liveLowestBidCents, live > 0 {
            return live
        }
        return nil
    }

    private func bidStatusIsWithdrawn(_ entry: JobBidEntry) -> Bool {
        let status = (entry.bid?.status ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return status == "withdrawn"
    }

    /// Customer who posted the job (JWT `sub` matches `job.customer_id`).
    private var isJobOwner: Bool {
        guard let customerId = detail?.customerId?.trimmingCharacters(in: .whitespacesAndNewlines),
              !customerId.isEmpty,
              let uid = currentUserID?.trimmingCharacters(in: .whitespacesAndNewlines),
              !uid.isEmpty
        else {
            return false
        }
        return customerId.caseInsensitiveCompare(uid) == .orderedSame
    }

    /// Award is allowed for the owner while the auction is still awardable.
    private var canAward: Bool {
        guard isJobOwner, auth.isAuthenticated, !auth.isScaffoldSession else { return false }
        let status = (detail?.status ?? "").lowercased()
        switch status {
        case "active", "open", "closed", "bidding":
            return true
        default:
            return false
        }
    }

    /// Owner can close bidding or cancel while the reverse auction is still open/active.
    private var canManageAuction: Bool {
        guard isJobOwner, auth.isAuthenticated, !auth.isScaffoldSession else { return false }
        let status = (detail?.status ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        switch status {
        case "active", "open", "bidding":
            return true
        default:
            return false
        }
    }

    /// Light live-auction poll while the reverse auction is still open.
    private var isAuctionActiveForPolling: Bool {
        let status = (detail?.status ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        switch status {
        case "active", "open", "bidding":
            break
        default:
            return false
        }
        if let ends = detail?.auctionEndsAt,
           let date = CatalogDateFormat.parseISO(ends),
           date < Date() {
            return false
        }
        return true
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
                    title: "Couldn’t load job",
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
        .navigationTitle(detail?.displayTitle ?? "Reverse auction")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbarBackground(BrandTheme.navy, for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
        .task { await load() }
        .task(id: auctionPollIdentity) {
            await pollLiveAuctionStateLoop()
        }
        .task(id: "\(jobID)|ladder|\(scenePhase == .active)") {
            await pollBidLadderLoop()
        }
        .refreshable { await load() }
        .confirmationDialog(
            "Award this bid?",
            isPresented: Binding(
                get: { pendingAwardEntry != nil },
                set: { if !$0 { pendingAwardEntry = nil } }
            ),
            titleVisibility: .visible,
            presenting: pendingAwardEntry
        ) { entry in
            Button("Award \(entry.displayAmount) to \(entry.displayName)", role: .destructive) {
                Task { await awardBid(entry) }
            }
            Button("Cancel", role: .cancel) {
                pendingAwardEntry = nil
            }
        } message: { entry in
            Text(
                "This awards the job to \(entry.displayName) at \(entry.displayAmount) and starts the contract. Other bidders are notified they were not selected."
            )
        }
        .confirmationDialog(
            "Close bidding?",
            isPresented: $confirmCloseBidding,
            titleVisibility: .visible
        ) {
            Button("Close bidding", role: .destructive) {
                Task { await closeBidding() }
            }
            Button("Keep open", role: .cancel) {}
        } message: {
            Text("Stops new reverse bids and opens the award window. You can still award a bid afterward.")
        }
        .confirmationDialog(
            "Cancel this job?",
            isPresented: $confirmCancelJob,
            titleVisibility: .visible
        ) {
            Button("Cancel job", role: .destructive) {
                Task { await cancelOwnedJob() }
            }
            Button("Keep job", role: .cancel) {}
        } message: {
            Text("Cancels the auction and notifies bidders. This cannot be undone from the app.")
        }
        .confirmationDialog(
            "Accept offer price?",
            isPresented: $confirmAcceptOffer,
            titleVisibility: .visible
        ) {
            Button("Accept offer") {
                Task { await acceptOfferPrice() }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            if let offer = detail?.offerAcceptedCents, offer > 0 {
                Text("Places a bid at the customer’s instant price of \(MoneyFormat.usd(cents: offer)). You can still lower that bid later.")
            } else {
                Text("Places a bid at the customer’s instant-accept price.")
            }
        }
        .sheet(isPresented: $showWebSafari) {
            NavigationStack {
                LegalWebView(title: "Job on web", url: webJobURL)
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
    private func detailContent(_ job: JobDetail) -> some View {
        List {
            // Auction first — open-floor arena (live) or sealed hero, then bid / ladder / feed.
            if isLiveAuctionType || liveAuctionStateAvailable {
                liveReverseAuctionArena(job)
            } else {
                auctionHeroSection(job)
            }
            placeBidSection(job)
            acceptOfferSection(job)
            bidLadderSection(job)
            liveFeedSection
            manageAuctionSection
            detailsSection(job)

            if let description = job.description?.trimmingCharacters(in: .whitespacesAndNewlines),
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

            if job.customerDisplayName != nil || job.customerJobsPosted != nil {
                Section {
                    if let name = job.customerDisplayName, !name.isEmpty {
                        LabeledContent("Name", value: name)
                    }
                    if let posted = job.customerJobsPosted {
                        LabeledContent("Jobs posted", value: "\(posted)")
                    }
                    if let since = job.customerMemberSince, !since.isEmpty {
                        LabeledContent("Member since", value: CatalogDateFormat.friendlyDateTime(since))
                    }
                } header: {
                    Text("Customer").brandSectionHeader()
                }
            }
        }
        .brandListBackground()
    }

    // MARK: - Live open-floor reverse auction (unmissable)

    /// Public reverse auction floor: pulse LIVE badge, leading bid, countdown, market strip.
    @ViewBuilder
    private func liveReverseAuctionArena(_ job: JobDetail) -> some View {
        Section {
            VStack(alignment: .leading, spacing: 16) {
                HStack(spacing: 10) {
                    TimelineView(.periodic(from: .now, by: 0.7)) { context in
                        let on = Int(context.date.timeIntervalSince1970 * 2.5) % 2 == 0
                        HStack(spacing: 8) {
                            Circle()
                                .fill(BrandTheme.success.opacity(on ? 1 : 0.3))
                                .frame(width: 10, height: 10)
                            Text("LIVE · REVERSE AUCTION")
                                .font(.system(size: 12, weight: .black, design: .rounded))
                                .tracking(0.8)
                                .foregroundStyle(BrandTheme.success)
                        }
                    }
                    Spacer(minLength: 8)
                    if let status = job.status, !status.isEmpty {
                        StatusChipView(
                            label: StatusChipStyle.displayLabel(status),
                            style: StatusChipStyle.forStatus(status)
                        )
                    }
                }

                Text(job.displayTitle)
                    .font(.title2.weight(.bold))
                    .foregroundStyle(BrandTheme.textPrimary)
                    .fixedSize(horizontal: false, vertical: true)

                VStack(alignment: .leading, spacing: 4) {
                    Text(arenaLeadingLabel)
                        .font(.caption.weight(.bold))
                        .foregroundStyle(BrandTheme.textSecondary)
                        .textCase(.uppercase)
                    Text(arenaLeadingAmount)
                        .font(.system(size: 40, weight: .bold, design: .rounded).monospacedDigit())
                        .foregroundStyle(BrandTheme.goldBright)
                        .minimumScaleFactor(0.7)
                        .lineLimit(1)
                    Text("Providers bid down · lowest trusted bid leads")
                        .font(.subheadline)
                        .foregroundStyle(BrandTheme.textSecondary)
                }
                .accessibilityElement(children: .combine)
                .accessibilityLabel("\(arenaLeadingLabel) \(arenaLeadingAmount)")

                if let start = job.startingBidCents, start > 0,
                   let leading = arenaLeadingCents, leading > 0, leading < start {
                    let saved = start - leading
                    let pct = Int((Double(saved) / Double(start) * 100.0).rounded())
                    Text("Saved \(MoneyFormat.usd(cents: saved)) vs starting (\(pct)%)")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(BrandTheme.success)
                }

                marketIntelligenceStrip(job)

                HStack(spacing: 12) {
                    if job.auctionEndsAt != nil {
                        liveCountdownChip(iso: job.auctionEndsAt)
                    }
                    bidCountChip(job: job)
                    if liveAuctionStateAvailable {
                        Text("Live feed on")
                            .font(.caption2.weight(.bold))
                            .foregroundStyle(BrandTheme.success)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 4)
                            .background(Capsule().fill(BrandTheme.success.opacity(0.12)))
                    }
                }
            }
            .padding(.vertical, 8)
        } header: {
            Text("Auction floor").brandSectionHeader()
        } footer: {
            Text("Open floor — bid amounts are public. Feed refreshes every few seconds while open.")
                .foregroundStyle(BrandTheme.textSecondary)
        }
    }

    private var arenaLeadingCents: Int64? {
        if let live = liveLowestBidCents, live > 0 { return live }
        if let ladder = leadingBidCents, ladder > 0 { return ladder }
        return detail?.startingBidCents
    }

    private var arenaLeadingAmount: String {
        if let c = arenaLeadingCents, c > 0 {
            return MoneyFormat.usd(cents: c)
        }
        return "—"
    }

    private var arenaLeadingLabel: String {
        if liveLowestBidCents != nil || leadingBidCents != nil {
            return "Leading bid"
        }
        return "Starting budget"
    }

    @ViewBuilder
    private var manageAuctionSection: some View {
        if canManageAuction {
            Section {
                if let manageAuctionMessage {
                    Text(manageAuctionMessage)
                        .font(.footnote)
                        .foregroundStyle(manageAuctionIsError ? BrandTheme.destructive : BrandTheme.success)
                        .fixedSize(horizontal: false, vertical: true)
                }

                Button {
                    confirmCloseBidding = true
                } label: {
                    if isManagingAuction {
                        ProgressView()
                            .tint(BrandTheme.accent)
                            .frame(maxWidth: .infinity, minHeight: 44)
                    } else {
                        Label("Close bidding", systemImage: "lock.fill")
                            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                    }
                }
                .disabled(isManagingAuction)
                .accessibilityHint("Stops new bids and opens the award window for this reverse auction")

                Button(role: .destructive) {
                    confirmCancelJob = true
                } label: {
                    Label("Cancel job", systemImage: "xmark.circle")
                        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                }
                .disabled(isManagingAuction)
                .accessibilityHint("Cancels this job auction and notifies bidders")
            } header: {
                Text("Manage auction").brandSectionHeader()
            } footer: {
                Text("You own this job. Close bidding to award, or cancel if you no longer need the work.")
                    .foregroundStyle(BrandTheme.textSecondary)
            }
        }
    }

    // MARK: - Auction hero (reverse auction)

    @ViewBuilder
    private func auctionHeroSection(_ job: JobDetail) -> some View {
        Section {
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 8) {
                    reverseAuctionBadge
                    Spacer(minLength: 8)
                    if let status = job.status, !status.isEmpty {
                        StatusChipView(
                            label: StatusChipStyle.displayLabel(status),
                            style: StatusChipStyle.forStatus(status)
                        )
                    }
                }

                Text(job.displayTitle)
                    .font(.title2.weight(.semibold))
                    .foregroundStyle(BrandTheme.textPrimary)
                    .fixedSize(horizontal: false, vertical: true)

                // Large price: accepted offer → leading ladder bid → starting bid
                if let priceLabel = heroPriceLabel(for: job) {
                    Text(priceLabel.amount)
                        .font(.system(size: 34, weight: .bold, design: .rounded).monospacedDigit())
                        .foregroundStyle(BrandTheme.goldBright)
                        .accessibilityLabel("\(priceLabel.caption): \(priceLabel.amount)")
                    Text(priceLabel.caption)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(BrandTheme.textSecondary)
                        .textCase(.uppercase)
                }

                (
                    Text("Providers bid ")
                        + Text("down").fontWeight(.semibold)
                        + Text(" — lowest trusted bid can win")
                )
                .font(.subheadline)
                .foregroundStyle(BrandTheme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityLabel("Providers bid down — lowest trusted bid can win")

                if isSealedAuction {
                    Text("Sealed auction — other providers cannot see bid amounts. Only the job owner sees the full ladder.")
                        .font(.caption)
                        .foregroundStyle(BrandTheme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }

                marketIntelligenceStrip(job)

                HStack(spacing: 12) {
                    if job.auctionEndsAt != nil {
                        liveCountdownChip(iso: job.auctionEndsAt)
                    }
                    bidCountChip(job: job)
                }
            }
            .padding(.vertical, 6)
            .accessibilityElement(children: .combine)
        }
    }

    /// Showcase market-range + savings strip (H1.4 / H1.5). Soft-fails; never blocks load.
    @ViewBuilder
    private func marketIntelligenceStrip(_ job: JobDetail) -> some View {
        let range = marketRange ?? Self.fallbackRange(for: job)
        let savingsVsStart = savingsVsStartingLabel(job: job)
        let savingsVsMarket = savingsVsMarketMedianLabel()
        if range != nil || savingsVsStart != nil || savingsVsMarket != nil {
            VStack(alignment: .leading, spacing: 8) {
                if let range {
                    HStack(alignment: .firstTextBaseline) {
                        Text(range.source.titleLabel)
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(BrandTheme.textSecondary)
                            .textCase(.uppercase)
                        Spacer(minLength: 8)
                        Text(range.rangeCaption)
                            .font(.subheadline.weight(.semibold).monospacedDigit())
                            .foregroundStyle(BrandTheme.goldBright)
                            .multilineTextAlignment(.trailing)
                    }
                    .accessibilityElement(children: .combine)
                    .accessibilityLabel("\(range.source.titleLabel) \(range.rangeCaption)")
                }
                if let savingsVsStart {
                    HStack(alignment: .firstTextBaseline) {
                        Text("Est. savings vs starting")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(BrandTheme.textSecondary)
                            .textCase(.uppercase)
                        Spacer(minLength: 8)
                        Text(savingsVsStart)
                            .font(.subheadline.weight(.bold).monospacedDigit())
                            .foregroundStyle(BrandTheme.success)
                    }
                    .accessibilityElement(children: .combine)
                    .accessibilityLabel("Estimated savings versus starting \(savingsVsStart)")
                }
                if let savingsVsMarket {
                    HStack(alignment: .firstTextBaseline) {
                        Text("Est. savings vs market median")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(BrandTheme.textSecondary)
                            .textCase(.uppercase)
                        Spacer(minLength: 8)
                        Text(savingsVsMarket)
                            .font(.subheadline.weight(.bold).monospacedDigit())
                            .foregroundStyle(BrandTheme.success)
                    }
                    .accessibilityElement(children: .combine)
                    .accessibilityLabel("Estimated savings versus market median \(savingsVsMarket)")
                }
            }
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(BrandTheme.surfaceRaised, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .strokeBorder(BrandTheme.gold.opacity(0.2), lineWidth: 1)
            )
        }
    }

    /// Synchronous last-resort band so the strip can still show before async load finishes.
    private static func fallbackRange(for job: JobDetail) -> MarketRangeEstimate? {
        MarketRangeMath.reverseAuctionBand(startingBidCents: job.startingBidCents ?? 0)
    }

    private func savingsVsStartingLabel(job: JobDetail) -> String? {
        guard let start = job.startingBidCents, start > 0 else { return nil }
        guard let leading = leadingBidCents, leading > 0, leading < start else { return nil }
        let saved = start - leading
        let pct = Int((Double(saved) / Double(start) * 100.0).rounded())
        return "\(MoneyFormat.usd(cents: saved)) (\(pct)%)"
    }

    /// Only when FPI is usable — compare leading bid to market median (not category-sample estimate).
    private func savingsVsMarketMedianLabel() -> String? {
        guard let fair = fairPrice, fair.isUsable, let median = fair.priceCents, median > 0 else { return nil }
        guard let leading = leadingBidCents, leading > 0, leading < median else { return nil }
        let saved = median - leading
        let pct = Int((Double(saved) / Double(median) * 100.0).rounded())
        return "\(MoneyFormat.usd(cents: saved)) (\(pct)%)"
    }

    private var isSealedAuction: Bool {
        let t = (detail?.auctionType ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return t == "sealed" || t.isEmpty
    }

    private var isLiveAuctionType: Bool {
        let t = (detail?.auctionType ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return t == "live"
    }

    /// Soft Live feed when the job is live-typed, state endpoint answered, or we have events.
    private var shouldShowLiveFeed: Bool {
        if isLiveAuctionType { return true }
        if liveAuctionStateAvailable { return true }
        return !auctionEvents.isEmpty
    }

    /// Public amounts for live auctions / owners; sealed non-owners only see activity labels.
    private var canShowPublicEventAmounts: Bool {
        if isLiveAuctionType { return true }
        if isJobOwner { return true }
        return !isSealedAuction
    }

    /// Newest-first, capped for a compact soft feed.
    private var displayAuctionEvents: [AuctionEvent] {
        let sorted = auctionEvents.sorted { lhs, rhs in
            let left = CatalogDateFormat.parseISO(lhs.createdAt ?? "") ?? .distantPast
            let right = CatalogDateFormat.parseISO(rhs.createdAt ?? "") ?? .distantPast
            return left > right
        }
        return Array(sorted.prefix(20))
    }

    private var reverseAuctionBadge: some View {
        let active = isAuctionActiveForPolling
        let label: String
        if active, isLiveAuctionType {
            label = "LIVE · reverse auction"
        } else if active, isSealedAuction {
            label = "LIVE · sealed reverse"
        } else if isSealedAuction {
            label = "Sealed reverse auction"
        } else {
            label = active ? "LIVE · reverse auction" : "Reverse auction"
        }
        return HStack(spacing: 6) {
            if active {
                Circle()
                    .fill(BrandTheme.success)
                    .frame(width: 7, height: 7)
                    .accessibilityHidden(true)
            }
            Text(label)
                .font(.caption.weight(.bold))
                .foregroundStyle(BrandTheme.goldBright)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .overlay(
            Capsule()
                .strokeBorder(BrandTheme.gold, lineWidth: 1.5)
        )
        .accessibilityLabel(label)
    }

    @ViewBuilder
    private func liveCountdownChip(iso: String?) -> some View {
        if let iso, !iso.isEmpty, CatalogDateFormat.parseISO(iso) != nil {
            TimelineView(.periodic(from: .now, by: 1)) { context in
                let label = CatalogDateFormat.countdownLabel(iso: iso, now: context.date) ?? "—"
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
    private func bidCountChip(job: JobDetail) -> some View {
        let count = effectiveBidCount(job: job)
        Label("\(count) bid\(count == 1 ? "" : "s")", systemImage: "arrow.down.circle")
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

    private func effectiveBidCount(job: JobDetail) -> Int {
        if case .loaded = ladderState, !bidEntries.isEmpty {
            return bidEntries.count
        }
        return job.bidCount ?? bidEntries.count
    }

    private struct HeroPrice {
        let amount: String
        let caption: String
    }

    private func heroPriceLabel(for job: JobDetail) -> HeroPrice? {
        if let offer = job.offerAcceptedCents {
            return HeroPrice(amount: MoneyFormat.usd(cents: offer), caption: "Accepted offer")
        }
        if let leading = leadingBidCents {
            return HeroPrice(amount: MoneyFormat.usd(cents: leading), caption: "Leading bid (lowest)")
        }
        if let live = liveLowestBidCents, live > 0 {
            return HeroPrice(amount: MoneyFormat.usd(cents: live), caption: "Leading bid (lowest)")
        }
        if let start = job.startingBidCents {
            return HeroPrice(amount: MoneyFormat.usd(cents: start), caption: "Starting bid")
        }
        return nil
    }

    /// Task identity: restart poll loop when job / active flag / foreground changes.
    private var auctionPollIdentity: String {
        "\(jobID)|\(isAuctionActiveForPolling)|\(scenePhase == .active)"
    }

    // MARK: - Bid ladder

    @ViewBuilder
    private func bidLadderSection(_ job: JobDetail) -> some View {
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

            case .needsAuth:
                sealedAuctionArena(job, message: "Sign in as the job owner to open the sealed bid ladder. Providers still place reverse bids in dollars below.")
                publicStatsRow(job)

            case .forbidden:
                sealedAuctionArena(job, message: "This is a sealed reverse auction. Only the job owner sees each provider’s dollar amount. Your bid stays private from other providers.")
                publicStatsRow(job)

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
                    Text("No bids yet — be first to compete")
                        .font(.subheadline)
                        .foregroundStyle(BrandTheme.textSecondary)
                        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                        .accessibilityLabel("No bids yet — be first to compete")
                } else {
                    if bidEntries.count > 1 {
                        Picker("Sort bids", selection: $ladderSort) {
                            ForEach(LadderSort.allCases) { mode in
                                Text(mode.rawValue).tag(mode)
                            }
                        }
                        .pickerStyle(.segmented)
                        .accessibilityLabel("Sort bid ladder by price or trust")
                    }
                    if let awardStatusMessage {
                        Text(awardStatusMessage)
                            .font(.footnote)
                            .foregroundStyle(awardStatusIsError ? BrandTheme.destructive : BrandTheme.success)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    if let withdrawStatusMessage {
                        Text(withdrawStatusMessage)
                            .font(.footnote)
                            .foregroundStyle(withdrawStatusIsError ? BrandTheme.destructive : BrandTheme.success)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    ForEach(Array(sortedLadder.enumerated()), id: \.offset) { index, entry in
                        // Leading badge always reflects reverse-auction price rank (#1 lowest active).
                        let priceRank = priceLeadingRank(of: entry)
                        let isLeading = priceRank == 1
                        bidLadderRow(entry: entry, rank: index + 1, isLeading: isLeading)
                    }
                }
            }
        } header: {
            Text("Auction · bid ladder").brandSectionHeader()
        } footer: {
            if canAward {
                Text("You own this job. Award a bid to create the contract. Sort by Price (lowest wins) or Trust. Leading badge always follows lowest price.")
                    .foregroundStyle(BrandTheme.textSecondary)
            } else {
                Text("Lowest dollar bid leads. Rank follows the selected sort; Leading badge stays on lowest price. Bids are sealed from other providers.")
                    .foregroundStyle(BrandTheme.textSecondary)
            }
        }
    }

    /// 1-based rank by reverse-auction price among non-withdrawn bids (1 = lowest = leading).
    private func priceLeadingRank(of entry: JobBidEntry) -> Int? {
        guard !bidStatusIsWithdrawn(entry) else { return nil }
        let active = bidEntries.filter { !bidStatusIsWithdrawn($0) }
            .sorted {
                let a = $0.bid?.amountCents ?? Int64.max
                let b = $1.bid?.amountCents ?? Int64.max
                return a < b
            }
        guard let idx = active.firstIndex(where: { $0.id == entry.id }) else { return nil }
        return idx + 1
    }

    // MARK: - Soft live feed (HTTP poll, not WebSocket)

    @ViewBuilder
    private var liveFeedSection: some View {
        if shouldShowLiveFeed {
            Section {
                if displayAuctionEvents.isEmpty {
                    Text("No recent bid activity yet.")
                        .font(.footnote)
                        .foregroundStyle(BrandTheme.textSecondary)
                        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                        .accessibilityLabel("No recent bid activity yet")
                } else {
                    ForEach(displayAuctionEvents) { event in
                        liveFeedRow(event)
                    }
                }
            } header: {
                HStack(spacing: 6) {
                    if isAuctionActiveForPolling {
                        Circle()
                            .fill(BrandTheme.success)
                            .frame(width: 6, height: 6)
                            .accessibilityHidden(true)
                    }
                    Text("Live feed").brandSectionHeader()
                }
            } footer: {
                Text(isLiveAuctionType
                    ? "Open floor · refreshes every few seconds while the auction is open."
                    : "Refreshes while the auction is open.")
                    .foregroundStyle(BrandTheme.textSecondary)
            }
        }
    }

    @ViewBuilder
    private func liveFeedRow(_ event: AuctionEvent) -> some View {
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
            if canShowPublicEventAmounts,
               let cents = event.amountCents,
               cents > 0 {
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

    private func liveFeedAccessibilityLabel(_ event: AuctionEvent) -> String {
        var parts: [String] = [event.displayEventLabel]
        if canShowPublicEventAmounts,
           let cents = event.amountCents,
           cents > 0 {
            parts.append(MoneyFormat.usd(cents: cents))
        }
        if let created = event.createdAt, !created.isEmpty {
            parts.append(CatalogDateFormat.friendlyDateTime(created))
        }
        return parts.joined(separator: ", ")
    }

    @ViewBuilder
    private func sealedAuctionArena(_ job: JobDetail, message: String) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                if isAuctionActiveForPolling {
                    Circle()
                        .fill(BrandTheme.success)
                        .frame(width: 8, height: 8)
                    Text("AUCTION LIVE")
                        .font(.caption.weight(.bold))
                        .foregroundStyle(BrandTheme.success)
                } else {
                    Text("AUCTION")
                        .font(.caption.weight(.bold))
                        .foregroundStyle(BrandTheme.goldBright)
                }
                Spacer()
                Text("Sealed · reverse")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(BrandTheme.textSecondary)
            }
            Text(message)
                .font(.footnote)
                .foregroundStyle(BrandTheme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
            if let price = heroPriceLabel(for: job) {
                Text("\(price.caption): \(price.amount)")
                    .font(.subheadline.weight(.semibold).monospacedDigit())
                    .foregroundStyle(BrandTheme.goldBright)
            }
        }
        .padding(.vertical, 4)
        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder
    private func publicStatsRow(_ job: JobDetail) -> some View {
        HStack {
            Text("Bids received")
                .foregroundStyle(BrandTheme.textSecondary)
            Spacer()
            Text("\(effectiveBidCount(job: job))")
                .font(.body.weight(.semibold).monospacedDigit())
                .foregroundStyle(BrandTheme.goldBright)
        }
        .frame(minHeight: 44)
    }

    @ViewBuilder
    private func bidLadderRow(entry: JobBidEntry, rank: Int, isLeading: Bool) -> some View {
        let bidStatus = (entry.bid?.status ?? "").lowercased()
        let alreadyAwarded = bidStatus == "awarded"
        let showAward = canAward
            && !alreadyAwarded
            && entry.bid?.id != nil
            && (detail?.status ?? "").lowercased() != "awarded"
        let showWithdraw = isOwnWithdrawableBid(entry)
        let showLower = showWithdraw

        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .center, spacing: 12) {
                Text("#\(rank)")
                    .font(.caption.weight(.bold).monospacedDigit())
                    .foregroundStyle(isLeading ? BrandTheme.success : BrandTheme.textSecondary)
                    .frame(width: 28, alignment: .leading)

                VStack(alignment: .leading, spacing: 2) {
                    Text(entry.displayName)
                        .font(.body.weight(.medium))
                        .foregroundStyle(BrandTheme.textPrimary)
                        .lineLimit(1)
                    if isOwnBid(entry) {
                        Text("Your bid")
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(BrandTheme.bidActive)
                    }
                }

                Spacer(minLength: 8)

                VStack(alignment: .trailing, spacing: 4) {
                    Text(entry.displayAmount)
                        .font(.body.weight(.bold).monospacedDigit())
                        .foregroundStyle(BrandTheme.goldBright)
                    if alreadyAwarded {
                        Text("Awarded")
                            .font(.caption2.weight(.bold))
                            .foregroundStyle(BrandTheme.success)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 3)
                            .background(BrandTheme.success.opacity(0.15), in: Capsule())
                            .accessibilityLabel("Awarded bid")
                    } else if bidStatus == "withdrawn" {
                        Text("Withdrawn")
                            .font(.caption2.weight(.bold))
                            .foregroundStyle(BrandTheme.textSecondary)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 3)
                            .background(BrandTheme.textSecondary.opacity(0.15), in: Capsule())
                            .accessibilityLabel("Withdrawn bid")
                    } else if isLeading {
                        Text("Leading")
                            .font(.caption2.weight(.bold))
                            .foregroundStyle(BrandTheme.success)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 3)
                            .background(BrandTheme.success.opacity(0.15), in: Capsule())
                            .accessibilityLabel("Leading bid")
                    }
                }
            }
            .accessibilityElement(children: .combine)
            .accessibilityLabel(
                isLeading
                    ? "Rank \(rank), leading, \(entry.displayName), \(entry.displayAmount)"
                    : "Rank \(rank), \(entry.displayName), \(entry.displayAmount)"
            )

            // Outside combined a11y group so VoiceOver can focus the trust breakdown link.
            trustChip(for: entry)
                .padding(.leading, 40)

            if showWithdraw {
                Button(role: .destructive) {
                    Task { await withdrawOwnBid(entry) }
                } label: {
                    if withdrawingBidID == entry.bid?.id {
                        ProgressView()
                            .tint(BrandTheme.destructive)
                            .frame(maxWidth: .infinity, minHeight: 44)
                    } else {
                        Label("Withdraw my bid", systemImage: "arrow.uturn.backward")
                            .frame(maxWidth: .infinity, minHeight: 44)
                    }
                }
                .buttonStyle(.bordered)
                .tint(BrandTheme.destructive)
                .disabled(withdrawingBidID != nil)
                .accessibilityLabel("Withdraw your bid of \(entry.displayAmount)")
            }

            if showAward {
                Button {
                    pendingAwardEntry = entry
                } label: {
                    if isAwarding, pendingAwardEntry?.id == entry.id {
                        ProgressView()
                            .tint(BrandTheme.navy)
                            .frame(maxWidth: .infinity, minHeight: 44)
                    } else {
                        Label(
                            isLeading ? "Award leading bid" : "Award this bid",
                            systemImage: "checkmark.seal"
                        )
                        .frame(maxWidth: .infinity, minHeight: 44)
                    }
                }
                .buttonStyle(.borderedProminent)
                .tint(BrandTheme.accent)
                .disabled(isAwarding)
                .accessibilityLabel(
                    "Award job to \(entry.displayName) for \(entry.displayAmount)"
                )
            }
        }
        .padding(.vertical, 4)
        .frame(minHeight: 44)
        // Keep children uncombined so the trust NavigationLink stays focusable.
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder
    private func trustChip(for entry: JobBidEntry) -> some View {
        if entry.displayTrust == "—" {
            EmptyView()
        } else if let providerId = entry.bid?.providerId?.trimmingCharacters(in: .whitespacesAndNewlines),
                  !providerId.isEmpty
        {
            NavigationLink {
                TrustScoreView(userId: providerId, displayName: entry.displayName)
            } label: {
                HStack(spacing: 4) {
                    Text("Trust · \(entry.displayTrust)")
                        .font(.caption2.weight(.medium))
                        .foregroundStyle(BrandTheme.goldBright)
                    Image(systemName: "chevron.right")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(BrandTheme.textSecondary)
                    Spacer(minLength: 0)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .frame(minHeight: 44)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Trust \(entry.displayTrust)")
            .accessibilityHint("Opens full trust score breakdown for \(entry.displayName)")
        } else {
            Text("Trust · \(entry.displayTrust)")
                .font(.caption2)
                .foregroundStyle(BrandTheme.textSecondary)
        }
    }

    private func isOwnBid(_ entry: JobBidEntry) -> Bool {
        guard let providerId = entry.bid?.providerId?.trimmingCharacters(in: .whitespacesAndNewlines),
              !providerId.isEmpty,
              let uid = currentUserID?.trimmingCharacters(in: .whitespacesAndNewlines),
              !uid.isEmpty
        else {
            return false
        }
        return providerId.caseInsensitiveCompare(uid) == .orderedSame
    }

    private func isOwnWithdrawableBid(_ entry: JobBidEntry) -> Bool {
        guard auth.isAuthenticated, !auth.isScaffoldSession else { return false }
        guard isOwnBid(entry) else { return false }
        guard let bidId = entry.bid?.id, !bidId.isEmpty else { return false }
        let status = (entry.bid?.status ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return status == "active" || status == "open" || status == "pending" || status.isEmpty
    }

    // MARK: - Place / lower bid (providers)

    @ViewBuilder
    private func placeBidSection(_ job: JobDetail) -> some View {
        let isUpdate = hasOwnActiveBid
        Section {
            if !auth.isAuthenticated {
                Text("Sign in as a provider to place a bid on this job.")
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
                if isUpdate, let current = ownActiveBidAmountCents {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Your current bid")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(BrandTheme.bidActive)
                        Text(MoneyFormat.usd(cents: current))
                            .font(.title3.weight(.bold).monospacedDigit())
                            .foregroundStyle(BrandTheme.goldBright)
                        Text("You can only lower your bid, never raise it.")
                            .font(.caption)
                            .foregroundStyle(BrandTheme.textSecondary)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .accessibilityElement(children: .combine)
                }

                Text(bidHint(for: job, isUpdate: isUpdate))
                    .font(.footnote)
                    .foregroundStyle(BrandTheme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)

                DollarAmountField(
                    text: $bidAmountText,
                    placeholder: "0.00",
                    accessibilityLabelText: isUpdate
                        ? "New lower bid amount in dollars"
                        : "Your reverse bid in dollars — lower is better"
                )

                if let bidStatusMessage {
                    Text(bidStatusMessage)
                        .font(.footnote)
                        .foregroundStyle(bidStatusIsError ? BrandTheme.destructive : BrandTheme.success)
                        .fixedSize(horizontal: false, vertical: true)
                }

                Button {
                    Task { await placeOrLowerJobBid() }
                } label: {
                    if isPlacingBid {
                        ProgressView()
                            .tint(BrandTheme.navy)
                            .frame(maxWidth: .infinity, minHeight: 44)
                    } else if let cents = MoneyFormat.cents(fromDollarsText: bidAmountText) {
                        Text(isUpdate
                             ? "Lower bid · \(MoneyFormat.usd(cents: cents))"
                             : "Place reverse bid · \(MoneyFormat.usd(cents: cents))")
                            .frame(maxWidth: .infinity, minHeight: 44)
                    } else {
                        Text(isUpdate ? "Lower bid" : "Place reverse bid")
                            .frame(maxWidth: .infinity, minHeight: 44)
                    }
                }
                .buttonStyle(.borderedProminent)
                .tint(BrandTheme.accent)
                .disabled(isPlacingBid || MoneyFormat.cents(fromDollarsText: bidAmountText) == nil)
                .accessibilityHint(
                    isUpdate
                        ? "Submit a lower dollar amount for your existing bid"
                        : "Submit a lower dollar bid to compete in this reverse auction"
                )
            }
        } header: {
            Text(isUpdate ? "Lower your bid (dollars)" : "Place a bid (dollars)").brandSectionHeader()
        } footer: {
            Text(
                isUpdate
                    ? "Reverse auction rule: new amount must be strictly below your current bid. Server rejects raises."
                    : "Services are reverse auctions — enter dollars (for example 350.00), not cents. Lower than the leading bid wins. Provider role required."
            )
            .foregroundStyle(BrandTheme.textSecondary)
        }
    }

    /// Instant-accept at the customer's `offer_accepted_cents` (FR-4.4).
    /// Shown only when the job has an offer price and the provider has no active bid yet.
    @ViewBuilder
    private func acceptOfferSection(_ job: JobDetail) -> some View {
        // Web BidForm parity: offerAcceptedCents && !existingBid; auth provider session required.
        if let offerCents = job.offerAcceptedCents,
           offerCents > 0,
           !hasOwnActiveBid,
           auth.isAuthenticated,
           !auth.isScaffoldSession
        {
            Section {
                VStack(alignment: .leading, spacing: 10) {
                    HStack(spacing: 8) {
                        Image(systemName: "bolt.fill")
                            .foregroundStyle(BrandTheme.success)
                        Text("Instant accept")
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(BrandTheme.success)
                    }
                    Text("Accept this job at the customer’s instant price of \(MoneyFormat.usd(cents: offerCents)). This places a bid at that amount.")
                        .font(.footnote)
                        .foregroundStyle(BrandTheme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)

                    if let acceptOfferMessage {
                        Text(acceptOfferMessage)
                            .font(.footnote)
                            .foregroundStyle(acceptOfferIsError ? BrandTheme.destructive : BrandTheme.success)
                            .fixedSize(horizontal: false, vertical: true)
                    }

                    Button {
                        confirmAcceptOffer = true
                    } label: {
                        if isAcceptingOffer {
                            ProgressView()
                                .tint(BrandTheme.navy)
                                .frame(maxWidth: .infinity, minHeight: 44)
                        } else {
                            Label(
                                "Accept offer · \(MoneyFormat.usd(cents: offerCents))",
                                systemImage: "bolt.fill"
                            )
                            .frame(maxWidth: .infinity, minHeight: 44)
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(BrandTheme.success)
                    .disabled(isAcceptingOffer || isPlacingBid)
                    .accessibilityLabel("Accept offer at \(MoneyFormat.usd(cents: offerCents))")
                    .accessibilityHint("Places a bid at the customer’s instant-accept price")
                }
                .padding(.vertical, 4)
            } header: {
                Text("Offer accepted price").brandSectionHeader()
            } footer: {
                Text("Creates a bid at the offer price. The customer still awards a bid to form a contract.")
                    .foregroundStyle(BrandTheme.textSecondary)
            }
        }
    }

    private func bidHint(for job: JobDetail, isUpdate: Bool) -> String {
        if isUpdate, let current = ownActiveBidAmountCents {
            return "Enter a dollar amount strictly below your current bid (\(MoneyFormat.usd(cents: current))). Example: if your bid is $450, try 425.00."
        }
        if let leading = leadingBidCents {
            return "Reverse auction: enter a lower dollar amount than the leading bid (\(MoneyFormat.usd(cents: leading))). Example: if leading is $450, try 425.00."
        }
        if let start = job.startingBidCents {
            return "Reverse auction: enter a competitive dollar bid at or below the starting bid (\(MoneyFormat.usd(cents: start))). Example: 400.00 — not 40000."
        }
        if let price = job.displayPrice {
            return "Reverse auction: enter your bid in dollars (e.g. 125.00). Current price \(price) — lower competes to win."
        }
        return "Reverse auction: enter your bid in dollars (e.g. 125.00), not cents. Lower bids compete. Provider accounts only."
    }

    // MARK: - Details (below auction chrome)

    @ViewBuilder
    private func detailsSection(_ job: JobDetail) -> some View {
        Section {
            if let status = job.status {
                LabeledContent("Status") {
                    Text(StatusChipStyle.displayLabel(status))
                }
            }
            if let category = job.categoryName, !category.isEmpty {
                LabeledContent("Category", value: category)
            }
            if let schedule = job.scheduleType, !schedule.isEmpty {
                LabeledContent("Schedule") {
                    Text(schedule.replacingOccurrences(of: "_", with: " ").capitalized)
                }
            }
            // Party-only exact street (owner / awarded provider). Public viewers
            // only ever see approximate city/state — never invent street from area.
            if let exact = job.exactLocationLabel {
                LabeledContent("Service address") {
                    Text(exact)
                        .foregroundStyle(BrandTheme.textPrimary)
                        .multilineTextAlignment(.trailing)
                        .textSelection(.enabled)
                }
                .accessibilityLabel("Service address \(exact)")
            } else if let location = job.locationLabel {
                LabeledContent("Area", value: location)
            }
            if let ends = job.auctionEndsAt, !ends.isEmpty {
                LabeledContent("Auction ends", value: CatalogDateFormat.friendlyDateTime(ends))
            }
            if let bids = job.bidCount {
                LabeledContent("Bids", value: "\(bids)")
            }
            if let recurring = job.isRecurring, recurring {
                LabeledContent("Recurring", value: "Yes")
            }
            if job.canOfferDirections, let exact = job.exactLocationLabel {
                Button {
                    DirectionsHelper.openDirections(
                        address: exact,
                        openURL: { openURL($0) }
                    )
                } label: {
                    Label("Get Directions", systemImage: "arrow.triangle.turn.up.right.diamond.fill")
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .frame(minHeight: 44)
                }
                .tint(BrandTheme.accent)
                .accessibilityHint("Opens Apple Maps or Google Maps with the service address")
            }
        } header: {
            Text("Details").brandSectionHeader()
        } footer: {
            if job.canOfferDirections {
                Text("Exact address is only shown to you as the job owner or awarded provider.")
                    .foregroundStyle(BrandTheme.textSecondary)
            }
        }
    }

    // MARK: - Actions

    @MainActor
    private func placeOrLowerJobBid() async {
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
                "Enter a valid dollar amount (for example 75.00). Do not enter cents — $75 is 75, not 7500."
            return
        }

        // FR-4.3: existing active bid → PATCH lower only.
        if let bidId = ownActiveBidId {
            if let current = ownActiveBidAmountCents,
               let err = BidAmountRules.validateLowerOnly(currentCents: current, newCents: cents)
            {
                bidStatusIsError = true
                bidStatusMessage = err
                return
            }
            isPlacingBid = true
            defer { isPlacingBid = false }
            do {
                _ = try await APIClient.shared.updateJobBid(id: bidId, newAmountCents: cents)
                bidStatusIsError = false
                bidStatusMessage = "Bid lowered to \(MoneyFormat.usd(cents: cents))."
                bidAmountText = ""
                if let own = ownActiveServiceBid {
                    ownActiveServiceBid = own.markedLowered(to: cents)
                }
                await load()
            } catch let error as APIClientError where error.isUnauthorized {
                bidStatusIsError = true
                bidStatusMessage = "Sign in required. Your session is missing or expired — please sign in again."
            } catch {
                bidStatusIsError = true
                bidStatusMessage = error.localizedDescription
            }
            return
        }

        if let leading = leadingBidCents, cents >= leading {
            bidStatusIsError = true
            bidStatusMessage =
                "Reverse auction: bid below the leading \(MoneyFormat.usd(cents: leading)) to take the lead."
            return
        }

        isPlacingBid = true
        defer { isPlacingBid = false }

        do {
            _ = try await APIClient.shared.placeJobBid(jobId: jobID, amountCents: cents)
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
    private func acceptOfferPrice() async {
        acceptOfferMessage = nil
        acceptOfferIsError = false
        guard !auth.isScaffoldSession, auth.isAuthenticated else {
            acceptOfferIsError = true
            acceptOfferMessage = "Sign in as a provider to accept this offer."
            return
        }
        guard let offerCents = detail?.offerAcceptedCents, offerCents > 0 else {
            acceptOfferIsError = true
            acceptOfferMessage = "This job has no instant-accept price."
            return
        }
        guard !hasOwnActiveBid else {
            acceptOfferIsError = true
            acceptOfferMessage = "You already have an active bid. Lower it instead of accepting the offer."
            return
        }
        guard !isAcceptingOffer else { return }

        isAcceptingOffer = true
        defer { isAcceptingOffer = false }

        do {
            let bid = try await APIClient.shared.acceptJobOffer(jobId: jobID)
            acceptOfferIsError = false
            let amount = bid.amountCents ?? offerCents
            acceptOfferMessage = "Offer accepted at \(MoneyFormat.usd(cents: amount))."
            if let id = bid.id, !id.isEmpty {
                ownActiveServiceBid = MyJobBidRow(
                    id: id,
                    jobId: bid.jobId ?? jobID,
                    providerId: bid.providerId,
                    amountCents: amount,
                    status: bid.status ?? "active",
                    isOfferAccepted: true,
                    createdAt: bid.createdAt
                )
            }
            await load()
        } catch let error as APIClientError where error.isUnauthorized {
            acceptOfferIsError = true
            acceptOfferMessage = "Sign in required. Your session is missing or expired — please sign in again."
        } catch {
            acceptOfferIsError = true
            acceptOfferMessage = error.localizedDescription
        }
    }

    @MainActor
    private func closeBidding() async {
        manageAuctionMessage = nil
        manageAuctionIsError = false
        guard !auth.isScaffoldSession else {
            manageAuctionIsError = true
            manageAuctionMessage =
                "Browse-only mode has no API credentials. Sign in against a live gateway to close bidding."
            return
        }
        isManagingAuction = true
        defer { isManagingAuction = false }
        do {
            try await APIClient.shared.closeJob(id: jobID)
            manageAuctionIsError = false
            manageAuctionMessage = "Bidding closed. You can award a bid from the ladder."
            await load()
        } catch let error as APIClientError where error.isUnauthorized {
            manageAuctionIsError = true
            manageAuctionMessage = "Sign in required. Your session is missing or expired — please sign in again."
        } catch {
            manageAuctionIsError = true
            manageAuctionMessage = error.localizedDescription
        }
    }

    @MainActor
    private func cancelOwnedJob() async {
        manageAuctionMessage = nil
        manageAuctionIsError = false
        guard !auth.isScaffoldSession else {
            manageAuctionIsError = true
            manageAuctionMessage =
                "Browse-only mode has no API credentials. Sign in against a live gateway to cancel this job."
            return
        }
        isManagingAuction = true
        defer { isManagingAuction = false }
        do {
            try await APIClient.shared.cancelJob(id: jobID)
            manageAuctionIsError = false
            manageAuctionMessage = "Job cancelled."
            await load()
        } catch let error as APIClientError where error.isUnauthorized {
            manageAuctionIsError = true
            manageAuctionMessage = "Sign in required. Your session is missing or expired — please sign in again."
        } catch {
            manageAuctionIsError = true
            manageAuctionMessage = error.localizedDescription
        }
    }

    @MainActor
    private func awardBid(_ entry: JobBidEntry) async {
        awardStatusMessage = nil
        awardStatusIsError = false
        guard let bidId = entry.bid?.id, !bidId.isEmpty else {
            awardStatusIsError = true
            awardStatusMessage = "This bid has no id and cannot be awarded."
            pendingAwardEntry = nil
            return
        }
        guard !auth.isScaffoldSession else {
            awardStatusIsError = true
            awardStatusMessage =
                "Browse-only mode has no API credentials. Sign in against a live gateway to award bids."
            pendingAwardEntry = nil
            return
        }

        isAwarding = true
        defer {
            isAwarding = false
            pendingAwardEntry = nil
        }

        do {
            _ = try await APIClient.shared.awardJobBid(jobId: jobID, bidId: bidId)
            awardStatusIsError = false
            awardStatusMessage =
                "Awarded \(entry.displayAmount) to \(entry.displayName). Contract creation continues on the server."
            await load()
        } catch let error as APIClientError where error.isUnauthorized {
            awardStatusIsError = true
            awardStatusMessage = "Sign in required. Your session is missing or expired — please sign in again."
        } catch {
            awardStatusIsError = true
            awardStatusMessage = error.localizedDescription
        }
    }

    @MainActor
    private func withdrawOwnBid(_ entry: JobBidEntry) async {
        withdrawStatusMessage = nil
        withdrawStatusIsError = false
        guard let bidId = entry.bid?.id, !bidId.isEmpty else {
            withdrawStatusIsError = true
            withdrawStatusMessage = "This bid has no id and cannot be withdrawn."
            return
        }
        guard isOwnWithdrawableBid(entry) else {
            withdrawStatusIsError = true
            withdrawStatusMessage = "Only your active bids can be withdrawn."
            return
        }
        guard withdrawingBidID == nil else { return }

        withdrawingBidID = bidId
        defer { withdrawingBidID = nil }

        do {
            try await APIClient.shared.withdrawJobBid(id: bidId)
            withdrawStatusIsError = false
            withdrawStatusMessage = "Bid withdrawn: \(entry.displayAmount)."
            // Optimistic local status so the button disappears immediately.
            if let idx = bidEntries.firstIndex(where: { $0.bid?.id == bidId }) {
                var updated = bidEntries[idx]
                var core = updated.bid
                core?.status = "withdrawn"
                updated.bid = core
                bidEntries[idx] = updated
            }
            await load()
        } catch let error as APIClientError where error.isUnauthorized {
            withdrawStatusIsError = true
            withdrawStatusMessage = "Sign in required. Your session is missing or expired — please sign in again."
        } catch {
            withdrawStatusIsError = true
            withdrawStatusMessage = error.localizedDescription
        }
    }

    @MainActor
    private func load() async {
        isLoading = detail == nil
        errorMessage = nil
        defer { isLoading = false }

        if auth.isAuthenticated, !auth.isScaffoldSession {
            currentUserID = await APIClient.shared.currentUserID()
        } else {
            currentUserID = nil
        }

        do {
            detail = try await APIClient.shared.fetchJob(id: jobID)
        } catch {
            if detail == nil {
                errorMessage = error.localizedDescription
            }
        }

        await loadBids()
        await loadOwnActiveServiceBid()
        // Soft live-state + events refresh (ignore failures / 404).
        await refreshLiveAuctionState()
        await refreshLiveAuctionEvents()
        await loadMarketIntelligence()
    }

    /// Resolve the signed-in provider's active bid on this job.
    /// Ladder is job-owner-only (403 for other providers), so fall back to `GET /bids/mine`.
    @MainActor
    private func loadOwnActiveServiceBid() async {
        guard auth.isAuthenticated, !auth.isScaffoldSession else {
            ownActiveServiceBid = nil
            return
        }

        // Prefer ladder row when we can see our own bid (owner who also bid, or non-sealed).
        if let entry = bidEntries.first(where: { isOwnWithdrawableBid($0) }),
           let id = entry.bid?.id, !id.isEmpty
        {
            ownActiveServiceBid = MyJobBidRow(
                id: id,
                jobId: entry.bid?.jobId ?? jobID,
                providerId: entry.bid?.providerId,
                amountCents: entry.bid?.amountCents,
                status: entry.bid?.status ?? "active",
                isOfferAccepted: entry.bid?.isOfferAccepted,
                createdAt: entry.bid?.createdAt
            )
            return
        }

        do {
            let response = try await APIClient.shared.fetchMyJobBids(page: 1, pageSize: 50)
            ownActiveServiceBid = response.bids.first { bid in
                guard bid.isLowerable else { return false }
                let jid = (bid.jobId ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
                return jid.caseInsensitiveCompare(jobID) == .orderedSame
            }
        } catch {
            // Soft-fail: keep previous own bid if load fails (offline / 5xx).
        }
    }

    /// Soft market-range for the intelligence strip (H1.4 / H1.5). Never throws / never blocks hero.
    /// Hierarchy: FPI p25–p75 → client category starting-bid sample → reverse-auction 60–100% band.
    @MainActor
    private func loadMarketIntelligence() async {
        let categoryId = detail?.categoryId?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let starting = detail?.startingBidCents ?? 0

        // (a) Fair-price index when the engine has data.
        if !categoryId.isEmpty {
            do {
                let price = try await APIClient.shared.fetchFairPrice(categoryId: categoryId, side: 1)
                if let estimate = MarketRangeMath.fromFairPrice(price) {
                    fairPrice = price
                    marketRange = estimate
                    return
                }
                fairPrice = nil
            } catch {
                fairPrice = nil
            }
        } else {
            fairPrice = nil
        }

        // (b) Category sample: p25–p75 of recent public jobs' starting bids (max 20).
        if !categoryId.isEmpty {
            if let sample = await loadCategorySampleRange(categoryId: categoryId) {
                marketRange = sample
                return
            }
        }

        // (c) Documented reverse-auction band from this job's starting bid.
        marketRange = MarketRangeMath.reverseAuctionBand(startingBidCents: starting)
    }

    /// Public jobs in the same category → client-side p25/p75 of starting bids (honest estimate).
    @MainActor
    private func loadCategorySampleRange(categoryId: String) async -> MarketRangeEstimate? {
        do {
            let response = try await APIClient.shared.fetchJobs(
                page: 1,
                pageSize: 20,
                categoryIds: [categoryId]
            )
            // Include this job's starting bid — it is a public category anchor.
            let bids: [Int64] = response.jobs.compactMap { job in
                // Prefer server filter; still match client-side if the API returns broader results.
                if let jobCat = job.categoryId?.trimmingCharacters(in: .whitespacesAndNewlines),
                   !jobCat.isEmpty,
                   jobCat.caseInsensitiveCompare(categoryId) != .orderedSame
                {
                    return nil
                }
                guard let cents = job.startingBidCents, cents > 0 else { return nil }
                return cents
            }
            return MarketRangeMath.fromCategoryStartingBids(bids, maxSample: 20)
        } catch {
            return nil
        }
    }

    @MainActor
    private func loadBids() async {
        if !auth.isAuthenticated {
            ladderState = .needsAuth
            bidEntries = []
            return
        }
        if auth.isScaffoldSession {
            ladderState = .needsAuth
            bidEntries = []
            return
        }

        ladderState = .loading
        do {
            let response = try await APIClient.shared.fetchJobBids(jobId: jobID)
            bidEntries = response.bids
            ladderState = .loaded
        } catch let error as APIClientError where error.isUnauthorized {
            bidEntries = []
            ladderState = .needsAuth
        } catch let error as APIClientError where error.isForbidden {
            bidEntries = []
            ladderState = .forbidden
        } catch {
            bidEntries = []
            ladderState = .failed(error.localizedDescription)
        }
    }

    /// Polls live auction state + events while the scene is active and the auction is open.
    /// Open-floor (`auction_type=live`) polls every 3s; sealed/active polls every 10s.
    /// Decode/network failures are ignored (endpoints may be feature-gated → 404).
    private func pollLiveAuctionStateLoop() async {
        // Always try once so a live job surfaces the arena even if status parsing lags.
        await refreshLiveAuctionState()
        await refreshLiveAuctionEvents()
        guard scenePhase == .active else { return }
        while !Task.isCancelled {
            let interval: UInt64 = (isLiveAuctionType || liveAuctionStateAvailable)
                ? 3_000_000_000
                : 10_000_000_000
            do {
                try await Task.sleep(nanoseconds: interval)
            } catch {
                return
            }
            guard !Task.isCancelled else { return }
            guard scenePhase == .active else { return }
            // Keep polling while open, or while live type (re-check after close still ok soft-fail).
            if !isAuctionActiveForPolling && !isLiveAuctionType { return }
            await refreshLiveAuctionState()
            await refreshLiveAuctionEvents()
        }
    }

    /// Re-loads the owner bid ladder every 10s so the auction book feels live.
    private func pollBidLadderLoop() async {
        guard scenePhase == .active else { return }
        guard auth.isAuthenticated, !auth.isScaffoldSession else { return }
        while !Task.isCancelled {
            do {
                try await Task.sleep(nanoseconds: 10_000_000_000)
            } catch {
                return
            }
            guard !Task.isCancelled else { return }
            guard scenePhase == .active else { return }
            await loadBids()
        }
    }

    @MainActor
    private func refreshLiveAuctionState() async {
        // Always attempt for live-typed jobs; for others only while auction is open.
        if !isLiveAuctionType && !isAuctionActiveForPolling { return }
        do {
            let state = try await APIClient.shared.fetchJobAuctionState(jobId: jobID)
            applyLiveAuctionState(state)
        } catch {
            // Optional endpoint — ignore 404 / decode / network failures.
        }
    }

    @MainActor
    private func refreshLiveAuctionEvents() async {
        if !isLiveAuctionType && !isAuctionActiveForPolling && !liveAuctionStateAvailable { return }
        do {
            let events = try await APIClient.shared.fetchJobAuctionEvents(jobId: jobID)
            auctionEvents = events
        } catch {
            // Optional endpoint — soft-fail 404 / decode / network; keep last good feed.
        }
    }

    @MainActor
    private func applyLiveAuctionState(_ state: LiveAuctionState) {
        liveAuctionStateAvailable = true
        if let lowest = state.lowestBidCents, lowest > 0 {
            liveLowestBidCents = lowest
        }
        if var job = detail {
            if let count = state.bidCount {
                job.bidCount = count
            }
            if let ends = state.auctionEndsAt, !ends.isEmpty {
                job.auctionEndsAt = ends
            }
            detail = job
        }
        // Seed the soft feed from state when events poll is empty / lagged.
        if let recent = state.recentEvents, !recent.isEmpty, auctionEvents.isEmpty {
            auctionEvents = recent
        }
    }
}

// MARK: - Ladder load state

private enum BidLadderState: Equatable {
    case idle
    case loading
    case loaded
    case needsAuth
    case forbidden
    case failed(String)
}

#Preview {
    NavigationStack {
        JobDetailView(
            jobID: "00000000-0000-0000-0000-000000000002",
            preview: JobSummary(
                id: "00000000-0000-0000-0000-000000000002",
                customerId: nil,
                title: "Lawn mowing — front yard",
                description: "Weekly cut preferred.",
                status: "open",
                scheduleType: "flexible",
                isRecurring: false,
                auctionDurationHours: nil,
                bidCount: 2,
                repostCount: nil,
                categoryId: nil,
                categoryName: "Lawn care",
                categorySlug: nil,
                approximateAddress: JobApproximateAddress(city: "Austin", state: "TX", zipCode: nil),
                startingBidCents: 7500,
                offerAcceptedCents: nil,
                auctionEndsAt: "2026-07-27T18:00:00Z",
                auctionType: nil,
                createdAt: nil,
                photoUrls: nil
            )
        )
        .environmentObject(AuthViewModel())
    }
}
