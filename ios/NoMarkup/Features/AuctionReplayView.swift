import SwiftUI

/// Chronological auction replay desk — lightweight web-parity surface.
///
/// - **Job:** `GET …/jobs/{id}/auction/events` via `fetchJobAuctionEvents`.
/// - **Listing:** no dedicated iOS listing-events client yet; falls back to the
///   public bid ladder (`fetchListingBids`) as a static reverse-timeline, or a
///   brand empty state when the ladder is empty / unavailable.
struct AuctionReplayView: View {
    enum Target: Hashable {
        case job(id: String, title: String?)
        case listing(id: String, title: String?)
    }

    let target: Target

    @State private var loadState: LoadState = .loading
    @State private var rows: [ReplayRow] = []
    @State private var titleHint: String?

    init(target: Target) {
        self.target = target
        switch target {
        case let .job(_, title):
            _titleHint = State(initialValue: title)
        case let .listing(_, title):
            _titleHint = State(initialValue: title)
        }
    }

    private var entityID: String {
        switch target {
        case .job(let id, _): return id
        case .listing(let id, _): return id
        }
    }

    private var isJob: Bool {
        if case .job = target { return true }
        return false
    }

    private var navigationTitle: String {
        if let titleHint, !titleHint.isEmpty {
            return "Replay"
        }
        return "Auction replay"
    }

    var body: some View {
        Group {
            switch loadState {
            case .loading:
                BrandLoadingScreen(
                    kind: .catalog,
                    rows: 6,
                    accessibilityLabel: "Loading auction replay…"
                )
            case .failed(let message):
                BrandEmptyState(
                    title: "Couldn’t load replay",
                    systemImage: "exclamationmark.triangle",
                    message: message,
                    actionTitle: "Try again"
                ) {
                    Task { await load() }
                }
            case .empty:
                BrandEmptyState(
                    title: emptyTitle,
                    systemImage: "clock.arrow.circlepath",
                    message: emptyMessage,
                    actionTitle: "Refresh"
                ) {
                    Task { await load() }
                }
            case .loaded:
                replayList
            }
        }
        .brandScreenBackground()
        .navigationTitle(navigationTitle)
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .brandNavigationBarChrome()
        .task(id: entityID) { await load() }
        .refreshable { await load() }
        .accessibilityIdentifier(isJob ? "auctionReplay.job" : "auctionReplay.listing")
    }

    // MARK: - List

    private var replayList: some View {
        List {
            Section {
                if let titleHint, !titleHint.isEmpty {
                    Text(titleHint)
                        .font(.headline)
                        .foregroundStyle(BrandTheme.textPrimary)
                        .fixedSize(horizontal: false, vertical: true)
                        .listRowBackground(BrandTheme.navyElevated)
                        .accessibilityAddTraits(.isHeader)
                }
                Text(isJob ? "REVERSE AUCTION · CHRONOLOGICAL" : "FORWARD AUCTION · BID LADDER")
                    .font(.caption2.weight(.heavy).monospaced())
                    .tracking(0.8)
                    .foregroundStyle(BrandTheme.goldBright)
                    .listRowBackground(BrandTheme.navyElevated)
                    .accessibilityLabel(
                        isJob
                            ? "Reverse auction, chronological event replay"
                            : "Forward auction, static bid ladder replay"
                    )
            } footer: {
                Text(footerCopy)
                    .foregroundStyle(BrandTheme.textSecondary)
            }

            Section {
                ForEach(Array(rows.enumerated()), id: \.element.id) { index, row in
                    replayRow(row, index: index)
                        .listRowBackground(BrandTheme.navyElevated)
                }
            } header: {
                Text(isJob ? "Events" : "Bids").brandSectionHeader()
            }
        }
        .brandListBackground()
    }

