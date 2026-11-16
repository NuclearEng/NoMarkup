import XCTest
@testable import NoMarkup

// Pre-Stripe gate only. Do not present PaymentSheet or call Stripe from here.
// RailACheckout is @MainActor; the disclosure checks stay on that actor.
@MainActor
final class CheckoutSecretTests: XCTestCase {
    func testPaymentIntentSecretAcceptsTrimmedPiSecret() {
        let samples = [
            "pi_3abc_secret_xyz",
            "  pi_3abc_secret_xyz  ",
            "\n\tpi_3abc_secret_xyz\n",
            // Same shape rule: pi_dev_secret_* is confirmable. Envelope has no dev skip.
            "pi_dev_secret_local",
        ]
        for sample in samples {
            XCTAssertTrue(envelope(clientSecret: sample).hasConfirmableSecret, sample)
        }
    }

    func testPaymentIntentSecretRejectsNilEmptyAndNonPaymentShapes() {
        let rejected: [String?] = [
            nil,
            "",
            "   ",
            "\n\t",
            "seti_abc123_secret_xyz",
            "pk_test_abc",
            "pi_missingsecret",
            "pi_dev_local",
        ]
        for sample in rejected {
            XCTAssertFalse(
                envelope(clientSecret: sample).hasConfirmableSecret,
                "expected no confirmable secret for \(String(describing: sample))"
            )
        }
    }

    func testDisplayTotalCentsPrefersPositiveTotalThenAmount() {
        XCTAssertEqual(envelope(totalCents: 2_500, amountCents: 1_800).displayTotalCents, 2_500)
        XCTAssertEqual(envelope(totalCents: 1, amountCents: 0).displayTotalCents, 1)
        XCTAssertEqual(envelope(totalCents: 2_500).displayTotalCents, 2_500)
        XCTAssertEqual(envelope(amountCents: 1_800).displayTotalCents, 1_800)
        XCTAssertEqual(envelope(totalCents: 0, amountCents: 1_800).displayTotalCents, 1_800)
        XCTAssertEqual(envelope(totalCents: -1, amountCents: 1_800).displayTotalCents, 1_800)
    }

    func testDisplayTotalCentsRejectsZeroAndNegative() {
        XCTAssertNil(envelope().displayTotalCents)
        XCTAssertNil(envelope(totalCents: 0).displayTotalCents)
        XCTAssertNil(envelope(amountCents: 0).displayTotalCents)
        XCTAssertNil(envelope(totalCents: 0, amountCents: 0).displayTotalCents)
        XCTAssertNil(envelope(totalCents: -5).displayTotalCents)
        XCTAssertNil(envelope(amountCents: -5).displayTotalCents)
        XCTAssertNil(envelope(totalCents: -5, amountCents: -1).displayTotalCents)
        XCTAssertNil(envelope(totalCents: 0, amountCents: -1).displayTotalCents)
    }

    func testContractPaymentConfirmableSecretMatchesPiShape() throws {
        let accepted = [
            "pi_3abc_secret_xyz",
            "  pi_3abc_secret_xyz  ",
            // Dev sentinel still matches pi_ + _secret_. Callers check isDevClientSecret first.
            "pi_dev_secret_local",
        ]
        for sample in accepted {
            let payment = try contractPayment(clientSecret: sample)
            XCTAssertTrue(payment.hasConfirmableSecret, sample)
        }

        let rejected: [String?] = [
            nil,
            "",
            "   ",
            "\n\t",
            "seti_abc123_secret_xyz",
            "pk_test_abc",
            "pi_missingsecret",
            "pi_dev_local",
            "dev_local",
        ]
        for sample in rejected {
            let payment = try contractPayment(clientSecret: sample)
            XCTAssertFalse(
                payment.hasConfirmableSecret,
                "expected no confirmable secret for \(String(describing: sample))"
            )
        }
    }

