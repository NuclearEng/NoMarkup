import SwiftUI
import WidgetKit

/// Small + medium widget showing how many auctions the user is actively bidding on.
///
/// IOS-SYS.WD.4: intentionally stays `StaticConfiguration` — it renders one
/// aggregate count across every tracked auction, so there is nothing for the
/// user to configure. The configurable surface is `NextClosingWidget`.
struct ActiveBidsWidget: Widget {
    let kind = WidgetSharedStore.activeBidsWidgetKind

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: ActiveBidsProvider()) { entry in
            ActiveBidsWidgetView(entry: entry)
                .containerBackground(for: .widget) {
                    WidgetBrand.navy
                }
        }
        .configurationDisplayName("Active Bids")
        .description("See how many auctions you are bidding on.")
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryRectangular, .accessoryCircular])
    }
}

struct ActiveBidsEntry: TimelineEntry {
    let date: Date
    let count: Int
    let nextTitle: String?
    let nextEndsAt: Date?

    /// IOS-SYS.WD.3(c): smart-stack relevance — the closer the next auction is
    /// to closing, the higher the widget scores, for the remaining duration.
    var relevance: TimelineEntryRelevance? {
        guard let nextEndsAt, nextEndsAt > date else { return nil }
        return TimelineEntryRelevance(
            score: WidgetSharedStore.relevanceScore(endsAt: nextEndsAt, now: date),
            duration: nextEndsAt.timeIntervalSince(date)
        )
    }
}

struct ActiveBidsProvider: TimelineProvider {
    func placeholder(in context: Context) -> ActiveBidsEntry {
        ActiveBidsEntry(date: Date(), count: 3, nextTitle: "Kitchen remodel", nextEndsAt: Date().addingTimeInterval(3600))
    }

    func getSnapshot(in context: Context, completion: @escaping (ActiveBidsEntry) -> Void) {
        completion(makeEntry())
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<ActiveBidsEntry>) -> Void) {
        let entry = makeEntry()
        let next = Calendar.current.date(byAdding: .minute, value: 15, to: Date()) ?? Date().addingTimeInterval(900)
        completion(Timeline(entries: [entry], policy: .after(next)))
    }

    private func makeEntry() -> ActiveBidsEntry {
        let snap = WidgetSharedStore.load()
        let next = snap.nextClosing
        return ActiveBidsEntry(
            date: Date(),
            count: max(snap.activeBidCount, snap.auctions.count),
            nextTitle: next?.title,
            nextEndsAt: next?.endsAt
        )
    }
}

struct ActiveBidsWidgetView: View {
    @Environment(\.widgetFamily) private var family
    /// IOS-A11Y.3: brighter gold / captions under Increase Contrast.
    @Environment(\.colorSchemeContrast) private var contrast
    let entry: ActiveBidsEntry

    var body: some View {
        Group {
            switch family {
            case .accessoryCircular:
                ZStack {
                    AccessoryWidgetBackground()
                    VStack(spacing: 2) {
                        Text("\(entry.count)")
                            .font(.headline.weight(.bold))
                        Text("bids")
                            .font(.caption2)
                    }
                }
            case .accessoryRectangular:
                VStack(alignment: .leading, spacing: 2) {
                    Text("Active bids")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                    Text("\(entry.count)")
                        .font(.headline.weight(.semibold))
                    if let ends = entry.nextEndsAt, ends > Date() {
                        Text(timerInterval: Date()...ends, countsDown: true)
                            .font(.caption2.monospacedDigit())
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            case .systemMedium:
                HStack(alignment: .center, spacing: 16) {
                    countBlock
                    Divider().background(Color.white.opacity(0.2))
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Next closing")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(WidgetBrand.gold(for: contrast))
                        if let title = entry.nextTitle {
                            Text(title)
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(.white)
                                .lineLimit(2)
                        } else {
                            Text("No active auctions")
                                .font(.subheadline)
                                .foregroundStyle(.white.opacity(0.7))
                        }
                        if let ends = entry.nextEndsAt, ends > Date() {
                            Text(timerInterval: Date()...ends, countsDown: true)
                                .font(.caption.monospacedDigit())
                                .foregroundStyle(.white.opacity(0.85))
                        }
                    }
                    Spacer(minLength: 0)
                }
                .padding(4)
            default:
                countBlock
            }
        }
        .widgetURL(URL(string: "nomarkup://bids"))
        // IOS-A11Y.1: one combined element per family; the label verbalizes the
        // deadline ("ends in 42 minutes"), never raw countdown digits.
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(accessibilitySummary))
    }

    private var countBlock: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Active bids")
                .font(.caption.weight(.semibold))
                .foregroundStyle(WidgetBrand.gold(for: contrast))
            Text("\(entry.count)")
                .font(.largeTitle.weight(.bold).monospacedDigit())
                .minimumScaleFactor(0.5)
                .lineLimit(1)
                .foregroundStyle(.white)
                // IOS-A11Y.1: the bare number never reads alone (also covered by
                // the combined label above; kept so the block stays labeled if
                // it is ever reused outside this view).
                .accessibilityLabel(Text(String(localized: "\(entry.count) active bids")))
            Text("Tap to open")
                .font(.caption2)
                .foregroundStyle(WidgetBrand.secondaryText(for: contrast))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }

    /// Combined VoiceOver summary, e.g. "3 active bids, next auction Kitchen
    /// remodel ends in 42 minutes" (IOS-A11Y.1).
    private var accessibilitySummary: String {
        let bids = String(localized: "\(entry.count) active bids")
        guard let ends = entry.nextEndsAt, ends > Date() else {
            return "\(bids), no auction closing soon"
        }
        let deadline = WidgetSharedStore.spokenDeadline(endsAt: ends)
        if let title = entry.nextTitle, !title.isEmpty {
            return "\(bids), next auction \(title) \(deadline)"
        }
        return "\(bids), next auction \(deadline)"
    }
}
