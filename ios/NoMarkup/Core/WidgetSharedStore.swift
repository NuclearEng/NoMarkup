import Foundation

/// App Group-backed snapshot for home-screen / Lock Screen widgets (IOS-SYS.WD.5).
///
/// Suite: `group.com.nomarkup.app` — must match entitlements on app + widget targets.
enum WidgetSharedStore {
    static let appGroupID = "group.com.nomarkup.app"
    private static let snapshotKey = "widget.auctionSnapshot.v1"

    struct AuctionSnapshot: Codable, Hashable, Sendable {
        var id: String
        var title: String
        var endsAt: Date
        var amountCents: Int64
        var kind: String
    }

    struct Snapshot: Codable, Hashable, Sendable {
        var activeBidCount: Int
        var auctions: [AuctionSnapshot]
        var updatedAt: Date

        static let empty = Snapshot(activeBidCount: 0, auctions: [], updatedAt: .distantPast)

        var nextClosing: AuctionSnapshot? {
            auctions
                .filter { $0.endsAt > Date() }
                .sorted { $0.endsAt < $1.endsAt }
                .first
        }
    }

    private static var defaults: UserDefaults? {
        UserDefaults(suiteName: appGroupID)
    }

    static func load() -> Snapshot {
        guard let data = defaults?.data(forKey: snapshotKey) else {
            return .empty
        }
        return (try? JSONDecoder().decode(Snapshot.self, from: data)) ?? .empty
    }

    static func save(_ snapshot: Snapshot) {
        guard let defaults else { return }
        var next = snapshot
        next.updatedAt = Date()
        guard let data = try? JSONEncoder().encode(next) else { return }
        defaults.set(data, forKey: snapshotKey)
    }

    static func recordActiveAuction(
        id: String,
        title: String,
        endsAt: Date,
        amountCents: Int64,
        kind: String
    ) {
        var snap = load()
        snap.auctions.removeAll { $0.id == id }
        snap.auctions.append(
            AuctionSnapshot(
                id: id,
                title: title,
                endsAt: endsAt,
                amountCents: amountCents,
                kind: kind
            )
        )
        // Keep only future auctions, cap list size.
        snap.auctions = snap.auctions
            .filter { $0.endsAt > Date().addingTimeInterval(-60) }
            .sorted { $0.endsAt < $1.endsAt }
        if snap.auctions.count > 12 {
            snap.auctions = Array(snap.auctions.prefix(12))
        }
        snap.activeBidCount = max(snap.activeBidCount, snap.auctions.count)
        save(snap)
    }

    static func removeAuction(id: String) {
        var snap = load()
        snap.auctions.removeAll { $0.id == id }
        snap.activeBidCount = snap.auctions.count
        save(snap)
    }

    static func setActiveBidCount(_ count: Int) {
        var snap = load()
        snap.activeBidCount = max(0, count)
        save(snap)
    }
}
