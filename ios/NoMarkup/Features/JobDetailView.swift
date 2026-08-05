import AppIntents
import CoreSpotlight
import SwiftUI
import UniformTypeIdentifiers

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

    /// FR-4.6: ladder sort — price (default reverse-auction lead), trust, rating, jobs completed.
    private enum LadderSort: String, CaseIterable, Identifiable {
        case price = "Price"
        case trust = "Trust"
        case rating = "Rating"
        case volume = "Jobs"
        var id: String { rawValue }
    }

    /// FR-4.7: optional filters applied client-side on the loaded ladder.
    private enum LadderTrustFilter: String, CaseIterable, Identifiable {
        case any = "Any trust"
        case bronze = "Bronze+"
        case silver = "Silver+"
        case gold = "Gold+"
        var id: String { rawValue }

        var minNormalized: Double {
            switch self {
            case .any: return -1
            case .bronze: return 0.25
            case .silver: return 0.50
            case .gold: return 0.75
            }
        }
    }

    @State private var ladderSort: LadderSort = .price
    @State private var ladderTrustFilter: LadderTrustFilter = .any
    @State private var ladderMinJobsCompleted = 0
    @State private var showLadderFilters = false

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

    /// FR-3.5 / FR-3.10: owner repost of closed / cancelled / expired / zero-bid jobs.
    @State private var isReposting = false
    @State private var repostMessage: String?
    @State private var repostIsError = false
    @State private var confirmRepost = false
    @State private var repostedRoute: JobRepostRoute?

    /// Owner re-request Instant match on an open job with accept-now price (web JobDetailClient parity).
    @State private var isRequestingInstantMatch = false
    @State private var instantMatchMessage: String?
    @State private var instantMatchIsError = false

    /// Soft live-auction overlay (lowest bid / ends-at) from optional poll / WS.
    @State private var liveLowestBidCents: Int64?
    /// Increments when leading bid amount changes — drives `brandMoneyFlash` + light haptic.
    @State private var leadingFlashToken = 0
    @State private var lastFlashedLeadingCents: Int64?
    /// True once `GET …/auction/state` succeeds (feature on + live job).
    @State private var liveAuctionStateAvailable = false
    /// Recent activity from WS frames and/or HTTP poll of `GET …/auction/events`.
    @State private var auctionEvents: [AuctionEvent] = []
    /// Authed auction floor WebSocket (`GET /ws/auction/{jobId}`); HTTP poll is fallback.
    @StateObject private var auctionSocket = AuctionWebSocketClient()
    /// Public delayed spectator stream (`GET /ws/auction/{jobId}/spectate`) for
    /// logged-out and non-participant viewers. No JWT; PII stripped server-side.
    @StateObject private var spectatorSocket = SpectatorWebSocketClient()
    /// Concurrent public spectators from WS `spectator_count` (shown when spectating).
    @State private var liveSpectatorCount: Int = 0
    /// Throttle ladder refetch when WS bid frames arrive in a burst.
    @State private var lastLadderInvalidateAt: Date = .distantPast

    /// FR-8.1 — open pre-bid inquiry channel (POST /channels channel_type=inquiry).
    @State private var isOpeningInquiry = false
    @State private var inquiryError: String?
    @State private var inquiryChannel: ChatChannelSummary?

    /// Showcase H1.4/H1.5 — FPI when usable (median savings); soft-fail otherwise.
    @State private var fairPrice: FairPriceResponse?
    /// Resolved band: market/range → FPI → category sample → reverse-auction 60–100% estimate.
    @State private var marketRange: MarketRangeEstimate?
    /// FR-11 API-backed band for `MarketRangeBar` only (hidden when no real index data).
    @State private var apiMarketRange: MarketRangeResponse?

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

    // MARK: - Spotlight donation (IOS-INT.2, donation half)

    /// `NSUserActivity` type donated when the user views a job.
    private static let viewJobActivityType = "com.nomarkup.app.viewJob"

    /// On-device Spotlight summary — public-safe fields only (category + area label).
    private var spotlightDescription: String {
        var parts = ["Reverse-auction service job on NoMarkup"]
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
        let title = detail?.displayTitle ?? preview?.title ?? "Service auction"
        activity.title = title
        activity.isEligibleForSearch = true
        activity.persistentIdentifier = jobID
        activity.webpageURL = webJobURL
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
            activity.appEntityIdentifier = EntityIdentifier(for: JobEntity.self, identifier: jobID)
        }
    }

    /// Reverse auction ladder. Default: lowest amount first (rank #1 leading).
    /// FR-4.6 sort + FR-4.7 filters. Withdrawn bids always last.
    private var sortedLadder: [JobBidEntry] {
        filteredLadder.sorted { lhs, rhs in
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
                let a = lhs.bid?.amountCents ?? Int64.max
                let b = rhs.bid?.amountCents ?? Int64.max
                if a != b { return a < b }
                return lhs.displayName.localizedCaseInsensitiveCompare(rhs.displayName) == .orderedAscending
            case .rating:
                let ra = ratingSortKey(lhs)
                let rb = ratingSortKey(rhs)
                if ra != rb { return ra > rb }
                let a = lhs.bid?.amountCents ?? Int64.max
                let b = rhs.bid?.amountCents ?? Int64.max
                if a != b { return a < b }
                return lhs.displayName.localizedCaseInsensitiveCompare(rhs.displayName) == .orderedAscending
            case .volume:
                let ja = lhs.jobsCompleted ?? -1
                let jb = rhs.jobsCompleted ?? -1
                if ja != jb { return ja > jb }
                let a = lhs.bid?.amountCents ?? Int64.max
                let b = rhs.bid?.amountCents ?? Int64.max
                if a != b { return a < b }
                return lhs.displayName.localizedCaseInsensitiveCompare(rhs.displayName) == .orderedAscending
            }
        }
    }

    /// FR-4.7 client-side filters (min trust band + min jobs completed).
    private var filteredLadder: [JobBidEntry] {
        bidEntries.filter { entry in
            if bidStatusIsWithdrawn(entry) { return true }
            if ladderMinJobsCompleted > 0 {
                let jobs = entry.jobsCompleted ?? 0
                if jobs < ladderMinJobsCompleted { return false }
            }
            if ladderTrustFilter != .any {
                let trust = trustSortKey(entry)
                if trust < ladderTrustFilter.minNormalized { return false }
            }
            return true
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

    /// Star rating (0…5) for sort; missing → -1.
    private func ratingSortKey(_ entry: JobBidEntry) -> Double {
        entry.averageRating ?? -1
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

    /// Owner can request Instant match on an active/open job when accept-now price is set.
    /// Mirrors web `canRequestInstantMatch` (POST `/jobs/{id}/instant-match` requires `offer_accepted_cents`).
    /// Security: owner only (`currentUserID == customerId`), authenticated, not scaffold.
    private var canRequestInstantMatch: Bool {
        guard isJobOwner, auth.isAuthenticated, !auth.isScaffoldSession else { return false }
        let status = (detail?.status ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        switch status {
        case "active", "open":
            break
        default:
            return false
        }
        guard let offer = detail?.offerAcceptedCents, offer > 0 else { return false }
        return true
    }

    /// Owner can repost when the original auction is finished without an award (FR-3.5 / FR-3.10).
    /// Matches job service: closed | closed_zero_bids | expired | cancelled.
    private var canRepost: Bool {
        guard isJobOwner, auth.isAuthenticated, !auth.isScaffoldSession else { return false }
        let status = (detail?.status ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        switch status {
        case "closed", "closed_zero_bids", "expired", "cancelled":
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

    /// FR-8.1 — providers (not the job owner) on an open auction can see "Ask a question".
    ///
    /// Backend reality (do not invent success):
    /// - Chat `CreateChannel` requires an **active bid** for `pre_award` (`ErrNoBidForChat`).
    /// - Gateway does **not** expose `POST /api/v1/channels` or any pre-bid inquiry / chat-request route
    ///   (route-map is aspirational; live router only lists/gets channels + messages).
    /// Honest CTA: explain that messaging requires placing a bid (or open Messages after a bid).
    private var canShowAskQuestion: Bool {
        guard auth.isAuthenticated, !auth.isScaffoldSession else { return false }
        guard !isJobOwner else { return false }
        let status = (detail?.status ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        switch status {
        case "active", "open", "bidding":
            return true
        default:
            return false
        }
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
        .brandNavigationBarChrome()
        .task { await load() }
        .task(id: auctionPollIdentity) {
            await pollLiveAuctionStateLoop()
        }
        .task(id: auctionSocketIdentity) {
            await runAuctionSocketLifecycle()
        }
        .task(id: spectatorSocketIdentity) {
            await runSpectatorSocketLifecycle()
        }
        .task(id: "\(jobID)|ladder|\(scenePhase == .active)") {
            await pollBidLadderLoop()
        }
        .onChange(of: scenePhase) { _, phase in
            handleScenePhaseChange(phase)
        }
        .onDisappear {
            teardownAuctionSockets()
        }
        .refreshable { await load() }
        // IOS-INT.2 — donate the viewed job to Spotlight (deep-linkable via the web URL).
        .userActivity(Self.viewJobActivityType, isActive: detail != nil) { activity in
            configureViewActivity(activity)
        }
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
            "Repost this job?",
            isPresented: $confirmRepost,
            titleVisibility: .visible
        ) {
            Button("Repost auction") {
                Task { await repostOwnedJob() }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text(
                "Creates a new reverse auction with the same details. Previous bids do not carry over. You can edit the new job after it is posted."
            )
        }
        .navigationDestination(item: $repostedRoute) { route in
            JobDetailView(jobID: route.id, preview: nil)
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
        .alert("Couldn’t open chat", isPresented: Binding(
            get: { inquiryError != nil },
            set: { if !$0 { inquiryError = nil } }
        )) {
            Button("OK", role: .cancel) { inquiryError = nil }
        } message: {
            Text(inquiryError ?? "Unknown error")
        }
        .navigationDestination(item: $inquiryChannel) { channel in
            ChatThreadView(channel: channel)
        }
    }

    // MARK: - FR-8.1 Ask a question (pre-bid inquiry channel)

    @ViewBuilder
    private var askQuestionSection: some View {
        if canShowAskQuestion {
            Section {
                Button {
                    Task { await openInquiryChannel() }
                } label: {
                    Label {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Ask a question")
                                .font(.body.weight(.semibold))
                                .foregroundStyle(BrandTheme.textPrimary)
                            Text("Opens a private pre-bid inquiry with the customer")
                                .font(.caption)
                                .foregroundStyle(BrandTheme.textSecondary)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    } icon: {
                        if isOpeningInquiry {
                            ProgressView()
                                .tint(BrandTheme.accent)
                        } else {
                            Image(systemName: "bubble.left.and.bubble.right")
                                .foregroundStyle(BrandTheme.accent)
                        }
                    }
                    .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(isOpeningInquiry)
                .listRowBackground(BrandTheme.navyElevated)
                .accessibilityLabel("Ask a question")
                .accessibilityHint("Opens a pre-bid chat channel with the job owner")
            } header: {
                Text("Questions").brandSectionHeader()
            } footer: {
                Text(
                    "Pre-bid inquiries don’t require a bid. Keep questions professional — contact info is still filtered until you explicitly share it."
                )
                .foregroundStyle(BrandTheme.textSecondary)
            }
        }
    }

    @MainActor
    private func openInquiryChannel() async {
        inquiryError = nil
        isOpeningInquiry = true
        defer { isOpeningInquiry = false }
        do {
            let type = hasOwnActiveBid ? "bid" : "inquiry"
            inquiryChannel = try await APIClient.shared.createChatChannel(jobId: jobID, channelType: type)
        } catch let error as APIClientError {
            inquiryError = error.localizedDescription
        } catch {
            inquiryError = error.localizedDescription
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
            askQuestionSection
            placeBidSection(job)
            acceptOfferSection(job)
            bidLadderSection(job)
            liveFeedSection
            requestInstantMatchSection
            manageAuctionSection
            repostSection
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

    /// Public reverse auction floor — showcase auction-widget chrome (header → meta → market → lead → footer).
    @ViewBuilder
    private func liveReverseAuctionArena(_ job: JobDetail) -> some View {
        Section {
            ShowcaseAuctionCard {
                ShowcaseAuctionHeader(endsAtISO: job.auctionEndsAt, liveLabel: "LIVE AUCTION")

                ShowcaseAuctionJobMeta(
                    categoryLine: job.categoryName,
                    title: job.displayTitle,
                    locationLine: job.locationLabel
                )

                if let range = marketRange ?? Self.fallbackRange(for: job) {
                    ShowcaseMarketRangeStrip(
                        sourceLabel: range.source.titleLabel,
                        rangeCaption: range.rangeCaption,
                        sampleNote: range.sampleCount > 0 ? "\(range.sampleCount) data pts" : nil
                    )
                }

                VStack(alignment: .leading, spacing: 4) {
                    Text(arenaLeadingLabel)
                        .font(.caption2.weight(.heavy).monospaced())
                        .tracking(1.0)
                        .foregroundStyle(BrandTheme.textSecondary)
                        .textCase(.uppercase)
                    Text(arenaLeadingAmount)
                        .font(.largeTitle.weight(.bold).monospacedDigit())
                        .foregroundStyle(BrandTheme.success)
                        .minimumScaleFactor(0.5)
                        .lineLimit(1)
                        .contentTransition(.numericText())
                        .brandMoneyFlash(token: leadingFlashToken, isDown: true)
                        .animation(.easeOut(duration: 0.2), value: arenaLeadingAmount)
                    Text("Providers bid down · lowest trusted bid leads")
                        .font(.caption)
                        .foregroundStyle(BrandTheme.textSecondary)
                }
                .accessibilityElement(children: .combine)
                .accessibilityLabel("\(arenaLeadingLabel) \(arenaLeadingAmount)")
                .onChange(of: arenaLeadingCents) { _, newValue in
                    guard let newValue, newValue > 0 else { return }
                    if let prev = lastFlashedLeadingCents, prev != newValue {
                        leadingFlashToken += 1
                        BrandHaptics.light()
                    }
                    lastFlashedLeadingCents = newValue
                }

                HStack(spacing: 10) {
                    bidCountChip(job: job)
                    if liveAuctionStateAvailable {
                        Text("Live feed on")
                            .font(.caption2.weight(.bold).monospaced())
                            .foregroundStyle(BrandTheme.success)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 4)
                            .background(Capsule().fill(BrandTheme.success.opacity(0.12)))
                    }
                    if let status = job.status, !status.isEmpty {
                        StatusChipView(
                            label: StatusChipStyle.displayLabel(status),
                            style: StatusChipStyle.forStatus(status)
                        )
                    }
                    Spacer(minLength: 0)
                }

                if let footer = arenaSavingsFooter(job: job) {
                    ShowcaseSavingsFooter(
                        savingsLabel: footer.label,
                        savingsAmount: footer.amount
                    )
                }
            }
            .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
            .listRowBackground(Color.clear)
        } header: {
            Text("Auction floor").brandSectionHeader()
        } footer: {
            Text("Open floor — bid amounts are public. Ladder and live feed continue below.")
                .foregroundStyle(BrandTheme.textSecondary)
        }
    }

    /// Honest savings footer: prefer market median when FPI usable, else vs starting.
    private func arenaSavingsFooter(job: JobDetail) -> (label: String, amount: String)? {
        if let market = savingsVsMarketMedianLabel() {
            return ("Your estimated savings vs. market median", "\(market) saved")
        }
        if let start = savingsVsStartingLabel(job: job) {
            return ("Your estimated savings vs. starting bid", "\(start) saved")
        }
        return nil
    }

    /// Showcase “−N% vs market” under the leading ladder row (honest baseline).
    private func industrySavingsLine(for entry: JobBidEntry) -> String? {
        guard let amount = entry.bid?.amountCents, amount > 0 else { return nil }
        if let fair = fairPrice, fair.isUsable, let median = fair.priceCents, median > amount {
            let pct = Int((Double(median - amount) / Double(median) * 100.0).rounded())
            return "−\(pct)% vs market"
        }
        if let start = detail?.startingBidCents, start > amount {
            let pct = Int((Double(start - amount) / Double(start) * 100.0).rounded())
            return "−\(pct)% vs start"
        }
        return nil
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

    /// Owner CTA: re-request Instant match fan-out (web JobDetailClient parity).
    @ViewBuilder
    private var requestInstantMatchSection: some View {
        if canRequestInstantMatch {
            Section {
                if let instantMatchMessage {
                    Text(instantMatchMessage)
                        .font(.footnote)
                        .foregroundStyle(instantMatchIsError ? BrandTheme.destructive : BrandTheme.success)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityLabel(instantMatchMessage)
                }

                Button {
                    Task { await requestInstantMatch() }
                } label: {
                    if isRequestingInstantMatch {
                        ProgressView()
                            .tint(BrandTheme.accent)
                            .frame(maxWidth: .infinity, minHeight: 44)
                    } else {
                        Label("Request Instant match", systemImage: "bolt.fill")
                            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                    }
                }
                .disabled(isRequestingInstantMatch)
                .accessibilityLabel(
                    isRequestingInstantMatch ? "Requesting instant match" : "Request Instant match"
                )
                .accessibilityHint(
                    "Notifies nearby Instant providers at your accept-now price. Auction stays open until a provider accepts."
                )
            } header: {
                Text("Instant match").brandSectionHeader()
            } footer: {
                if let offer = detail?.offerAcceptedCents, offer > 0 {
                    Text(
                        "Notifies nearby providers at your Instant Accept price (\(MoneyFormat.usd(cents: offer))). Auction stays open until a provider accepts. Instant often prices about 1.5–2× a typical auction for the same work."
                    )
                    .foregroundStyle(BrandTheme.textSecondary)
                } else {
                    Text(
                        "Notifies nearby Instant providers. Auction stays open until a provider accepts. Instant often prices about 1.5–2× a typical auction for the same work."
                    )
                    .foregroundStyle(BrandTheme.textSecondary)
                }
            }
        }
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

    @ViewBuilder
    private var repostSection: some View {
        if canRepost {
            Section {
                if let repostMessage {
                    Text(repostMessage)
                        .font(.footnote)
                        .foregroundStyle(repostIsError ? BrandTheme.destructive : BrandTheme.success)
                        .fixedSize(horizontal: false, vertical: true)
                }

                Button {
                    confirmRepost = true
                } label: {
                    if isReposting {
                        ProgressView()
                            .tint(BrandTheme.accent)
                            .frame(maxWidth: .infinity, minHeight: 44)
                    } else {
                        Label("Repost job", systemImage: "arrow.triangle.2.circlepath")
                            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                    }
                }
                .disabled(isReposting)
                .accessibilityHint(
                    "Creates a new reverse auction from this job. Previous bids do not carry over."
                )
            } header: {
                Text("Repost").brandSectionHeader()
            } footer: {
                // PRD FR-3.10 — owner repost restarts the auction with the same job details.
                Text(
                    "Auction ended without an award, or you cancelled. Repost starts a fresh bidding window with the same details."
                )
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
                        .font(.largeTitle.weight(.bold).monospacedDigit())
                        .foregroundStyle(BrandTheme.goldBright)
                        .minimumScaleFactor(0.5)
                        .lineLimit(2)
                        .fixedSize(horizontal: false, vertical: true)
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
        Label(String(localized: "\(count) bids"), systemImage: "arrow.down.circle")
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
        "\(jobID)|\(isAuctionActiveForPolling)|\(isLiveAuctionType)|\(scenePhase == .active)|\(isAuctionSocketLive)"
    }

    private var auctionSocketIdentity: String {
        "\(jobID)|\(auth.isAuthenticated)|\(auth.isScaffoldSession)|\(isAuctionActiveForPolling)|\(isLiveAuctionType)|\(liveAuctionStateAvailable)|\(scenePhase == .active)"
    }

    /// Spectator path: unauth / non-participant; restarts when participant feed dies permanently.
    private var spectatorSocketIdentity: String {
        "\(jobID)|\(auth.isAuthenticated)|\(auth.isScaffoldSession)|\(auctionSocket.isPermanentlyStopped)|\(isAuctionActiveForPolling)|\(isLiveAuctionType)|\(liveAuctionStateAvailable)|\(scenePhase == .active)"
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
                        .accessibilityLabel("Sort bid ladder by price, trust, rating, or jobs completed")

                        Button {
                            showLadderFilters.toggle()
                        } label: {
                            Label(
                                showLadderFilters ? "Hide filters" : "Filter bids",
                                systemImage: "line.3.horizontal.decrease.circle"
                            )
                            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                        }
                        .accessibilityHint("Filter the ladder by trust tier and jobs completed")

                        if showLadderFilters {
                            Picker("Min trust", selection: $ladderTrustFilter) {
                                ForEach(LadderTrustFilter.allCases) { f in
                                    Text(f.rawValue).tag(f)
                                }
                            }
                            .frame(minHeight: 44)
                            .accessibilityLabel("Minimum trust tier filter")

                            Stepper(
                                value: $ladderMinJobsCompleted,
                                in: 0 ... 50,
                                step: 5
                            ) {
                                Text(
                                    ladderMinJobsCompleted == 0
                                        ? "Min jobs completed: Any"
                                        : "Min jobs completed: \(ladderMinJobsCompleted)+"
                                )
                                .foregroundStyle(BrandTheme.textPrimary)
                            }
                            .frame(minHeight: 44)
                            .accessibilityLabel("Minimum jobs completed filter")

                            if filteredLadder.filter({ !bidStatusIsWithdrawn($0) }).count
                                < bidEntries.filter({ !bidStatusIsWithdrawn($0) }).count
                            {
                                Text(
                                    "Showing \(filteredLadder.filter { !bidStatusIsWithdrawn($0) }.count) of \(bidEntries.filter { !bidStatusIsWithdrawn($0) }.count) active bids"
                                )
                                .font(.caption)
                                .foregroundStyle(BrandTheme.textSecondary)
                            }
                        }
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
                Text("You own this job. Award a bid to create the contract. Sort by Price (lowest wins), Trust, Rating, or Jobs completed. Filter by trust tier and experience. Leading badge always follows lowest price.")
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

    // MARK: - Soft live feed (WebSocket + HTTP poll fallback)

    /// Footer copy: WS live when connected; otherwise honest poll cadence.
    private var liveFeedFooterCopy: String {
        if isParticipantSocketLive {
            return isLiveAuctionType
                ? "Open floor · live over WebSocket while the auction is open."
                : "Live over WebSocket while the auction is open."
        }
        if isSpectatorSocketLive {
            return isLiveAuctionType
                ? "Open floor · public live feed (briefly delayed) while the auction is open."
                : "Public live feed (briefly delayed) while the auction is open."
        }
        if isLiveAuctionType {
            return "Open floor · updates every few seconds while the auction is open."
        }
        return "Refreshes while the auction is open."
    }

    private var isParticipantSocketLive: Bool {
        auctionSocket.status == .connected
    }

    private var isSpectatorSocketLive: Bool {
        spectatorSocket.status == .connected
    }

    /// Either privileged participant or public spectator stream is up.
    private var isAuctionSocketLive: Bool {
        isParticipantSocketLive || isSpectatorSocketLive
    }

    /// Authed participant feed — owner/bidder; gateway rejects non-participants.
    /// Stops after permanent denial so spectator can take the live slot.
    private var shouldAttemptAuctionSocket: Bool {
        guard auth.isAuthenticated, !auth.isScaffoldSession else { return false }
        guard scenePhase == .active else { return false }
        guard !auctionSocket.isPermanentlyStopped else { return false }
        // Prefer live-typed or known-live jobs; still try for open reverse auctions
        // so owners/bidders get real-time ladder ticks when the feature is on.
        return isAuctionActiveForPolling || isLiveAuctionType || liveAuctionStateAvailable
    }

    /// Public delayed spectate for logged-out, scaffold, and non-participants.
    /// Yields while the privileged participant socket is still eligible (connected,
    /// connecting, or reconnecting). After permanent denial, takes over.
    private var shouldAttemptSpectatorSocket: Bool {
        guard scenePhase == .active else { return false }
        guard isAuctionActiveForPolling || isLiveAuctionType || liveAuctionStateAvailable else {
            return false
        }
        if isParticipantSocketLive { return false }
        if shouldAttemptAuctionSocket, !auctionSocket.isPermanentlyStopped {
            return false
        }
        return true
    }

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
                            .fill(isAuctionSocketLive ? BrandTheme.accent : BrandTheme.success)
                            .frame(width: 6, height: 6)
                            .accessibilityHidden(true)
                    }
                    Text("Live feed").brandSectionHeader()
                    if isAuctionSocketLive {
                        Text("LIVE")
                            .font(.caption2.weight(.bold))
                            .foregroundStyle(BrandTheme.accent)
                            .accessibilityLabel(
                                isSpectatorSocketLive && !isParticipantSocketLive
                                    ? "Public live feed connected, briefly delayed"
                                    : "Live auction WebSocket connected"
                            )
                    }
                    if isSpectatorSocketLive && !isParticipantSocketLive && liveSpectatorCount > 0 {
                        Text("\(liveSpectatorCount) watching")
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(BrandTheme.textSecondary)
                            .accessibilityLabel("\(liveSpectatorCount) people watching live")
                    }
                }
            } footer: {
                Text(liveFeedFooterCopy)
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
            ShowcaseBidRowChrome(
                displayName: entry.displayName,
                amountText: entry.displayAmount,
                isLeading: isLeading && !alreadyAwarded && bidStatus != "withdrawn",
                trustText: entry.displayTrust == "—" ? nil : entry.displayTrust,
                rating: entry.averageRating,
                badges: entry.verifiedBadges.map(\.displayShortLabel).filter { !$0.isEmpty },
                industrySavingsLine: isLeading ? industrySavingsLine(for: entry) : nil
            )
            .accessibilityElement(children: .combine)
            .accessibilityLabel(
                isLeading
                    ? "Rank \(rank), leading, \(entry.displayName), \(entry.displayAmount)"
                    : "Rank \(rank), \(entry.displayName), \(entry.displayAmount)"
            )
            .overlay(alignment: .topLeading) {
                Text("#\(rank)")
                    .font(.caption2.weight(.bold).monospacedDigit())
                    .foregroundStyle(isLeading ? BrandTheme.success : BrandTheme.textSecondary)
                    .padding(6)
            }

            if isOwnBid(entry) {
                Text("Your bid")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(BrandTheme.bidActive)
            }

            if alreadyAwarded {
                Text("Awarded")
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(BrandTheme.success)
            } else if bidStatus == "withdrawn" {
                Text("Withdrawn")
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(BrandTheme.textSecondary)
            }

            // Outside combined a11y group so VoiceOver can focus the trust breakdown link.
            trustChip(for: entry)

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
                            .tint(BrandTheme.ctaLabelOnGold)
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
                .foregroundStyle(BrandTheme.ctaLabelOnGold)
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

    @ViewBuilder
    private func verificationBadgeRow(_ badges: [BidVerificationBadge]) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(Array(badges.enumerated()), id: \.offset) { _, badge in
                    HStack(spacing: 4) {
                        Image(systemName: "checkmark.seal.fill")
                            .font(.caption2)
                            .foregroundStyle(BrandTheme.success)
                            .accessibilityHidden(true)
                        Text(badge.displayShortLabel)
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(BrandTheme.success)
                    }
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(BrandTheme.success.opacity(0.14), in: Capsule())
                    .accessibilityLabel("Verified \(badge.displayShortLabel)")
                }
            }
            .frame(minHeight: 44, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
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
            if !isAuctionActiveForPolling {
                Text("This opportunity is closed. You can’t place or lower a bid.")
                    .font(.footnote)
                    .foregroundStyle(BrandTheme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            } else if !auth.isAuthenticated {
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
                // FR-11.3 — market range for providers during bid submission (soft-hide).
                if let apiMarketRange, apiMarketRange.isUsable {
                    MarketRangeBar(
                        range: apiMarketRange,
                        serviceLabel: job.categoryName,
                        audience: .provider,
                        compact: true
                    )
                    .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
                    .listRowBackground(Color.clear)
                }

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
                            .tint(BrandTheme.ctaLabelOnGold)
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
                .glassProminentBrandCTA()
                .tint(BrandTheme.accent)
                .foregroundStyle(BrandTheme.ctaLabelOnGold)
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
                                .tint(BrandTheme.ctaLabelOnGold)
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
            if let label = job.recurrenceLabel {
                LabeledContent("Recurring", value: label)
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

        guard isAuctionActiveForPolling else {
            bidStatusIsError = true
            bidStatusMessage = "This opportunity is closed. You can’t place or lower a bid."
            return
        }

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
                BrandHaptics.medium()
                _ = try await APIClient.shared.updateJobBid(id: bidId, newAmountCents: cents)
                BrandHaptics.success()
                bidStatusIsError = false
                bidStatusMessage = "Bid lowered to \(MoneyFormat.usd(cents: cents))."
                bidAmountText = ""
                if let own = ownActiveServiceBid {
                    ownActiveServiceBid = own.markedLowered(to: cents)
                }
                await load()
            } catch let error as APIClientError where error.isUnauthorized {
                BrandHaptics.error()
                bidStatusIsError = true
                bidStatusMessage = "Sign in required. Your session is missing or expired — please sign in again."
            } catch {
                BrandHaptics.error()
                bidStatusIsError = true
                bidStatusMessage = error.localizedDescription
            }
            return
        }

        if let leading = leadingBidCents, cents >= leading {
            BrandHaptics.warning()
            bidStatusIsError = true
            bidStatusMessage =
                "Reverse auction: bid below the leading \(MoneyFormat.usd(cents: leading)) to take the lead."
            return
        }

        isPlacingBid = true
        defer { isPlacingBid = false }

        do {
            BrandHaptics.medium()
            _ = try await APIClient.shared.placeJobBid(jobId: jobID, amountCents: cents)
            BrandHaptics.success()
            bidStatusIsError = false
            bidStatusMessage = "Bid placed: \(MoneyFormat.usd(cents: cents))."
            bidAmountText = ""
            // Value moment: invite push permission after first successful bid (NT.2).
            PushRegistration.shared.noteValueMoment()
            // Live Activity + widget snapshot (best-effort; never fails the bid path).
            let title = detail?.title ?? preview?.title ?? "Service auction"
            let endsISO = detail?.auctionEndsAt ?? preview?.auctionEndsAt
            let endsAt = endsISO.flatMap { CatalogDateFormat.parseISO($0) }
            AuctionLiveActivityController.startOrUpdate(
                auctionID: jobID,
                title: title,
                kind: "job",
                leadingBidCents: cents,
                endsAt: endsAt
            )
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

    /// POST `/jobs/{id}/instant-match` — owner only; soft-fail message on error (does not crash UI).
    @MainActor
    private func requestInstantMatch() async {
        instantMatchMessage = nil
        instantMatchIsError = false
        guard canRequestInstantMatch else { return }
        guard !auth.isScaffoldSession else {
            instantMatchIsError = true
            instantMatchMessage =
                "Browse-only mode has no API credentials. Sign in against a live gateway to request Instant match."
            return
        }
        guard auth.isAuthenticated else {
            instantMatchIsError = true
            instantMatchMessage = "Sign in required to request Instant match."
            return
        }
        isRequestingInstantMatch = true
        defer { isRequestingInstantMatch = false }
        do {
            let response = try await APIClient.shared.createInstantMatch(jobId: jobID)
            instantMatchIsError = false
            let n = response.providersNotified
            let expiresLabel: String? = {
                guard let expires = response.expiresAt?.trimmingCharacters(in: .whitespacesAndNewlines),
                      !expires.isEmpty
                else { return nil }
                return CatalogDateFormat.friendlyDateTime(expires)
            }()
            if let n, n == 0 {
                if let when = expiresLabel {
                    instantMatchMessage =
                        "Instant offer is live until \(when), but no providers are currently available for Instant. Keep the auction open or re-request later."
                } else {
                    instantMatchMessage =
                        "Instant offer is live, but no providers are currently available for Instant. Keep the auction open or re-request later."
                }
            } else if let n, n > 0 {
                let providers = String(localized: "\(n) available providers")
                if let when = expiresLabel {
                    instantMatchMessage = "Instant match sent to \(providers). Offers expire \(when)."
                } else {
                    instantMatchMessage = "Instant match sent to \(providers)."
                }
            } else if let when = expiresLabel {
                instantMatchMessage = "Instant match sent. Offers expire \(when)."
            } else {
                instantMatchMessage =
                    "Instant match sent. Providers with Instant availability will see the offer."
            }
        } catch let error as APIClientError where error.isUnauthorized {
            // Soft-fail: surface toast-style inline error; keep auction UI usable.
            instantMatchIsError = true
            instantMatchMessage = "Sign in required. Your session is missing or expired — please sign in again."
        } catch {
            instantMatchIsError = true
            instantMatchMessage = error.localizedDescription.isEmpty
                ? "Failed to start instant match."
                : error.localizedDescription
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
    private func repostOwnedJob() async {
        repostMessage = nil
        repostIsError = false
        guard !auth.isScaffoldSession else {
            repostIsError = true
            repostMessage =
                "Browse-only mode has no API credentials. Sign in against a live gateway to repost this job."
            return
        }
        isReposting = true
        defer { isReposting = false }
        do {
            let newJob = try await APIClient.shared.repostJob(id: jobID)
            repostIsError = false
            repostMessage = "Reposted as a new auction. Opening the new job…"
            await load()
            let newID = newJob.id.trimmingCharacters(in: .whitespacesAndNewlines)
            if !newID.isEmpty {
                repostedRoute = JobRepostRoute(id: newID)
            }
        } catch let error as APIClientError where error.isUnauthorized {
            repostIsError = true
            repostMessage = "Sign in required. Your session is missing or expired — please sign in again."
        } catch {
            repostIsError = true
            repostMessage = error.localizedDescription
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
            // IOS-INT.2: drop Spotlight donation when the job is gone.
            if let apiError = error as? APIClientError, apiError.isNotFound {
                await SpotlightIndex.delete(identifiers: [jobID])
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

    /// Soft market-range for the intelligence strip + FR-11 bar. Never throws / never blocks hero.
    /// Hierarchy: market/range → FPI p25–p75 → category starting-bid sample → reverse-auction 60–100% band.
    /// `apiMarketRange` only set for real index data (market/range or fair-price) so the bid bar
    /// can soft-hide when only heuristic estimates exist (FR-11.2).
    @MainActor
    private func loadMarketIntelligence() async {
        let categoryId = detail?.categoryId?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let starting = detail?.startingBidCents ?? 0
        apiMarketRange = nil

        // (a) Analytics market/range (FR-11 primary).
        if !categoryId.isEmpty {
            let range = await APIClient.shared.fetchMarketRange(categoryId: categoryId)
            if range.isUsable, let estimate = MarketRangeMath.fromMarketRange(range) {
                apiMarketRange = range
                marketRange = estimate
                // Still try FPI for median-savings strip when available.
                if let price = try? await APIClient.shared.fetchFairPrice(categoryId: categoryId, side: 1),
                   price.isUsable {
                    fairPrice = price
                } else {
                    fairPrice = nil
                }
                return
            }
        }

        // (b) Fair-price index when the engine has data.
        if !categoryId.isEmpty {
            do {
                let price = try await APIClient.shared.fetchFairPrice(categoryId: categoryId, side: 1)
                if let estimate = MarketRangeMath.fromFairPrice(price) {
                    fairPrice = price
                    marketRange = estimate
                    apiMarketRange = MarketRangeMath.marketRangeResponse(from: price)
                    return
                }
                fairPrice = nil
            } catch {
                fairPrice = nil
            }
        } else {
            fairPrice = nil
        }

        // (c) Category sample: p25–p75 of recent public jobs' starting bids (max 20).
        // Heuristic only — do not set apiMarketRange (bar stays hidden).
        if !categoryId.isEmpty {
            if let sample = await loadCategorySampleRange(categoryId: categoryId) {
                marketRange = sample
                return
            }
        }

        // (d) Documented reverse-auction band from this job's starting bid.
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

    /// Hybrid REST poll for live auction state + events.
    ///
    /// - **WS connected:** slow reconcile (~15s) so missed frames still surface.
    /// - **WS down / unauth / non-participant:** fast poll for open-floor live (~1.5s)
    ///   or known-live state (~2s); sealed/active stays ~10s.
    /// Decode/network failures are ignored (endpoints may be feature-gated → 404).
    private func pollLiveAuctionStateLoop() async {
        // Always try once so a live job surfaces the arena even if status parsing lags.
        await refreshLiveAuctionState()
        await refreshLiveAuctionEvents()
        guard scenePhase == .active else { return }
        while !Task.isCancelled {
            let interval: UInt64
            if isAuctionSocketLive {
                interval = 15_000_000_000
            } else if isLiveAuctionType {
                interval = 1_500_000_000
            } else if liveAuctionStateAvailable {
                interval = 2_000_000_000
            } else {
                interval = 10_000_000_000
            }
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

    /// Connect authed auction WS while this detail is foregrounded and eligible.
    /// Tears down when the task is cancelled (leave job / identity change).
    @MainActor
    private func runAuctionSocketLifecycle() async {
        guard shouldAttemptAuctionSocket else {
            auctionSocket.disconnect()
            return
        }

        auctionSocket.onEvent = { [jobID] event in
            handleAuctionSocketEvent(event, expectedJobID: jobID)
        }
        auctionSocket.connect(jobID: jobID)

        while !Task.isCancelled {
            do {
                try await Task.sleep(nanoseconds: 1_000_000_000)
            } catch {
                break
            }
            if !shouldAttemptAuctionSocket {
                break
            }
        }
        auctionSocket.disconnect()
    }

    /// Pause auction / spectator WS when backgrounded; reconnect when active.
    /// Extracted from `body` so the type-checker does not choke on the modifier chain.
    @MainActor
    private func handleScenePhaseChange(_ phase: ScenePhase) {
        if phase == .active {
            if shouldAttemptAuctionSocket {
                auctionSocket.connect(jobID: jobID)
            }
            if shouldAttemptSpectatorSocket {
                spectatorSocket.connect(jobID: jobID)
            }
        } else {
            auctionSocket.disconnect()
            spectatorSocket.disconnect()
        }
    }

    @MainActor
    private func teardownAuctionSockets() {
        auctionSocket.onEvent = nil
        auctionSocket.disconnect()
        spectatorSocket.onEvent = nil
        spectatorSocket.disconnect()
    }

    /// Public delayed spectate WS for non-participants + logged-out viewers.
    /// Mutually exclusive with a live participant socket (see `shouldAttemptSpectatorSocket`).
    @MainActor
    private func runSpectatorSocketLifecycle() async {
        guard shouldAttemptSpectatorSocket else {
            spectatorSocket.disconnect()
            liveSpectatorCount = 0
            return
        }

        spectatorSocket.onEvent = { [jobID] event in
            handleSpectatorSocketEvent(event, expectedJobID: jobID)
        }
        spectatorSocket.connect(jobID: jobID)

        while !Task.isCancelled {
            do {
                try await Task.sleep(nanoseconds: 1_000_000_000)
            } catch {
                break
            }
            if !shouldAttemptSpectatorSocket {
                break
            }
        }
        spectatorSocket.disconnect()
    }

    @MainActor
    private func handleAuctionSocketEvent(
        _ event: AuctionWebSocketClient.ServerEvent,
        expectedJobID: String
    ) {
        switch event {
        case .bidEvent(let bidEvent):
            // Privileged floor: amounts + ladder are participant-visible.
            applyPublicBidSignal(
                bidEvent,
                expectedJobID: expectedJobID,
                refreshLadder: true,
                applyAmountToLeader: true
            )
        case .auctionState(let lowest, let bidCount, let endsAt, _):
            liveAuctionStateAvailable = true
            if let lowest, lowest > 0 {
                liveLowestBidCents = lowest
            }
            if var job = detail {
                if let bidCount {
                    job.bidCount = bidCount
                }
                if let endsAt, !endsAt.isEmpty {
                    job.auctionEndsAt = endsAt
                }
                detail = job
            }
        case .snipeExtended:
            // Ends-at may have moved — refresh state once.
            Task {
                await refreshLiveAuctionState()
            }
        case .auctionEnded:
            Task {
                await refreshLiveAuctionState()
                await refreshLiveAuctionEvents()
                await loadBids()
            }
        case .error:
            // Non-fatal; spectator WS and/or HTTP poll cover non-participants.
            break
        }
    }

    @MainActor
    private func handleSpectatorSocketEvent(
        _ event: SpectatorWebSocketClient.ServerEvent,
        expectedJobID: String
    ) {
        switch event {
        case .bidEvent(let bidEvent):
            // Public signals only — never refresh owner ladder from spectate
            // (ladder is authz-gated; would 401/403 and thrash for guests).
            // Amount → leader only when UI already treats amounts as public.
            applyPublicBidSignal(
                bidEvent,
                expectedJobID: expectedJobID,
                refreshLadder: false,
                applyAmountToLeader: canShowPublicEventAmounts
            )
        case .spectatorCount(let count):
            liveSpectatorCount = max(0, count)
        case .error:
            // Non-fatal; HTTP poll covers recovery.
            break
        }
    }

    /// Merge a bid activity row; optionally touch owner ladder / leading bid.
    @MainActor
    private func applyPublicBidSignal(
        _ bidEvent: AuctionEvent,
        expectedJobID: String,
        refreshLadder: Bool,
        applyAmountToLeader: Bool
    ) {
        if let jid = bidEvent.jobId, !jid.isEmpty, jid != expectedJobID {
            return
        }
        mergeAuctionEvent(bidEvent)
        if applyAmountToLeader,
           let cents = bidEvent.amountCents,
           cents > 0
        {
            if liveLowestBidCents == nil || cents < (liveLowestBidCents ?? .max) {
                liveLowestBidCents = cents
            }
        }
        guard refreshLadder else { return }
        let now = Date()
        if now.timeIntervalSince(lastLadderInvalidateAt) >= 2.0 {
            lastLadderInvalidateAt = now
            Task { await loadBids() }
        }
    }

    @MainActor
    private func mergeAuctionEvent(_ event: AuctionEvent) {
        // De-dupe by stable id (when|type|amount|job).
        if auctionEvents.contains(where: { $0.id == event.id }) {
            return
        }
        auctionEvents.insert(event, at: 0)
        if auctionEvents.count > 50 {
            auctionEvents = Array(auctionEvents.prefix(50))
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
            // When WS is live, merge so a slightly-stale poll does not drop frames
            // that arrived over the socket milliseconds earlier.
            if isAuctionSocketLive, !auctionEvents.isEmpty {
                for event in events {
                    mergeAuctionEvent(event)
                }
            } else {
                auctionEvents = events
            }
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

/// Navigation payload after a successful FR-3.10 repost.
private struct JobRepostRoute: Hashable, Identifiable {
    let id: String
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
