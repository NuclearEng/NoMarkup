import SwiftUI

/// Ambient institutional market strip — Bloomberg desk energy, quiet power.
///
/// Chips are **always fully readable** (no mid-word marquee clip). Horizontal
/// scroll for density; under Reduce Motion the same static chips (no auto-scroll).
/// VoiceOver reads a single combined label once.
struct MarketTickerView: View {
    let openJobs: Int?
    let liveListings: Int?
    let samplePrices: [TickerItem]

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    struct TickerItem: Identifiable, Hashable, Sendable {
        let id: String
        /// Short category / title (≤14 chars preferred at call site).
        let label: String
        /// Optional city/zip — omitted from chip if empty to keep density clean.
        let location: String?
        let priceLabel: String
        let deltaPercent: Int?
        let bidCount: Int?
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            headerRow

            if samplePrices.isEmpty {
                Text("Waiting for open floor…")
                    .font(.caption.weight(.medium).monospaced())
                    .foregroundStyle(BrandTheme.textSecondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                chipStrip
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .background {
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(BrandTheme.gradientCardFace)
        }
        .brandHairlineBorder(cornerRadius: 14)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(accessibilitySummary)
    }

    private var headerRow: some View {
        HStack(spacing: 8) {
            LivePulseDot()
            Text("MARKET DESK")
                .font(.caption2.weight(.heavy).monospaced())
                .tracking(1.2)
                .foregroundStyle(BrandTheme.gold)
            Spacer(minLength: 8)
            HStack(spacing: 0) {
                if let openJobs {
                    Text("\(openJobs)")
                        .font(.caption2.weight(.bold).monospacedDigit())
                        .foregroundStyle(BrandTheme.textPrimary)
                    Text(" JOBS")
                        .font(.caption2.weight(.semibold).monospaced())
                        .foregroundStyle(BrandTheme.textSecondary)
                }
                if let liveListings {
                    Text("  ·  ")
                        .font(.caption2.monospaced())
                        .foregroundStyle(BrandTheme.textSecondary.opacity(0.5))
                    Text("\(liveListings)")
                        .font(.caption2.weight(.bold).monospacedDigit())
                        .foregroundStyle(BrandTheme.textPrimary)
                    Text(" GOODS")
                        .font(.caption2.weight(.semibold).monospaced())
                        .foregroundStyle(BrandTheme.textSecondary)
                }
            }
            .lineLimit(1)
        }
    }

    /// Horizontal scroll of discrete chips — never clips mid-glyph.
    private var chipStrip: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(samplePrices.prefix(8)) { item in
                    tickerChip(item)
                }
            }
            .padding(.vertical, 1)
        }
        .scrollBounceBehavior(.basedOnSize, axes: .horizontal)
    }

    private func tickerChip(_ item: TickerItem) -> some View {
        HStack(spacing: 6) {
            Text(Self.shortLabel(item.label))
                .font(.caption2.weight(.semibold).monospaced())
                .foregroundStyle(BrandTheme.textSecondary)
                .lineLimit(1)
                .fixedSize(horizontal: true, vertical: false)

            Text(item.priceLabel)
                .font(.caption.weight(.bold).monospacedDigit())
                .foregroundStyle(BrandTheme.goldBright)
                .lineLimit(1)
                .fixedSize(horizontal: true, vertical: false)

            if let pct = item.deltaPercent, pct != 0 {
                Text(pct < 0 ? "\(pct)%" : "+\(pct)%")
                    .font(.caption2.weight(.bold).monospacedDigit())
                    .foregroundStyle(pct < 0 ? BrandTheme.success : BrandTheme.destructive)
                    .lineLimit(1)
                    .fixedSize(horizontal: true, vertical: false)
            } else if let n = item.bidCount, n > 0 {
                Text("\(n)×")
                    .font(.caption2.weight(.semibold).monospacedDigit())
                    .foregroundStyle(BrandTheme.gold)
                    .lineLimit(1)
                    .fixedSize(horizontal: true, vertical: false)
                    .accessibilityLabel("\(n) bids")
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 7)
        .background {
            Capsule(style: .continuous)
                .fill(.ultraThinMaterial)
                .overlay {
                    Capsule(style: .continuous)
                        .fill(BrandTheme.gold.opacity(0.08))
                }
        }
        .overlay(
            Capsule(style: .continuous)
                .strokeBorder(BrandTheme.gold.opacity(0.20), lineWidth: 1)
        )
    }

    /// Title-case-safe short label — whole words preferred, hard cap 12.
    private static func shortLabel(_ raw: String) -> String {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return "JOB" }
        if trimmed.count <= 12 { return trimmed.uppercased() }
        // Prefer cut at space/hyphen before hard ellipsis.
        let limit = 11
        if let space = trimmed.prefix(limit).lastIndex(where: { $0 == " " || $0 == "-" }) {
            let word = trimmed[..<space]
            if word.count >= 4 { return (word + "…").uppercased() }
        }
        return (String(trimmed.prefix(limit)) + "…").uppercased()
    }

    private var accessibilitySummary: String {
        var parts = ["Market desk"]
        if let openJobs { parts.append("\(openJobs) open jobs") }
        if let liveListings { parts.append("\(liveListings) listings") }
        for item in samplePrices.prefix(6) {
            var s = "\(item.label) \(item.priceLabel)"
            if let n = item.bidCount, n > 0 { s += ", \(n) bids" }
            if let pct = item.deltaPercent, pct != 0 {
                s += pct < 0 ? ", \(pct) percent" : ", up \(pct) percent"
            }
            parts.append(s)
        }
        return parts.joined(separator: ". ")
    }
}

/// Green LIVE pulse — solid when Reduce Motion is on.
struct LivePulseDot: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        if reduceMotion {
            Circle()
                .fill(BrandTheme.success)
                .frame(width: 7, height: 7)
        } else {
            TimelineView(.periodic(from: .now, by: 0.8)) { context in
                let on = Int(context.date.timeIntervalSince1970 * 2) % 2 == 0
                Circle()
                    .fill(BrandTheme.success.opacity(on ? 1 : 0.35))
                    .frame(width: 7, height: 7)
            }
        }
    }
}
