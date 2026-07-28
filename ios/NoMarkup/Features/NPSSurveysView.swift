import SwiftUI

/// Pending NPS feedback — `GET /api/v1/me/nps/pending` + `POST /api/v1/me/nps/{id}`.
struct NPSSurveysView: View {
    @EnvironmentObject private var auth: AuthViewModel

    @State private var pending: [NPSPendingSurvey] = []
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var statusMessage: String?
    @State private var statusIsError = false

    @State private var selectedSurvey: NPSPendingSurvey?
    @State private var score: Int = 10
    @State private var comment = ""
    @State private var isSubmitting = false

    var body: some View {
        Group {
            if !auth.isAuthenticated {
                BrandEmptyState(
                    title: "Sign in required",
                    systemImage: "person.crop.circle.badge.exclamationmark",
                    message: "Sign in to answer feedback surveys about recent jobs and orders.",
                    actionTitle: "Sign in"
                ) {
                    auth.signOut()
                }
            } else if auth.isScaffoldSession {
                BrandEmptyState(
                    title: "Sign in required",
                    systemImage: "hammer",
                    message: "Browse-only mode has no API credentials. Sign in against a live gateway to submit feedback."
                )
            } else if isLoading && pending.isEmpty {
                ProgressView("Loading surveys…")
                    .tint(BrandTheme.accent)
                    .foregroundStyle(BrandTheme.textSecondary)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .brandScreenBackground()
            } else if let errorMessage, pending.isEmpty {
                BrandEmptyState(
                    title: "Couldn’t load surveys",
                    systemImage: "exclamationmark.triangle",
                    message: errorMessage,
                    actionTitle: "Try again"
                ) {
                    Task { await load() }
                }
            } else if pending.isEmpty {
                BrandEmptyState(
                    title: "No pending surveys",
                    systemImage: "checkmark.bubble",
                    message: "You’re all caught up. After a completed job or order we may ask how likely you are to recommend NoMarkup (0–10)."
                )
            } else {
                listContent
            }
        }
        .navigationTitle("Feedback surveys")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbarBackground(BrandTheme.navy, for: .navigationBar)
        .task { await load() }
        .refreshable { await load() }
        .sheet(item: $selectedSurvey) { survey in
            NavigationStack {
                submitSheet(for: survey)
            }
            .tint(BrandTheme.accent)
        }
    }

