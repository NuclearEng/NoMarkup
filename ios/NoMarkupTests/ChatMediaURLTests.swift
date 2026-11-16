import XCTest
@testable import NoMarkup

final class ChatMediaURLTests: XCTestCase {
    func testAllowsLocalMinIOAndFixtures() {
        XCTAssertNotNil(ChatMessage.safeHTTPURL(from: "http://localhost:9000/nomarkup-dev/chat/obj.jpg"))
        XCTAssertNotNil(ChatMessage.safeHTTPURL(from: "http://127.0.0.1:9000/nomarkup-dev/chat/obj.jpg"))
        XCTAssertNotNil(ChatMessage.safeHTTPURL(from: "https://picsum.photos/id/1015/800/600"))
        XCTAssertNotNil(ChatMessage.safeHTTPURL(from: "https://images.unsplash.com/photo-1473968512647-3e447244af8f?w=800"))
    }

    func testRejectsEvilHTTPSAndSchemes() {
        XCTAssertNil(ChatMessage.safeHTTPURL(from: "https://evil.example.com/tracker.png"))
        XCTAssertNil(ChatMessage.safeHTTPURL(from: "https://images.unsplash.com.evil.test/p.jpg"))
        XCTAssertNil(ChatMessage.safeHTTPURL(from: "javascript:alert(1)"))
        XCTAssertNil(ChatMessage.safeHTTPURL(from: "data:image/png;base64,abcd"))
        XCTAssertNil(ChatMessage.safeHTTPURL(from: "/nomarkup-dev/chat/obj.jpg"))
        XCTAssertNil(ChatMessage.safeHTTPURL(from: "http://localhost:9000/nomarkup-dev"))
    }

    func testImageAndFileRequireAllowlistedHost() {
        let evilImage = ChatMessage(
            id: "i1",
            channelId: "c1",
            senderId: "u1",
            messageType: "image",
            content: "https://evil.example.com/tracker.png",
            isRead: false,
            createdAt: "2026-04-01T11:00:00Z"
        )
        XCTAssertNil(evilImage.safeImageURL)

        let okImage = ChatMessage(
            id: "i2",
            channelId: "c1",
            senderId: "u1",
            messageType: "image",
            content: "http://localhost:9000/nomarkup-dev/chat/obj.jpg",
            isRead: false,
            createdAt: "2026-04-01T11:00:00Z"
        )
        XCTAssertEqual(
            okImage.safeImageURL?.absoluteString,
            "http://localhost:9000/nomarkup-dev/chat/obj.jpg"
        )

        let evilFile = ChatMessage(
            id: "f1",
            channelId: "c1",
            senderId: "u1",
            messageType: "file",
            content: "https://evil.example.com/malware.pdf",
            isRead: false,
            createdAt: "2026-04-01T11:00:00Z"
        )
        XCTAssertNil(evilFile.safeFileURL)
    }
}
