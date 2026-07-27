import SwiftUI

#if canImport(UIKit)
import UIKit
#endif

/// Contract detail — status, amount, parties, role-gated lifecycle actions,
/// milestones, change orders, tip, reports, guarantee claim, open dispute / review,
/// and customer escrow release (`POST /payments/{id}/release`).
///
/// Services escrow (not automatic on approve-completion):
/// 1. Payment held with status `escrow` after process/capture
/// 2. Provider mark complete → customer approve-completion (contract → completed)
/// 3. Customer `POST /api/v1/payments/{id}/release` (Idempotency-Key) — provider cannot self-release
/// Goods use mutual pickup on listing orders instead (see MyOrdersView).
struct ContractDetailView: View {
    let contractID: String

    @EnvironmentObject private var auth: AuthViewModel

    @State private var contract: ContractDetail?
    @State private var changeOrders: [ContractChangeOrder] = []
    @State private var guaranteeClaim: GuaranteeClaim?
    /// Payments linked to this contract (loaded via GET /payments, filtered client-side).
    @State private var contractPayments: [ContractPayment] = []
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var statusMessage: String?
    @State private var statusIsError = false
    /// Title of the lifecycle action currently in flight; only that button shows a spinner.
    @State private var actingActionTitle: String?
    /// Title of the button that opened a confirmation dialog (used when confirm runs the action).
    @State private var pendingConfirmActionTitle: String?
    @State private var actingMilestoneID: String?
    @State private var actingChangeOrderID: String?
    @State private var releasingPaymentID: String?
    @State private var currentUserID: String?
    @State private var showCancelConfirm = false
    @State private var showMarkCompleteConfirm = false
    @State private var showApproveCompletionConfirm = false
    @State private var showNoShowConfirm = false
    @State private var showAbandonmentConfirm = false
    @State private var pendingMilestoneApproveID: String?
    @State private var pendingReleasePayment: ContractPayment?
    @State private var showDisputeSheet = false
    @State private var showReviewSheet = false
    @State private var showGuaranteeClaimSheet = false

    // Change order form
    @State private var showChangeOrderForm = false
    @State private var changeOrderDescription = ""
    @State private var changeOrderAmountText = ""
    @State private var changeOrderIsReduction = false
    @State private var isSubmittingChangeOrder = false

    // Tip form
    @State private var tipAmountText = ""
    @State private var isSubmittingTip = false

    private var heldEscrowPayments: [ContractPayment] {
        contractPayments.filter(\.isHeldInEscrow)
    }

    private var releasedEscrowPayments: [ContractPayment] {
        contractPayments.filter(\.isReleased)
    }

