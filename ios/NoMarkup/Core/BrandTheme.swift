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
    static let textSecondary = Color(red: 0x8B / 255, green: 0x94 / 255, blue: 0x9E / 255)

    /// Success status — showcase `--green` `#22c55e`.
    static let success = Color(red: 0x22 / 255, green: 0xC5 / 255, blue: 0x5E / 255)

    /// Destructive / error status — showcase `--red` `#ef4444`.
    static let destructive = Color(red: 0xEF / 255, green: 0x44 / 255, blue: 0x44 / 255)

    /// Live / data accent — showcase `--teal` `#4ecdc4`.
    static let teal = Color(red: 0x4E / 255, green: 0xCD / 255, blue: 0xC4 / 255)

    // MARK: Colors — auction / marketplace semantics (web parity)

    /// Leading / active bid highlight — electric blue ≈ web `--bid-active` / `--trust-elite`
    /// (hsl 220 70% 60% dark shell) — `#4d8af0`.
    static let bidLeading = Color(red: 0x4D / 255, green: 0x8A / 255, blue: 0xF0 / 255)

    /// Alias of `bidLeading` for “live auction / your bid is active” chips.
    static let bidActive = bidLeading

    /// Winning bid / high-trust emerald — showcase green `#22c55e`.
    static let bidWinning = success

    /// Savings / positive delta (same emerald as winning for consistency).
    static let savings = bidWinning

    /// Warning / medium-trust amber ≈ web `--trust-medium` (hsl 38 80% 45%) — `#d9921a`.
    static let warning = Color(red: 0xD9 / 255, green: 0x92 / 255, blue: 0x1A / 255)

    /// Subtle blue border for incoming chat (not gold) — derived from `bidActive` at low opacity use sites.
    static let chatIncomingBorder = bidActive.opacity(0.35)

    /// **Label / icon on gold filled CTAs** — navy (`#07080b`), not pure black and not white.
    /// Gold `#c9a84c` needs dark text for WCAG contrast; muted-gold + black failures are a known miss.
    static let ctaLabelOnGold = navy

    /// Asset-catalog gold used for `.tint` / prominent CTAs (falls back to static gold).
    static var accent: Color {
        // AccentColor.colorset is the single source for interactive gold.
        Color("AccentColor", bundle: .main)
    }

    /// Section header / eyebrow label — muted gold for hierarchy without competing with CTAs.
    static let sectionHeader = gold.opacity(0.85)

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
    static let hairline = gold.opacity(0.16)

    /// Soft ambient shadow under premium cards (use sparingly).
    static let cardShadow = Color.black.opacity(0.45)

    // MARK: Global chrome (UIKit appearance)

    /// Call once at launch so TabView / NavigationStack / lists pick up navy + gold.
    /// Keeps system accessibility (Dynamic Type sizes, reduce motion) intact.
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
        UITabBar.appearance().scrollEdgeAppearance = tabAppearance
        UITabBar.appearance().tintColor = goldUI
        UITabBar.appearance().unselectedItemTintColor = secondaryUI

        // Navigation bar — opaque navy, light titles, gold bar buttons via tint.
        let navAppearance = UINavigationBarAppearance()
        navAppearance.configureWithOpaqueBackground()
        navAppearance.backgroundColor = navyUI
        navAppearance.shadowColor = UIColor.black.withAlphaComponent(0.35)
        navAppearance.titleTextAttributes = [.foregroundColor: primaryUI]
        navAppearance.largeTitleTextAttributes = [.foregroundColor: primaryUI]

        UINavigationBar.appearance().standardAppearance = navAppearance
        UINavigationBar.appearance().scrollEdgeAppearance = navAppearance
        UINavigationBar.appearance().compactAppearance = navAppearance
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
}

// MARK: - View modifiers

private struct BrandListBackgroundModifier: ViewModifier {
    func body(content: Content) -> some View {
        content
            .scrollContentBackground(.hidden)
            .background(BrandTheme.navy.ignoresSafeArea())
            // Row fill comes from UITableViewCell appearance + per-row `.listRowBackground` where needed.
            .listStyle(.insetGrouped)
    }
}

private struct BrandScreenBackgroundModifier: ViewModifier {
    func body(content: Content) -> some View {
        content
            .background(BrandTheme.navy.ignoresSafeArea())
            .environment(\.colorScheme, .dark)
    }
}

private struct BrandCardModifier: ViewModifier {
    var padding: CGFloat
    var useHeroGradient: Bool
    var elevated: Bool

    func body(content: Content) -> some View {
        content
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background {
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .fill(BrandTheme.gradientCardFace)
                    .overlay {
                        if useHeroGradient {
                            RoundedRectangle(cornerRadius: 18, style: .continuous)
                                .fill(BrandTheme.gradientHero)
                        }
                    }
                    .overlay(alignment: .top) {
                        // Specular top edge — reads as glass, not flat fill.
                        RoundedRectangle(cornerRadius: 18, style: .continuous)
                            .strokeBorder(
                                LinearGradient(
                                    colors: [
                                        Color.white.opacity(0.10),
                                        Color.white.opacity(0.02),
                                        Color.clear,
                                    ],
                                    startPoint: .top,
                                    endPoint: .bottom
                                ),
                                lineWidth: 1
                            )
                    }
            }
            .overlay(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .strokeBorder(BrandTheme.hairline, lineWidth: 1)
            )
            .shadow(
                color: elevated ? BrandTheme.cardShadow : .clear,
                radius: elevated ? 24 : 0,
                y: elevated ? 12 : 0
            )
    }
}

/// Ghost / secondary control — hairline gold border, no muddy filled gold.
struct BrandGhostButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(BrandTheme.goldBright)
            .frame(maxWidth: .infinity)
            .frame(minHeight: 48)
            .background(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(BrandTheme.surfaceRaised.opacity(configuration.isPressed ? 0.9 : 0.55))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .strokeBorder(BrandTheme.gold.opacity(configuration.isPressed ? 0.45 : 0.28), lineWidth: 1)
            )
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
            .animation(.easeOut(duration: 0.15), value: configuration.isPressed)
    }
}

/// Primary gold pill — bright fill, navy label, soft glow.
struct BrandPrimaryButtonStyle: ButtonStyle {
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
                                BrandTheme.gold.opacity(0.92),
                            ],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )
            )
            .overlay(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .strokeBorder(Color.white.opacity(0.18), lineWidth: 0.5)
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

    /// Muted gold section header styling for list headers.
    func brandSectionHeader() -> some View {
        self
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(BrandTheme.sectionHeader)
            .textCase(nil)
    }

    /// Gold filled CTA with **navy** label (contrast-safe on `#c9a84c` / AccentColor).
    /// Prefer `brandPrimaryButton()` for new surfaces; this remains for empty-state CTAs.
    func brandGoldProminentButton() -> some View {
        brandPrimaryButton()
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

    var body: some View {
        VStack(spacing: 20) {
            ZStack {
                Circle()
                    .strokeBorder(BrandTheme.gold.opacity(0.35), lineWidth: 2)
                    .frame(width: 88, height: 88)
                Circle()
                    .strokeBorder(BrandTheme.gold.opacity(0.18), lineWidth: 1)
                    .frame(width: 104, height: 104)
                Image(systemName: systemImage)
                    .font(.system(size: 32, weight: .medium))
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
                    .strokeBorder(BrandTheme.gold.opacity(0.35), lineWidth: 1)
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
