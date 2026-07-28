import CoreGraphics
import Foundation
import ImageIO
import PhotosUI
import SwiftUI
import UniformTypeIdentifiers
#if canImport(UIKit)
import UIKit
#endif

/// PhotosPicker → gateway image pipeline helper.
///
/// 1. Load image data from `PhotosPickerItem` (or camera `UIImage`)
/// 2. **Off MainActor:** ImageIO downsample (≤2048px) + orientation-aware JPEG encode
/// 3. `POST /api/v1/images/upload-url`
/// 4. PUT bytes to presigned URL
/// 5. `POST /api/v1/images/confirm` → public CDN URL for `photo_urls`
///
/// Heavy decode/encode work is **not** MainActor-isolated (IOS-PERF.6 / PERF.3).
/// SwiftUI call sites stay on MainActor; camera `UIImage` → JPEG source bytes are
/// produced inside the same detached hop as the downsample (no main-thread drawing).
enum ImageUploader: Sendable {
    /// Max bytes accepted by the platform (10 MB — `MAX_FILE_SIZE_BYTES`).
    static let maxFileBytes = 10 * 1024 * 1024

    /// Max photos per job/listing form (product limit).
    static let maxPhotosPerForm = 10

    /// Longest edge for ImageIO thumbnail downsample (px). Public for tests / diagnostics.
    static let maxPixelDimension = 2048

    /// Preferred JPEG quality, then fallbacks if over `maxFileBytes`.
    private static let jpegQualities: [CGFloat] = [0.85, 0.6, 0.4]

    /// Whether a pixel size exceeds the downsample budget (longest edge).
    nonisolated static func needsDownsample(
        width: Int,
        height: Int,
        maxEdge: Int = maxPixelDimension
    ) -> Bool {
        max(width, height) > maxEdge
    }

    /// Best-effort magic-byte MIME sniff (used by tests; encode path always re-encodes JPEG).
    nonisolated static func sniffMime(_ data: Data) -> String? {
        guard data.count >= 12 else { return nil }
        let bytes = [UInt8](data.prefix(12))
        // JPEG
        if bytes[0] == 0xFF, bytes[1] == 0xD8, bytes[2] == 0xFF { return "image/jpeg" }
        // PNG
        if bytes[0] == 0x89, bytes[1] == 0x50, bytes[2] == 0x4E, bytes[3] == 0x47 {
            return "image/png"
        }
        // WEBP: RIFF....WEBP
        if bytes[0] == 0x52, bytes[1] == 0x49, bytes[2] == 0x46, bytes[3] == 0x46,
           bytes[8] == 0x57, bytes[9] == 0x45, bytes[10] == 0x42, bytes[11] == 0x50
        {
            return "image/webp"
        }
        return nil
    }

    // MARK: - Cache (IOS-PERF.3)

    /// Configure a bounded `URLCache.shared` once (AsyncImage / default URL loading).
    /// Safe to call from app launch; idempotent enough for re-entry (replaces shared).
    nonisolated static func configureCache() {
        let memoryCapacity = 64 * 1024 * 1024 // 64 MB
        let diskCapacity = 256 * 1024 * 1024 // 256 MB
        URLCache.shared = URLCache(
            memoryCapacity: memoryCapacity,
            diskCapacity: diskCapacity,
            directory: nil
        )
    }

    #if canImport(UIKit)
    /// Observer token for the memory-warning purge; lives for the process lifetime.
    @MainActor private static var memoryWarningObserver: NSObjectProtocol?

    /// Purge `URLCache.shared` on system memory pressure (IOS-PERF.3).
    /// Call once from app init after `configureCache()`; re-entry is a no-op.
    @MainActor
    static func installMemoryWarningPurge() {
        guard memoryWarningObserver == nil else { return }
        memoryWarningObserver = NotificationCenter.default.addObserver(
            forName: UIApplication.didReceiveMemoryWarningNotification,
            object: nil,
            queue: nil
        ) { _ in
            URLCache.shared.removeAllCachedResponses()
        }
    }
    #endif

    // MARK: - Public upload API

