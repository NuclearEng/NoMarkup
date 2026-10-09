import AppIntents
import CoreSpotlight
import Foundation
import ObjectiveC

/// Best-effort Core Spotlight lifecycle (IOS-INT.2).
///
/// Detail views (owned elsewhere) already donate `NSUserActivity` with
/// `persistentIdentifier` set to the job or listing id and activity types
/// `com.nomarkup.app.viewJob` / `com.nomarkup.app.viewListing`. On iOS 18+
/// this bridge indexes the matching `IndexedEntity` when that activity becomes
/// current. iOS 17 keeps the activity donation only — `indexAppEntities` is
/// unavailable. Failures are ignored so indexing never blocks navigation or sign-out.
enum SpotlightIndex {
    private static let viewJobActivityType = "com.nomarkup.app.viewJob"
    private static let viewListingActivityType = "com.nomarkup.app.viewListing"

    nonisolated(unsafe) private static var bridgeInstalled = false
    nonisolated(unsafe) private static let donationLock = NSLock()
    nonisolated(unsafe) private static var lastDonationKey: String?

    /// Install once at launch. No-op below iOS 18.
    static func installActivityDonationBridge() {
        guard #available(iOS 18.0, *) else { return }
        guard !bridgeInstalled else { return }
        guard
            let original = class_getInstanceMethod(
                NSUserActivity.self,
                #selector(NSUserActivity.becomeCurrent)
            ),
            let replacement = class_getInstanceMethod(
                NSUserActivity.self,
                #selector(NSUserActivity.nm_spotlight_becomeCurrent)
            )
        else { return }
        bridgeInstalled = true
        method_exchangeImplementations(original, replacement)
    }

    /// Called when a viewed job or listing activity becomes current.
    static func donateFromCurrentActivity(_ activity: NSUserActivity) {
        guard #available(iOS 18.0, *) else { return }
        guard activity.isEligibleForSearch else { return }
        let id = (activity.persistentIdentifier ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard !id.isEmpty else { return }
        let trimmedTitle = activity.title?.trimmingCharacters(in: .whitespacesAndNewlines)
        let title = (trimmedTitle?.isEmpty == false) ? trimmedTitle : nil
        switch activity.activityType {
        case viewJobActivityType, viewListingActivityType:
            break
        default:
            return
        }
        let key = "\(activity.activityType)\u{1f}\(id)\u{1f}\(title ?? "")"
        donationLock.lock()
        let duplicate = lastDonationKey == key
        if !duplicate {
            lastDonationKey = key
        }
        donationLock.unlock()
        guard !duplicate else { return }
        switch activity.activityType {
        case viewJobActivityType:
            Task { await donateJob(id: id, title: title) }
        case viewListingActivityType:
            Task { await donateListing(id: id, title: title) }
        default:
            break
        }
    }

    /// Index a job. Identifier matches `SpotlightIndex.delete` / `JobEntity.id`.
    static func donateJob(id: String, title: String?) async {
        let trimmed = id.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        guard #available(iOS 18.0, *) else { return }
        let resolved = title?.trimmingCharacters(in: .whitespacesAndNewlines)
        let entity = JobEntity(id: trimmed, title: (resolved?.isEmpty == false) ? resolved : nil)
        do {
            try await CSSearchableIndex.default().indexAppEntities([entity])
        } catch {
            clearDonationKey()
        }
    }

    /// Index a listing. Identifier matches `SpotlightIndex.delete` / `ListingEntity.id`.
    static func donateListing(id: String, title: String?) async {
        let trimmed = id.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        guard #available(iOS 18.0, *) else { return }
        let resolved = title?.trimmingCharacters(in: .whitespacesAndNewlines)
        let entity = ListingEntity(id: trimmed, title: (resolved?.isEmpty == false) ? resolved : nil)
        do {
            try await CSSearchableIndex.default().indexAppEntities([entity])
        } catch {
            clearDonationKey()
        }
    }

    /// Remove specific donated items (e.g. 404 / removed content).
    /// Ids are the same job / listing UUIDs stored as `persistentIdentifier`.
    static func delete(identifiers: [String]) async {
        let ids = identifiers.filter { !$0.isEmpty }
        guard !ids.isEmpty else { return }
        clearDonationKey()
        try? await CSSearchableIndex.default().deleteSearchableItems(withIdentifiers: ids)
        if #available(iOS 18.0, *) {
            try? await CSSearchableIndex.default().deleteAppEntities(
                identifiedBy: ids,
                ofType: JobEntity.self
            )
            try? await CSSearchableIndex.default().deleteAppEntities(
                identifiedBy: ids,
                ofType: ListingEntity.self
            )
        }
    }

    /// Wipe the entire app Spotlight index (e.g. sign-out).
    static func deleteAll() async {
        clearDonationKey()
        try? await CSSearchableIndex.default().deleteAllSearchableItems()
        if #available(iOS 18.0, *) {
            try? await CSSearchableIndex.default().deleteAppEntities(ofType: JobEntity.self)
            try? await CSSearchableIndex.default().deleteAppEntities(ofType: ListingEntity.self)
        }
    }

    private static func clearDonationKey() {
        donationLock.lock()
        lastDonationKey = nil
        donationLock.unlock()
    }
}

extension NSUserActivity {
    /// Exchanged with `becomeCurrent`. Calls through, then donates an app entity
    /// when the activity is a viewed job or listing. Does not upload anything.
    @objc func nm_spotlight_becomeCurrent() {
        nm_spotlight_becomeCurrent()
        SpotlightIndex.donateFromCurrentActivity(self)
    }
}
