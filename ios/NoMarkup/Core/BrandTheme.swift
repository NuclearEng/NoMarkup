import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

// MARK: - Brand palette
//
// SSOT: `qa/showcase/index.html` + `docs/brand/showcase-ssot.md`
// Web: `web/src/styles/globals.css` (`.dark` terminal shell).
// navy `#07080b`, card `#14161e`, gold `#c9a84c` / bright `#e4c566`,
// text `#e8ecf1` / `#8b949e`, green `#22c55e`.
// Prefer these tokens over system gray list chrome so the native shell matches
// the showcase brand (not a plain iOS settings list).

enum BrandTheme {
    // MARK: A11Y.3 — Increase Contrast plumbing

    /// Wraps a pair of colors into one dynamic color that resolves to
    /// `increased` when the user enables Increase Contrast
    /// (`UITraitCollection.accessibilityContrast == .high`). UIKit dynamic
    /// providers re-resolve on trait changes, so every existing call site
    /// adapts with no per-site environment plumbing (IOS-A11Y.3).
    private static func contrastAdaptive(_ standard: Color, increased: Color) -> Color {
        #if canImport(UIKit)
        return Color(uiColor: UIColor { traits in
            traits.accessibilityContrast == .high ? UIColor(increased) : UIColor(standard)
        })
        #else
        return standard
        #endif
    }

    // MARK: Colors — core chrome

    /// App / dark terminal background — showcase `--bg-primary` `#07080b`.
    static let navy = Color(red: 0x07 / 255, green: 0x08 / 255, blue: 0x0B / 255)

    /// Card / grouped list row surface — showcase `--bg-card` `#14161e`.
    static let navyElevated = Color(red: 0x14 / 255, green: 0x16 / 255, blue: 0x1E / 255)

    /// Surface one step above card (raised panels) — showcase `--bg-card-hover` `#1a1d28`.
    static let surfaceRaised = Color(red: 0x1A / 255, green: 0x1D / 255, blue: 0x28 / 255)

    /// Brand gold (primary CTA fill) — showcase `--gold` `#c9a84c`.
    /// Prefer `Color("AccentColor")` for interactive tint so the asset catalog stays authoritative.
    static let gold = Color(red: 0xC9 / 255, green: 0xA8 / 255, blue: 0x4C / 255)

    /// Brand gold bright (emphasis / labels) — showcase `--gold-bright` `#e4c566`.
    static let goldBright = Color(red: 0xE4 / 255, green: 0xC5 / 255, blue: 0x66 / 255)

    /// Primary body text on navy — showcase `--text-primary` `#e8ecf1`.
    static let textPrimary = Color(red: 0xE8 / 255, green: 0xEC / 255, blue: 0xF1 / 255)

    /// Secondary / muted copy — showcase `--text-secondary` `#8b949e`.
    /// Measured 6.51:1 on navy / 5.46:1 on `surfaceRaised` (AA pass). Under
    /// Increase Contrast resolves to `#a8b3bd` — 9.39:1 navy / 7.88:1 raised
    /// (IOS-A11Y.3).
    static let textSecondary = contrastAdaptive(
        Color(red: 0x8B / 255, green: 0x94 / 255, blue: 0x9E / 255),
        increased: Color(red: 0xA8 / 255, green: 0xB3 / 255, blue: 0xBD / 255)
    )

    /// Success status — showcase `--green` `#22c55e`.
    static let success = Color(red: 0x22 / 255, green: 0xC5 / 255, blue: 0x5E / 255)

    /// Destructive / error status — showcase `--red` `#ef4444`.
    /// Measured 5.32:1 on navy but only 4.46:1 on `surfaceRaised` (under AA) —
    /// Increase Contrast resolves to `#f87171`: 7.24:1 navy / 6.07:1 raised
    /// (IOS-A11Y.3).
    static let destructive = contrastAdaptive(
        Color(red: 0xEF / 255, green: 0x44 / 255, blue: 0x44 / 255),
        increased: Color(red: 0xF8 / 255, green: 0x71 / 255, blue: 0x71 / 255)
    )

