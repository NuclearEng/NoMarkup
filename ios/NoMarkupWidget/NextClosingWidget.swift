import SwiftUI
import WidgetKit

/// Focused countdown for the soonest-closing auction the user is tracking.
struct NextClosingWidget: Widget {
    let kind = "NextClosingWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: NextClosingProvider()) { entry in
            NextClosingWidgetView(entry: entry)
                .containerBackground(for: .widget) {
                    Color(red: 0.04, green: 0.09, blue: 0.16)
                }
        }
        .configurationDisplayName("Next Closing")
        .description("Countdown to your next auction close.")
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryRectangular])
    }
}

struct NextClosingEntry: TimelineEntry {
    let date: Date
    let title: String
    let endsAt: Date?
    let amountLabel: String
    let deepLink: URL?
}

struct NextClosingProvider: TimelineProvider {
    func placeholder(in context: Context) -> NextClosingEntry {
        NextClosingEntry(
            date: Date(),
            title: "Vintage amp — local pickup",
            endsAt: Date().addingTimeInterval(2 * 3600),
            amountLabel: "$240",
            deepLink: URL(string: "nomarkup://bids")
        )
    }

    func getSnapshot(in context: Context, completion: @escaping (NextClosingEntry) -> Void) {
        completion(makeEntry())
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<NextClosingEntry>) -> Void) {
        let entry = makeEntry()
        var entries: [NextClosingEntry] = [entry]
        // Refresh when the auction ends so the widget can flip to empty state.
        if let ends = entry.endsAt, ends > Date() {
            entries.append(
                NextClosingEntry(
                    date: ends,
                    title: "No closing auctions",
                    endsAt: nil,
                    amountLabel: "—",
                    deepLink: URL(string: "nomarkup://bids")
                )
            )
            completion(Timeline(entries: entries, policy: .after(ends)))
        } else {
            let next = Calendar.current.date(byAdding: .minute, value: 30, to: Date()) ?? Date().addingTimeInterval(1800)
            completion(Timeline(entries: entries, policy: .after(next)))
        }
    }

    private func makeEntry() -> NextClosingEntry {
        let snap = WidgetSharedStore.load()
        if let next = snap.nextClosing {
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
            title: "No active auctions",
            endsAt: nil,
            amountLabel: "—",
            deepLink: URL(string: "nomarkup://bids")
        )
    }
}

struct NextClosingWidgetView: View {
    @Environment(\.widgetFamily) private var family
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
                        .foregroundStyle(Color(red: 0.79, green: 0.66, blue: 0.30))
                    Text(entry.title)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.white)
                        .lineLimit(family == .systemSmall ? 2 : 3)
                    if let ends = entry.endsAt, ends > Date() {
                        Text(timerInterval: Date()...ends, countsDown: true)
                            .font(.title3.monospacedDigit().weight(.bold))
                            .foregroundStyle(.white)
                    }
                    Text(entry.amountLabel)
                        .font(.caption.weight(.medium))
                        .foregroundStyle(.white.opacity(0.75))
                    Spacer(minLength: 0)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
            }
        }
        .widgetURL(entry.deepLink)
    }
}
