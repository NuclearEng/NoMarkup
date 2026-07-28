import SwiftUI

/// Current ToS version vs your acceptance — accept when outdated.
/// `GET /api/v1/tos/current`, `GET|POST /api/v1/me/tos-acceptance`.
struct TermsAcceptanceView: View {
    @EnvironmentObject private var auth: AuthViewModel

    @State private var current: ToSCurrent?
    @State private var acceptance: ToSAcceptance?
    @State private var isLoading = false
    @State private var isAccepting = false
    @State private var errorMessage: String?
    @State private var statusMessage: String?
    @State private var needsSignIn = false

    private var isUpToDate: Bool {
        guard let current, let acceptance else { return false }
        return acceptance.isCurrent(relativeTo: current)
    }

    private var canAccept: Bool {
        guard auth.isAuthenticated, !auth.isScaffoldSession else { return false }
        guard let version = current?.version?.trimmingCharacters(in: .whitespacesAndNewlines),
              !version.isEmpty
        else { return false }
        return !isUpToDate && !isAccepting
    }

    var body: some View {
        Group {
            if auth.isScaffoldSession {
                BrandEmptyState(
                    title: "Sign in required",
                    systemImage: "hammer",
                    message: "Browse-only mode has no API credentials. Sign in with a real account to review and accept Terms of Service.",
                    actionTitle: "Sign out to log in",
                    action: { auth.signOut() }
                )
            } else if needsSignIn || !auth.isAuthenticated {
                BrandEmptyState(
                    title: "Sign in required",
                    systemImage: "doc.text",
                    message: "Sign in to see which Terms version you’ve accepted and to accept the current version.",
                    actionTitle: "Sign in",
                    action: { auth.signOut() }
                )
            } else if isLoading && current == nil {
                ProgressView("Loading terms…")
                    .tint(BrandTheme.accent)
                    .foregroundStyle(BrandTheme.textSecondary)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .brandScreenBackground()
            } else if let errorMessage, current == nil {
                BrandEmptyState(
                    title: "Couldn’t load terms",
                    systemImage: "exclamationmark.triangle",
                    message: errorMessage,
                    actionTitle: "Try again"
                ) {
                    Task { await load() }
                }
            } else {
                formContent
            }
        }
        .navigationTitle("Terms acceptance")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbarBackground(BrandTheme.navy, for: .navigationBar)
        .task { await load() }
        .refreshable { await load() }
    }

