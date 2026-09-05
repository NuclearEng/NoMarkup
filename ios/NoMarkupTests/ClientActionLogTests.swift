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

    func testParseMeActivityPayloadEventsEnvelope() {
        let json = Data(#"""
        {"events":[{"request_id":"rid-1","method":"get","path":"/api/v1/users/me?token=secret","status":200,"duration_ms":12,"created_at":"2026-08-22T00:00:00Z"}]}
        """#.utf8)
        let rows = ClientActionLog.parseMeActivityPayload(json)
        XCTAssertEqual(rows.count, 1)
        XCTAssertEqual(rows.first?.requestId, "rid-1")
        XCTAssertEqual(rows.first?.method, "GET")
        XCTAssertEqual(rows.first?.path, "/api/v1/users/me")
        XCTAssertEqual(rows.first?.status, 200)
        XCTAssertEqual(rows.first?.durationMs, 12)
        XCTAssertFalse(rows.first?.path.contains("?") ?? true)
        XCTAssertFalse(rows.contains { $0.path.contains("token=") })
    }

    func testParseMeActivityPayloadBareArrayAndCamelCase() {
        let json = Data(#"""
        [{"requestId":"rid-2","method":"POST","path":"/api/v1/jobs#frag","status":201,"durationMs":4,"at":"2026-08-22T01:00:00Z"}]
        """#.utf8)
        let rows = ClientActionLog.parseMeActivityPayload(json)
        XCTAssertEqual(rows.count, 1)
        XCTAssertEqual(rows.first?.requestId, "rid-2")
        XCTAssertEqual(rows.first?.path, "/api/v1/jobs")
        XCTAssertEqual(rows.first?.durationMs, 4)
        XCTAssertEqual(rows.first?.createdAt, "2026-08-22T01:00:00Z")
    }

    func testParseMeActivityPayloadUnknownShapeIsEmpty() {
        XCTAssertEqual(ClientActionLog.parseMeActivityPayload(Data("{}".utf8)), [])
        XCTAssertEqual(ClientActionLog.parseMeActivityPayload(Data("null".utf8)), [])
        XCTAssertEqual(ClientActionLog.parseMeActivityPayload(Data("not-json".utf8)), [])
    }

    func testMergeActivityDedupesOnRequestIDAndKeepsLocalUI() {
        let localHTTP = ClientActionEvent(
            id: UUID(),
            at: Date(timeIntervalSince1970: 2_000),
            kind: "http",
            method: "GET",
            path: "/api/v1/users/me",
            status: 0,
            durationMs: 0,
            requestID: "rid-shared",
            outcome: "unreachable"
        )
        let localUI = ClientActionEvent(
            id: UUID(),
            at: Date(timeIntervalSince1970: 3_000),
            kind: "ui",
            method: "TAP",
            path: "account.row.requestLog",
            status: 1,
            durationMs: 0,
            requestID: "",
            outcome: "ui"
        )
        let server = [
            ClientActionLog.MeActivityItem(
                requestId: "rid-shared",
                method: "GET",
                path: "/api/v1/users/me",
                status: 200,
                durationMs: 18,
                createdAt: "2026-08-22T00:00:00Z"
            ),
            ClientActionLog.MeActivityItem(
                requestId: "rid-server-only",
                method: "GET",
                path: "/api/v1/payments/methods",
                status: 200,
                durationMs: 9,
                createdAt: "2026-08-22T00:01:00Z"
            ),
        ]
        let merged = ClientActionLog.mergeActivity(local: [localHTTP, localUI], server: server)
        XCTAssertEqual(merged.count, 3)
        let shared = merged.first { $0.requestID == "rid-shared" }
        XCTAssertEqual(shared?.source, "both")
        XCTAssertEqual(shared?.status, 200)
        XCTAssertEqual(shared?.durationMs, 18)
        XCTAssertEqual(merged.first { $0.requestID == "rid-server-only" }?.source, "server")
        XCTAssertEqual(merged.first { $0.kind == "ui" }?.source, "local")
        XCTAssertFalse(merged.contains { $0.path.contains("Authorization") })
        XCTAssertFalse(merged.contains { $0.path.contains("?") })
    }
}
