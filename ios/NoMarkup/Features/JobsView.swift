import SwiftUI

/// Services reverse-auction surface.
/// Browse = public open jobs; Mine = authenticated owner list (`/jobs/mine`).
struct JobsView: View {
    private enum Segment: String, CaseIterable, Identifiable {
        case browse = "Browse"
        case mine = "Mine"
        var id: String { rawValue }
    }

    @EnvironmentObject private var auth: AuthViewModel

    @State private var segment: Segment = .browse
    @State private var jobs: [JobSummary] = []
    @State private var myJobs: [JobMine] = []
    @State private var pagination: PaginationMeta?
    @State private var myPagination: PaginationMeta?
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var needsSignIn = false
    @State private var searchText = ""

    var body: some View {
        NavigationStack {
            content
                .navigationTitle("Jobs")
                .searchable(text: $searchText, prompt: segment == .browse ? "Search jobs" : "Search is browse-only")
                .onSubmit(of: .search) {
                    guard segment == .browse else { return }
                    Task { await load(reset: true) }
                }
                .refreshable { await load(reset: true) }
                .task(id: segment) { await load(reset: true) }
                .toolbar {
                    ToolbarItem(placement: .principal) {
                        Picker("Jobs section", selection: $segment) {
                            ForEach(Segment.allCases) { s in
                                Text(s.rawValue).tag(s)
                            }
                        }
                        .pickerStyle(.segmented)
                        .frame(minWidth: 180)
                        .accessibilityLabel("Jobs section")
                    }
                }
                .toolbarBackground(BrandTheme.navy, for: .navigationBar)
                .toolbarBackground(.visible, for: .navigationBar)
                .navigationDestination(for: JobSummary.self) { job in
                    JobDetailView(jobID: job.id, preview: job)
                }
        }
    }

    @ViewBuilder
    private var content: some View {
        switch segment {
        case .browse:
            browseContent
        case .mine:
            mineContent
        }
    }

    // MARK: - Browse (public)

    @ViewBuilder
    private var browseContent: some View {
        if isLoading && jobs.isEmpty {
            ProgressView("Loading jobs…")
                .tint(BrandTheme.accent)
                .foregroundStyle(BrandTheme.textSecondary)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .brandScreenBackground()
        } else if let errorMessage, jobs.isEmpty {
            BrandEmptyState(
                title: "Couldn’t load jobs",
                systemImage: "wifi.exclamationmark",
                message: errorMessage,
                actionTitle: "Try again"
            ) {
                Task { await load(reset: true) }
            }
        } else if jobs.isEmpty {
            BrandEmptyState(
                title: "No open reverse auctions",
                systemImage: "wrench.and.screwdriver",
                message: "When customers post work, qualified providers compete here on price. Pull to refresh or clear search."
            )
        } else {
            List {
                Section {
                    Text("Customers post jobs. Providers compete on price (descending reverse auction). Fair market rates — not lead-gen markup.")
                        .font(.subheadline)
                        .foregroundStyle(BrandTheme.textSecondary)
                        .listRowBackground(BrandTheme.navyElevated)
                }

                Section {
                    ForEach(jobs) { job in
                        NavigationLink(value: job) {
                            JobRowView(job: job)
                        }
                        .frame(minHeight: 44)
                        .listRowBackground(BrandTheme.navyElevated)
                        .accessibilityHint("Opens job detail")
                    }
                } header: {
                    if let total = pagination?.resolvedTotal, total > 0 {
                        Text("\(jobs.count) of \(total)").brandSectionHeader()
                    } else {
                        Text("Open jobs").brandSectionHeader()
                    }
                }

                Section {
                    Text(LocationPurposeCopy.systemWhenInUseUsageDescription)
                        .font(.caption)
                        .foregroundStyle(BrandTheme.textSecondary)
                        .listRowBackground(BrandTheme.navyElevated)
                    Text(LocationPurposeCopy.marketPickerPrePrompt)
                        .font(.caption2)
                        .foregroundStyle(BrandTheme.textSecondary.opacity(0.75))
                        .listRowBackground(BrandTheme.navyElevated)
                } header: {
                    Text("Location").brandSectionHeader()
                }
            }
            .brandListBackground()
        }
    }

    // MARK: - Mine (auth)

