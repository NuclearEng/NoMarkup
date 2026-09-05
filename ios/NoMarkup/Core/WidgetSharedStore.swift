import AppIntents
import Foundation
import SwiftUI

#if canImport(WidgetKit)
import WidgetKit
#endif

/// App Group-backed snapshot for home-screen / Lock Screen widgets (IOS-SYS.WD.5).
///
/// Suite: `group.com.nomarkup.app` — must match entitlements on app + widget targets.
enum WidgetSharedStore {
    static let appGroupID = "group.com.nomarkup.app"
    private static let snapshotKey = "widget.auctionSnapshot.v1"

    /// Widget kind identifiers — single source for the `Widget` declarations in
    /// `NoMarkupWidget/` and the `reloadTimelines(ofKind:)` calls below (IOS-SYS.WD.3).
    static let activeBidsWidgetKind = "ActiveBidsWidget"
    static let nextClosingWidgetKind = "NextClosingWidget"

    struct AuctionSnapshot: Codable, Hashable, Sendable {
        var id: String
        var title: String
        var endsAt: Date
        var amountCents: Int64
        var kind: String
    }

    /// One marketplace rail — counts and Next Closing rows are merged independently
    /// so switching Goods/Services cannot wipe the other rail.
    enum BidRail: String, Sendable {
        case goods = "listing"
        case services = "job"

        var kind: String { rawValue }
    }

    struct Snapshot: Codable, Hashable, Sendable {
        var goodsBidCount: Int
        var servicesBidCount: Int
        var activeBidCount: Int
        var auctions: [AuctionSnapshot]
        var updatedAt: Date

        static let empty = Snapshot(
            goodsBidCount: 0,
            servicesBidCount: 0,
            activeBidCount: 0,
            auctions: [],
            updatedAt: .distantPast
        )

        var nextClosing: AuctionSnapshot? {
            auctions
                .filter { $0.endsAt > Date() }
                .sorted { $0.endsAt < $1.endsAt }
                .first
        }

        init(
            goodsBidCount: Int = 0,
            servicesBidCount: Int = 0,
            activeBidCount: Int = 0,
            auctions: [AuctionSnapshot],
            updatedAt: Date
        ) {
            self.goodsBidCount = goodsBidCount
            self.servicesBidCount = servicesBidCount
            self.activeBidCount = activeBidCount
            self.auctions = auctions
            self.updatedAt = updatedAt
        }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            let goods = try c.decodeIfPresent(Int.self, forKey: .goodsBidCount) ?? 0
            let services = try c.decodeIfPresent(Int.self, forKey: .servicesBidCount) ?? 0
            let stored = try c.decodeIfPresent(Int.self, forKey: .activeBidCount) ?? 0
            goodsBidCount = goods
            servicesBidCount = services
            // Pre-rail snapshots only stored a combined count.
            activeBidCount = (goods == 0 && services == 0) ? stored : goods + services
            auctions = try c.decodeIfPresent([AuctionSnapshot].self, forKey: .auctions) ?? []
            updatedAt = try c.decodeIfPresent(Date.self, forKey: .updatedAt) ?? .distantPast
        }

        func encode(to encoder: Encoder) throws {
            var c = encoder.container(keyedBy: CodingKeys.self)
            try c.encode(goodsBidCount, forKey: .goodsBidCount)
            try c.encode(servicesBidCount, forKey: .servicesBidCount)
            try c.encode(activeBidCount, forKey: .activeBidCount)
            try c.encode(auctions, forKey: .auctions)
            try c.encode(updatedAt, forKey: .updatedAt)
        }

        private enum CodingKeys: String, CodingKey {
            case goodsBidCount, servicesBidCount, activeBidCount, auctions, updatedAt
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
        // IOS-SYS.WD.3(a): a snapshot write is the only signal widgets have —
        // always push it into both timelines.
        reloadWidgetTimelines()
    }

    /// Wipe the snapshot back to the empty state (e.g. sign-out) and refresh
    /// widgets so stale bid counts never outlive the session (IOS-SYS.WD.3).
    static func clear() {
        defaults?.removeObject(forKey: snapshotKey)
        reloadWidgetTimelines()
    }

