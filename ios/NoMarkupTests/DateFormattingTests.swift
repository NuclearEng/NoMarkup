import XCTest
@testable import NoMarkup

final class DateFormattingTests: XCTestCase {
    func testCountdownEnded() {
        let now = Date(timeIntervalSince1970: 1_700_000_000)
        let past = now.addingTimeInterval(-60)
        XCTAssertEqual(CatalogDateFormat.countdownLabel(until: past, now: now), String(localized: "Ended"))
        XCTAssertEqual(CatalogDateFormat.countdownChipLabel(until: past, now: now), String(localized: "Ended"))
    }

    func testCountdownMinutesAndHours() {
        let now = Date(timeIntervalSince1970: 1_700_000_000)
        let in45m = now.addingTimeInterval(45 * 60)
        let minutesChip = CatalogDateFormat.countdownChipLabel(until: in45m, now: now)
        XCTAssertTrue(minutesChip.contains("45"), minutesChip)
        XCTAssertFalse(minutesChip.localizedCaseInsensitiveContains("ends"), minutesChip)
        let minutesLabel = CatalogDateFormat.countdownLabel(until: in45m, now: now)
        XCTAssertTrue(minutesLabel.contains(minutesChip), minutesLabel)
        XCTAssertNotEqual(minutesLabel, minutesChip)

        let in2h = now.addingTimeInterval(2 * 3600)
        let hoursChip = CatalogDateFormat.countdownChipLabel(until: in2h, now: now)
        XCTAssertTrue(hoursChip.contains("2"), hoursChip)
        XCTAssertFalse(hoursChip.localizedCaseInsensitiveContains("ends"), hoursChip)
        let hoursLabel = CatalogDateFormat.countdownLabel(until: in2h, now: now)
        XCTAssertTrue(hoursLabel.contains(hoursChip), hoursLabel)
        XCTAssertEqual(
            hoursChip,
            Duration.seconds(2 * 3600).formatted(.units(allowed: [.hours], width: .narrow))
        )

        let in2h30 = now.addingTimeInterval(2 * 3600 + 30 * 60)
        let mixedChip = CatalogDateFormat.countdownChipLabel(until: in2h30, now: now)
        XCTAssertTrue(mixedChip.contains("2"), mixedChip)
        XCTAssertTrue(mixedChip.contains("30"), mixedChip)
        XCTAssertEqual(
            mixedChip,
            Duration.seconds(2 * 3600 + 30 * 60)
                .formatted(.units(allowed: [.hours, .minutes], width: .narrow, maximumUnitCount: 2))
        )
        XCTAssertEqual(
            minutesChip,
            Duration.seconds(45 * 60).formatted(.units(allowed: [.minutes], width: .narrow))
        )
    }

    func testCountdownChipLabelCompact() {
        let now = Date(timeIntervalSince1970: 1_700_000_000)
        let past = now.addingTimeInterval(-60)
        XCTAssertEqual(CatalogDateFormat.countdownChipLabel(until: past, now: now), String(localized: "Ended"))
        let in45m = now.addingTimeInterval(45 * 60)
        let minutesChip = CatalogDateFormat.countdownChipLabel(until: in45m, now: now)
        XCTAssertTrue(minutesChip.contains("45"), minutesChip)
        XCTAssertFalse(minutesChip.contains(" "), minutesChip)
        let in2h = now.addingTimeInterval(2 * 3600)
        XCTAssertFalse(
            CatalogDateFormat.countdownChipLabel(until: in2h, now: now)
                .localizedCaseInsensitiveContains("ends")
        )
        let in2h30 = now.addingTimeInterval(2 * 3600 + 30 * 60)
        let mixed = CatalogDateFormat.countdownChipLabel(until: in2h30, now: now)
        XCTAssertTrue(mixed.contains("2") && mixed.contains("30"), mixed)
        XCTAssertTrue(CatalogDateFormat.isCountdownUrgent(until: in45m, now: now))
        XCTAssertFalse(CatalogDateFormat.isCountdownUrgent(until: in2h, now: now))
    }

    func testCountdownDaysAndFarOut() {
        let now = Date(timeIntervalSince1970: 1_700_000_000)
        let in3d = now.addingTimeInterval(3 * 24 * 3600)
        let daysChip = CatalogDateFormat.countdownChipLabel(until: in3d, now: now)
        XCTAssertEqual(
            daysChip,
            Duration.seconds(3 * 86_400).formatted(.units(allowed: [.days], width: .narrow))
        )
        XCTAssertTrue(daysChip.contains("3"), daysChip)
        let daysLabel = CatalogDateFormat.countdownLabel(until: in3d, now: now)
        XCTAssertTrue(daysLabel.contains(daysChip), daysLabel)
        XCTAssertNotEqual(daysLabel, daysChip)

        let in30d = now.addingTimeInterval(30 * 24 * 3600)
        let absolute = in30d.formatted(date: .abbreviated, time: .omitted)
        XCTAssertEqual(CatalogDateFormat.countdownChipLabel(until: in30d, now: now), absolute)
        let farLabel = CatalogDateFormat.countdownLabel(until: in30d, now: now)
        XCTAssertTrue(farLabel.contains(absolute), farLabel)
        XCTAssertNotEqual(farLabel, absolute)
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
