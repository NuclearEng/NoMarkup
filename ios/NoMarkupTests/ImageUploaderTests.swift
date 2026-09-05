import XCTest
import ImageIO
import UniformTypeIdentifiers
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

    // MARK: - IOS-PERF.6 security-scoped file read (off MainActor)

    func testReadSecurityScopedFileAcceptsPDFMagicBytes() throws {
        let url = try Self.writeTempFile(
            named: "ok.pdf",
            bytes: [0x25, 0x50, 0x44, 0x46, 0x2D, 0x31, 0x2E, 0x34] // %PDF-1.4
        )
        defer { try? FileManager.default.removeItem(at: url) }

        let data = try ImageUploader.readSecurityScopedFile(url: url)
        XCTAssertEqual(ImageUploader.sniffMime(data), "application/pdf")
        XCTAssertEqual([UInt8](data.prefix(4)), [0x25, 0x50, 0x44, 0x46])
    }

    func testReadSecurityScopedFileRejectsOversize() throws {
        let url = try Self.writeTempFile(
            named: "big.pdf",
            bytes: [UInt8](repeating: 0x25, count: 16)
        )
        defer { try? FileManager.default.removeItem(at: url) }

        XCTAssertThrowsError(
            try ImageUploader.readSecurityScopedFile(url: url, maxBytes: 8)
        ) { error in
            guard case APIClientError.httpStatus(let code, let detail) = error else {
                return XCTFail("expected APIClientError.httpStatus, got \(error)")
            }
            XCTAssertEqual(code, 400)
            XCTAssertTrue(detail.contains("10 MB"), "detail: \(detail)")
        }
    }

    func testReadSecurityScopedFileIsNotMainActor() throws {
        let url = try Self.writeTempFile(
            named: "actor.pdf",
            bytes: [0x25, 0x50, 0x44, 0x46]
        )
        defer { try? FileManager.default.removeItem(at: url) }

        // Compile-time: a nonisolated helper cannot call an `@MainActor` method.
        let data = try Self.readSecurityScopedFileOffMain(url: url)
        XCTAssertEqual([UInt8](data), [0x25, 0x50, 0x44, 0x46])
    }

    /// Proves `readSecurityScopedFile` is not `@MainActor` (IOS-PERF.6).
    nonisolated private static func readSecurityScopedFileOffMain(url: URL) throws -> Data {
        try ImageUploader.readSecurityScopedFile(url: url)
    }

    private static func writeTempFile(named name: String, bytes: [UInt8]) throws -> URL {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("ios-perf6-\(UUID().uuidString)-\(name)")
        try Data(bytes).write(to: url, options: .atomic)
        return url
    }

    func testImageUploadContextWireValues() {
        XCTAssertEqual(ImageUploadContext.avatar.apiValue, "avatar")
        XCTAssertEqual(ImageUploadContext.job.apiValue, "job_photo")
        XCTAssertEqual(ImageUploadContext.listing.apiValue, "listing")
        XCTAssertEqual(ImageUploadContext.document.apiValue, "document")
        XCTAssertEqual(ImageUploadContext.chatAttachment.apiValue, "chat_attachment")
        XCTAssertEqual(ImageUploadContext.reviewPhoto.apiValue, "review_photo")
    }

    func testNeedsDownsampleBoundary() {
        XCTAssertFalse(ImageUploader.needsDownsample(width: 1024, height: 768))
        XCTAssertFalse(ImageUploader.needsDownsample(width: 2048, height: 2048))
        XCTAssertTrue(ImageUploader.needsDownsample(width: 2049, height: 100))
        XCTAssertTrue(ImageUploader.needsDownsample(width: 100, height: 4000))
        XCTAssertFalse(ImageUploader.needsDownsample(width: 3000, height: 3000, maxEdge: 4096))
    }

    func testJpegDataDownsampledCapsLongestEdge() async throws {
        let width = 4000
        let height = 2500
        XCTAssertTrue(ImageUploader.needsDownsample(width: width, height: height))
        let sourceJPEG = try XCTUnwrap(Self.solidJPEG(width: width, height: height))
        let out = try await ImageUploader.jpegDataDownsampled(from: sourceJPEG)
        XCTAssertLessThanOrEqual(out.count, ImageUploader.maxFileBytes)
        XCTAssertGreaterThan(out.count, 0)

        let src = try XCTUnwrap(CGImageSourceCreateWithData(out as CFData, [
            kCGImageSourceShouldCache: false,
        ] as CFDictionary))
        let props = try XCTUnwrap(CGImageSourceCopyPropertiesAtIndex(src, 0, nil) as? [CFString: Any])
        let outW = try XCTUnwrap(props[kCGImagePropertyPixelWidth] as? Int)
        let outH = try XCTUnwrap(props[kCGImagePropertyPixelHeight] as? Int)
        XCTAssertLessThanOrEqual(max(outW, outH), ImageUploader.maxPixelDimension)
        XCTAssertGreaterThan(outW, 0)
        XCTAssertGreaterThan(outH, 0)
        // Aspect roughly preserved (4000:2500 = 1.6).
        let ratio = Double(outW) / Double(outH)
        XCTAssertEqual(ratio, 4000.0 / 2500.0, accuracy: 0.05)
    }

    private static func solidJPEG(width: Int, height: Int) -> Data? {
        let colorSpace = CGColorSpaceCreateDeviceRGB()
        let bytesPerPixel = 4
        var pixels = [UInt8](repeating: 180, count: width * height * bytesPerPixel)
        let image = pixels.withUnsafeMutableBytes { ptr -> CGImage? in
            guard let ctx = CGContext(
                data: ptr.baseAddress,
                width: width,
                height: height,
                bitsPerComponent: 8,
                bytesPerRow: width * bytesPerPixel,
                space: colorSpace,
                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
            ) else { return nil }
            return ctx.makeImage()
        }
        guard let image else { return nil }
        let mutable = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(
            mutable,
            UTType.jpeg.identifier as CFString,
            1,
            nil
        ) else { return nil }
        CGImageDestinationAddImage(destination, image, nil)
        guard CGImageDestinationFinalize(destination) else { return nil }
        return mutable as Data
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

    // MARK: - ASR-1.2.f sensitive media gate

    func testSensitiveMediaGateFailsOpenWhenCannotScan() {
        XCTAssertFalse(SensitiveMediaGate.hideByDefault(canScan: false, isSensitive: true))
        XCTAssertFalse(SensitiveMediaGate.hideByDefault(canScan: false, isSensitive: false))
    }

    func testSensitiveMediaGateHidesOnlyWhenAnalyzerFlags() {
        XCTAssertTrue(SensitiveMediaGate.hideByDefault(canScan: true, isSensitive: true))
        XCTAssertFalse(SensitiveMediaGate.hideByDefault(canScan: true, isSensitive: false))
    }

    func testSensitiveMediaGateChatAlwaysHidesUntilTap() {
        XCTAssertTrue(SensitiveMediaGate.hideByDefault(
            canScan: false, isSensitive: false, requireTapToReveal: true
        ))
        XCTAssertTrue(SensitiveMediaGate.hideByDefault(
            canScan: true, isSensitive: false, requireTapToReveal: true
        ))
    }

    func testSensitiveMediaGateCopyIsNotColorOnly() {
        XCTAssertEqual(SensitiveMediaGate.hidePrompt, "Sensitive media — tap to show")
        XCTAssertFalse(SensitiveMediaGate.hidePrompt.isEmpty)
        XCTAssertEqual(SensitiveMediaGate.revealHint, "Reveals the photo")
    }
}
