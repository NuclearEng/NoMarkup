import SwiftUI

/// FR-11 market range bar — low / median / high visual + sample-size disclaimer.
///
/// Money is always formatted from **integer cents** via `MoneyFormat.usd`.
/// Soft-fail: parent should only embed this when `range.isUsable` (or pass a
/// non-nil usable `MarketRangeResponse`); otherwise the bar stays hidden.
struct MarketRangeBar: View {
    /// Audience copy differs for job post (customer) vs bid (provider).
    enum Audience: Sendable, Equatable {
        case customer
        case provider
    }

    let lowCents: Int64
    let medianCents: Int64
    let highCents: Int64
    let sampleSize: Int
    /// Wire `source` (`seeded` / `platform` / `blended`) for industry disclaimer.
    var source: String? = nil
    /// Optional service / category name for the caption.
    var serviceLabel: String? = nil
    var audience: Audience = .customer
    var compact: Bool = false

    /// Convenience from analytics market/range (or fair-price mapped response).
    init(
        range: MarketRangeResponse,
        serviceLabel: String? = nil,
        audience: Audience = .customer,
        compact: Bool = false
    ) {
        self.lowCents = range.lowCents ?? 0
        self.medianCents = range.displayMedianCents
        self.highCents = range.highCents ?? range.displayMedianCents
        self.sampleSize = range.sampleSize
        self.source = range.source
        self.serviceLabel = serviceLabel
        self.audience = audience
        self.compact = compact
    }

    init(
        lowCents: Int64,
        medianCents: Int64,
        highCents: Int64,
        sampleSize: Int,
        source: String? = nil,
        serviceLabel: String? = nil,
        audience: Audience = .customer,
        compact: Bool = false
    ) {
        self.lowCents = lowCents
        self.medianCents = medianCents
        self.highCents = highCents
        self.sampleSize = sampleSize
        self.source = source
        self.serviceLabel = serviceLabel
        self.audience = audience
        self.compact = compact
    }

    private var span: Int64 { max(0, highCents - lowCents) }

    /// 0…1 position of median along the bar.
    private var medianFraction: CGFloat {
        guard span > 0 else { return 0.5 }
        let raw = Double(medianCents - lowCents) / Double(span)
        return CGFloat(min(1, max(0, raw)))
    }

