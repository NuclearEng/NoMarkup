import SwiftUI
import WidgetKit

/// Small + medium widget showing how many auctions the user is actively bidding on.
struct ActiveBidsWidget: Widget {
    let kind = "ActiveBidsWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: ActiveBidsProvider()) { entry in
            ActiveBidsWidgetView(entry: entry)
                .containerBackground(for: .widget) {
                    Color(red: 0.04, green: 0.09, blue: 0.16)
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
    let entry: ActiveBidsEntry

    var body: some View {
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
            .widgetURL(URL(string: "nomarkup://bids"))
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
            .widgetURL(URL(string: "nomarkup://bids"))
        case .systemMedium:
            HStack(alignment: .center, spacing: 16) {
                countBlock
                Divider().background(Color.white.opacity(0.2))
                VStack(alignment: .leading, spacing: 6) {
                    Text("Next closing")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(Color(red: 0.79, green: 0.66, blue: 0.30))
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
            .widgetURL(URL(string: "nomarkup://bids"))
        default:
            countBlock
                .widgetURL(URL(string: "nomarkup://bids"))
        }
    }

    private var countBlock: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Active bids")
                .font(.caption.weight(.semibold))
                .foregroundStyle(Color(red: 0.79, green: 0.66, blue: 0.30))
            Text("\(entry.count)")
                .font(.largeTitle.weight(.bold).monospacedDigit())
                .minimumScaleFactor(0.5)
                .lineLimit(1)
                .foregroundStyle(.white)
            Text("Tap to open")
                .font(.caption2)
                .foregroundStyle(.white.opacity(0.55))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }
}
