import SwiftUI

/// Job detail for a single services **reverse auction**.
/// Providers bid **down** — lowest trusted bid can win.
struct JobDetailView: View {
    let jobID: String
    var preview: JobSummary?

    @EnvironmentObject private var auth: AuthViewModel
    @Environment(\.scenePhase) private var scenePhase

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

    @State private var currentUserID: String?
    @State private var pendingAwardEntry: JobBidEntry?
    @State private var isAwarding = false
    @State private var awardStatusMessage: String?
    @State private var awardStatusIsError = false

    @State private var withdrawingBidID: String?
    @State private var withdrawStatusMessage: String?
    @State private var withdrawStatusIsError = false

    /// Soft live-auction overlay (lowest bid / ends-at) from optional poll.
    @State private var liveLowestBidCents: Int64?

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

    /// Reverse auction: lowest amount first; rank #1 is leading. Withdrawn bids sort last.
    private var sortedLadder: [JobBidEntry] {
        bidEntries.sorted { lhs, rhs in
            let leftWithdrawn = bidStatusIsWithdrawn(lhs)
            let rightWithdrawn = bidStatusIsWithdrawn(rhs)
            if leftWithdrawn != rightWithdrawn {
                return !leftWithdrawn
            }
            let a = lhs.bid?.amountCents ?? Int64.max
            let b = rhs.bid?.amountCents ?? Int64.max
            if a != b { return a < b }
            return lhs.displayName.localizedCaseInsensitiveCompare(rhs.displayName) == .orderedAscending
        }
    }

