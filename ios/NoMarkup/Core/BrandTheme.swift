import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

// MARK: - Brand palette
//
// SSOT: `qa/showcase/index.html` + `docs/brand/showcase-ssot.md`
// Web: `web/src/styles/globals.css` (`.dark` terminal shell + `:root` light product UI).
//
// DES.3 — genuinely adaptive: every token resolves per `userInterfaceStyle`
// (light/dark) AND `accessibilityContrast` (Increase Contrast) via UIKit
// dynamic providers, so one call site renders correctly in all four states.
//
// Dark (showcase terminal, unchanged): navy `#07080b`, card `#14161e`,
// gold `#c9a84c` / bright `#e4c566`, text `#e8ecf1` / `#8b949e`, green `#22c55e`.
// Light (web `:root` product UI, warmed for the brand): paper `#f6f4ef`,
// card `#ffffff`, raised `#edeae3`, navy ink `#14161e`, interactive gold
// `#b89938` (AccentColor light), text-sized gold darkened to `#806316`
// (showcase gold fails 4.5:1 on light — same reason the web keeps `gold-dim`).
// Gold CTA fills stay literal showcase gold in BOTH modes (web parity:
// `--brand-gold` is identical in light and dark).

enum BrandTheme {
    // MARK: Palette hex constants (single source for Color tokens + UIKit chrome)

    private enum P {
        // Screens / surfaces
        static let screenDark: UInt32 = 0x07080B // showcase --bg-primary
        static let screenLight: UInt32 = 0xF6F4EF // warm paper
        static let cardDark: UInt32 = 0x14161E // showcase --bg-card
        static let cardLight: UInt32 = 0xFFFFFF
        static let raisedDark: UInt32 = 0x1A1D28 // showcase --bg-card-hover
        static let raisedLight: UInt32 = 0xEDEAE3
        static let elevatedTopDark: UInt32 = 0x1E2130 // showcase --bg-elevated
        static let elevatedTopLight: UInt32 = 0xFFFFFF
        static let surfaceLowDark: UInt32 = 0x0E1017 // showcase --bg-surface
        static let surfaceLowLight: UInt32 = 0xFAF8F2

        // Gold
        static let gold: UInt32 = 0xC9A84C // showcase --gold (fills, dark-mode accents)
        static let goldBrightHex: UInt32 = 0xE4C566 // showcase --gold-bright
        static let goldLight: UInt32 = 0xB89938 // AccentColor light — interactive/border gold on light
        static let goldTextLight: UInt32 = 0x806316 // text-sized gold on light (5.65 white / 5.14 paper / 4.71 raised)
        static let goldTextLightHC: UInt32 = 0x6B520F // 7.40 white / 6.73 paper / 6.16 raised

        // Text
        static let textPrimaryDark: UInt32 = 0xE8ECF1
        static let textPrimaryDarkHC: UInt32 = 0xFFFFFF
        static let textPrimaryLight: UInt32 = 0x14161E // navy ink (18.05 white / 16.42 paper / 15.03 raised)
        static let textPrimaryLightHC: UInt32 = 0x07080B
        static let textSecondaryDark: UInt32 = 0x8B949E
        static let textSecondaryDarkHC: UInt32 = 0xA8B3BD
        static let textSecondaryLight: UInt32 = 0x565E6C // 6.54 white / 5.95 paper / 5.44 raised
        static let textSecondaryLightHC: UInt32 = 0x3D4450 // 9.81 white / 8.92 paper / 8.16 raised

        // Status
        static let successDark: UInt32 = 0x22C55E
        static let successLight: UInt32 = 0x147A38 // 5.43 white / 4.94 paper / 4.52 raised
        static let successLightHC: UInt32 = 0x0F5C2B // 8.12 white / 7.39 paper / 6.76 raised
        static let destructiveDark: UInt32 = 0xEF4444
        static let destructiveDarkHC: UInt32 = 0xF87171
        static let destructiveLight: UInt32 = 0xC81E1E // 5.74 white / 5.22 paper / 4.78 raised
        static let destructiveLightHC: UInt32 = 0x991B1B // 8.31 white / 7.56 paper / 6.92 raised
        static let warningDark: UInt32 = 0xD9921A
        static let warningDarkHC: UInt32 = 0xE8A33D
        static let warningLight: UInt32 = 0x8A5B08 // 5.86 white / 5.34 paper / 4.88 raised
        static let warningLightHC: UInt32 = 0x6B4705 // 8.30 white / 7.56 paper / 6.91 raised
        static let tealDark: UInt32 = 0x4ECDC4
        static let tealLight: UInt32 = 0x176962 // 6.49 white / 5.91 paper / 5.41 raised
        static let bidDark: UInt32 = 0x4D8AF0
        static let bidDarkHC: UInt32 = 0x76A5F5
        static let bidLight: UInt32 = 0x2662D9 // web light --bid-active hsl(220 70% 50%) — 5.48 white / 4.99 paper / 4.56 raised
        static let bidLightHC: UInt32 = 0x1D4FB3 // 7.44 white / 6.77 paper / 6.19 raised
    }

    // MARK: Dynamic color plumbing (IOS-A11Y.3 + DES.3)

    #if canImport(UIKit)
    private static func ui(_ hex: UInt32, _ alpha: CGFloat = 1) -> UIColor {
        UIColor(
            red: CGFloat((hex >> 16) & 0xFF) / 255,
            green: CGFloat((hex >> 8) & 0xFF) / 255,
            blue: CGFloat(hex & 0xFF) / 255,
            alpha: alpha
        )
    }

    /// 4-way dynamic UIColor: `userInterfaceStyle` × `accessibilityContrast`.
    /// UIKit re-resolves dynamic providers on trait changes, so every call site
    /// (SwiftUI tokens AND appearance-proxy chrome) adapts with no per-site plumbing.
    static func dynamicUIColor(
        light: UIColor,
        dark: UIColor,
        lightIncreased: UIColor? = nil,
        darkIncreased: UIColor? = nil
    ) -> UIColor {
        UIColor { traits in
            let increased = traits.accessibilityContrast == .high
            if traits.userInterfaceStyle == .dark {
                return increased ? (darkIncreased ?? dark) : dark
            }
            return increased ? (lightIncreased ?? light) : light
        }
    }
    #endif

