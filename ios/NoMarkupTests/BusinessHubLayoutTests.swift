import XCTest
@testable import NoMarkup

final class BusinessHubLayoutTests: XCTestCase {
    func testOffFlagHubOmitsLendingAndDoesNotAdvertise() {
        let layout = BusinessHubLayout { _ in false }
        let copy = layout.visibleCopy.joined(separator: "\n")

        XCTAssertFalse(layout.showMoneyRails)
        XCTAssertFalse(layout.showInsuranceCatalog)
        XCTAssertTrue(layout.moneyRailTitles.isEmpty)
        XCTAssertTrue(layout.insuranceCatalogTitles.isEmpty)

        XCTAssertFalse(copy.contains("Payment plans"))
        XCTAssertFalse(copy.contains("Instant payout"))
        XCTAssertFalse(copy.contains("Working capital"))
        XCTAssertFalse(copy.contains("Not in this App Store build"))

        XCTAssertTrue(copy.contains("Business expenses"))
        XCTAssertTrue(copy.contains("Invoices"))
        XCTAssertTrue(copy.contains("Tax center"))
        XCTAssertTrue(copy.contains("Licensed rails appear when enabled"))
        XCTAssertFalse(copy.contains("BNPL"))
        XCTAssertFalse(copy.contains("Money rails"))
        XCTAssertFalse(copy.contains("Insurance catalog"))
    }

    func testPaymentPlansRowWhenBNPLEnabled() {
        let layout = BusinessHubLayout { $0 == "customer_bnpl" }
        XCTAssertTrue(layout.showMoneyRails)
        XCTAssertTrue(layout.showPaymentPlans)
        XCTAssertFalse(layout.showInsuranceCatalog)
        XCTAssertTrue(layout.moneyRailTitles.contains { $0.contains("Payment plans") })
        XCTAssertFalse(layout.visibleCopy.joined(separator: "\n").contains("Not in this App Store build"))
    }

    func testInsuranceCatalogWhenEitherInsuranceFlagEnabled() {
        let perJob = BusinessHubLayout { $0 == "per_job_insurance" }
        XCTAssertTrue(perJob.showInsurancePolicies)
        XCTAssertTrue(perJob.showInsuranceCatalog)
        XCTAssertTrue(perJob.showMoneyRails)
        XCTAssertTrue(perJob.insuranceCatalogTitles.contains("Insurance quote"))

        let competition = BusinessHubLayout { $0 == "insurance_competition" }
        XCTAssertFalse(competition.showInsurancePolicies)
        XCTAssertTrue(competition.showInsuranceCatalog)
        XCTAssertFalse(competition.showMoneyRails)
        XCTAssertFalse(competition.visibleCopy.joined(separator: " ").contains("Payment plans"))
    }

    func testInstantPayoutAndWorkingCapitalRowsWhenEnabled() {
        let layout = BusinessHubLayout { $0 == "instant_payout" || $0 == "working_capital" }
        XCTAssertTrue(layout.showMoneyRails)
        XCTAssertTrue(layout.showInstantPayout)
        XCTAssertTrue(layout.showWorkingCapital)
        let copy = layout.visibleCopy.joined(separator: "\n")
        XCTAssertTrue(copy.contains("Instant payout"))
        XCTAssertTrue(copy.contains("Working capital"))
        XCTAssertFalse(copy.contains("Not in this App Store build"))
        XCTAssertFalse(copy.contains("Payment plans"))
    }
}