    /// Live / data accent — showcase `--teal` `#4ecdc4`.
    static let teal = Color(red: 0x4E / 255, green: 0xCD / 255, blue: 0xC4 / 255)

    // MARK: Colors — auction / marketplace semantics (web parity)

    /// Leading / active bid highlight — electric blue ≈ web `--bid-active` / `--trust-elite`
    /// (hsl 220 70% 60% dark shell) — `#4d8af0`.
    /// Measured 5.92:1 navy / 4.97:1 raised. Increase Contrast resolves to
    /// `#76a5f5` — 8.08:1 navy / 6.78:1 raised (IOS-A11Y.3).
    static let bidLeading = contrastAdaptive(
        Color(red: 0x4D / 255, green: 0x8A / 255, blue: 0xF0 / 255),
        increased: Color(red: 0x76 / 255, green: 0xA5 / 255, blue: 0xF5 / 255)
    )

    /// Alias of `bidLeading` for “live auction / your bid is active” chips.
    static let bidActive = bidLeading

    /// Winning bid / high-trust emerald — showcase green `#22c55e`.
    static let bidWinning = success

    /// Savings / positive delta (same emerald as winning for consistency).
    static let savings = bidWinning

    /// Warning / medium-trust amber ≈ web `--trust-medium` (hsl 38 80% 45%) — `#d9921a`.
    /// Measured 7.70:1 navy / 6.46:1 raised. Increase Contrast resolves to
    /// `#e8a33d` — 9.29:1 navy / 7.79:1 raised (IOS-A11Y.3).
    static let warning = contrastAdaptive(
        Color(red: 0xD9 / 255, green: 0x92 / 255, blue: 0x1A / 255),
        increased: Color(red: 0xE8 / 255, green: 0xA3 / 255, blue: 0x3D / 255)
    )

    /// Subtle blue border for incoming chat (not gold) — derived from `bidActive` at low opacity use sites.
    /// Increase Contrast strengthens both hue and alpha (IOS-A11Y.3).
    static let chatIncomingBorder = contrastAdaptive(
        Color(red: 0x4D / 255, green: 0x8A / 255, blue: 0xF0 / 255).opacity(0.35),
        increased: Color(red: 0x76 / 255, green: 0xA5 / 255, blue: 0xF5 / 255).opacity(0.7)
    )

    /// **Label / icon on gold filled CTAs** — navy (`#07080b`), not pure black and not white.
    /// Gold `#c9a84c` needs dark text for WCAG contrast; muted-gold + black failures are a known miss.
    static let ctaLabelOnGold = navy

    /// Asset-catalog gold used for `.tint` / prominent CTAs (falls back to static gold).
    static var accent: Color {
        // AccentColor.colorset is the single source for interactive gold.
        Color("AccentColor", bundle: .main)
    }

    /// Section header / eyebrow label — muted gold for hierarchy without competing with CTAs.
    /// Composite reads 6.51:1 on navy; Increase Contrast resolves to solid
    /// `goldBright` `#e4c566` — 11.90:1 (IOS-A11Y.3).
    static let sectionHeader = contrastAdaptive(gold.opacity(0.85), increased: goldBright)