    var body: some View {
        contractBody
            .navigationTitle(contract?.displayTitle ?? "Contract")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbarBackground(BrandTheme.navy, for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
            .task { await load() }
            .refreshable { await load() }
            .modifier(ContractSheetsModifier(
                showDisputeSheet: $showDisputeSheet,
                showReviewSheet: $showReviewSheet,
                showGuaranteeClaimSheet: $showGuaranteeClaimSheet,
                contractID: contract?.id,
                onMessage: { message in
                    statusIsError = false
                    statusMessage = message
                    Task { await load() }
                }
            ))
            .modifier(ContractConfirmationsModifier(
                showCancelConfirm: $showCancelConfirm,
                showMarkCompleteConfirm: $showMarkCompleteConfirm,
                showApproveCompletionConfirm: $showApproveCompletionConfirm,
                showNoShowConfirm: $showNoShowConfirm,
                showAbandonmentConfirm: $showAbandonmentConfirm,
                pendingMilestoneApproveID: $pendingMilestoneApproveID,
                pendingReleasePayment: $pendingReleasePayment,
                onCancel: {
                    Task {
                        await runAction(title: pendingConfirmActionTitle ?? "Cancel contract") {
                            try await APIClient.shared.cancelContract(id: contractID)
                        }
                    }
                },
                onMarkComplete: {
                    Task {
                        await runAction(title: pendingConfirmActionTitle ?? "Mark complete") {
                            try await APIClient.shared.completeContract(id: contractID)
                        }
                    }
                },
                onApproveCompletion: {
                    Task {
                        await runAction(
                            title: pendingConfirmActionTitle ?? "Approve completion",
                            successMessage: "Completion approved. If funds are still held, release escrow next to pay the provider."
                        ) {
                            try await APIClient.shared.approveContractCompletion(id: contractID)
                        }
                    }
                },
                onReportNoShow: {
                    Task {
                        await runAction(title: pendingConfirmActionTitle ?? "Report no-show") {
                            try await APIClient.shared.reportContractNoShow(id: contractID)
                        }
                    }
                },
                onReportAbandonment: {
                    Task {
                        await runAction(title: pendingConfirmActionTitle ?? "Report abandonment") {
                            try await APIClient.shared.reportContractAbandonment(id: contractID)
                        }
                    }
                },
                onApproveMilestone: { mid in
                    Task {
                        await runMilestone(mid) {
                            try await APIClient.shared.approveMilestone(id: mid)
                        }
                    }
                },
                onReleaseEscrow: { payment in
                    Task { await releaseEscrow(payment) }
                }
            ))
    }

    @ViewBuilder
    private var contractBody: some View {
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

            escrowSection(contract)

            milestonesSection(contract)

            changeOrdersSection(contract)

            tipSection(contract)

            reportsSection(contract)

            guaranteeSection(contract)

            documentsSection(contract)
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
                            await runAction(title: "Accept contract") {
                                try await APIClient.shared.acceptContract(id: contract.id)
                            }
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
                        pendingConfirmActionTitle = "Decline / cancel"
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
                            await runAction(title: "Start work") {
                                try await APIClient.shared.startContract(id: contract.id)
                            }
                        }
                    }
                    if isProvider && contract.hasStarted && !contract.hasCompletedMark {
                        actionButton(
                            title: "Mark complete",
                            systemImage: "checkmark.circle",
                            tint: BrandTheme.success,
                            prominent: true
                        ) {
                            pendingConfirmActionTitle = "Mark complete"
                            showMarkCompleteConfirm = true
                        }
                    }
                    if isProvider && contract.hasCompletedMark {
                        Text("Waiting for customer to approve completion. Escrow release is a separate customer step after approval.")
                            .font(.footnote)
                            .foregroundStyle(BrandTheme.textSecondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    if isCustomer && contract.hasCompletedMark {
                        Text("Next: approve completion to finalize the job, then release escrow if funds are still held.")
                            .font(.caption.weight(.medium))
                            .foregroundStyle(BrandTheme.goldBright.opacity(0.95))
                            .fixedSize(horizontal: false, vertical: true)
                        actionButton(
                            title: "Approve completion",
                            systemImage: "hand.thumbsup",
                            tint: BrandTheme.success,
                            prominent: true
                        ) {
                            pendingConfirmActionTitle = "Approve completion"
                            showApproveCompletionConfirm = true
                        }
                    }
                    actionButton(
                        title: "Cancel contract",
                        systemImage: "xmark.circle",
                        tint: BrandTheme.destructive,
                        prominent: false
                    ) {
                        pendingConfirmActionTitle = "Cancel contract"
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
                    if isCustomer && !heldEscrowPayments.isEmpty {
                        Text("Next: release escrow below to pay the provider. Approve-completion does not move money by itself.")
                            .font(.caption.weight(.medium))
                            .foregroundStyle(BrandTheme.goldBright.opacity(0.95))
                            .fixedSize(horizontal: false, vertical: true)
                    }
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
                Text("Approve completion finalizes the contract status. Releasing held escrow is a separate customer action (POST /payments/{id}/release). Providers cannot self-release. Amounts are server-side only.")
                    .foregroundStyle(BrandTheme.textSecondary)
            }
            .listRowBackground(BrandTheme.navyElevated)
        }
    }

    // MARK: Escrow / payment release

