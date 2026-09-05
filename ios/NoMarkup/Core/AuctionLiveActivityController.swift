import Foundation

#if canImport(ActivityKit)
import ActivityKit
#endif

/// Starts / updates / ends Auction Live Activities after the user places a bid.
/// No-ops when ActivityKit is unavailable or Live Activities are disabled by the user.
@MainActor
enum AuctionLiveActivityController {
    /// Final auction outcome shown on the activity's last content state (IOS-SYS.LA.1).
    enum AuctionOutcome: String, Sendable {
        case ended
        case won
        case lost

        /// Wire value stored in `ContentState.outcome`.
        var wireValue: String { rawValue }
    }

    #if DEBUG
    /// One-line reason the last `startOrUpdate` no-op'd. Never includes tokens.
    static private(set) var debugUnavailableReason: String?
    #endif

    /// Begin (or update) a Live Activity for an auction the user just bid on.
    static func startOrUpdate(
        auctionID: String,
        title: String,
        kind: String,
        leadingBidCents: Int64,
        endsAt: Date?
    ) {
        #if canImport(ActivityKit)
        guard ActivityAuthorizationInfo().areActivitiesEnabled else {
            recordDebugUnavailable("Live Activity unavailable")
            return
        }
        guard let endsAt, endsAt > Date() else {
            recordDebugUnavailable("Live Activity unavailable")
            return
        }

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

        let content = ActivityContent(state: state, staleDate: endsAt)
        do {
            // IOS-SYS.LA.3: request a per-activity push token so the backend can
            // drive updates over APNs (`liveactivity` push type / SendLiveActivityUpdate).
            let activity = try Activity.request(
                attributes: attributes,
                content: content,
                pushType: .token
            )
            observePushToken(activityID: activity.id, auctionID: auctionID)
            WidgetSharedStore.recordActiveAuction(
                id: auctionID,
                title: attributes.title,
                endsAt: endsAt,
                amountCents: leadingBidCents,
                kind: kind
            )
        } catch {
            // Token-backed request can fail (e.g. missing push entitlement in a
            // dev config) — fall back to a locally updated activity rather than
            // losing the Lock Screen surface entirely.
            do {
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
                // Do not log the error: ActivityKit messages can include tokens.
                recordDebugUnavailable("Live Activity unavailable")
            }
        }
        #else
        _ = auctionID
        _ = title
        _ = kind
        _ = leadingBidCents
        _ = endsAt
        recordDebugUnavailable("Live Activity unavailable")
        #endif
    }

    /// DEBUG-only one-liner for bid UI. Release builds keep the silent no-op.
    private static func recordDebugUnavailable(_ reason: String) {
        #if DEBUG
        debugUnavailableReason = reason
        #else
        _ = reason
        #endif
    }

    /// Update the running Live Activity for `auctionID` from live auction
    /// telemetry (IOS-SYS.LA.2). UPDATE-ONLY: it never starts an activity, so
    /// auctions the user merely spectates cannot spawn a Lock Screen surface.
    ///
    /// - Parameters:
    ///   - leadingBidCents: new amount. With `onlyIfLeading` the value is merged
    ///     direction-aware (job = reverse auction → lower wins; listing =
    ///     forward → higher wins) so a trailing bid from the fan-out never
    ///     overwrites the leading price. Pass `onlyIfLeading: false` for
    ///     authoritative snapshots (`auction_state`), which always win.
    ///   - endsAt: new close time (anti-snipe extensions).
    static func updateIfActive(
        auctionID: String,
        leadingBidCents: Int64?,
        endsAt: Date? = nil,
        onlyIfLeading: Bool = false
    ) {
        #if canImport(ActivityKit)
        guard leadingBidCents != nil || endsAt != nil else { return }
        for activity in Activity<AuctionActivityAttributes>.activities
            where activity.attributes.auctionID == auctionID
        {
            let activityID = activity.id
            Task { @MainActor in
                let matches = Activity<AuctionActivityAttributes>.activities.filter { $0.id == activityID }
                guard let live = matches.first else { return }
                var state = live.content.state
                if let leadingBidCents {
                    let improves = live.attributes.kind == "listing"
                        ? leadingBidCents >= state.leadingBidCents
                        : leadingBidCents <= state.leadingBidCents
                    if !onlyIfLeading || improves {
                        state.leadingBidCents = leadingBidCents
                    }
                }
                if let endsAt {
                    state.endsAt = endsAt
                }
                guard state != live.content.state else { return }
                let content = ActivityContent(state: state, staleDate: state.endsAt)
                await ActivityUpdateBox(activity: live).update(content)
                WidgetSharedStore.recordActiveAuction(
                    id: auctionID,
                    title: live.attributes.title,
                    endsAt: state.endsAt,
                    amountCents: state.leadingBidCents,
                    kind: live.attributes.kind
                )
            }
        }
        #else
        _ = auctionID
        _ = leadingBidCents
        _ = endsAt
        _ = onlyIfLeading
        #endif
    }