    @ViewBuilder
    private var mineContent: some View {
        if auth.isScaffoldSession {
            BrandEmptyState(
                title: "Sign in for My Jobs",
                systemImage: "person.crop.circle.badge.exclamationmark",
                message: "Browse-only mode has no API token. Sign out and sign in with a real account to load jobs you posted.",
                actionTitle: "Sign out to log in"
            ) {
                auth.signOut()
            }
        } else if needsSignIn {
            BrandEmptyState(
                title: "Sign in required",
                systemImage: "lock.circle",
                message: "Your session expired or is missing. Sign in again to see jobs you posted.",
                actionTitle: "Sign in"
            ) {
                auth.signOut()
            }
        } else if isLoading && myJobs.isEmpty {
            ProgressView("Loading your jobs…")
                .tint(BrandTheme.accent)
                .foregroundStyle(BrandTheme.textSecondary)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .brandScreenBackground()
        } else if let errorMessage, myJobs.isEmpty {
            BrandEmptyState(
                title: "Couldn’t load your jobs",
                systemImage: "wifi.exclamationmark",
                message: errorMessage,
                actionTitle: "Try again"
            ) {
                Task { await load(reset: true) }
            }
        } else if myJobs.isEmpty {
            BrandEmptyState(
                title: "No jobs yet",
                systemImage: "tray",
                message: "Jobs you post as a customer show up here. Providers bid down until the market sets the price. Pull to refresh after posting on the website."
            )
        } else {
            List {
                Section {
                    Text("Jobs you posted. Open a row for public detail; manage bids and contracts on the web.")
                        .font(.subheadline)
                        .foregroundStyle(BrandTheme.textSecondary)
                        .listRowBackground(BrandTheme.navyElevated)
                }

                Section {
                    ForEach(myJobs) { job in
                        NavigationLink(value: job) {
                            JobRowView(job: job)
                        }
                        .frame(minHeight: 44)
                        .listRowBackground(BrandTheme.navyElevated)
                        .accessibilityHint("Opens job detail")
                    }
                } header: {
                    if let total = myPagination?.resolvedTotal, total > 0 {
                        Text("\(myJobs.count) of \(total)").brandSectionHeader()
                    } else {
                        Text("My jobs").brandSectionHeader()
                    }
                }
            }
            .brandListBackground()
        }
    }

    @MainActor
    private func load(reset: Bool) async {
        if reset {
            isLoading = true
        }
        errorMessage = nil
        needsSignIn = false
        defer { isLoading = false }

        switch segment {
        case .browse:
            do {
                let response = try await APIClient.shared.fetchJobs(
                    page: 1,
                    pageSize: 40,
                    q: searchText
                )
                jobs = response.jobs
                pagination = response.pagination
            } catch {
                if jobs.isEmpty {
                    errorMessage = error.localizedDescription
                }
            }
        case .mine:
            if auth.isScaffoldSession {
                myJobs = []
                myPagination = nil
                return
            }
            do {
                let response = try await APIClient.shared.fetchMyJobs(page: 1, pageSize: 40)
                myJobs = response.jobs
                myPagination = response.pagination
            } catch let error as APIClientError where error.isUnauthorized {
                myJobs = []
                myPagination = nil
                needsSignIn = true
            } catch {
                if myJobs.isEmpty {
                    errorMessage = error.localizedDescription
                }
            }
        }
    }
}

// MARK: - Row

private struct JobRowView: View {
    let job: JobSummary

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(job.displayTitle)
                    .font(.body.weight(.semibold))
                    .foregroundStyle(BrandTheme.textPrimary)
                    .lineLimit(2)
                Spacer(minLength: 8)
                if let price = job.displayPrice {
                    VStack(alignment: .trailing, spacing: 2) {
                        Text(price)
                            .font(.body.weight(.bold).monospacedDigit())
                            .foregroundStyle(BrandTheme.goldBright)
                        if let caption = job.priceCaption {
                            Text(caption)
                                .font(.caption2)
                                .foregroundStyle(BrandTheme.textSecondary)
                        }
                    }
                }
            }

            HStack(spacing: 8) {
                if let status = job.status, !status.isEmpty {
                    StatusChipView(
                        label: StatusChipStyle.displayLabel(status),
                        style: StatusChipStyle.forStatus(status)
                    )
                }
                if let category = job.categoryName, !category.isEmpty {
                    Text(category)
                        .font(.caption)
                        .foregroundStyle(BrandTheme.textSecondary)
                        .lineLimit(1)
                }
            }

            HStack(spacing: 12) {
                if let location = job.locationLabel {
                    Label(location, systemImage: "mappin.and.ellipse")
                        .font(.caption)
                        .foregroundStyle(BrandTheme.textSecondary)
                        .lineLimit(1)
                }
                if let bids = job.bidCount {
                    Label("\(bids) bids", systemImage: "tag")
                        .font(.caption)
                        .foregroundStyle(BrandTheme.textSecondary)
                }
                if let countdown = job.auctionCountdown {
                    Label(countdown, systemImage: "clock")
                        .font(.caption.weight(.medium))
                        .foregroundStyle(countdown == "Ended" ? BrandTheme.textSecondary : BrandTheme.goldBright)
                        .lineLimit(1)
                }
            }
        }
        .padding(.vertical, 6)
        .accessibilityElement(children: .combine)
    }
}

/// Compact status pill used on catalog rows.
struct StatusChipView: View {
    let label: String
    let style: StatusChipStyle

    var body: some View {
        Text(label)
            .font(.caption2.weight(.semibold))
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .foregroundStyle(foreground)
            .background(background, in: Capsule())
            .accessibilityLabel("Status \(label)")
    }

    private var foreground: Color {
        switch style {
        case .success: return BrandTheme.success
        case .info: return BrandTheme.bidActive
        case .warning: return BrandTheme.warning
        case .danger: return BrandTheme.destructive
        case .neutral: return BrandTheme.textSecondary
        }
    }

    private var background: Color {
        foreground.opacity(0.14)
    }
}

#Preview {
    JobsView()
        .environmentObject(AuthViewModel())
        .preferredColorScheme(.dark)
        .tint(BrandTheme.accent)
}
