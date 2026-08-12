import SwiftUI

/// Goods + services bid history for the signed-in user.
///
/// - Goods: `GET /api/v1/listings/bids/mine`
/// - Services: `GET /api/v1/bids/mine`
///
/// Service bids support FR-4.3 lower-bid (`PATCH /api/v1/bids/{id}`) and withdraw.
struct MyBidsView: View {
    private enum Segment: String, CaseIterable, Identifiable {
        case goods = "Goods"
        case services = "Services"
        var id: String { rawValue }
    }

    /// FR-4.6 lite — client-side sort for service bids.
    private enum ServiceSort: String, CaseIterable, Identifiable {
        case newest = "Newest"
        case priceLow = "Price ↓"
        case priceHigh = "Price ↑"
        var id: String { rawValue }
    }

    @EnvironmentObject private var auth: AuthViewModel

    @State private var segment: Segment = .goods
    @State private var listingBids: [MyListingBidEntry] = []
    @State private var jobBids: [MyJobBidRow] = []
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var needsSignIn = false
    @State private var withdrawingBidID: String?
    @State private var withdrawMessage: String?
    @State private var withdrawIsError = false

    /// Goods eBay-style 60s retract (leading bid only).
    @State private var retractingBidID: String?
    @State private var retractMessage: String?
    @State private var retractIsError = false

    @State private var serviceSort: ServiceSort = .newest
    @State private var loweringBid: MyJobBidRow?
    @State private var lowerAmountText = ""
    @State private var isLoweringBid = false
    @State private var lowerBidMessage: String?
    @State private var lowerBidIsError = false

    private var sortedJobBids: [MyJobBidRow] {
        switch serviceSort {
        case .newest:
            return jobBids.sorted { lhs, rhs in
                let a = lhs.createdAt ?? ""
                let b = rhs.createdAt ?? ""
                if a != b { return a > b }
                return (lhs.amountCents ?? 0) < (rhs.amountCents ?? 0)
            }
        case .priceLow:
            return jobBids.sorted {
                ($0.amountCents ?? Int64.max) < ($1.amountCents ?? Int64.max)
            }
        case .priceHigh:
            return jobBids.sorted {
                ($0.amountCents ?? 0) > ($1.amountCents ?? 0)
            }
        }
    }

