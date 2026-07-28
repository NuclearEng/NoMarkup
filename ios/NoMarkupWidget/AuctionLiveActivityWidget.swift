import SwiftUI
import WidgetKit

#if canImport(ActivityKit)
import ActivityKit

/// Lock Screen / Dynamic Island Live Activity UI for in-flight auctions (IOS-SYS.LA.4).
struct AuctionLiveActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: AuctionActivityAttributes.self) { context in
            // Lock Screen / banner
            HStack(alignment: .center, spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(context.attributes.kind == "listing" ? "Goods auction" : "Service bid")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(Color(red: 0.79, green: 0.66, blue: 0.30))
                    Text(context.attributes.title)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.white)
                        .lineLimit(2)
                }
                Spacer(minLength: 8)
                VStack(alignment: .trailing, spacing: 4) {
                    Text(MoneyCentsFormat.usd(cents: context.state.leadingBidCents))
                        .font(.headline.monospacedDigit())
                        .foregroundStyle(.white)
                    if context.state.endsAt > Date() {
                        Text(timerInterval: Date()...context.state.endsAt, countsDown: true)
                            .font(.caption.monospacedDigit())
                            .foregroundStyle(.white.opacity(0.85))
                            .multilineTextAlignment(.trailing)
                    } else {
                        Text("Ended")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.white.opacity(0.7))
                    }
                }
            }
            .padding(14)
            .activityBackgroundTint(Color(red: 0.04, green: 0.09, blue: 0.16))
            .activitySystemActionForegroundColor(Color(red: 0.79, green: 0.66, blue: 0.30))
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Text(context.attributes.kind == "listing" ? "High" : "Low")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Text(MoneyCentsFormat.usd(cents: context.state.leadingBidCents))
                        .font(.caption.monospacedDigit().weight(.semibold))
                }
                DynamicIslandExpandedRegion(.center) {
                    Text(context.attributes.title)
                        .font(.caption.weight(.semibold))
                        .lineLimit(1)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    if context.state.endsAt > Date() {
                        Text(timerInterval: Date()...context.state.endsAt, countsDown: true)
                            .font(.caption.monospacedDigit())
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            } compactLeading: {
                Image(systemName: context.attributes.kind == "listing" ? "bag.fill" : "hammer.fill")
                    .foregroundStyle(Color(red: 0.79, green: 0.66, blue: 0.30))
            } compactTrailing: {
                if context.state.endsAt > Date() {
                    Text(timerInterval: Date()...context.state.endsAt, countsDown: true)
                        .font(.caption2.monospacedDigit())
                        .frame(maxWidth: 56)
                        .multilineTextAlignment(.trailing)
                } else {
                    Text("End")
                        .font(.caption2)
                }
            } minimal: {
                Image(systemName: "timer")
            }
            .widgetURL(deepLink(for: context.attributes))
        }
    }

    private func deepLink(for attributes: AuctionActivityAttributes) -> URL? {
        let segment = attributes.kind == "listing" ? "listings" : "jobs"
        return URL(string: "nomarkup://\(segment)/\(attributes.auctionID)")
    }
}

/// Tiny USD formatter for the widget extension (avoids pulling BrandTheme / app MoneyFormat).
enum MoneyCentsFormat {
    static func usd(cents: Int64) -> String {
        let value = Double(cents) / 100.0
        return value.formatted(.currency(code: "USD"))
    }
}
#endif
