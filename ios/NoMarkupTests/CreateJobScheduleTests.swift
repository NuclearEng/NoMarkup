import XCTest
@testable import NoMarkup

/// FR-3.1 — `CreateJobRequestBody` must emit gateway `stringToScheduleType` tokens
/// plus ISO8601 date fields (`schedule_type`, `scheduled_date`, `schedule_range_*`).
final class CreateJobScheduleTests: XCTestCase {
    func testNormalizedScheduleTypeMapsPickerTokens() {
        XCTAssertEqual(CreateJobRequestBody.normalizedScheduleType("flexible"), "flexible")
        XCTAssertEqual(CreateJobRequestBody.normalizedScheduleType("specific"), "specific_date")
        XCTAssertEqual(CreateJobRequestBody.normalizedScheduleType("specific_date"), "specific_date")
        XCTAssertEqual(CreateJobRequestBody.normalizedScheduleType("range"), "date_range")
        XCTAssertEqual(CreateJobRequestBody.normalizedScheduleType("date_range"), "date_range")
        XCTAssertEqual(CreateJobRequestBody.normalizedScheduleType("  RANGE  "), "date_range")
        XCTAssertEqual(CreateJobRequestBody.normalizedScheduleType("unknown"), "flexible")
    }

    func testISO8601UTCMatchesGatewayParseTimestamp() {
        var components = DateComponents()
        components.year = 2026
        components.month = 8
        components.day = 13
        components.hour = 0
        components.minute = 0
        components.second = 0
        components.timeZone = TimeZone(secondsFromGMT: 0)
        let date = Calendar(identifier: .gregorian).date(from: components)!
        XCTAssertEqual(CreateJobRequestBody.iso8601UTC(date), "2026-08-13T00:00:00Z")
    }

    func testSpecificDateEncodesGatewayKeys() throws {
        let json = try encode(sampleBody(
            scheduleType: "specific_date",
            scheduledDate: "2026-08-13T00:00:00Z",
            scheduleRangeStart: nil,
            scheduleRangeEnd: nil
        ))
        XCTAssertEqual(json["schedule_type"] as? String, "specific_date")
        XCTAssertEqual(json["scheduled_date"] as? String, "2026-08-13T00:00:00Z")
        XCTAssertTrue(json["schedule_range_start"] is NSNull || json["schedule_range_start"] == nil)
        XCTAssertTrue(json["schedule_range_end"] is NSNull || json["schedule_range_end"] == nil)
    }

    func testDateRangeEncodesGatewayKeys() throws {
        let json = try encode(sampleBody(
            scheduleType: "date_range",
            scheduledDate: nil,
            scheduleRangeStart: "2026-08-13T00:00:00Z",
            scheduleRangeEnd: "2026-08-20T00:00:00Z"
        ))
        XCTAssertEqual(json["schedule_type"] as? String, "date_range")
        XCTAssertEqual(json["schedule_range_start"] as? String, "2026-08-13T00:00:00Z")
        XCTAssertEqual(json["schedule_range_end"] as? String, "2026-08-20T00:00:00Z")
        XCTAssertTrue(json["scheduled_date"] is NSNull || json["scheduled_date"] == nil)
    }

    func testFlexibleOmitsMeaningfulDates() throws {
        let json = try encode(sampleBody(
            scheduleType: "flexible",
            scheduledDate: nil,
            scheduleRangeStart: nil,
            scheduleRangeEnd: nil
        ))
        XCTAssertEqual(json["schedule_type"] as? String, "flexible")
        XCTAssertTrue(json["scheduled_date"] is NSNull || json["scheduled_date"] == nil)
        XCTAssertTrue(json["schedule_range_start"] is NSNull || json["schedule_range_start"] == nil)
        XCTAssertTrue(json["schedule_range_end"] is NSNull || json["schedule_range_end"] == nil)
    }

    private func sampleBody(
        scheduleType: String,
        scheduledDate: String?,
        scheduleRangeStart: String?,
        scheduleRangeEnd: String?
    ) -> CreateJobRequestBody {
        CreateJobRequestBody(
            title: "Mow lawn",
            description: "Front and back",
            categoryId: "cat-1",
            auctionDurationHours: 24,
            startingBidCents: 10_000,
            auctionType: "live",
            locationAddress: nil,
            locationLat: nil,
            locationLng: nil,
            publish: true,
            scheduleType: scheduleType,
            scheduledDate: scheduledDate,
            scheduleRangeStart: scheduleRangeStart,
            scheduleRangeEnd: scheduleRangeEnd,
            photoUrls: [],
            propertyId: nil,
            offerAcceptedCents: nil,
            isRecurring: false,
            recurrenceFrequency: nil
        )
    }

    private func encode(_ body: CreateJobRequestBody) throws -> [String: Any] {
        let encoder = JSONEncoder()
        encoder.keyEncodingStrategy = .convertToSnakeCase
        let data = try encoder.encode(body)
        let object = try JSONSerialization.jsonObject(with: data)
        return try XCTUnwrap(object as? [String: Any])
    }
}