    /// Plain-hex 4-way adaptive token (alpha 1).
    private static func adaptive(
        light: UInt32,
        dark: UInt32,
        lightIncreased: UInt32? = nil,
        darkIncreased: UInt32? = nil
    ) -> Color {
        #if canImport(UIKit)
        return Color(uiColor: dynamicUIColor(
            light: ui(light),
            dark: ui(dark),
            lightIncreased: lightIncreased.map { ui($0) },
            darkIncreased: darkIncreased.map { ui($0) }
        ))
        #else
        return solid(dark)
        #endif
    }

    /// Alpha-aware 4-way adaptive token (for tinted hairlines / washes).
    private static func adaptive(
        light: (hex: UInt32, alpha: CGFloat),
        dark: (hex: UInt32, alpha: CGFloat),
        lightIncreased: (hex: UInt32, alpha: CGFloat)? = nil,
        darkIncreased: (hex: UInt32, alpha: CGFloat)? = nil
    ) -> Color {
        #if canImport(UIKit)
        return Color(uiColor: dynamicUIColor(
            light: ui(light.hex, light.alpha),
            dark: ui(dark.hex, dark.alpha),
            lightIncreased: lightIncreased.map { ui($0.hex, $0.alpha) },
            darkIncreased: darkIncreased.map { ui($0.hex, $0.alpha) }
        ))
        #else
        return solid(dark.hex).opacity(dark.alpha)
        #endif
    }

    /// Literal (mode-independent) brand color.
    private static func solid(_ hex: UInt32) -> Color {
        Color(
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255
        )
    }

    // MARK: Colors — core chrome

    /// Screen background. Dark: showcase `--bg-primary` `#07080b`. Light: warm paper `#f6f4ef`.
    static let navy = adaptive(light: P.screenLight, dark: P.screenDark)

    /// Card / grouped list row surface. Dark: showcase `--bg-card` `#14161e`. Light: white.
    static let navyElevated = adaptive(light: P.cardLight, dark: P.cardDark)

    /// Surface one step above card (raised panels, field fills).
    /// Dark: showcase `--bg-card-hover` `#1a1d28`. Light: warm `#edeae3`.
    static let surfaceRaised = adaptive(light: P.raisedLight, dark: P.raisedDark)

    /// Literal brand navy ink `#07080b` — identical in both modes. Use for
    /// labels/spinners sitting ON gold or other literal brand fills.
    static let navyInk = solid(P.screenDark)

    /// Brand gold for accents, borders, icons. Dark: showcase `--gold` `#c9a84c`.
    /// Light: `#b89938` (matches AccentColor light so tint + token agree).
    /// Prefer `Color("AccentColor")` for interactive tint so the asset catalog stays authoritative.
    static let gold = adaptive(light: P.goldLight, dark: P.gold)

    /// Literal showcase gold `#c9a84c` — CTA fill stop, identical both modes (web parity).
    static let goldFill = solid(P.gold)

    /// Literal showcase gold-bright `#e4c566` — CTA gradient top / chip fills that
    /// carry `ctaLabelOnGold` ink. Never use for text on light surfaces.
    static let goldBrightFill = solid(P.goldBrightHex)

    /// Emphasis gold for TEXT and glyphs. Dark: showcase `--gold-bright` `#e4c566`
    /// (11.90:1 navy). Light: darkened `#806316` — 5.65:1 white / 5.14 paper /
    /// 4.71 raised (showcase gold is only 2.3:1 on white). Increase Contrast:
    /// light `#6b520f` (7.40:1 white).
    static let goldBright = adaptive(
        light: P.goldTextLight,
        dark: P.goldBrightHex,
        lightIncreased: P.goldTextLightHC
    )

    /// Primary body text. Dark: showcase `--text-primary` `#e8ecf1` (HC: white).
    /// Light: navy ink `#14161e` — 18.05:1 white / 16.42 paper (HC: `#07080b`).
    static let textPrimary = adaptive(
        light: P.textPrimaryLight,
        dark: P.textPrimaryDark,
        lightIncreased: P.textPrimaryLightHC,
        darkIncreased: P.textPrimaryDarkHC
    )

    /// Secondary / muted copy. Dark: `#8b949e` — 6.51:1 navy / 5.46 raised
    /// (HC `#a8b3bd` — 9.39 / 7.88). Light: `#565e6c` — 6.54:1 white / 5.95
    /// paper / 5.44 raised (HC `#3d4450` — 9.81 / 8.92 / 8.16).
    static let textSecondary = adaptive(
        light: P.textSecondaryLight,
        dark: P.textSecondaryDark,
        lightIncreased: P.textSecondaryLightHC,
        darkIncreased: P.textSecondaryDarkHC
    )

    /// Success status text/glyphs. Dark: showcase `--green` `#22c55e`.
    /// Light: `#147a38` — 5.43:1 white / 4.94 paper / 4.52 raised
    /// (HC `#0f5c2b` — 8.12 white).
    static let success = adaptive(
        light: P.successLight,
        dark: P.successDark,
        lightIncreased: P.successLightHC
    )

    /// Literal showcase green `#22c55e` — status chip FILLS that carry navy ink
    /// (8.79:1) in both modes. Use `success` for text.
    static let successFill = solid(P.successDark)

    /// Destructive / error status. Dark: `#ef4444` — 5.32:1 navy (HC `#f87171`).
    /// Light: `#c81e1e` — 5.74:1 white / 5.22 paper / 4.78 raised (HC `#991b1b` — 8.31 white).
    static let destructive = adaptive(
        light: P.destructiveLight,
        dark: P.destructiveDark,
        lightIncreased: P.destructiveLightHC,
        darkIncreased: P.destructiveDarkHC
    )