    /// Reload both widget timelines. Safe from app or extension process.
    static func reloadWidgetTimelines() {
        #if canImport(WidgetKit)
        WidgetCenter.shared.reloadTimelines(ofKind: activeBidsWidgetKind)
        WidgetCenter.shared.reloadTimelines(ofKind: nextClosingWidgetKind)
        #endif
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
        pruneAuctions(&snap)
        if kind == BidRail.goods.kind {
            snap.goodsBidCount = max(
                snap.goodsBidCount,
                snap.auctions.filter { $0.kind == BidRail.goods.kind }.count
            )
        } else {
            snap.servicesBidCount = max(
                snap.servicesBidCount,
                snap.auctions.filter { $0.kind != BidRail.goods.kind }.count
            )
        }
        snap.activeBidCount = snap.goodsBidCount + snap.servicesBidCount
        save(snap)
    }

    static func removeAuction(id: String) {
        var snap = load()
        let removed = snap.auctions.filter { $0.id == id }
        snap.auctions.removeAll { $0.id == id }
        if removed.contains(where: { $0.kind == BidRail.goods.kind }) {
            snap.goodsBidCount = max(0, snap.goodsBidCount - 1)
        }
        if removed.contains(where: { $0.kind != BidRail.goods.kind }) {
            snap.servicesBidCount = max(0, snap.servicesBidCount - 1)
        }
        snap.activeBidCount = snap.goodsBidCount + snap.servicesBidCount
        save(snap)
    }

    /// Combined services+goods active bid count. Prefer `replaceRail` when only
    /// one list was fetched so the other rail is not zeroed.
    static func setActiveBidCount(_ count: Int) {
        var snap = load()
        snap.activeBidCount = max(0, count)
        save(snap)
    }

    /// Replace one rail's count (and optional Next Closing rows). The other rail
    /// is left intact so switching Goods/Services cannot overwrite the Home Screen.
    static func replaceRail(
        _ rail: BidRail,
        activeCount: Int,
        auctions: [AuctionSnapshot]? = nil
    ) {
        var snap = load()
        switch rail {
        case .goods:
            snap.goodsBidCount = max(0, activeCount)
            if let auctions {
                snap.auctions.removeAll { $0.kind == BidRail.goods.kind }
                snap.auctions.append(contentsOf: auctions)
            }
        case .services:
            snap.servicesBidCount = max(0, activeCount)
            if let auctions {
                snap.auctions.removeAll { $0.kind != BidRail.goods.kind }
                snap.auctions.append(contentsOf: auctions)
            }
        }
        pruneAuctions(&snap)
        snap.activeBidCount = snap.goodsBidCount + snap.servicesBidCount
        save(snap)
    }

    private static func pruneAuctions(_ snap: inout Snapshot) {
        snap.auctions = snap.auctions
            .filter { $0.endsAt > Date().addingTimeInterval(-60) }
            .sorted { $0.endsAt < $1.endsAt }
        if snap.auctions.count > 12 {
            snap.auctions = Array(snap.auctions.prefix(12))
        }
    }

    // MARK: - Timeline relevance (IOS-SYS.WD.3)

    /// Smart-stack relevance score in `0...100` — the closer an auction is to
    /// closing, the higher the score, so the stack rotates the widget forward
    /// right when the countdown matters. `0` when there is nothing closing.
    static func relevanceScore(endsAt: Date?, now: Date = Date()) -> Float {
        guard let endsAt, endsAt > now else { return 0 }
        let minutes = endsAt.timeIntervalSince(now) / 60
        switch minutes {
        case ..<15: return 100
        case ..<60: return 75
        case ..<360: return 40
        case ..<1440: return 20
        default: return 5
        }
    }

    // MARK: - Spoken deadline (IOS-A11Y.1)

