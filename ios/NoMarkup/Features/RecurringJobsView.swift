import SwiftUI

/// Dedicated FR-18 recurring schedules list — iOS parity with web `/jobs/recurring`.
///
/// There is no list-all-recurring API. Source: `GET /api/v1/contracts` for the signed-in
/// customer/provider, then `GET /api/v1/contracts/{id}/recurring` per row (fail-soft).
/// Keep rows where config is non-nil. Pause / resume / cancel map to the contract
/// recurring endpoints already used by `ContractDetailView`.
struct RecurringJobsView: View {
    @EnvironmentObject private var auth: AuthViewModel

    @State private var rows: [RecurringScheduleItem] = []
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var statusMessage: String?
    @State private var statusIsError = false

    @State private var actingContractID: String?
    @State private var pendingCancel: RecurringScheduleItem?

    var body: some View {
        Group {
            if !auth.isAuthenticated {
                BrandEmptyState(
                    title: "Sign in required",
                    systemImage: "person.crop.circle.badge.exclamationmark",
                    message: "Sign in to manage recurring service schedules on your contracts.",
                    actionTitle: "Sign in"
                ) {
                    auth.signOut()
                }
            } else if auth.isScaffoldSession {
                BrandEmptyState(
                    title: "Sign in required",
                    systemImage: "hammer",
                    message: "Browse-only mode has no API credentials. Sign in against a live gateway to load recurring jobs."
                )
            } else if isLoading && rows.isEmpty {
                BrandLoadingScreen(kind: .catalog, rows: 4, accessibilityLabel: "Loading recurring jobs…")
            } else if let errorMessage, rows.isEmpty {
                BrandEmptyState(
                    title: "Couldn’t load recurring jobs",
                    systemImage: "exclamationmark.triangle",
                    message: errorMessage,
                    actionTitle: "Try again"
                ) {
                    Task { await load() }
                }
            } else if rows.isEmpty {
                BrandEmptyState(
                    title: "No recurring jobs",
                    systemImage: "arrow.triangle.2.circlepath",
                    message: "When a service contract has a recurring schedule, it appears here. Pause, resume, or cancel from this list — or open the contract for visit detail."
                )
            } else {
                listContent
            }
        }
        .navigationTitle("Recurring jobs")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .brandNavigationBarChrome()
        .task { await load() }
        .refreshable { await load() }
        .confirmationDialog(
            "Cancel this recurring schedule?",
            isPresented: Binding(
                get: { pendingCancel != nil },
                set: { if !$0 { pendingCancel = nil } }
            ),
            titleVisibility: .visible,
            presenting: pendingCancel
        ) { item in
            Button("Cancel schedule", role: .destructive) {
                Task { await cancelSchedule(item) }
            }
            Button("Keep schedule", role: .cancel) {
                pendingCancel = nil
            }
        } message: { item in
            Text(
                "Ends “\(item.contract.displayTitle)” after the next occurrence notice. Completed visits stay on the contract timeline."
            )
        }
    }

    private var listContent: some View {
        List {
            Section {
                Text("Recurring service schedules on contracts where you are the customer or provider. Open a row for visit approve/pay; use actions here to pause, resume, or cancel.")
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
                summaryRow
                    .listRowBackground(BrandTheme.navyElevated)
            }

            Section {
                ForEach(rows) { item in
                    scheduleRow(item)
                        .listRowBackground(BrandTheme.navyElevated)
                }
            } header: {
                Text(String(localized: "\(rows.count) schedules"))
                    .brandSectionHeader()
            } footer: {
                Text("Pause stops new visits; cancel ends the schedule after the next occurrence notice. Money and visit pay stay on the contract detail.")
                    .foregroundStyle(BrandTheme.textSecondary)
            }
        }
        .brandListBackground()
    }

