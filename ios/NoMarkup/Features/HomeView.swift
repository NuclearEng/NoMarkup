import SwiftUI

/// Product home — reverse-auction first, materials-first (not scaffold marketing).
struct HomeView: View {
    @EnvironmentObject private var auth: AuthViewModel
    @Environment(\.selectedRootTab) private var selectedRootTab

    @State private var healthOK: Bool?
    @State private var isChecking = false
    @State private var jobs: [JobSummary] = []
    @State private var listings: [ListingSummary] = []
    @State private var jobTotal: Int?
    @State private var listingTotal: Int?
    @State private var catalogError: String?
    @State private var isLoadingCatalog = false
    @State private var showPostJobSafari = false
    @State private var showSellSafari = false

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
                    howItWorksSection
                    liveAuctionsSection
                    marketplaceStrip
                    gatewayFooter
                }
                .padding(.horizontal, 20)
                .padding(.top, 4)
                .padding(.bottom, 40)
            }
            .brandScreenBackground()
            .navigationTitle("NoMarkup")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.large)
            #endif
            .toolbarBackground(BrandTheme.navy, for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
            .navigationDestination(for: JobSummary.self) { job in
                JobDetailView(jobID: job.id, preview: job)
            }
            .navigationDestination(for: ListingSummary.self) { listing in
                ListingDetailView(listingID: listing.id, preview: listing)
            }
            .task { await refreshHome() }
            .refreshable { await refreshHome() }
            .sheet(isPresented: $showPostJobSafari) {
                NavigationStack {
                    LegalWebView(title: "Post a job", url: AppConfig.postJobURL)
                        .toolbar {
                            ToolbarItem(placement: .cancellationAction) {
                                Button("Done") { showPostJobSafari = false }
                                    .frame(minHeight: 44)
                            }
                        }
                }
            }
            .sheet(isPresented: $showSellSafari) {
                NavigationStack {
                    LegalWebView(title: "Sell an item", url: AppConfig.sellItemURL)
                        .toolbar {
                            ToolbarItem(placement: .cancellationAction) {
                                Button("Done") { showSellSafari = false }
                                    .frame(minHeight: 44)
                            }
                        }
                }
            }
        }
    }

    // MARK: - Hero

    private var heroSection: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Eyebrow — showcase section-label voice
            Text("REVERSE-AUCTION SERVICE MARKETPLACE")
                .font(.system(size: 11, weight: .bold, design: .monospaced))
                .tracking(1.6)
                .foregroundStyle(BrandTheme.gold)
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .background(
                    Capsule(style: .continuous)
                        .fill(BrandTheme.gold.opacity(0.12))
                )
                .overlay(
                    Capsule(style: .continuous)
                        .strokeBorder(BrandTheme.gold.opacity(0.28), lineWidth: 1)
                )
                .padding(.bottom, 18)

            // Showcase hero: "The Market Sets The Price. Not The Markup."
            (
                Text("The Market Sets\nThe Price.\n")
                    .foregroundColor(BrandTheme.textPrimary)
                + Text("Not The Markup.")
                    .foregroundColor(BrandTheme.goldBright)
                    .italic()
            )
            .font(.system(size: 32, weight: .bold, design: .serif))
            .lineSpacing(2)
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityAddTraits(.isHeader)
            .accessibilityLabel("The Market Sets The Price. Not The Markup.")
            .padding(.bottom, 12)

            Text(
                "Customers post home-service jobs. Qualified providers compete in real-time reverse auctions. Prices drop to fair market rates. Everyone wins except the middleman."
            )
            .font(.system(size: 16, weight: .regular))
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
                        .font(.system(size: 13, weight: .medium))
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

                HStack(spacing: 10) {
                    Button {
                        selectedRootTab?.wrappedValue = .marketplace
                    } label: {
                        Text("Shop goods")
                    }
                    .brandGhostButton()
                    .accessibilityHint("Opens the Marketplace tab")

                    Button {
                        showPostJobSafari = true
                    } label: {
                        Text("Post a job")
                    }
                    .brandGhostButton()
                    .accessibilityHint("Opens the post-a-job flow")
                }
            }

            // Tertiary text links — never a third filled CTA color
            HStack(spacing: 20) {
                Button {
                    showSellSafari = true
                } label: {
                    Text("Sell an item")
                        .font(.system(size: 14, weight: .medium))
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
            .fill(BrandTheme.hairline)
            .frame(width: 1)
            .padding(.vertical, 14)
    }

    private func statCell(value: String, label: String, valueColor: Color = BrandTheme.textPrimary) -> some View {
        VStack(spacing: 4) {
            Text(value)
                .font(.system(size: 20, weight: .semibold, design: .rounded))
                .foregroundStyle(valueColor)
                .monospacedDigit()
            Text(label)
                .font(.system(size: 11, weight: .medium))
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

    // MARK: - Live auctions

    private var liveAuctionsSection: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .firstTextBaseline) {
                sectionEyebrow("Live reverse auctions")
                Spacer(minLength: 8)
                if let jobTotal, jobTotal > 0 {
                    Text("\(jobTotal) open")
                        .font(.system(size: 12, weight: .semibold, design: .rounded))
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
                        showPostJobSafari = true
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
                            .font(.system(size: 15, weight: .semibold))
                        Image(systemName: "arrow.right")
                            .font(.system(size: 12, weight: .semibold))
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
                .font(.system(size: 14))
                .foregroundStyle(BrandTheme.textSecondary)
                .padding(.top, -8)

            if listings.isEmpty && !isLoadingCatalog {
                Button {
                    selectedRootTab?.wrappedValue = .marketplace
                } label: {
                    HStack {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Browse marketplace")
                                .font(.system(size: 16, weight: .semibold))
                                .foregroundStyle(BrandTheme.textPrimary)
                            Text("Physical goods with escrow")
                                .font(.system(size: 13))
                                .foregroundStyle(BrandTheme.textSecondary)
                        }
                        Spacer()
                        Image(systemName: "chevron.right")
                            .font(.system(size: 13, weight: .semibold))
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
                .overlay(
                    RoundedRectangle(cornerRadius: 18, style: .continuous)
                        .strokeBorder(BrandTheme.hairline, lineWidth: 1)
                )
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
                            .font(.system(size: 15, weight: .semibold))
                        Image(systemName: "arrow.right")
                            .font(.system(size: 12, weight: .semibold))
                    }
                    .foregroundStyle(BrandTheme.goldBright)
                    .frame(maxWidth: .infinity)
                    .frame(minHeight: 48)
                }
                .buttonStyle(.plain)
            }

            Button {
                showSellSafari = true
            } label: {
                Text("Sell an item")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(BrandTheme.textSecondary)
            }
            .buttonStyle(.plain)
            .frame(minHeight: 40)
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
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(BrandTheme.textSecondary.opacity(0.75))

            Spacer()

            Button {
                Task { await refreshHome() }
            } label: {
                Text("Refresh")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(BrandTheme.textSecondary.opacity(0.75))
                    .frame(minHeight: 40)
            }
            .buttonStyle(.plain)
            .disabled(isChecking)
        }
        .padding(.horizontal, 4)
        .padding(.top, 8)
    }

    // MARK: - Chrome helpers

    private func sectionEyebrow(_ title: String) -> some View {
        Text(title.uppercased())
            .font(.system(size: 11, weight: .bold, design: .rounded))
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
            jobs = Array(jobsResult.jobs.prefix(8))
            listings = Array(listingsResult.listings.prefix(3))
            jobTotal = jobsResult.pagination?.resolvedTotal ?? jobsResult.jobs.count
            listingTotal = listingsResult.pagination?.resolvedTotal ?? listingsResult.listings.count
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

    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            VStack(spacing: 0) {
                ZStack {
                    Circle()
                        .fill(BrandTheme.gold.opacity(0.15))
                        .frame(width: 28, height: 28)
                    Text("\(index)")
                        .font(.system(size: 12, weight: .bold, design: .rounded))
                        .foregroundStyle(BrandTheme.goldBright)
                }
                if !isLast {
                    Rectangle()
                        .fill(BrandTheme.gold.opacity(0.18))
                        .frame(width: 1.5)
                        .frame(maxHeight: .infinity)
                }
            }
            .frame(width: 28)

            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(BrandTheme.textPrimary)
                Text(detail)
                    .font(.system(size: 13))
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

// MARK: - Job auction card

private struct HomeJobCard: View {
    let job: JobSummary

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
                    VStack(alignment: .leading, spacing: 6) {
                        Text(job.displayTitle)
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundStyle(BrandTheme.textPrimary)
                            .lineLimit(2)
                            .multilineTextAlignment(.leading)

                        HStack(spacing: 8) {
                            if let category = job.categoryName, !category.isEmpty {
                                Text(category)
                                    .font(.system(size: 12, weight: .medium))
                                    .foregroundStyle(BrandTheme.textSecondary)
                            }
                            if let status = job.status, !status.isEmpty {
                                StatusChipView(
                                    label: StatusChipStyle.displayLabel(status),
                                    style: StatusChipStyle.forStatus(status)
                                )
                            }
                        }
                    }

                    Spacer(minLength: 8)

                    if let price = job.displayPrice {
                        VStack(alignment: .trailing, spacing: 2) {
                            Text(price)
                                .font(.system(size: 17, weight: .bold, design: .rounded))
                                .foregroundStyle(BrandTheme.goldBright)
                                .monospacedDigit()
                            if let caption = job.priceCaption {
                                Text(caption.uppercased())
                                    .font(.system(size: 9, weight: .bold))
                                    .tracking(0.6)
                                    .foregroundStyle(BrandTheme.textSecondary.opacity(0.9))
                            }
                        }
                    }
                }

                HStack(spacing: 12) {
                    if let location = job.locationLabel {
                        Label(location, systemImage: "mappin")
                            .font(.system(size: 12))
                            .foregroundStyle(BrandTheme.textSecondary)
                            .lineLimit(1)
                            .labelStyle(.titleAndIcon)
                    }
                    if let bids = job.bidCount {
                        Text("\(bids) bids")
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(BrandTheme.textSecondary)
                    }
                    Spacer(minLength: 0)
                    if let countdown = job.auctionCountdown {
                        Text(countdown)
                            .font(.system(size: 11, weight: .bold, design: .rounded))
                            .foregroundStyle(
                                countdown == "Ended" ? BrandTheme.textSecondary : BrandTheme.navy
                            )
                            .padding(.horizontal, 10)
                            .padding(.vertical, 5)
                            .background(
                                Capsule().fill(
                                    countdown == "Ended"
                                        ? BrandTheme.surfaceRaised
                                        : BrandTheme.goldBright
                                )
                            )
                    }
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
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .strokeBorder(BrandTheme.hairline, lineWidth: 1)
        )
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Listing preview

private struct HomeListingCard: View {
    let listing: ListingSummary

    var body: some View {
        HStack(alignment: .center, spacing: 14) {
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(BrandTheme.surfaceRaised)
                .frame(width: 48, height: 48)
                .overlay {
                    Image(systemName: "bag.fill")
                        .font(.system(size: 16, weight: .medium))
                        .foregroundStyle(BrandTheme.gold.opacity(0.7))
                }

            VStack(alignment: .leading, spacing: 4) {
                Text(listing.displayTitle)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(BrandTheme.textPrimary)
                    .lineLimit(2)
                HStack(spacing: 8) {
                    if let location = listing.locationLabel {
                        Text(location)
                            .font(.system(size: 12))
                            .foregroundStyle(BrandTheme.textSecondary)
                            .lineLimit(1)
                    }
                    if let bids = listing.bidCount {
                        Text("\(bids) bids")
                            .font(.system(size: 12))
                            .foregroundStyle(BrandTheme.textSecondary)
                    }
                }
            }

            Spacer(minLength: 8)

            Text(listing.displayPrice)
                .font(.system(size: 16, weight: .bold, design: .rounded))
                .foregroundStyle(BrandTheme.goldBright)
                .monospacedDigit()

            Image(systemName: "chevron.right")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(BrandTheme.textSecondary.opacity(0.45))
        }
        .padding(14)
        .background {
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(BrandTheme.gradientCardFace)
        }
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .strokeBorder(BrandTheme.hairline, lineWidth: 1)
        )
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}

#Preview {
    HomeView()
        .environmentObject(AuthViewModel())
}