    /// Live / data accent. Dark: showcase `--teal` `#4ecdc4`.
    /// Light: `#176962` — 6.49:1 white / 5.91 paper / 5.41 raised.
    static let teal = adaptive(light: P.tealLight, dark: P.tealDark)

    /// Literal showcase teal `#4ecdc4` — chip fills that carry navy ink (10.05:1). Text uses `teal`.
    static let tealFill = solid(P.tealDark)

    // MARK: Colors — auction / marketplace semantics (web parity)

    /// Leading / active bid highlight — web `--bid-active`.
    /// Dark: `#4d8af0` — 5.92:1 navy / 4.97 raised (HC `#76a5f5` — 8.08 / 6.78).
    /// Light: `#2662d9` (hsl 220 70% 50%) — 5.48:1 white / 4.99 paper / 4.56 raised
    /// (HC `#1d4fb3` — 7.44 white).
    static let bidLeading = adaptive(
        light: P.bidLight,
        dark: P.bidDark,
        lightIncreased: P.bidLightHC,
        darkIncreased: P.bidDarkHC
    )

    /// Alias of `bidLeading` for “live auction / your bid is active” chips.
    static let bidActive = bidLeading

    /// Winning bid / high-trust emerald — showcase green (adaptive; `successFill` for ink-carrying chips).
    static let bidWinning = success

    /// Savings / positive delta (same emerald as winning for consistency).
    static let savings = bidWinning

    /// Warning / medium-trust amber ≈ web `--trust-medium`.
    /// Dark: `#d9921a` — 7.70:1 navy / 6.46 raised (HC `#e8a33d` — 9.29 / 7.79).
    /// Light: `#8a5b08` — 5.86:1 white / 5.34 paper / 4.88 raised (HC `#6b4705` — 8.30 white).
    static let warning = adaptive(
        light: P.warningLight,
        dark: P.warningDark,
        lightIncreased: P.warningLightHC,
        darkIncreased: P.warningDarkHC
    )

    /// Literal showcase amber `#d9921a` — banner/chip FILLS carrying navy ink
    /// (6.57:1) in both modes. Use `warning` for text.
    static let warningFill = solid(P.warningDark)

    /// Subtle blue border for incoming chat (not gold) — derived from `bidActive`.
    /// Increase Contrast strengthens both hue and alpha (IOS-A11Y.3).
    static let chatIncomingBorder = adaptive(
        light: (hex: P.bidLight, alpha: 0.45),
        dark: (hex: P.bidDark, alpha: 0.35),
        lightIncreased: (hex: P.bidLightHC, alpha: 0.85),
        darkIncreased: (hex: P.bidDarkHC, alpha: 0.7)
    )

    /// **Label / icon on gold filled CTAs** — literal navy ink (`#07080b`), not pure
    /// black and not white, in BOTH modes (the fill under it is literal gold).
    /// Gold `#c9a84c` → 8.76:1, `#e4c566` → 11.90:1, `#b89938` → 7.30:1.
    static let ctaLabelOnGold = navyInk

    /// Asset-catalog gold used for `.tint` / prominent CTAs (light `#b89938`, dark `#c9a84c`).
    static var accent: Color {
        // AccentColor.colorset is the single source for interactive gold.
        Color("AccentColor", bundle: .main)
    }

    /// Section header / eyebrow label — muted gold for hierarchy without competing with CTAs.
    /// Dark: gold 85% — 6.51:1 composite on navy (HC solid `#e4c566` — 11.90:1).
    /// Light: solid text gold `#806316` — 5.14:1 paper (HC `#6b520f` — 6.73 paper).
    static let sectionHeader = adaptive(
        light: (hex: P.goldTextLight, alpha: 1),
        dark: (hex: P.gold, alpha: 0.85),
        lightIncreased: (hex: P.goldTextLightHC, alpha: 1),
        darkIncreased: (hex: P.goldBrightHex, alpha: 1)
    )

