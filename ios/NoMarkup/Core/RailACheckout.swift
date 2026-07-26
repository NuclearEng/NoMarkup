import StripePaymentSheet
import SwiftUI
import UIKit

/// Rail A checkout — **Apple Pay + wallet-first** via Stripe PaymentSheet.
///
/// Physical goods / local-pickup marketplace GMV (ASR 3.1.3(e)) settles on
/// Stripe Connect PaymentIntents. The gateway returns a `client_secret`; this
/// module confirms it with the system Apple Pay sheet when available, otherwise
/// PaymentSheet’s card / Link UI (“etc.”).
///
/// **Not** StoreKit IAP (digital unlocks — intentionally out of v1).
@MainActor
enum RailACheckout {
    enum CheckoutError: Error, LocalizedError {
        case stripeNotConfigured
        case noPresenter
        case canceled
        case missingClientSecret

        var errorDescription: String? {
            switch self {
            case .stripeNotConfigured:
                return "Apple Pay is not configured in this build. Set StripePublishableKey (Info.plist) or NOMARKUP_STRIPE_PUBLISHABLE_KEY."
            case .noPresenter:
                return "Could not present Apple Pay. Try again from the main screen."
            case .canceled:
                return "Payment canceled."
            case .missingClientSecret:
                return "Payment could not start — no client secret from the server. Open Orders to retry."
            }
        }

        var isCanceled: Bool {
            if case .canceled = self { return true }
            return false
        }
    }

    /// Configures `STPAPIClient` and presents PaymentSheet (Apple Pay when eligible).
    static func presentPaymentSheet(clientSecret: String) async throws {
        let secret = clientSecret.trimmingCharacters(in: .whitespacesAndNewlines)
        guard secret.hasPrefix("pi_"), secret.contains("_secret_") else {
            throw CheckoutError.missingClientSecret
        }

        try configureStripe()

        var configuration = PaymentSheet.Configuration()
        configuration.merchantDisplayName = AppConfig.appDisplayName
        configuration.allowsDelayedPaymentMethods = false
        configuration.returnURL = "nomarkup://stripe-redirect"

        let merchantId = AppConfig.applePayMerchantId
        if !merchantId.isEmpty {
            configuration.applePay = .init(
                merchantId: merchantId,
                merchantCountryCode: AppConfig.applePayMerchantCountryCode
            )
        }

        let sheet = PaymentSheet(
            paymentIntentClientSecret: secret,
            configuration: configuration
        )

        guard let presenter = UIApplication.shared.nmTopViewController() else {
            throw CheckoutError.noPresenter
        }

        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            sheet.present(from: presenter) { result in
                switch result {
                case .completed:
                    continuation.resume()
                case .canceled:
                    continuation.resume(throwing: CheckoutError.canceled)
                case .failed(let error):
                    continuation.resume(throwing: error)
                }
            }
        }
    }

    private static func configureStripe() throws {
        let key = AppConfig.stripePublishableKey
        guard key.hasPrefix("pk_"), !key.contains("...") else {
            throw CheckoutError.stripeNotConfigured
        }
        STPAPIClient.shared.publishableKey = key
    }
}

// MARK: - UIKit presenter helper

extension UIApplication {
    /// Key-window root → topmost presented view controller (for PaymentSheet).
    @MainActor
    func nmTopViewController(base: UIViewController? = nil) -> UIViewController? {
        let root: UIViewController?
        if let base {
            root = base
        } else {
            root = connectedScenes
                .compactMap { $0 as? UIWindowScene }
                .flatMap(\.windows)
                .first(where: \.isKeyWindow)?
                .rootViewController
        }
        guard let root else { return nil }
        if let nav = root as? UINavigationController {
            return nmTopViewController(base: nav.visibleViewController ?? nav)
        }
        if let tab = root as? UITabBarController {
            return nmTopViewController(base: tab.selectedViewController ?? tab)
        }
        if let presented = root.presentedViewController {
            return nmTopViewController(base: presented)
        }
        return root
    }
}