    private var isIndustrySeeded: Bool {
        let s = (source ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return s == "seeded" || s == "industry" || s == "industry_data"
    }

    private var lowLabel: String { MoneyFormat.usd(cents: lowCents) }
    private var medianLabel: String { MoneyFormat.usd(cents: medianCents) }
    private var highLabel: String { MoneyFormat.usd(cents: highCents) }

    var body: some View {
        VStack(alignment: .leading, spacing: compact ? 8 : 10) {
            headerRow
            rangeTrack
            priceLabels
            disclaimer
        }
        .padding(compact ? 12 : 14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(BrandTheme.surfaceRaised, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .strokeBorder(BrandTheme.gold.opacity(0.22), lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel(accessibilitySummary)
    }

    // MARK: - Subviews

    private var headerRow: some View {
        HStack(spacing: 8) {
            Image(systemName: "chart.bar.xaxis")
                .font(.caption.weight(.semibold))
                .foregroundStyle(BrandTheme.goldBright)
                .accessibilityHidden(true)
            Text("Market range")
                .font(.caption.weight(.semibold))
                .foregroundStyle(BrandTheme.textSecondary)
                .textCase(.uppercase)
            Spacer(minLength: 8)
            if sampleSize > 0, !isIndustrySeeded {
                Text(sampleSize == 1 ? "1 job" : "\(sampleSize) jobs")
                    .font(.caption2.weight(.medium).monospacedDigit())
                    .foregroundStyle(BrandTheme.textSecondary)
            } else if isIndustrySeeded {
                Text("Industry data")
                    .font(.caption2.weight(.medium))
                    .foregroundStyle(BrandTheme.warning)
            }
        }
    }

    private var rangeTrack: some View {
        GeometryReader { geo in
            let width = max(geo.size.width, 1)
            ZStack(alignment: .leading) {
                Capsule()
                    .fill(
                        LinearGradient(
                            colors: [
                                BrandTheme.success.opacity(0.85),
                                BrandTheme.warning.opacity(0.9),
                                BrandTheme.destructive.opacity(0.85),
                            ],
                            startPoint: .leading,
                            endPoint: .trailing
                        )
                    )
                    .frame(height: compact ? 6 : 8)

                // Median tick
                Capsule()
                    .fill(BrandTheme.textPrimary)
                    .frame(width: 2, height: compact ? 12 : 14)
                    .offset(x: medianFraction * width - 1)
                    .accessibilityHidden(true)
            }
            .frame(maxHeight: .infinity, alignment: .center)
        }
        .frame(height: compact ? 14 : 16)
    }

    private var priceLabels: some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Low")
                    .font(.caption2.weight(.medium))
                    .foregroundStyle(BrandTheme.textSecondary)
                    .textCase(.uppercase)
                Text(lowLabel)
                    .font(.subheadline.weight(.bold).monospacedDigit())
                    .foregroundStyle(BrandTheme.success)
            }
            Spacer(minLength: 4)
            VStack(alignment: .center, spacing: 2) {
                Text("Median")
                    .font(.caption2.weight(.medium))
                    .foregroundStyle(BrandTheme.textSecondary)
                    .textCase(.uppercase)
                Text(medianLabel)
                    .font(.subheadline.weight(.bold).monospacedDigit())
                    .foregroundStyle(BrandTheme.goldBright)
            }
            Spacer(minLength: 4)
            VStack(alignment: .trailing, spacing: 2) {
                Text("High")
                    .font(.caption2.weight(.medium))
                    .foregroundStyle(BrandTheme.textSecondary)
                    .textCase(.uppercase)
                Text(highLabel)
                    .font(.subheadline.weight(.bold).monospacedDigit())
                    .foregroundStyle(BrandTheme.destructive)
            }
        }
    }

    private var disclaimer: some View {
        Text(disclaimerText)
            .font(.caption2)
            .foregroundStyle(BrandTheme.textSecondary)
            .fixedSize(horizontal: false, vertical: true)
    }

    // MARK: - Copy (FR-11.2 / FR-11.3)

    private var servicePhrase: String {
        let raw = serviceLabel?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return raw.isEmpty ? "this service" : raw
    }

    private var disclaimerText: String {
        if isIndustrySeeded {
            return "Based on industry data. Actual bids may vary by location and scope."
        }
        switch audience {
        case .customer:
            if sampleSize > 0 {
                return "Based on \(sampleSize) completed job\(sampleSize == 1 ? "" : "s") in your area, \(servicePhrase) typically costs between \(lowLabel) and \(highLabel)."
            }
            return "\(servicePhrase.prefix(1).uppercased() + servicePhrase.dropFirst()) typically costs between \(lowLabel) and \(highLabel) in your area."
        case .provider:
            if sampleSize > 0 {
                return "Other providers in your area typically price \(servicePhrase) between \(lowLabel) and \(highLabel) (\(sampleSize) completed job\(sampleSize == 1 ? "" : "s"))."
            }
            return "Other providers in your area typically price \(servicePhrase) between \(lowLabel) and \(highLabel)."
        }
    }

    private var accessibilitySummary: String {
        "Market range low \(lowLabel), median \(medianLabel), high \(highLabel). \(disclaimerText)"
    }
}

// MARK: - Soft embed helper

extension MarketRangeBar {
    /// Returns the bar when `range` is usable; otherwise an empty view (FR-11 soft-hide).
    @ViewBuilder
    static func ifAvailable(
        _ range: MarketRangeResponse?,
        serviceLabel: String? = nil,
        audience: Audience = .customer,
        compact: Bool = false
    ) -> some View {
        if let range, range.isUsable {
            MarketRangeBar(
                range: range,
                serviceLabel: serviceLabel,
                audience: audience,
                compact: compact
            )
        }
    }
}

#Preview("Customer") {
    MarketRangeBar(
        lowCents: 8_000,
        medianCents: 12_500,
        highCents: 18_000,
        sampleSize: 24,
        source: "platform",
        serviceLabel: "Plumbing",
        audience: .customer
    )
    .padding()
    .brandScreenBackground()
    .preferredColorScheme(.dark)
}

#Preview("Seeded / industry") {
    MarketRangeBar(
        lowCents: 5_000,
        medianCents: 9_000,
        highCents: 14_000,
        sampleSize: 0,
        source: "seeded",
        serviceLabel: "Lawn care",
        audience: .customer,
        compact: true
    )
    .padding()
    .brandScreenBackground()
    .preferredColorScheme(.dark)
}

#Preview("Provider") {
    MarketRangeBar(
        lowCents: 15_000,
        medianCents: 22_000,
        highCents: 30_000,
        sampleSize: 11,
        source: "blended",
        serviceLabel: "HVAC repair",
        audience: .provider
    )
    .padding()
    .brandScreenBackground()
    .preferredColorScheme(.dark)
}