    /// Optional gold mesh for home hero cards (subtle, not full-bleed).
    /// Literal showcase golds — a low-alpha wash reads warm on both paper and navy.
    static var gradientHero: LinearGradient {
        LinearGradient(
            colors: [
                goldFill.opacity(0.14),
                goldBrightFill.opacity(0.05),
                Color.clear,
            ],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
    }

    /// Premium card face — layered depth without looking like flat gray UIKit.
    /// Dark: elevated `#1e2130` → card → surface `#0e1017`. Light: white → white → `#faf8f2`.
    static var gradientCardFace: LinearGradient {
        LinearGradient(
            colors: [
                adaptive(light: P.elevatedTopLight, dark: P.elevatedTopDark),
                navyElevated,
                adaptive(light: P.surfaceLowLight, dark: P.surfaceLowDark),
            ],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
    }

    /// Hairline gold edge for elevated surfaces.
    /// Dark: gold 16% (HC 45%). Light: light gold 35% (HC 65%) — alpha rises because
    /// gold tints vanish faster on white than on navy.
    static let hairline = adaptive(
        light: (hex: P.goldLight, alpha: 0.35),
        dark: (hex: P.gold, alpha: 0.16),
        lightIncreased: (hex: P.goldLight, alpha: 0.65),
        darkIncreased: (hex: P.gold, alpha: 0.45)
    )

    /// Soft ambient shadow under premium cards (use sparingly).
    static let cardShadow = adaptive(
        light: (hex: 0x000000, alpha: 0.12),
        dark: (hex: 0x000000, alpha: 0.45)
    )

    // MARK: A11Y.3 — Reduce Transparency opaque equivalents
    //
    // Alpha tints pre-composited over the surface they normally sit on, so the
    // brand read survives with zero translucency. The Brand* modifiers below
    // swap these in via `@Environment(\.accessibilityReduceTransparency)`.

    /// `hairline` composited over the card surface.
    /// Dark: gold 16% over `#14161e` (HC gold 45% over raised). Light: light gold
    /// 35% over white `#e6dbb9` (HC 65% `#d1bd7e`).
    static let hairlineOpaque = adaptive(
        light: 0xE6DBB9,
        dark: 0x312D25,
        lightIncreased: 0xD1BD7E,
        darkIncreased: 0x695C38
    )

    /// Card specular top edge as a solid hairline.
    /// Dark: white 10% over card (HC 20%). Light: warm gray `#e9e7e2` (HC `#d6d3cc`).
    static let cardSpecularOpaque = adaptive(
        light: 0xE9E7E2,
        dark: 0x2C2D34,
        lightIncreased: 0xD6D3CC,
        darkIncreased: 0x43454B
    )

    /// Primary CTA rim (white 18% over literal gold) as a solid stroke — mode-independent.
    static let ctaStrokeOnGoldOpaque = solid(0xD3B86C)

    /// Ghost button border (gold 28% / pressed 45%) over the ghost fill surface.
    static let ghostBorderOpaque = adaptive(light: 0xEBE2C7, dark: 0x4B4432)
    static let ghostBorderPressedOpaque = adaptive(light: 0xDFD1A5, dark: 0x695C38)

    /// Empty-state seal rings (gold 35% / 18% over the screen background).
    static let sealRingOpaque = adaptive(light: 0xE0D4AF, dark: 0x4B4022)
    static let sealRingOuterOpaque = adaptive(light: 0xEBE4CE, dark: 0x2A2517)

    /// Dollar field border (gold 35% over `surfaceRaised`).
    static let amountFieldBorderOpaque = adaptive(light: 0xDACEA7, dark: 0x574E35)

    /// Incoming chat bubble border (bid blue 35% over `surfaceRaised`).
    static let chatIncomingBorderOpaque = adaptive(light: 0xA7BAE0, dark: 0x2C436E)

    /// `sectionHeader` as a solid color.
    /// Dark: gold 85% over navy `#ac9042` (HC `#e4c566`). Light: solid text gold (HC darker).
    static let sectionHeaderOpaque = adaptive(
        light: P.goldTextLight,
        dark: 0xAC9042,
        lightIncreased: P.goldTextLightHC,
        darkIncreased: P.goldBrightHex
    )

    // MARK: Global chrome (UIKit appearance)

    /// Readable content column for form-like / long-read screens on wide (iPad) layouts.
    /// DES.12 / DES.20: ~720pt max keeps lines scannable without full-bleed stretch.
    static let readableContentWidth: CGFloat = 720

    /// Call once at launch so TabView / NavigationStack / lists pick up the brand
    /// in BOTH appearances (navy terminal in dark, warm paper in light — mirrors
    /// the web, whose light product chrome is light, not forced dark).
    /// Every color handed to the appearance proxies is a dynamic provider, so
    /// bars re-resolve on appearance changes with no re-launch.
    /// Keeps system accessibility (Dynamic Type sizes, reduce motion) intact.
    ///
    /// DES.4 / DES.9 — on iOS 26+ leave `scrollEdgeAppearance` at system default so
    /// Liquid Glass can use a transparent/blurred edge; keep `standardAppearance` branded.
    @MainActor
    static func applyGlobalChrome() {
        #if canImport(UIKit)
        let screenUI = dynamicUIColor(light: ui(P.screenLight), dark: ui(P.screenDark))
        let elevatedUI = dynamicUIColor(light: ui(P.cardLight), dark: ui(P.cardDark))
        let primaryUI = dynamicUIColor(
            light: ui(P.textPrimaryLight),
            dark: ui(P.textPrimaryDark),
            lightIncreased: ui(P.textPrimaryLightHC),
            darkIncreased: ui(P.textPrimaryDarkHC)
        )
        let secondaryUI = dynamicUIColor(
            light: ui(P.textSecondaryLight),
            dark: ui(P.textSecondaryDark),
            lightIncreased: ui(P.textSecondaryLightHC),
            darkIncreased: ui(P.textSecondaryDarkHC)
        )
        // Interactive gold — asset catalog is authoritative (light #b89938 / dark #c9a84c).
        let goldUI = UIColor(named: "AccentColor") ?? ui(P.gold)
        // Bar hairline shadows: strong on navy, soft on paper.
        let barShadowUI = dynamicUIColor(
            light: UIColor.black.withAlphaComponent(0.12),
            dark: UIColor.black.withAlphaComponent(0.4)
        )

        // Tab bar — navy in dark / paper in light, gold selected, muted unselected.
        let tabAppearance = UITabBarAppearance()
        tabAppearance.configureWithOpaqueBackground()
        tabAppearance.backgroundColor = screenUI
        tabAppearance.shadowColor = barShadowUI

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

        // Navigation bar — opaque brand surface when scrolled, adaptive titles,
        // gold bar buttons via tint.
        let navAppearance = UINavigationBarAppearance()
        navAppearance.configureWithOpaqueBackground()
        navAppearance.backgroundColor = screenUI
        navAppearance.shadowColor = barShadowUI
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
        UITableView.appearance().backgroundColor = screenUI
        UICollectionView.appearance().backgroundColor = screenUI

        // Search field chrome on brand lists.
        UITextField.appearance(whenContainedInInstancesOf: [UISearchBar.self]).defaultTextAttributes = [
            .foregroundColor: primaryUI,
        ]
        UISearchBar.appearance().barTintColor = screenUI
        UISearchBar.appearance().tintColor = goldUI

        // Segmented control (Jobs Browse/Mine, Post-a-job Speed) — warm gold
        // selection over the system track in both modes; adaptive titles.
        UISegmentedControl.appearance().selectedSegmentTintColor = dynamicUIColor(
            light: ui(P.goldLight, 0.4),
            dark: ui(P.gold, 0.35)
        )
        UISegmentedControl.appearance().setTitleTextAttributes(
            [.foregroundColor: primaryUI],
            for: .selected
        )
        UISegmentedControl.appearance().setTitleTextAttributes(
            [.foregroundColor: secondaryUI],
            for: .normal
        )

        // Form / secondary fills follow the card surface rather than system gray.
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
            // Brand surface is opaque in both modes (A11Y.3 reduce-transparency friendly).
            .background(BrandTheme.navy.ignoresSafeArea())
            // Row fill comes from the system grouped cell (adaptive) + per-row `.listRowBackground` where needed.
            .listStyle(.insetGrouped)
        // DES.3: no forced `.toolbarColorScheme(.dark)` — bars are dynamic (paper
        // in light, navy in dark), so status-bar/title contrast follows the system.
    }
}

private struct BrandScreenBackgroundModifier: ViewModifier {
    func body(content: Content) -> some View {
        // DES.3: do NOT force `.environment(\.colorScheme, .dark)` — follow system appearance.
        // The brand surface itself adapts (paper in light, navy terminal in dark).
        content
            .background(BrandTheme.navy.ignoresSafeArea())
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
    @Environment(\.colorScheme) private var colorScheme

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
            return AnyShapeStyle(BrandTheme.cardSpecularOpaque)
        }
        // Light cards get a warm top edge (white specular is invisible on white).
        let specularTint: Color = colorScheme == .dark ? .white : BrandTheme.gold
        return AnyShapeStyle(
            LinearGradient(
                colors: [
                    specularTint.opacity(0.10),
                    specularTint.opacity(0.02),
                    Color.clear,
                ],
                startPoint: .top,
                endPoint: .bottom
            )
        )
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

// MARK: - Apple Glass chips (iOS 26 liquid-glass language)

/// Semantic glass chip for LIVE / timer / status — frosted material, tinted ink + hairline.
/// Avoids solid traffic-light green / amber fills that fight the champagne brand on light mode.
struct BrandGlassStatusChip: View {
    enum Kind {
        case live
        case neutral
        case gold
        case urgent
        case muted
    }

    let title: String
    var kind: Kind = .neutral
    var showPulse: Bool = false

    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        HStack(spacing: 5) {
            if showPulse {
                LivePulseDot()
            }
            Text(title)
                .font(.caption2.weight(.heavy).monospaced())
                .tracking(0.6)
                .foregroundStyle(ink)
                .lineLimit(1)
        }
        .padding(.horizontal, 9)
        .padding(.vertical, 5)
        .background { chipBackground }
        .overlay {
            Capsule(style: .continuous)
                .strokeBorder(stroke, lineWidth: 1)
        }
    }

    private var ink: Color {
        switch kind {
        case .live:
            // Adaptive green text (not white-on-solid) — works on glass in light + dark.
            return BrandTheme.success
        case .gold:
            return BrandTheme.goldBright
        case .urgent:
            return BrandTheme.warning
        case .neutral, .muted:
            return BrandTheme.textSecondary
        }
    }

    private var stroke: Color {
        switch kind {
        case .live:
            return BrandTheme.success.opacity(colorScheme == .dark ? 0.40 : 0.28)
        case .gold:
            return BrandTheme.gold.opacity(colorScheme == .dark ? 0.40 : 0.30)
        case .urgent:
            return BrandTheme.warning.opacity(0.35)
        case .neutral, .muted:
            return reduceTransparency ? BrandTheme.hairlineOpaque : BrandTheme.hairline
        }
    }

    @ViewBuilder
    private var chipBackground: some View {
        if reduceTransparency {
            Capsule(style: .continuous)
                .fill(BrandTheme.surfaceRaised)
        } else {
            Capsule(style: .continuous)
                .fill(.ultraThinMaterial)
                .overlay {
                    // Warm champagne wash — kills cool purple cast on light glass.
                    Capsule(style: .continuous)
                        .fill(BrandTheme.gold.opacity(colorScheme == .dark ? 0.06 : 0.10))
                }
        }
    }
}

/// Glass card face for list rows — material + warm gold specular, not flat white/purple.
struct BrandGlassCardBackground: View {
    var cornerRadius: CGFloat = 16
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
            .fill(reduceTransparency ? AnyShapeStyle(BrandTheme.gradientCardFace) : AnyShapeStyle(.regularMaterial))
            .overlay {
                if !reduceTransparency {
                    RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                        .fill(BrandTheme.gold.opacity(colorScheme == .dark ? 0.04 : 0.07))
                }
            }
            .overlay {
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .strokeBorder(
                        reduceTransparency
                            ? BrandTheme.hairlineOpaque
                            : BrandTheme.gold.opacity(colorScheme == .dark ? 0.22 : 0.18),
                        lineWidth: 1
                    )
            }
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
/// for its solid composite (A11Y.3); light/dark + Increase Contrast handled by the tokens.
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
            .background(AuditPressProbe(isPressed: configuration.isPressed, path: "brand.ghost"))
    }

    private func ghostBorder(pressed: Bool) -> Color {
        if reduceTransparency {
            return pressed ? BrandTheme.ghostBorderPressedOpaque : BrandTheme.ghostBorderOpaque
        }
        return BrandTheme.gold.opacity(pressed ? 0.45 : 0.28)
    }
}

/// Primary gold pill — bright fill, navy label, soft glow.
/// The fill is LITERAL showcase gold in both modes (web parity — `--brand-gold`
/// does not shift in light), so the label stays `ctaLabelOnGold` navy ink.
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
                                BrandTheme.goldBrightFill,
                                BrandTheme.goldFill,
                                // A11Y.3: fully opaque bottom stop under Reduce Transparency.
                                reduceTransparency
                                    ? BrandTheme.goldFill
                                    : BrandTheme.goldFill.opacity(0.92),
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
            .shadow(color: BrandTheme.goldFill.opacity(configuration.isPressed ? 0.15 : 0.35), radius: 16, y: 6)
            .scaleEffect(configuration.isPressed ? 0.985 : 1)
            .opacity(configuration.isPressed ? 0.94 : 1)
            .animation(.easeOut(duration: 0.15), value: configuration.isPressed)
            .background(AuditPressProbe(isPressed: configuration.isPressed, path: "brand.primary"))
    }
}

