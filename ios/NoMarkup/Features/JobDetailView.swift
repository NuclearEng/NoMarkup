import SwiftUI

/// Job detail for a single services **reverse auction**.
/// Providers bid **down** — lowest trusted bid can win.
struct JobDetailView: View {
    let jobID: String
    var preview: JobSummary?

    @EnvironmentObject private var auth: AuthViewModel

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

    /// Reverse auction: lowest amount first; rank #1 is leading.
    private var sortedLadder: [JobBidEntry] {
        bidEntries.sorted { lhs, rhs in
            let a = lhs.bid?.amountCents ?? Int64.max
            let b = rhs.bid?.amountCents ?? Int64.max
            if a != b { return a < b }
            return lhs.displayName.localizedCaseInsensitiveCompare(rhs.displayName) == .orderedAscending
        }
    }

    private var leadingBidCents: Int64? {
        sortedLadder.first?.bid?.amountCents
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
        .refreshable { await load() }
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
        if let start = job.startingBidCents {
            return HeroPrice(amount: MoneyFormat.usd(cents: start), caption: "Starting bid")
        }
        return nil
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
                    ForEach(Array(sortedLadder.enumerated()), id: \.offset) { index, entry in
                        bidLadderRow(entry: entry, rank: index + 1, isLeading: index == 0)
                    }
                }
            }
        } header: {
            Text("Bid ladder").brandSectionHeader()
        } footer: {
            Text("Lowest bid leads in a reverse auction. Rank #1 is currently winning on price.")
                .foregroundStyle(BrandTheme.textSecondary)
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
                if let trust = entry.trustScore {
                    Text("Trust \(String(format: "%.0f", trust))")
                        .font(.caption2)
                        .foregroundStyle(BrandTheme.textSecondary)
                }
            }

            Spacer(minLength: 8)

            VStack(alignment: .trailing, spacing: 4) {
                Text(entry.displayAmount)
                    .font(.body.weight(.bold).monospacedDigit())
                    .foregroundStyle(BrandTheme.goldBright)
                if isLeading {
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
        .padding(.vertical, 4)
        .frame(minHeight: 44)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(
            isLeading
                ? "Rank \(rank), leading, \(entry.displayName), \(entry.displayAmount)"
                : "Rank \(rank), \(entry.displayName), \(entry.displayAmount)"
        )
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
                Text("Scaffold session has no API credentials. Sign in against a live gateway to place bids.")
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
                "Scaffold session has no API credentials. Sign in against a live gateway to place bids."
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
    private func load() async {
        isLoading = detail == nil
        errorMessage = nil
        defer { isLoading = false }

        do {
            detail = try await APIClient.shared.fetchJob(id: jobID)
        } catch {
            if detail == nil {
                errorMessage = error.localizedDescription
            }
        }

        await loadBids()
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