    /// Optional gold mesh for home hero cards (subtle, not full-bleed).
    static var gradientHero: LinearGradient {
        LinearGradient(
            colors: [
                gold.opacity(0.14),
                goldBright.opacity(0.05),
                Color.clear,
            ],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
    }

    /// Premium card face — layered depth without looking like flat gray UIKit.
    static var gradientCardFace: LinearGradient {
        LinearGradient(
            colors: [
                Color(red: 0x1E / 255, green: 0x21 / 255, blue: 0x30 / 255), // bg-elevated
                navyElevated,
                Color(red: 0x0E / 255, green: 0x10 / 255, blue: 0x17 / 255), // bg-surface
            ],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
    }

    /// Hairline gold edge for elevated surfaces.
    /// Increase Contrast strengthens the edge (gold 45%) per HIG border
    /// guidance (IOS-A11Y.3).
    static let hairline = contrastAdaptive(gold.opacity(0.16), increased: gold.opacity(0.45))

    /// Soft ambient shadow under premium cards (use sparingly).
    static let cardShadow = Color.black.opacity(0.45)

    // MARK: A11Y.3 — Reduce Transparency opaque equivalents
    //
    // Alpha tints pre-composited over the surface they normally sit on, so the
    // brand read survives with zero translucency. The Brand* modifiers below
    // swap these in via `@Environment(\.accessibilityReduceTransparency)`.

    /// `hairline` (gold 16%) composited over `navyElevated`; Increase Contrast
    /// resolves to gold 45% over `surfaceRaised`.
    static let hairlineOpaque = contrastAdaptive(
        Color(red: 0x31 / 255, green: 0x2D / 255, blue: 0x25 / 255),
        increased: Color(red: 0x69 / 255, green: 0x5C / 255, blue: 0x38 / 255)
    )

    /// Card specular top edge (white 10% over card) as a solid hairline;
    /// Increase Contrast = white 20% composite.
    static let cardSpecularOpaque = contrastAdaptive(
        Color(red: 0x2C / 255, green: 0x2D / 255, blue: 0x34 / 255),
        increased: Color(red: 0x43 / 255, green: 0x45 / 255, blue: 0x4B / 255)
    )

    /// Primary CTA rim (white 18% over gold) as a solid stroke.
    static let ctaStrokeOnGoldOpaque = Color(red: 0xD3 / 255, green: 0xB8 / 255, blue: 0x6C / 255)

    /// Ghost button border (gold 28% / pressed 45%) over `surfaceRaised`.
    static let ghostBorderOpaque = Color(red: 0x4B / 255, green: 0x44 / 255, blue: 0x32 / 255)
    static let ghostBorderPressedOpaque = Color(red: 0x69 / 255, green: 0x5C / 255, blue: 0x38 / 255)

    /// Empty-state seal rings (gold 35% / 18% over navy).
    static let sealRingOpaque = Color(red: 0x4B / 255, green: 0x40 / 255, blue: 0x22 / 255)
    static let sealRingOuterOpaque = Color(red: 0x2A / 255, green: 0x25 / 255, blue: 0x17 / 255)

    /// Dollar field border (gold 35% over `surfaceRaised`).
    static let amountFieldBorderOpaque = Color(red: 0x57 / 255, green: 0x4E / 255, blue: 0x35 / 255)

    /// Incoming chat bubble border (bid blue 35% over `surfaceRaised`).
    static let chatIncomingBorderOpaque = Color(red: 0x2C / 255, green: 0x43 / 255, blue: 0x6E / 255)

    /// `sectionHeader` (gold 85% over navy) as a solid color; Increase Contrast
    /// resolves to `goldBright`.
    static let sectionHeaderOpaque = contrastAdaptive(
        Color(red: 0xAC / 255, green: 0x90 / 255, blue: 0x42 / 255),
        increased: goldBright
    )

    // MARK: Global chrome (UIKit appearance)

    /// Readable content column for form-like / long-read screens on wide (iPad) layouts.
    /// DES.12 / DES.20: ~720pt max keeps lines scannable without full-bleed stretch.
    static let readableContentWidth: CGFloat = 720

    /// Call once at launch so TabView / NavigationStack / lists pick up navy + gold.
    /// Keeps system accessibility (Dynamic Type sizes, reduce motion) intact.
    ///
    /// DES.4 / DES.9 — on iOS 26+ leave `scrollEdgeAppearance` at system default so
    /// Liquid Glass can use a transparent/blurred edge; keep `standardAppearance` branded.
    @MainActor
    static func applyGlobalChrome() {
        #if canImport(UIKit)
        let navyUI = UIColor(navy)
        let elevatedUI = UIColor(navyElevated)
        let goldUI = UIColor(accent)
        let secondaryUI = UIColor(textSecondary)
        let primaryUI = UIColor(textPrimary)

        // Tab bar — dark navy, gold selected, muted unselected.
        let tabAppearance = UITabBarAppearance()
        tabAppearance.configureWithOpaqueBackground()
        tabAppearance.backgroundColor = navyUI
        tabAppearance.shadowColor = UIColor.black.withAlphaComponent(0.4)

        let tabItem = UITabBarItemAppearance()
        tabItem.normal.iconColor = secondaryUI
        tabItem.normal.titleTextAttributes = [.foregroundColor: secondaryUI]
        tabItem.selected.iconColor = goldUI
        tabItem.selected.titleTextAttributes = [.foregroundColor: goldUI]
        tabAppearance.stackedLayoutAppearance = tabItem
        tabAppearance.inlineLayoutAppearance = tabItem
        tabAppearance.compactInlineLayoutAppearance = tabItem

        UITabBar.appearance().standardAppearance = tabAppearance
        // iOS 26+ Liquid Glass: do not force opaque scroll-edge chrome.
        if #available(iOS 26.0, *) {
            // Leave scrollEdgeAppearance nil / system default for glass edge.
        } else {
            UITabBar.appearance().scrollEdgeAppearance = tabAppearance
        }
        UITabBar.appearance().tintColor = goldUI
        UITabBar.appearance().unselectedItemTintColor = secondaryUI

        // Navigation bar — opaque navy when scrolled, light titles, gold bar buttons via tint.
        let navAppearance = UINavigationBarAppearance()
        navAppearance.configureWithOpaqueBackground()
        navAppearance.backgroundColor = navyUI
        navAppearance.shadowColor = UIColor.black.withAlphaComponent(0.35)
        navAppearance.titleTextAttributes = [.foregroundColor: primaryUI]
        navAppearance.largeTitleTextAttributes = [.foregroundColor: primaryUI]

        UINavigationBar.appearance().standardAppearance = navAppearance
        UINavigationBar.appearance().compactAppearance = navAppearance
        // DES.4 / DES.9: iOS 26+ keeps system scroll-edge (transparent / glass);
        // pre-26 keeps opaque brand edge so large titles don't flash system gray.
        if #available(iOS 26.0, *) {
            // Intentionally omit scrollEdgeAppearance assignment.
        } else {
            UINavigationBar.appearance().scrollEdgeAppearance = navAppearance
        }
        UINavigationBar.appearance().tintColor = goldUI
        UINavigationBar.appearance().prefersLargeTitles = true

        // Grouped / inset list backdrop.
        UITableView.appearance().backgroundColor = navyUI
        UICollectionView.appearance().backgroundColor = navyUI

        // Search field chrome on dark lists.
        UITextField.appearance(whenContainedInInstancesOf: [UISearchBar.self]).defaultTextAttributes = [
            .foregroundColor: primaryUI,
        ]
        UISearchBar.appearance().barTintColor = navyUI
        UISearchBar.appearance().tintColor = goldUI

        // Segmented control (Jobs Browse/Mine) on dark toolbar.
        UISegmentedControl.appearance().selectedSegmentTintColor = UIColor(gold.opacity(0.35))
        UISegmentedControl.appearance().setTitleTextAttributes(
            [.foregroundColor: primaryUI],
            for: .selected
        )
        UISegmentedControl.appearance().setTitleTextAttributes(
            [.foregroundColor: secondaryUI],
            for: .normal
        )

        // Form / secondary fills stay elevated navy rather than system gray.
        UITableViewCell.appearance().backgroundColor = elevatedUI

        // Default control tint (links, switches) — gold matches CTAs.
        UIView.appearance(whenContainedInInstancesOf: [UITableView.self]).tintColor = goldUI
        #endif
    }

