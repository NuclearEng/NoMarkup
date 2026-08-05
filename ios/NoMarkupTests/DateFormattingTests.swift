import XCTest
@testable import NoMarkup

final class DateFormattingTests: XCTestCase {
    func testCountdownEnded() {
        let now = Date(timeIntervalSince1970: 1_700_000_000)
        let past = now.addingTimeInterval(-60)
        XCTAssertEqual(CatalogDateFormat.countdownLabel(until: past, now: now), "Ended")
    }

    func testCountdownMinutesAndHours() {
        let now = Date(timeIntervalSince1970: 1_700_000_000)
        let in45m = now.addingTimeInterval(45 * 60)
        XCTAssertEqual(CatalogDateFormat.countdownLabel(until: in45m, now: now), "Ends in 45m")
        let in2h = now.addingTimeInterval(2 * 3600)
        XCTAssertEqual(CatalogDateFormat.countdownLabel(until: in2h, now: now), "Ends in 2h")
        let in2h30 = now.addingTimeInterval(2 * 3600 + 30 * 60)
        XCTAssertEqual(CatalogDateFormat.countdownLabel(until: in2h30, now: now), "Ends in 2h 30m")
    }

    func testCountdownChipLabelCompact() {
        let now = Date(timeIntervalSince1970: 1_700_000_000)
        let past = now.addingTimeInterval(-60)
        XCTAssertEqual(CatalogDateFormat.countdownChipLabel(until: past, now: now), "Ended")
        let in45m = now.addingTimeInterval(45 * 60)
        XCTAssertEqual(CatalogDateFormat.countdownChipLabel(until: in45m, now: now), "45m")
        let in2h = now.addingTimeInterval(2 * 3600)
        XCTAssertEqual(CatalogDateFormat.countdownChipLabel(until: in2h, now: now), "2h")
        let in2h30 = now.addingTimeInterval(2 * 3600 + 30 * 60)
        XCTAssertEqual(CatalogDateFormat.countdownChipLabel(until: in2h30, now: now), "2h 30m")
        XCTAssertTrue(CatalogDateFormat.isCountdownUrgent(until: in45m, now: now))
        XCTAssertFalse(CatalogDateFormat.isCountdownUrgent(until: in2h, now: now))
    }

    func testParseISO() {
        XCTAssertNotNil(CatalogDateFormat.parseISO("2026-07-27T12:00:00Z"))
        XCTAssertNotNil(CatalogDateFormat.parseISO("2026-07-27T12:00:00.123Z"))
        XCTAssertNil(CatalogDateFormat.parseISO(""))
        XCTAssertNil(CatalogDateFormat.parseISO("   "))
        XCTAssertNil(CatalogDateFormat.parseISO("not-a-date"))
    }

    func testStatusChipStyle() {
        XCTAssertEqual(StatusChipStyle.forStatus("open"), .success)
        XCTAssertEqual(StatusChipStyle.forStatus("pending_payment"), .warning)
        XCTAssertEqual(StatusChipStyle.forStatus("cancelled"), .danger)
        XCTAssertEqual(StatusChipStyle.forStatus(nil), .neutral)
        XCTAssertEqual(StatusChipStyle.displayLabel("pending_payment"), "Pending Payment")
    }
}
