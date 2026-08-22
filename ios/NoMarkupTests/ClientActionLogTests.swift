import XCTest
@testable import NoMarkup

final class ClientActionLogTests: XCTestCase {
    func testSanitizedPathDropsQuery() {
        let url = URL(string: "http://127.0.0.1:8081/api/v1/users/me?token=secret")
        XCTAssertEqual(ClientActionLog.sanitizedPath(from: url), "/api/v1/users/me")
    }

    func testOutcomeBuckets() {
        XCTAssertEqual(ClientActionLog.outcome(status: 200, error: nil), "ok")
        XCTAssertEqual(ClientActionLog.outcome(status: 401, error: nil), "unauthorized")
        XCTAssertEqual(ClientActionLog.outcome(status: 0, error: nil), "unreachable")
    }

    func testMintRequestIDIsSixteenHexChars() {
        let id = ClientActionLog.mintRequestID()
        XCTAssertEqual(id.count, 16)
        XCTAssertTrue(id.allSatisfy { $0.isHexDigit })
    }

    func testStampDoesNotOverwriteExistingRequestID() {
        var request = URLRequest(url: URL(string: "http://127.0.0.1:8081/api/v1/health")!)
        request.setValue("abc123abc123abcd", forHTTPHeaderField: ClientActionLog.requestIDHeader)
        ClientActionLog.stamp(&request)
        XCTAssertEqual(request.value(forHTTPHeaderField: ClientActionLog.requestIDHeader), "abc123abc123abcd")
    }

    func testSanitizeLabelStripsLongDigitRuns() {
        XCTAssertEqual(ClientActionLog.sanitizeLabel("card 4242424242424242"), "card [digits]")
    }

    func testRecordUIDoesNotUseHTTPOutcome() {
        // Direct record with kind ui.
        ClientActionLog.shared.recordUI(method: "TAP", path: "Sign in")
        XCTAssertEqual(ClientActionLog.outcome(status: 1, error: nil, kind: "ui"), "ui")
    }

    func testStampAddsRequestIDWhenMissing() {
        var request = URLRequest(url: URL(string: "http://127.0.0.1:8081/api/v1/health")!)
        ClientActionLog.stamp(&request)
        let id = request.value(forHTTPHeaderField: ClientActionLog.requestIDHeader) ?? ""
        XCTAssertEqual(id.count, 16)
    }

    func testDebugSummaryFormatsLastEightHttpHops() {
        let mixed: [ClientActionEvent] = (0..<10).map { i in
            ClientActionEvent(
                id: UUID(),
                at: Date(),
                kind: i == 0 ? "ui" : "http",
                method: "GET",
                path: "/api/v1/x\(i)",
                status: 200,
                durationMs: 1,
                requestID: "rid\(String(format: "%02d", i))",
                outcome: "ok"
            )
        }
        let summary = ClientActionLog.formatDebugSummary(mixed)
        XCTAssertFalse(summary.contains("ui"), "debugSummary is HTTP hops only")
        XCTAssertTrue(summary.contains("GET /api/v1/x1 200 rid01"))
        XCTAssertTrue(summary.contains("GET /api/v1/x8 200 rid08"))
        XCTAssertFalse(summary.contains("/api/v1/x9"), "capped at 8 HTTP hops")
        XCTAssertFalse(summary.contains("Authorization"))
        XCTAssertEqual(ClientActionLog.formatDebugSummary([]), "")
    }

    func testDebugSummaryReadsRecordedHttpEvent() {
        let log = ClientActionLog()
        let exp = expectation(description: "record landed on main")
        log.record(
            method: "GET",
            path: "/api/v1/users/me",
            status: 200,
            durationMs: 12,
            requestID: "abc123abc123abcd"
        )
        DispatchQueue.main.async { exp.fulfill() }
        wait(for: [exp], timeout: 1)
        let summary = log.debugSummary()
        XCTAssertTrue(summary.contains("GET /api/v1/users/me 200 abc123abc123abcd"))
    }
}