    /// Upload one PhotosPicker item; returns the public `confirmed_url`.
    static func upload(
        item: PhotosPickerItem,
        context: ImageUploadContext
    ) async throws -> String {
        let prepared = try await prepareJPEG(from: item)
        return try await APIClient.shared.uploadImage(
            data: prepared.data,
            filename: prepared.filename,
            mimeType: prepared.mimeType,
            context: context
        )
    }

    /// Upload many items in order; stops on first failure and surfaces progress via callback.
    static func uploadAll(
        items: [PhotosPickerItem],
        context: ImageUploadContext,
        onProgress: (@Sendable (Int, Int) -> Void)? = nil
    ) async throws -> [String] {
        let capped = Array(items.prefix(maxPhotosPerForm))
        var urls: [String] = []
        urls.reserveCapacity(capped.count)
        for (index, item) in capped.enumerated() {
            onProgress?(index + 1, capped.count)
            let url = try await upload(item: item, context: context)
            urls.append(url)
        }
        return urls
    }

    /// Provider verification document: prepare JPEG (≤10 MB) → imaging
    /// `document` context → `POST /api/v1/providers/me/documents`.
    static func uploadVerificationDocument(
        item: PhotosPickerItem,
        documentType: ProviderDocumentType
    ) async throws -> ProviderDocumentUploadResult {
        let prepared = try await prepareJPEG(from: item)
        return try await APIClient.shared.uploadAndSubmitProviderDocument(
            data: prepared.data,
            filename: prepared.filename,
            mimeType: prepared.mimeType,
            documentType: documentType.rawValue
        )
    }

    #if canImport(UIKit)
    /// Upload a camera-captured UIImage through the same JPEG + imaging pipeline.
    /// Call from MainActor (SwiftUI); all encode work runs off-main (IOS-PERF.6).
    @MainActor
    static func upload(
        uiImage: UIImage,
        context: ImageUploadContext
    ) async throws -> String {
        let prepared = try await prepareJPEG(from: uiImage)
        return try await APIClient.shared.uploadImage(
            data: prepared.data,
            filename: prepared.filename,
            mimeType: prepared.mimeType,
            context: context
        )
    }

    /// Provider verification document from camera capture.
    @MainActor
    static func uploadVerificationDocument(
        uiImage: UIImage,
        documentType: ProviderDocumentType
    ) async throws -> ProviderDocumentUploadResult {
        let prepared = try await prepareJPEG(from: uiImage)
        return try await APIClient.shared.uploadAndSubmitProviderDocument(
            data: prepared.data,
            filename: prepared.filename,
            mimeType: prepared.mimeType,
            documentType: documentType.rawValue
        )
    }
    #endif

    // MARK: - Prepare (background)

    private struct PreparedImage: Sendable {
        let data: Data
        let filename: String
        let mimeType: String
    }

    private static func prepareJPEG(from item: PhotosPickerItem) async throws -> PreparedImage {
        guard let data = try await item.loadTransferable(type: Data.self) else {
            throw APIClientError.httpStatus(400, detail: "Could not read the selected photo.")
        }
        return try await prepareJPEG(from: data)
    }

    /// Downsample + JPEG encode off the main actor (ImageIO).
    private static func prepareJPEG(from data: Data) async throws -> PreparedImage {
        // Capture constants for the detached task (Sendable).
        let maxBytes = maxFileBytes
        let maxEdge = maxPixelDimension
        let qualities = jpegQualities
        return try await Task.detached(priority: .userInitiated) {
            try encodeJPEGDownsampled(
                from: data,
                maxPixelSize: maxEdge,
                qualities: qualities,
                maxFileBytes: maxBytes
            )
        }.value
    }

    #if canImport(UIKit)
    /// Camera UIImage → JPEG source bytes + downsample entirely off the main actor.
    /// Orientation invariant (IOS-MED.5 / IOS-PERF.6): `jpegData` bakes `imageOrientation`
    /// into the EXIF tag, and `encodeJPEGDownsampled` applies it via
    /// `kCGImageSourceCreateThumbnailWithTransform`, so the uploaded pixels are upright
    /// (no orientation-flag dependence) without any main-thread renderer redraw.
    private static func prepareJPEG(from image: UIImage) async throws -> PreparedImage {
        let maxBytes = maxFileBytes
        let maxEdge = maxPixelDimension
        let qualities = jpegQualities
        return try await Task.detached(priority: .userInitiated) {
            guard let source = image.jpegData(compressionQuality: 1.0) else {
                throw APIClientError.httpStatus(400, detail: "Could not read the captured photo.")
            }
            return try encodeJPEGDownsampled(
                from: source,
                maxPixelSize: maxEdge,
                qualities: qualities,
                maxFileBytes: maxBytes
            )
        }.value
    }
    #endif

