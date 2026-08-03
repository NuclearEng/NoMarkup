import XCTest
#if canImport(UIKit)
import UIKit
#endif
@testable import NoMarkup

final class ImageUploaderTests: XCTestCase {
    func testPlatformLimits() {
        XCTAssertEqual(ImageUploader.maxFileBytes, 10 * 1024 * 1024)
        XCTAssertEqual(ImageUploader.maxPhotosPerForm, 10)
        XCTAssertEqual(ImageUploader.maxPixelDimension, 2048)
    }

    func testSniffMimeJPEG() {
        var bytes: [UInt8] = [0xFF, 0xD8, 0xFF, 0xE0]
        bytes.append(contentsOf: [UInt8](repeating: 0, count: 12))
        XCTAssertEqual(ImageUploader.sniffMime(Data(bytes)), "image/jpeg")
    }

    func testSniffMimePNG() {
        var bytes: [UInt8] = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]
        bytes.append(contentsOf: [UInt8](repeating: 0, count: 8))
        XCTAssertEqual(ImageUploader.sniffMime(Data(bytes)), "image/png")
    }

    func testSniffMimeWEBP() {
        var bytes: [UInt8] = [
            0x52, 0x49, 0x46, 0x46,
            0x00, 0x00, 0x00, 0x00,
            0x57, 0x45, 0x42, 0x50,
        ]
        XCTAssertEqual(ImageUploader.sniffMime(Data(bytes)), "image/webp")
    }

    func testSniffMimePDF() {
        let bytes: [UInt8] = [0x25, 0x50, 0x44, 0x46, 0x2D, 0x31, 0x2E, 0x34] // %PDF-1.4
        XCTAssertEqual(ImageUploader.sniffMime(Data(bytes)), "application/pdf")
    }

    func testSniffMimeRejectsShortOrUnknown() {
        XCTAssertNil(ImageUploader.sniffMime(Data([0x00, 0x01])))
        let garbage = [UInt8](repeating: 0x11, count: 16)
        XCTAssertNil(ImageUploader.sniffMime(Data(garbage)))
    }

    func testNeedsDownsampleBoundary() {
        XCTAssertFalse(ImageUploader.needsDownsample(width: 1024, height: 768))
        XCTAssertFalse(ImageUploader.needsDownsample(width: 2048, height: 2048))
        XCTAssertTrue(ImageUploader.needsDownsample(width: 2049, height: 100))
        XCTAssertTrue(ImageUploader.needsDownsample(width: 100, height: 4000))
        XCTAssertFalse(ImageUploader.needsDownsample(width: 3000, height: 3000, maxEdge: 4096))
    }

    // MARK: - IOS-PERF.3 cache wiring

    func testConfigureCacheBoundsSharedURLCache() {
        ImageUploader.configureCache()
        XCTAssertEqual(URLCache.shared.memoryCapacity, 64 * 1024 * 1024)
        XCTAssertEqual(URLCache.shared.diskCapacity, 256 * 1024 * 1024)
    }

    #if canImport(UIKit)
    @MainActor
    func testMemoryWarningPurgeEmptiesSharedCache() {
        ImageUploader.configureCache()
        // Idempotent install: second call must not double-register or crash.
        ImageUploader.installMemoryWarningPurge()
        ImageUploader.installMemoryWarningPurge()

        // Seed one cached response so the purge has an observable effect.
        let url = URL(string: "https://example.com/imageuploader-cache-test")!
        let request = URLRequest(url: url)
        let response = URLResponse(
            url: url,
            mimeType: "text/plain",
            expectedContentLength: 4,
            textEncodingName: "utf-8"
        )
        URLCache.shared.storeCachedResponse(
            CachedURLResponse(response: response, data: Data("test".utf8)),
            for: request
        )

        NotificationCenter.default.post(
            name: UIApplication.didReceiveMemoryWarningNotification,
            object: nil
        )

        // `removeAllCachedResponses()` drains an internal CFURLCache queue
        // asynchronously — asserting on the very next statement is a measured
        // flake (fail/pass/fail on identical binaries). Poll with a bounded
        // deadline; the assertion below stays the real check.
        let deadline = Date().addingTimeInterval(2)
        while URLCache.shared.cachedResponse(for: request) != nil, Date() < deadline {
            RunLoop.current.run(until: Date().addingTimeInterval(0.05))
        }

        XCTAssertNil(URLCache.shared.cachedResponse(for: request))
    }
    #endif
}
