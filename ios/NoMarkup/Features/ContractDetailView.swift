import SwiftUI

/// Contract detail — status, amount, parties, role-gated lifecycle actions,
/// milestones, open dispute sheet, leave review sheet.
struct ContractDetailView: View {
    let contractID: String

    @EnvironmentObject private var auth: AuthViewModel

    @State private var contract: ContractDetail?
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var statusMessage: String?
    @State private var statusIsError = false
    @State private var isActing = false
    @State private var actingMilestoneID: String?
    @State private var currentUserID: String?
    @State private var showCancelConfirm = false
    @State private var showDisputeSheet = false
    @State private var showReviewSheet = false

    var body: some View {
        Group {
            if !auth.isAuthenticated || auth.isScaffoldSession {
                BrandEmptyState(
                    title: "Sign in required",
                    systemImage: "person.crop.circle.badge.exclamationmark",
                    message: "Sign in with a real account to view this contract."
                )
            } else if isLoading && contract == nil {
                ProgressView("Loading contract…")
                    .tint(BrandTheme.accent)
                    .foregroundStyle(BrandTheme.textSecondary)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .brandScreenBackground()
            } else if let errorMessage, contract == nil {
                BrandEmptyState(
                    title: "Couldn’t load contract",
                    systemImage: "exclamationmark.triangle",
                    message: errorMessage,
                    actionTitle: "Try again"
                ) {
                    Task { await load() }
                }
            } else if let contract {
                detailList(contract)
            } else {
                BrandEmptyState(
                    title: "Contract not found",
                    systemImage: "doc.text.magnifyingglass",
                    message: "This contract may have been removed or you are not a party to it."
                )
            }
        }
        .navigationTitle(contract?.displayTitle ?? "Contract")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbarBackground(BrandTheme.navy, for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
        .task { await load() }
        .refreshable { await load() }
        .sheet(isPresented: $showDisputeSheet) {
            if let contract {
                OpenDisputeSheet(contractID: contract.id) { message in
                    statusIsError = false
                    statusMessage = message
                    Task { await load() }
                }
            }
        }
        .sheet(isPresented: $showReviewSheet) {
            if let contract {
                LeaveReviewSheet(contractID: contract.id) { message in
                    statusIsError = false
                    statusMessage = message
                    Task { await load() }
                }
            }
        }
        .confirmationDialog(
            "Cancel this contract?",
            isPresented: $showCancelConfirm,
            titleVisibility: .visible
        ) {
            Button("Cancel contract", role: .destructive) {
                Task { await runAction { try await APIClient.shared.cancelContract(id: contractID) } }
            }
            Button("Keep contract", role: .cancel) {}
        } message: {
            Text("This cannot be undone. Escrow rules on the server still apply.")
        }
    }

    @ViewBuilder
    private func detailList(_ contract: ContractDetail) -> some View {
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
                LabeledContent("Status") {
                    Text(contract.displayStatus)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(statusColor(contract.statusStyle))
                }
                LabeledContent("Amount") {
                    Text(contract.displayAmount)
                        .font(.body.weight(.semibold).monospacedDigit())
                        .foregroundStyle(BrandTheme.goldBright)
                }
                if let tip = contract.tipAmountCents, tip > 0 {
                    LabeledContent("Tip") {
                        Text(MoneyFormat.usd(cents: tip))
                            .font(.subheadline.monospacedDigit())
                            .foregroundStyle(BrandTheme.success)
                    }
                }
                if let timing = contract.paymentTiming, !timing.isEmpty, timing != "unspecified" {
                    LabeledContent("Payment", value: StatusChipStyle.displayLabel(timing))
                }
                if let number = contract.contractNumber, !number.isEmpty {
                    LabeledContent("Number") {
                        Text(number)
                            .font(.caption.monospaced())
                            .foregroundStyle(BrandTheme.textSecondary)
                            .textSelection(.enabled)
                    }
                }
            } header: {
                Text("Overview").brandSectionHeader()
            }
            .listRowBackground(BrandTheme.navyElevated)

            Section {
                partyRow(
                    title: "Customer",
                    name: contract.customerName,
                    id: contract.customerId,
                    isYou: contract.isCustomer(userId: currentUserID)
                )
                partyRow(
                    title: "Provider",
                    name: contract.providerName,
                    id: contract.providerId,
                    isYou: contract.isProvider(userId: currentUserID)
                )
                if contract.normalizedStatus == "pending_acceptance" {
                    LabeledContent("Customer accepted") {
                        Text(contract.customerAccepted == true ? "Yes" : "No")
                            .foregroundStyle(
                                contract.customerAccepted == true
                                    ? BrandTheme.success
                                    : BrandTheme.textSecondary
                            )
                    }
                    LabeledContent("Provider accepted") {
                        Text(contract.providerAccepted == true ? "Yes" : "No")
                            .foregroundStyle(
                                contract.providerAccepted == true
                                    ? BrandTheme.success
                                    : BrandTheme.textSecondary
                            )
                    }
                    if let deadline = contract.acceptanceDeadline, !deadline.isEmpty {
                        LabeledContent("Accept by") {
                            Text(CatalogDateFormat.friendlyDateTime(deadline))
                                .font(.caption)
                                .foregroundStyle(BrandTheme.warning)
                        }
                    }
                }
            } header: {
                Text("Parties").brandSectionHeader()
            }
            .listRowBackground(BrandTheme.navyElevated)

            if let created = contract.createdAt, !created.isEmpty {
                Section {
                    LabeledContent("Created", value: CatalogDateFormat.friendlyDateTime(created))
                    if let started = contract.startedAt, !started.isEmpty {
                        LabeledContent("Started", value: CatalogDateFormat.friendlyDateTime(started))
                    }
                    if let completed = contract.completedAt, !completed.isEmpty {
                        LabeledContent("Marked complete", value: CatalogDateFormat.friendlyDateTime(completed))
                    }
                } header: {
                    Text("Timeline").brandSectionHeader()
                }
                .listRowBackground(BrandTheme.navyElevated)
            }

            actionsSection(contract)

            milestonesSection(contract)
        }
        .brandListBackground()
    }

    @ViewBuilder
    private func partyRow(title: String, name: String?, id: String?, isYou: Bool) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(title)
                    .font(.subheadline)
                    .foregroundStyle(BrandTheme.textSecondary)
                if isYou {
                    Text("You")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(BrandTheme.navy)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(BrandTheme.gold, in: Capsule())
                }
            }
            Text(displayName(name: name, id: id))
                .font(.body.weight(.medium))
                .foregroundStyle(BrandTheme.textPrimary)
                .textSelection(.enabled)
        }
        .padding(.vertical, 2)
    }

    private func displayName(name: String?, id: String?) -> String {
        if let name, !name.isEmpty { return name }
        if let id, !id.isEmpty { return String(id.prefix(8)) + "…" }
        return "—"
    }

    // MARK: Actions

    @ViewBuilder
    private func actionsSection(_ contract: ContractDetail) -> some View {
        let isCustomer = contract.isCustomer(userId: currentUserID)
        let isProvider = contract.isProvider(userId: currentUserID)
        let status = contract.normalizedStatus
        let hasActions = status == "pending_acceptance"
            || status == "active"
            || status == "completed"
            || status == "disputed"

        if hasActions && (isCustomer || isProvider) {
            Section {
                if status == "pending_acceptance" {
                    if !contract.partyHasAccepted(userId: currentUserID) {
                        actionButton(
                            title: "Accept contract",
                            systemImage: "checkmark.seal",
                            tint: BrandTheme.accent,
                            prominent: true
                        ) {
                            await runAction { try await APIClient.shared.acceptContract(id: contract.id) }
                        }
                    } else {
                        Text("You accepted — waiting for the other party.")
                            .font(.footnote)
                            .foregroundStyle(BrandTheme.textSecondary)
                    }
                    actionButton(
                        title: "Decline / cancel",
                        systemImage: "xmark.circle",
                        tint: BrandTheme.destructive,
                        prominent: false
                    ) {
                        showCancelConfirm = true
                    }
                }

                if status == "active" {
                    if isProvider && !contract.hasStarted {
                        actionButton(
                            title: "Start work",
                            systemImage: "play.fill",
                            tint: BrandTheme.accent,
                            prominent: true
                        ) {
                            await runAction { try await APIClient.shared.startContract(id: contract.id) }
                        }
                    }
                    if isProvider && contract.hasStarted && !contract.hasCompletedMark {
                        actionButton(
                            title: "Mark complete",
                            systemImage: "checkmark.circle",
                            tint: BrandTheme.success,
                            prominent: true
                        ) {
                            await runAction { try await APIClient.shared.completeContract(id: contract.id) }
                        }
                    }
                    if isProvider && contract.hasCompletedMark {
                        Text("Waiting for customer to approve completion.")
                            .font(.footnote)
                            .foregroundStyle(BrandTheme.textSecondary)
                    }
                    if isCustomer && contract.hasCompletedMark {
                        actionButton(
                            title: "Approve completion",
                            systemImage: "hand.thumbsup",
                            tint: BrandTheme.success,
                            prominent: true
                        ) {
                            await runAction {
                                try await APIClient.shared.approveContractCompletion(id: contract.id)
                            }
                        }
                    }
                    actionButton(
                        title: "Cancel contract",
                        systemImage: "xmark.circle",
                        tint: BrandTheme.destructive,
                        prominent: false
                    ) {
                        showCancelConfirm = true
                    }
                    actionButton(
                        title: "Open dispute",
                        systemImage: "exclamationmark.triangle",
                        tint: BrandTheme.warning,
                        prominent: false
                    ) {
                        showDisputeSheet = true
                    }
                }

                if status == "completed" {
                    actionButton(
                        title: "Leave review",
                        systemImage: "star",
                        tint: BrandTheme.accent,
                        prominent: true
                    ) {
                        showReviewSheet = true
                    }
                    actionButton(
                        title: "Open dispute",
                        systemImage: "exclamationmark.triangle",
                        tint: BrandTheme.warning,
                        prominent: false
                    ) {
                        showDisputeSheet = true
                    }
                }

                if status == "disputed" {
                    Text("This contract is under dispute. Resolution is handled by support.")
                        .font(.footnote)
                        .foregroundStyle(BrandTheme.warning)
                }
            } header: {
                Text("Actions").brandSectionHeader()
            } footer: {
                Text("Actions depend on your role (customer vs provider) and contract status. Escrow release follows mutual completion on the server.")
                    .foregroundStyle(BrandTheme.textSecondary)
            }
            .listRowBackground(BrandTheme.navyElevated)
        }
    }

    @ViewBuilder
    private func actionButton(
        title: String,
        systemImage: String,
        tint: Color,
        prominent: Bool,
        action: @escaping () async -> Void
    ) -> some View {
        Button {
            Task { await action() }
        } label: {
            if isActing {
                ProgressView()
                    .tint(prominent ? BrandTheme.navy : BrandTheme.accent)
                    .frame(maxWidth: .infinity, minHeight: 44)
            } else {
                Label(title, systemImage: systemImage)
                    .frame(maxWidth: .infinity, minHeight: 44)
            }
        }
        .buttonStyle(.borderedProminent)
        .tint(tint)
        .disabled(isActing || actingMilestoneID != nil)
        .accessibilityHint(title)
    }

    // MARK: Milestones

    @ViewBuilder
    private func milestonesSection(_ contract: ContractDetail) -> some View {
        let items = contract.resolvedMilestones.sorted {
            ($0.sortOrder ?? 0) < ($1.sortOrder ?? 0)
        }
        if !items.isEmpty {
            Section {
                ForEach(items) { milestone in
                    milestoneRow(milestone, contract: contract)
                        .listRowBackground(BrandTheme.navyElevated)
                }
            } header: {
                Text("Milestones").brandSectionHeader()
            } footer: {
                Text("Providers submit work; customers approve each milestone. For milestone payment timing, all must be approved before final completion.")
                    .foregroundStyle(BrandTheme.textSecondary)
            }
        }
    }

    @ViewBuilder
    private func milestoneRow(_ milestone: ContractMilestone, contract: ContractDetail) -> some View {
        let isCustomer = contract.isCustomer(userId: currentUserID)
        let isProvider = contract.isProvider(userId: currentUserID)

        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Text(milestone.displayDescription)
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(BrandTheme.textPrimary)
                    .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 8)
                Text(milestone.displayStatus)
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(BrandTheme.textSecondary)
            }
            Text(milestone.displayAmount)
                .font(.caption.weight(.semibold).monospacedDigit())
                .foregroundStyle(BrandTheme.goldBright)

            if let notes = milestone.revisionNotes, !notes.isEmpty {
                Text(notes)
                    .font(.caption)
                    .foregroundStyle(BrandTheme.warning)
                    .fixedSize(horizontal: false, vertical: true)
            }

            if isProvider && milestone.canSubmitAsProvider && contract.normalizedStatus == "active" {
                Button {
                    Task { await runMilestone(milestone.id) {
                        try await APIClient.shared.submitMilestone(id: milestone.id)
                    } }
                } label: {
                    if actingMilestoneID == milestone.id {
                        ProgressView()
                            .tint(BrandTheme.navy)
                            .frame(maxWidth: .infinity, minHeight: 44)
                    } else {
                        Label("Submit milestone", systemImage: "paperplane")
                            .frame(maxWidth: .infinity, minHeight: 44)
                    }
                }
                .buttonStyle(.borderedProminent)
                .tint(BrandTheme.teal)
                .disabled(isActing || actingMilestoneID != nil)
            }

            if isCustomer && milestone.canApproveAsCustomer && contract.normalizedStatus == "active" {
                Button {
                    Task { await runMilestone(milestone.id) {
                        try await APIClient.shared.approveMilestone(id: milestone.id)
                    } }
                } label: {
                    if actingMilestoneID == milestone.id {
                        ProgressView()
                            .tint(BrandTheme.navy)
                            .frame(maxWidth: .infinity, minHeight: 44)
                    } else {
                        Label("Approve milestone", systemImage: "checkmark")
                            .frame(maxWidth: .infinity, minHeight: 44)
                    }
                }
                .buttonStyle(.borderedProminent)
                .tint(BrandTheme.success)
                .disabled(isActing || actingMilestoneID != nil)
            }
        }
        .padding(.vertical, 4)
    }

    private func statusColor(_ style: StatusChipStyle) -> Color {
        switch style {
        case .success: return BrandTheme.success
        case .info: return BrandTheme.bidActive
        case .warning: return BrandTheme.warning
        case .danger: return BrandTheme.destructive
        case .neutral: return BrandTheme.textSecondary
        }
    }

    // MARK: Load / actions

    @MainActor
    private func load() async {
        guard auth.isAuthenticated, !auth.isScaffoldSession else { return }
        isLoading = contract == nil
        errorMessage = nil
        defer { isLoading = false }

        if currentUserID == nil {
            currentUserID = await APIClient.shared.currentUserID()
        }

        do {
            contract = try await APIClient.shared.fetchContract(id: contractID)
        } catch {
            if contract == nil {
                errorMessage = error.localizedDescription
            } else {
                statusIsError = true
                statusMessage = error.localizedDescription
            }
        }
    }

    @MainActor
    private func runAction(_ work: () async throws -> ContractDetail) async {
        isActing = true
        statusMessage = nil
        statusIsError = false
        defer { isActing = false }
        do {
            contract = try await work()
            statusIsError = false
            statusMessage = "Updated."
        } catch {
            statusIsError = true
            statusMessage = error.localizedDescription
        }
    }

    @MainActor
    private func runMilestone(_ id: String, _ work: () async throws -> ContractMilestone) async {
        actingMilestoneID = id
        statusMessage = nil
        statusIsError = false
        defer { actingMilestoneID = nil }
        do {
            _ = try await work()
            await load()
            statusIsError = false
            statusMessage = "Milestone updated."
        } catch {
            statusIsError = true
            statusMessage = error.localizedDescription
        }
    }
}

