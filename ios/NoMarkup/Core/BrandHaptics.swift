import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

/// Institutional reward feedback — light, purposeful, never casino spam.
///
/// Maps to the brand north star: **Bloomberg desk density + Robinhood number thrills**.
/// Respects system haptics off (UIKit no-ops) and is a no-op on non-iOS.
///
/// All generators are UIKit MainActor APIs (iOS 26 isolation). Call from UI paths only.
@MainActor
enum BrandHaptics {
    /// Subtle tick — new bid on ladder, countdown urgency, ticker delta.
    static func light() {
        #if canImport(UIKit)
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        #endif
    }

    /// Decisive action — place bid, lower bid, submit order, promote confirm.
    static func medium() {
        #if canImport(UIKit)
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        #endif
    }

    /// Soft selection — toggle chips, segment changes.
    static func selection() {
        #if canImport(UIKit)
        UISelectionFeedbackGenerator().selectionChanged()
        #endif
    }

    /// Positive close — award, escrow funded, savings milestone, successful pay.
    static func success() {
        #if canImport(UIKit)
        UINotificationFeedbackGenerator().notificationOccurred(.success)
        #endif
    }

    /// Rejected path — bid too high/low, auction closed, payment required.
    static func error() {
        #if canImport(UIKit)
        UINotificationFeedbackGenerator().notificationOccurred(.error)
        #endif
    }

    /// Soft warning — approaching deadline, incomplete form.
    static func warning() {
        #if canImport(UIKit)
        UINotificationFeedbackGenerator().notificationOccurred(.warning)
        #endif
    }
}

// MARK: - Numeric money flash (Robinhood-style, restrained)

/// Brief green/red wash + numeric content transition when a monospaced price ticks.
struct BrandMoneyFlashModifier: ViewModifier {
    let flashToken: Int
    let isDown: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var washOpacity: Double = 0

    func body(content: Content) -> some View {
        content
            .background {
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill(
                        (isDown ? BrandTheme.successFill : BrandTheme.bidLeading)
                            .opacity(washOpacity)
                    )
            }
            .onChange(of: flashToken) { _, _ in
                guard !reduceMotion else { return }
                washOpacity = 0.22
                withAnimation(BrandTheme.animation(.easeOut(duration: 0.45), reduceMotion: reduceMotion)) {
                    washOpacity = 0
                }
            }
    }
}

extension View {
    /// Flash a price cell when `token` increments (e.g. new leading bid).
    /// `isDown: true` → green (reverse-auction win / savings); false → bid blue.
    func brandMoneyFlash(token: Int, isDown: Bool = true) -> some View {
        modifier(BrandMoneyFlashModifier(flashToken: token, isDown: isDown))
    }
}