    // MARK: - Accessibility helpers (A11Y.3)

    /// Returns `animation` unless Reduce Motion is enabled — then `nil` (no animation).
    /// Prefer `View.brandAnimation(_:value:)` from views so the environment is read correctly.
    static func animation(_ animation: Animation?, reduceMotion: Bool) -> Animation? {
        reduceMotion ? nil : animation
    }
}

// MARK: - View modifiers

private struct BrandListBackgroundModifier: ViewModifier {
    func body(content: Content) -> some View {
        content
            .scrollContentBackground(.hidden)
            // Brand navy is already opaque (A11Y.3 reduce-transparency friendly).
            .background(BrandTheme.navy.ignoresSafeArea())
            // Row fill comes from UITableViewCell appearance + per-row `.listRowBackground` where needed.
            .listStyle(.insetGrouped)
            // Navy chrome needs light status-bar content even when system appearance is light (DES.3).
            .toolbarColorScheme(.dark, for: .navigationBar)
    }
}

private struct BrandScreenBackgroundModifier: ViewModifier {
    func body(content: Content) -> some View {
        // DES.3: do NOT force `.environment(\.colorScheme, .dark)` — follow system appearance.
        // Explicit navy/gold brand surfaces still paint the dark terminal shell.
        content
            .background(BrandTheme.navy.ignoresSafeArea())
            .toolbarColorScheme(.dark, for: .navigationBar)
    }
}

