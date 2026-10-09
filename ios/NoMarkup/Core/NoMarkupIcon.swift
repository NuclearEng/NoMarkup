import SwiftUI

/// In-app brand mark — the same champagne-metal monogram as the SpringBoard App Icon.
///
/// Uses the `BrandAppIcon` raster (copied from `AppIcon-1024.png` / `brand/app-icon-champagne-m.png`)
/// so the home tile, login header, and homescreen icon stay pixel-aligned.
struct NoMarkupIcon: View {
    /// When true, reserves room under the icon for a separate wordmark (raster already
    /// includes “NoMarkup” at large sizes — usually leave false for tile use).
    var showWordmark: Bool = false
    var size: CGFloat = 120

    private var corner: CGFloat { size * 0.2237 } // ~Apple continuous corner ratio

    var body: some View {
        Image("BrandAppIcon")
            .resizable()
            .interpolation(.high)
            .scaledToFit()
            .frame(width: size, height: size)
            .clipShape(RoundedRectangle(cornerRadius: corner, style: .continuous))
            // Soft lift so the tile sits like an iOS icon on navy chrome.
            .shadow(color: .black.opacity(0.45), radius: size * 0.08, y: size * 0.05)
            .accessibilityLabel("NoMarkup")
            .accessibilityAddTraits(.isImage)
    }
}

#Preview("Icon tile") {
    ZStack {
        Color(red: 0.027, green: 0.031, blue: 0.043).ignoresSafeArea()
        VStack(spacing: 24) {
            NoMarkupIcon(size: 72)
            NoMarkupIcon(size: 120)
            NoMarkupIcon(size: 160)
        }
    }
}