    /// End the Live Activity for `auctionID`, dismissing immediately.
    /// Contract-stable signature — feature surfaces (bid withdraw, sign-out) call this.
    static func end(auctionID: String) {
        end(auctionID: auctionID, outcome: nil)
    }

    /// End with an optional final outcome (IOS-SYS.LA.1). With an outcome the
    /// Lock Screen keeps a short-lived "Ended / Won / Not won" card; without
    /// one the activity dismisses immediately (previous behavior).
    static func end(auctionID: String, outcome: AuctionOutcome?) {
        #if canImport(ActivityKit)
        var endedAny = false
        for activity in Activity<AuctionActivityAttributes>.activities
            where activity.attributes.auctionID == auctionID
        {
            endedAny = true
            let activityID = activity.id
            Task { @MainActor in
                let matches = Activity<AuctionActivityAttributes>.activities.filter { $0.id == activityID }
                guard let live = matches.first else { return }
                let box = ActivityUpdateBox(activity: live)
                if let outcome {
                    var state = live.content.state
                    state.outcome = outcome.wireValue
                    if state.endsAt > Date() {
                        state.endsAt = Date()
                    }
                    let content = ActivityContent(state: state, staleDate: nil)
                    // Keep the outcome card visible briefly, then let the system dismiss.
                    await box.end(content, dismissalPolicy: .after(Date().addingTimeInterval(15 * 60)))
                } else {
                    await box.endImmediate()
                }
            }
        }
        WidgetSharedStore.removeAuction(id: auctionID)
        // Only clean up a token registration when an activity actually ended —
        // `auction_ended` broadcasts also reach participants who never bid.
        if endedAny {
            unregisterLiveActivityPushToken(auctionID: auctionID)
        }
        #else
        _ = auctionID
        _ = outcome
        #endif
    }

    /// End (dismissal policy `.immediate`) every auction Live Activity whose
    /// content-state `endsAt` is already in the past (IOS-SYS.LA.1). Launch-time
    /// hygiene so dead countdowns never linger on the Lock Screen.
    static func sweepStaleActivities() {
        #if canImport(ActivityKit)
        let now = Date()
        for activity in Activity<AuctionActivityAttributes>.activities
            where activity.content.state.endsAt <= now
        {
            let activityID = activity.id
            let auctionID = activity.attributes.auctionID
            Task { @MainActor in
                let matches = Activity<AuctionActivityAttributes>.activities.filter { $0.id == activityID }
                guard let live = matches.first else { return }
                await ActivityUpdateBox(activity: live).endImmediate()
            }
            WidgetSharedStore.removeAuction(id: auctionID)
        }
        #endif
    }

    // MARK: - Live Activity push tokens (IOS-SYS.LA.3)

    #if canImport(ActivityKit)
    /// Stream the per-activity push token to the backend via the existing
    /// device-registration endpoint. Best-effort — never disturbs the bid path.
    ///
    /// LA.3: registration body is
    /// `{ device_token: <token hex>, platform: "ios_live_activity",
    ///    device_id: "liveactivity:<auctionID>" }`.
    /// Server plumbing (proto enum + APNs liveactivity send helper) is in place;
    /// residual is auction-event → token fan-out (lookup by device_id prefix).
    private static func observePushToken(activityID: String, auctionID: String) {
        Task { @MainActor in
            let matches = Activity<AuctionActivityAttributes>.activities.filter { $0.id == activityID }
            guard let live = matches.first else { return }
            let box = ActivityUpdateBox(activity: live)
            await box.awaitPushTokens { tokenData in
                // Never log token bytes / hex — register and drop the local copy.
                let tokenHex = tokenData.map { String(format: "%02x", $0) }.joined()
                guard !tokenHex.isEmpty else { return }
                _ = try? await APIClient.shared.registerPushDevice(
                    deviceToken: tokenHex,
                    deviceID: "liveactivity:\(auctionID)",
                    platform: "ios_live_activity"
                )
            }
        }
    }

    /// Best-effort cleanup of the per-activity token registration when the
    /// activity ends (mirrors `observePushToken`'s device_id convention).
    private static func unregisterLiveActivityPushToken(auctionID: String) {
        Task {
            _ = try? await APIClient.shared.unregisterPushDevice(
                deviceTokenOrID: "liveactivity:\(auctionID)"
            )
        }
    }
    #endif
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

    func end(
        _ content: ActivityContent<AuctionActivityAttributes.ContentState>?,
        dismissalPolicy: ActivityUIDismissalPolicy
    ) async {
        await activity.end(content, dismissalPolicy: dismissalPolicy)
    }

    /// Iterate the activity's push-token stream inside the box so the
    /// non-Sendable `Activity` never crosses an isolation boundary.
    func awaitPushTokens(_ handler: @escaping @Sendable (Data) async -> Void) async {
        for await token in activity.pushTokenUpdates {
            await handler(token)
        }
    }
}
#endif