    @ViewBuilder
    private func escrowSection(_ contract: ContractDetail) -> some View {
        let isCustomer = contract.isCustomer(userId: currentUserID)
        let isProvider = contract.isProvider(userId: currentUserID)
        let held = heldEscrowPayments
        let released = releasedEscrowPayments

        // Surface when there are payment rows, or when completion is in play
        // (customer may still need to release after approve-completion).
        let relevantStage = contract.normalizedStatus == "completed"
            || contract.normalizedStatus == "active"
            || contract.hasCompletedMark
        let hasRows = !held.isEmpty || !released.isEmpty
        if (isCustomer || isProvider) && (hasRows || relevantStage) {
            Section {
                if held.isEmpty && released.isEmpty {
                    Text(
                        isCustomer
                            ? "No held escrow payment found for this contract yet. When a payment is in escrow, you can release it here after work is approved."
                            : "No held escrow payment found for this contract yet. When funds are held, only the customer can release them to you."
                    )
                    .font(.footnote)
                    .foregroundStyle(BrandTheme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .listRowBackground(BrandTheme.navyElevated)
                }

                ForEach(held) { payment in
                    VStack(alignment: .leading, spacing: 10) {
                        HStack(alignment: .firstTextBaseline) {
                            Text(payment.displayAmount)
                                .font(.body.weight(.semibold).monospacedDigit())
                                .foregroundStyle(BrandTheme.goldBright)
                            Spacer()
                            Text("Held in escrow")
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(BrandTheme.warning)
                        }
                        if let payout = payment.displayProviderPayout {
                            Text("Provider payout (server): \(payout)")
                                .font(.caption.monospacedDigit())
                                .foregroundStyle(BrandTheme.textSecondary)
                        }
                        Text("Payment \(String(payment.id.prefix(8)))…")
                            .font(.caption2.monospaced())
                            .foregroundStyle(BrandTheme.textSecondary)
                            .textSelection(.enabled)

                        if isCustomer && payment.canReleaseAsCustomer(userId: currentUserID) {
                            Button {
                                pendingReleasePayment = payment
                            } label: {
                                if releasingPaymentID == payment.id {
                                    ProgressView()
                                        .tint(BrandTheme.navy)
                                        .frame(maxWidth: .infinity, minHeight: 44)
                                } else {
                                    Label("Release escrow · \(payment.displayAmount)", systemImage: "lock.open")
                                        .frame(maxWidth: .infinity, minHeight: 44)
                                }
                            }
                            .buttonStyle(.borderedProminent)
                            .tint(BrandTheme.success)
                            .disabled(
                                releasingPaymentID != nil
                                    || actingActionTitle != nil
                                    || actingMilestoneID != nil
                            )
                            .accessibilityHint("Calls POST /payments/{id}/release with Idempotency-Key; pays the provider from held escrow")
                        } else if isProvider {
                            Text("Waiting for the customer to release escrow. You cannot release your own payout.")
                                .font(.footnote)
                                .foregroundStyle(BrandTheme.textSecondary)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                    .padding(.vertical, 4)
                    .listRowBackground(BrandTheme.navyElevated)
                }

                ForEach(released) { payment in
                    HStack {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(payment.displayAmount)
                                .font(.subheadline.weight(.semibold).monospacedDigit())
                                .foregroundStyle(BrandTheme.goldBright)
                            Text(payment.displayStatus)
                                .font(.caption)
                                .foregroundStyle(BrandTheme.success)
                        }
                        Spacer()
                        Image(systemName: "checkmark.seal.fill")
                            .foregroundStyle(BrandTheme.success)
                            .accessibilityHidden(true)
                    }
                    .listRowBackground(BrandTheme.navyElevated)
                    .accessibilityElement(children: .combine)
                }
            } header: {
                Text("Escrow").brandSectionHeader()
            } footer: {
                Text("Customer releases via real endpoint POST /api/v1/payments/{id}/release (auth + Idempotency-Key). Display amounts are server fields only — no client fee math. Goods orders release via pickup handshake, not this control.")
                    .foregroundStyle(BrandTheme.textSecondary)
            }
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
        let isThisActing = actingActionTitle == title
        Button {
            Task { await action() }
        } label: {
            if isThisActing {
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
        .disabled(
            actingActionTitle != nil
                || actingMilestoneID != nil
                || actingChangeOrderID != nil
                || releasingPaymentID != nil
        )
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
                .disabled(actingActionTitle != nil || actingMilestoneID != nil)
            }

            if isCustomer && milestone.canApproveAsCustomer && contract.normalizedStatus == "active" {
                Button {
                    pendingMilestoneApproveID = milestone.id
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
                .disabled(actingActionTitle != nil || actingMilestoneID != nil)
                .accessibilityHint("Confirm before approving this milestone payment step")
            }
        }
        .padding(.vertical, 4)
    }

    // MARK: Change orders

    @ViewBuilder
    private func changeOrdersSection(_ contract: ContractDetail) -> some View {
        let isParty = contract.isCustomer(userId: currentUserID) || contract.isProvider(userId: currentUserID)
        let canPropose = isParty && contract.normalizedStatus == "active"
        let orders = resolvedChangeOrders(for: contract)

        if canPropose || !orders.isEmpty {
            Section {
                if canPropose {
                    Button {
                        showChangeOrderForm.toggle()
                    } label: {
                        Label(
                            showChangeOrderForm ? "Hide change order form" : "Propose change order",
                            systemImage: showChangeOrderForm ? "chevron.up" : "plus.circle"
                        )
                        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                    }
                    .tint(BrandTheme.accent)
                    .listRowBackground(BrandTheme.navyElevated)

                    if showChangeOrderForm {
                        changeOrderForm(contract)
                            .listRowBackground(BrandTheme.navyElevated)
                    }
                }

                if orders.isEmpty {
                    Text("No change orders yet.")
                        .font(.footnote)
                        .foregroundStyle(BrandTheme.textSecondary)
                        .listRowBackground(BrandTheme.navyElevated)
                } else {
                    ForEach(orders) { order in
                        changeOrderRow(order, contract: contract)
                            .listRowBackground(BrandTheme.navyElevated)
                    }
                }
            } header: {
                Text("Change orders").brandSectionHeader()
            } footer: {
                Text("Scope or price adjustments require the other party’s approval before the contract amount changes.")
                    .foregroundStyle(BrandTheme.textSecondary)
            }
        }
    }

    @ViewBuilder
    private func changeOrderForm(_ contract: ContractDetail) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Description")
                .font(.caption.weight(.semibold))
                .foregroundStyle(BrandTheme.textSecondary)
            TextField("Describe the scope or price change", text: $changeOrderDescription, axis: .vertical)
                .lineLimit(3 ... 8)
                .foregroundStyle(BrandTheme.textPrimary)

            Picker("Adjustment", selection: $changeOrderIsReduction) {
                Text("Add").tag(false)
                Text("Reduce").tag(true)
            }
            .pickerStyle(.segmented)
            .accessibilityLabel("Amount adjustment direction")

            DollarAmountField(
                text: $changeOrderAmountText,
                placeholder: "0.00",
                accessibilityLabelText: changeOrderIsReduction
                    ? "Amount to reduce in dollars"
                    : "Amount to add in dollars"
            )

            Button {
                Task { await submitChangeOrder(contract) }
            } label: {
                if isSubmittingChangeOrder {
                    ProgressView()
                        .tint(BrandTheme.navy)
                        .frame(maxWidth: .infinity, minHeight: 44)
                } else {
                    Label("Submit change order", systemImage: "doc.badge.plus")
                        .frame(maxWidth: .infinity, minHeight: 44)
                }
            }
            .buttonStyle(.borderedProminent)
            .tint(BrandTheme.gold)
            .disabled(
                isSubmittingChangeOrder
                    || changeOrderDescription.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                    || MoneyFormat.cents(fromDollarsText: changeOrderAmountText) == nil
                    || actingActionTitle != nil
            )
        }
        .padding(.vertical, 4)
    }

    @ViewBuilder
    private func changeOrderRow(_ order: ContractChangeOrder, contract: ContractDetail) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Text(order.displayDescription)
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(BrandTheme.textPrimary)
                    .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 8)
                Text(order.displayStatus)
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(BrandTheme.textSecondary)
            }

