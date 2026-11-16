import SwiftUI

/// Lightweight unicorn spectate desk — not a full web terminal clone.
/// Job: public delayed `SpectatorWebSocketClient` + `fetchJobAuctionState` poll.
/// Listing: public delayed `MarketplaceSpectatorWebSocketClient` + listing detail refresh.
struct SpectateTerminalView: View {
    enum Target: Hashable {
        case job(id: String, title: String, leadingCents: Int64?, endsAtISO: String?)
        case listing(id: String, title: String, leadingCents: Int64?, endsAt: Date?)
    }

    let target: Target

    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.dismiss) private var dismiss

    @StateObject private var jobSpectator = SpectatorWebSocketClient()
    @StateObject private var listingSpectator = MarketplaceSpectatorWebSocketClient()

    @State private var title: String
    @State private var leadingCents: Int64?
    @State private var endsAtISO: String?
    @State private var endsAtDate: Date?
    @State private var spectatorCount = 0
    @State private var lastTickAt: Date?
    @State private var feedNote = "Connecting…"
    @State private var priceFlashToken = 0
    @State private var lastFlashedCents: Int64?

    init(target: Target) {
        self.target = target
        switch target {
        case let .job(_, t, cents, ends):
            _title = State(initialValue: t)
            _leadingCents = State(initialValue: cents)
            _endsAtISO = State(initialValue: ends)
            _endsAtDate = State(initialValue: ends.flatMap { CatalogDateFormat.parseISO($0) })
        case let .listing(_, t, cents, ends):
            _title = State(initialValue: t)
            _leadingCents = State(initialValue: cents)
            _endsAtDate = State(initialValue: ends)
            if let ends {
                _endsAtISO = State(initialValue: ISO8601DateFormatter().string(from: ends))
            } else {
                _endsAtISO = State(initialValue: nil)
            }
        }
    }

    private var entityID: String {
        switch target {
        case .job(let id, _, _, _): return id
        case .listing(let id, _, _, _): return id
        }
    }

    private var isJob: Bool {
        if case .job = target { return true }
        return false
    }

    private var isForwardAuction: Bool { !isJob }

    private var socketConnected: Bool {
        if isJob {
            return jobSpectator.status == .connected
        }
        return listingSpectator.status == .connected
    }

    private var priceLabel: String {
        isForwardAuction ? "LEADING BID" : "LOWEST BID"
    }

    private var priceCaption: String {
        isForwardAuction
            ? "Buyers bid up · highest bid leads"
            : "Providers bid down · lowest trusted bid leads"
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                headerChrome
                priceCard
                metaRow
                noteCard
            }
            .padding(20)
        }
        .brandScreenBackground()
        .accessibilityIdentifier("spectate.root")
        .navigationTitle("Spectate")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .brandNavigationBarChrome()
        .task(id: "\(entityID)|spectate-terminal|\(scenePhase == .active)") {
            await runLifecycle()
        }
        .onDisappear {
            teardown()
        }
        .onChange(of: scenePhase) { _, phase in
            if phase != .active {
                jobSpectator.disconnect()
                listingSpectator.disconnect()
            }
        }
    }

    // MARK: - Chrome

    private var headerChrome: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                LivePulseDot()
                Text("LIVE")
                    .font(.caption2.weight(.heavy).monospaced())
                    .tracking(1.2)
                    .foregroundStyle(BrandTheme.success)
                Text(isForwardAuction ? "FORWARD AUCTION" : "REVERSE AUCTION")
                    .font(.caption2.weight(.bold).monospaced())
                    .tracking(0.8)
                    .foregroundStyle(BrandTheme.goldBright)
                Spacer(minLength: 8)
                if socketConnected {
                    Text("STREAM")
                        .font(.caption2.weight(.bold).monospaced())
                        .foregroundStyle(BrandTheme.success)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(Capsule().fill(BrandTheme.success.opacity(0.14)))
                        .accessibilityLabel("Live spectator stream connected")
                } else {
                    Text("POLL")
                        .font(.caption2.weight(.bold).monospaced())
                        .foregroundStyle(BrandTheme.textSecondary)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(Capsule().fill(BrandTheme.surfaceRaised))
                        .accessibilityLabel("Polling auction state")
                }
            }

            Text(title)
                .font(.title2.weight(.bold))
                .foregroundStyle(BrandTheme.textPrimary)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
        }
        .accessibilityElement(children: .combine)
    }

    private var priceCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(priceLabel)
                .font(.caption2.weight(.heavy).monospaced())
                .tracking(1.0)
                .foregroundStyle(BrandTheme.textSecondary)

            // IOS-A11Y.2: Dynamic Type largeTitle (not fixed 42pt) so money grows at AX5.
            Text(leadingPriceDisplay)
                .font(.system(.largeTitle, design: .rounded, weight: .bold).monospacedDigit())
                .foregroundStyle(isForwardAuction ? BrandTheme.goldBright : BrandTheme.success)
                .fixedSize(horizontal: false, vertical: true)
                .contentTransition(.numericText())
                .brandMoneyFlash(token: priceFlashToken, isDown: !isForwardAuction)
                .brandAnimation(.easeOut(duration: 0.2), value: leadingPriceDisplay)
                .accessibilityLabel("\(priceLabel): \(leadingPriceDisplay)")

            Text(priceCaption)
                .font(.caption)
                .foregroundStyle(BrandTheme.textSecondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(20)
        .background(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(BrandTheme.navyElevated)
                .overlay(
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .strokeBorder(BrandTheme.hairline, lineWidth: 1)
                )
        )
    }

    private var metaRow: some View {
        HStack(spacing: 12) {
            if let countdown = countdownText {
                metaChip(
                    icon: "timer",
                    label: countdown,
                    tint: countdown == "Ended" ? BrandTheme.textSecondary : BrandTheme.goldBright
                )
            }
            if spectatorCount > 0 {
                metaChip(
                    icon: "eye",
                    label: "\(spectatorCount) watching",
                    tint: BrandTheme.textSecondary
                )
            }
            Spacer(minLength: 0)
        }
    }

    private func metaChip(icon: String, label: String, tint: Color) -> some View {
        HStack(spacing: 6) {
            Image(systemName: icon)
                .font(.caption.weight(.semibold))
                .foregroundStyle(tint)
                .accessibilityHidden(true)
            Text(label)
                .font(.caption.weight(.semibold).monospacedDigit())
                .foregroundStyle(tint)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .background(
            Capsule()
                .fill(BrandTheme.surfaceRaised)
                .overlay(Capsule().strokeBorder(BrandTheme.hairline, lineWidth: 1))
        )
        .accessibilityElement(children: .combine)
    }

    private var noteCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label {
                Text("Live spectator feed")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(BrandTheme.textPrimary)
            } icon: {
                Image(systemName: "dot.radiowaves.left.and.right")
                    .foregroundStyle(BrandTheme.accent)
            }

            Text(
                "Public delayed stream — amounts only, no bidder identity. Feed is briefly delayed to prevent front-running."
            )
            .font(.footnote)
            .foregroundStyle(BrandTheme.textSecondary)
            .fixedSize(horizontal: false, vertical: true)

            Text(feedNote)
                .font(.caption.weight(.medium).monospaced())
                .foregroundStyle(BrandTheme.goldBright)
                .fixedSize(horizontal: false, vertical: true)

            if let lastTickAt {
                Text("Last tick \(lastTickAt.formatted(date: .omitted, time: .standard))")
                    .font(.caption2)
                    .foregroundStyle(BrandTheme.textSecondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(BrandTheme.navyElevated.opacity(0.85))
                .overlay(
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .strokeBorder(BrandTheme.hairline, lineWidth: 1)
                )
        )
        .accessibilityElement(children: .combine)
    }

    private var leadingPriceDisplay: String {
        guard let cents = leadingCents, cents > 0 else {
            return "—"
        }
        return MoneyFormat.usd(cents: cents)
    }

    private var countdownText: String? {
        if let iso = endsAtISO, !iso.isEmpty {
            return CatalogDateFormat.countdownLabel(iso: iso)
        }
        if let date = endsAtDate {
            return CatalogDateFormat.countdownLabel(until: date)
        }
        return nil
    }

    // MARK: - Lifecycle

    @MainActor
    private func runLifecycle() async {
        guard scenePhase == .active else { return }
        connectSocket()
        await refreshSnapshot()
        while !Task.isCancelled {
            do {
                try await Task.sleep(nanoseconds: 4_000_000_000)
            } catch {
                return
            }
            guard !Task.isCancelled, scenePhase == .active else { return }
            await refreshSnapshot()
        }
    }

    @MainActor
    private func connectSocket() {
        switch target {
        case .job(let id, _, _, _):
            // Same pattern as JobDetailView: MainActor client delivers on MainActor.
            jobSpectator.onEvent = { event in
                handleJobEvent(event)
            }
            jobSpectator.connect(jobID: id)
            listingSpectator.disconnect()
            feedNote = "Job spectator stream · delayed public feed"
        case .listing(let id, _, _, _):
            listingSpectator.onEvent = { event in
                handleListingEvent(event)
            }
            listingSpectator.connect(listingID: id)
            jobSpectator.disconnect()
            feedNote = "Marketplace spectator stream · delayed public feed"
        }
    }

    private func teardown() {
        jobSpectator.onEvent = nil
        listingSpectator.onEvent = nil
        jobSpectator.disconnect()
        listingSpectator.disconnect()
    }

    @MainActor
    private func handleJobEvent(_ event: SpectatorWebSocketClient.ServerEvent) {
        switch event {
        case .bidEvent(let auctionEvent):
            if let cents = auctionEvent.amountCents, cents > 0 {
                // Reverse auction: lower is leading when we have a prior value.
                if let prev = leadingCents, prev > 0 {
                    applyLeading(min(prev, cents))
                } else {
                    applyLeading(cents)
                }
            }
            lastTickAt = Date()
            feedNote = "Bid activity · public delayed"
        case .spectatorCount(let count):
            spectatorCount = max(0, count)
        case .error(let message):
            feedNote = "Stream soft-fail · polling · \(message)"
        }
    }

    @MainActor
    private func handleListingEvent(_ event: MarketplaceSpectatorWebSocketClient.ServerEvent) {
        switch event {
        case .bidEvent(let liveEvent):
            if let cents = liveEvent.amountCents, cents > 0 {
                // Forward auction: higher is leading.
                if let prev = leadingCents, prev > 0 {
                    applyLeading(max(prev, cents))
                } else {
                    applyLeading(cents)
                }
            }
            if let ends = liveEvent.newAuctionEndsAt, !ends.isEmpty {
                endsAtISO = ends
                endsAtDate = CatalogDateFormat.parseISO(ends)
            }
            lastTickAt = Date()
            feedNote = liveEvent.snipeExtension
                ? "Time extended · public delayed"
                : "Bid activity · public delayed"
        case .spectatorCount(let count):
            spectatorCount = max(0, count)
        case .error(let message):
            feedNote = "Stream soft-fail · polling · \(message)"
        }
    }

    @MainActor
    private func applyLeading(_ cents: Int64) {
        guard cents > 0 else { return }
        if let prev = lastFlashedCents, prev != cents {
            priceFlashToken += 1
            BrandHaptics.light()
        }
        lastFlashedCents = cents
        leadingCents = cents
    }

    @MainActor
    private func refreshSnapshot() async {
        switch target {
        case .job(let id, _, _, _):
            do {
                let state = try await APIClient.shared.fetchJobAuctionState(jobId: id)
                if let lowest = state.lowestBidCents, lowest > 0 {
                    applyLeading(lowest)
                }
                if let ends = state.auctionEndsAt, !ends.isEmpty {
                    endsAtISO = ends
                    endsAtDate = CatalogDateFormat.parseISO(ends)
                }
                lastTickAt = Date()
                if !socketConnected {
                    feedNote = "Polling auction state"
                }
            } catch {
                // Soft-fail: try job detail for title/price seed.
                do {
                    let job = try await APIClient.shared.fetchJob(id: id)
                    title = job.displayTitle
                    if let start = job.startingBidCents, leadingCents == nil || (leadingCents ?? 0) == 0 {
                        leadingCents = start
                    }
                    if let ends = job.auctionEndsAt, !ends.isEmpty {
                        endsAtISO = ends
                        endsAtDate = CatalogDateFormat.parseISO(ends)
                    }
                    if !socketConnected {
                        feedNote = "Detail refresh · live state unavailable"
                    }
                } catch {
                    if !socketConnected {
                        feedNote = "Waiting for feed…"
                    }
                }
            }
        case .listing(let id, _, _, _):
            do {
                let listing = try await APIClient.shared.fetchListing(id: id)
                title = listing.displayTitle
                if let current = listing.currentBidCents, current > 0 {
                    applyLeading(current)
                } else if let start = listing.startingPriceCents, leadingCents == nil {
                    leadingCents = start
                }
                if let ends = listing.auctionEndsAt {
                    endsAtDate = ends
                    endsAtISO = ISO8601DateFormatter().string(from: ends)
                }
                if let watchers = listing.watcherCount, watchers > spectatorCount {
                    spectatorCount = watchers
                }
                lastTickAt = Date()
                if !socketConnected {
                    feedNote = "Polling listing detail"
                }
            } catch {
                if !socketConnected {
                    feedNote = "Waiting for feed…"
                }
            }
        }
    }
}