    /// ImageIO thumbnail (max edge) with EXIF orientation applied, then JPEG encode.
    nonisolated private static func encodeJPEGDownsampled(
        from data: Data,
        maxPixelSize: Int,
        qualities: [CGFloat],
        maxFileBytes: Int
    ) throws -> PreparedImage {
        guard !data.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "Could not read the selected photo.")
        }

        guard let source = CGImageSourceCreateWithData(data as CFData, [
            kCGImageSourceShouldCache: false,
        ] as CFDictionary) else {
            throw APIClientError.httpStatus(400, detail: "Could not decode the selected photo.")
        }

        let thumbOptions: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: maxPixelSize,
            kCGImageSourceShouldCacheImmediately: true,
        ]

        guard let cgImage = CGImageSourceCreateThumbnailAtIndex(
            source,
            0,
            thumbOptions as CFDictionary
        ) else {
            throw APIClientError.httpStatus(400, detail: "Could not process the selected photo.")
        }

        for quality in qualities {
            if let jpeg = jpegData(from: cgImage, quality: quality),
               jpeg.count <= maxFileBytes
            {
                return PreparedImage(
                    data: jpeg,
                    filename: "photo-\(UUID().uuidString.prefix(8)).jpg",
                    mimeType: "image/jpeg"
                )
            }
        }

        throw APIClientError.httpStatus(400, detail: "Image must be 10 MB or smaller.")
    }

    nonisolated private static func jpegData(from cgImage: CGImage, quality: CGFloat) -> Data? {
        let mutable = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(
            mutable,
            UTType.jpeg.identifier as CFString,
            1,
            nil
        ) else {
            return nil
        }
        let props: [CFString: Any] = [
            kCGImageDestinationLossyCompressionQuality: quality,
        ]
        CGImageDestinationAddImage(destination, cgImage, props as CFDictionary)
        guard CGImageDestinationFinalize(destination) else {
            return nil
        }
        return mutable as Data
    }
}

// MARK: - Photo pick section (shared UI for Post Job / Create Listing)

/// Optional multi-photo picker that uploads on demand and exposes public URLs.
/// UI stays `@MainActor` (SwiftUI View); upload encode hops off via `ImageUploader`.
struct PhotoPickSection: View {
    let context: ImageUploadContext
    let maxCount: Int
    @Binding var photoURLs: [String]
    @Binding var isUploading: Bool
    @Binding var errorMessage: String?

    @State private var pickerItems: [PhotosPickerItem] = []
    @State private var showCamera = false
    @State private var showCameraDeniedAlert = false
    #if canImport(UIKit)
    @State private var cameraImage: UIImage?
    #endif