/// Applies animation only when Reduce Motion is off (A11Y.3).
private struct BrandAnimationModifier<V: Equatable>: ViewModifier {
    let animation: Animation?
    let value: V
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        content.animation(BrandTheme.animation(animation, reduceMotion: reduceMotion), value: value)
    }
}

/// Centers content with a readable max width on regular-width (iPad) layouts (DES.12 / DES.20).
private struct BrandReadableWidthModifier: ViewModifier {
    var maxWidth: CGFloat

    func body(content: Content) -> some View {
        content
            .frame(maxWidth: maxWidth)
            .frame(maxWidth: .infinity)
    }
}

private struct BrandCardModifier: ViewModifier {
    var padding: CGFloat
    var useHeroGradient: Bool
    var elevated: Bool
    /// A11Y.3: opaque card chrome (no alpha ramps / washes) under Reduce Transparency.
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency

    func body(content: Content) -> some View {
        content
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background {
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .fill(BrandTheme.gradientCardFace)
                    .overlay {
                        if useHeroGradient && !reduceTransparency {
                            RoundedRectangle(cornerRadius: 18, style: .continuous)
                                .fill(BrandTheme.gradientHero)
                        }
                    }
                    .overlay(alignment: .top) {
                        // Specular top edge — reads as glass, not flat fill.
                        // Reduce Transparency: solid composite, no alpha ramp.
                        RoundedRectangle(cornerRadius: 18, style: .continuous)
                            .strokeBorder(specularStyle, lineWidth: 1)
                    }
            }
            .overlay(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .strokeBorder(
                        reduceTransparency ? BrandTheme.hairlineOpaque : BrandTheme.hairline,
                        lineWidth: 1
                    )
            )
            .shadow(
                color: elevated ? BrandTheme.cardShadow : .clear,
                radius: elevated ? 24 : 0,
                y: elevated ? 12 : 0
            )
    }

    private var specularStyle: AnyShapeStyle {
        if reduceTransparency {
            AnyShapeStyle(BrandTheme.cardSpecularOpaque)
        } else {
            AnyShapeStyle(
                LinearGradient(
                    colors: [
                        Color.white.opacity(0.10),
                        Color.white.opacity(0.02),
                        Color.clear,
                    ],
                    startPoint: .top,
                    endPoint: .bottom
                )
            )
        }
    }
}

/// Rounded border whose translucent tint swaps to an opaque composite when
/// Reduce Transparency is on (A11Y.3).
private struct BrandAdaptiveBorderModifier: ViewModifier {
    var cornerRadius: CGFloat
    var translucent: Color
    var opaque: Color
    var lineWidth: CGFloat
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency

