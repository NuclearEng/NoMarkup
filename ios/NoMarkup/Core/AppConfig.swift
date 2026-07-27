import Foundation

/// Runtime configuration for the native client.
///
/// API base URL resolution order:
/// 1. Process environment `NOMARKUP_API_BASE_URL` (debug launches, CI)
/// 2. Info.plist key `APIBaseURL` (release packaging)
/// 3. Debug default `http://localhost:8081` (matches local gateway / `.env.local`)
/// 4. Release default `https://api.no-markup.com`
enum AppConfig {
    /// Production marketing / legal site (hyphenated zone).
    static let publicWebBaseURL = URL(string: "https://no-markup.com")!

    static let privacyURL = publicWebBaseURL.appending(path: "privacy")
    static let termsURL = publicWebBaseURL.appending(path: "terms")
    static let communityGuidelinesURL = publicWebBaseURL.appending(path: "community-guidelines")
    static let supportURL = publicWebBaseURL.appending(path: "support")

    /// Post a service job on web (full form with photos / advanced options).
    /// Native: `PostJobView` → `POST /api/v1/jobs`.
    static let postJobURL = publicWebBaseURL.appending(path: "jobs/new")

    /// List a physical goods item on web (full form with photos).
    /// Native: `CreateListingView` → `POST /api/v1/listings`.
    static let sellItemURL = publicWebBaseURL.appending(path: "sell")

    /// Gateway HTTP base (no trailing slash).
    ///
    /// Resolution:
    /// 1. `NOMARKUP_API_BASE_URL` env (scheme / CI / Xcode scheme)
    /// 2. **DEBUG + Simulator:** `http://127.0.0.1:8081` (local `make dev` gateway)
    /// 3. Info.plist `APIBaseURL` when non-empty (device LAN IP or staging)
    /// 4. Release: `https://api.no-markup.com`
    ///
    /// Simulator prefers localhost over a stale LAN IP in Info.plist so live
    /// auctions from the Mac stack are reachable. A physical phone cannot use
    /// localhost — set Info.plist / env to your Mac’s LAN IP (`:8081`).
    static var apiBaseURL: URL {
        if let env = ProcessInfo.processInfo.environment["NOMARKUP_API_BASE_URL"],
           let url = URL(string: env), !env.isEmpty {
            return url
        }

        #if DEBUG && targetEnvironment(simulator)
        // Local gateway (bin/dev) listens on 8081 in current dogfood; override via env.
        return URL(string: "http://127.0.0.1:8081")!
        #endif

        if let plist = Bundle.main.object(forInfoDictionaryKey: "APIBaseURL") as? String,
           let url = URL(string: plist), !plist.isEmpty {
            return url
        }

        return URL(string: "https://api.no-markup.com")!
    }

    static var apiBaseURLString: String {
        apiBaseURL.absoluteString
    }

    /// Host (and port) only for safe UI / debug display.
    /// Never surface full URL with path, query, userinfo, or secrets.
    static var apiBaseHostDisplay: String {
        let url = apiBaseURL
        guard let host = url.host, !host.isEmpty else {
            // Fallback without credentials if host parse fails.
            return url.host ?? "(unknown host)"
        }
        if let port = url.port {
            return "\(host):\(port)"
        }
        return host
    }

    /// Bundle display name for chrome / about.
    static var appDisplayName: String {
        (Bundle.main.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String)
            ?? (Bundle.main.object(forInfoDictionaryKey: "CFBundleName") as? String)
            ?? "NoMarkup"
    }