    private var listContent: some View {
        List {
            if let statusMessage {
                Section {
                    Text(statusMessage)
                        .font(.footnote)
                        .foregroundStyle(statusIsError ? BrandTheme.destructive : BrandTheme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                        .listRowBackground(BrandTheme.navyElevated)
                }
            }

            Section {
                Text("Rate how likely you are to recommend NoMarkup (0 = not at all, 10 = extremely likely). Your score helps us improve reverse auctions and local goods.")
                    .font(.subheadline)
                    .foregroundStyle(BrandTheme.textSecondary)
                    .listRowBackground(BrandTheme.navyElevated)
            }

            Section {
                ForEach(pending) { survey in
                    Button {
                        score = 10
                        comment = ""
                        selectedSurvey = survey
                    } label: {
                        HStack(alignment: .top, spacing: 12) {
                            Image(systemName: "bubble.left.and.bubble.right")
                                .foregroundStyle(BrandTheme.goldBright)
                                .frame(width: 28, alignment: .center)
                            VStack(alignment: .leading, spacing: 4) {
                                Text(survey.displayContext)
                                    .font(.body.weight(.medium))
                                    .foregroundStyle(BrandTheme.textPrimary)
                                if let at = survey.promptedAtLabel {
                                    Text("Prompted \(at)")
                                        .font(.caption)
                                        .foregroundStyle(BrandTheme.textSecondary)
                                }
                                if let contextId = survey.contextId?.trimmingCharacters(in: .whitespacesAndNewlines),
                                   !contextId.isEmpty
                                {
                                    Text(shortID(contextId))
                                        .font(.caption2.monospaced())
                                        .foregroundStyle(BrandTheme.textSecondary)
                                }
                            }
                            Spacer(minLength: 8)
                            Image(systemName: "chevron.right")
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(BrandTheme.textSecondary)
                        }
                        .frame(minHeight: 44)
                    }
                    .listRowBackground(BrandTheme.navyElevated)
                    .accessibilityHint("Opens score and comment form")
                }
            } header: {
                Text("\(pending.count) pending").brandSectionHeader()
            }
        }
        .brandListBackground()
    }

    @ViewBuilder
    private func submitSheet(for survey: NPSPendingSurvey) -> some View {
        Form {
            Section {
                Text(survey.displayContext)
                    .foregroundStyle(BrandTheme.textPrimary)
                if let at = survey.promptedAtLabel {
                    LabeledContent("Prompted", value: at)
                        .foregroundStyle(BrandTheme.textSecondary)
                }
            } header: {
                Text("Survey").brandSectionHeader()
            }

            Section {
                Picker("Score", selection: $score) {
                    ForEach(0 ... 10, id: \.self) { value in
                        Text("\(value)").tag(value)
                    }
                }
                .pickerStyle(.wheel)
                .frame(minHeight: 120)
                .accessibilityLabel("NPS score from 0 to 10")

                Text("Selected: \(score) / 10")
                    .font(.subheadline.weight(.semibold).monospacedDigit())
                    .foregroundStyle(BrandTheme.goldBright)
            } header: {
                Text("How likely to recommend?").brandSectionHeader()
            } footer: {
                Text("0 = not at all likely · 10 = extremely likely")
                    .foregroundStyle(BrandTheme.textSecondary)
            }

            Section {
                TextField("Optional comment", text: $comment, axis: .vertical)
                    .lineLimit(3 ... 6)
                    .frame(minHeight: 44)
                    .accessibilityLabel("Optional feedback comment")
            } header: {
                Text("Comment").brandSectionHeader()
            }

            if let statusMessage, selectedSurvey?.id == survey.id {
                Section {
                    Text(statusMessage)
                        .font(.footnote)
                        .foregroundStyle(statusIsError ? BrandTheme.destructive : BrandTheme.success)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }

            Section {
                Button {
                    Task { await submit(survey) }
                } label: {
                    HStack {
                        if isSubmitting {
                            ProgressView()
                                .tint(BrandTheme.ctaLabelOnGold)
                        }
                        Text(isSubmitting ? "Submitting…" : "Submit score")
                            .frame(maxWidth: .infinity)
                    }
                    .frame(minHeight: 48)
                }
                .buttonStyle(.borderedProminent)
                .tint(BrandTheme.accent)
                .foregroundStyle(BrandTheme.ctaLabelOnGold)
                .disabled(isSubmitting)
            }
        }
        .brandListBackground()
        .navigationTitle("Rate NoMarkup")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("Close") {
                    selectedSurvey = nil
                }
                .frame(minHeight: 44)
            }
        }
        .toolbarBackground(BrandTheme.navy, for: .navigationBar)
        .scrollDismissesKeyboard(.interactively)
    }

    private func shortID(_ id: String) -> String {
        if id.count <= 12 { return id }
        return String(id.prefix(8)) + "…"
    }

    @MainActor
    private func load() async {
        guard auth.isAuthenticated, !auth.isScaffoldSession else { return }
        isLoading = pending.isEmpty
        errorMessage = nil
        defer { isLoading = false }

        do {
            let response = try await APIClient.shared.fetchPendingNPS()
            pending = response.pending
        } catch let error as APIClientError where error.isUnauthorized {
            errorMessage = "Sign in required. Your session is missing or expired."
        } catch {
            if pending.isEmpty {
                errorMessage = error.localizedDescription
            }
        }
    }

    @MainActor
    private func submit(_ survey: NPSPendingSurvey) async {
        statusMessage = nil
        statusIsError = false
        isSubmitting = true
        defer { isSubmitting = false }

        do {
            _ = try await APIClient.shared.submitNPS(
                id: survey.id,
                score: score,
                comment: comment
            )
            statusIsError = false
            statusMessage = "Thanks — your score was recorded."
            pending.removeAll { $0.id == survey.id }
            // Brief success, then dismiss.
            try? await Task.sleep(nanoseconds: 600_000_000)
            selectedSurvey = nil
            statusMessage = "Thanks for your feedback."
        } catch let error as APIClientError where error.isUnauthorized {
            statusIsError = true
            statusMessage = "Sign in required. Your session is missing or expired — please sign in again."
        } catch {
            statusIsError = true
            statusMessage = error.localizedDescription
        }
    }
}

#Preview {
    NavigationStack {
        NPSSurveysView()
            .environmentObject(AuthViewModel())
    }
    .preferredColorScheme(.dark)
    .tint(BrandTheme.accent)
}
