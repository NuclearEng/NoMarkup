import SwiftUI

/// Product home — reverse-auction first, materials-first (not scaffold marketing).
struct HomeView: View {
    @EnvironmentObject private var auth: AuthViewModel
    @Environment(\.selectedRootTab) private var selectedRootTab
    /// A11Y.3: solid hairline divider under Reduce Transparency.
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency

    @State private var healthOK: Bool?
    @State private var isChecking = false
    @State private var jobs: [JobSummary] = []
    @State private var listings: [ListingSummary] = []
    @State private var jobTotal: Int?
    @State private var listingTotal: Int?
    @State private var catalogError: String?
    @State private var isLoadingCatalog = false
    @State private var showPostJob = false
    /// When true, post sheet opens with Instant match preselected (§13).
    @State private var postJobPreferInstant = false
    @State private var showSellItem = false

    private var signedInLabel: String? {
        guard auth.isAuthenticated else { return nil }
        if auth.isScaffoldSession {
            return "Browsing offline"
        }
        let email = auth.email.trimmingCharacters(in: .whitespacesAndNewlines)
        if !email.isEmpty {
            return email
        }
        return "Signed in"
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 32) {
                    heroSection
                    if jobTotal != nil || listingTotal != nil {
                        statsStrip
                    }
                    // Featured open floor (auction_type=live) — not sealed reverse.
                    liveFloorFeatureSection
                    howItWorksSection
                    liveAuctionsSection
                    marketplaceStrip
                    gatewayFooter
                }
                .padding(.horizontal, 20)
                .padding(.top, 4)
                .padding(.bottom, 40)
                // DES.12 / DES.20 — cap column width on iPad so hero + cards stay readable.
                .brandReadableWidth()
            }
            .brandScreenBackground()
            .navigationTitle("NoMarkup")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.large)
            #endif
            .toolbarBackground(BrandTheme.navy, for: .navigationBar)
            .navigationDestination(for: JobSummary.self) { job in
                JobDetailView(jobID: job.id, preview: job)
            }
            .navigationDestination(for: ListingSummary.self) { listing in
                ListingDetailView(listingID: listing.id, preview: listing)
            }
            .task { await refreshHome() }
            .refreshable { await refreshHome() }
            .sheet(isPresented: $showPostJob, onDismiss: {
                postJobPreferInstant = false
            }) {
                NavigationStack {
                    PostJobView(preferInstantMatch: postJobPreferInstant)
                        .toolbar {
                            ToolbarItem(placement: .cancellationAction) {
                                Button("Close") { showPostJob = false }
                                    .frame(minHeight: 44)
                            }
                        }
                }
                .environmentObject(auth)
                .tint(BrandTheme.accent)
            }
            .sheet(isPresented: $showSellItem) {
                NavigationStack {
                    CreateListingView()
                        .toolbar {
                            ToolbarItem(placement: .cancellationAction) {
                                Button("Close") { showSellItem = false }
                                    .frame(minHeight: 44)
                            }
                        }
                }
                .environmentObject(auth)
                .tint(BrandTheme.accent)
            }
        }
    }

    // MARK: - Hero

    private var heroSection: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Brand tile — same champagne M↓ artwork as the SpringBoard App Icon.
            HStack(alignment: .center, spacing: 14) {
                NoMarkupIcon(showWordmark: false, size: 64)
                    .accessibilityHidden(true)

                VStack(alignment: .leading, spacing: 6) {
                    Text("REVERSE-AUCTION SERVICE MARKETPLACE")
                        .font(.caption2.weight(.bold).monospaced())
                        .tracking(1.2)
                        .foregroundStyle(BrandTheme.gold)
                        .lineLimit(2)
                        .fixedSize(horizontal: false, vertical: true)

                    (
                        Text("No")
                            .foregroundColor(BrandTheme.textPrimary)
                        + Text("Markup")
                            .foregroundColor(BrandTheme.goldBright)
                    )
                    .font(.title2.weight(.heavy))
                    .accessibilityLabel("NoMarkup")
                }

                Spacer(minLength: 0)
            }
            .padding(.bottom, 18)

            // Showcase hero: "The Market Sets The Price. Not The Markup."
            (
                Text("The Market Sets\nThe Price.\n")
                    .foregroundColor(BrandTheme.textPrimary)
                + Text("Not The Markup.")
                    .foregroundColor(BrandTheme.goldBright)
                    .italic()
            )
            .font(.largeTitle.weight(.bold))
            .lineSpacing(2)
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityAddTraits(.isHeader)
            .accessibilityLabel("The Market Sets The Price. Not The Markup.")
            .padding(.bottom, 12)

            Text(
                "Customers post home-service jobs. Qualified providers compete in real-time reverse auctions. Prices drop to fair market rates. Everyone wins except the middleman."
            )
            .font(.body)
            .foregroundStyle(BrandTheme.textSecondary)
            .lineSpacing(3)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.bottom, 20)

            if let signedInLabel {
                HStack(spacing: 8) {
                    Circle()
                        .fill(auth.isScaffoldSession ? BrandTheme.warning : BrandTheme.success)
                        .frame(width: 7, height: 7)
                    Text(signedInLabel)
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(BrandTheme.textSecondary)
                        .lineLimit(1)
                }
                .padding(.bottom, 22)
            }

            // Single primary + two quiet actions — no muddy button stack
            VStack(spacing: 12) {
                Button {
                    selectedRootTab?.wrappedValue = .jobs
                } label: {
                    Text("Browse open jobs")
                }
                .brandPrimaryButton()
                .accessibilityHint("Opens the Jobs tab")

                // §13 Instant — emergency funnel (create job + instant-match).
                Button {
                    postJobPreferInstant = true
                    showPostJob = true
                } label: {
                    Label("I need help now", systemImage: "bolt.fill")
                        .frame(maxWidth: .infinity)
                }
                .brandGhostButton()
                .accessibilityHint("Opens emergency Instant match: post a job and notify available providers")

                HStack(spacing: 10) {
                    Button {
                        selectedRootTab?.wrappedValue = .marketplace
                    } label: {
                        Text("Shop goods")
                    }
                    .brandGhostButton()
                    .accessibilityHint("Opens the Marketplace tab")

                    Button {
                        postJobPreferInstant = false
                        showPostJob = true
                    } label: {
                        Text("Post a job")
                    }
                    .brandGhostButton()
                    .accessibilityHint("Opens the native post-a-job form")
                }
            }

            // Tertiary text links — never a third filled CTA color
            HStack(spacing: 20) {
                Button {
                    showSellItem = true
                } label: {
                    Text("Sell an item")
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(BrandTheme.textSecondary)
                        .underline(false)
                }
                .buttonStyle(.plain)
                .frame(minHeight: 44)

                Spacer(minLength: 0)
            }
            .padding(.top, 8)
        }
        .brandCard(padding: 24, heroGradient: true, elevated: true)
    }

    // MARK: - Stats

    private var statsStrip: some View {
        HStack(spacing: 0) {
            statCell(
                value: jobTotal.map { Self.compactCount($0) } ?? "—",
                label: "Open jobs"
            )
            divider
            statCell(
                value: listingTotal.map { Self.compactCount($0) } ?? "—",
                label: "Listings"
            )
            divider
            statCell(
                value: healthOK == true ? "Live" : (healthOK == false ? "Down" : "…"),
                label: "API",
                valueColor: healthOK == true
                    ? BrandTheme.success
                    : (healthOK == false ? BrandTheme.destructive : BrandTheme.textSecondary)
            )
        }
        .brandCard(padding: 0, elevated: false)
    }

    private var divider: some View {
        Rectangle()
            .fill(reduceTransparency ? BrandTheme.hairlineOpaque : BrandTheme.hairline)
            .frame(width: 1)
            .padding(.vertical, 14)
    }

    private func statCell(value: String, label: String, valueColor: Color = BrandTheme.textPrimary) -> some View {
        VStack(spacing: 4) {
            Text(value)
                .font(.title3.weight(.semibold))
                .foregroundStyle(valueColor)
                .monospacedDigit()
            Text(label)
                .font(.caption.weight(.medium))
                .foregroundStyle(BrandTheme.textSecondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 16)
        .accessibilityElement(children: .combine)
    }

    // MARK: - How it works

    private var howItWorksSection: some View {
        VStack(alignment: .leading, spacing: 16) {
            sectionEyebrow("How it works")

            VStack(spacing: 0) {
                HowItWorksRow(
                    index: 1,
                    title: "Post a job",
                    detail: "Describe the work and set a starting budget.",
                    isLast: false
                )
                HowItWorksRow(
                    index: 2,
                    title: "Providers bid down",
                    detail: "Licensed locals compete — the price falls.",
                    isLast: false
                )
                HowItWorksRow(
                    index: 3,
                    title: "Award the best offer",
                    detail: "Choose the lowest trusted bid and get it done.",
                    isLast: true
                )
            }
            .brandCard(padding: 4, elevated: false)
        }
    }

    // MARK: - Featured live floor (auction_type == live)

    /// True open-floor reverse auctions (not sealed). Pinned so dogfood is unmissable.
    private var liveFloorJobs: [JobSummary] {
        jobs.filter {
            ($0.auctionType ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased() == "live"
        }
    }

    @ViewBuilder
    private var liveFloorFeatureSection: some View {
        if !liveFloorJobs.isEmpty {
            VStack(alignment: .leading, spacing: 14) {
                HStack(alignment: .firstTextBaseline) {
                    sectionEyebrow("Live open floor")
                    Spacer(minLength: 8)
                    TimelineView(.periodic(from: .now, by: 1)) { _ in
                        HStack(spacing: 6) {
                            Circle()
                                .fill(BrandTheme.success)
                                .frame(width: 8, height: 8)
                            Text("LIVE")
                                .font(.caption.weight(.black))
                                .foregroundStyle(BrandTheme.success)
                        }
                    }
                    .accessibilityLabel("Live open-floor reverse auctions")
                }

                Text("Providers bid down in public. Lowest trusted bid leads.")
                    .font(.subheadline)
                    .foregroundStyle(BrandTheme.textSecondary)

                ForEach(liveFloorJobs.prefix(3)) { job in
                    NavigationLink(value: job) {
                        LiveFloorFeatureCard(job: job)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    // MARK: - Live auctions

    private var liveAuctionsSection: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .firstTextBaseline) {
                sectionEyebrow("Open reverse auctions")
                Spacer(minLength: 8)
                if let jobTotal, jobTotal > 0 {
                    Text("\(jobTotal) open")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(BrandTheme.goldBright)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 4)
                        .background(Capsule().fill(BrandTheme.gold.opacity(0.12)))
                }
            }

            if isLoadingCatalog && jobs.isEmpty {
                ProgressView("Loading…")
                    .tint(BrandTheme.accent)
                    .foregroundStyle(BrandTheme.textSecondary)
                    .frame(maxWidth: .infinity)
                    .frame(minHeight: 100)
                    .brandCard(padding: 24)
            } else if let catalogError, jobs.isEmpty {
                VStack(alignment: .leading, spacing: 14) {
                    Text(catalogError)
                        .font(.subheadline)
                        .foregroundStyle(BrandTheme.textSecondary)
                    Button("Try again") {
                        Task { await refreshHome() }
                    }
                    .brandGhostButton()
                }
                .brandCard(padding: 20)
            } else if jobs.isEmpty {
                VStack(alignment: .leading, spacing: 12) {
                    Text("No open jobs right now")
                        .font(.headline)
                        .foregroundStyle(BrandTheme.textPrimary)
                    Text("New reverse auctions appear here as customers list work.")
                        .font(.subheadline)
                        .foregroundStyle(BrandTheme.textSecondary)
                    Button {
                        showPostJob = true
                    } label: {
                        Text("Post a job")
                    }
                    .brandPrimaryButton()
                }
                .brandCard(padding: 20)
            } else {
                VStack(spacing: 12) {
                    ForEach(jobs) { job in
                        NavigationLink(value: job) {
                            HomeJobCard(job: job)
                        }
                        .buttonStyle(.plain)
                    }
                }

                Button {
                    selectedRootTab?.wrappedValue = .jobs
                } label: {
                    HStack(spacing: 6) {
                        Text("View all jobs")
                            .font(.body.weight(.semibold))
                        Image(systemName: "arrow.right")
                            .font(.caption.weight(.semibold))
                    }
                    .foregroundStyle(BrandTheme.goldBright)
                    .frame(maxWidth: .infinity)
                    .frame(minHeight: 48)
                }
                .buttonStyle(.plain)
            }
        }
    }

    // MARK: - Marketplace

    private var marketplaceStrip: some View {
        VStack(alignment: .leading, spacing: 16) {
            sectionEyebrow("Local goods · forward auction")

            Text("Buyers bid up · pickup within 25 mi")
                .font(.subheadline)
                .foregroundStyle(BrandTheme.textSecondary)
                .padding(.top, -8)

            if listings.isEmpty && !isLoadingCatalog {
                Button {
                    selectedRootTab?.wrappedValue = .marketplace
                } label: {
                    HStack {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Browse marketplace")
                                .font(.body.weight(.semibold))
                                .foregroundStyle(BrandTheme.textPrimary)
                            Text("Physical goods with escrow")
                                .font(.subheadline)
                                .foregroundStyle(BrandTheme.textSecondary)
                        }
                        Spacer()
                        Image(systemName: "chevron.right")
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(BrandTheme.textSecondary.opacity(0.6))
                    }
                    .padding(18)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .background {
                    RoundedRectangle(cornerRadius: 18, style: .continuous)
                        .fill(BrandTheme.gradientCardFace)
                }
                .brandHairlineBorder(cornerRadius: 18)
            } else {
                VStack(spacing: 10) {
                    ForEach(listings.prefix(3)) { listing in
                        NavigationLink(value: listing) {
                            HomeListingCard(listing: listing)
                        }
                        .buttonStyle(.plain)
                    }
                }

                Button {
                    selectedRootTab?.wrappedValue = .marketplace
                } label: {
                    HStack(spacing: 6) {
                        Text("Browse marketplace")
                            .font(.body.weight(.semibold))
                        Image(systemName: "arrow.right")
                            .font(.caption.weight(.semibold))
                    }
                    .foregroundStyle(BrandTheme.goldBright)
                    .frame(maxWidth: .infinity)
                    .frame(minHeight: 48)
                }
                .buttonStyle(.plain)
            }

            Button {
                showSellItem = true
            } label: {
                Text("Sell an item")
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(BrandTheme.textSecondary)
            }
            .buttonStyle(.plain)
            .frame(minHeight: 40)
            .accessibilityHint("Opens the native sell form")
        }
    }

    // MARK: - Gateway

    private var gatewayFooter: some View {
        HStack(spacing: 8) {
            if isChecking {
                ProgressView()
                    .controlSize(.mini)
                    .tint(BrandTheme.textSecondary)
            } else if let healthOK {
                Circle()
                    .fill(healthOK ? BrandTheme.success : BrandTheme.destructive)
                    .frame(width: 6, height: 6)
            }

            Text(healthOK == true ? "Connected" : (healthOK == false ? "Offline" : "Checking…"))
                .font(.caption.weight(.medium))
                .foregroundStyle(BrandTheme.textSecondary.opacity(0.75))

            Text("·")
                .font(.caption)
                .foregroundStyle(BrandTheme.textSecondary.opacity(0.4))

            Text(AppConfig.apiBaseHostDisplay)
                .font(.caption2.weight(.medium).monospaced())
                .foregroundStyle(BrandTheme.textSecondary.opacity(0.55))
                .lineLimit(1)

            Spacer()

            Button {
                Task { await refreshHome() }
            } label: {
                Text("Refresh")
                    .font(.caption.weight(.medium))
                    .foregroundStyle(BrandTheme.textSecondary.opacity(0.75))
                    .frame(minHeight: 40)
            }
            .buttonStyle(.plain)
            .disabled(isChecking)
        }
        .padding(.horizontal, 4)
        .padding(.top, 8)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(
            "\(healthOK == true ? "Connected" : (healthOK == false ? "Offline" : "Checking")), API \(AppConfig.apiBaseHostDisplay)"
        )
    }

    // MARK: - Chrome helpers

    private func sectionEyebrow(_ title: String) -> some View {
        Text(title.uppercased())
            .font(.caption.weight(.bold))
            .tracking(1.2)
            .foregroundStyle(BrandTheme.gold.opacity(0.75))
            .accessibilityAddTraits(.isHeader)
    }

    private static func compactCount(_ n: Int) -> String {
        if n >= 1000 {
            return String(format: "%.1fk", Double(n) / 1000.0)
        }
        return "\(n)"
    }

    private static func isLiveAuctionStatus(_ raw: String?) -> Bool {
        switch (raw ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
        case "active", "open", "bidding", "live", "published":
            return true
        default:
            return false
        }
    }

    private static func endsSooner(lhs: String?, rhs: String?) -> Bool {
        let left = lhs.flatMap { CatalogDateFormat.parseISO($0) } ?? .distantFuture
        let right = rhs.flatMap { CatalogDateFormat.parseISO($0) } ?? .distantFuture
        return left < right
    }

    private static func endsSooner(lhsDate: Date?, rhsDate: Date?) -> Bool {
        (lhsDate ?? .distantFuture) < (rhsDate ?? .distantFuture)
    }

    // MARK: - Data

    @MainActor
    private func refreshHome() async {
        isChecking = true
        isLoadingCatalog = jobs.isEmpty && listings.isEmpty
        catalogError = nil
        defer {
            isChecking = false
            isLoadingCatalog = false
        }

        async let healthTask: Void = checkHealth()
        async let catalogTask: Void = loadCatalog()
        _ = await (healthTask, catalogTask)
    }

    @MainActor
    private func checkHealth() async {
        do {
            healthOK = try await APIClient.shared.health()
        } catch {
            healthOK = false
        }
    }

    @MainActor
    private func loadCatalog() async {
        do {
            async let jobsResponse = APIClient.shared.fetchJobs(page: 1, pageSize: 8)
            async let listingsResponse = APIClient.shared.fetchListings(page: 1, pageSize: 3)
            let jobsResult = try await jobsResponse
            let listingsResult = try await listingsResponse
            // Open auctions only — pin auction_type=live first so the open floor is on top.
            let liveJobs = jobsResult.jobs
                .filter { Self.isLiveAuctionStatus($0.status) }
                .sorted { a, b in
                    let aLive = (a.auctionType ?? "").lowercased() == "live"
                    let bLive = (b.auctionType ?? "").lowercased() == "live"
                    if aLive != bLive { return aLive && !bLive }
                    return Self.endsSooner(lhs: a.auctionEndsAt, rhs: b.auctionEndsAt)
                }
            let liveListings = listingsResult.listings
                .filter { Self.isLiveAuctionStatus($0.status) }
                .sorted { Self.endsSooner(lhsDate: $0.auctionEndsAt, rhsDate: $1.auctionEndsAt) }
            jobs = Array(liveJobs.prefix(8))
            listings = Array(liveListings.prefix(3))
            // Prefer live counts for the strip; fall back to page totals when API omits status filter.
            jobTotal = liveJobs.isEmpty
                ? (jobsResult.pagination?.resolvedTotal ?? jobsResult.jobs.count)
                : liveJobs.count
            listingTotal = liveListings.isEmpty
                ? (listingsResult.pagination?.resolvedTotal ?? listingsResult.listings.count)
                : liveListings.count
            catalogError = nil
        } catch {
            if jobs.isEmpty {
                catalogError = "Couldn’t load live auctions. Pull to refresh."
            }
        }
    }
}

// MARK: - How-it-works row (vertical timeline — not three cramped mini-cards)

private struct HowItWorksRow: View {
    let index: Int
    let title: String
    let detail: String
    let isLast: Bool
    @ScaledMetric(relativeTo: .body) private var stepSize: CGFloat = 28

    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            VStack(spacing: 0) {
                ZStack {
                    Circle()
                        .fill(BrandTheme.gold.opacity(0.15))
                        .frame(width: stepSize, height: stepSize)
                    Text("\(index)")
                        .font(.caption.weight(.bold))
                        .foregroundStyle(BrandTheme.goldBright)
                }
                if !isLast {
                    Rectangle()
                        .fill(BrandTheme.gold.opacity(0.18))
                        .frame(width: 1.5)
                        .frame(maxHeight: .infinity)
                }
            }
            .frame(width: stepSize)

            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.body.weight(.semibold))
                    .foregroundStyle(BrandTheme.textPrimary)
                Text(detail)
                    .font(.subheadline)
                    .foregroundStyle(BrandTheme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(.bottom, isLast ? 14 : 18)
            .padding(.top, 4)

            Spacer(minLength: 0)
        }
        .padding(.horizontal, 16)
        .padding(.top, index == 1 ? 14 : 0)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Step \(index): \(title). \(detail)")
    }
}