    private var summaryRow: some View {
        let active = rows.filter { $0.config.isActive }.count
        let paused = rows.filter { $0.config.isPaused }.count
        return HStack(spacing: 16) {
            summaryStat(title: "Total", value: "\(rows.count)", color: BrandTheme.textPrimary)
            summaryStat(title: "Active", value: "\(active)", color: BrandTheme.success)
            summaryStat(title: "Paused", value: "\(paused)", color: BrandTheme.warning)
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(rows.count) schedules, \(active) active, \(paused) paused")
    }

    private func summaryStat(title: String, value: String, color: Color) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title)
                .font(.caption2)
                .foregroundStyle(BrandTheme.textSecondary)
            Text(value)
                .font(.title3.weight(.bold).monospacedDigit())
                .foregroundStyle(color)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder
    private func scheduleRow(_ item: RecurringScheduleItem) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            NavigationLink {
                ContractDetailView(contractID: item.contract.id)
            } label: {
                VStack(alignment: .leading, spacing: 6) {
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text(item.contract.displayTitle)
                            .font(.body.weight(.semibold))
                            .foregroundStyle(BrandTheme.textPrimary)
                            .lineLimit(2)
                            .fixedSize(horizontal: false, vertical: true)
                        Spacer(minLength: 8)
                        statusChip(item.config)
                    }

                    HStack(spacing: 10) {
                        Label(item.config.displayFrequency, systemImage: "calendar")
                            .font(.caption.weight(.medium))
                            .foregroundStyle(BrandTheme.textSecondary)
                            .labelStyle(.titleAndIcon)

                        Text(item.config.displayRate)
                            .font(.caption.weight(.semibold).monospacedDigit())
                            .foregroundStyle(BrandTheme.goldBright)
                    }

                    if let next = item.config.nextOccurrence, !next.isEmpty {
                        Text("Next \(CatalogDateFormat.friendlyDateTime(next))")
                            .font(.caption.monospacedDigit())
                            .foregroundStyle(BrandTheme.textSecondary)
                    } else {
                        Text("Next not scheduled")
                            .font(.caption.monospacedDigit())
                            .foregroundStyle(BrandTheme.textSecondary)
                    }

                    if let number = item.contract.contractNumber, !number.isEmpty {
                        Text(number)
                            .font(.caption2.monospaced())
                            .foregroundStyle(BrandTheme.textSecondary)
                    }
                }
            }
            .frame(minHeight: 44)
            .accessibilityHint("Opens contract detail for visits and escrow")

            if !item.config.isCancelled {
                HStack(spacing: 8) {
                    if item.config.isActive {
                        Button {
                            Task { await pauseSchedule(item) }
                        } label: {
                            actionLabel(
                                title: "Pause",
                                systemImage: "pause.circle",
                                busy: actingContractID == item.contract.id
                            )
                        }
                        .buttonStyle(.bordered)
                        .tint(BrandTheme.warning)
                        .disabled(actingContractID != nil)
                        .accessibilityHint("Pauses new recurring visits for this schedule")
                    }

                    if item.config.isPaused {
                        Button {
                            Task { await resumeSchedule(item) }
                        } label: {
                            actionLabel(
                                title: "Resume",
                                systemImage: "play.circle",
                                busy: actingContractID == item.contract.id
                            )
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(BrandTheme.accent)
                        .foregroundStyle(BrandTheme.ctaLabelOnGold)
                        .disabled(actingContractID != nil)
                        .accessibilityHint("Resumes new recurring visits for this schedule")
                    }

                    Button(role: .destructive) {
                        pendingCancel = item
                    } label: {
                        actionLabel(
                            title: "Cancel",
                            systemImage: "xmark.circle",
                            busy: false
                        )
                    }
                    .buttonStyle(.bordered)
                    .tint(BrandTheme.destructive)
                    .disabled(actingContractID != nil)
                    .accessibilityHint("Cancels the recurring schedule after the next occurrence notice")
                }
            }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder
    private func actionLabel(title: String, systemImage: String, busy: Bool) -> some View {
        HStack(spacing: 6) {
            if busy {
                ProgressView()
                    .controlSize(.small)
            } else {
                Image(systemName: systemImage)
            }
            Text(title)
                .font(.subheadline.weight(.semibold))
        }
        .frame(minHeight: 44)
    }

    @ViewBuilder
    private func statusChip(_ config: ContractRecurringConfig) -> some View {
        let style: StatusChipStyle = {
            if config.isActive { return .success }
            if config.isPaused { return .warning }
            if config.isCancelled { return .danger }
            return .neutral
        }()
        Text(config.displayStatus)
            .font(.caption2.weight(.semibold))
            .foregroundStyle(chipForeground(style))
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(chipForeground(style).opacity(0.16), in: Capsule())
    }

    private func chipForeground(_ style: StatusChipStyle) -> Color {
        switch style {
        case .success: return BrandTheme.success
        case .info: return BrandTheme.bidActive
        case .warning: return BrandTheme.warning
        case .danger: return BrandTheme.destructive
        case .neutral: return BrandTheme.textSecondary
        }
    }

    // MARK: - Load

    @MainActor
    private func load() async {
        guard auth.isAuthenticated, !auth.isScaffoldSession else { return }
        isLoading = rows.isEmpty
        errorMessage = nil
        defer { isLoading = false }

        do {
            let response = try await APIClient.shared.fetchContracts(page: 1, pageSize: 50)
            let contracts = response.contracts.filter { !$0.id.isEmpty }
            let next = await Self.loadRecurringItems(contracts: contracts)
            rows = next
            if next.isEmpty {
                // Empty is a valid success (no recurring configs among contracts).
                statusMessage = nil
                statusIsError = false
            }
        } catch {
            if rows.isEmpty {
                errorMessage = error.localizedDescription
            } else {
                statusIsError = true
                statusMessage = error.localizedDescription
            }
        }
    }

    /// Parallel per-contract GET …/recurring; drop contracts with no config (404 / nil).
    private static func loadRecurringItems(
        contracts: [ContractSummary]
    ) async -> [RecurringScheduleItem] {
        guard !contracts.isEmpty else { return [] }

        return await withTaskGroup(of: RecurringScheduleItem?.self) { group in
            for contract in contracts {
                group.addTask {
                    // Prefer payment_timing hint only for ordering later — still probe all,
                    // because list rows omit nested recurring and timing can be stale.
                    let config = try? await APIClient.shared.fetchRecurringConfig(contractId: contract.id)
                    guard let config, !config.id.isEmpty else { return nil }
                    return RecurringScheduleItem(contract: contract, config: config)
                }
            }

            var collected: [RecurringScheduleItem] = []
            for await item in group {
                if let item {
                    collected.append(item)
                }
            }

            // Active first, then paused, then cancelled; stable title within band.
            return collected.sorted { lhs, rhs in
                let lRank = Self.statusRank(lhs.config)
                let rRank = Self.statusRank(rhs.config)
                if lRank != rRank { return lRank < rRank }
                return lhs.contract.displayTitle.localizedCaseInsensitiveCompare(rhs.contract.displayTitle)
                    == .orderedAscending
            }
        }
    }

    private static func statusRank(_ config: ContractRecurringConfig) -> Int {
        if config.isActive { return 0 }
        if config.isPaused { return 1 }
        if config.isCancelled { return 2 }
        return 3
    }

    // MARK: - Actions

    @MainActor
    private func pauseSchedule(_ item: RecurringScheduleItem) async {
        await runAction(item, success: "Recurring schedule paused.") {
            try await APIClient.shared.pauseRecurring(contractId: item.contract.id)
        }
    }

    @MainActor
    private func resumeSchedule(_ item: RecurringScheduleItem) async {
        await runAction(item, success: "Recurring schedule resumed.") {
            try await APIClient.shared.resumeRecurring(contractId: item.contract.id)
        }
    }

    @MainActor
    private func cancelSchedule(_ item: RecurringScheduleItem) async {
        pendingCancel = nil
        await runAction(item, success: "Recurring schedule cancelled.") {
            try await APIClient.shared.cancelRecurring(contractId: item.contract.id)
        }
    }

    @MainActor
    private func runAction(
        _ item: RecurringScheduleItem,
        success: String,
        _ work: () async throws -> ContractRecurringConfig
    ) async {
        statusMessage = nil
        statusIsError = false
        actingContractID = item.contract.id
        defer { actingContractID = nil }

        do {
            let config = try await work()
            if let idx = rows.firstIndex(where: { $0.contract.id == item.contract.id }) {
                rows[idx].config = config
                // Re-sort after status change.
                rows.sort { lhs, rhs in
                    let lRank = Self.statusRank(lhs.config)
                    let rRank = Self.statusRank(rhs.config)
                    if lRank != rRank { return lRank < rRank }
                    return lhs.contract.displayTitle.localizedCaseInsensitiveCompare(rhs.contract.displayTitle)
                        == .orderedAscending
                }
            }
            statusIsError = false
            statusMessage = success
            BrandHaptics.success()
        } catch let error as APIClientError where error.isUnauthorized {
            statusIsError = true
            statusMessage = "Sign in required. Your session is missing or expired — please sign in again."
            BrandHaptics.error()
        } catch {
            statusIsError = true
            statusMessage = error.localizedDescription
            BrandHaptics.error()
        }
    }
}

// MARK: - Row model

/// One contract that has a non-nil FR-18 recurring config.
struct RecurringScheduleItem: Identifiable, Hashable {
    var id: String { contract.id }
    var contract: ContractSummary
    var config: ContractRecurringConfig
}

#Preview {
    NavigationStack {
        RecurringJobsView()
            .environmentObject(AuthViewModel())
    }
    .preferredColorScheme(.dark)
    .tint(BrandTheme.accent)
}
