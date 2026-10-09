import SwiftUI

// MARK: - Showcase auction chrome (parity with qa/showcase auction-widget)

/// Initials for ladder avatars (showcase uses monogram squares, not photos).
enum ProviderInitials {
    static func from(displayName: String) -> String {
        let parts = displayName
            .split(whereSeparator: { $0.isWhitespace || $0 == "-" })
            .map(String.init)
            .filter { !$0.isEmpty }
        guard let first = parts.first, let f = first.first else { return "?" }
        if parts.count >= 2, let s = parts[1].first {
            return "\(f)\(s)".uppercased()
        }
        return String(f).uppercased()
    }
}

/// `.auction-widget__header` — LIVE pulse + mono label + countdown remaining.
struct ShowcaseAuctionHeader: View {
    let endsAtISO: String?
    var liveLabel: String = "LIVE AUCTION"

    var body: some View {
        HStack(spacing: 10) {
            HStack(spacing: 8) {
                LivePulseDot()
                Text(liveLabel)
                    .font(.caption2.weight(.heavy).monospaced())
                    .tracking(1.0)
                    .foregroundStyle(BrandTheme.success)
            }
            Spacer(minLength: 8)
            if let iso = endsAtISO, !iso.isEmpty, CatalogDateFormat.parseISO(iso) != nil {
                TimelineView(.periodic(from: .now, by: 1)) { context in
                    let label = CatalogDateFormat.countdownChipLabel(iso: iso, now: context.date) ?? "—"
                    let ended = label == "Ended"
                    Text(ended ? "Ended" : "\(label) remaining")
                        .font(.caption2.weight(.bold).monospacedDigit())
                        .foregroundStyle(ended ? BrandTheme.textSecondary : BrandTheme.textPrimary)
                }
            }
        }
        .accessibilityElement(children: .combine)
    }
}

/// `.auction-widget__job` — category breadcrumb, title, location.
struct ShowcaseAuctionJobMeta: View {
    let categoryLine: String?
    let title: String
    let locationLine: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let categoryLine, !categoryLine.isEmpty {
                Text(categoryLine.uppercased())
                    .font(.caption2.weight(.semibold).monospaced())
                    .tracking(0.8)
                    .foregroundStyle(BrandTheme.gold)
                    .lineLimit(1)
            }
            Text(title)
                .font(.title3.weight(.bold))
                .foregroundStyle(BrandTheme.textPrimary)
                .fixedSize(horizontal: false, vertical: true)
            if let locationLine, !locationLine.isEmpty {
                Text(locationLine)
                    .font(.caption)
                    .foregroundStyle(BrandTheme.textSecondary)
                    .lineLimit(2)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

/// `.auction-widget__market` — single gold-tint range bar.
struct ShowcaseMarketRangeStrip: View {
    let sourceLabel: String
    let rangeCaption: String
    var sampleNote: String? = nil

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(sourceLabel.uppercased())
                    .font(.caption2.weight(.heavy).monospaced())
                    .tracking(0.6)
                    .foregroundStyle(BrandTheme.textSecondary)
                if let sampleNote, !sampleNote.isEmpty {
                    Text(sampleNote)
                        .font(.caption2)
                        .foregroundStyle(BrandTheme.textSecondary.opacity(0.85))
                }
            }
            Spacer(minLength: 8)
            Text(rangeCaption)
                .font(.subheadline.weight(.bold).monospacedDigit())
                .foregroundStyle(BrandTheme.goldBright)
                .multilineTextAlignment(.trailing)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(BrandTheme.gold.opacity(0.08), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .strokeBorder(BrandTheme.gold.opacity(0.22), lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(sourceLabel) \(rangeCaption)")
    }
}

/// `.auction-widget__footer` — savings vs market / starting (honest labels, never invent industry avg).
struct ShowcaseSavingsFooter: View {
    let savingsLabel: String
    let savingsAmount: String
    var isPlaceholder: Bool = false

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Text(savingsLabel)
                .font(.caption.weight(.medium))
                .foregroundStyle(BrandTheme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 8)
            Text(savingsAmount)
                .font(.subheadline.weight(.bold).monospacedDigit())
                .foregroundStyle(isPlaceholder ? BrandTheme.textSecondary : BrandTheme.success)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(BrandTheme.surfaceRaised.opacity(0.65), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(savingsLabel) \(savingsAmount)")
    }
}

/// Showcase-style ladder row chrome (avatar · meta · green best amount).
struct ShowcaseBidRowChrome: View {
    let displayName: String
    let amountText: String
    let isLeading: Bool
    let trustText: String?
    let rating: Double?
    let badges: [String]
    /// Optional “−67% vs market” under leading only.
    let industrySavingsLine: String?

    private var initials: String { ProviderInitials.from(displayName: displayName) }

    private var avatarColor: Color {
        let palette: [Color] = [
            BrandTheme.bidLeading,
            BrandTheme.teal,
            BrandTheme.gold,
            BrandTheme.success,
            BrandTheme.warning,
        ]
        let idx = abs(displayName.hashValue) % palette.count
        return palette[idx]
    }

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            Text(initials)
                .font(.caption.weight(.bold).monospaced())
                .foregroundStyle(BrandTheme.navy)
                .frame(width: 36, height: 36)
                .background(avatarColor.opacity(0.9), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 3) {
                Text(displayName)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(BrandTheme.textPrimary)
                    .lineLimit(1)
                HStack(spacing: 6) {
                    if let rating, rating > 0 {
                        Text(String(format: "★ %.1f", rating))
                            .font(.caption2.weight(.medium).monospacedDigit())
                            .foregroundStyle(BrandTheme.gold)
                    }
                    if let trustText, trustText != "—" {
                        Text("Trust \(trustText)")
                            .font(.caption2.weight(.medium).monospacedDigit())
                            .foregroundStyle(BrandTheme.textSecondary)
                    }
                    ForEach(badges.prefix(2), id: \.self) { badge in
                        Text(badge)
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(BrandTheme.teal)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(BrandTheme.teal.opacity(0.12), in: Capsule())
                    }
                }
            }

            Spacer(minLength: 6)

            VStack(alignment: .trailing, spacing: 2) {
                Text(amountText)
                    .font(.body.weight(.bold).monospacedDigit())
                    .foregroundStyle(isLeading ? BrandTheme.success : BrandTheme.goldBright)
                if isLeading, let industrySavingsLine {
                    Text(industrySavingsLine)
                        .font(.caption2.weight(.bold).monospacedDigit())
                        .foregroundStyle(BrandTheme.success)
                } else if isLeading {
                    Text("Leading")
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(BrandTheme.success)
                }
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 10)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(isLeading ? BrandTheme.success.opacity(0.08) : Color.clear)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .strokeBorder(
                    isLeading ? BrandTheme.success.opacity(0.35) : BrandTheme.hairline,
                    lineWidth: isLeading ? 1.25 : 1
                )
        )
    }
}

/// Outer auction widget shell — navy card with hairline gold edge.
struct ShowcaseAuctionCard<Content: View>: View {
    @ViewBuilder var content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            content()
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background {
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(BrandTheme.gradientCardFace)
        }
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .strokeBorder(BrandTheme.gold.opacity(0.28), lineWidth: 1)
        )
    }
}