/// Fires one TAP into the request log when a styled button goes down.
private struct AuditPressProbe: View {
    let isPressed: Bool
    let path: String

    var body: some View {
        Color.clear
            .frame(width: 0, height: 0)
            .onChange(of: isPressed) { _, pressed in
                if pressed {
                    ClientActionLog.shared.recordUI(method: "TAP", path: path, kind: "ui")
                }
            }
    }
}

// MARK: - DES.4 Liquid Glass primary CTA

/// IOS-DES.4: primary bid / place CTAs adopt Liquid Glass on iOS 26+.
///
/// `buttonStyle(.glassProminent)` is verified present in the iOS 26 SDK
/// (`GlassProminentButtonStyle`, `@available(iOS 26.0, *)`). Pre-26 falls back
/// to borderedProminent. Pair with `.tint(BrandTheme.accent)` at the call site.
private struct GlassProminentBrandCTAStyle: ViewModifier {
    func body(content: Content) -> some View {
        if #available(iOS 26.0, *) {
            content.buttonStyle(.glassProminent)
        } else {
            content.buttonStyle(.borderedProminent)
        }
    }
}

extension View {
    /// Brand grouped-list chrome: hides system gray scroll backdrop, adaptive brand backdrop.
    func brandListBackground() -> some View {
        modifier(BrandListBackgroundModifier())
    }