    var body: some View {
        Group {
            if auth.isScaffoldSession {
                BrandEmptyState(
                    title: "Sign in required",
                    systemImage: "hammer",
                    message: "Browse-only mode has no API credentials. Sign in against a live gateway to load your bids."
                )
            } else if needsSignIn || !auth.isAuthenticated {
                BrandEmptyState(
                    title: "Sign in required",
                    systemImage: "person.crop.circle.badge.exclamationmark",
                    message: "Sign in to see goods and service bids you’ve placed — reverse-auction jobs and local listings.",
                    actionTitle: "Sign in"
                ) {
                    auth.signOut()
                }
            } else {
                VStack(spacing: 0) {
                    Picker("Bid type", selection: $segment) {
                        ForEach(Segment.allCases) { s in
                            Text(s.rawValue).tag(s)
                        }
                    }
                    .pickerStyle(.segmented)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 10)
                    .background(BrandTheme.navy)

                    content
                }
            }
        }
        .navigationTitle("My bids")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .brandNavigationBarChrome()
        .task(id: segment) { await load() }
        .refreshable { await load() }
        .sheet(item: $loweringBid) { bid in
            lowerBidSheet(bid)
        }
    }

    @ViewBuilder
    private var content: some View {
        if isLoading && currentListIsEmpty {
            BrandLoadingScreen(kind: .catalog, rows: 5, accessibilityLabel: "Loading bids…")
        } else if let errorMessage, currentListIsEmpty {
            BrandEmptyState(
                title: "Couldn’t load bids",
                systemImage: "exclamationmark.triangle",
                message: errorMessage,
                actionTitle: "Try again"
            ) {
                Task { await load() }
            }
        } else if currentListIsEmpty {
            BrandEmptyState(
                title: segment == .goods ? "No goods bids yet" : "No service bids yet",
                systemImage: "hammer.circle",
                message: segment == .goods
                    ? "When you bid up on local marketplace listings, they show up here."
                    : "When you bid down on service jobs as a provider, they show up here — lower price wins."
            )
        } else {
            List {
                switch segment {
                case .goods:
                    if let retractMessage {
                        Section {
                            Text(retractMessage)
                                .font(.footnote)
                                .foregroundStyle(retractIsError ? BrandTheme.destructive : BrandTheme.success)
                                .listRowBackground(BrandTheme.navyElevated)
                        }
                    }
                    Section {
                        ForEach(listingBids) { entry in
                            listingBidRow(entry)
                                .listRowBackground(BrandTheme.navyElevated)
                                .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                                    if entry.canRetract() {
                                        Button(role: .destructive) {
                                            Task { await retractListingBid(entry) }
                                        } label: {
                                            Label("Retract", systemImage: "arrow.uturn.backward")
                                        }
                                        .disabled(retractingBidID != nil)
                                        .accessibilityLabel("Retract goods bid")
                                    }
                                }
                                // DES.7 — non-gesture mirror of the swipe-only retract
                                // (VoiceOver / pointer / full-keyboard), matching the
                                // service-bid context menu below.
                                .contextMenu {
                                    if entry.canRetract() {
                                        Button(role: .destructive) {
                                            Task { await retractListingBid(entry) }
                                        } label: {
                                            Label("Retract bid", systemImage: "arrow.uturn.backward")
                                        }
                                        .disabled(retractingBidID != nil)
                                    }
                                }
                        }
                    } header: {
                        Text(String(localized: "\(listingBids.count) bids")).brandSectionHeader()
                    } footer: {
                        Text("Forward auction: highest bid leads. Winning high bids can be retracted within 60 seconds of placement.")
                            .foregroundStyle(BrandTheme.textSecondary)
                    }
                case .services:
                    if jobBids.count > 1 {
                        Section {
                            Picker("Sort", selection: $serviceSort) {
                                ForEach(ServiceSort.allCases) { mode in
                                    Text(mode.rawValue).tag(mode)
                                }
                            }
                            .pickerStyle(.segmented)
                            .listRowBackground(BrandTheme.navyElevated)
                            .accessibilityLabel("Sort service bids")
                        }
                    }
                    if let withdrawMessage {
                        Section {
                            Text(withdrawMessage)
                                .font(.footnote)
                                .foregroundStyle(withdrawIsError ? BrandTheme.destructive : BrandTheme.success)
                                .listRowBackground(BrandTheme.navyElevated)
                        }
                    }
                    if let lowerBidMessage {
                        Section {
                            Text(lowerBidMessage)
                                .font(.footnote)
                                .foregroundStyle(lowerBidIsError ? BrandTheme.destructive : BrandTheme.success)
                                .listRowBackground(BrandTheme.navyElevated)
                        }
                    }
                    Section {
                        ForEach(sortedJobBids) { bid in
                            jobBidRow(bid)
                                .listRowBackground(BrandTheme.navyElevated)
                                .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                                    if bid.isWithdrawable {
                                        Button(role: .destructive) {
                                            Task { await withdrawServiceBid(bid) }
                                        } label: {
                                            Label("Withdraw", systemImage: "arrow.uturn.backward")
                                        }
                                        .disabled(withdrawingBidID != nil)
                                        .accessibilityLabel("Withdraw service bid")
                                    }
                                }
                                .swipeActions(edge: .leading, allowsFullSwipe: false) {
                                    if bid.isLowerable {
                                        Button {
                                            beginLowerBid(bid)
                                        } label: {
                                            Label("Lower", systemImage: "arrow.down.circle")
                                        }
                                        .tint(BrandTheme.accent)
                                        .disabled(isLoweringBid)
                                        .accessibilityLabel("Lower service bid")
                                    }
                                }
                                .contextMenu {
                                    if bid.isLowerable {
                                        Button {
                                            beginLowerBid(bid)
                                        } label: {
                                            Label("Lower bid", systemImage: "arrow.down.circle")
                                        }
                                        .disabled(isLoweringBid)
                                    }
                                    if bid.isWithdrawable {
                                        Button(role: .destructive) {
                                            Task { await withdrawServiceBid(bid) }
                                        } label: {
                                            Label("Withdraw bid", systemImage: "arrow.uturn.backward")
                                        }
                                        .disabled(withdrawingBidID != nil)
                                    }
                                }
                        }
                    } header: {
                        Text(String(localized: "\(jobBids.count) bids")).brandSectionHeader()
                    } footer: {
                        Text("Reverse auction: providers compete down. Lower price is more competitive. Swipe right to lower, left to withdraw active bids.")
                            .foregroundStyle(BrandTheme.textSecondary)
                    }
                }
            }
            .brandListBackground()
        }
    }

    private var currentListIsEmpty: Bool {
        switch segment {
        case .goods: return listingBids.isEmpty
        case .services: return jobBids.isEmpty
        }
    }

    @ViewBuilder
    private func listingBidRow(_ entry: MyListingBidEntry) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline) {
                Group {
                    if let listingId = entry.listingIdForAPI {
                        NavigationLink {
                            LazyView { ListingDetailView(listingID: listingId) }
                        } label: {
                            Text(entry.displayTitle)
                                .font(.body.weight(.medium))
                                .foregroundStyle(BrandTheme.textPrimary)
                                .lineLimit(2)
                                .multilineTextAlignment(.leading)
                        }
                    } else {
                        Text(entry.displayTitle)
                            .font(.body.weight(.medium))
                            .foregroundStyle(BrandTheme.textPrimary)
                            .lineLimit(2)
                    }
                }
                Spacer(minLength: 8)
                Text(entry.displayAmount)
                    .font(.subheadline.weight(.bold).monospacedDigit())
                    .foregroundStyle(entry.isWinning ? BrandTheme.bidWinning : BrandTheme.goldBright)
                    .contentTransition(.numericText())
            }
            HStack(spacing: 8) {
                if entry.isWinning {
                    Text("Winning")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(BrandTheme.ctaLabelOnGold)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 2)
                        .background(Capsule().fill(BrandTheme.successFill))
                } else {
                    Text("Outbid / active")
                        .font(.caption2.weight(.medium))
                        .foregroundStyle(BrandTheme.bidActive)
                }
                if Self.isLiveListingStatus(entry.listing?.status) {
                    HStack(spacing: 4) {
                        LivePulseDot()
                        Text("LIVE")
                            .font(.caption2.weight(.bold).monospaced())
                            .tracking(0.4)
                            .foregroundStyle(BrandTheme.success)
                    }
                    .accessibilityElement(children: .combine)
                    .accessibilityLabel("Live auction")
                } else if let status = entry.listing?.status, !status.isEmpty {
                    Text(StatusChipStyle.displayLabel(status))
                        .font(.caption2)
                        .foregroundStyle(BrandTheme.textSecondary)
                }
                if let created = entry.bid?.createdAt, !created.isEmpty {
                    Text(CatalogDateFormat.friendlyDateTime(created))
                        .font(.caption2)
                        .foregroundStyle(BrandTheme.textSecondary.opacity(0.85))
                }
                if retractingBidID == entry.id {
                    ProgressView()
                        .tint(BrandTheme.accent)
                        .controlSize(.small)
                }
            }
            // eBay-style 60s retract for the viewer's leading active bid only.
            TimelineView(.periodic(from: .now, by: 1)) { context in
                if entry.canRetract(now: context.date) {
                    Button(role: .destructive) {
                        Task { await retractListingBid(entry) }
                    } label: {
                        if retractingBidID == entry.id {
                            ProgressView()
                                .tint(BrandTheme.destructive)
                                .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                        } else {
                            let remaining = entry.retractSecondsRemaining(now: context.date)
                            Label(
                                remaining.map { "Retract bid (\($0)s)" } ?? "Retract bid",
                                systemImage: "arrow.uturn.backward"
                            )
                            .font(.caption.weight(.semibold))
                            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                        }
                    }
                    .tint(BrandTheme.destructive)
                    .disabled(retractingBidID != nil)
                    .accessibilityHint("Retract your high bid within 60 seconds of placing it")
                }
            }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder
    private func jobBidRow(_ bid: MyJobBidRow) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline) {
                Group {
                    if let jobId = bid.jobId, !jobId.isEmpty {
                        NavigationLink {
                            LazyView { JobDetailView(jobID: jobId) }
                        } label: {
                            Text(bid.displayTitle)
                                .font(.body.weight(.medium))
                                .foregroundStyle(BrandTheme.textPrimary)
                                .multilineTextAlignment(.leading)
                        }
                    } else {
                        Text(bid.displayTitle)
                            .font(.body.weight(.medium))
                            .foregroundStyle(BrandTheme.textPrimary)
                    }
                }
                Spacer(minLength: 8)
                Text(bid.displayAmount)
                    .font(.subheadline.weight(.bold).monospacedDigit())
                    .foregroundStyle(BrandTheme.goldBright)
                    .contentTransition(.numericText())
            }
            HStack(spacing: 8) {
                Text(bid.displayStatus)
                    .font(.caption2.weight(.medium))
                    .foregroundStyle(statusColor(bid.status))
                if bid.isOfferAccepted == true {
                    Text("Accepted")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(BrandTheme.ctaLabelOnGold)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 2)
                        .background(Capsule().fill(BrandTheme.successFill))
                }
                if let created = bid.createdAt, !created.isEmpty {
                    Text(CatalogDateFormat.friendlyDateTime(created))
                        .font(.caption2)
                        .foregroundStyle(BrandTheme.textSecondary.opacity(0.85))
                }
                if withdrawingBidID == bid.id {
                    ProgressView()
                        .tint(BrandTheme.accent)
                        .controlSize(.small)
                }
            }
            if bid.isLowerable || bid.isWithdrawable {
                HStack(spacing: 12) {
                    if bid.isLowerable {
                        Button {
                            beginLowerBid(bid)
                        } label: {
                            Text("Lower bid")
                                .font(.caption.weight(.semibold))
                                .frame(minHeight: 44)
                        }
                        .tint(BrandTheme.accent)
                        .disabled(isLoweringBid || withdrawingBidID != nil)
                        .accessibilityLabel("Lower service bid of \(bid.displayAmount)")
                    }
                    if bid.isWithdrawable {
                        Button(role: .destructive) {
                            Task { await withdrawServiceBid(bid) }
                        } label: {
                            Text(withdrawingBidID == bid.id ? "Withdrawing…" : "Withdraw bid")
                                .font(.caption.weight(.semibold))
                                .frame(minHeight: 44)
                        }
                        .disabled(withdrawingBidID != nil || isLoweringBid)
                        .accessibilityLabel("Withdraw service bid of \(bid.displayAmount)")
                    }
                }
            }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder
    private func lowerBidSheet(_ bid: MyJobBidRow) -> some View {
        NavigationStack {
            Form {
                Section {
                    LabeledContent("Current bid", value: bid.displayAmount)
                    if let jobId = bid.jobId, !jobId.isEmpty {
                        LabeledContent("Job", value: String(jobId.prefix(8)) + "…")
                    }
                    Text("Reverse auction: you can only lower this bid, never raise it.")
                        .font(.footnote)
                        .foregroundStyle(BrandTheme.textSecondary)
                } header: {
                    Text("Your bid").brandSectionHeader()
                }

                Section {
                    DollarAmountField(
                        text: $lowerAmountText,
                        placeholder: "0.00",
                        accessibilityLabelText: "New lower bid amount in dollars"
                    )
                    if let lowerBidMessage, loweringBid?.id == bid.id {
                        Text(lowerBidMessage)
                            .font(.footnote)
                            .foregroundStyle(lowerBidIsError ? BrandTheme.destructive : BrandTheme.success)
                    }
                    Button {
                        Task { await submitLowerBid(bid) }
                    } label: {
                        if isLoweringBid {
                            ProgressView()
                                .tint(BrandTheme.ctaLabelOnGold)
                                .frame(maxWidth: .infinity, minHeight: 44)
                        } else if let cents = MoneyFormat.cents(fromDollarsText: lowerAmountText) {
                            Text("Lower to \(MoneyFormat.usd(cents: cents))")
                                .frame(maxWidth: .infinity, minHeight: 44)
                        } else {
                            Text("Lower bid")
                                .frame(maxWidth: .infinity, minHeight: 44)
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(BrandTheme.accent)
                    .foregroundStyle(BrandTheme.ctaLabelOnGold)
                    .disabled(isLoweringBid || MoneyFormat.cents(fromDollarsText: lowerAmountText) == nil)
                } header: {
                    Text("New amount (dollars)").brandSectionHeader()
                } footer: {
                    if let current = bid.amountCents {
                        Text("Must be strictly less than \(MoneyFormat.usd(cents: current)). Server rejects raises.")
                            .foregroundStyle(BrandTheme.textSecondary)
                    }
                }
            }
            .brandListBackground()
            .navigationTitle("Lower bid")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        loweringBid = nil
                        lowerAmountText = ""
                        lowerBidMessage = nil
                    }
                    .frame(minHeight: 44)
                    .disabled(isLoweringBid)
                }
            }
        }
        .presentationDetents([.medium, .large])
        .tint(BrandTheme.accent)
    }

    private func statusColor(_ raw: String?) -> Color {
        switch StatusChipStyle.forStatus(raw) {
        case .success: return BrandTheme.bidWinning
        case .info: return BrandTheme.bidActive
        case .warning: return BrandTheme.warning
        case .danger: return BrandTheme.destructive
        case .neutral: return BrandTheme.textSecondary
        }
    }

    private static func isLiveListingStatus(_ raw: String?) -> Bool {
        let status = (raw ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        switch status {
        case "active", "open", "live", "bidding":
            return true
        default:
            return false
        }
    }

    private func beginLowerBid(_ bid: MyJobBidRow) {
        lowerBidMessage = nil
        lowerBidIsError = false
        lowerAmountText = ""
        loweringBid = bid
    }

    @MainActor
    private func load() async {
        if auth.isScaffoldSession || !auth.isAuthenticated {
            listingBids = []
            jobBids = []
            needsSignIn = !auth.isAuthenticated && !auth.isScaffoldSession
            return
        }

        isLoading = true
        errorMessage = nil
        needsSignIn = false
        withdrawMessage = nil
        retractMessage = nil
        lowerBidMessage = nil
        defer { isLoading = false }

        do {
            switch segment {
            case .goods:
                let response = try await APIClient.shared.fetchMyListingBids(page: 1, pageSize: 40)
                listingBids = response.bids
            case .services:
                let response = try await APIClient.shared.fetchMyJobBids(page: 1, pageSize: 40)
                jobBids = response.bids
            }
            // IOS-SYS.WD.3 — refresh the widget snapshot from the fresh authoritative list.
            syncWidgetActiveBidCount()
        } catch let error as APIClientError where error.isUnauthorized {
            listingBids = []
            jobBids = []
            needsSignIn = true
        } catch {
            if currentListIsEmpty {
                errorMessage = error.localizedDescription
            }
        }
    }

    /// IOS-SYS.WD.3 (caller half) — merge the just-fetched rail into the widget
    /// snapshot. Switching Goods/Services must not zero the other rail's count
    /// or wipe its Next Closing rows.
    private func syncWidgetActiveBidCount() {
        switch segment {
        case .goods:
            let activeGoods = listingBids.filter { entry in
                let status = (entry.listing?.status ?? "")
                    .trimmingCharacters(in: .whitespacesAndNewlines)
                    .lowercased()
                return status == "active" || status == "open"
            }.count
            let auctions: [WidgetSharedStore.AuctionSnapshot] = listingBids.compactMap { entry in
                guard let listingID = entry.listingIdForAPI,
                      let endsISO = entry.listing?.auctionEndsAt,
                      let endsAt = CatalogDateFormat.parseISO(endsISO),
                      endsAt > Date()
                else { return nil }
                return WidgetSharedStore.AuctionSnapshot(
                    id: listingID,
                    title: entry.listing?.displayTitle ?? entry.displayTitle,
                    endsAt: endsAt,
                    amountCents: entry.listing?.currentBidCents ?? entry.bid?.amountCents ?? 0,
                    kind: WidgetSharedStore.BidRail.goods.kind
                )
            }
            WidgetSharedStore.replaceRail(.goods, activeCount: activeGoods, auctions: auctions)
        case .services:
            let activeServices = jobBids.filter { $0.isWithdrawable }.count
            // `GET /bids/mine` has no auction_ends_at — keep existing job closings.
            WidgetSharedStore.replaceRail(.services, activeCount: activeServices)
        }
    }

    /// POST `/api/v1/listings/{id}/bids/{bidId}/retract` — 60s window, leading bid only.
    /// Auth required; server re-validates ownership + window (UI gate is best-effort).
    @MainActor
    private func retractListingBid(_ entry: MyListingBidEntry) async {
        retractMessage = nil
        retractIsError = false

        guard !auth.isScaffoldSession, auth.isAuthenticated else {
            retractIsError = true
            retractMessage = "Sign in required to retract a goods bid."
            return
        }
        guard entry.canRetract() else {
            retractIsError = true
            retractMessage = "Only your winning bid can be retracted within 60 seconds of placement."
            return
        }
        guard let listingId = entry.listingIdForAPI, let bidId = entry.bidIdForAPI else {
            retractIsError = true
            retractMessage = "Missing listing or bid id — open the listing to retract."
            return
        }
        guard retractingBidID == nil else { return }

        retractingBidID = entry.id
        defer { retractingBidID = nil }

        do {
            _ = try await APIClient.shared.retractListingBid(
                listingId: listingId,
                bidId: bidId
            )
            listingBids.removeAll { $0.id == entry.id }
            // IOS-SYS.LA.1 — retracting the bid ends this auction's Live Activity
            // (controller no-ops when ActivityKit / Live Activities are unavailable,
            // same best-effort call shape as the ListingDetailView start site).
            AuctionLiveActivityController.end(auctionID: listingId)
            syncWidgetActiveBidCount()
            retractIsError = false
            retractMessage = "Bid retracted: \(entry.displayAmount)."
        } catch let error as APIClientError where error.isUnauthorized {
            retractIsError = true
            retractMessage = "Sign in required. Your session is missing or expired — please sign in again."
            needsSignIn = true
        } catch {
            retractIsError = true
            retractMessage = error.localizedDescription
        }
    }

    @MainActor
    private func withdrawServiceBid(_ bid: MyJobBidRow) async {
        guard bid.isWithdrawable else { return }
        guard !auth.isScaffoldSession, auth.isAuthenticated else {
            withdrawIsError = true
            withdrawMessage = "Sign in required to withdraw a service bid."
            return
        }
        guard withdrawingBidID == nil else { return }

        withdrawingBidID = bid.id
        withdrawMessage = nil
        withdrawIsError = false
        defer { withdrawingBidID = nil }

        do {
            try await APIClient.shared.withdrawJobBid(id: bid.id)
            if let idx = jobBids.firstIndex(where: { $0.id == bid.id }) {
                jobBids[idx] = bid.markedWithdrawn()
            }
            // IOS-SYS.LA.1 — withdrawing the service bid ends the job's Live Activity
            // (controller no-ops when ActivityKit / Live Activities are unavailable,
            // same best-effort call shape as the JobDetailView start site).
            if let jobId = bid.jobId, !jobId.isEmpty {
                AuctionLiveActivityController.end(auctionID: jobId)
            }
            syncWidgetActiveBidCount()
            withdrawIsError = false
            withdrawMessage = "Bid withdrawn: \(bid.displayAmount)."
        } catch let error as APIClientError where error.isUnauthorized {
            withdrawIsError = true
            withdrawMessage = "Sign in required. Your session is missing or expired — please sign in again."
            needsSignIn = true
        } catch {
            withdrawIsError = true
            withdrawMessage = error.localizedDescription
        }
    }

    @MainActor
    private func submitLowerBid(_ bid: MyJobBidRow) async {
        lowerBidMessage = nil
        lowerBidIsError = false

        guard bid.isLowerable else {
            lowerBidIsError = true
            lowerBidMessage = "Only active service bids can be lowered."
            return
        }
        guard !auth.isScaffoldSession, auth.isAuthenticated else {
            lowerBidIsError = true
            lowerBidMessage = "Sign in required to lower a service bid."
            return
        }
        guard let cents = MoneyFormat.cents(fromDollarsText: lowerAmountText) else {
            lowerBidIsError = true
            lowerBidMessage =
                "Enter a valid dollar amount (for example 75.00). Do not enter cents — $75 is 75, not 7500."
            return
        }
        if let current = bid.amountCents,
           let err = BidAmountRules.validateLowerOnly(currentCents: current, newCents: cents)
        {
            lowerBidIsError = true
            lowerBidMessage = err
            return
        }

        isLoweringBid = true
        defer { isLoweringBid = false }

        do {
            _ = try await APIClient.shared.updateJobBid(id: bid.id, newAmountCents: cents)
            if let idx = jobBids.firstIndex(where: { $0.id == bid.id }) {
                jobBids[idx] = bid.markedLowered(to: cents)
            }
            lowerBidIsError = false
            lowerBidMessage = "Bid lowered to \(MoneyFormat.usd(cents: cents))."
            lowerAmountText = ""
            loweringBid = nil
            // Surface success on the list after sheet dismisses.
            lowerBidIsError = false
            lowerBidMessage = "Bid lowered to \(MoneyFormat.usd(cents: cents))."
        } catch let error as APIClientError where error.isUnauthorized {
            lowerBidIsError = true
            lowerBidMessage = "Sign in required. Your session is missing or expired — please sign in again."
            needsSignIn = true
        } catch {
            lowerBidIsError = true
            lowerBidMessage = error.localizedDescription
        }
    }
}

#Preview {
    NavigationStack {
        MyBidsView()
    }
    .environmentObject(AuthViewModel())
    .preferredColorScheme(.dark)
    .tint(BrandTheme.accent)
}
