import SwiftUI

/// Services reverse-auction surface. Loads open jobs from the gateway.
struct JobsView: View {
    @State private var jobs: [JobSummary] = []
    @State private var pagination: PaginationMeta?
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var searchText = ""

    var body: some View {
        NavigationStack {
            content
                .navigationTitle("Jobs")
                .searchable(text: $searchText, prompt: "Search jobs")
                .onSubmit(of: .search) {
                    Task { await load(reset: true) }
                }
                .refreshable { await load(reset: true) }
                .task { await load(reset: true) }
                .navigationDestination(for: JobSummary.self) { job in
                    JobDetailView(jobID: job.id, preview: job)
                }
        }
    }

    @ViewBuilder
    private var content: some View {
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

    @MainActor
    private func load(reset: Bool) async {
        if reset {
            isLoading = true
        }
        errorMessage = nil
        defer { isLoading = false }

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
}
