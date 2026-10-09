import Foundation

#if canImport(ActivityKit)
import ActivityKit

/// Shared Live Activity attributes for job / listing auction countdowns (IOS-SYS.LA.4).
/// Compiled into the main app (start/update/end) and the widget extension (UI).
struct AuctionActivityAttributes: ActivityAttributes {
    /// Static per-activity identity.
    var auctionID: String
    var title: String
    /// `"job"` (reverse / low bid) or `"listing"` (forward / high bid).
    var kind: String

    /// Dynamic state pushed while the auction is live.
    struct ContentState: Codable, Hashable, Sendable {
        /// Leading amount in integer cents (low for jobs, high for listings).
        var leadingBidCents: Int64
        var endsAt: Date
        /// Final outcome for the last content state (IOS-SYS.LA.1):
        /// `"won"` / `"lost"` / `"ended"`. `nil` while the auction is live —
        /// optional so previously started activities decode unchanged.
        var outcome: String? = nil
    }
}
#endif