    /// Full-screen brand fill for non-list empty / loading states.
    /// Respects system color scheme (no forced dark environment).
    func brandScreenBackground() -> some View {
        modifier(BrandScreenBackgroundModifier())
    }

    /// DES.4 / DES.9 — navigation bar chrome that yields to Liquid Glass on iOS 26+.
    /// Pre-26 keeps opaque brand navy so large titles don't flash system gray.
    /// On iOS 26+ uses automatic (no solid fill) so scroll-edge glass works with
    /// `applyGlobalChrome()`'s system default `scrollEdgeAppearance`.
    @ViewBuilder
    func brandNavigationBarChrome() -> some View {
        if #available(iOS 26.0, *) {
            self.toolbarBackground(.automatic, for: .navigationBar)
        } else {
            self.toolbarBackground(BrandTheme.navy, for: .navigationBar)
        }
    }

    /// Pin the root 5-tab bar so a NavigationLink push cannot swallow it.
    /// iOS 18+/26 implicitly hides `.tabBar` on some pushed lists (`.searchable`,
    /// nested `NavigationLink`s) and pop does not always restore — SIM-TEST.5/6.
    func keepRootTabBarVisible() -> some View {
        #if os(iOS)
        self.toolbar(.visible, for: .tabBar)
        #else
        self
        #endif
    }

    /// Extra list/form footer so the last section sits above the iOS 26 floating tab bar.
    /// 28pt was not enough — the capsule + home indicator cover ~80pt (SIM-UI tab clip).
    func brandTabBarClearance(_ height: CGFloat = 80) -> some View {
        #if os(iOS)
        self.safeAreaInset(edge: .bottom, spacing: 0) {
            Color.clear.frame(height: height)
        }
        #else
        self
        #endif
    }

    /// DES.4 — primary CTA with Liquid Glass on iOS 26+, borderedProminent pre-26.
    /// Prefer on bid / place / submit gold CTAs; call-site `.tint(BrandTheme.accent)`.
    func glassProminentBrandCTA() -> some View {
        modifier(GlassProminentBrandCTAStyle())
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

    /// Apply the card surface as the list row background (call on row content inside `List`).
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

    /// Gold filled CTA with **navy** label (contrast-safe on literal gold).
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
//
// Unicorn bar: never show a naked gray spinner on a brand surface.
// Prefer skeleton desks that match list density (Bloomberg) + gold shimmer
// (champagne brand), reduce-motion safe, VoiceOver “Loading …”.

/// Unicorn-grade skeleton pulse — gold-tinted, reduce-motion safe (static fill when reduced).
struct BrandSkeletonBar: View {
    var height: CGFloat = 14
    var cornerRadius: CGFloat = 8
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var phase: CGFloat = -220

    var body: some View {
        RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
            .fill(BrandTheme.surfaceRaised)
            .overlay {
                if !reduceMotion {
                    RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                        .fill(
                            LinearGradient(
                                colors: [
                                    BrandTheme.gold.opacity(0),
                                    BrandTheme.gold.opacity(0.14),
                                    BrandTheme.gold.opacity(0),
                                ],
                                startPoint: .leading,
                                endPoint: .trailing
                            )
                        )
                        .mask(
                            RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                        )
                        .offset(x: phase)
                }
            }
            .frame(height: height)
            .clipShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
            .onAppear {
                guard !reduceMotion else { return }
                phase = -220
                withAnimation(.linear(duration: 1.15).repeatForever(autoreverses: false)) {
                    phase = 280
                }
            }
            .accessibilityHidden(true)
    }
}

/// Catalog card placeholder used while first page loads (Home / Marketplace / Jobs).
struct BrandCatalogSkeleton: View {
    var rows: Int = 4

    var body: some View {
        VStack(spacing: 14) {
            ForEach(0..<rows, id: \.self) { index in
                VStack(alignment: .leading, spacing: 10) {
                    BrandSkeletonBar(height: 16)
                        .frame(maxWidth: index % 2 == 0 ? 200 : 160)
                    BrandSkeletonBar(height: 12)
                    BrandSkeletonBar(height: 12)
                        .frame(maxWidth: index % 3 == 0 ? 140 : 100)
                    HStack {
                        BrandSkeletonBar(height: 22, cornerRadius: 11)
                            .frame(width: 78)
                        Spacer()
                        BrandSkeletonBar(height: 22, cornerRadius: 11)
                            .frame(width: 64)
                    }
                }
                .padding(16)
                .brandCard(padding: 0)
            }
        }
        .padding(.horizontal, 4)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Loading")
    }
}

/// Detail-page skeleton — hero price block + body rows (Job / Listing / Contract).
struct BrandDetailSkeleton: View {
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                // Arena / price hero
                VStack(alignment: .leading, spacing: 12) {
                    BrandSkeletonBar(height: 12)
                        .frame(maxWidth: 96)
                    BrandSkeletonBar(height: 40, cornerRadius: 12)
                        .frame(maxWidth: 200)
                    BrandSkeletonBar(height: 12)
                        .frame(maxWidth: 220)
                    HStack(spacing: 10) {
                        BrandSkeletonBar(height: 28, cornerRadius: 14)
                            .frame(width: 72)
                        BrandSkeletonBar(height: 28, cornerRadius: 14)
                            .frame(width: 88)
                        Spacer()
                    }
                }
                .padding(20)
                .brandCard(padding: 0, heroGradient: true, elevated: true)

                // Meta rows
                VStack(alignment: .leading, spacing: 14) {
                    ForEach(0..<5, id: \.self) { i in
                        HStack {
                            BrandSkeletonBar(height: 14)
                                .frame(maxWidth: 90)
                            Spacer()
                            BrandSkeletonBar(height: 14)
                                .frame(maxWidth: i == 2 ? 120 : 70)
                        }
                    }
                }
                .padding(16)
                .brandCard(padding: 0)

                // Ladder / bids block
                VStack(alignment: .leading, spacing: 12) {
                    BrandSkeletonBar(height: 14)
                        .frame(maxWidth: 110)
                    ForEach(0..<4, id: \.self) { _ in
                        HStack {
                            BrandSkeletonBar(height: 36, cornerRadius: 18)
                                .frame(width: 36)
                            VStack(alignment: .leading, spacing: 6) {
                                BrandSkeletonBar(height: 12)
                                    .frame(maxWidth: 140)
                                BrandSkeletonBar(height: 10)
                                    .frame(maxWidth: 80)
                            }
                            Spacer()
                            BrandSkeletonBar(height: 18)
                                .frame(width: 64)
                        }
                    }
                }
                .padding(16)
                .brandCard(padding: 0)
            }
            .padding(16)
            .brandReadableWidth()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .brandScreenBackground()
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Loading details")
    }
}

