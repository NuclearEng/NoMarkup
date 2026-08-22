import CoreGraphics
import Foundation
import ImageIO
import SensitiveContentAnalysis
import SwiftUI

/// Hide-by-default overlay for incidental mature UGC (ASR-1.1.4 / 1.2.f / 1.2.1.d).
///
/// Uses on-device `SCSensitivityAnalyzer` (iOS 17+). When Communication Safety /
/// Sensitive Content Warning is off (`analysisPolicy == .disabled`), or analysis
/// throws, the photo is shown — do not brick catalog/chat. Scanning requires the
/// Sensitive Content Analysis entitlement on the signed App ID; without it the
/// policy stays disabled and this wrapper is a pass-through.
enum SensitiveMediaGate: Sendable {
    static let hidePrompt = "Sensitive media — tap to show"
    static let revealHint = "Reveals the photo"

    /// Hide when the analyzer flagged the image, or when the call site always
    /// requires tap-to-reveal (chat UGC — ASR-1.2.f without the SCA entitlement).
    static func hideByDefault(canScan: Bool, isSensitive: Bool, requireTapToReveal: Bool = false) -> Bool {
        if requireTapToReveal { return true }
        return canScan && isSensitive
    }
}

/// Drop-in `AsyncImage` replacement for **remote UGC** (chat, work evidence).
/// Own-camera / own-profile previews should keep `AsyncImage`.
struct ModeratedAsyncImage<Content: View>: View {
    let url: URL?
    /// When true, the photo is always covered until tap (chat). When false, hide
    /// only if on-device Sensitive Content Analysis flags the image.
    var requireTapToReveal: Bool = false
    @ViewBuilder var content: (AsyncImagePhase) -> Content

    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency

    @State private var isSensitive = false
    @State private var didFinishScan = false
    @State private var isRevealed = false

    var body: some View {
        let canScan = SCSensitivityAnalyzer().analysisPolicy != .disabled
        let holdPixels = !requireTapToReveal && canScan && !didFinishScan && !isRevealed
        let hide = SensitiveMediaGate.hideByDefault(
            canScan: canScan,
            isSensitive: isSensitive,
            requireTapToReveal: requireTapToReveal
        ) && !isRevealed

        AsyncImage(url: url) { phase in
            switch phase {
            case .success(_) where holdPixels:
                content(.empty)
            case .success(let image) where hide:
                sensitiveCover(image)
            default:
                content(phase)
            }
        }
        .task(id: url?.absoluteString) {
            await classify(url)
        }
    }

    @ViewBuilder
    private func sensitiveCover(_ image: Image) -> some View {
        Button {
            isRevealed = true
        } label: {
            ZStack {
                content(.success(image))
                    .blur(radius: 28)
                    .overlay {
                        BrandTheme.navyInk.opacity(reduceTransparency ? 0.88 : 0.58)
                    }
                    .clipped()

                VStack(spacing: 8) {
                    Image(systemName: "eye.slash.fill")
                        .font(.title2)
                        .symbolRenderingMode(.hierarchical)
                        .foregroundStyle(BrandTheme.textPrimary)
                    Text(SensitiveMediaGate.hidePrompt)
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(BrandTheme.textPrimary)
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 10)
                .background(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .fill(BrandTheme.navyInk.opacity(reduceTransparency ? 0.92 : 0.78))
                )
            }
            .frame(minWidth: 44, minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(SensitiveMediaGate.hidePrompt)
        .accessibilityHint(SensitiveMediaGate.revealHint)
        .accessibilityAddTraits(.isButton)
    }

    @MainActor
    private func classify(_ url: URL?) async {
        isRevealed = false
        isSensitive = false
        didFinishScan = false

        guard let url else {
            didFinishScan = true
            return
        }

        let analyzer = SCSensitivityAnalyzer()
        guard analyzer.analysisPolicy != .disabled else {
            didFinishScan = true
            return
        }

        if let cached = await SensitiveMediaScanCache.shared.sensitive(for: url) {
            isSensitive = cached
            didFinishScan = true
            return
        }

        do {
            guard let cgImage = await Self.cgImage(from: url) else {
                didFinishScan = true
                return
            }
            try Task.checkCancellation()
            let sensitive = try await Self.isSensitive(cgImage, analyzer: analyzer)
            try Task.checkCancellation()
            await SensitiveMediaScanCache.shared.store(url, sensitive: sensitive)
            isSensitive = sensitive
            didFinishScan = true
        } catch is CancellationError {
            return
        } catch {
            // Fail open: listing/chat photos still render if the analyzer errors.
            isSensitive = false
            didFinishScan = true
        }
    }

    /// `analyzeImage(at:)` is local-file only on iOS 17 — decode then `analyzeImage(_:)`.
    nonisolated private static func isSensitive(
        _ image: CGImage,
        analyzer: SCSensitivityAnalyzer
    ) async throws -> Bool {
        try await withCheckedThrowingContinuation { continuation in
            analyzer.analyzeImage(image) { result, error in
                if let error {
                    continuation.resume(throwing: error)
                } else {
                    continuation.resume(returning: result?.isSensitive == true)
                }
            }
        }
    }

    nonisolated private static func cgImage(from url: URL) async -> CGImage? {
        do {
            let (data, _) = try await URLSession.shared.data(from: url)
            return await Task.detached(priority: .utility) {
                guard let source = CGImageSourceCreateWithData(data as CFData, [
                    kCGImageSourceShouldCache: false,
                ] as CFDictionary) else { return nil }
                return CGImageSourceCreateImageAtIndex(source, 0, [
                    kCGImageSourceShouldCache: false,
                ] as CFDictionary)
            }.value
        } catch {
            return nil
        }
    }
}

/// Bounded in-memory scan results so chat scroll does not re-analyze the same URL.
actor SensitiveMediaScanCache {
    static let shared = SensitiveMediaScanCache()

    private var sensitiveByURL: [URL: Bool] = [:]
    private var insertionOrder: [URL] = []
    private let limit = 256

    func sensitive(for url: URL) -> Bool? {
        sensitiveByURL[url]
    }

    func store(_ url: URL, sensitive: Bool) {
        if sensitiveByURL[url] == nil {
            insertionOrder.append(url)
            if insertionOrder.count > limit {
                let stale = insertionOrder.removeFirst()
                sensitiveByURL.removeValue(forKey: stale)
            }
        }
        sensitiveByURL[url] = sensitive
    }
}
