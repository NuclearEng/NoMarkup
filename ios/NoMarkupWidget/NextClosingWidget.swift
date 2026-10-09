import AppIntents
import SwiftUI
import WidgetKit

/// Focused countdown for the soonest-closing auction the user is tracking.
///
/// IOS-SYS.WD.4: user-configurable via edit-widget — pin one auction and/or
/// filter jobs vs listings. The default configuration (no pinned auction,
/// "Jobs & listings") behaves exactly like the original static widget:
/// soonest-closing across everything.
struct NextClosingWidget: Widget {
    let kind = WidgetSharedStore.nextClosingWidgetKind

    var body: some WidgetConfiguration {
        AppIntentConfiguration(
            kind: kind,
            intent: NextClosingConfigurationIntent.self,
            provider: NextClosingProvider()
        ) { entry in
            NextClosingWidgetView(entry: entry)
                .containerBackground(for: .widget) {
                    WidgetBrand.background
                }
        }
        .configurationDisplayName("Next Closing")
        .description("Countdown to your next auction close. Edit the widget to pin one auction or filter jobs vs listings.")
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryRectangular])
    }
}

/// Edit-widget configuration: optional pinned auction + kind filter (IOS-SYS.WD.4).
/// `AuctionEntity` / `AuctionKindFilter` live in `Core/WidgetSharedStore.swift`
/// so both the app and this extension compile them.
struct NextClosingConfigurationIntent: WidgetConfigurationIntent {
    static var title: LocalizedStringResource { "Next Closing" }
    static var description: IntentDescription {
        IntentDescription("Choose which auction the countdown follows.")
    }

    /// Specific auction to pin. Empty = automatic (soonest closing).
    @Parameter(title: "Auction")
    var auction: AuctionEntity?

    /// Restrict the automatic pick to service jobs / marketplace listings.
    @Parameter(title: "Show", default: .both)
    var kindFilter: AuctionKindFilter
}

struct NextClosingEntry: TimelineEntry {
    let date: Date
    let title: String
    let endsAt: Date?
    let amountLabel: String
    let deepLink: URL?

    /// IOS-SYS.WD.3(c): smart-stack relevance — scored by time-to-close
    /// (closer = higher), for the remaining duration.
    var relevance: TimelineEntryRelevance? {
        guard let endsAt, endsAt > date else { return nil }
        return TimelineEntryRelevance(
            score: WidgetSharedStore.relevanceScore(endsAt: endsAt, now: date),
            duration: endsAt.timeIntervalSince(date)
        )
    }
}

struct NextClosingProvider: AppIntentTimelineProvider {
    func placeholder(in context: Context) -> NextClosingEntry {
        // Honest empty — gallery / first paint must not look like a live auction.
        NextClosingEntry(
            date: Date(),
            title: "No active bids",
            endsAt: nil,
            amountLabel: "—",
            deepLink: URL(string: "nomarkup://bids")
        )
    }

    func snapshot(for configuration: NextClosingConfigurationIntent, in context: Context) async -> NextClosingEntry {
        makeEntry(configuration: configuration)
    }

    func timeline(for configuration: NextClosingConfigurationIntent, in context: Context) async -> Timeline<NextClosingEntry> {
        let entry = makeEntry(configuration: configuration)
        var entries: [NextClosingEntry] = [entry]
        // Refresh when the auction ends so the widget can flip to empty state.
        if let ends = entry.endsAt, ends > Date() {
            entries.append(
                NextClosingEntry(
                    date: ends,
                    title: "No active bids",
                    endsAt: nil,
                    amountLabel: "—",
                    deepLink: URL(string: "nomarkup://bids")
                )
            )
            return Timeline(entries: entries, policy: .after(ends))
        }
        let next = Calendar.current.date(byAdding: .minute, value: 30, to: Date()) ?? Date().addingTimeInterval(1800)
        return Timeline(entries: entries, policy: .after(next))
    }

    private func makeEntry(configuration: NextClosingConfigurationIntent) -> NextClosingEntry {
        let snap = WidgetSharedStore.load()
        if let next = selectAuction(from: snap, configuration: configuration) {
            let dollars = Double(next.amountCents) / 100.0
            let amount = dollars.formatted(.currency(code: "USD"))
            let linkKind = next.kind == "listing" ? "listings" : "jobs"
            return NextClosingEntry(
                date: Date(),
                title: next.title,
                endsAt: next.endsAt,
                amountLabel: amount,
                deepLink: URL(string: "nomarkup://\(linkKind)/\(next.id)")
            )
        }
        return NextClosingEntry(
            date: Date(),
            title: "No active bids",
            endsAt: nil,
            amountLabel: "—",
            deepLink: URL(string: "nomarkup://bids")
        )
    }

    /// Pinned auction wins while it is still live; otherwise automatic —
    /// soonest closing within the kind filter (default filter = everything,
    /// identical to the pre-configuration behavior).
    private func selectAuction(
        from snap: WidgetSharedStore.Snapshot,
        configuration: NextClosingConfigurationIntent
    ) -> WidgetSharedStore.AuctionSnapshot? {
        let future = snap.auctions.filter { $0.endsAt > Date() }
        if let pinned = configuration.auction,
           let match = future.first(where: { $0.id == pinned.id })
        {
            return match
        }
        return future
            .filter { configuration.kindFilter.matches(kind: $0.kind) }
            .sorted { $0.endsAt < $1.endsAt }
            .first
    }
}

struct NextClosingWidgetView: View {
    @Environment(\.widgetFamily) private var family
    /// IOS-A11Y.3: brighter gold under Increase Contrast.
    @Environment(\.colorSchemeContrast) private var contrast
    let entry: NextClosingEntry

    var body: some View {
        Group {
            if family == .accessoryRectangular {
                VStack(alignment: .leading, spacing: 2) {
                    Text(entry.title)
                        .font(.caption.weight(.semibold))
                        .lineLimit(1)
                    if let ends = entry.endsAt, ends > Date() {
                        Text(timerInterval: Date()...ends, countsDown: true)
                            .font(.caption.monospacedDigit())
                    } else {
                        Text("Idle")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Next closing")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(WidgetBrand.gold(for: contrast))
                    Text(entry.title)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(WidgetBrand.primaryText)
                        .lineLimit(family == .systemSmall ? 2 : 3)
                    if let ends = entry.endsAt, ends > Date() {
                        Text(timerInterval: Date()...ends, countsDown: true)
                            .font(.title3.monospacedDigit().weight(.bold))
                            .foregroundStyle(WidgetBrand.primaryText)
                    }
                    Text(entry.amountLabel)
                        .font(.caption.weight(.medium))
                        .foregroundStyle(WidgetBrand.secondaryText(for: contrast))
                    Spacer(minLength: 0)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
            }
        }
        .widgetURL(entry.deepLink)
        // IOS-A11Y.1: one combined element; the label verbalizes the deadline
        // ("ends in 2 hours"), never raw countdown digits.
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(accessibilitySummary))
    }

    /// Combined VoiceOver summary, e.g. "Next closing auction: Vintage amp,
    /// $240.00, ends in 2 hours" (IOS-A11Y.1).
    private var accessibilitySummary: String {
        guard let ends = entry.endsAt, ends > Date() else {
            return entry.title
        }
        let deadline = WidgetSharedStore.spokenDeadline(endsAt: ends)
        return "Next closing auction: \(entry.title), \(entry.amountLabel), \(deadline)"
    }
}
