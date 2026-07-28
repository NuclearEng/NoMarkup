import SwiftUI

/// Customer's unpublished service job drafts (`GET /api/v1/jobs/drafts`).
/// Open a row for `JobDetailView`; publish starts the reverse auction (`POST …/publish`).
struct JobDraftsView: View {
    @EnvironmentObject private var auth: AuthViewModel

    @State private var drafts: [JobSummary] = []
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var needsSignIn = false

    @State private var pendingPublish: JobSummary?
    @State private var publishingID: String?
    @State private var statusMessage: String?
    @State private var statusIsError = false

    var body: some View {
        Group {
            if auth.isScaffoldSession {
                BrandEmptyState(
                    title: "Sign in required",
                    systemImage: "doc.text",
                    message: "Browse-only mode has no API credentials. Sign in against a live gateway to load job drafts."
                )
            } else if needsSignIn || !auth.isAuthenticated {
                BrandEmptyState(
                    title: "Sign in required",
                    systemImage: "person.crop.circle.badge.exclamationmark",
                    message: "Sign in to see service jobs you saved as drafts and publish them to the reverse auction.",
                    actionTitle: "Sign in"
                ) {
                    auth.signOut()
                }
            } else {
                content
            }
        }
        .navigationTitle("Job drafts")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbarBackground(BrandTheme.navy, for: .navigationBar)
        .task { await load() }
        .refreshable { await load() }
        .navigationDestination(for: JobSummary.self) { job in
            JobDetailView(jobID: job.id, preview: job)
        }
        .confirmationDialog(
            "Publish this job?",
            isPresented: Binding(
                get: { pendingPublish != nil },
                set: { if !$0 { pendingPublish = nil } }
            ),
            titleVisibility: .visible,
            presenting: pendingPublish
        ) { job in
            Button("Publish “\(job.displayTitle)”") {
                Task { await publish(job) }
            }
            Button("Keep as draft", role: .cancel) {
                pendingPublish = nil
            }
        } message: { job in
            Text(
                "Publishes “\(job.displayTitle)” as an active reverse auction so providers can bid down. You can still manage the job after it goes live."
            )
        }
    }

    @ViewBuilder
    private var content: some View {
        if isLoading && drafts.isEmpty {
            ProgressView("Loading drafts…")
                .tint(BrandTheme.accent)
                .foregroundStyle(BrandTheme.textSecondary)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .brandScreenBackground()
        } else if let errorMessage, drafts.isEmpty {
            BrandEmptyState(
                title: "Couldn’t load drafts",
                systemImage: "exclamationmark.triangle",
                message: errorMessage,
                actionTitle: "Try again"
            ) {
                Task { await load() }
            }
        } else if drafts.isEmpty {
            BrandEmptyState(
                title: "No job drafts",
                systemImage: "doc.badge.plus",
                message: "Save a job as a draft from Post a job (turn off “Publish immediately”). Drafts appear here until you publish them."
            )
        } else {
            List {
                Section {
                    Text("Unpublished service jobs. Open a row for detail, or publish to start the reverse auction so providers can bid down.")
                        .font(.subheadline)
                        .foregroundStyle(BrandTheme.textSecondary)
                        .listRowBackground(BrandTheme.navyElevated)
                }

                if let statusMessage {
                    Section {
                        Text(statusMessage)
                            .font(.footnote)
                            .foregroundStyle(statusIsError ? BrandTheme.destructive : BrandTheme.success)
                            .fixedSize(horizontal: false, vertical: true)
                            .listRowBackground(BrandTheme.navyElevated)
                    }
                }

                Section {
                    ForEach(drafts) { job in
                        draftRow(job)
                            .listRowBackground(BrandTheme.navyElevated)
                    }
                } header: {
                    Text(String(localized: "\(drafts.count) drafts"))
                        .brandSectionHeader()
                } footer: {
                    Text("Publishing makes the job visible to providers. Edit on the web if you need photos or advanced options first.")
                        .foregroundStyle(BrandTheme.textSecondary)
                }
            }
            .brandListBackground()
        }
    }

    @ViewBuilder
    private func draftRow(_ job: JobSummary) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            NavigationLink(value: job) {
                VStack(alignment: .leading, spacing: 6) {
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text(job.displayTitle)
                            .font(.body.weight(.semibold))
                            .foregroundStyle(BrandTheme.textPrimary)
                            .lineLimit(2)
                        Spacer(minLength: 8)
                        if let price = job.displayPrice {
                            Text(price)
                                .font(.subheadline.weight(.semibold).monospacedDigit())
                                .foregroundStyle(BrandTheme.goldBright)
                        }
                    }

                    HStack(spacing: 8) {
                        StatusChipView(
                            label: StatusChipStyle.displayLabel(job.status ?? "draft"),
                            style: StatusChipStyle.forStatus(job.status ?? "draft")
                        )
                        if let category = job.categoryName, !category.isEmpty {
                            Text(category)
                                .font(.caption)
                                .foregroundStyle(BrandTheme.textSecondary)
                                .lineLimit(1)
                        }
                        if let location = job.locationLabel {
                            Text("· \(location)")
                                .font(.caption)
                                .foregroundStyle(BrandTheme.textSecondary)
                                .lineLimit(1)
                        }
                    }
                }
            }
            .frame(minHeight: 44)
            .accessibilityHint("Opens job detail")

            Button {
                pendingPublish = job
            } label: {
                HStack {
                    if publishingID == job.id {
                        ProgressView()
                            .tint(BrandTheme.navy)
                    } else {
                        Image(systemName: "paperplane.fill")
                        Text("Publish")
                            .font(.body.weight(.semibold))
                    }
                }
                .frame(maxWidth: .infinity, minHeight: 44)
            }
            .buttonStyle(.borderedProminent)
            .tint(BrandTheme.gold)
            .foregroundStyle(BrandTheme.ctaLabelOnGold)
            .disabled(publishingID != nil)
            .accessibilityLabel("Publish \(job.displayTitle)")
            .accessibilityHint("Confirms, then starts the reverse auction for providers")
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .contain)
    }

    @MainActor
    private func load() async {
        guard auth.isAuthenticated, !auth.isScaffoldSession else {
            needsSignIn = !auth.isAuthenticated || auth.isScaffoldSession
            drafts = []
            return
        }

        needsSignIn = false
        isLoading = drafts.isEmpty
        errorMessage = nil
        defer { isLoading = false }

        do {
            let response = try await APIClient.shared.fetchJobDrafts()
            drafts = response.drafts
        } catch let error as APIClientError where error.isUnauthorized {
            needsSignIn = true
            drafts = []
            errorMessage = nil
        } catch {
            if drafts.isEmpty {
                errorMessage = error.localizedDescription
            }
        }
    }

    @MainActor
    private func publish(_ job: JobSummary) async {
        pendingPublish = nil
        guard publishingID == nil else { return }
        publishingID = job.id
        statusMessage = nil
        statusIsError = false
        defer { publishingID = nil }

        do {
            _ = try await APIClient.shared.publishJob(id: job.id)
            drafts.removeAll { $0.id == job.id }
            statusIsError = false
            statusMessage = "“\(job.displayTitle)” is live — providers can bid down."
        } catch let error as APIClientError where error.isUnauthorized {
            needsSignIn = true
            statusMessage = nil
        } catch {
            statusIsError = true
            statusMessage = error.localizedDescription
        }
    }
}

#Preview {
    NavigationStack {
        JobDraftsView()
            .environmentObject(AuthViewModel())
    }
    .preferredColorScheme(.dark)
    .tint(BrandTheme.accent)
}
