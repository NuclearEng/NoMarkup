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
}
