import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

// MARK: - Brand palette
//
// Aligned with web `globals.css` dark terminal tokens and the App Store seal:
// navy field `#070b14`, card `#0c0f18`, gold `#c9a84c` / bright `#d4af57`.
// Prefer these tokens over system gray list chrome so the native shell matches
// the luxury brand mark (not a plain iOS settings list).

enum BrandTheme {
    // MARK: Colors

    /// App icon / dark terminal background — `#070b14`.
    static let navy = Color(red: 0x07 / 255, green: 0x0B / 255, blue: 0x14 / 255)

    /// Elevated card / grouped list row surface — `#0c0f18`.
    static let navyElevated = Color(red: 0x0C / 255, green: 0x0F / 255, blue: 0x18 / 255)

    /// Brand gold (light token / primary CTA) — `#c9a84c`.
    /// Prefer `Color("AccentColor")` for interactive tint so the asset catalog stays authoritative.
    static let gold = Color(red: 0xC9 / 255, green: 0xA8 / 255, blue: 0x4C / 255)

    /// Brand gold bright (dark-mode / emphasis) — `#d4af57`.
    static let goldBright = Color(red: 0xD4 / 255, green: 0xAF / 255, blue: 0x57 / 255)

    /// Primary body text on navy — near-white for Dynamic Type / contrast.
    static let textPrimary = Color(red: 0xF2 / 255, green: 0xF4 / 255, blue: 0xF8 / 255)

    /// Secondary / muted copy on navy.
    static let textSecondary = Color(red: 0x9A / 255, green: 0xA3 / 255, blue: 0xB5 / 255)

    /// Success status (healthy API, signed-in).
    static let success = Color(red: 0x34 / 255, green: 0xC7 / 255, blue: 0x59 / 255)

    /// Destructive / error status.
    static let destructive = Color(red: 0xFF / 255, green: 0x45 / 255, blue: 0x3A / 255)

    /// Asset-catalog gold used for `.tint` / prominent CTAs (falls back to static gold).
    static var accent: Color {
        // AccentColor.colorset is the single source for interactive gold.
        Color("AccentColor", bundle: .main)
    }

    /// Section header / eyebrow label — muted gold for hierarchy without competing with CTAs.
    static let sectionHeader = gold.opacity(0.85)

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

    func body(content: Content) -> some View {
        content
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                BrandTheme.navyElevated,
                in: RoundedRectangle(cornerRadius: 14, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .strokeBorder(BrandTheme.gold.opacity(0.12), lineWidth: 1)
            )
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
    func brandCard(padding: CGFloat = 16) -> some View {
        modifier(BrandCardModifier(padding: padding))
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
                    .buttonStyle(.borderedProminent)
                    .tint(BrandTheme.accent)
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