    private var formContent: some View {
        List {
            Section {
                LabeledContent("Current version") {
                    Text(current?.displayVersion ?? "—")
                        .font(.body.monospaced())
                        .foregroundStyle(BrandTheme.goldBright)
                }
                .frame(minHeight: 44)
                .listRowBackground(BrandTheme.navyElevated)

                if let effective = current?.effectiveAtLabel {
                    LabeledContent("Effective") {
                        Text(effective)
                            .foregroundStyle(BrandTheme.textSecondary)
                    }
                    .frame(minHeight: 44)
                    .listRowBackground(BrandTheme.navyElevated)
                }

                if let bodyURL = current?.resolvedBodyURL {
                    NavigationLink {
                        LegalWebView(title: "Terms of Service", url: bodyURL)
                    } label: {
                        Label("Read full terms", systemImage: "safari")
                    }
                    .frame(minHeight: 44)
                    .listRowBackground(BrandTheme.navyElevated)
                    .accessibilityHint("Opens the current Terms of Service document")
                }
            } header: {
                Text("Platform terms").brandSectionHeader()
            } footer: {
                Text("The current version is what new signups and re-acceptance must match.")
                    .foregroundStyle(BrandTheme.textSecondary)
            }

            Section {
                statusRow
                    .listRowBackground(BrandTheme.navyElevated)

                LabeledContent("Your version") {
                    Text(acceptance?.displayVersion ?? "Not accepted")
                        .font(.body.monospaced())
                        .foregroundStyle(BrandTheme.textPrimary)
                }
                .frame(minHeight: 44)
                .listRowBackground(BrandTheme.navyElevated)

                if let acceptedAt = acceptance?.acceptedAtLabel {
                    LabeledContent("Accepted") {
                        Text(acceptedAt)
                            .foregroundStyle(BrandTheme.textSecondary)
                    }
                    .frame(minHeight: 44)
                    .listRowBackground(BrandTheme.navyElevated)
                }
            } header: {
                Text("Your acceptance").brandSectionHeader()
            } footer: {
                Text("Accepting records the current version against your account. You can re-read the full document any time.")
                    .foregroundStyle(BrandTheme.textSecondary)
            }

            if let statusMessage {
                Section {
                    Text(statusMessage)
                        .font(.footnote)
                        .foregroundStyle(BrandTheme.success)
                        .fixedSize(horizontal: false, vertical: true)
                        .listRowBackground(BrandTheme.navyElevated)
                }
            }

            if let errorMessage {
                Section {
                    Text(errorMessage)
                        .font(.footnote)
                        .foregroundStyle(BrandTheme.destructive)
                        .fixedSize(horizontal: false, vertical: true)
                        .listRowBackground(BrandTheme.navyElevated)
                }
            }

            if canAccept || isAccepting {
                Section {
                    Button {
                        Task { await accept() }
                    } label: {
                        HStack {
                            if isAccepting {
                                ProgressView()
                                    .tint(BrandTheme.ctaLabelOnGold)
                            }
                            Text(isAccepting ? "Recording…" : "Accept current terms")
                                .frame(maxWidth: .infinity)
                        }
                        .frame(minHeight: 48)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(BrandTheme.accent)
                    .foregroundStyle(BrandTheme.ctaLabelOnGold)
                    .disabled(!canAccept)
                    .listRowBackground(BrandTheme.navyElevated)
                    .accessibilityHint("Records that you accept the current Terms of Service version")
                } footer: {
                    Text("By accepting, you agree to the Terms of Service version shown above.")
                        .foregroundStyle(BrandTheme.textSecondary)
                }
            }
        }
        .brandListBackground()
    }

    @ViewBuilder
    private var statusRow: some View {
        if isUpToDate {
            Label("Up to date", systemImage: "checkmark.seal.fill")
                .foregroundStyle(BrandTheme.success)
                .font(.body.weight(.semibold))
                .frame(minHeight: 44)
                .accessibilityLabel("Terms acceptance is up to date")
        } else if acceptance?.hasAcceptedAny == true {
            Label("New terms available", systemImage: "exclamationmark.triangle.fill")
                .foregroundStyle(BrandTheme.warning)
                .font(.body.weight(.semibold))
                .frame(minHeight: 44)
                .accessibilityLabel("A newer Terms of Service version is available")
        } else {
            Label("Not yet accepted", systemImage: "doc.badge.ellipsis")
                .foregroundStyle(BrandTheme.warning)
                .font(.body.weight(.semibold))
                .frame(minHeight: 44)
                .accessibilityLabel("You have not accepted the Terms of Service yet")
        }
    }

    @MainActor
    private func load() async {
        guard auth.isAuthenticated, !auth.isScaffoldSession else { return }
        isLoading = current == nil
        errorMessage = nil
        defer { isLoading = false }

        do {
            async let currentTask = APIClient.shared.fetchCurrentToS()
            async let acceptanceTask = APIClient.shared.fetchMyToSAcceptance()
            current = try await currentTask
            acceptance = try await acceptanceTask
        } catch let error as APIClientError where error.isUnauthorized {
            needsSignIn = true
        } catch {
            // If current public ToS loaded but acceptance failed, still show what we can.
            if current == nil {
                do {
                    current = try await APIClient.shared.fetchCurrentToS()
                    errorMessage = error.localizedDescription
                } catch {
                    errorMessage = error.localizedDescription
                }
            } else {
                errorMessage = error.localizedDescription
            }
        }
    }

    @MainActor
    private func accept() async {
        guard let version = current?.version?.trimmingCharacters(in: .whitespacesAndNewlines),
              !version.isEmpty
        else {
            errorMessage = "Current terms version is unavailable."
            return
        }

        isAccepting = true
        errorMessage = nil
        statusMessage = nil
        defer { isAccepting = false }

        do {
            _ = try await APIClient.shared.acceptToS(version: version)
            acceptance = try await APIClient.shared.fetchMyToSAcceptance()
            statusMessage = "Accepted version \(version)."
        } catch let error as APIClientError where error.isUnauthorized {
            needsSignIn = true
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

#Preview {
    NavigationStack {
        TermsAcceptanceView()
    }
    .environmentObject(AuthViewModel())
    .preferredColorScheme(.dark)
    .tint(BrandTheme.accent)
}
