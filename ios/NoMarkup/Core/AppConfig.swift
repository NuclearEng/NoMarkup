import Foundation

/// Runtime configuration for the native client.
///
/// API base URL resolution order:
/// 1. Process environment `NOMARKUP_API_BASE_URL` (Debug scheme / CI dogfood only)
/// 2. **DEBUG + Simulator:** `http://127.0.0.1:8081` (local `make dev` gateway)
/// 3. Info.plist key `APIBaseURL` when non-empty (staging / custom host)
/// 4. Production: `https://api.no-markup.com`
///
/// **Release never uses cleartext HTTP.** Env / plist `http://…` values fall through
/// to production HTTPS. LAN dogfood: set scheme env `NOMARKUP_API_BASE_URL` in **Debug only**.
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

    /// Web subscription **management** (Stripe Customer Portal / settings).
    /// Used only for paid-tier “Manage on web” — never as a purchase CTA in-app.
    /// See `docs/compliance/v1-ios-product-cut.md` (free-tier-only digital).
    static let manageSubscriptionURL = publicWebBaseURL.appending(path: "settings/subscription")

    /// Production API host (HTTPS only).
    static let productionAPIBaseURL = URL(string: "https://api.no-markup.com")!

    /// Gateway HTTP base (no trailing slash).
    ///
    /// Resolution:
    /// 1. `NOMARKUP_API_BASE_URL` env (Debug scheme / CI) — **Release rejects non-https**
    /// 2. **DEBUG + Simulator:** `http://127.0.0.1:8081` (local `make dev` gateway)
    /// 3. Info.plist `APIBaseURL` when non-empty — **Release rejects non-https**
    /// 4. `https://api.no-markup.com`
    ///
    /// Committed Info.plist `APIBaseURL` is empty so Release always hits production HTTPS
    /// unless an explicit https override is supplied. Physical-device Debug dogfood: set
    /// scheme env `NOMARKUP_API_BASE_URL` (prefer HTTPS staging / tunnel over cleartext).
    static var apiBaseURL: URL {
        #if DEBUG && targetEnvironment(simulator)
        let debugSimDefault: URL? = URL(string: "http://127.0.0.1:8081")
        #else
        let debugSimDefault: URL? = nil
        #endif

        #if DEBUG
        let allowCleartext = true
        #else
        let allowCleartext = false
        #endif

        let env = ProcessInfo.processInfo.environment["NOMARKUP_API_BASE_URL"]
        let plist = Bundle.main.object(forInfoDictionaryKey: "APIBaseURL") as? String
        let resolved = resolveAPIBaseURL(
            envValue: env,
            plistValue: plist,
            debugSimulatorDefault: debugSimDefault,
            allowCleartext: allowCleartext
        )
        #if !DEBUG
        if !isHTTPSAPIBase(resolved) {
            logInsecureBaseOnce(source: "resolved", value: resolved.absoluteString)
            return productionAPIBaseURL
        }
        #endif
        return resolved
    }

    /// Pure resolver used by `apiBaseURL` and unit tests.
    ///
    /// - Parameters:
    ///   - envValue: Scheme / process env override.
    ///   - plistValue: Info.plist `APIBaseURL`.
    ///   - debugSimulatorDefault: When non-nil (DEBUG simulator), used if env is empty.
    ///   - allowCleartext: When false (Release), non-https env/plist values are skipped.
    static func resolveAPIBaseURL(
        envValue: String?,
        plistValue: String?,
        debugSimulatorDefault: URL?,
        allowCleartext: Bool = true
    ) -> URL {
        if let envValue {
            let trimmed = envValue.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmed.isEmpty, let url = URL(string: trimmed) {
                if isHTTPSAPIBase(url) || allowCleartext {
                    return url
                }
            }
        }

        if let debugSimulatorDefault {
            return debugSimulatorDefault
        }

        if let plistValue {
            let trimmed = plistValue.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmed.isEmpty, let url = URL(string: trimmed) {
                if isHTTPSAPIBase(url) || allowCleartext {
                    return url
                }
            }
        }

        return productionAPIBaseURL
    }

    /// True when the URL scheme is `https` (case-insensitive).
    static func isHTTPSAPIBase(_ url: URL) -> Bool {
        (url.scheme?.lowercased() ?? "") == "https"
    }

    static var apiBaseURLString: String {
        apiBaseURL.absoluteString
    }

    /// Archive-safe guard: true when the resolved API base uses `https`.
    /// Release builds must keep this true (enforced by `apiBaseURL` resolution).
    static var isReleaseAPIBaseSecure: Bool {
        isHTTPSAPIBase(apiBaseURL)
    }

    /// Host (and port) only for safe UI / debug display.
    /// Never surface full URL with path, query, userinfo, or secrets.
    static var apiBaseHostDisplay: String {
        let url = apiBaseURL
        guard let host = url.host, !host.isEmpty else {
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
        Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1.0.0"
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

    // MARK: - Google Sign-In (ASWebAuthenticationSession + PKCE)

    /// Google Cloud **iOS** OAuth client ID (`….apps.googleusercontent.com`).
    ///
    /// Resolution:
    /// 1. `NOMARKUP_GOOGLE_IOS_CLIENT_ID` env
    /// 2. Info.plist `GoogleIosClientID`
    /// 3. Empty → Google button hidden (`isGoogleSignInConfigured == false`)
    ///
    /// Must match a gateway `GOOGLE_IOS_CLIENT_ID` (or `GOOGLE_CLIENT_ID`) so
    /// `POST /api/v1/auth/google/native` accepts the id_token `aud` claim.
    /// Also register the reverse-client-id URL scheme in `CFBundleURLTypes`
    /// (see `googleOAuthCallbackScheme`).
    static var googleIosClientID: String? {
        if let env = ProcessInfo.processInfo.environment["NOMARKUP_GOOGLE_IOS_CLIENT_ID"] {
            let trimmed = env.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmed.isEmpty { return trimmed }
        }
        if let plist = Bundle.main.object(forInfoDictionaryKey: "GoogleIosClientID") as? String {
            let trimmed = plist.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmed.isEmpty, !trimmed.contains("YOUR_") { return trimmed }
        }
        return nil
    }

    /// True when a Google iOS client ID and redirect URI are present.
    /// Login UI hides the Google button when false.
    static var isGoogleSignInConfigured: Bool {
        googleIosClientID != nil && googleOAuthRedirectURI != nil
    }

    /// Reverse client ID URL scheme Google issues for iOS clients.
    /// Example: client `123-abc.apps.googleusercontent.com` →
    /// scheme `com.googleusercontent.apps.123-abc`.
    static var googleOAuthCallbackScheme: String? {
        guard let clientID = googleIosClientID else { return nil }
        return googleOAuthCallbackScheme(forClientID: clientID)
    }

    /// Pure reverse-client-id scheme (unit-tested).
    static func googleOAuthCallbackScheme(forClientID clientID: String) -> String? {
        guard clientID.hasSuffix(".apps.googleusercontent.com") else { return nil }
        let prefix = String(clientID.dropLast(".apps.googleusercontent.com".count))
        guard !prefix.isEmpty else { return nil }
        return "com.googleusercontent.apps.\(prefix)"
    }

    /// Redirect URI registered with Google for the iOS public client + PKCE.
    /// Default: `{reverse-client-id-scheme}:/oauth2redirect/google`
    /// Override with Info.plist `GoogleOAuthRedirectURI` when using a custom scheme.
    static var googleOAuthRedirectURI: String? {
        if let plist = Bundle.main.object(forInfoDictionaryKey: "GoogleOAuthRedirectURI") as? String {
            let trimmed = plist.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmed.isEmpty { return trimmed }
        }
        guard let scheme = googleOAuthCallbackScheme else { return nil }
        return "\(scheme):/oauth2redirect/google"
    }

    // MARK: - Facebook Sign-In (ASWebAuthenticationSession + server code exchange)

    /// Meta / Facebook App ID (public). Same value as gateway `FACEBOOK_CLIENT_ID`.
    ///
    /// Resolution:
    /// 1. `NOMARKUP_FACEBOOK_APP_ID` env
    /// 2. Info.plist `FacebookAppID`
    /// 3. Empty → Facebook button hidden (`isFacebookSignInConfigured == false`)
    ///
    /// Never put `FACEBOOK_CLIENT_SECRET` on the client. Register redirect URI
    /// `nomarkup://oauth2redirect/facebook` as a Valid OAuth Redirect URI on the Meta app.
    static var facebookAppID: String? {
        if let env = ProcessInfo.processInfo.environment["NOMARKUP_FACEBOOK_APP_ID"] {
            let trimmed = env.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmed.isEmpty { return trimmed }
        }
        if let plist = Bundle.main.object(forInfoDictionaryKey: "FacebookAppID") as? String {
            let trimmed = plist.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmed.isEmpty, !trimmed.contains("YOUR_") { return trimmed }
        }
        return nil
    }

    /// True when Facebook App ID and redirect URI are present.
    static var isFacebookSignInConfigured: Bool {
        facebookAppID != nil && facebookOAuthRedirectURI != nil
    }

    /// Callback URL scheme for ASWebAuthenticationSession (`nomarkup`).
    static var facebookOAuthCallbackScheme: String? {
        "nomarkup"
    }

    /// Redirect URI registered with Meta for the native public client.
    /// Default: `nomarkup://oauth2redirect/facebook`
    /// Override with Info.plist `FacebookOAuthRedirectURI`.
    static var facebookOAuthRedirectURI: String? {
        if let plist = Bundle.main.object(forInfoDictionaryKey: "FacebookOAuthRedirectURI") as? String {
            let trimmed = plist.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmed.isEmpty { return trimmed }
        }
        guard facebookAppID != nil else { return nil }
        return "nomarkup://oauth2redirect/facebook"
    }

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

    // MARK: - Private

    /// Once-flag for insecure-base diagnostics (Swift 6: nonisolated(unsafe) is intentional —
    /// best-effort log throttle only; never gates security decisions).
    private nonisolated(unsafe) static var didLogInsecureBase = false

    private static func logInsecureBaseOnce(source: String, value: String) {
        guard !didLogInsecureBase else { return }
        didLogInsecureBase = true
        // No secrets in the message — host only when parseable.
        let host = URL(string: value)?.host ?? "(unparseable)"
        // Use NSLog once so archive diagnostics surface without a logging stack dependency.
        NSLog("[AppConfig] Ignoring non-HTTPS API base from \(source) (host=\(host)); using production HTTPS.")
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