// MARK: - Featured open-floor card (auction_type = live)

private struct LiveFloorFeatureCard: View {
    let job: JobSummary

    private var heroPrice: String {
        if let start = job.startingBidCents, start > 0 {
            return MoneyFormat.usd(cents: start)
        }
        return job.displayPrice ?? "—"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 8) {
                TimelineView(.periodic(from: .now, by: 0.8)) { context in
                    let pulse = Int(context.date.timeIntervalSince1970 * 2) % 2 == 0
                    HStack(spacing: 6) {
                        Circle()
                            .fill(BrandTheme.success.opacity(pulse ? 1 : 0.35))
                            .frame(width: 9, height: 9)
                        Text("LIVE · OPEN FLOOR")
                            .font(.caption.weight(.black))
                            .tracking(0.6)
                            .foregroundStyle(BrandTheme.success)
                    }
                }
                Spacer(minLength: 8)
                if let ends = job.auctionEndsAt {
                    TimelineView(.periodic(from: .now, by: 1)) { context in
                        let label = CatalogDateFormat.countdownLabel(iso: ends, now: context.date) ?? "—"
                        Text(label)
                            .font(.caption.weight(.bold).monospacedDigit())
                            .foregroundStyle(BrandTheme.navy)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 5)
                            .background(Capsule().fill(BrandTheme.goldBright))
                    }
                }
            }

            Text(job.displayTitle)
                .font(.title3.weight(.bold))
                .foregroundStyle(BrandTheme.textPrimary)
                .lineLimit(2)

            HStack(alignment: .lastTextBaseline, spacing: 8) {
                Text(heroPrice)
                    .font(.largeTitle.weight(.bold).monospacedDigit())
                    .minimumScaleFactor(0.5)
                    .lineLimit(2)
                    .foregroundStyle(BrandTheme.goldBright)
                Text("budget · bid down")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(BrandTheme.textSecondary)
                    .textCase(.uppercase)
            }

            HStack(spacing: 12) {
                Label("\(job.bidCount ?? 0) bids", systemImage: "arrow.down.circle.fill")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(BrandTheme.textPrimary)
                if let location = job.locationLabel {
                    Label(location, systemImage: "mappin")
                        .font(.subheadline)
                        .foregroundStyle(BrandTheme.textSecondary)
                        .lineLimit(1)
                }
                Spacer(minLength: 0)
                Text("Enter floor")
                    .font(.subheadline.weight(.bold))
                    .foregroundStyle(BrandTheme.goldBright)
                Image(systemName: "chevron.right")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(BrandTheme.goldBright)
            }
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background {
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .fill(BrandTheme.gradientCardFace)
        }
        .overlay(
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .strokeBorder(BrandTheme.success.opacity(0.55), lineWidth: 1.5)
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Live open-floor reverse auction \(job.displayTitle), budget \(heroPrice)")
        .accessibilityHint("Opens the live reverse auction floor")
    }
}