    func body(content: Content) -> some View {
        content.overlay(
            RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                .strokeBorder(reduceTransparency ? opaque : translucent, lineWidth: lineWidth)
        )
    }
}

/// Floating loading-chip backdrop: `.ultraThinMaterial` capsule normally, a
/// solid `surfaceRaised` capsule when Reduce Transparency is on (A11Y.3).
private struct BrandOverlayChipModifier: ViewModifier {
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency

    @ViewBuilder
    func body(content: Content) -> some View {
        if reduceTransparency {
            content
                .background(BrandTheme.surfaceRaised, in: Capsule())
                .overlay(Capsule().strokeBorder(BrandTheme.hairlineOpaque, lineWidth: 1))
        } else {
            content.background(.ultraThinMaterial, in: Capsule())
        }
    }
}

/// Muted gold section header — Reduce Transparency swaps the alpha-tinted gold
/// for its solid composite (A11Y.3); Increase Contrast handled by the tokens.
private struct BrandSectionHeaderModifier: ViewModifier {
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency

    func body(content: Content) -> some View {
        content
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(
                reduceTransparency ? BrandTheme.sectionHeaderOpaque : BrandTheme.sectionHeader
            )
            .textCase(nil)
    }
}

/// Ghost / secondary control — hairline gold border, no muddy filled gold.
struct BrandGhostButtonStyle: ButtonStyle {
    /// A11Y.3: solid fill + composite border under Reduce Transparency.
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(BrandTheme.goldBright)
            .frame(maxWidth: .infinity)
            .frame(minHeight: 48)
            .background(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(
                        reduceTransparency
                            ? BrandTheme.surfaceRaised
                            : BrandTheme.surfaceRaised.opacity(configuration.isPressed ? 0.9 : 0.55)
                    )
            )
            .overlay(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .strokeBorder(ghostBorder(pressed: configuration.isPressed), lineWidth: 1)
            )
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
            // ButtonStyle has no Reduce Motion env; short press feedback is OK at system default.
            .animation(.easeOut(duration: 0.15), value: configuration.isPressed)
    }

    private func ghostBorder(pressed: Bool) -> Color {
        if reduceTransparency {
            return pressed ? BrandTheme.ghostBorderPressedOpaque : BrandTheme.ghostBorderOpaque
        }
        return BrandTheme.gold.opacity(pressed ? 0.45 : 0.28)
    }
}

/// Primary gold pill — bright fill, navy label, soft glow.
struct BrandPrimaryButtonStyle: ButtonStyle {
    /// A11Y.3: opaque rim under Reduce Transparency (fill is already opaque).
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.body.weight(.semibold))
            .foregroundStyle(BrandTheme.ctaLabelOnGold)
            .frame(maxWidth: .infinity)
            .frame(minHeight: 52)
            .background(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .fill(
                        LinearGradient(
                            colors: [
                                BrandTheme.goldBright,
                                BrandTheme.gold,
                                // A11Y.3: fully opaque bottom stop under Reduce Transparency.
                                reduceTransparency ? BrandTheme.gold : BrandTheme.gold.opacity(0.92),
                            ],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )
            )
            .overlay(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .strokeBorder(
                        reduceTransparency ? BrandTheme.ctaStrokeOnGoldOpaque : Color.white.opacity(0.18),
                        lineWidth: 0.5
                    )
            )
            .shadow(color: BrandTheme.gold.opacity(configuration.isPressed ? 0.15 : 0.35), radius: 16, y: 6)
            .scaleEffect(configuration.isPressed ? 0.985 : 1)
            .opacity(configuration.isPressed ? 0.94 : 1)
            .animation(.easeOut(duration: 0.15), value: configuration.isPressed)
    }
}

extension View {
    /// Navy grouped-list chrome: hides system gray scroll backdrop, elevated rows.
    func brandListBackground() -> some View {
        modifier(BrandListBackgroundModifier())
    }