    /// VoiceOver-friendly deadline phrase — verbalizes the close time instead of
    /// raw `Text(timerInterval:)` digits ("ends in 42 minutes", "ends Jul 28,
    /// 9:00 AM", "ended"). Relative phrasing is regenerated on every timeline
    /// refresh, so staleness is bounded by the widget's own refresh policy.
    static func spokenDeadline(endsAt: Date?, now: Date = Date()) -> String {
        guard let endsAt else { return "no upcoming close" }
        guard endsAt > now else { return "ended" }
        let seconds = endsAt.timeIntervalSince(now)
        guard seconds < 24 * 3600 else {
            return "ends \(endsAt.formatted(date: .abbreviated, time: .shortened))"
        }
        let totalMinutes = max(1, Int((seconds / 60).rounded(.up)))
        if totalMinutes < 60 {
            return String(localized: "ends in \(totalMinutes) minutes")
        }
        let hours = totalMinutes / 60
        let minutes = totalMinutes % 60
        if minutes == 0 {
            return String(localized: "ends in \(hours) hours")
        }
        return "\(String(localized: "ends in \(hours) hours")) \(String(localized: "\(minutes) minutes"))"
    }
}

// MARK: - Widget brand palette (IOS-DES.10)

/// Brand colors for widget + Live Activity surfaces. The extension cannot see
/// `Core/BrandTheme.swift` (app target only), so this shared constant is the
/// single source for extension color literals — keep in sync with BrandTheme /
/// the showcase SSOT.
///
/// DES.3 — HOME-SCREEN widgets render in both appearances: `background` /
/// `primaryText` / `gold(for:)` / `secondaryText(for:)` are light+dark dynamic
/// (light mirrors the app: paper `#f6f4ef`, navy ink `#14161e`, text gold
/// `#806316`). The LIVE ACTIVITY intentionally keeps the STATIC navy shell
/// (`navy` + `gold`/`goldBright` literals) — its card sits on the wallpaper,
/// not a system surface, so brand chrome stays constant like the app icon.
enum WidgetBrand {
    /// Showcase `--bg-primary` `#07080b` — static; Live Activity shell + dark widgets.
    static let navy = Color(red: 0x07 / 255, green: 0x08 / 255, blue: 0x0B / 255)

    /// Showcase `--gold` `#c9a84c` — static literal (Live Activity on navy).
    static let gold = Color(red: 0xC9 / 255, green: 0xA8 / 255, blue: 0x4C / 255)

    /// Showcase `--gold-bright` `#e4c566` — static literal (Live Activity on navy).
    static let goldBright = Color(red: 0xE4 / 255, green: 0xC5 / 255, blue: 0x66 / 255)

    // MARK: DES.3 — adaptive home-screen widget tokens

    #if canImport(UIKit)
    private static func dynamic(
        light: UIColor,
        dark: UIColor
    ) -> Color {
        Color(uiColor: UIColor { traits in
            traits.userInterfaceStyle == .dark ? dark : light
        })
    }

    private static func rgb(_ hex: UInt32, _ alpha: CGFloat = 1) -> UIColor {
        UIColor(
            red: CGFloat((hex >> 16) & 0xFF) / 255,
            green: CGFloat((hex >> 8) & 0xFF) / 255,
            blue: CGFloat(hex & 0xFF) / 255,
            alpha: alpha
        )
    }

    /// Widget container fill — navy terminal in dark, warm paper in light
    /// (matches `BrandTheme.navy`).
    static let background = dynamic(light: rgb(0xF6F4EF), dark: rgb(0x07080B))

    /// Widget body text — showcase `#e8ecf1` on navy, navy ink `#14161e` on paper.
    static let primaryText = dynamic(light: rgb(0x14161E), dark: rgb(0xE8ECF1))

    /// Hairline divider on the widget container.
    static let hairline = dynamic(light: rgb(0x000000, 0.15), dark: rgb(0xFFFFFF, 0.2))
    #else
    static let background = navy
    static let primaryText = Color.white
    static let hairline = Color.white.opacity(0.2)
    #endif

