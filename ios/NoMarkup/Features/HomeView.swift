import SwiftUI

struct HomeView: View {
    @EnvironmentObject private var auth: AuthViewModel
    @Environment(\.selectedRootTab) private var selectedRootTab

    @State private var healthOK: Bool?
    @State private var healthError: String?
    @State private var isChecking = false
    @State private var listingCount: Int?
    @State private var jobCount: Int?
    @State private var catalogError: String?
    @State private var lastCheckedAt: Date?

    var body: some View {
        NavigationStack {
            List {
                Section {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Welcome to NoMarkup")
                            .font(.title2.weight(.semibold))
                        Text("Native iOS shell for the two-sided marketplace: services reverse-auction and goods forward-auction.")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .padding(.vertical, 4)
                    .accessibilityElement(children: .combine)
                }

                Section("Gateway") {
                    LabeledContent("API base") {
                        Text(AppConfig.apiBaseURLString)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .textSelection(.enabled)
                    }
                    if auth.isScaffoldSession {
                        Label("Scaffold session (not signed in to API)", systemImage: "hammer")
                            .foregroundStyle(.orange)
                    }
                    Button {
                        Task { await refreshHome() }
                    } label: {
                        HStack {
                            Text(isChecking ? "Checking…" : "Refresh status")
                            Spacer()
                            if isChecking {
                                ProgressView()
                            } else if let healthOK {
                                Image(systemName: healthOK ? "checkmark.circle.fill" : "xmark.circle.fill")
                                    .foregroundStyle(healthOK ? .green : .red)
                                    .accessibilityLabel(healthOK ? "API healthy" : "API unreachable")
                            }
                        }
                        .frame(minHeight: 44)
                    }
                    .disabled(isChecking)
                    if let lastCheckedAt {
                        Text("Last check \(lastCheckedAt.formatted(date: .omitted, time: .shortened))")
                            .font(.caption2)
                            .foregroundStyle(.tertiary)
                    }
                    if let healthError {
                        Text(healthError)
                            .font(.footnote)
                            .foregroundStyle(.red)
                    }
                }

                Section("Live catalog") {
                    Button {
                        selectedRootTab?.wrappedValue = .marketplace
                    } label: {
                        HStack {
                            Label("Marketplace", systemImage: "bag.fill")
                                .foregroundStyle(.primary)
                            Spacer()
                            Text(listingCount.map { "\($0) listings" } ?? "—")
                                .font(.subheadline.monospacedDigit())
                                .foregroundStyle(.secondary)
                            Image(systemName: "chevron.right")
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(.tertiary)
                        }
                        .frame(minHeight: 44)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityHint("Opens the Marketplace tab")

                    Button {
                        selectedRootTab?.wrappedValue = .jobs
                    } label: {
                        HStack {
                            Label("Jobs", systemImage: "wrench.and.screwdriver.fill")
                                .foregroundStyle(.primary)
                            Spacer()
                            Text(jobCount.map { "\($0) open" } ?? "—")
                                .font(.subheadline.monospacedDigit())
                                .foregroundStyle(.secondary)
                            Image(systemName: "chevron.right")
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(.tertiary)
                        }
                        .frame(minHeight: 44)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityHint("Opens the Jobs tab")

                    Button {
                        selectedRootTab?.wrappedValue = .messages
                    } label: {
                        HStack {
                            Label("Messages", systemImage: "bubble.left.and.bubble.right.fill")
                                .foregroundStyle(.primary)
                            Spacer()
                            Image(systemName: "chevron.right")
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(.tertiary)
                        }
                        .frame(minHeight: 44)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityHint("Opens the Messages tab")

                    if let catalogError {
                        Text(catalogError)
                            .font(.caption)
                            .foregroundStyle(.orange)
                    }

                    Text("Tap a row to jump to that tab. Pull to refresh counts from the live API.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }

                Section("Product rails") {
                    Text("Payments for real-world goods & services use Stripe (marketplace exception). Digital unlocks will use StoreKit later — not in this scaffold.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Home")
            .task { await refreshHome() }
            .refreshable { await refreshHome() }
        }
    }

    @MainActor
    private func refreshHome() async {
        isChecking = true
        healthError = nil
        catalogError = nil
        defer {
            isChecking = false
            lastCheckedAt = Date()
        }

        async let healthTask: Void = checkHealth()
        async let catalogTask: Void = loadCatalogCounts()
        _ = await (healthTask, catalogTask)
    }

    @MainActor
    private func checkHealth() async {
        do {
            healthOK = try await APIClient.shared.health()
        } catch {
            healthOK = false
            healthError = error.localizedDescription
        }
    }

    @MainActor
    private func loadCatalogCounts() async {
        do {
            async let listings = APIClient.shared.fetchListings(page: 1, pageSize: 1)
            async let jobs = APIClient.shared.fetchJobs(page: 1, pageSize: 1)
            let listingResponse = try await listings
            let jobsResponse = try await jobs
            listingCount = listingResponse.pagination?.resolvedTotal ?? listingResponse.listings.count
            jobCount = jobsResponse.pagination?.resolvedTotal ?? jobsResponse.jobs.count
        } catch {
            // Keep last known counts; only set error when we have no numbers yet.
            if listingCount == nil && jobCount == nil {
                catalogError = "Catalog offline — open Marketplace or Jobs to retry."
            }
        }
    }
}

#Preview {
    HomeView()
        .environmentObject(AuthViewModel())
}