    func testContractPaymentDevClientSecret() throws {
        let devSamples = [
            "pi_dev_local",
            "pi_dev_secret_local",
            "  pi_dev_secret_local  ",
            "dev_local",
            "  dev_local  ",
        ]
        for sample in devSamples {
            let payment = try contractPayment(clientSecret: sample)
            XCTAssertTrue(payment.isDevClientSecret, sample)
        }

        let notDev: [String?] = [
            nil,
            "",
            "   ",
            "seti_abc123_secret_xyz",
            "pk_test_abc",
            "pi_missingsecret",
            "pi_3abc_secret_xyz",
        ]
        for sample in notDev {
            let payment = try contractPayment(clientSecret: sample)
            XCTAssertFalse(
                payment.isDevClientSecret,
                "expected non-dev secret for \(String(describing: sample))"
            )
        }
    }

    func testRecurringDisclosureBlankAndRecurringUseSchedule() {
        let amount = "$25.00"
        let expected = disclosure(term: "on a recurring schedule", amount: amount)
        for frequency in ["", "   ", "Recurring", " recurring ", "RECURRING"] {
            let copy = RailACheckout.recurringAuthorizationDisclosure(
                frequency: frequency,
                amount: amount
            )
            XCTAssertEqual(copy, expected, frequency)
            XCTAssertTrue(copy.contains("on a recurring schedule"), frequency)
            XCTAssertTrue(copy.contains(amount), frequency)
            XCTAssertFalse(copy.contains("%"), frequency)
        }
    }

    func testRecurringDisclosureLowercasesFrequencyAndKeepsAmount() {
        let weeklyAmount = "$40.00"
        let weekly = RailACheckout.recurringAuthorizationDisclosure(
            frequency: "Weekly",
            amount: weeklyAmount
        )
        XCTAssertEqual(weekly, disclosure(term: "weekly", amount: weeklyAmount))
        XCTAssertTrue(weekly.contains("weekly"))
        XCTAssertFalse(weekly.contains("Weekly"))
        XCTAssertTrue(weekly.contains(weeklyAmount))

        let spacedAmount = "$1,234.56"
        let everyTwoWeeks = RailACheckout.recurringAuthorizationDisclosure(
            frequency: "Every 2 Weeks",
            amount: spacedAmount
        )
        XCTAssertEqual(
            everyTwoWeeks,
            disclosure(term: "every 2 weeks", amount: spacedAmount)
        )
        XCTAssertTrue(everyTwoWeeks.contains(spacedAmount))
        XCTAssertFalse(weekly.contains("%"))
        XCTAssertFalse(everyTwoWeeks.contains("%"))
    }

    func testRecurringDisclosureStatesEscrowReleaseAndCancelWithoutPercent() {
        let amount = "$25.00"
        let copy = RailACheckout.recurringAuthorizationDisclosure(
            frequency: "Monthly",
            amount: amount
        )
        XCTAssertEqual(copy, disclosure(term: "monthly", amount: amount))
        XCTAssertTrue(copy.contains("held in escrow until you release it"))
        XCTAssertTrue(copy.contains("until you cancel"))
        XCTAssertTrue(copy.contains("Cancel"))
        XCTAssertTrue(copy.contains(amount))
        XCTAssertFalse(copy.contains("%"))
    }

    private func envelope(
        clientSecret: String? = nil,
        totalCents: Int64? = nil,
        amountCents: Int64? = nil
    ) -> PaymentIntentEnvelope {
        PaymentIntentEnvelope(
            orderId: nil,
            clientSecret: clientSecret,
            paymentIntentId: nil,
            paymentRequired: nil,
            totalCents: totalCents,
            amountCents: amountCents,
            feeCents: nil,
            taxCents: nil,
            escrowStatus: nil,
            chargeError: nil
        )
    }

    private func contractPayment(clientSecret: String?) throws -> ContractPayment {
        var payload: [String: String] = [
            "id": "11111111-1111-1111-1111-111111111111",
        ]
        if let clientSecret {
            payload["client" + "_" + "secret"] = clientSecret
        }
        let data = try JSONSerialization.data(withJSONObject: payload)
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        return try decoder.decode(ContractPayment.self, from: data)
    }

    private func disclosure(term: String, amount: String) -> String {
        "Renews \(term). Continues until you cancel. Each period provides one service visit at \(amount), held in escrow until you release it after approving work. That amount is billed each period; automatic retries may bill the same amount. Cancel in-app with Cancel schedule on this contract or from Recurring jobs."
    }
}