    // MARK: IOS-A11Y.3 — Increase Contrast variants (now 4-way with light mode)
    //
    // Widget processes read `\.colorSchemeContrast` and pass it through these
    // helpers; the light/dark half resolves via the dynamic provider.
    // Dark, on navy `#07080b`: gold 8.76:1 → goldBright 11.90:1; white 55% ≈
    // 6.6:1 → 80% ≈ 11.4:1. Light, on paper `#f6f4ef`: text gold `#806316`
    // 5.14:1 → `#6b520f` 6.73:1; ink 62% ≈ 5.9:1 → 85% ≈ 11.3:1.

    /// Brand gold label color honoring Increase Contrast (adaptive light/dark).
    static func gold(for contrast: ColorSchemeContrast) -> Color {
        #if canImport(UIKit)
        if contrast == .increased {
            return dynamic(light: rgb(0x6B520F), dark: rgb(0xE4C566))
        }
        return dynamic(light: rgb(0x806316), dark: rgb(0xC9A84C))
        #else
        return contrast == .increased ? goldBright : gold
        #endif
    }

    /// Muted caption honoring Increase Contrast (adaptive light/dark).
    static func secondaryText(for contrast: ColorSchemeContrast) -> Color {
        #if canImport(UIKit)
        if contrast == .increased {
            return dynamic(light: rgb(0x14161E, 0.85), dark: rgb(0xFFFFFF, 0.8))
        }
        return dynamic(light: rgb(0x14161E, 0.62), dark: rgb(0xFFFFFF, 0.55))
        #else
        return .white.opacity(contrast == .increased ? 0.8 : 0.55)
        #endif
    }
}

// MARK: - Widget configuration entities (IOS-SYS.WD.4)

/// Snapshot-backed auction for the configurable Next Closing widget picker.
/// Lives in this shared file (not the widget target) so BOTH the app and the
/// extension compile it — App Intents metadata extraction needs the entity in
/// every target that can resolve it.
struct AuctionEntity: AppEntity, Identifiable {
    static var typeDisplayRepresentation: TypeDisplayRepresentation {
        TypeDisplayRepresentation(name: "Auction")
    }

    static var defaultQuery: AuctionEntityQuery { AuctionEntityQuery() }

    var id: String
    var title: String
    var kind: String
    var endsAt: Date
    var amountCents: Int64

    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(
            title: "\(title)",
            subtitle: "\(kind == "listing" ? "Listing" : "Job") · ends \(endsAt.formatted(date: .abbreviated, time: .shortened))"
        )
    }

    init(snapshot: WidgetSharedStore.AuctionSnapshot) {
        id = snapshot.id
        title = snapshot.title
        kind = snapshot.kind
        endsAt = snapshot.endsAt
        amountCents = snapshot.amountCents
    }
}

/// Picker query over the App-Group snapshot — the same data the widgets render,
/// so the configuration sheet always offers exactly the tracked auctions.
struct AuctionEntityQuery: EntityQuery {
    func entities(for identifiers: [AuctionEntity.ID]) async throws -> [AuctionEntity] {
        WidgetSharedStore.load().auctions
            .filter { identifiers.contains($0.id) }
            .map(AuctionEntity.init(snapshot:))
    }

    func suggestedEntities() async throws -> [AuctionEntity] {
        WidgetSharedStore.load().auctions
            .filter { $0.endsAt > Date() }
            .sorted { $0.endsAt < $1.endsAt }
            .map(AuctionEntity.init(snapshot:))
    }
}

/// Jobs / listings / both filter for the configurable widget (IOS-SYS.WD.4).
enum AuctionKindFilter: String, AppEnum {
    case both
    case jobs
    case listings

    static var typeDisplayRepresentation: TypeDisplayRepresentation {
        TypeDisplayRepresentation(name: "Auction Type")
    }

    static var caseDisplayRepresentations: [AuctionKindFilter: DisplayRepresentation] {
        [
            .both: DisplayRepresentation(title: "Jobs & listings"),
            .jobs: DisplayRepresentation(title: "Service jobs"),
            .listings: DisplayRepresentation(title: "Marketplace listings"),
        ]
    }

    /// True when a snapshot `kind` wire string passes this filter.
    func matches(kind: String) -> Bool {
        switch self {
        case .both: return true
        case .jobs: return kind != "listing"
        case .listings: return kind == "listing"
        }
    }
}