// MARK: - Job auction card

private struct HomeJobCard: View {
    let job: JobSummary

    /// Matches JobDetailView: sealed when type is `"sealed"` or missing (default reverse is sealed).
    private var isSealedAuction: Bool {
        let t = (job.auctionType ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return t == "sealed" || t.isEmpty
    }

    private var isLiveAuctionType: Bool {
        let t = (job.auctionType ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return t == "live"
    }

    /// Open reverse auction that has not yet hit `auctionEndsAt`.
    private var isAuctionActive: Bool {
        let status = (job.status ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        switch status {
        case "active", "open", "bidding", "live", "published":
            break
        default:
            return false
        }
        if let ends = job.auctionEndsAt,
           let date = CatalogDateFormat.parseISO(ends),
           date < Date() {
            return false
        }
        return true
    }

    /// Showcase badge copy — same labels as JobDetailView.reverseAuctionBadge.
    private var auctionBadgeLabel: String {
        let active = isAuctionActive
        if active, isLiveAuctionType {
            return "LIVE · reverse auction"
        }
        if active, isSealedAuction {
            return "LIVE · sealed reverse"
        }
        if isSealedAuction {
            return "Sealed reverse auction"
        }
        return active ? "LIVE · reverse auction" : "Reverse auction"
    }

    /// Starting bid is the reverse-auction budget ceiling when no offer is accepted yet.
    private var budgetAmount: String? {
        if let offer = job.offerAcceptedCents {
            return MoneyFormat.usd(cents: offer)
        }
        if let start = job.startingBidCents, start > 0 {
            return MoneyFormat.usd(cents: start)
        }
        return job.displayPrice
    }

    private var budgetCaption: String {
        if job.offerAcceptedCents != nil { return "Accepted" }
        if let start = job.startingBidCents, start > 0 { return "Budget" }
        return "Price"
    }

    private var bidCountValue: Int {
        job.bidCount ?? 0
    }

    /// H1.4 home parity — typical reverse-auction band from starting bid when present.
    private var marketBandCaption: String? {
        guard let start = job.startingBidCents, start > 0,
              let estimate = MarketRangeMath.reverseAuctionBand(startingBidCents: start)
        else { return nil }
        return "\(estimate.source.titleLabel): \(estimate.rangeCaption)"
    }

    var body: some View {
        HStack(alignment: .top, spacing: 0) {
            // Leading gold rail
            RoundedRectangle(cornerRadius: 2, style: .continuous)
                .fill(
                    LinearGradient(
                        colors: [BrandTheme.goldBright, BrandTheme.gold.opacity(0.5)],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                )
                .frame(width: 3)
                .padding(.vertical, 4)

            VStack(alignment: .leading, spacing: 10) {
                HStack(alignment: .top, spacing: 12) {
                    VStack(alignment: .leading, spacing: 8) {
                        reverseAuctionBadge

                        Text(job.displayTitle)
                            .font(.body.weight(.semibold))
                            .foregroundStyle(BrandTheme.textPrimary)
                            .lineLimit(2)
                            .multilineTextAlignment(.leading)

                        HStack(spacing: 8) {
                            Text("Reverse · bid down")
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(BrandTheme.goldBright)
                            if let category = job.categoryName, !category.isEmpty {
                                Text(category)
                                    .font(.caption.weight(.medium))
                                    .foregroundStyle(BrandTheme.textSecondary)
                                    .lineLimit(1)
                            }
                        }
                    }

                    Spacer(minLength: 8)

                    if let price = budgetAmount {
                        VStack(alignment: .trailing, spacing: 2) {
                            Text(price)
                                .font(.headline.weight(.bold).monospacedDigit())
                                .minimumScaleFactor(0.7)
                                .lineLimit(2)
                                .foregroundStyle(BrandTheme.goldBright)
                            Text(budgetCaption.uppercased())
                                .font(.caption2.weight(.bold))
                                .tracking(0.6)
                                .foregroundStyle(BrandTheme.textSecondary.opacity(0.9))
                        }
                        .accessibilityElement(children: .combine)
                        .accessibilityLabel("\(budgetCaption) \(price)")
                    }
                }

                // Market band (H1.4 home parity) — budget ceiling → typical reverse-auction room.
                if let marketBandCaption {
                    Text(marketBandCaption)
                        .font(.caption.weight(.medium))
                        .foregroundStyle(BrandTheme.textSecondary)
                        .lineLimit(1)
                        .accessibilityLabel(marketBandCaption)
                }

                // Intelligence row: location · bids · live countdown
                HStack(spacing: 10) {
                    if let location = job.locationLabel {
                        Label(location, systemImage: "mappin")
                            .font(.caption)
                            .foregroundStyle(BrandTheme.textSecondary)
                            .lineLimit(1)
                            .labelStyle(.titleAndIcon)
                    }

                    if bidCountValue > 0 {
                        bidCountChip(count: bidCountValue)
                    }

                    Spacer(minLength: 0)

                    liveCountdownChip(iso: job.auctionEndsAt)
                }
            }
            .padding(.leading, 14)
            .padding(.vertical, 16)
            .padding(.trailing, 16)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background {
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(BrandTheme.gradientCardFace)
        }
        .brandHairlineBorder(cornerRadius: 16)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityLabel(accessibilitySummary)
    }

    private var reverseAuctionBadge: some View {
        HStack(spacing: 6) {
            if isAuctionActive {
                Circle()
                    .fill(BrandTheme.success)
                    .frame(width: 7, height: 7)
                    .accessibilityHidden(true)
            }
            Text(auctionBadgeLabel)
                .font(.caption2.weight(.bold))
                .tracking(0.4)
                .foregroundStyle(BrandTheme.goldBright)
                .lineLimit(1)
                .minimumScaleFactor(0.85)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 5)
        .overlay(
            Capsule()
                .strokeBorder(BrandTheme.gold, lineWidth: 1.5)
        )
        .accessibilityLabel(auctionBadgeLabel)
    }

    @ViewBuilder
    private func bidCountChip(count: Int) -> some View {
        Label(String(localized: "\(count) bids"), systemImage: "arrow.down.circle")
            .font(.caption.weight(.semibold))
            .foregroundStyle(BrandTheme.textPrimary)
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(BrandTheme.navyElevated, in: Capsule())
            .overlay(
                Capsule()
                    .strokeBorder(BrandTheme.gold.opacity(0.25), lineWidth: 1)
            )
            .accessibilityLabel("\(count) bids")
    }

    @ViewBuilder
    private func liveCountdownChip(iso: String?) -> some View {
        if let iso, !iso.isEmpty, CatalogDateFormat.parseISO(iso) != nil {
            TimelineView(.periodic(from: .now, by: 1)) { context in
                let label = CatalogDateFormat.countdownLabel(iso: iso, now: context.date) ?? "—"
                Text(label)
                    .font(.caption.weight(.bold))
                    .foregroundStyle(
                        label == "Ended" ? BrandTheme.textSecondary : BrandTheme.navy
                    )
                    .padding(.horizontal, 10)
                    .padding(.vertical, 5)
                    .background(
                        Capsule().fill(
                            label == "Ended"
                                ? BrandTheme.surfaceRaised
                                : BrandTheme.goldBright
                        )
                    )
                    .accessibilityLabel("Auction \(label)")
            }
        }
    }

    private var accessibilitySummary: String {
        var parts: [String] = [auctionBadgeLabel, job.displayTitle]
        if let price = budgetAmount {
            parts.append("\(budgetCaption) \(price)")
        }
        if let marketBandCaption {
            parts.append(marketBandCaption)
        }
        if bidCountValue > 0 {
            parts.append("\(bidCountValue) bids")
        }
        if let location = job.locationLabel {
            parts.append(location)
        }
        return parts.joined(separator: ", ")
    }
}

// MARK: - Listing preview

private struct HomeListingCard: View {
    let listing: ListingSummary
    /// A11Y.2 — scale thumbnail frame with Dynamic Type.
    @ScaledMetric(relativeTo: .body) private var thumbSize: CGFloat = 48

    private var isAuctionLive: Bool {
        let status = (listing.status ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        switch status {
        case "active", "open", "bidding", "live", "published":
            break
        default:
            return false
        }
        if let ends = listing.auctionEndsAt, ends < Date() {
            return false
        }
        return true
    }

    private var bidCountValue: Int {
        listing.bidCount ?? 0
    }

    var body: some View {
        HStack(alignment: .center, spacing: 14) {
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(BrandTheme.surfaceRaised)
                .frame(width: thumbSize, height: thumbSize)
                .overlay {
                    Image(systemName: "bag.fill")
                        .font(.body.weight(.medium))
                        .foregroundStyle(BrandTheme.gold.opacity(0.7))
                }

            VStack(alignment: .leading, spacing: 6) {
                forwardAuctionBadge

                Text(listing.displayTitle)
                    .font(.body.weight(.semibold))
                    .foregroundStyle(BrandTheme.textPrimary)
                    .lineLimit(2)

                HStack(spacing: 8) {
                    if let location = listing.locationLabel {
                        Text(location)
                            .font(.caption)
                            .foregroundStyle(BrandTheme.textSecondary)
                            .lineLimit(1)
                    }
                    if bidCountValue > 0 {
                        Text(String(localized: "\(bidCountValue) bids"))
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(BrandTheme.goldBright)
                    }
                    if listing.auctionEndsAt != nil {
                        listingCountdownChip
                    }
                }
            }

            Spacer(minLength: 8)

            VStack(alignment: .trailing, spacing: 2) {
                Text(listing.displayPrice)
                    .font(.headline.weight(.bold).monospacedDigit())
                    .minimumScaleFactor(0.7)
                    .lineLimit(2)
                    .foregroundStyle(BrandTheme.goldBright)
                Text(listing.priceCaption.uppercased())
                    .font(.caption2.weight(.bold))
                    .tracking(0.6)
                    .foregroundStyle(BrandTheme.textSecondary.opacity(0.9))
            }

            Image(systemName: "chevron.right")
                .font(.caption.weight(.semibold))
                .foregroundStyle(BrandTheme.textSecondary.opacity(0.45))
        }
        .padding(14)
        .background {
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(BrandTheme.gradientCardFace)
        }
        .brandHairlineBorder(cornerRadius: 16)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }

    private var forwardAuctionBadge: some View {
        HStack(spacing: 6) {
            if isAuctionLive {
                Circle()
                    .fill(BrandTheme.success)
                    .frame(width: 7, height: 7)
                    .accessibilityHidden(true)
            }
            Text(isAuctionLive ? "LIVE · forward auction" : "Forward auction · goods")
                .font(.caption2.weight(.bold))
                .tracking(0.4)
                .foregroundStyle(BrandTheme.goldBright)
                .lineLimit(1)
                .minimumScaleFactor(0.85)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 5)
        .overlay(
            Capsule()
                .strokeBorder(BrandTheme.gold, lineWidth: 1.5)
        )
        .accessibilityLabel(isAuctionLive ? "Live forward auction" : "Forward auction, goods")
    }

    @ViewBuilder
    private var listingCountdownChip: some View {
        if let ends = listing.auctionEndsAt {
            TimelineView(.periodic(from: .now, by: 1)) { context in
                let label = CatalogDateFormat.countdownLabel(until: ends, now: context.date)
                Text(label)
                    .font(.caption.weight(.bold))
                    .foregroundStyle(
                        label == "Ended" ? BrandTheme.textSecondary : BrandTheme.navy
                    )
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(
                        Capsule().fill(
                            label == "Ended"
                                ? BrandTheme.surfaceRaised
                                : BrandTheme.goldBright
                        )
                    )
                    .accessibilityLabel("Auction \(label)")
            }
        }
    }
}

#Preview {
    HomeView()
        .environmentObject(AuthViewModel())
}
