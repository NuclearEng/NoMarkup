import SwiftUI
import WidgetKit

#if canImport(ActivityKit)
import ActivityKit

/// Lock Screen / Dynamic Island Live Activity UI for in-flight auctions (IOS-SYS.LA.4).
struct AuctionLiveActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: AuctionActivityAttributes.self) { context in
            // Lock Screen / banner
            // IOS-A11Y.3 scope note: gold stays static here — these closures are
            // not View types (no `@Environment(\.colorSchemeContrast)` access
            // without a wrapper), and gold on navy already measures 8.76:1.
            HStack(alignment: .center, spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(context.attributes.kind == "listing" ? "Goods auction" : "Service bid")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(WidgetBrand.gold)
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
                    if context.state.outcome == nil, context.state.endsAt > Date() {
                        Text(timerInterval: Date()...context.state.endsAt, countsDown: true)
                            .font(.caption.monospacedDigit())
                            .foregroundStyle(.white.opacity(0.85))
                            .multilineTextAlignment(.trailing)
                    } else {
                        Text(Self.outcomeText(context.state.outcome))
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.white.opacity(0.7))
                    }
                }
            }
            .padding(14)
            .activityBackgroundTint(WidgetBrand.navy)
            .activitySystemActionForegroundColor(WidgetBrand.gold)
            // IOS-SYS.LA.2(a): Lock Screen taps route into the auction, same as the island.
            .widgetURL(deepLink(for: context.attributes))
            // IOS-A11Y.1: one combined spoken element; deadline verbalized, not timer digits.
            .accessibilityElement(children: .combine)
            .accessibilityLabel(Text(Self.spokenSummary(
                attributes: context.attributes,
                state: context.state
            )))
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    // IOS-SYS.LA.2(c): labeled copy, not a bare "High"/"Low".
                    Text(context.attributes.kind == "listing" ? "High bid" : "Low bid")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .accessibilityLabel(Text(context.attributes.kind == "listing"
                            ? "Leading high bid"
                            : "Leading low bid"))
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Text(MoneyCentsFormat.usd(cents: context.state.leadingBidCents))
                        .font(.caption.monospacedDigit().weight(.semibold))
                        .accessibilityLabel(Text(
                            "Leading bid \(MoneyCentsFormat.usd(cents: context.state.leadingBidCents))"
                        ))
                }
                DynamicIslandExpandedRegion(.center) {
                    Text(context.attributes.title)
                        .font(.caption.weight(.semibold))
                        .lineLimit(1)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    if context.state.outcome == nil, context.state.endsAt > Date() {
                        Text(timerInterval: Date()...context.state.endsAt, countsDown: true)
                            .font(.caption.monospacedDigit())
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .accessibilityLabel(Text(
                                "Auction \(WidgetSharedStore.spokenDeadline(endsAt: context.state.endsAt))"
                            ))
                    }
                }
            } compactLeading: {
                Image(systemName: context.attributes.kind == "listing" ? "bag.fill" : "hammer.fill")
                    .foregroundStyle(WidgetBrand.gold)
                    .accessibilityLabel(Text(context.attributes.kind == "listing"
                        ? "Goods auction"
                        : "Service bid"))
            } compactTrailing: {
                if context.state.outcome == nil, context.state.endsAt > Date() {
                    Text(timerInterval: Date()...context.state.endsAt, countsDown: true)
                        .font(.caption2.monospacedDigit())
                        .frame(maxWidth: 56)
                        .multilineTextAlignment(.trailing)
                        .accessibilityLabel(Text(
                            "Auction \(WidgetSharedStore.spokenDeadline(endsAt: context.state.endsAt))"
                        ))
                } else {
                    Text("End")
                        .font(.caption2)
                        .accessibilityLabel(Text("Auction ended"))
                }
            } minimal: {
                Image(systemName: "timer")
                    .accessibilityLabel(Text("Auction countdown"))
            }
            .widgetURL(deepLink(for: context.attributes))
        }
    }

    private func deepLink(for attributes: AuctionActivityAttributes) -> URL? {
        let segment = attributes.kind == "listing" ? "listings" : "jobs"
        return URL(string: "nomarkup://\(segment)/\(attributes.auctionID)")
    }

    /// Final-state copy for `ContentState.outcome` (IOS-SYS.LA.1).
    private static func outcomeText(_ outcome: String?) -> String {
        switch outcome {
        case "won": return "Won"
        case "lost": return "Not won"
        default: return "Ended"
        }
    }

    /// Combined VoiceOver summary for the Lock Screen presentation (IOS-A11Y.1),
    /// e.g. "Goods auction, Vintage amp, leading bid $240.00, ends in 42 minutes".
    private static func spokenSummary(
        attributes: AuctionActivityAttributes,
        state: AuctionActivityAttributes.ContentState
    ) -> String {
        let kindLabel = attributes.kind == "listing" ? "Goods auction" : "Service bid"
        let amount = MoneyCentsFormat.usd(cents: state.leadingBidCents)
        let status: String
        if let outcome = state.outcome {
            status = outcomeText(outcome)
        } else {
            status = WidgetSharedStore.spokenDeadline(endsAt: state.endsAt)
        }
        return "\(kindLabel), \(attributes.title), leading bid \(amount), \(status)"
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
