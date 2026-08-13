import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

/// Product home — reverse-auction first, materials-first (not scaffold marketing).
struct HomeView: View {
    @EnvironmentObject private var auth: AuthViewModel
    @Environment(\.selectedRootTab) private var selectedRootTab
    /// A11Y.3: solid hairline divider under Reduce Transparency.
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency

    /// iPhone 17e-class (~844pt tall, ~390pt wide). Pro Max (~932pt) already
    /// clears Market Desk + LIVE NOW / GOODS LIVE / GATEWAY above the floating tab.
    private var usesCompactHomeChrome: Bool {
        #if canImport(UIKit)
        UIScreen.main.bounds.height < 880
        #else
        false
        #endif
    }

    @State private var healthOK: Bool?
    @State private var isChecking = false
    @State private var jobs: [JobSummary] = []
    /// Unfiltered first-page jobs for the market-desk ticker (priced / bid chips).
    /// `jobs` is live-status only so the open-floor sections stay honest.
    @State private var deskJobs: [JobSummary] = []
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
                VStack(alignment: .leading, spacing: usesCompactHomeChrome ? 14 : 24) {
                    heroSection
                    marketDeskStrip
                    if jobTotal != nil || listingTotal != nil {
                        statsStrip
                    }
                    // Featured open floor (auction_type=live) — not sealed reverse.
                    liveFloorFeatureSection
                    liveAuctionsSection
                    marketplaceStrip
                    howItWorksSection
                    gatewayFooter
                    revisionFooter
                }
                .padding(.horizontal, 20)
                .padding(.top, 8)
                .padding(.bottom, usesCompactHomeChrome ? 16 : 24)
                // DES.12 / DES.20 — cap column width on iPad so hero + cards stay readable.
                .brandReadableWidth()
            }
            .brandScreenBackground()
            // Floating tab capsule (~80pt) is not in the scroll safe area on iOS 26.
            // Compact phones also tighten hero spacing so desk + stats clear it on first paint.
            .brandTabBarClearance()
            .navigationTitle("NoMarkup")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.large)
            #endif
            .brandNavigationBarChrome()
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
            // Brand + copy only — `home.hero` must not flatten the CTA identifiers.
            VStack(alignment: .leading, spacing: 0) {
                // Brand tile — champagne M↓ = SpringBoard icon (icon gold / product navy desk).
                HStack(alignment: .center, spacing: 14) {
                    NoMarkupIcon(showWordmark: false, size: usesCompactHomeChrome ? 48 : 56)
                        .accessibilityHidden(true)

                    VStack(alignment: .leading, spacing: 5) {
                        HStack(spacing: 8) {
                            RoundedRectangle(cornerRadius: 1, style: .continuous)
                                .fill(BrandTheme.gold)
                                .frame(width: 14, height: 1.5)
                            Text("REVERSE AUCTION")
                                .font(.caption2.weight(.heavy).monospaced())
                                .tracking(1.4)
                                .foregroundStyle(BrandTheme.gold)
                                .lineLimit(1)
                        }
                        (
                            Text("No")
                                .foregroundColor(BrandTheme.textPrimary)
                            + Text("Markup")
                                .foregroundColor(BrandTheme.goldBright)
                        )
                        .font(.title3.weight(.heavy))
                        .accessibilityLabel("NoMarkup")
                    }

                    Spacer(minLength: 0)

                    if let signedInLabel {
                        HStack(spacing: 6) {
                            Circle()
                                .fill(auth.isScaffoldSession ? BrandTheme.warning : BrandTheme.success)
                                .frame(width: 6, height: 6)
                            Text(auth.isScaffoldSession ? "Offline" : "Live")
                                .font(.caption2.weight(.semibold).monospaced())
                                .foregroundStyle(BrandTheme.textSecondary)
                                .lineLimit(1)
                        }
                        .padding(.horizontal, 8)
                        .padding(.vertical, 5)
                        .background(Capsule().fill(BrandTheme.surfaceRaised))
                        .accessibilityLabel(signedInLabel)
                    }
                }
                .padding(.bottom, usesCompactHomeChrome ? 10 : 16)

                // Showcase hero — serif energy via system rounded weight + italic gold line.
                (
                    Text("The Market Sets\nThe Price.\n")
                        .foregroundColor(BrandTheme.textPrimary)
                    + Text("Not The Markup.")
                        .foregroundColor(BrandTheme.goldBright)
                        .italic()
                )
                .font(.system(usesCompactHomeChrome ? .title2 : .title, design: .serif).weight(.regular))
                .lineSpacing(usesCompactHomeChrome ? 1 : 3)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
                .accessibilityLabel("The Market Sets The Price. Not The Markup.")
                .padding(.bottom, usesCompactHomeChrome ? 6 : 10)

                Text(
                    "Providers compete in real-time reverse auctions. Prices fall to fair market rates — not the middleman."
                )
                .font(usesCompactHomeChrome ? .footnote : .subheadline)
                .foregroundStyle(BrandTheme.textSecondary)
                .lineSpacing(usesCompactHomeChrome ? 2 : 3)
                .fixedSize(horizontal: false, vertical: true)
            }
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("home.hero")

            // CTA stack is a sibling of `home.hero` so XCUITest can see `home.browseJobs`.
            VStack(spacing: usesCompactHomeChrome ? 8 : 10) {
                Button {
                    BrandHaptics.medium()
                    selectedRootTab?.wrappedValue = .jobs
                } label: {
                    Text("Browse open jobs")
                }
                .brandPrimaryButton()
                .accessibilityHint("Opens the Jobs tab")
                .accessibilityIdentifier("home.browseJobs")

                Button {
                    BrandHaptics.selection()
                    postJobPreferInstant = true
                    showPostJob = true
                } label: {
                    Label("I need help now", systemImage: "bolt.fill")
                        .frame(maxWidth: .infinity)
                }
                .brandGhostButton()
                .accessibilityHint("Opens Instant match: post a job and notify available providers")
                .accessibilityLabel("I need help now. Instant match often prices 1.5 to 2 times a typical auction.")
                .accessibilityIdentifier("home.instantMatch")

                HStack(spacing: 10) {
                    Button {
                        BrandHaptics.selection()
                        selectedRootTab?.wrappedValue = .marketplace
                    } label: {
                        Text("Shop goods")
                    }
                    .brandGhostButton()
                    .accessibilityHint("Opens the Marketplace tab")
                    .accessibilityIdentifier("home.shopGoods")

                    Button {
                        BrandHaptics.selection()
                        postJobPreferInstant = false
                        showPostJob = true
                    } label: {
                        Text("Post a job")
                    }
                    .brandGhostButton()
                    .accessibilityHint("Opens the native post-a-job form")
                    .accessibilityIdentifier("home.postJob")
                }

                Button {
                    BrandHaptics.selection()
                    showSellItem = true
                } label: {
                    Text("Sell an item")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(BrandTheme.goldBright.opacity(0.9))
                        .frame(maxWidth: .infinity)
                        .frame(minHeight: 40)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Sell an item")
                .accessibilityHint("Opens the native sell form")
                .accessibilityIdentifier("home.sellItem")
            }
            .padding(.top, usesCompactHomeChrome ? 12 : 18)
        }
        .brandCard(padding: usesCompactHomeChrome ? 14 : 20, heroGradient: true, elevated: true)
        .accessibilityElement(children: .contain)
    }

    // MARK: - Market desk (Bloomberg ambient + Robinhood tick)

    /// Institutional strip under hero — mono prices, green↓ savings energy.
    private var marketDeskStrip: some View {
        MarketTickerView(
            openJobs: jobTotal,
            liveListings: listingTotal,
            samplePrices: tickerItems
        )
        .accessibilityIdentifier("home.marketDesk")
    }

    /// Build ticker chips — short label + price + bid count. Skip noise locations.
    /// Source is `deskJobs` (unfiltered catalog slice) so a closed-first page
    /// still prints last prices instead of "Waiting for open floor…".
    private var tickerItems: [MarketTickerView.TickerItem] {
        var items: [MarketTickerView.TickerItem] = []
        for job in deskJobs.prefix(6) {
            let cat = job.categoryName?
                .trimmingCharacters(in: .whitespacesAndNewlines)
            let label: String = {
                if let cat, !cat.isEmpty { return cat }
                return job.displayTitle
            }()
            let price = job.displayPrice ?? "—"
            guard price != "—" || (job.bidCount ?? 0) > 0 else { continue }
            items.append(
                .init(
                    id: "job-\(job.id)",
                    label: label,
                    location: nil,
                    priceLabel: price,
                    deltaPercent: nil,
                    bidCount: job.bidCount
                )
            )
        }
        for listing in listings.prefix(3) {
            let price = listing.displayPrice
            guard !price.isEmpty, price != "—" else { continue }
            items.append(
                .init(
                    id: "list-\(listing.id)",
                    label: listing.displayTitle,
                    location: nil,
                    priceLabel: price,
                    deltaPercent: nil,
                    bidCount: listing.bidCount
                )
            )
        }
        return items
    }

    // MARK: - Stats

    private var statsStrip: some View {
        HStack(spacing: 0) {
            statCell(
                value: jobTotal.map { Self.compactCount($0) } ?? "—",
                label: "LIVE NOW"
            )
            divider
            statCell(
                value: listingTotal.map { Self.compactCount($0) } ?? "—",
                label: "GOODS LIVE"
            )
            divider
            statCell(
                value: healthOK == true ? "LIVE" : (healthOK == false ? "DOWN" : "…"),
                label: "GATEWAY",
                valueColor: healthOK == true
                    ? BrandTheme.success
                    : (healthOK == false ? BrandTheme.destructive : BrandTheme.textSecondary)
            )
        }
        .brandCard(padding: 0, elevated: false)
        .accessibilityIdentifier("home.stats")
    }

    private var divider: some View {
        Rectangle()
            .fill(reduceTransparency ? BrandTheme.hairlineOpaque : BrandTheme.hairline)
            .frame(width: 1)
            .padding(.vertical, 14)
    }

    private func statCell(value: String, label: String, valueColor: Color = BrandTheme.textPrimary) -> some View {
        VStack(spacing: 5) {
            Text(value)
                .font(.title3.weight(.bold).monospacedDigit())
                .foregroundStyle(valueColor)
                .contentTransition(.numericText())
            Text(label)
                .font(.caption2.weight(.heavy).monospaced())
                .tracking(0.8)
                .foregroundStyle(BrandTheme.textSecondary)
                .lineLimit(1)
                .minimumScaleFactor(0.75)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 16)
        .accessibilityElement(children: .combine)
    }

    // MARK: - How it works


    private var howItWorksSection: some View {
        VStack(alignment: .leading, spacing: 14) {
            sectionEyebrow("How NoMarkup works")

            Text("Three steps from posted to priced to scheduled.")
                .font(.subheadline)
                .foregroundStyle(BrandTheme.textSecondary)
                .padding(.top, -4)

            // Showcase-style horizontal steps on wide; stacked timeline on narrow.
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .top, spacing: 10) {
                    HowItWorksStepCard(index: 1, title: "Post", detail: "Category, scope, budget.")
                    HowItWorksStepCard(index: 2, title: "Compete", detail: "Providers bid down.")
                    HowItWorksStepCard(index: 3, title: "Award", detail: "Pick quality + price.")
                }
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
                    HStack(spacing: 6) {
                        LivePulseDot()
                        Text("LIVE")
                            .font(.caption.weight(.black).monospaced())
                            .tracking(0.6)
                            .foregroundStyle(BrandTheme.success)
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
                    Text(Self.compactCount(jobTotal))
                        .font(.caption2.weight(.heavy).monospacedDigit())
                        .tracking(0.6)
                        .foregroundStyle(BrandTheme.goldBright)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 5)
                        .background(Capsule().fill(BrandTheme.gold.opacity(0.12)))
                        .overlay(Capsule().strokeBorder(BrandTheme.gold.opacity(0.22), lineWidth: 1))
                }
            }

            if isLoadingCatalog && jobs.isEmpty {
                BrandCatalogSkeleton(rows: 3)
                    .accessibilityLabel("Loading open jobs")
            } else if let catalogError, jobs.isEmpty {
                BrandInlineErrorCard(message: catalogError) {
                    Task { await refreshHome() }
                }
            } else if jobs.isEmpty {
                VStack(alignment: .leading, spacing: 12) {
                    Text("No open jobs right now")
                        .font(.headline)
                        .foregroundStyle(BrandTheme.textPrimary)
                    Text("New reverse auctions appear here as customers list work. Post one and watch providers compete down.")
                        .font(.subheadline)
                        .foregroundStyle(BrandTheme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                    Button {
                        BrandHaptics.selection()
                        showPostJob = true
                    } label: {
                        Text("Post a job")
                    }
                    .brandPrimaryButton()
                }
                .padding(20)
                .brandCard(padding: 0)
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
                            .accessibilityHidden(true)
                    }
                    .foregroundStyle(BrandTheme.goldBright)
                    .frame(maxWidth: .infinity)
                    .frame(minHeight: 48)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("View all jobs")
                .accessibilityHint("Opens the Jobs tab")
                .accessibilityIdentifier("home.viewAllJobs")
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
                            .accessibilityHidden(true)
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
                            .accessibilityHidden(true)
                    }
                    .foregroundStyle(BrandTheme.goldBright)
                    .frame(maxWidth: .infinity)
                    .frame(minHeight: 48)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Browse marketplace")
                .accessibilityHint("Opens the Marketplace tab")
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
            .accessibilityLabel("Sell an item")
            .accessibilityHint("Opens the native sell form")
            .accessibilityIdentifier("home.sellItem.marketplace")
        }
    }

    // MARK: - Gateway

    private var gatewayFooter: some View {
        HStack(spacing: 8) {
            if isChecking {
                ProgressView()
                    .controlSize(.mini)
                    .tint(BrandTheme.textSecondary)
            } else {
                Circle()
                    .fill(
                        healthOK == true
                            ? BrandTheme.success
                            : (healthOK == false ? BrandTheme.destructive : BrandTheme.textSecondary.opacity(0.4))
                    )
                    .frame(width: 6, height: 6)
            }

            Text(healthOK == true ? "DESK LIVE" : (healthOK == false ? "DESK OFFLINE" : "…"))
                .font(.caption2.weight(.heavy).monospaced())
                .tracking(0.6)
                .foregroundStyle(BrandTheme.textSecondary)

            Text(AppConfig.apiBaseHostDisplay)
                .font(.caption2.monospaced())
                .foregroundStyle(
                    healthOK == false
                        ? BrandTheme.destructive.opacity(0.85)
                        : BrandTheme.textSecondary.opacity(0.5)
                )
                .lineLimit(1)
                .minimumScaleFactor(0.7)
                .textSelection(.enabled)

            Spacer(minLength: 8)

            Button {
                Task { await refreshHome() }
            } label: {
                Text("Refresh")
                    .font(.caption2.weight(.semibold).monospaced())
                    .foregroundStyle(BrandTheme.goldBright.opacity(0.85))
                    .frame(minHeight: 40)
            }
            .buttonStyle(.plain)
            .disabled(isChecking)
            .accessibilityIdentifier("home.deskRefresh")
        }
        .padding(.horizontal, 4)
        .padding(.top, 4)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("home.deskStatus")
        .accessibilityLabel(
            "\(healthOK == true ? "Connected" : (healthOK == false ? "Offline" : "Checking")), API \(AppConfig.apiBaseHostDisplay)"
        )
        .accessibilityHint(
            healthOK == false
                ? "Gateway unreachable at \(AppConfig.apiBaseHostDisplay). Ensure the Mac gateway is running and the phone is on the same Wi‑Fi."
                : "API host \(AppConfig.apiBaseHostDisplay)"
        )
    }

    /// Build + git revision at the bottom of Home (operator dogfood: prove which binary is installed).
    private var revisionFooter: some View {
        VStack(spacing: 4) {
            Text(AppConfig.revisionFooterLabel)
                .font(.caption2.weight(.semibold).monospaced())
                .foregroundStyle(BrandTheme.textSecondary)
                .textSelection(.enabled)
            Text(GitRevision.branch)
                .font(.caption2.monospaced())
                .foregroundStyle(BrandTheme.textSecondary.opacity(0.65))
                .lineLimit(1)
                .minimumScaleFactor(0.8)
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 12)
        .padding(.bottom, 4)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("home.revision")
        .accessibilityLabel("App version \(AppConfig.versionLabel), revision \(AppConfig.gitRevision), branch \(GitRevision.branch)")
    }

    // MARK: - Chrome helpers

    private func sectionEyebrow(_ title: String) -> some View {
        HStack(spacing: 8) {
            RoundedRectangle(cornerRadius: 1, style: .continuous)
                .fill(BrandTheme.gold)
                .frame(width: 16, height: 1.5)
            Text(title.uppercased())
                .font(.caption2.weight(.heavy).monospaced())
                .tracking(1.4)
                .foregroundStyle(BrandTheme.gold)
                .lineLimit(1)
            Spacer(minLength: 0)
        }
        .accessibilityAddTraits(.isHeader)
        .accessibilityLabel(title)
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

    /// Prefer pagination total when every row on the page is live so a pageSize
    /// of 20 cannot print as “20 GOODS” against a 49-lot floor.
    private static func liveOrPaginationTotal(
        liveCount: Int,
        pageCount: Int,
        pagination: PaginationMeta?
    ) -> Int {
        if liveCount == pageCount, let total = pagination?.resolvedTotal, total > liveCount {
            return total
        }
        return liveCount
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
        // WidgetKit snapshot: Home pull-to-refresh / first paint must write
        // App Group bids so the timeline is not empty after a live bid.
        if auth.isAuthenticated, !auth.isScaffoldSession {
            await WidgetBidSnapshotSync.refreshFromAPI()
        }
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
            async let jobsResponse = APIClient.shared.fetchJobs(
                page: 1,
                pageSize: 100,
                sort: "created_at",
                sortDir: "desc",
                status: "open"
            )
            async let listingsResponse = APIClient.shared.fetchListings(page: 1, pageSize: 100)
            let jobsResult = try await jobsResponse
            let listingsResult = try await listingsResponse
            // Ticker: priced jobs from the unfiltered page (live first). Do not
            // wait for live-status — closed rows still have last-print prices.
            deskJobs = jobsResult.jobs.sorted { a, b in
                let aLive = Self.isLiveAuctionStatus(a.status)
                let bLive = Self.isLiveAuctionStatus(b.status)
                if aLive != bLive { return aLive && !bLive }
                return Self.endsSooner(lhs: a.auctionEndsAt, rhs: b.auctionEndsAt)
            }
            // Open-floor cards only — pin auction_type=live first.
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
            // LIVE NOW: live-status on a mixed page; pagination total when the
            // fetched page is all live (pageSize must not become the stat).
            jobTotal = Self.liveOrPaginationTotal(
                liveCount: liveJobs.count,
                pageCount: jobsResult.jobs.count,
                pagination: jobsResult.pagination
            )
            // GOODS LIVE: public listings are already status=active. Bind the
            // desk to pagination.resolvedTotal (Marketplace "N of total"),
            // never the first-page length.
            if let total = listingsResult.pagination?.resolvedTotal, total > 0 {
                listingTotal = total
            } else {
                listingTotal = Self.liveOrPaginationTotal(
                    liveCount: liveListings.count,
                    pageCount: listingsResult.listings.count,
                    pagination: listingsResult.pagination
                )
            }
            catalogError = nil
        } catch {
            if jobs.isEmpty {
                catalogError = "Couldn’t load live auctions. Pull to refresh."
            }
        }
    }
}

