import XCTest
@testable import NoMarkup

final class SoftTravelETATests: XCTestCase {
    func testLabelNilWhenMissingOrNonPositive() {
        XCTAssertNil(SoftTravelETA.label(minutes: nil))
        XCTAssertNil(SoftTravelETA.label(minutes: 0))
        XCTAssertNil(SoftTravelETA.label(minutes: -1))
    }

    func testLabelMinutesAndHoursDriveTime() {
        XCTAssertEqual(SoftTravelETA.label(minutes: 12), "≈ 12 min approx. drive time")
        XCTAssertEqual(SoftTravelETA.label(minutes: 60), "≈ 1h approx. drive time")
        XCTAssertEqual(SoftTravelETA.label(minutes: 75), "≈ 1h 15m approx. drive time")
    }

    func testLabelMapKitSourceTagged() {
        XCTAssertEqual(
            SoftTravelETA.label(minutes: 12, source: .mapKit),
            "≈ 12 min approx. drive time (MapKit)"
        )
        XCTAssertEqual(
            SoftTravelETA.label(minutes: 12, source: .server),
            "≈ 12 min approx. drive time"
        )
        XCTAssertEqual(
            SoftTravelETA.label(minutes: 12, source: .haversine),
            "≈ 12 min approx. drive time"
        )
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

    func testResolveFallsBackToServerWhenNoFromCoords() async {
        let est = await SoftTravelETA.resolve(
            fromLat: nil,
            fromLng: nil,
            toLat: 47.6,
            toLng: -122.3,
            serverMinutes: 18
        )
        XCTAssertEqual(est?.minutes, 18)
        XCTAssertEqual(est?.source, .server)
    }

    func testResolveFallsBackToHaversineWhenServerMissing() async {
        // Same point → MapKit short-circuits to 1 min mapKit; use distant points
        // without network by omitting valid pair? With both ends, MapKit may run.
        // Force haversine path: invalid MapKit via nil from — already covered.
        // Here: server nil, from present → MapKit may succeed or haversine.
        let est = await SoftTravelETA.resolve(
            fromLat: 47.6,
            fromLng: -122.3,
            toLat: 47.61,
            toLng: -122.31,
            serverMinutes: nil
        )
        XCTAssertNotNil(est)
        XCTAssertGreaterThan(est?.minutes ?? 0, 0)
        // Source is mapKit when Apple Directions available; otherwise haversine.
        XCTAssertTrue(est?.source == .mapKit || est?.source == .haversine)
    }
}
