import Foundation

#if canImport(ActivityKit)
import ActivityKit
#endif

/// Starts / updates / ends Auction Live Activities after the user places a bid.
/// No-ops when ActivityKit is unavailable or Live Activities are disabled by the user.
@MainActor
enum AuctionLiveActivityController {
    /// Begin (or update) a Live Activity for an auction the user just bid on.
    static func startOrUpdate(
        auctionID: String,
        title: String,
        kind: String,
        leadingBidCents: Int64,
        endsAt: Date?
    ) {
        #if canImport(ActivityKit)
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
        guard let endsAt, endsAt > Date() else { return }

        let attributes = AuctionActivityAttributes(
            auctionID: auctionID,
            title: title.isEmpty ? "Auction" : title,
            kind: kind
        )
        let state = AuctionActivityAttributes.ContentState(
            leadingBidCents: leadingBidCents,
            endsAt: endsAt
        )

        // Update existing activity for this auction if already running.
        for activity in Activity<AuctionActivityAttributes>.activities
            where activity.attributes.auctionID == auctionID
        {
            let content = ActivityContent(state: state, staleDate: endsAt)
            // Activity is not Sendable under Swift 6; hop via id + nonisolated update task.
            let activityID = activity.id
            Task { @MainActor in
                let matches = Activity<AuctionActivityAttributes>.activities.filter { $0.id == activityID }
                guard let live = matches.first else { return }
                // ActivityKit update is async; isolate hop via unchecked sendable box.
                await ActivityUpdateBox(activity: live).update(content)
            }
            // Also refresh widget shared snapshot for home-screen widgets.
            WidgetSharedStore.recordActiveAuction(
                id: auctionID,
                title: attributes.title,
                endsAt: endsAt,
                amountCents: leadingBidCents,
                kind: kind
            )
            return
        }

        do {
            let content = ActivityContent(state: state, staleDate: endsAt)
            _ = try Activity.request(
                attributes: attributes,
                content: content,
                pushType: nil
            )
            WidgetSharedStore.recordActiveAuction(
                id: auctionID,
                title: attributes.title,
                endsAt: endsAt,
                amountCents: leadingBidCents,
                kind: kind
            )
        } catch {
            // Live Activities are best-effort — never fail the bid path.
        }
        #else
        _ = auctionID
        _ = title
        _ = kind
        _ = leadingBidCents
        _ = endsAt
        #endif
    }

    static func end(auctionID: String) {
        #if canImport(ActivityKit)
        for activity in Activity<AuctionActivityAttributes>.activities
            where activity.attributes.auctionID == auctionID
        {
            let activityID = activity.id
            Task { @MainActor in
                let matches = Activity<AuctionActivityAttributes>.activities.filter { $0.id == activityID }
                guard let live = matches.first else { return }
                await ActivityUpdateBox(activity: live).endImmediate()
            }
        }
        WidgetSharedStore.removeAuction(id: auctionID)
        #else
        _ = auctionID
        #endif
    }
}

#if canImport(ActivityKit)
/// Unchecked box so we can `await` ActivityKit methods without Sendable diagnostics
/// (Activity is not marked Sendable; Live Activities are main-thread UI best-effort).
private struct ActivityUpdateBox: @unchecked Sendable {
    let activity: Activity<AuctionActivityAttributes>

    func update(_ content: ActivityContent<AuctionActivityAttributes.ContentState>) async {
        await activity.update(content)
    }

    func endImmediate() async {
        await activity.end(nil, dismissalPolicy: .immediate)
    }
}
#endif

