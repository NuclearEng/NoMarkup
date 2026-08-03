import XCTest
@testable import NoMarkup

final class SoftTravelETATests: XCTestCase {
    func testLabelNilWhenMissingOrNonPositive() {
        XCTAssertNil(SoftTravelETA.label(minutes: nil))
        XCTAssertNil(SoftTravelETA.label(minutes: 0))
        XCTAssertNil(SoftTravelETA.label(minutes: -1))
    }

    func testLabelMinutesAndHours() {
        XCTAssertEqual(SoftTravelETA.label(minutes: 12), "≈ 12 min approx. travel")
        XCTAssertEqual(SoftTravelETA.label(minutes: 60), "≈ 1h approx. travel")
        XCTAssertEqual(SoftTravelETA.label(minutes: 75), "≈ 1h 15m approx. travel")
    }

    func testMinutesPerMileHeuristic() {
        // 1 mile → ~2 minutes
        XCTAssertEqual(SoftTravelETA.minutes(meters: 1609.344), 2)
        XCTAssertEqual(SoftTravelETA.minutes(meters: 0), 1)
        XCTAssertEqual(SoftTravelETA.minutes(meters: 1609.344 * 10_000), 999)
    }

    func testHaversineSamePointIsZeroMinutesFloor() {
        let m = SoftTravelETA.haversineMeters(lat1: 47.6, lng1: -122.3, lat2: 47.6, lng2: -122.3)
        XCTAssertEqual(m, 0, accuracy: 0.01)
        XCTAssertEqual(SoftTravelETA.minutes(meters: m), 1)
    }
}