    @ViewBuilder
    private func replayRow(_ row: ReplayRow, index: Int) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Text(String(format: "%02d", index + 1))
                .font(.caption.weight(.bold).monospaced())
                .foregroundStyle(BrandTheme.textSecondary)
                .frame(width: 28, alignment: .leading)
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 4) {
                Text(row.typeLabel)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(BrandTheme.textPrimary)
                Text(row.timeLabel)
                    .font(.caption.monospaced())
                    .foregroundStyle(BrandTheme.textSecondary)
            }

            Spacer(minLength: 8)

            if let amount = row.amountLabel {
                Text(amount)
                    .font(.subheadline.weight(.semibold).monospacedDigit())
                    .foregroundStyle(BrandTheme.goldBright)
            }
        }
        .frame(minHeight: 44)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(row.accessibilityLabel)
    }

    // MARK: - Copy

    private var emptyTitle: String {
        isJob ? "No auction events yet" : "Goods replay unavailable"
    }

    private var emptyMessage: String {
        if isJob {
            return "When providers place reverse bids, they appear here in chronological order with amount, type, and time."
        }
        return "Replay uses job auction events; goods replay coming soon. Bid ladder data was empty for this listing."
    }

    private var footerCopy: String {
        if isJob {
            return "Public job auction events · oldest first · amounts monospaced."
        }
        return "Static snapshot from the public listing bid ladder (not a full event stream)."
    }

    // MARK: - Load

    @MainActor
    private func load() async {
        let wasEmpty = rows.isEmpty
        if wasEmpty {
            loadState = .loading
        }
        do {
            switch target {
            case .job(let id, let title):
                if let title, !title.isEmpty { titleHint = title }
                let events = try await APIClient.shared.fetchJobAuctionEvents(jobId: id)
                rows = Self.rows(fromJobEvents: events)
                loadState = rows.isEmpty ? .empty : .loaded
            case .listing(let id, let title):
                if let title, !title.isEmpty { titleHint = title }
                // Prefer public bid ladder as a static replay when a dedicated
                // listing-events client is not wired. Soft-fail to brand empty.
                let response = try await APIClient.shared.fetchListingBids(listingId: id)
                rows = Self.rows(fromListingBids: response.bids)
                loadState = rows.isEmpty ? .empty : .loaded
            }
        } catch {
            if rows.isEmpty {
                // Listing without a ladder / 404: honest empty for goods; error for jobs.
                if !isJob, Self.isSoftFailure(error) {
                    loadState = .empty
                } else {
                    loadState = .failed(error.localizedDescription)
                }
            }
        }
    }

    private static func isSoftFailure(_ error: Error) -> Bool {
        guard let api = error as? APIClientError else { return false }
        return api.isNotFound || api.isForbidden
    }

    /// Oldest-first chronological order for job events.
    private static func rows(fromJobEvents events: [AuctionEvent]) -> [ReplayRow] {
        let sorted = events.sorted { lhs, rhs in
            let left = CatalogDateFormat.parseISO(lhs.createdAt ?? "") ?? .distantPast
            let right = CatalogDateFormat.parseISO(rhs.createdAt ?? "") ?? .distantPast
            if left != right { return left < right }
            return lhs.id < rhs.id
        }
        return sorted.map { event in
            let amount: String?
            if let cents = event.amountCents, cents > 0 {
                amount = MoneyFormat.usd(cents: cents)
            } else {
                amount = nil
            }
            let time: String
            if let created = event.createdAt, !created.isEmpty {
                time = CatalogDateFormat.friendlyDateTime(created)
            } else {
                time = "—"
            }
            return ReplayRow(
                id: event.id,
                typeLabel: event.displayEventLabel,
                amountLabel: amount,
                timeLabel: time
            )
        }
    }

    /// Chronological (created ascending) listing bids as a static replay stand-in.
    private static func rows(fromListingBids bids: [ListingBidRow]) -> [ReplayRow] {
        let sorted = bids.sorted { lhs, rhs in
            let left = CatalogDateFormat.parseISO(lhs.createdAt ?? "") ?? .distantPast
            let right = CatalogDateFormat.parseISO(rhs.createdAt ?? "") ?? .distantPast
            if left != right { return left < right }
            return (lhs.amountCents ?? 0) < (rhs.amountCents ?? 0)
        }
        return sorted.map { bid in
            let time: String
            if let created = bid.createdAt, !created.isEmpty {
                time = CatalogDateFormat.friendlyDateTime(created)
            } else {
                time = "—"
            }
            let type: String
            if bid.isWinning == true {
                type = "Leading bid · \(bid.displayName)"
            } else {
                type = "Bid · \(bid.displayName)"
            }
            return ReplayRow(
                id: bid.id,
                typeLabel: type,
                amountLabel: bid.amountCents.map { MoneyFormat.usd(cents: $0) },
                timeLabel: time
            )
        }
    }
}

// MARK: - Models

private enum LoadState: Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

private struct ReplayRow: Identifiable, Hashable {
    let id: String
    let typeLabel: String
    let amountLabel: String?
    let timeLabel: String

    var accessibilityLabel: String {
        var parts = [typeLabel]
        if let amountLabel {
            parts.append(amountLabel)
        }
        parts.append(timeLabel)
        return parts.joined(separator: ", ")
    }
}

#Preview("Job replay") {
    NavigationStack {
        AuctionReplayView(
            target: .job(
                id: "00000000-0000-0000-0000-000000000002",
                title: "Lawn mowing — front yard"
            )
        )
    }
    .preferredColorScheme(.dark)
    .tint(BrandTheme.accent)
}

#Preview("Listing replay") {
    NavigationStack {
        AuctionReplayView(
            target: .listing(
                id: "00000000-0000-0000-0000-000000000099",
                title: "Mid-century oak dresser"
            )
        )
    }
    .preferredColorScheme(.dark)
    .tint(BrandTheme.accent)
}