/// Inbox / message-list skeleton (dense rows, avatar + lines).
struct BrandInboxSkeleton: View {
    var rows: Int = 8

    var body: some View {
        VStack(spacing: 0) {
            ForEach(0..<rows, id: \.self) { i in
                HStack(spacing: 14) {
                    Circle()
                        .fill(BrandTheme.surfaceRaised)
                        .frame(width: 48, height: 48)
                        .overlay {
                            BrandSkeletonBar(height: 48, cornerRadius: 24)
                                .frame(width: 48)
                        }
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            BrandSkeletonBar(height: 13)
                                .frame(maxWidth: i % 2 == 0 ? 140 : 100)
                            Spacer()
                            BrandSkeletonBar(height: 11)
                                .frame(width: 40)
                        }
                        BrandSkeletonBar(height: 11)
                        BrandSkeletonBar(height: 11)
                            .frame(maxWidth: 180)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 14)
                if i < rows - 1 {
                    Divider()
                        .overlay(BrandTheme.hairline)
                        .padding(.leading, 78)
                }
            }
        }
        .padding(.vertical, 8)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .brandScreenBackground()
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Loading messages")
    }
}

/// Settings / form skeleton (section cards with field rows).
struct BrandFormSkeleton: View {
    var sections: Int = 2
    var rowsPerSection: Int = 4

    var body: some View {
        ScrollView {
            VStack(spacing: 20) {
                ForEach(0..<sections, id: \.self) { _ in
                    VStack(alignment: .leading, spacing: 16) {
                        BrandSkeletonBar(height: 12)
                            .frame(maxWidth: 100)
                        ForEach(0..<rowsPerSection, id: \.self) { _ in
                            HStack {
                                BrandSkeletonBar(height: 14)
                                    .frame(maxWidth: 120)
                                Spacer()
                                BrandSkeletonBar(height: 14)
                                    .frame(width: 48)
                            }
                        }
                    }
                    .padding(16)
                    .brandCard(padding: 0)
                }
            }
            .padding(16)
            .brandReadableWidth()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .brandScreenBackground()
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Loading")
    }
}

// MARK: - Multi-step wizard chrome (Post job / sell funnels)

/// Gold progress rail for multi-step forms — terminal desk, not pastel onboarding.
struct BrandWizardStepChrome: View {
    let steps: [String]
    let currentIndex: Int

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 0) {
                ForEach(Array(steps.enumerated()), id: \.offset) { index, _ in
                    let done = index < currentIndex
                    let active = index == currentIndex
                    Circle()
                        .fill(done || active ? BrandTheme.goldFill : BrandTheme.surfaceRaised)
                        .frame(width: active ? 12 : 8, height: active ? 12 : 8)
                        .overlay {
                            Circle()
                                .strokeBorder(
                                    active ? BrandTheme.goldBrightFill : BrandTheme.hairline,
                                    lineWidth: active ? 2 : 1
                                )
                        }
                        .frame(width: 20, height: 20)
                        .accessibilityHidden(true)

                    if index < steps.count - 1 {
                        Rectangle()
                            .fill(
                                index < currentIndex
                                    ? BrandTheme.goldFill.opacity(0.85)
                                    : BrandTheme.hairline
                            )
                            .frame(height: 2)
                            .frame(maxWidth: .infinity)
                    }
                }
            }
            .animation(reduceMotion ? nil : .easeOut(duration: 0.2), value: currentIndex)