// MARK: - Open dispute sheet

private struct OpenDisputeSheet: View {
    let contractID: String
    var onSuccess: (String) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var disputeType: ContractDisputeType = .quality
    @State private var descriptionText = ""
    @State private var isSubmitting = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("Type", selection: $disputeType) {
                        ForEach(ContractDisputeType.allCases) { type in
                            Text(type.displayName).tag(type)
                        }
                    }
                    .listRowBackground(BrandTheme.navyElevated)

                    TextField("Describe the issue", text: $descriptionText, axis: .vertical)
                        .lineLimit(4 ... 10)
                        .listRowBackground(BrandTheme.navyElevated)
                } header: {
                    Text("Dispute").brandSectionHeader()
                } footer: {
                    Text("Opens a formal dispute on this contract. Evidence uploads are available on the web dashboard.")
                        .foregroundStyle(BrandTheme.textSecondary)
                }

                if let errorMessage {
                    Section {
                        Text(errorMessage)
                            .font(.footnote)
                            .foregroundStyle(BrandTheme.destructive)
                            .listRowBackground(BrandTheme.navyElevated)
                    }
                }
            }
            .brandListBackground()
            .navigationTitle("Open dispute")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbarBackground(BrandTheme.navy, for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }
                        .disabled(isSubmitting)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Submit") {
                        Task { await submit() }
                    }
                    .disabled(isSubmitting || descriptionText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    .fontWeight(.semibold)
                }
            }
            .overlay {
                if isSubmitting {
                    ProgressView()
                        .tint(BrandTheme.accent)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .background(BrandTheme.navy.opacity(0.4))
                }
            }
        }
        .tint(BrandTheme.accent)
        .preferredColorScheme(.dark)
    }

    @MainActor
    private func submit() async {
        errorMessage = nil
        isSubmitting = true
        defer { isSubmitting = false }
        do {
            _ = try await APIClient.shared.openContractDispute(
                id: contractID,
                disputeType: disputeType.rawValue,
                description: descriptionText
            )
            onSuccess("Dispute opened.")
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

// MARK: - Leave review sheet

private struct LeaveReviewSheet: View {
    let contractID: String
    var onSuccess: (String) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var rating = 5
    @State private var comment = ""
    @State private var isSubmitting = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Stepper(value: $rating, in: 1 ... 5) {
                        HStack {
                            Text("Rating")
                            Spacer()
                            Text("\(rating) / 5")
                                .font(.body.weight(.semibold).monospacedDigit())
                                .foregroundStyle(BrandTheme.goldBright)
                        }
                    }
                    .listRowBackground(BrandTheme.navyElevated)

                    HStack(spacing: 4) {
                        ForEach(1 ... 5, id: \.self) { star in
                            Image(systemName: star <= rating ? "star.fill" : "star")
                                .foregroundStyle(star <= rating ? BrandTheme.goldBright : BrandTheme.textSecondary)
                                .onTapGesture { rating = star }
                                .frame(minWidth: 44, minHeight: 44)
                                .contentShape(Rectangle())
                        }
                    }
                    .listRowBackground(BrandTheme.navyElevated)
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel("Rating \(rating) of 5 stars")

                    TextField("Comment (optional)", text: $comment, axis: .vertical)
                        .lineLimit(3 ... 8)
                        .listRowBackground(BrandTheme.navyElevated)
                } header: {
                    Text("Review").brandSectionHeader()
                } footer: {
                    Text("Reviews are double-blind: they become visible once both parties have submitted.")
                        .foregroundStyle(BrandTheme.textSecondary)
                }

                if let errorMessage {
                    Section {
                        Text(errorMessage)
                            .font(.footnote)
                            .foregroundStyle(BrandTheme.destructive)
                            .listRowBackground(BrandTheme.navyElevated)
                    }
                }
            }
            .brandListBackground()
            .navigationTitle("Leave review")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbarBackground(BrandTheme.navy, for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }
                        .disabled(isSubmitting)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Submit") {
                        Task { await submit() }
                    }
                    .disabled(isSubmitting)
                    .fontWeight(.semibold)
                }
            }
            .overlay {
                if isSubmitting {
                    ProgressView()
                        .tint(BrandTheme.accent)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .background(BrandTheme.navy.opacity(0.4))
                }
            }
        }
        .tint(BrandTheme.accent)
        .preferredColorScheme(.dark)
    }

    @MainActor
    private func submit() async {
        errorMessage = nil
        isSubmitting = true
        defer { isSubmitting = false }
        do {
            _ = try await APIClient.shared.createContractReview(
                id: contractID,
                rating: rating,
                comment: comment
            )
            onSuccess("Review submitted.")
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

#Preview {
    NavigationStack {
        ContractDetailView(contractID: "00000000-0000-0000-0000-000000000001")
            .environmentObject(AuthViewModel())
    }
    .preferredColorScheme(.dark)
    .tint(BrandTheme.accent)
}