    private var leadingBidCents: Int64? {
        if let ladder = sortedLadder.first(where: { !bidStatusIsWithdrawn($0) })?.bid?.amountCents {
            return ladder
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
        .navigationTitle(detail?.displayTitle ?? "Job")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbarBackground(BrandTheme.navy, for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
        .task { await load() }
        .task(id: auctionPollIdentity) {
            await pollLiveAuctionStateLoop()
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
            auctionHeroSection(job)
            bidLadderSection(job)
            placeBidSection(job)
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

            Section {
                Text("Contracts and advanced auction tools remain on the website.")
                    .font(.footnote)
                    .foregroundStyle(BrandTheme.textSecondary)
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

    private var reverseAuctionBadge: some View {
        Text("Reverse auction")
            .font(.caption.weight(.bold))
            .foregroundStyle(BrandTheme.goldBright)
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .overlay(
                Capsule()
                    .strokeBorder(BrandTheme.gold, lineWidth: 1.5)
            )
            .accessibilityLabel("Reverse auction")
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
                ladderGateMessage(
                    "Sign in as the job owner to see the full bid ladder.",
                    systemImage: "lock.fill"
                )
                publicStatsRow(job)

            case .forbidden:
                ladderGateMessage(
                    "Only the job owner can see the full bid ladder.",
                    systemImage: "eye.slash"
                )
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
                        let isLeading = index == 0 && !bidStatusIsWithdrawn(entry)
                        bidLadderRow(entry: entry, rank: index + 1, isLeading: isLeading)
                    }
                }
            }
        } header: {
            Text("Bid ladder").brandSectionHeader()
        } footer: {
            if canAward {
                Text("You own this job. Award a bid to create the contract. Lowest bid leads in a reverse auction.")
                    .foregroundStyle(BrandTheme.textSecondary)
            } else {
                Text("Lowest bid leads in a reverse auction. Rank #1 is currently winning on price.")
                    .foregroundStyle(BrandTheme.textSecondary)
            }
        }
    }

    @ViewBuilder
    private func publicStatsRow(_ job: JobDetail) -> some View {
        HStack {
            Text("Public bid count")
                .foregroundStyle(BrandTheme.textSecondary)
            Spacer()
            Text("\(job.bidCount ?? 0)")
                .font(.body.weight(.semibold).monospacedDigit())
                .foregroundStyle(BrandTheme.goldBright)
        }
        .frame(minHeight: 44)
    }

    private func ladderGateMessage(_ text: String, systemImage: String) -> some View {
        Label(text, systemImage: systemImage)
            .font(.footnote)
            .foregroundStyle(BrandTheme.textSecondary)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
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
                    if entry.displayTrust != "—" {
                        Text("Trust · \(entry.displayTrust)")
                            .font(.caption2)
                            .foregroundStyle(BrandTheme.textSecondary)
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
        .accessibilityElement(children: .combine)
        .accessibilityLabel(
            isLeading
                ? "Rank \(rank), leading, \(entry.displayName), \(entry.displayAmount)"
                : "Rank \(rank), \(entry.displayName), \(entry.displayAmount)"
        )
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

    // MARK: - Place bid (providers)

    @ViewBuilder
    private func placeBidSection(_ job: JobDetail) -> some View {
        Section {
            if !auth.isAuthenticated {
                Text("Sign in as a provider to place a bid on this job.")
                    .font(.footnote)
                    .foregroundStyle(BrandTheme.textSecondary)
            } else if auth.isScaffoldSession {
                Text("Browse-only mode has no API credentials. Sign in against a live gateway to place bids.")
                    .font(.footnote)
                    .foregroundStyle(BrandTheme.textSecondary)
                TextField("Bid amount (USD)", text: $bidAmountText)
                    .keyboardType(.decimalPad)
                    .disabled(true)
                    .frame(minHeight: 44)
                Button("Place bid") {}
                    .disabled(true)
                    .frame(maxWidth: .infinity, minHeight: 44)
            } else {
                Text(bidHint(for: job))
                    .font(.footnote)
                    .foregroundStyle(BrandTheme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)

                TextField("Your bid (USD) — lower is better", text: $bidAmountText)
                    .keyboardType(.decimalPad)
                    .textContentType(.none)
                    .autocorrectionDisabled()
                    .frame(minHeight: 44)
                    .accessibilityLabel("Bid amount in dollars — reverse auction, lower is better")

                if let bidStatusMessage {
                    Text(bidStatusMessage)
                        .font(.footnote)
                        .foregroundStyle(bidStatusIsError ? BrandTheme.destructive : BrandTheme.success)
                        .fixedSize(horizontal: false, vertical: true)
                }

                Button {
                    Task { await placeJobBid() }
                } label: {
                    if isPlacingBid {
                        ProgressView()
                            .tint(BrandTheme.navy)
                            .frame(maxWidth: .infinity, minHeight: 44)
                    } else {
                        Text("Place reverse bid")
                            .frame(maxWidth: .infinity, minHeight: 44)
                    }
                }
                .buttonStyle(.borderedProminent)
                .tint(BrandTheme.accent)
                .disabled(isPlacingBid || bidAmountText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                .accessibilityHint("Submit a lower bid to compete in this reverse auction")
            }
        } header: {
            Text("Place a bid").brandSectionHeader()
        } footer: {
            Text("Services are reverse auctions — enter a lower amount than the current leading bid to compete. Provider role required.")
                .foregroundStyle(BrandTheme.textSecondary)
        }
    }

    private func bidHint(for job: JobDetail) -> String {
        if let leading = leadingBidCents {
            return "Reverse auction: enter a lower amount than the leading bid (\(MoneyFormat.usd(cents: leading))) to take the lead."
        }
        if let start = job.startingBidCents {
            return "Reverse auction: enter a competitive bid at or below the starting bid (\(MoneyFormat.usd(cents: start))). Lower wins."
        }
        if let price = job.displayPrice {
            return "Reverse auction: enter your bid in dollars. Current price \(price) — lower competes to win."
        }
        return "Reverse auction: enter your bid in dollars. Lower bids compete. Provider accounts only."
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
            if let location = job.locationLabel {
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
        } header: {
            Text("Details").brandSectionHeader()
        }
    }

    // MARK: - Actions

    @MainActor
    private func placeJobBid() async {
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
            bidStatusMessage = "Enter a valid bid amount in dollars (for example 75.00)."
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
        // Soft live-state refresh (ignore failures).
        await refreshLiveAuctionState()
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

    /// Polls live auction state every 10s while the scene is active and the auction is open.
    /// Decode/network failures are ignored (endpoint may be feature-gated).
    private func pollLiveAuctionStateLoop() async {
        guard isAuctionActiveForPolling, scenePhase == .active else { return }
        // Immediate soft refresh, then every 10s until cancelled.
        await refreshLiveAuctionState()
        while !Task.isCancelled {
            do {
                try await Task.sleep(nanoseconds: 10_000_000_000)
            } catch {
                return
            }
            guard !Task.isCancelled else { return }
            guard scenePhase == .active, isAuctionActiveForPolling else { return }
            await refreshLiveAuctionState()
        }
    }

    @MainActor
    private func refreshLiveAuctionState() async {
        guard isAuctionActiveForPolling else { return }
        do {
            let state = try await APIClient.shared.fetchJobAuctionState(jobId: jobID)
            applyLiveAuctionState(state)
        } catch {
            // Optional endpoint — ignore 404 / decode / network failures.
        }
    }

    @MainActor
    private func applyLiveAuctionState(_ state: LiveAuctionState) {
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
