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

    /// Gateway HTTP base (no trailing slash).
    ///
    /// Resolution:
    /// 1. `NOMARKUP_API_BASE_URL` env (any configuration)
    /// 2. **DEBUG:** `http://localhost:8080` (matches `.env.example` GATEWAY_PORT / NEXT_PUBLIC_API_URL)
    /// 3. Info.plist `APIBaseURL` (release packaging override)
    /// 4. `https://api.no-markup.com`
    static var apiBaseURL: URL {
        if let env = ProcessInfo.processInfo.environment["NOMARKUP_API_BASE_URL"],
           let url = URL(string: env), !env.isEmpty {
            return url
        }

        #if DEBUG
        return URL(string: "http://localhost:8080")!
        #else
        if let plist = Bundle.main.object(forInfoDictionaryKey: "APIBaseURL") as? String,
           let url = URL(string: plist), !plist.isEmpty {
            return url
        }
        return URL(string: "https://api.no-markup.com")!
        #endif
    }

    static var apiBaseURLString: String {
        apiBaseURL.absoluteString
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
}