            if steps.indices.contains(currentIndex) {
                Text("Step \(currentIndex + 1) of \(steps.count) · \(steps[currentIndex])")
                    .font(.caption.weight(.semibold).monospaced())
                    .tracking(0.4)
                    .foregroundStyle(BrandTheme.goldBright)
                    .accessibilityAddTraits(.isHeader)
            }
        }
        .padding(.horizontal, 4)
        .padding(.vertical, 6)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(
            steps.indices.contains(currentIndex)
                ? "Step \(currentIndex + 1) of \(steps.count), \(steps[currentIndex])"
                : "Wizard progress"
        )
    }
}

/// Full-screen branded loading desk — drop-in replacement for naked `ProgressView("Loading…")`.
struct BrandLoadingScreen: View {
    enum Kind {
        /// Auction / marketplace catalog cards
        case catalog
        /// Job / listing / contract detail
        case detail
        /// Chat inbox
        case inbox
        /// Settings / profile / forms
        case form
    }

    var kind: Kind = .catalog
    var rows: Int = 5
    var accessibilityLabel: String = "Loading"

    var body: some View {
        Group {
            switch kind {
            case .catalog:
                ScrollView {
                    BrandCatalogSkeleton(rows: rows)
                        .padding()
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .brandScreenBackground()
            case .detail:
                BrandDetailSkeleton()
            case .inbox:
                BrandInboxSkeleton(rows: max(rows, 6))
            case .form:
                BrandFormSkeleton()
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityLabel)
    }
}

/// Institutional monospaced price — numeric text transition + optional flash.
struct BrandPriceText: View {
    let cents: Int64?
    var font: Font = .title3.weight(.bold).monospacedDigit()
    var color: Color = BrandTheme.textPrimary
    var flashToken: Int = 0
    var isDown: Bool = true
    var placeholder: String = "—"

    var body: some View {
        Text(cents.map { MoneyFormat.usd(cents: $0) } ?? placeholder)
            .font(font)
            .foregroundStyle(color)
            .contentTransition(.numericText())
            .brandMoneyFlash(token: flashToken, isDown: isDown)
            .animation(.easeOut(duration: 0.2), value: cents)
            .accessibilityLabel(cents.map { MoneyFormat.usd(cents: $0) } ?? "Price unavailable")
    }
}

/// Compact load-more footer with brand spinner (not full-screen).
struct BrandLoadMoreFooter: View {
    var isLoading: Bool
    var error: String?
    var onRetry: (() -> Void)?

    var body: some View {
        VStack(spacing: 10) {
            if isLoading {
                ProgressView()
                    .tint(BrandTheme.accent)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 8)
                    .accessibilityLabel("Loading more")
            } else if let error {
                Text(error)
                    .font(.caption)
                    .foregroundStyle(BrandTheme.destructive)
                    .multilineTextAlignment(.center)
                if let onRetry {
                    Button("Try again") {
                        BrandHaptics.light()
                        onRetry()
                    }
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(BrandTheme.goldBright)
                    .frame(minHeight: 44)
                }
            }
        }
        .frame(maxWidth: .infinity)
        .listRowBackground(BrandTheme.navyElevated)
    }
}

/// Inline error card for embedded sections (Home strips) — not full-screen empty.
struct BrandInlineErrorCard: View {
    let message: String
    var retryTitle: String = "Try again"
    var onRetry: (() -> Void)?

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Label {
                Text(message)
                    .font(.subheadline)
                    .foregroundStyle(BrandTheme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            } icon: {
                Image(systemName: "wifi.exclamationmark")
                    .foregroundStyle(BrandTheme.warning)
            }
            if let onRetry {
                Button {
                    BrandHaptics.light()
                    onRetry()
                } label: {
                    Text(retryTitle)
                }
                .brandGhostButton()
                .frame(minHeight: 44)
            }
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .brandCard(padding: 0)
        .accessibilityElement(children: .combine)
    }
}

/// Always-visible catalog search pill (Jobs Browse / Marketplace).
/// iOS 26 system `.searchable(prompt:)` renders a blank capsule on List
/// surfaces until focus; Messages empty-state still shows “Search inbox”.
/// This matches that Messages prompt: magnifying glass + readable placeholder.
struct BrandCatalogSearchField: View {
    @Binding var text: String
    var prompt: String
    var enabled: Bool = true
    var accessibilityID: String?
    var onSubmit: () -> Void = {}

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass")
                .font(.body.weight(.medium))
                .foregroundStyle(BrandTheme.textSecondary)
                .accessibilityHidden(true)
            TextField(
                prompt,
                text: $text,
                prompt: Text(prompt).foregroundStyle(BrandTheme.textSecondary)
            )
            .textFieldStyle(.plain)
            .font(.body)
            .foregroundStyle(BrandTheme.textPrimary)
            .disabled(!enabled)
            .submitLabel(.search)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .onSubmit(onSubmit)
            .accessibilityLabel(prompt)
        }
        .padding(.horizontal, 14)
        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .fill(BrandTheme.surfaceRaised)
        )
        .opacity(enabled ? 1 : 0.55)
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .background(BrandTheme.navy)
        .modifier(OptionalAccessibilityIdentifier(accessibilityID))
    }
}

private struct OptionalAccessibilityIdentifier: ViewModifier {
    var id: String?
    init(_ id: String?) { self.id = id }

    @ViewBuilder
    func body(content: Content) -> some View {
        if let id, !id.isEmpty {
            content.accessibilityIdentifier(id)
        } else {
            content
        }
    }
}

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
                Button(actionTitle) {
                    BrandHaptics.medium()
                    action()
                }
                .brandGoldProminentButton()
                .frame(minHeight: 44)
            }
            if let secondaryActionTitle, let secondaryAction {
                Button(secondaryActionTitle) {
                    BrandHaptics.selection()
                    secondaryAction()
                }
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
                        .contentTransition(.numericText())
                        .animation(.easeOut(duration: 0.15), value: cents)
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
