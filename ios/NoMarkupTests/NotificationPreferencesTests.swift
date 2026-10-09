import XCTest
@testable import NoMarkup

final class NotificationPreferencesTests: XCTestCase {
    func testMarketingTypesIncludePromoAndWelcomeDayPrefix() {
        let marketing = [
            "price_drop",
            "seller_new_listing",
            "promotional",
            "marketing",
            "welcome_day",
            "welcome_day_1",
            "welcome_day_3",
            "welcome_day_7",
            "welcome_day_14",
            " PRICE_DROP ",
            "Welcome_Day_1",
        ]
        for type in marketing {
            XCTAssertTrue(
                NotificationPreferencesView.isMarketingNotificationType(type),
                "expected marketing: \(type)"
            )
        }
    }

    func testTransactionalAndCriticalAreNotMarketing() {
        let notMarketing = [
            "bid_outbid",
            "bid_awarded",
            "new_bid",
            "auction_closing_soon",
            "auction_closed",
            "contract_created",
            "contract_accepted",
            "new_message",
            "payment_received",
            "payment_released",
            "payment_failed",
            "dispute_opened",
            "dispute_resolved",
            "job_matched",
            "welcome",
            "welcome_email",
            "",
            "   ",
        ]
        for type in notMarketing {
            XCTAssertFalse(
                NotificationPreferencesView.isMarketingNotificationType(type),
                "expected not marketing: \(type)"
            )
        }
    }

    func testMarketingAndCriticalDoNotOverlap() {
        let types = [
            "price_drop", "seller_new_listing", "promotional", "marketing",
            "welcome_day_1", "payment_failed", "dispute_opened", "guarantee_claim",
            "bid_outbid",
        ]
        for type in types {
            let marketing = NotificationPreferencesView.isMarketingNotificationType(type)
            let critical = NotificationPreferencesView.isCriticalNotificationType(type)
            XCTAssertFalse(marketing && critical, "\(type) classified as both")
        }
    }

    func testSeededDefaultsDisableMarketingPush() {
        let rows = NotificationPreferencesView.seededDefaultRows()
        XCTAssertFalse(rows.isEmpty)

        let marketing = rows.filter {
            NotificationPreferencesView.isMarketingNotificationType($0.notificationType)
        }
        XCTAssertFalse(marketing.isEmpty, "seed list must include marketing types (price_drop, seller_new_listing)")
        for row in marketing {
            XCTAssertFalse(row.pushEnabled, "marketing seed must have push off: \(row.notificationType)")
        }

        let transactional = rows.filter {
            !NotificationPreferencesView.isMarketingNotificationType($0.notificationType)
                && !NotificationPreferencesView.isCriticalNotificationType($0.notificationType)
        }
        for row in transactional {
            XCTAssertTrue(row.pushEnabled, "transactional seed should have push on: \(row.notificationType)")
        }

        let critical = rows.filter {
            NotificationPreferencesView.isCriticalNotificationType($0.notificationType)
        }
        for row in critical {
            XCTAssertTrue(row.pushEnabled, "critical seed must have push on: \(row.notificationType)")
        }

        XCTAssertFalse(NotificationPreferencesView.marketingConsent(from: rows))
    }

    func testPrePromptStaysTransactionalAndDisclaimsMarketingConsent() {
        let body = NotificationPermissionCopy.prePromptBody.lowercased()
        XCTAssertTrue(body.contains("outbid"))
        XCTAssertTrue(body.contains("close") || body.contains("closing"))
        XCTAssertTrue(body.contains("awarded"))
        XCTAssertTrue(body.contains("optional"))
        XCTAssertTrue(body.contains("notification preferences"))
        XCTAssertTrue(body.contains("not marketing consent"))
    }

    func testMarketingConsentCopyIsOptional() {
        XCTAssertEqual(
            NotificationPermissionCopy.marketingConsentTitle,
            "Marketing and recommendations"
        )
        let body = NotificationPermissionCopy.marketingConsentBody.lowercased()
        XCTAssertTrue(body.contains("optional"))
        XCTAssertTrue(body.contains("not required"))
    }
}