    /// Full-screen navy fill for non-list empty / loading states.
    /// Respects system color scheme (no forced dark environment).
    func brandScreenBackground() -> some View {
        modifier(BrandScreenBackgroundModifier())
    }

    /// Elevated card surface with subtle gold edge (empty states, hero blocks).
    /// Pass `heroGradient: true` for home / marketplace promo cards (`gradientHero`).
    /// Pass `elevated: true` for hero depth (ambient shadow).
    func brandCard(padding: CGFloat = 16, heroGradient: Bool = false, elevated: Bool = false) -> some View {
        modifier(BrandCardModifier(padding: padding, useHeroGradient: heroGradient, elevated: elevated))
    }

    func brandPrimaryButton() -> some View {
        buttonStyle(BrandPrimaryButtonStyle())
    }

    func brandGhostButton() -> some View {
        buttonStyle(BrandGhostButtonStyle())
    }

    /// Apply elevated navy as the list row surface (call on row content inside `List`).
    func brandListRowBackground() -> some View {
        listRowBackground(BrandTheme.navyElevated)
    }

    /// Muted gold section header styling for list headers
    /// (Reduce Transparency-aware — A11Y.3).
    func brandSectionHeader() -> some View {
        modifier(BrandSectionHeaderModifier())
    }

    /// Rounded border that swaps its translucent tint for an opaque composite
    /// when Reduce Transparency is on (A11Y.3).
    func brandAdaptiveBorder(
        cornerRadius: CGFloat,
        translucent: Color,
        opaque: Color,
        lineWidth: CGFloat = 1
    ) -> some View {
        modifier(BrandAdaptiveBorderModifier(
            cornerRadius: cornerRadius,
            translucent: translucent,
            opaque: opaque,
            lineWidth: lineWidth
        ))
    }

    /// Gold hairline card border, Reduce Transparency-aware (A11Y.3).
    func brandHairlineBorder(cornerRadius: CGFloat, lineWidth: CGFloat = 1) -> some View {
        brandAdaptiveBorder(
            cornerRadius: cornerRadius,
            translucent: BrandTheme.hairline,
            opaque: BrandTheme.hairlineOpaque,
            lineWidth: lineWidth
        )
    }

    /// Floating loading-chip backdrop — `.ultraThinMaterial` capsule normally,
    /// solid `surfaceRaised` capsule when Reduce Transparency is on (A11Y.3).
    func brandOverlayChipBackground() -> some View {
        modifier(BrandOverlayChipModifier())
    }

    /// Gold filled CTA with **navy** label (contrast-safe on `#c9a84c` / AccentColor).
    /// Prefer `brandPrimaryButton()` for new surfaces; this remains for empty-state CTAs.
    func brandGoldProminentButton() -> some View {
        brandPrimaryButton()
    }

    /// Animation that becomes a no-op when Reduce Motion is on (A11Y.3).
    func brandAnimation<V: Equatable>(_ animation: Animation?, value: V) -> some View {
        modifier(BrandAnimationModifier(animation: animation, value: value))
    }

    /// Constrain content to a readable column (~720pt) and center on wide layouts (DES.12).
    func brandReadableWidth(_ maxWidth: CGFloat = BrandTheme.readableContentWidth) -> some View {
        modifier(BrandReadableWidthModifier(maxWidth: maxWidth))
    }
}

// MARK: - Premium empty / loading helpers

/// Marketplace-oriented empty state with gold seal energy (not system gray ContentUnavailable alone).
struct BrandEmptyState: View {
    let title: String
    let systemImage: String
    let message: String
    var actionTitle: String?
    var action: (() -> Void)?
    var secondaryActionTitle: String?
    var secondaryAction: (() -> Void)?

    /// A11Y.2 — scale empty-state seal with Dynamic Type.
    @ScaledMetric(relativeTo: .largeTitle) private var sealInner: CGFloat = 88
    @ScaledMetric(relativeTo: .largeTitle) private var sealOuter: CGFloat = 104
    /// A11Y.3: solid seal rings under Reduce Transparency.
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency

    var body: some View {
        VStack(spacing: 20) {
            ZStack {
                Circle()
                    .strokeBorder(
                        reduceTransparency ? BrandTheme.sealRingOpaque : BrandTheme.gold.opacity(0.35),
                        lineWidth: 2
                    )
                    .frame(width: sealInner, height: sealInner)
                Circle()
                    .strokeBorder(
                        reduceTransparency ? BrandTheme.sealRingOuterOpaque : BrandTheme.gold.opacity(0.18),
                        lineWidth: 1
                    )
                    .frame(width: sealOuter, height: sealOuter)
                Image(systemName: systemImage)
                    .font(.largeTitle.weight(.medium))
                    .foregroundStyle(BrandTheme.goldBright)
                    .symbolRenderingMode(.hierarchical)
            }
            .accessibilityHidden(true)

            VStack(spacing: 8) {
                Text(title)
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(BrandTheme.textPrimary)
                    .multilineTextAlignment(.center)
                Text(message)
                    .font(.subheadline)
                    .foregroundStyle(BrandTheme.textSecondary)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }

            if let actionTitle, let action {
                Button(actionTitle, action: action)
                    .brandGoldProminentButton()
                    .frame(minHeight: 44)
            }
            if let secondaryActionTitle, let secondaryAction {
                Button(secondaryActionTitle, action: secondaryAction)
                    .buttonStyle(.bordered)
                    .tint(BrandTheme.accent)
                    .frame(minHeight: 44)
            }
        }
        .padding(28)
        .brandCard(padding: 24)
        .padding(.horizontal, 24)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .brandScreenBackground()
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Dollar amount field (user enters dollars; API uses integer cents)

/// Bid / price entry that always means **dollars**, never cents.
/// Shows a leading `$`, decimal pad, and a live “Will bid $X.XX” confirmation
/// so the wire conversion to integer cents is never visible to the user.
struct DollarAmountField: View {
    @Binding var text: String
    var placeholder: String = "0.00"
    var accessibilityLabelText: String = "Amount in dollars"
    var showParsedPreview: Bool = true
    var isEnabled: Bool = true
    /// A11Y.3: composite border under Reduce Transparency.
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency

    /// Parsed wire amount in cents, or `nil` if the field is empty/invalid.
    var parsedCents: Int64? {
        MoneyFormat.cents(fromDollarsText: text)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                Text("$")
                    .font(.title3.weight(.semibold).monospacedDigit())
                    .foregroundStyle(BrandTheme.goldBright)
                    .accessibilityHidden(true)

                TextField(placeholder, text: $text)
                    .keyboardType(.decimalPad)
                    .textContentType(.none)
                    .autocorrectionDisabled()
                    .font(.title3.monospacedDigit())
                    .foregroundStyle(BrandTheme.textPrimary)
                    .disabled(!isEnabled)
                    .frame(minHeight: 44)
                    .accessibilityLabel(accessibilityLabelText)
                    .accessibilityHint("Enter dollars and cents, for example 125.00. Do not enter cents alone.")
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 4)
            .background(BrandTheme.surfaceRaised, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .strokeBorder(
                        reduceTransparency ? BrandTheme.amountFieldBorderOpaque : BrandTheme.gold.opacity(0.35),
                        lineWidth: 1
                    )
            )

            if showParsedPreview {
                if let cents = parsedCents {
                    Text("Will submit \(MoneyFormat.usd(cents: cents))")
                        .font(.caption.weight(.semibold).monospacedDigit())
                        .foregroundStyle(BrandTheme.success)
                        .accessibilityLabel("Will submit \(MoneyFormat.usd(cents: cents))")
                } else if !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    Text("Enter a dollar amount (example 125.00) — not cents")
                        .font(.caption)
                        .foregroundStyle(BrandTheme.destructive)
                } else {
                    Text("Dollars only — for example 125.00")
                        .font(.caption)
                        .foregroundStyle(BrandTheme.textSecondary)
                }
            }
        }
    }
}
