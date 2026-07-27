import Foundation
import PhotosUI
import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

/// PhotosPicker → gateway image pipeline helper.
///
/// 1. Load image data from `PhotosPickerItem`
/// 2. `POST /api/v1/images/upload-url`
/// 3. PUT bytes to presigned URL
/// 4. `POST /api/v1/images/confirm` → public CDN URL for `photo_urls`
@MainActor
enum ImageUploader {
    /// Max bytes accepted by the platform (10 MB — `MAX_FILE_SIZE_BYTES`).
    static let maxFileBytes = 10 * 1024 * 1024

    /// Max photos per job/listing form (product limit).
    static let maxPhotosPerForm = 10

    /// JPEG compression quality for picked photos (balance size vs fidelity).
    private static let jpegQuality: CGFloat = 0.85

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
        onProgress: ((Int, Int) -> Void)? = nil
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

    /// Provider verification document: prepare JPEG/PNG/WebP (≤10 MB) → imaging
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

    // MARK: - Prepare

    private struct PreparedImage: Sendable {
        let data: Data
        let filename: String
        let mimeType: String
    }

    private static func prepareJPEG(from item: PhotosPickerItem) async throws -> PreparedImage {
        #if canImport(UIKit)
        if let data = try await item.loadTransferable(type: Data.self) {
            if let image = UIImage(data: data) {
                return try jpegFromUIImage(image)
            }
            // Already encoded image bytes — validate size/type loosely.
            if data.count > maxFileBytes {
                throw APIClientError.httpStatus(400, detail: "Image must be 10 MB or smaller.")
            }
            let mime = sniffMime(data) ?? "image/jpeg"
            let ext = mime == "image/png" ? "png" : (mime == "image/webp" ? "webp" : "jpg")
            return PreparedImage(
                data: data,
                filename: "photo-\(UUID().uuidString.prefix(8)).\(ext)",
                mimeType: mime
            )
        }
        throw APIClientError.httpStatus(400, detail: "Could not read the selected photo.")
        #else
        throw APIClientError.httpStatus(400, detail: "Photo upload requires UIKit.")
        #endif
    }

    #if canImport(UIKit)
    private static func jpegFromUIImage(_ image: UIImage) throws -> PreparedImage {
        guard let data = image.jpegData(compressionQuality: jpegQuality) else {
            throw APIClientError.httpStatus(400, detail: "Could not encode photo as JPEG.")
        }
        guard data.count <= maxFileBytes else {
            // Retry once at lower quality.
            if let smaller = image.jpegData(compressionQuality: 0.6), smaller.count <= maxFileBytes {
                return PreparedImage(
                    data: smaller,
                    filename: "photo-\(UUID().uuidString.prefix(8)).jpg",
                    mimeType: "image/jpeg"
                )
            }
            throw APIClientError.httpStatus(400, detail: "Image must be 10 MB or smaller.")
        }
        return PreparedImage(
            data: data,
            filename: "photo-\(UUID().uuidString.prefix(8)).jpg",
            mimeType: "image/jpeg"
        )
    }

    private static func sniffMime(_ data: Data) -> String? {
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
    #endif
}

// MARK: - Photo pick section (shared UI for Post Job / Create Listing)

/// Optional multi-photo picker that uploads on demand and exposes public URLs.
struct PhotoPickSection: View {
    let context: ImageUploadContext
    let maxCount: Int
    @Binding var photoURLs: [String]
    @Binding var isUploading: Bool
    @Binding var errorMessage: String?

    @State private var pickerItems: [PhotosPickerItem] = []

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
                        photosEmpty ? "Add photos" : "Add more photos",
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
        } header: {
            Text("Photos").brandSectionHeader()
        } footer: {
            Text("Optional. JPEG/PNG/WebP up to 10 MB each. Photos upload before submit.")
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
                .overlay(
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .strokeBorder(BrandTheme.hairline, lineWidth: 1)
                )
            }

            Button {
                remove(at: index)
            } label: {
                Image(systemName: "xmark.circle.fill")
                    .symbolRenderingMode(.palette)
                    .foregroundStyle(BrandTheme.textPrimary, BrandTheme.navy.opacity(0.75))
                    .font(.system(size: 20))
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
}