            Text(order.displayAmountDelta)
                .font(.caption.weight(.semibold).monospacedDigit())
                .foregroundStyle(
                    (order.amountDeltaCents ?? 0) >= 0 ? BrandTheme.goldBright : BrandTheme.warning
                )

            if let proposedBy = order.proposedBy, !proposedBy.isEmpty {
                Text("Proposed by \(String(proposedBy.prefix(8)))…")
                    .font(.caption2)
                    .foregroundStyle(BrandTheme.textSecondary)
            }

            if let created = order.createdAt, !created.isEmpty {
                Text(CatalogDateFormat.friendlyDateTime(created))
                    .font(.caption2)
                    .foregroundStyle(BrandTheme.textSecondary)
            }

            if order.canRespond(as: currentUserID, contract: contract) {
                HStack(spacing: 10) {
                    Button {
                        Task { await respondToChangeOrder(order, contract: contract, accepted: true) }
                    } label: {
                        if actingChangeOrderID == order.id {
                            ProgressView()
                                .tint(BrandTheme.navy)
                                .frame(maxWidth: .infinity, minHeight: 44)
                        } else {
                            Label("Accept", systemImage: "checkmark")
                                .frame(maxWidth: .infinity, minHeight: 44)
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(BrandTheme.success)
                    .disabled(actingChangeOrderID != nil || actingActionTitle != nil)

                    Button {
                        Task { await respondToChangeOrder(order, contract: contract, accepted: false) }
                    } label: {
                        Label("Reject", systemImage: "xmark")
                            .frame(maxWidth: .infinity, minHeight: 44)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(BrandTheme.destructive)
                    .disabled(actingChangeOrderID != nil || actingActionTitle != nil)
                }
            }
        }
        .padding(.vertical, 4)
    }

    // MARK: Tip

    @ViewBuilder
    private func tipSection(_ contract: ContractDetail) -> some View {
        let isCustomer = contract.isCustomer(userId: currentUserID)
        if isCustomer && contract.normalizedStatus == "completed" {
            Section {
                if let tip = contract.tipAmountCents, tip > 0 {
                    HStack(spacing: 8) {
                        Image(systemName: "heart.fill")
                            .foregroundStyle(BrandTheme.success)
                        Text("You tipped \(MoneyFormat.usd(cents: tip)) — thank you.")
                            .font(.subheadline)
                            .foregroundStyle(BrandTheme.success)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .listRowBackground(BrandTheme.navyElevated)
                } else {
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Show appreciation for great work. Tips are optional and separate from the contract amount.")
                            .font(.footnote)
                            .foregroundStyle(BrandTheme.textSecondary)
                            .fixedSize(horizontal: false, vertical: true)

                        DollarAmountField(
                            text: $tipAmountText,
                            placeholder: "10.00",
                            accessibilityLabelText: "Tip amount in dollars"
                        )

                        Button {
                            Task { await submitTip(contract) }
                        } label: {
                            if isSubmittingTip {
                                ProgressView()
                                    .tint(BrandTheme.navy)
                                    .frame(maxWidth: .infinity, minHeight: 44)
                            } else if let cents = MoneyFormat.cents(fromDollarsText: tipAmountText) {
                                Label("Send tip · \(MoneyFormat.usd(cents: cents))", systemImage: "heart")
                                    .frame(maxWidth: .infinity, minHeight: 44)
                            } else {
                                Label("Send tip", systemImage: "heart")
                                    .frame(maxWidth: .infinity, minHeight: 44)
                            }
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(BrandTheme.accent)
                        .disabled(
                            isSubmittingTip
                                || MoneyFormat.cents(fromDollarsText: tipAmountText) == nil
                                || actingActionTitle != nil
                        )
                    }
                    .padding(.vertical, 4)
                    .listRowBackground(BrandTheme.navyElevated)
                }
            } header: {
                Text("Tip your provider").brandSectionHeader()
            } footer: {
                Text("Minimum $1.00. Tips require payment capture on the server; if tipping is not yet available you will see a clear message.")
                    .foregroundStyle(BrandTheme.textSecondary)
            }
        }
    }

    // MARK: Reports

    @ViewBuilder
    private func reportsSection(_ contract: ContractDetail) -> some View {
        let isCustomer = contract.isCustomer(userId: currentUserID)
        let status = contract.normalizedStatus
        // Customer may report issues while the job is expected to be underway.
        let canReport = isCustomer && (status == "active" || status == "pending_acceptance")

        if canReport {
            Section {
                actionButton(
                    title: "Report no-show",
                    systemImage: "person.crop.circle.badge.xmark",
                    tint: BrandTheme.warning,
                    prominent: false
                ) {
                    pendingConfirmActionTitle = "Report no-show"
                    showNoShowConfirm = true
                }
                actionButton(
                    title: "Report abandonment",
                    systemImage: "flag",
                    tint: BrandTheme.destructive,
                    prominent: false
                ) {
                    pendingConfirmActionTitle = "Report abandonment"
                    showAbandonmentConfirm = true
                }
            } header: {
                Text("Reports").brandSectionHeader()
            } footer: {
                Text("Use these only when the provider did not appear or walked away mid-job. This may suspend or cancel the contract per platform rules.")
                    .foregroundStyle(BrandTheme.textSecondary)
            }
            .listRowBackground(BrandTheme.navyElevated)
        }
    }

    // MARK: Guarantee claim

    @ViewBuilder
    private func guaranteeSection(_ contract: ContractDetail) -> some View {
        let isCustomer = contract.isCustomer(userId: currentUserID)
        let status = contract.normalizedStatus
        let showForCustomer = isCustomer && (status == "completed" || status == "disputed" || guaranteeClaim != nil)
        let showForAnyParty = guaranteeClaim != nil
            && (contract.isCustomer(userId: currentUserID) || contract.isProvider(userId: currentUserID))

        if showForCustomer || showForAnyParty {
            Section {
                if let claim = guaranteeClaim {
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            Text(claim.displayType)
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(BrandTheme.textPrimary)
                            Spacer()
                            Text(claim.displayStatus)
                                .font(.caption2.weight(.semibold))
                                .foregroundStyle(BrandTheme.warning)
                        }
                        Text(claim.displayDescription)
                            .font(.footnote)
                            .foregroundStyle(BrandTheme.textSecondary)
                            .fixedSize(horizontal: false, vertical: true)
                        if let notes = claim.resolutionNotes, !notes.isEmpty {
                            Text(notes)
                                .font(.caption)
                                .foregroundStyle(BrandTheme.success)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        if let created = claim.createdAt, !created.isEmpty {
                            Text("Filed \(CatalogDateFormat.friendlyDateTime(created))")
                                .font(.caption2)
                                .foregroundStyle(BrandTheme.textSecondary)
                        }
                    }
                    .padding(.vertical, 4)
                    .listRowBackground(BrandTheme.navyElevated)
                } else if isCustomer && status == "completed" {
                    Text("The NoMarkup Guarantee covers eligible completed jobs when work is not as agreed.")
                        .font(.footnote)
                        .foregroundStyle(BrandTheme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                        .listRowBackground(BrandTheme.navyElevated)

                    actionButton(
                        title: "File guarantee claim",
                        systemImage: "shield.checkered",
                        tint: BrandTheme.gold,
                        prominent: true
                    ) {
                        showGuaranteeClaimSheet = true
                    }
                }
            } header: {
                Text("NoMarkup Guarantee").brandSectionHeader()
            } footer: {
                Text("Claims are reviewed by support. Evidence uploads are available on the web dashboard.")
                    .foregroundStyle(BrandTheme.textSecondary)
            }
            .listRowBackground(BrandTheme.navyElevated)
        }
    }

    // MARK: Documents

    @ViewBuilder
    private func documentsSection(_ contract: ContractDetail) -> some View {
        Section {
            actionButton(
                title: "Open contract PDF",
                systemImage: "doc.richtext",
                tint: BrandTheme.teal,
                prominent: false
            ) {
                await openContractPDF(contract)
            }
        } header: {
            Text("Documents").brandSectionHeader()
        } footer: {
            Text("Opens the export URL in Safari when available.")
                .foregroundStyle(BrandTheme.textSecondary)
        }
        .listRowBackground(BrandTheme.navyElevated)
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

    private func resolvedChangeOrders(for contract: ContractDetail) -> [ContractChangeOrder] {
        if !changeOrders.isEmpty { return changeOrders }
        return contract.changeOrders ?? []
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
            let detail = try await APIClient.shared.fetchContract(id: contractID)
            contract = detail

            // Prefer dedicated list endpoint; fall back to embedded change_orders.
            // Fetch change orders + claim + escrow payments in parallel after detail.
            async let ordersResult = Self.loadChangeOrders(
                contractId: contractID,
                fallback: detail.changeOrders ?? []
            )
            async let claimResult = Self.loadGuaranteeClaim(contractId: contractID)
            async let paymentsResult = Self.loadContractPayments(contractId: contractID)
            changeOrders = await ordersResult
            guaranteeClaim = await claimResult
            contractPayments = await paymentsResult
        } catch {
            if contract == nil {
                errorMessage = error.localizedDescription
            } else {
                statusIsError = true
                statusMessage = error.localizedDescription
            }
        }
    }

    private static func loadChangeOrders(
        contractId: String,
        fallback: [ContractChangeOrder]
    ) async -> [ContractChangeOrder] {
        do {
            return try await APIClient.shared.fetchChangeOrders(contractId: contractId)
        } catch {
            return fallback
        }
    }

    private static func loadGuaranteeClaim(contractId: String) async -> GuaranteeClaim? {
        try? await APIClient.shared.fetchGuaranteeClaim(contractId: contractId)
    }

    /// Load held + released payments for this contract. Fail-soft on list errors.
    private static func loadContractPayments(contractId: String) async -> [ContractPayment] {
        // Two status filters (escrow + released) so the CTA and “already paid”
        // states both work without pulling the full history.
        async let escrow = (try? await APIClient.shared.fetchPaymentsForContract(
            contractId: contractId,
            status: "escrow"
        )) ?? []
        async let released = (try? await APIClient.shared.fetchPaymentsForContract(
            contractId: contractId,
            status: "released"
        )) ?? []
        let held = await escrow
        let done = await released
        var byID: [String: ContractPayment] = [:]
        for payment in held + done {
            byID[payment.id] = payment
        }
        return Array(byID.values).sorted { lhs, rhs in
            (lhs.createdAt ?? "") > (rhs.createdAt ?? "")
        }
    }

    @MainActor
    private func runAction(
        title: String,
        successMessage: String = "Updated.",
        _ work: () async throws -> ContractDetail
    ) async {
        actingActionTitle = title
        pendingConfirmActionTitle = nil
        statusMessage = nil
        statusIsError = false
        defer { actingActionTitle = nil }
        do {
            contract = try await work()
            statusIsError = false
            statusMessage = successMessage
            // Refresh side data (change orders / claim / escrow) after lifecycle mutations.
            await refreshSideData()
        } catch let error as APIClientError where error.isUnauthorized {
            statusIsError = true
            statusMessage = "Sign in required. Your session is missing or expired — please sign in again."
        } catch {
            statusIsError = true
            statusMessage = error.localizedDescription
        }
    }

    @MainActor
    private func releaseEscrow(_ payment: ContractPayment) async {
        releasingPaymentID = payment.id
        statusMessage = nil
        statusIsError = false
        defer { releasingPaymentID = nil }
        do {
            let updated = try await APIClient.shared.releasePayment(
                paymentId: payment.id,
                reason: "customer approved completion"
            )
            if let idx = contractPayments.firstIndex(where: { $0.id == payment.id }) {
                contractPayments[idx] = updated
            } else {
                contractPayments.insert(updated, at: 0)
            }
            statusIsError = false
            statusMessage = "Escrow released — \(updated.displayAmount) payout path advanced on the server."
            await refreshSideData()
        } catch let error as APIClientError where error.isUnauthorized {
            statusIsError = true
            statusMessage = "Sign in required. Your session is missing or expired — please sign in again."
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

    @MainActor
    private func refreshSideData() async {
        async let orders = Self.loadChangeOrders(
            contractId: contractID,
            fallback: contract?.changeOrders ?? []
        )
        async let claim = Self.loadGuaranteeClaim(contractId: contractID)
        async let payments = Self.loadContractPayments(contractId: contractID)
        changeOrders = await orders
        guaranteeClaim = await claim
        contractPayments = await payments
    }

    @MainActor
    private func submitChangeOrder(_ contract: ContractDetail) async {
        guard let absCents = MoneyFormat.cents(fromDollarsText: changeOrderAmountText) else {
            statusIsError = true
            statusMessage = "Enter a valid dollar amount for the change order."
            return
        }
        let delta = changeOrderIsReduction ? -absCents : absCents
        isSubmittingChangeOrder = true
        statusMessage = nil
        statusIsError = false
        defer { isSubmittingChangeOrder = false }
        do {
            let created = try await APIClient.shared.createChangeOrder(
                contractId: contract.id,
                description: changeOrderDescription,
                amountDeltaCents: delta
            )
            changeOrders.insert(created, at: 0)
            changeOrderDescription = ""
            changeOrderAmountText = ""
            changeOrderIsReduction = false
            showChangeOrderForm = false
            statusIsError = false
            statusMessage = "Change order proposed."
            await load()
        } catch {
            statusIsError = true
            statusMessage = error.localizedDescription
        }
    }

    @MainActor
    private func respondToChangeOrder(
        _ order: ContractChangeOrder,
        contract: ContractDetail,
        accepted: Bool
    ) async {
        actingChangeOrderID = order.id
        statusMessage = nil
        statusIsError = false
        defer { actingChangeOrderID = nil }
        do {
            let updated = try await APIClient.shared.respondToChangeOrder(
                contractId: contract.id,
                orderId: order.id,
                accepted: accepted
            )
            if let idx = changeOrders.firstIndex(where: { $0.id == order.id }) {
                changeOrders[idx] = updated
            }
            statusIsError = false
            statusMessage = accepted ? "Change order accepted." : "Change order rejected."
            await load()
        } catch {
            statusIsError = true
            statusMessage = error.localizedDescription
        }
    }

    @MainActor
    private func submitTip(_ contract: ContractDetail) async {
        guard let cents = MoneyFormat.cents(fromDollarsText: tipAmountText) else {
            statusIsError = true
            statusMessage = "Enter a valid tip amount in dollars."
            return
        }
        isSubmittingTip = true
        statusMessage = nil
        statusIsError = false
        defer { isSubmittingTip = false }
        do {
            _ = try await APIClient.shared.tipContract(id: contract.id, amountCents: cents)
            tipAmountText = ""
            statusIsError = false
            statusMessage = "Tip submitted."
            await load()
        } catch {
            statusIsError = true
            statusMessage = error.localizedDescription
        }
    }

    @MainActor
    private func openContractPDF(_ contract: ContractDetail) async {
        actingActionTitle = "Open contract PDF"
        statusMessage = nil
        statusIsError = false
        defer { actingActionTitle = nil }
        do {
            guard let url = try await APIClient.shared.fetchContractPDFURL(id: contract.id) else {
                statusIsError = true
                statusMessage = "No PDF URL is available for this contract yet."
                return
            }
            #if canImport(UIKit)
            await MainActor.run {
                UIApplication.shared.open(url)
            }
            #endif
            statusIsError = false
            statusMessage = "Opened contract PDF."
        } catch {
            statusIsError = true
            statusMessage = error.localizedDescription
        }
    }
}

// MARK: - Sheets / confirms (split for type-checker)

private struct ContractSheetsModifier: ViewModifier {
    @Binding var showDisputeSheet: Bool
    @Binding var showReviewSheet: Bool
    @Binding var showGuaranteeClaimSheet: Bool
    let contractID: String?
    let onMessage: (String) -> Void

    func body(content: Content) -> some View {
        content
            .sheet(isPresented: $showDisputeSheet) {
                if let contractID {
                    OpenDisputeSheet(contractID: contractID, onSuccess: onMessage)
                }
            }
            .sheet(isPresented: $showReviewSheet) {
                if let contractID {
                    LeaveReviewSheet(contractID: contractID, onSuccess: onMessage)
                }
            }
            .sheet(isPresented: $showGuaranteeClaimSheet) {
                if let contractID {
                    GuaranteeClaimSheet(contractID: contractID, onSuccess: onMessage)
                }
            }
    }
}

private struct ContractConfirmationsModifier: ViewModifier {
    @Binding var showCancelConfirm: Bool
    @Binding var showMarkCompleteConfirm: Bool
    @Binding var showApproveCompletionConfirm: Bool
    @Binding var showNoShowConfirm: Bool
    @Binding var showAbandonmentConfirm: Bool
    @Binding var pendingMilestoneApproveID: String?
    @Binding var pendingReleasePayment: ContractPayment?
    let onCancel: () -> Void
    let onMarkComplete: () -> Void
    let onApproveCompletion: () -> Void
    let onReportNoShow: () -> Void
    let onReportAbandonment: () -> Void
    let onApproveMilestone: (String) -> Void
    let onReleaseEscrow: (ContractPayment) -> Void

    func body(content: Content) -> some View {
        content
            .confirmationDialog(
                "Cancel this contract?",
                isPresented: $showCancelConfirm,
                titleVisibility: .visible
            ) {
                Button("Cancel contract", role: .destructive, action: onCancel)
                Button("Keep contract", role: .cancel) {}
            } message: {
                Text("This cannot be undone. Escrow rules on the server still apply.")
            }
            .confirmationDialog(
                "Mark this job complete?",
                isPresented: $showMarkCompleteConfirm,
                titleVisibility: .visible
            ) {
                Button("Mark complete", action: onMarkComplete)
                Button("Not yet", role: .cancel) {}
            } message: {
                Text("The customer will be asked to approve completion. Escrow release is a separate customer step after approval.")
            }
            .confirmationDialog(
                "Approve completion?",
                isPresented: $showApproveCompletionConfirm,
                titleVisibility: .visible
            ) {
                Button("Approve completion", action: onApproveCompletion)
                Button("Not yet", role: .cancel) {}
            } message: {
                Text("Finalizes the contract as completed. This does not by itself transfer escrow — use Release escrow when funds are held.")
            }
            .confirmationDialog(
                "Report provider no-show?",
                isPresented: $showNoShowConfirm,
                titleVisibility: .visible
            ) {
                Button("Report no-show", role: .destructive, action: onReportNoShow)
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("Only use this if the provider failed to appear for scheduled work. This may cancel or suspend the contract.")
            }
            .confirmationDialog(
                "Report abandonment?",
                isPresented: $showAbandonmentConfirm,
                titleVisibility: .visible
            ) {
                Button("Report abandonment", role: .destructive, action: onReportAbandonment)
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("Only use this if the provider started work and then left without finishing. Support may review.")
            }
            .confirmationDialog(
                "Approve this milestone?",
                isPresented: Binding(
                    get: { pendingMilestoneApproveID != nil },
                    set: { if !$0 { pendingMilestoneApproveID = nil } }
                ),
                titleVisibility: .visible
            ) {
                Button("Approve milestone") {
                    guard let mid = pendingMilestoneApproveID else { return }
                    pendingMilestoneApproveID = nil
                    onApproveMilestone(mid)
                }
                Button("Cancel", role: .cancel) {
                    pendingMilestoneApproveID = nil
                }
            } message: {
                Text("Approves the milestone on the contract. Escrow release still uses the payment release action when funds are held.")
            }
            .confirmationDialog(
                "Release escrow to the provider?",
                isPresented: Binding(
                    get: { pendingReleasePayment != nil },
                    set: { if !$0 { pendingReleasePayment = nil } }
                ),
                titleVisibility: .visible
            ) {
                Button("Release escrow") {
                    guard let payment = pendingReleasePayment else { return }
                    pendingReleasePayment = nil
                    onReleaseEscrow(payment)
                }
                Button("Not yet", role: .cancel) {
                    pendingReleasePayment = nil
                }
            } message: {
                if let payment = pendingReleasePayment {
                    Text("Calls POST /payments/\(payment.id)/release with your auth and an Idempotency-Key. Server amount: \(payment.displayAmount). Providers cannot self-release.")
                } else {
                    Text("Releases held escrow to the provider. Server amounts only.")
                }
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

// MARK: - Guarantee claim sheet

private struct GuaranteeClaimSheet: View {
    let contractID: String
    var onSuccess: (String) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var reason: GuaranteeClaimReason = .quality
    @State private var descriptionText = ""
    @State private var isSubmitting = false
    @State private var errorMessage: String?

    private var descriptionValid: Bool {
        descriptionText.trimmingCharacters(in: .whitespacesAndNewlines).count >= 50
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("Reason", selection: $reason) {
                        ForEach(GuaranteeClaimReason.allCases) { item in
                            Text(item.displayName).tag(item)
                        }
                    }
                    .listRowBackground(BrandTheme.navyElevated)

                    TextField(
                        "Describe what went wrong (min 50 characters)",
                        text: $descriptionText,
                        axis: .vertical
                    )
                    .lineLimit(5 ... 12)
                    .listRowBackground(BrandTheme.navyElevated)

                    Text("\(descriptionText.trimmingCharacters(in: .whitespacesAndNewlines).count) / 50 min")
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(descriptionValid ? BrandTheme.success : BrandTheme.textSecondary)
                        .listRowBackground(BrandTheme.navyElevated)
                } header: {
                    Text("Guarantee claim").brandSectionHeader()
                } footer: {
                    Text("Files a NoMarkup Guarantee claim on this completed contract. Photo evidence can be added on the web dashboard.")
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
            .navigationTitle("Guarantee claim")
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
                    .disabled(isSubmitting || !descriptionValid)
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
            _ = try await APIClient.shared.submitGuaranteeClaim(
                contractId: contractID,
                reason: reason.rawValue,
                description: descriptionText
            )
            onSuccess("Guarantee claim submitted.")
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