    var body: some View {
        Section {
            if !photoURLs.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 10) {
                        ForEach(Array(photoURLs.enumerated()), id: \.offset) { index, urlString in
                            photoThumb(urlString: urlString, index: index)
                        }
                    }
                    .padding(.vertical, 4)
                }
                .listRowBackground(BrandTheme.navyElevated)
            }

            // Snapshot MainActor state for the PhotosPicker label — its content
            // builder is nonisolated under Swift 6 concurrency and cannot read
            // @Binding properties directly without isolation warnings.
            let photoCount = photoURLs.count
            let photosEmpty = photoCount == 0
            let uploading = isUploading
            let atCapacity = photoCount >= maxCount
            PhotosPicker(
                selection: $pickerItems,
                maxSelectionCount: max(0, maxCount - photoCount),
                matching: .images,
                photoLibrary: .shared()
            ) {
                HStack {
                    Label(
                        photosEmpty ? "Add from library" : "Add more from library",
                        systemImage: "photo.on.rectangle.angled"
                    )
                    Spacer()
                    if uploading {
                        ProgressView()
                            .tint(BrandTheme.accent)
                    } else {
                        Text("\(photoCount)/\(maxCount)")
                            .font(.caption.monospacedDigit())
                            .foregroundStyle(BrandTheme.textSecondary)
                    }
                }
                .frame(minHeight: 44)
            }
            .disabled(uploading || atCapacity)
            .listRowBackground(BrandTheme.navyElevated)
            .onChange(of: pickerItems) { _, newItems in
                guard !newItems.isEmpty else { return }
                Task { await uploadPicked(newItems) }
            }

            #if canImport(UIKit)
            Button {
                Task { await requestCamera() }
            } label: {
                Label("Take photo", systemImage: "camera.fill")
                    .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            }
            .disabled(uploading || atCapacity || !UIImagePickerController.isSourceTypeAvailable(.camera))
            .listRowBackground(BrandTheme.navyElevated)
            .accessibilityHint("Opens the camera to capture a photo for this job or listing")
            .sheet(isPresented: $showCamera) {
                CameraImagePicker(image: $cameraImage)
                    .ignoresSafeArea()
            }
            .cameraDeniedAlert(isPresented: $showCameraDeniedAlert)
            .onChange(of: cameraImage) { _, image in
                guard let image else { return }
                Task { await uploadCamera(image) }
            }
            #endif
        } header: {
            Text("Photos").brandSectionHeader()
        } footer: {
            Text("Optional. Library or camera. JPEG/PNG/WebP up to 10 MB each. Photos upload before submit.")
                .foregroundStyle(BrandTheme.textSecondary)
        }
    }

    @ViewBuilder
    private func photoThumb(urlString: String, index: Int) -> some View {
        ZStack(alignment: .topTrailing) {
            if let url = URL(string: urlString) {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let image):
                        image
                            .resizable()
                            .scaledToFill()
                    case .failure:
                        Image(systemName: "photo")
                            .foregroundStyle(BrandTheme.textSecondary)
                    default:
                        ProgressView()
                            .tint(BrandTheme.accent)
                    }
                }
                .frame(width: 72, height: 72)
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                .brandHairlineBorder(cornerRadius: 10)
            }

            Button {
                remove(at: index)
            } label: {
                Image(systemName: "xmark.circle.fill")
                    .symbolRenderingMode(.palette)
                    .foregroundStyle(BrandTheme.textPrimary, BrandTheme.navyInk.opacity(0.75))
                    .font(.title3)
                    // Expand hit target to HIG 44×44 without enlarging the glyph.
                    .frame(width: 44, height: 44)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .offset(x: 6, y: -6)
            .accessibilityLabel("Remove photo \(index + 1)")
        }
    }

    private func remove(at index: Int) {
        guard photoURLs.indices.contains(index) else { return }
        photoURLs.remove(at: index)
    }

    #if canImport(UIKit)
    @MainActor
    private func requestCamera() async {
        switch await CameraAuthorization.prepareToPresent() {
        case .ready:
            showCamera = true
        case .denied:
            showCameraDeniedAlert = true
        case .unavailable:
            errorMessage = "Camera is not available on this device. Choose a photo from your library instead."
        }
    }
    #endif

    @MainActor
    private func uploadPicked(_ items: [PhotosPickerItem]) async {
        errorMessage = nil
        isUploading = true
        defer {
            isUploading = false
            pickerItems = []
        }

        let room = max(0, maxCount - photoURLs.count)
        let batch = Array(items.prefix(room))
        guard !batch.isEmpty else { return }

        do {
            let urls = try await ImageUploader.uploadAll(items: batch, context: context)
            photoURLs.append(contentsOf: urls)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    #if canImport(UIKit)
    @MainActor
    private func uploadCamera(_ image: UIImage) async {
        errorMessage = nil
        isUploading = true
        defer {
            isUploading = false
            cameraImage = nil
        }
        guard photoURLs.count < maxCount else { return }
        do {
            let url = try await ImageUploader.upload(uiImage: image, context: context)
            photoURLs.append(url)
        } catch {
            errorMessage = error.localizedDescription
        }
    }
    #endif
}
