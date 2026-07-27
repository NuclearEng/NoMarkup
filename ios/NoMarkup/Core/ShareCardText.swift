import Foundation

/// PRD §11 growth share cards — **text + URL only** (no rendered image assets).
///
/// All share payloads prefer a referral `share_url` / code when the user has one;
/// otherwise they fall back to the public marketing site.
enum ShareCardText {
    // MARK: - Savings

    /// Lifetime reverse-auction savings (Account → Savings).
    static func lifetimeSavings(
        savingsCents: Int64,
        referralCode: String? = nil,
        shareURLString: String? = nil
    ) -> SharePayload {
        let amount = MoneyFormat.usd(cents: max(0, savingsCents))
        var lines: [String] = [
            "I saved \(amount) on reverse-auction home services through NoMarkup — fair prices, verified providers, no markup.",
        ]
        appendReferralLine(to: &lines, code: referralCode)
        return SharePayload(
            subject: "I saved with NoMarkup",
            message: lines.joined(separator: "\n"),
            url: resolveURL(shareURLString: shareURLString, referralCode: referralCode)
        )
    }

    /// Single job savings row (when savings vs market median are positive).
    static func jobSavings(
        savingsCents: Int64,
        awardedCents: Int64? = nil,
        referralCode: String? = nil,
        shareURLString: String? = nil
    ) -> SharePayload {
        let amount = MoneyFormat.usd(cents: max(0, savingsCents))
        var lines: [String] = [
            "I just saved \(amount) on a home service job through NoMarkup.",
        ]
        if let awardedCents, awardedCents > 0 {
            lines.append("Awarded bid: \(MoneyFormat.usd(cents: awardedCents)).")
        }
        lines.append("Providers bid down — you keep the savings.")
        appendReferralLine(to: &lines, code: referralCode)
        return SharePayload(
            subject: "I saved with NoMarkup",
            message: lines.joined(separator: "\n"),
            url: resolveURL(shareURLString: shareURLString, referralCode: referralCode)
        )
    }

    // MARK: - Reviews

    /// Share a public review (rating + optional provider name / comment snippet).
    static func review(
        rating: Int?,
        revieweeName: String? = nil,
        comment: String? = nil,
        referralCode: String? = nil,
        shareURLString: String? = nil
    ) -> SharePayload {
        let stars: String = {
            guard let rating, rating > 0 else { return "a review" }
            let clamped = min(5, max(1, rating))
            return "\(clamped)/5 stars"
        }()
        let name = revieweeName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        var lines: [String] = []
        if name.isEmpty {
            lines.append("Left \(stars) on NoMarkup.")
        } else {
            lines.append("Rated \(name) \(stars) on NoMarkup.")
        }
        if let snippet = commentSnippet(comment) {
            lines.append("“\(snippet)”")
        }
        lines.append("Find verified providers at fair reverse-auction prices.")
        appendReferralLine(to: &lines, code: referralCode)
        return SharePayload(
            subject: "My NoMarkup review",
            message: lines.joined(separator: "\n"),
            url: resolveURL(shareURLString: shareURLString, referralCode: referralCode)
        )
    }

    // MARK: - Payload

    struct SharePayload: Equatable, Sendable {
        var subject: String
        var message: String
        var url: URL

        /// Combined body for share sheets that only accept a single string.
        var combinedText: String {
            "\(message)\n\(url.absoluteString)"
        }
    }

    // MARK: - Helpers

    private static func appendReferralLine(to lines: inout [String], code: String?) {
        let trimmed = code?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !trimmed.isEmpty else { return }
        lines.append("Sign up with my code \(trimmed) for referral credit.")
    }

    private static func commentSnippet(_ comment: String?, maxLen: Int = 120) -> String? {
        let t = comment?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !t.isEmpty else { return nil }
        if t.count <= maxLen { return t }
        let idx = t.index(t.startIndex, offsetBy: maxLen - 1)
        return String(t[..<idx]) + "…"
    }

    /// Prefer API share URL, else build `/register?ref=CODE`, else public site root.
    private static func resolveURL(shareURLString: String?, referralCode: String?) -> URL {
        if let raw = shareURLString?.trimmingCharacters(in: .whitespacesAndNewlines),
           !raw.isEmpty,
           let url = URL(string: raw)
        {
            return url
        }
        let code = referralCode?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !code.isEmpty {
            var components = URLComponents(
                url: AppConfig.publicWebBaseURL.appending(path: "register"),
                resolvingAgainstBaseURL: false
            )
            components?.queryItems = [URLQueryItem(name: "ref", value: code)]
            if let url = components?.url {
                return url
            }
        }
        return AppConfig.publicWebBaseURL
    }
}