    static var shortVersion: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.1.0"
    }

    static var buildNumber: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "1"
    }

    // MARK: - Stripe / Apple Pay (Rail A — physical goods & services GMV)

    /// Stripe **publishable** key (pk_test_… / pk_live_…). Safe for the binary.
    ///
    /// Resolution:
    /// 1. `NOMARKUP_STRIPE_PUBLISHABLE_KEY` env
    /// 2. Info.plist `StripePublishableKey`
    /// 3. Empty string (checkout surfaces a configuration error)
    static var stripePublishableKey: String {
        if let env = ProcessInfo.processInfo.environment["NOMARKUP_STRIPE_PUBLISHABLE_KEY"],
           !env.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return env.trimmingCharacters(in: .whitespacesAndNewlines)
        }
        if let plist = Bundle.main.object(forInfoDictionaryKey: "StripePublishableKey") as? String {
            let trimmed = plist.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmed.isEmpty, !trimmed.contains("...") {
                return trimmed
            }
        }
        return ""
    }

    /// Apple Pay merchant ID registered in the Apple Developer portal and
    /// Stripe Dashboard (Payments → Apple Pay). Must match the entitlement
    /// `com.apple.developer.in-app-payments`.
    ///
    /// Override via Info.plist `ApplePayMerchantId` or env `NOMARKUP_APPLE_PAY_MERCHANT_ID`.
    static var applePayMerchantId: String {
        if let env = ProcessInfo.processInfo.environment["NOMARKUP_APPLE_PAY_MERCHANT_ID"],
           !env.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return env.trimmingCharacters(in: .whitespacesAndNewlines)
        }
        if let plist = Bundle.main.object(forInfoDictionaryKey: "ApplePayMerchantId") as? String,
           !plist.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return plist.trimmingCharacters(in: .whitespacesAndNewlines)
        }
        // Default merchant ID for com.nomarkup.app — register in Developer portal.
        return "merchant.com.nomarkup.app"
    }

    /// ISO country code for Apple Pay (US marketplace MVP).
    static let applePayMerchantCountryCode = "US"

    // MARK: - Goods browse center (optional radius search)

    /// Optional marketplace search center latitude.
    ///
    /// When both `browseLatitude` and `browseLongitude` are set, `MarketplaceView`
    /// passes `lat` / `lng` / `radius_km` to `GET /api/v1/listings` so the gateway
    /// can filter to the local pickup radius and populate `distance_km`.
    ///
    /// Resolution:
    /// 1. `NOMARKUP_BROWSE_LAT` env
    /// 2. Info.plist `BrowseLatitude` (string or number)
    /// 3. `nil` — list without geo filter; rows still show pickup ZIP / city when present
    static var browseLatitude: Double? {
        Self.optionalDouble(
            envKey: "NOMARKUP_BROWSE_LAT",
            plistKey: "BrowseLatitude"
        )
    }

    /// Optional marketplace search center longitude (paired with `browseLatitude`).
    static var browseLongitude: Double? {
        Self.optionalDouble(
            envKey: "NOMARKUP_BROWSE_LNG",
            plistKey: "BrowseLongitude"
        )
    }

    /// Goods local-pickup radius in km (~25 mi). Gateway caps at 40 km.
    static let marketplaceRadiusKm: Double = 40

    /// Resolved browse center when both coordinates are valid WGS84 values.
    static var browseCoordinate: (lat: Double, lng: Double)? {
        guard let lat = browseLatitude, let lng = browseLongitude else { return nil }
        guard lat >= -90, lat <= 90, lng >= -180, lng <= 180 else { return nil }
        return (lat, lng)
    }

    private static func optionalDouble(envKey: String, plistKey: String) -> Double? {
        if let env = ProcessInfo.processInfo.environment[envKey] {
            let trimmed = env.trimmingCharacters(in: .whitespacesAndNewlines)
            if let value = Double(trimmed) {
                return value
            }
        }
        if let number = Bundle.main.object(forInfoDictionaryKey: plistKey) as? NSNumber {
            return number.doubleValue
        }
        if let string = Bundle.main.object(forInfoDictionaryKey: plistKey) as? String {
            let trimmed = string.trimmingCharacters(in: .whitespacesAndNewlines)
            if let value = Double(trimmed) {
                return value
            }
        }
        return nil
    }
}
