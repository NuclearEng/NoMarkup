import SwiftUI

/// Provider Instant match inbox — pending emergency offers from customers (§13).
///
/// APIs (provider role only; gateway `RequireProvider`):
/// - `GET  /api/v1/provider/offers`
/// - `POST /api/v1/provider/offers/{jobId}/accept`
/// - `POST /api/v1/provider/offers/{jobId}/decline`
///
/// Never invents offers client-side; empty list when none are pending.
struct ProviderInstantOffersView: View {
    @EnvironmentObject private var auth: AuthViewModel

    @State private var offers: [ProviderInstantOffer] = []
    @State private var isLoading = false
    @State private var loadError: String?
    @State private var statusMessage: String?
    @State private var actioningJobId: String?
    @State private var hasProviderRole = false
    @State private var roleChecked = false
    @State private var needsSignIn = false
    @State private var acceptedContractRoute: ContractIDRoute?
    @State private var tick = Date()
    /// Provider profile service coords (not live GPS) for MapKit drive ETA.
    @State private var serviceLat: Double?
    @State private var serviceLng: Double?
    /// jobId → resolved travel label (MapKit preferred, haversine/server fallback).
    @State private var travelLabels: [String: String] = [:]

    private let refreshInterval: TimeInterval = 30

    var body: some View {
        Group {
            if auth.isScaffoldSession {
                BrandEmptyState(
                    title: "Sign in required",
                    systemImage: "hammer.fill",
                    message: "Browse-only mode has no API token. Sign in with a real provider account to see Instant offers.",
                    actionTitle: "Sign out to log in",
                    action: { auth.signOut() }
                )
            } else if !auth.isAuthenticated || needsSignIn {
                BrandEmptyState(
                    title: "Sign in required",
                    systemImage: "lock.circle",
                    message: "Sign in as a provider to accept or decline Instant match offers.",
                    actionTitle: "Sign in",
                    action: { auth.signOut() }
                )
            } else if isLoading && !roleChecked {
                ProgressView("Loading Instant offers…")
                    .tint(BrandTheme.accent)
                    .foregroundStyle(BrandTheme.textSecondary)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .brandScreenBackground()
            } else if roleChecked && !hasProviderRole {
                BrandEmptyState(
                    title: "Provider role required",
                    systemImage: "wrench.and.screwdriver",
                    message: "Enable the provider role in Profile settings to receive Instant job offers.",
                    actionTitle: nil,
                    action: nil
                )
                .safeAreaInset(edge: .bottom) {
                    NavigationLink {
                        ProfileSettingsView()
                    } label: {
                        Text("Open Profile settings")
                            .font(.body.weight(.semibold))
                            .frame(maxWidth: .infinity)
                            .frame(minHeight: 48)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(BrandTheme.accent)
                    .foregroundStyle(BrandTheme.ctaLabelOnGold)
                    .padding(.horizontal, 24)
                    .padding(.bottom, 24)
                }
            } else if let loadError, offers.isEmpty {
                BrandEmptyState(
                    title: "Couldn’t load offers",
                    systemImage: "wifi.exclamationmark",
                    message: loadError,
                    actionTitle: "Try again",
                    action: { Task { await refresh(force: true) } }
                )
            } else {
                listContent
            }
        }
        .navigationTitle("Instant offers")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbarBackground(BrandTheme.navy, for: .navigationBar)
        .task {
            await bootstrap()
        }
        .refreshable {
            await refresh(force: true)
        }
        // Soft poll while the screen is open (web uses 30s).
        .task(id: "\(roleChecked)-\(hasProviderRole)") {
            guard roleChecked, hasProviderRole else { return }
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: UInt64(refreshInterval * 1_000_000_000))
                guard !Task.isCancelled else { break }
                await refresh(force: false)
            }
        }
        .onReceive(Timer.publish(every: 15, on: .main, in: .common).autoconnect()) { date in
            tick = date
        }
        .navigationDestination(item: $acceptedContractRoute) { route in
            ContractDetailView(contractID: route.id)
        }
    }

    // MARK: - List

    private var activeOffers: [ProviderInstantOffer] {
        // Filter expired client-side for display; server is source of truth on next poll.
        _ = tick
        return offers.filter { $0.hasValidJobId && !$0.isExpired }
    }

    private var listContent: some View {
        List {
            Section {
                Text("Emergency Instant requests from customers. Accept awards the job at the listed accept-now price and may open a contract.")
                    .font(.subheadline)
                    .foregroundStyle(BrandTheme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .listRowBackground(Color.clear)
                Text(
                    "Customers are told Instant often prices ~1.5–2× a typical auction for speed. Accept-now is the full award price — no separate premium calc on this screen."
                )
                .font(.caption)
                .foregroundStyle(BrandTheme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
                .listRowBackground(Color.clear)
                .accessibilityLabel("Instant premium transparency for providers")
            }

            if let statusMessage, !statusMessage.isEmpty {
                Section {
                    Text(statusMessage)
                        .font(.footnote)
                        .foregroundStyle(BrandTheme.success)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }

            if let loadError, !offers.isEmpty {
                Section {
                    Text(loadError)
                        .font(.footnote)
                        .foregroundStyle(BrandTheme.warning)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }

            if activeOffers.isEmpty {
                Section {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("No pending offers right now")
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(BrandTheme.textPrimary)
                        Text(
                            "When a customer requests Instant match, live offers appear here. Turn on Available now in Provider workspace and keep your categories up to date."
                        )
                        .font(.caption)
                        .foregroundStyle(BrandTheme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .frame(minHeight: 88)
                    .accessibilityElement(children: .combine)
                }
            } else {
                Section {
                    ForEach(activeOffers) { offer in
                        offerRow(offer)
                    }
                } header: {
                    Text("Pending (\(activeOffers.count))").brandSectionHeader()
                } footer: {
                    Text("Auto-refreshes about every \(Int(refreshInterval)) seconds. First provider to accept wins.")
                        .foregroundStyle(BrandTheme.textSecondary)
                }
            }

            Section {
                NavigationLink {
                    ProviderWorkspaceView()
                } label: {
                    Label("Provider workspace", systemImage: "wrench.and.screwdriver")
                }
                .frame(minHeight: 44)
                .accessibilityHint("Toggle available-now and manage your Instant profile")
            } header: {
                Text("Availability").brandSectionHeader()
            }
        }
        .brandListBackground()
        .overlay {
            if isLoading && !offers.isEmpty {
                ProgressView()
                    .tint(BrandTheme.accent)
                    .padding(12)
                    .brandOverlayChipBackground()
            }
        }
    }

    @ViewBuilder
    private func offerRow(_ offer: ProviderInstantOffer) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline) {
                Text(offer.displayTitle)
                    .font(.body.weight(.semibold))
                    .foregroundStyle(BrandTheme.textPrimary)
                    .lineLimit(2)
                Spacer(minLength: 8)
                Text(offer.displayAmount)
                    .font(.subheadline.weight(.semibold).monospacedDigit())
                    .foregroundStyle(BrandTheme.goldBright)
            }

            HStack(spacing: 8) {
                Image(systemName: "clock")
                    .font(.caption)
                    .foregroundStyle(BrandTheme.textSecondary)
                    .accessibilityHidden(true)
                Text(countdownLabel(for: offer))
                    .font(.caption.weight(.medium).monospacedDigit())
                    .foregroundStyle(countdownColor(for: offer))
            }

            if let travel = travelLabel(for: offer) {
                HStack(spacing: 8) {
                    Image(systemName: "car")
                        .font(.caption)
                        .foregroundStyle(BrandTheme.textSecondary)
                        .accessibilityHidden(true)
                    Text(travel)
                        .font(.caption)
                        .foregroundStyle(BrandTheme.textSecondary)
                }
                .accessibilityLabel(travel)
                .accessibilityHint("Approximate drive time only — not live GPS tracking of the provider")
            }

            HStack(spacing: 10) {
                Button {
                    Task { await accept(offer) }
                } label: {
                    if actioningJobId == offer.id {
                        ProgressView()
                            .tint(BrandTheme.ctaLabelOnGold)
                            .frame(maxWidth: .infinity)
                            .frame(minHeight: 44)
                    } else {
                        Label("Accept", systemImage: "checkmark.circle.fill")
                            .frame(maxWidth: .infinity)
                            .frame(minHeight: 44)
                    }
                }
                .buttonStyle(.borderedProminent)
                .tint(BrandTheme.success)
                .disabled(actioningJobId != nil || offer.isExpired)
                .accessibilityLabel("Accept offer for \(offer.displayTitle)")
                .accessibilityHint("Awards the job at \(offer.displayAmount)")

                Button {
                    Task { await decline(offer) }
                } label: {
                    Label("Decline", systemImage: "xmark.circle")
                        .frame(maxWidth: .infinity)
                        .frame(minHeight: 44)
                }
                .buttonStyle(.bordered)
                .tint(BrandTheme.destructive)
                .disabled(actioningJobId != nil || offer.isExpired)
                .accessibilityLabel("Decline offer for \(offer.displayTitle)")

                NavigationLink {
                    JobDetailView(jobID: offer.id, preview: nil)
                } label: {
                    Image(systemName: "chevron.right")
                        .frame(width: 44, height: 44)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("View job details")
            }
        }
        .padding(.vertical, 6)
        .accessibilityElement(children: .contain)
    }

    private func travelLabel(for offer: ProviderInstantOffer) -> String? {
        if let cached = travelLabels[offer.id], !cached.isEmpty {
            return cached
        }
        // Immediate server/haversine fallback while MapKit resolves.
        return offer.approxTravelLabel
    }

    private func countdownLabel(for offer: ProviderInstantOffer) -> String {
        _ = tick
        if offer.isExpired { return "Expired" }
        guard let iso = offer.expiresAt else { return "Expires soon" }
        if let label = CatalogDateFormat.countdownLabel(iso: iso) {
            return label.replacingOccurrences(of: "Ends", with: "Expires")
        }
        return "Expires soon"
    }

    private func countdownColor(for offer: ProviderInstantOffer) -> Color {
        _ = tick
        if offer.isExpired { return BrandTheme.destructive }
        guard let date = offer.expiresAtDate else { return BrandTheme.textSecondary }
        let remaining = date.timeIntervalSinceNow
        if remaining < 180 { return BrandTheme.warning }
        return BrandTheme.success
    }

    // MARK: - Data

    @MainActor
    private func bootstrap() async {
        needsSignIn = false
        loadError = nil
        guard auth.isAuthenticated, !auth.isScaffoldSession else {
            roleChecked = true
            hasProviderRole = false
            return
        }
        isLoading = true
        defer { isLoading = false }

        do {
            let me = try await APIClient.shared.fetchMe()
            hasProviderRole = me.hasProviderRole
            roleChecked = true
            guard hasProviderRole else { return }
            // Profile service coords for MapKit drive ETA (not live GPS tracking).
            if let profile = try? await APIClient.shared.fetchMyProviderProfile() {
                serviceLat = profile.serviceLocation?.latitude
                serviceLng = profile.serviceLocation?.longitude
            }
            await refresh(force: true)
        } catch let error as APIClientError where error.isUnauthorized {
            roleChecked = true
            needsSignIn = true
        } catch {
            roleChecked = true
            loadError = error.localizedDescription
        }
    }

    @MainActor
    private func refresh(force: Bool) async {
        guard hasProviderRole, auth.isAuthenticated, !auth.isScaffoldSession else { return }
        if force {
            isLoading = true
        }
        defer {
            if force { isLoading = false }
        }
        do {
            let next = try await APIClient.shared.fetchProviderInstantOffers()
            offers = next.filter(\.hasValidJobId)
            loadError = nil
            await resolveTravelETAs(for: offers)
        } catch let error as APIClientError where error.isUnauthorized {
            needsSignIn = true
        } catch let error as APIClientError where error.isForbidden {
            hasProviderRole = false
            loadError = "Provider role required to view Instant offers."
        } catch {
            // Keep prior list on soft refresh failure.
            loadError = error.localizedDescription
        }
    }

    /// Prefer MapKit automobile ETA when service + job coords exist; else server/haversine.
    /// Still not live GPS tracking of the provider — one-shot estimate only.
    @MainActor
    private func resolveTravelETAs(for offers: [ProviderInstantOffer]) async {
        var next = travelLabels
        for offer in offers {
            let jobId = offer.id
            let estimate = await SoftTravelETA.resolve(
                fromLat: serviceLat,
                fromLng: serviceLng,
                toLat: offer.approxLat,
                toLng: offer.approxLng,
                serverMinutes: offer.approxTravelMinutes
            )
            if let estimate, let label = SoftTravelETA.label(minutes: estimate.minutes, source: estimate.source) {
                next[jobId] = label
            } else if let fallback = offer.approxTravelLabel {
                next[jobId] = fallback
            }
        }
        travelLabels = next
    }

    @MainActor
    private func accept(_ offer: ProviderInstantOffer) async {
        guard offer.hasValidJobId else { return }
        statusMessage = nil
        loadError = nil
        actioningJobId = offer.id
        defer { actioningJobId = nil }

        do {
            let result = try await APIClient.shared.acceptProviderInstantOffer(jobId: offer.id)
            offers.removeAll { $0.id == offer.id }
            let contract = result.contractId?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            if !contract.isEmpty {
                statusMessage = "Offer accepted. Opening contract…"
                acceptedContractRoute = ContractIDRoute(id: contract)
            } else {
                statusMessage = "Offer accepted. Job awarded — check Contracts for next steps."
            }
            await refresh(force: false)
        } catch {
            loadError = error.localizedDescription
            await refresh(force: false)
        }
    }

    @MainActor
    private func decline(_ offer: ProviderInstantOffer) async {
        guard offer.hasValidJobId else { return }
        statusMessage = nil
        loadError = nil
        actioningJobId = offer.id
        defer { actioningJobId = nil }

        do {
            _ = try await APIClient.shared.declineProviderInstantOffer(jobId: offer.id)
            offers.removeAll { $0.id == offer.id }
            statusMessage = "Offer declined."
            await refresh(force: false)
        } catch {
            loadError = error.localizedDescription
            await refresh(force: false)
        }
    }
}

/// Navigation route for contract detail after Instant accept.
private struct ContractIDRoute: Hashable, Identifiable {
    let id: String
}

#if DEBUG
#Preview {
    NavigationStack {
        ProviderInstantOffersView()
            .environmentObject(AuthViewModel())
    }
}
#endif
