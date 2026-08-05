import SwiftUI

/// Minimal legal services vertical entry (gated by `legal_services` flag).
///
/// Web surface: `/legal` browse + `/jobs/new/legal` post. iOS offers:
/// - Short explainer + how-it-works
/// - Post a legal job (opens `PostJobView`; user picks Legal category)
/// - Browse open jobs filtered to the legal category subtree when resolvable
struct LegalServicesView: View {
    @EnvironmentObject private var flags: FeatureFlags
    @EnvironmentObject private var auth: AuthViewModel

    @State private var legalCategoryId: String?
    @State private var jobs: [JobSummary] = []
    @State private var isLoadingJobs = false
    @State private var jobsError: String?
    @State private var isResolvingCategory = false

    var body: some View {
        Group {
            if !flags.isEnabled("legal_services") {
                BrandEmptyState(
                    title: "Legal services unavailable",
                    systemImage: "scalemass",
                    message: "The legal_services feature flag is off. Enable it on the server to browse the attorney reverse-auction vertical.",
                    actionTitle: "Refresh flags",
                    action: { Task { await flags.refresh() } }
                )
            } else {
                content
            }
        }
        .navigationTitle("Legal services")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .brandNavigationBarChrome()
        .task {
            await flags.refresh()
            guard flags.isEnabled("legal_services") else { return }
            await resolveLegalCategory()
            await loadJobs()
        }
        .refreshable {
            await flags.refresh()
            guard flags.isEnabled("legal_services") else { return }
            await resolveLegalCategory()
            await loadJobs()
        }
    }

    private var content: some View {
        List {
            Section {
                VStack(alignment: .leading, spacing: 10) {
                    Text("Lawyers compete for your case")
                        .font(.title3.weight(.semibold))
                        .foregroundStyle(BrandTheme.textPrimary)
                    Text("Post the legal help you need. Licensed attorneys place reverse-auction bids — the market sets the rate, not the markup.")
                        .font(.subheadline)
                        .foregroundStyle(BrandTheme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(.vertical, 4)
                .listRowBackground(BrandTheme.navyElevated)
            }

            Section {
                howStep(number: "1", title: "Describe your case", body: "Contracts, formation, wills, disputes — a minute to post.")
                howStep(number: "2", title: "Lawyers compete", body: "Licensed attorneys bid down. Watch the market live.")
                howStep(number: "3", title: "Pick your lawyer", body: "Compare bids, bar verification, and reviews. Escrow holds funds.")
            } header: {
                Text("How it works").brandSectionHeader()
            }

            Section {
                NavigationLink {
                    PostJobView()
                } label: {
                    Label("Post a legal job", systemImage: "plus.circle.fill")
                }
                .frame(minHeight: 44)
                .accessibilityHint("Opens the job form. Choose a Legal practice area in the category picker.")
            } header: {
                Text("Get started").brandSectionHeader()
            } footer: {
                Text("Pick a Legal practice area in the category picker. Open cases below are filtered to the legal subtree when the taxonomy resolves.")
                    .foregroundStyle(BrandTheme.textSecondary)
            }

            Section {
                if isLoadingJobs && jobs.isEmpty {
                    ProgressView("Loading open cases…")
                        .tint(BrandTheme.accent)
                        .frame(maxWidth: .infinity, minHeight: 44)
                } else if let jobsError, jobs.isEmpty {
                    Text(jobsError)
                        .font(.footnote)
                        .foregroundStyle(BrandTheme.destructive)
                        .frame(minHeight: 44)
                } else if jobs.isEmpty {
                    Text(isResolvingCategory
                          ? "Resolving legal categories…"
                          : "No open legal jobs right now. Be the first to post.")
                        .font(.footnote)
                        .foregroundStyle(BrandTheme.textSecondary)
                        .frame(minHeight: 44)
                } else {
                    ForEach(jobs.prefix(8)) { job in
                        NavigationLink {
                            JobDetailView(jobID: job.id, preview: job)
                        } label: {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(job.displayTitle)
                                    .font(.subheadline.weight(.semibold))
                                    .foregroundStyle(BrandTheme.textPrimary)
                                    .lineLimit(2)
                                HStack {
                                    if let price = job.displayPrice {
                                        Text(price)
                                            .font(.caption.weight(.semibold).monospacedDigit())
                                            .foregroundStyle(BrandTheme.goldBright)
                                    }
                                    if let category = job.categoryName, !category.isEmpty {
                                        Text(category)
                                            .font(.caption)
                                            .foregroundStyle(BrandTheme.textSecondary)
                                            .lineLimit(1)
                                    }
                                }
                            }
                            .frame(minHeight: 44)
                        }
                        .listRowBackground(BrandTheme.navyElevated)
                    }
                }
            } header: {
                Text("Open cases").brandSectionHeader()
            }
        }
        .brandListBackground()
    }

    private func howStep(number: String, title: String, body: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Text(number)
                .font(.caption.weight(.bold))
                .foregroundStyle(BrandTheme.ctaLabelOnGold)
                .frame(width: 28, height: 28)
                .background(BrandTheme.accent, in: Circle())
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(BrandTheme.textPrimary)
                Text(body)
                    .font(.caption)
                    .foregroundStyle(BrandTheme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(minHeight: 44)
        .listRowBackground(BrandTheme.navyElevated)
        .accessibilityElement(children: .combine)
    }

    @MainActor
    private func resolveLegalCategory() async {
        isResolvingCategory = true
        defer { isResolvingCategory = false }
        do {
            legalCategoryId = try await APIClient.shared.resolveCategoryId(slug: "legal")
        } catch {
            legalCategoryId = nil
        }
    }

    @MainActor
    private func loadJobs() async {
        isLoadingJobs = true
        jobsError = nil
        defer { isLoadingJobs = false }
        do {
            let categoryIds = legalCategoryId.map { [$0] }
            let response = try await APIClient.shared.fetchJobs(
                page: 1,
                pageSize: 12,
                categoryIds: categoryIds
            )
            jobs = response.jobs
        } catch {
            jobsError = error.localizedDescription
            jobs = []
        }
    }
}

#Preview {
    NavigationStack {
        LegalServicesView()
            .environmentObject(FeatureFlags())
            .environmentObject(AuthViewModel())
    }
}
