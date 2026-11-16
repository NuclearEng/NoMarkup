import XCTest
@testable import NoMarkup

final class AgeGateMathTests: XCTestCase {
    func testMinimumAgeIsEighteen() {
        XCTAssertEqual(AgeGateMath.minimumAgeYears, 18)
    }

    func testAgeYearsOnEighteenthBirthdayIsEighteen() {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        let reference = calendar.date(from: DateComponents(year: 2026, month: 8, day: 21))!
        let eighteenth = calendar.date(from: DateComponents(year: 2008, month: 8, day: 21))!
        XCTAssertEqual(AgeGateMath.ageYears(dob: eighteenth, reference: reference, calendar: calendar), 18)
    }

    func testAgeYearsDayBeforeEighteenthBirthdayIsSeventeen() {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        let reference = calendar.date(from: DateComponents(year: 2026, month: 8, day: 21))!
        let stillSeventeen = calendar.date(from: DateComponents(year: 2008, month: 8, day: 22))!
        XCTAssertEqual(AgeGateMath.ageYears(dob: stillSeventeen, reference: reference, calendar: calendar), 17)
        XCTAssertLessThan(
            AgeGateMath.ageYears(dob: stillSeventeen, reference: reference, calendar: calendar) ?? 0,
            AgeGateMath.minimumAgeYears
        )
    }

    func testYYYYMMDDFormatsCalendarDate() {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        let date = calendar.date(from: DateComponents(year: 2005, month: 1, day: 9))!
        XCTAssertEqual(AgeGateMath.yyyyMMdd(date, calendar: calendar), "2005-01-09")
    }

    func testDecisionHidesWhenNotAuthenticated() {
        XCTAssertEqual(
            AgeGateMath.decision(
                isAuthenticated: false,
                isScaffoldSession: false,
                result: .failure(APIClientError.unreachable)
            ),
            .hide
        )
    }

    func testDecisionHidesScaffoldSessionEvenOnError() {
        XCTAssertEqual(
            AgeGateMath.decision(
                isAuthenticated: true,
                isScaffoldSession: true,
                result: .failure(APIClientError.unreachable)
            ),
            .hide
        )
    }

    func testDecisionHidesUnauthorized() {
        XCTAssertEqual(
            AgeGateMath.decision(
                isAuthenticated: true,
                isScaffoldSession: false,
                result: .failure(APIClientError.unauthorized)
            ),
            .hide
        )
    }

    func testDecisionHidesWhenVerified() {
        XCTAssertEqual(
            AgeGateMath.decision(
                isAuthenticated: true,
                isScaffoldSession: false,
                result: .success(true)
            ),
            .hide
        )
    }

    func testDecisionCollectsDOBWhenUnverified() {
        XCTAssertEqual(
            AgeGateMath.decision(
                isAuthenticated: true,
                isScaffoldSession: false,
                result: .success(false)
            ),
            .collectDateOfBirth
        )
    }

    func testDecisionFailsClosedOnNetworkError() {
        XCTAssertEqual(
            AgeGateMath.decision(
                isAuthenticated: true,
                isScaffoldSession: false,
                result: .failure(APIClientError.unreachable)
            ),
            .retryRequired
        )
    }

    func testDecisionFailsClosedOnServerError() {
        XCTAssertEqual(
            AgeGateMath.decision(
                isAuthenticated: true,
                isScaffoldSession: false,
                result: .failure(APIClientError.httpStatus(500, detail: "age-status down"))
            ),
            .retryRequired
        )
    }

    func testDecisionFailsClosedOnTransportTimeout() {
        XCTAssertEqual(
            AgeGateMath.decision(
                isAuthenticated: true,
                isScaffoldSession: false,
                result: .failure(URLError(.timedOut))
            ),
            .retryRequired
        )
    }
}
