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
enum WidgetBrand {
    /// Showcase `--bg-primary` `#07080b` — matches `BrandTheme.navy`.
    static let navy = Color(red: 0x07 / 255, green: 0x08 / 255, blue: 0x0B / 255)

    /// Showcase `--gold` `#c9a84c` — matches `BrandTheme.gold`.
    static let gold = Color(red: 0xC9 / 255, green: 0xA8 / 255, blue: 0x4C / 255)

    /// Showcase `--gold-bright` `#e4c566` — matches `BrandTheme.goldBright`.
    static let goldBright = Color(red: 0xE4 / 255, green: 0xC5 / 255, blue: 0x66 / 255)

    // MARK: IOS-A11Y.3 — Increase Contrast variants
    //
    // Widget / Live Activity processes can read `\.colorSchemeContrast`; the
    // widget views pass it through these helpers. Measured on navy `#07080b`:
    // gold 8.76:1 → goldBright 11.90:1; white 55% ≈ 6.6:1 → 80% ≈ 11.4:1.

    /// Brand gold label color honoring Increase Contrast.
    static func gold(for contrast: ColorSchemeContrast) -> Color {
        contrast == .increased ? goldBright : gold
    }

    /// Muted caption on navy honoring Increase Contrast.
    static func secondaryText(for contrast: ColorSchemeContrast) -> Color {
        .white.opacity(contrast == .increased ? 0.8 : 0.55)
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