// MARK: - How-it-works (showcase 01 / 02 / 03 rings + compact stack)

private struct HowItWorksStepCard: View {
    let index: Int
    let title: String
    let detail: String

    var body: some View {
        VStack(spacing: 10) {
            ZStack {
                Circle()
                    .strokeBorder(BrandTheme.gold.opacity(0.55), lineWidth: 1.5)
                    .frame(width: 40, height: 40)
                Text(String(format: "%02d", index))
                    .font(.caption.weight(.bold).monospacedDigit())
                    .foregroundStyle(BrandTheme.goldBright)
            }
            Text(title)
                .font(.subheadline.weight(.bold))
                .foregroundStyle(BrandTheme.textPrimary)
                .multilineTextAlignment(.center)
            Text(detail)
                .font(.caption)
                .foregroundStyle(BrandTheme.textSecondary)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 14)
        .padding(.horizontal, 8)
        .background {
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(BrandTheme.gradientCardFace)
        }
        .brandHairlineBorder(cornerRadius: 14)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Step \(index): \(title). \(detail)")
    }
}

private struct HowItWorksRow: View {
    let index: Int
    let title: String
    let detail: String
    let isLast: Bool
    @ScaledMetric(relativeTo: .body) private var stepSize: CGFloat = 32

    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            VStack(spacing: 0) {
                ZStack {
                    Circle()
                        .strokeBorder(BrandTheme.gold.opacity(0.5), lineWidth: 1.5)
                        .frame(width: stepSize, height: stepSize)
                    Text(String(format: "%02d", index))
                        .font(.caption2.weight(.bold).monospacedDigit())
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
                HStack(spacing: 6) {
                    LivePulseDot()
                    Text("LIVE · OPEN FLOOR")
                        .font(.caption.weight(.black).monospaced())
                        .tracking(0.6)
                        .foregroundStyle(BrandTheme.success)
                }
                Spacer(minLength: 8)
                if let ends = job.auctionEndsAt {
                    TimelineView(.periodic(from: .now, by: 1)) { context in
                        let label = CatalogDateFormat.countdownLabel(iso: ends, now: context.date) ?? "—"
                        Text(label)
                            .font(.caption.weight(.bold).monospacedDigit())
                            .foregroundStyle(BrandTheme.ctaLabelOnGold)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 5)
                            .background(Capsule().fill(BrandTheme.goldBrightFill))
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

    /// Full a11y / detail label — never shown in the dense status chip (too long; truncates).
    private var auctionBadgeAccessibilityLabel: String {
        let active = isAuctionActive
        if active, isLiveAuctionType {
            return "Live reverse auction"
        }
        if active, isSealedAuction {
            return "Live sealed reverse auction"
        }
        if isSealedAuction {
            return "Sealed reverse auction"
        }
        return active ? "Live reverse auction" : "Reverse auction"
    }

    /// Short on-chip label — section eyebrow already states reverse-auction format.
    private var auctionBadgeChipLabel: String {
        if isAuctionActive {
            return isSealedAuction && !isLiveAuctionType ? "SEALED" : "LIVE"
        }
        return isSealedAuction ? "SEALED" : "CLOSED"
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
        job.resolvedBidCount
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
                // Status + timer on one chrome row so title never shares width with long pills.
                HStack(alignment: .center, spacing: 8) {
                    reverseAuctionBadge
                    Spacer(minLength: 8)
                    liveCountdownChip(iso: job.auctionEndsAt)
                }

                HStack(alignment: .top, spacing: 12) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(job.displayTitle)
                            .font(.body.weight(.semibold))
                            .foregroundStyle(BrandTheme.textPrimary)
                            .lineLimit(2)
                            .multilineTextAlignment(.leading)
                            .fixedSize(horizontal: false, vertical: true)

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
                                .minimumScaleFactor(0.75)
                                .lineLimit(1)
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

                // Meta only — no timer chip (lives on chrome row above).
                HStack(spacing: 10) {
                    if let location = job.locationLabel {
                        Label(location, systemImage: "mappin")
                            .font(.caption)
                            .foregroundStyle(BrandTheme.textSecondary)
                            .lineLimit(1)
                            .labelStyle(.titleAndIcon)
                    }

                    if bidCountValue > 0 {
                        Text(String(localized: "\(bidCountValue) bids"))
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(BrandTheme.goldBright)
                    }

                    Spacer(minLength: 0)
                }
            }
            .padding(.leading, 14)
            .padding(.vertical, 16)
            .padding(.trailing, 16)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background { BrandGlassCardBackground(cornerRadius: 16) }
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityLabel(accessibilitySummary)
    }

    private var reverseAuctionBadge: some View {
        BrandGlassStatusChip(
            title: auctionBadgeChipLabel,
            kind: isAuctionActive
                ? (isLiveAuctionType ? .live : .gold)
                : .muted,
            showPulse: isAuctionActive && isLiveAuctionType
        )
        .accessibilityLabel(auctionBadgeAccessibilityLabel)
    }

    @ViewBuilder
    private func liveCountdownChip(iso: String?) -> some View {
        if let iso, !iso.isEmpty, let ends = CatalogDateFormat.parseISO(iso) {
            TimelineView(.periodic(from: .now, by: 1)) { context in
                let label = CatalogDateFormat.countdownChipLabel(until: ends, now: context.date)
                let ended = label == "Ended"
                let urgent = CatalogDateFormat.isCountdownUrgent(until: ends, now: context.date)
                BrandGlassStatusChip(
                    title: label,
                    kind: ended ? .muted : (urgent ? .urgent : .gold)
                )
                .accessibilityLabel(
                    "Auction ends in \(CatalogDateFormat.countdownLabel(until: ends, now: context.date))"
                )
            }
        }
    }

    private var accessibilitySummary: String {
        var parts: [String] = [auctionBadgeAccessibilityLabel, job.displayTitle]
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
        listing.resolvedBidCount
    }

    var body: some View {
        HStack(alignment: .center, spacing: 14) {
            // Thumb — warm glass well, gold bag (no cool gray/purple cast).
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(.ultraThinMaterial)
                .overlay {
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .fill(BrandTheme.gold.opacity(0.08))
                }
                .overlay {
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .strokeBorder(BrandTheme.gold.opacity(0.16), lineWidth: 1)
                }
                .frame(width: thumbSize, height: thumbSize)
                .overlay {
                    Image(systemName: "bag.fill")
                        .font(.body.weight(.medium))
                        .foregroundStyle(BrandTheme.gold)
                        .symbolRenderingMode(.hierarchical)
                }

            VStack(alignment: .leading, spacing: 7) {
                HStack(alignment: .center, spacing: 6) {
                    BrandGlassStatusChip(
                        title: isAuctionLive ? "LIVE" : "GOODS",
                        kind: isAuctionLive ? .live : .muted,
                        showPulse: isAuctionLive
                    )
                    .accessibilityLabel(isAuctionLive ? "Live forward auction" : "Forward auction, goods")
                    listingCountdownChip
                    Spacer(minLength: 0)
                }

                Text(listing.displayTitle)
                    .font(.body.weight(.semibold))
                    .foregroundStyle(BrandTheme.textPrimary)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)

                HStack(spacing: 8) {
                    if let location = listing.locationLabel {
                        Text(location)
                            .font(.caption)
                            .foregroundStyle(BrandTheme.textSecondary)
                            .lineLimit(1)
                    }
                    if bidCountValue > 0 {
                        Text(String(localized: "\(bidCountValue) bids"))
                            .font(.caption.weight(.semibold).monospacedDigit())
                            .foregroundStyle(BrandTheme.gold)
                    }
                }
            }

            Spacer(minLength: 8)

            VStack(alignment: .trailing, spacing: 2) {
                Text(listing.displayPrice)
                    .font(.headline.weight(.bold).monospacedDigit())
                    .minimumScaleFactor(0.75)
                    .lineLimit(1)
                    .foregroundStyle(BrandTheme.goldBright)
                Text(listing.priceCaption.uppercased())
                    .font(.caption2.weight(.bold).monospaced())
                    .tracking(0.6)
                    .foregroundStyle(BrandTheme.textSecondary.opacity(0.9))
            }

            Image(systemName: "chevron.right")
                .font(.caption.weight(.semibold))
                .foregroundStyle(BrandTheme.textSecondary.opacity(0.4))
        }
        .padding(14)
        .background { BrandGlassCardBackground(cornerRadius: 16) }
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder
    private var listingCountdownChip: some View {
        if let ends = listing.auctionEndsAt {
            TimelineView(.periodic(from: .now, by: 1)) { context in
                let label = CatalogDateFormat.countdownChipLabel(until: ends, now: context.date)
                let ended = label == "Ended"
                let urgent = CatalogDateFormat.isCountdownUrgent(until: ends, now: context.date)
                BrandGlassStatusChip(
                    title: label,
                    kind: ended ? .muted : (urgent ? .urgent : .gold)
                )
                .accessibilityLabel(
                    "Auction \(CatalogDateFormat.countdownLabel(until: ends, now: context.date))"
                )
            }
        }
    }
}

#Preview {
    HomeView()
        .environmentObject(AuthViewModel())
}