#Preview("Job spectate") {
    NavigationStack {
        SpectateTerminalView(
            target: .job(
                id: "preview-job",
                title: "Fix kitchen sink leak",
                leadingCents: 12_500,
                endsAtISO: ISO8601DateFormatter().string(from: Date().addingTimeInterval(3600))
            )
        )
    }
    .preferredColorScheme(.dark)
    .tint(BrandTheme.accent)
}

#Preview("Listing spectate") {
    NavigationStack {
        SpectateTerminalView(
            target: .listing(
                id: "preview-listing",
                title: "Mid-century oak dresser",
                leadingCents: 18_000,
                endsAt: Date().addingTimeInterval(7200)
            )
        )
    }
    .preferredColorScheme(.dark)
    .tint(BrandTheme.accent)
}

// IOS-A11Y.2: canvas check that the leading price grows (wraps) at accessibility 5.
#Preview("Job spectate AX5") {
    NavigationStack {
        SpectateTerminalView(
            target: .job(
                id: "preview-job-ax5",
                title: "Fix kitchen sink leak",
                leadingCents: 12_500,
                endsAtISO: ISO8601DateFormatter().string(from: Date().addingTimeInterval(3600))
            )
        )
    }
    .preferredColorScheme(.dark)
    .tint(BrandTheme.accent)
    .dynamicTypeSize(.accessibility5)
}
