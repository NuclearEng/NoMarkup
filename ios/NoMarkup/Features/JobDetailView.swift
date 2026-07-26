import SwiftUI

/// Job detail for a single services reverse-auction. Public read.
struct JobDetailView: View {
    let jobID: String
    var preview: JobSummary?

    @State private var detail: JobDetail?
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var showWebSafari = false

    init(jobID: String, preview: JobSummary? = nil) {
        self.jobID = jobID
        self.preview = preview
        if let preview {
            _detail = State(initialValue: JobDetail(from: preview))
        }
    }

    private var webJobURL: URL {
        AppConfig.publicWebBaseURL
            .appending(path: "jobs")
            .appending(path: jobID)
    }

    var body: some View {
        Group {
            if let detail {
                detailContent(detail)
            } else if isLoading {
                ProgressView("Loading…")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let errorMessage {
                ContentUnavailableView {
                    Label("Couldn’t load job", systemImage: "exclamationmark.triangle")
                } description: {
                    Text(errorMessage)
                } actions: {
                    Button("Try again") {
                        Task { await load() }
                    }
                    .buttonStyle(.borderedProminent)
                    .frame(minHeight: 44)
                }
            } else {
                ProgressView()
            }
        }
        .navigationTitle(detail?.displayTitle ?? "Job")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .task { await load() }
        .refreshable { await load() }
        .sheet(isPresented: $showWebSafari) {
            NavigationStack {
                LegalWebView(title: "Job on web", url: webJobURL)
                    .toolbar {
                        ToolbarItem(placement: .cancellationAction) {
                            Button("Done") { showWebSafari = false }
                                .frame(minHeight: 44)
                        }
                    }
            }
        }
    }

    @ViewBuilder
    private func detailContent(_ job: JobDetail) -> some View {
        List {
            Section {
                VStack(alignment: .leading, spacing: 8) {
                    Text(job.displayTitle)
                        .font(.title2.weight(.semibold))
                        .fixedSize(horizontal: false, vertical: true)

                    if let price = job.displayPrice {
                        Text(price)
                            .font(.title3.weight(.bold).monospacedDigit())
                        if job.offerAcceptedCents != nil {
                            Text("Accepted offer")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        } else if job.startingBidCents != nil {
                            Text("Starting bid")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
                .padding(.vertical, 4)
                .accessibilityElement(children: .combine)
            }

            Section("Details") {
                if let status = job.status {
                    LabeledContent("Status") {
                        Text(status.replacingOccurrences(of: "_", with: " ").capitalized)
                    }
                }
                if let category = job.categoryName, !category.isEmpty {
                    LabeledContent("Category", value: category)
                }
                if let schedule = job.scheduleType, !schedule.isEmpty {
                    LabeledContent("Schedule") {
                        Text(schedule.replacingOccurrences(of: "_", with: " ").capitalized)
                    }
                }
                if let location = job.locationLabel {
                    LabeledContent("Area", value: location)
                }
                if let ends = job.auctionEndsAt, !ends.isEmpty {
                    LabeledContent("Auction ends", value: Self.friendlyDate(ends))
                }
                if let bids = job.bidCount {
                    LabeledContent("Bids", value: "\(bids)")
                }
                if let recurring = job.isRecurring, recurring {
                    LabeledContent("Recurring", value: "Yes")
                }
            }

            if let description = job.description?.trimmingCharacters(in: .whitespacesAndNewlines),
               !description.isEmpty {
                Section("Description") {
                    Text(description)
                        .font(.body)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }

            if job.customerDisplayName != nil || job.customerJobsPosted != nil {
                Section("Customer") {
                    if let name = job.customerDisplayName, !name.isEmpty {
                        LabeledContent("Name", value: name)
                    }
                    if let posted = job.customerJobsPosted {
                        LabeledContent("Jobs posted", value: "\(posted)")
                    }
                    if let since = job.customerMemberSince, !since.isEmpty {
                        LabeledContent("Member since", value: Self.friendlyDate(since))
                    }
                }
            }

            Section {
                Text("Bidding and contracts stay on the website for now. Open the full job page for actions.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                Button {
                    showWebSafari = true
                } label: {
                    Label("Open on web", systemImage: "safari")
                        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                }
            }
        }
        .listStyle(.insetGrouped)
    }

    @MainActor
    private func load() async {
        isLoading = detail == nil
        errorMessage = nil
        defer { isLoading = false }

        do {
            detail = try await APIClient.shared.fetchJob(id: jobID)
        } catch {
            if detail == nil {
                errorMessage = error.localizedDescription
            }
        }
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
    NavigationStack {
        JobDetailView(
            jobID: "00000000-0000-0000-0000-000000000002",
            preview: JobSummary(
                id: "00000000-0000-0000-0000-000000000002",
                customerId: nil,
                title: "Lawn mowing — front yard",
                description: "Weekly cut preferred.",
                status: "open",
                scheduleType: "flexible",
                isRecurring: false,
                auctionDurationHours: nil,
                bidCount: 2,
                repostCount: nil,
                categoryId: nil,
                categoryName: "Lawn care",
                categorySlug: nil,
                approximateAddress: JobApproximateAddress(city: "Austin", state: "TX", zipCode: nil),
                startingBidCents: 7500,
                offerAcceptedCents: nil,
                auctionEndsAt: "2026-07-27T18:00:00Z",
                auctionType: nil,
                createdAt: nil,
                photoUrls: nil
            )
        )
    }
}
