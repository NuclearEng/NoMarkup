import SwiftUI

/// In-app champagne-metal monogram matching the SpringBoard App Icon master.
/// Master raster: `brand/app-icon-champagne-m.png` / AppIcon-1024 (crystal M↓ + NoMarkup).
struct NoMarkupIcon: View {
    /// Show "NoMarkup" caption (marketing / large only; App Store PNG includes it).
    var showWordmark: Bool = true
    var size: CGFloat = 120

    private var corner: CGFloat { size * 0.22 }

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: corner, style: .continuous)
                .fill(
                    AngularGradient(
                        colors: [
                            Color(red: 0.95, green: 0.85, blue: 0.55),
                            Color(red: 0.82, green: 0.70, blue: 0.40),
                            Color(red: 0.98, green: 0.92, blue: 0.70),
                            Color(red: 0.75, green: 0.62, blue: 0.32),
                            Color(red: 0.95, green: 0.85, blue: 0.55),
                        ],
                        center: .center
                    )
                )

            RoundedRectangle(cornerRadius: corner, style: .continuous)
                .fill(
                    RadialGradient(
                        colors: [
                            Color.white.opacity(0.35),
                            Color.clear,
                            Color.black.opacity(0.22),
                        ],
                        center: .center,
                        startRadius: size * 0.05,
                        endRadius: size * 0.55
                    )
                )
                .blendMode(.overlay)

            RoundedRectangle(cornerRadius: corner, style: .continuous)
                .fill(
                    RadialGradient(
                        colors: [
                            Color(red: 1.0, green: 0.95, blue: 0.72).opacity(0.5),
                            .clear,
                        ],
                        center: .center,
                        startRadius: size * 0.08,
                        endRadius: size * 0.55
                    )
                )
                .blendMode(.screen)

            RoundedRectangle(cornerRadius: corner * 0.92, style: .continuous)
                .strokeBorder(
                    LinearGradient(
                        colors: [
                            Color.white.opacity(0.75),
                            Color(red: 0.85, green: 0.72, blue: 0.42),
                            Color.black.opacity(0.25),
                        ],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    ),
                    lineWidth: size * 0.018
                )
                .padding(size * 0.055)

            RoundedRectangle(cornerRadius: corner * 0.78, style: .continuous)
                .strokeBorder(
                    Color(red: 0.98, green: 0.92, blue: 0.7).opacity(0.55),
                    lineWidth: size * 0.01
                )
                .padding(size * 0.11)

            VStack(spacing: size * -0.02) {
                ZStack {
                    Text("M")
                        .font(.system(size: size * 0.48, weight: .black, design: .rounded))
                        .foregroundStyle(
                            AngularGradient(
                                colors: [
                                    Color(red: 0.0, green: 0.95, blue: 1.0).opacity(0.9),
                                    Color(red: 1.0, green: 0.0, blue: 0.85).opacity(0.85),
                                    Color(red: 1.0, green: 0.92, blue: 0.2).opacity(0.9),
                                    Color(red: 0.0, green: 0.95, blue: 1.0).opacity(0.9),
                                ],
                                center: .center
                            )
                        )
                        .blur(radius: 1.1)
                        .opacity(0.65)

                    Text("M")
                        .font(.system(size: size * 0.48, weight: .black, design: .rounded))
                        .foregroundStyle(
                            LinearGradient(
                                colors: [
                                    .white,
                                    Color(red: 0.96, green: 0.92, blue: 0.82),
                                    .white,
                                ],
                                startPoint: .top,
                                endPoint: .bottom
                            )
                        )
                        .shadow(color: .black.opacity(0.45), radius: 2, y: 1.5)
                }

                Image(systemName: "arrow.down")
                    .font(.system(size: size * 0.18, weight: .black))
                    .foregroundStyle(
                        LinearGradient(
                            colors: [.white, Color(red: 0.95, green: 0.9, blue: 0.78)],
                            startPoint: .top,
                            endPoint: .bottom
                        )
                    )
                    .shadow(color: .black.opacity(0.35), radius: 1, y: 1)
                    .offset(y: size * -0.02)
            }
            .offset(y: showWordmark ? size * -0.06 : 0)

            if showWordmark {
                Text("NoMarkup")
                    .font(.system(size: size * 0.1, weight: .semibold, design: .rounded))
                    .tracking(size * 0.004)
                    .foregroundStyle(.white.opacity(0.95))
                    .shadow(color: .black.opacity(0.35), radius: 1, y: 0.5)
                    .offset(y: size * 0.34)
            }

            Circle()
                .fill(.white.opacity(0.95))
                .frame(width: size * 0.055, height: size * 0.055)
                .blur(radius: 0.8)
                .offset(x: -size * 0.28, y: -size * 0.30)

            Circle()
                .fill(.white.opacity(0.75))
                .frame(width: size * 0.035, height: size * 0.035)
                .blur(radius: 0.6)
                .offset(x: size * 0.30, y: -size * 0.22)
        }
        .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: corner, style: .continuous))
        .shadow(color: .black.opacity(0.4), radius: size * 0.08, y: size * 0.06)
        .overlay(
            RoundedRectangle(cornerRadius: corner, style: .continuous)
                .strokeBorder(
                    LinearGradient(
                        colors: [.white.opacity(0.55), .clear, .black.opacity(0.25)],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    ),
                    lineWidth: 1.25
                )
        )
        .accessibilityLabel("NoMarkup")
    }
}

#Preview("Icon") {
    ZStack {
        Color.black.ignoresSafeArea()
        NoMarkupIcon(showWordmark: true, size: 160)
            .scaleEffect(1.6)
    }
}
