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
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if let errorMessage, jobs.isEmpty {
            ContentUnavailableView {
                Label("Couldn’t load jobs", systemImage: "wifi.exclamationmark")
            } description: {
                Text(errorMessage)
            } actions: {
                Button("Try again") {
                    Task { await load(reset: true) }
                }
                .buttonStyle(.borderedProminent)
                .frame(minHeight: 44)
            }
        } else if jobs.isEmpty {
            ContentUnavailableView(
                "No open jobs",
                systemImage: "wrench.and.screwdriver",
                description: Text("No jobs match your search. Pull to refresh or try again later.")
            )
        } else {
            List {
                Section {
                    Text("Customers post jobs; providers compete on price (descending reverse-auction).")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }

                Section {
                    ForEach(jobs) { job in
                        NavigationLink(value: job) {
                            JobRowView(job: job)
                        }
                        .frame(minHeight: 44)
                        .accessibilityHint("Opens job detail")
                    }
                } header: {
                    if let total = pagination?.resolvedTotal, total > 0 {
                        Text("\(jobs.count) of \(total)")
                    } else {
                        Text("Jobs")
                    }
                }

                Section("Location") {
                    Text(LocationPurposeCopy.systemWhenInUseUsageDescription)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Text(LocationPurposeCopy.marketPickerPrePrompt)
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }
            }
            .listStyle(.insetGrouped)
        }
    }

    // MARK: - Mine (auth)

    @ViewBuilder
    private var mineContent: some View {
        if auth.isScaffoldSession {
            ContentUnavailableView {
                Label("Sign in for My Jobs", systemImage: "person.crop.circle.badge.exclamationmark")
            } description: {
                Text("Scaffold session has no API token. Sign out and sign in with a real account to load jobs you posted.")
            } actions: {
                Button("Sign out to log in") {
                    auth.signOut()
                }
                .buttonStyle(.borderedProminent)
                .frame(minHeight: 44)
            }
        } else if needsSignIn {
            ContentUnavailableView {
                Label("Sign in required", systemImage: "lock.circle")
            } description: {
                Text("Your session expired or is missing. Sign in again to see jobs you posted.")
            } actions: {
                Button("Sign in") {
                    auth.signOut()
                }
                .buttonStyle(.borderedProminent)
                .frame(minHeight: 44)
            }
        } else if isLoading && myJobs.isEmpty {
            ProgressView("Loading your jobs…")
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if let errorMessage, myJobs.isEmpty {
            ContentUnavailableView {
                Label("Couldn’t load your jobs", systemImage: "wifi.exclamationmark")
            } description: {
                Text(errorMessage)
            } actions: {
                Button("Try again") {
                    Task { await load(reset: true) }
                }
                .buttonStyle(.borderedProminent)
                .frame(minHeight: 44)
            }
        } else if myJobs.isEmpty {
            ContentUnavailableView(
                "No jobs yet",
                systemImage: "tray",
                description: Text("Jobs you post as a customer show up here. Post from the website for now.")
            )
        } else {
            List {
                Section {
                    Text("Jobs you posted. Open a row for public detail; manage bids and contracts on the web.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }

                Section {
                    ForEach(myJobs) { job in
                        NavigationLink(value: job) {
                            JobRowView(job: job)
                        }
                        .frame(minHeight: 44)
                        .accessibilityHint("Opens job detail")
                    }
                } header: {
                    if let total = myPagination?.resolvedTotal, total > 0 {
                        Text("\(myJobs.count) of \(total)")
                    } else {
                        Text("My jobs")
                    }
                }
            }
            .listStyle(.insetGrouped)
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
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline) {
                Text(job.displayTitle)
                    .font(.body.weight(.medium))
                    .lineLimit(2)
                Spacer(minLength: 8)
                if let price = job.displayPrice {
                    Text(price)
                        .font(.body.weight(.semibold))
                        .monospacedDigit()
                }
            }

            HStack(spacing: 8) {
                if let status = job.status, !status.isEmpty {
                    Text(status.replacingOccurrences(of: "_", with: " ").capitalized)
                        .font(.caption.weight(.medium))
                        .foregroundStyle(.secondary)
                }
                if let category = job.categoryName, !category.isEmpty {
                    Text("·")
                        .foregroundStyle(.tertiary)
                    Text(category)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                if let location = job.locationLabel {
                    Text("·")
                        .foregroundStyle(.tertiary)
                    Text(location)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }

            HStack(spacing: 12) {
                if let bids = job.bidCount {
                    Label("\(bids) bids", systemImage: "tag")
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }
                if let ends = job.auctionEndsAt, !ends.isEmpty {
                    Label(Self.friendlyDate(ends), systemImage: "clock")
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }
            }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
    }

    private static func friendlyDate(_ iso: String) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = formatter.date(from: iso) {
            return date.formatted(date: .abbreviated, time: .shortened)
        }
        formatter.formatOptions = [.withInternetDateTime]
        if let date = formatter.date(from: iso) {
            return date.formatted(date: .abbreviated, time: .shortened)
        }
        return iso
    }
}

#Preview {
    JobsView()
        .environmentObject(AuthViewModel())
}
