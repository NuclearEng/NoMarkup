import SwiftUI

/// Job detail for a single services reverse-auction. Public read; native place-bid for providers.
struct JobDetailView: View {
    let jobID: String
    var preview: JobSummary?

    @EnvironmentObject private var auth: AuthViewModel

    @State private var detail: JobDetail?
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var showWebSafari = false

    @State private var bidAmountText = ""
    @State private var isPlacingBid = false
    @State private var bidStatusMessage: String?
    @State private var bidStatusIsError = false

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

            placeBidSection(job)

            Section {
                Text("Contracts and advanced auction tools remain on the website.")
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

    @ViewBuilder
    private func placeBidSection(_ job: JobDetail) -> some View {
        Section {
            if !auth.isAuthenticated {
                Text("Sign in as a provider to place a bid on this job.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            } else if auth.isScaffoldSession {
                Text("Scaffold session has no API credentials. Sign in against a live gateway to place bids.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                TextField("Bid amount (USD)", text: $bidAmountText)
                    .keyboardType(.decimalPad)
                    .disabled(true)
                    .frame(minHeight: 44)
                Button("Place bid") {}
                    .disabled(true)
                    .frame(maxWidth: .infinity, minHeight: 44)
            } else {
                Text(bidHint(for: job))
                    .font(.footnote)
                    .foregroundStyle(.secondary)

                TextField("Bid amount (USD)", text: $bidAmountText)
                    .keyboardType(.decimalPad)
                    .textContentType(.none)
                    .autocorrectionDisabled()
                    .frame(minHeight: 44)
                    .accessibilityLabel("Bid amount in dollars")

                if let bidStatusMessage {
                    Text(bidStatusMessage)
                        .font(.footnote)
                        .foregroundStyle(bidStatusIsError ? .red : .secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }

                Button {
                    Task { await placeJobBid() }
                } label: {
                    if isPlacingBid {
                        ProgressView()
                            .frame(maxWidth: .infinity, minHeight: 44)
                    } else {
                        Text("Place bid")
                            .frame(maxWidth: .infinity, minHeight: 44)
                    }
                }
                .buttonStyle(.borderedProminent)
                .tint(Color("AccentColor"))
                .disabled(isPlacingBid || bidAmountText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        } header: {
            Text("Place a bid")
        } footer: {
            Text("Services are reverse auctions — lower bids compete. Provider role required.")
        }
    }

    private func bidHint(for job: JobDetail) -> String {
        if let price = job.displayPrice {
            return "Enter your bid in dollars. Starting / accepted price: \(price)."
        }
        return "Enter your bid in dollars. Provider accounts only."
    }

    @MainActor
    private func placeJobBid() async {
        bidStatusMessage = nil
        bidStatusIsError = false

        guard !auth.isScaffoldSession else {
            bidStatusIsError = true
            bidStatusMessage =
                "Scaffold session has no API credentials. Sign in against a live gateway to place bids."
            return
        }

        guard let cents = MoneyFormat.cents(fromDollarsText: bidAmountText) else {
            bidStatusIsError = true
            bidStatusMessage = "Enter a valid bid amount in dollars (for example 75.00)."
            return
        }

        isPlacingBid = true
        defer { isPlacingBid = false }

        do {
            _ = try await APIClient.shared.placeJobBid(jobId: jobID, amountCents: cents)
            bidStatusIsError = false
            bidStatusMessage = "Bid placed: \(MoneyFormat.usd(cents: cents))."
            bidAmountText = ""
            await load()
        } catch let error as APIClientError where error.isUnauthorized {
            bidStatusIsError = true
            bidStatusMessage = "Sign in required. Your session is missing or expired — please sign in again."
        } catch {
            bidStatusIsError = true
            bidStatusMessage = error.localizedDescription
        }
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
        .environmentObject(AuthViewModel())
    }
}
