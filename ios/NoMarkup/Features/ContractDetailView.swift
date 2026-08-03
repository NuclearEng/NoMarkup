import PhotosUI
import SwiftUI

#if canImport(UIKit)
import UIKit
#endif

/// Contract detail — status, amount, parties, role-gated lifecycle actions,
/// milestones, change orders, tip, reports, guarantee claim, open dispute / review,
/// customer services pay/hold escrow (FR-9), and escrow release (`POST /payments/{id}/release`).
///
/// Services escrow (not automatic on approve-completion):
/// 1. Customer pays via PaymentSheet (`POST /payments` + confirm + `…/process`) → status `escrow`
/// 2. Provider mark complete → customer approve-completion (contract → completed)
/// 3. Customer `POST /api/v1/payments/{id}/release` (Idempotency-Key) — provider cannot self-release
/// Goods use mutual pickup on listing orders instead (see MyOrdersView).
struct ContractDetailView: View {
    let contractID: String
    /// When opened from Siri / check-in deep link, attempt GPS check-in once after load.
    var autoCheckInOnAppear: Bool = false

    @EnvironmentObject private var auth: AuthViewModel
    @Environment(\.openURL) private var openURL

    @State private var contract: ContractDetail?
    @State private var changeOrders: [ContractChangeOrder] = []
    @State private var guaranteeClaim: GuaranteeClaim?
    /// Payments linked to this contract (loaded via GET /payments, filtered client-side).
    @State private var contractPayments: [ContractPayment] = []
    /// Server fee breakdown for display only (`POST /payments/calculate-fees`).
    @State private var feeBreakdown: PaymentFeeBreakdown?
    /// Exact service address from linked job (party-only; server-gated on GET /jobs/{id}).
    @State private var serviceExactAddress: JobExactAddress?
    /// FR-18.7 deepen: property/category/starting bid from linked job (fail-soft).
    @State private var repostPropertyId: String?
    @State private var repostCategoryId: String?
    @State private var repostCategoryName: String?
    @State private var repostStartingBidCents: Int64?
    /// FR-18 recurring schedule + instance timeline (loaded fail-soft).
    @State private var recurringConfig: ContractRecurringConfig?
    @State private var recurringInstances: [ContractRecurringInstance] = []
    @State private var actingRecurringInstanceID: String?
    /// Pending PI from approve or complete+auto-approve — pay CTA only when client_secret is real.
    @State private var pendingRecurringPay: RecurringApproveResult?
    @State private var isPayingRecurringInstance = false
    @State private var showCancelRecurringConfirm = false
    /// FR-18.4: draft rate (dollars) for proposed future-instance rate update.
    @State private var recurringRateText = ""
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
    /// True while create → PaymentSheet → process is running (services fund escrow).
    @State private var isPayingEscrow = false
    @State private var currentUserID: String?
    @State private var showCancelConfirm = false
    @State private var showMarkCompleteConfirm = false
    @State private var showApproveCompletionConfirm = false
    @State private var showNoShowConfirm = false
    @State private var showAbandonmentConfirm = false
    @State private var showPayEscrowConfirm = false
    @State private var pendingMilestoneApproveID: String?
    @State private var pendingMilestoneRevisionID: String?
    @State private var revisionNotesText = ""
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

    // Provider workspace (check-in / completion photos)
    @State private var workSession: ContractWorkSession?
    @State private var isWorkspaceActing = false
    @State private var beforePhotoURL: String?
    @State private var afterPhotoURL: String?
    @State private var pendingPhotoPhase: CompletionPhotoPhase?
    @State private var photoPickerItem: PhotosPickerItem?
    @State private var showCameraPicker = false
    @State private var cameraImage: UIImage?
    @State private var showCameraDeniedAlert = false
    @State private var didAttemptAutoCheckIn = false
    @State private var locationProvider = JobSiteLocationProvider()

    /// Share sheet for authenticated document downloads.
    @State private var documentShareItem: ExportFileShareItem?

    private var heldEscrowPayments: [ContractPayment] {
        contractPayments.filter(\.isHeldInEscrow)
    }

    private var releasedEscrowPayments: [ContractPayment] {
        contractPayments.filter(\.isReleased)
    }

    private var pendingCapturePayments: [ContractPayment] {
        contractPayments.filter(\.isPendingCapture)
    }

    /// Customer may fund escrow when no held/released payment exists yet for this contract.
    private func canFundEscrow(for contract: ContractDetail) -> Bool {
        guard contract.isCustomer(userId: currentUserID) else { return false }
        guard let amount = contract.amountCents, amount > 0 else { return false }
        let status = contract.normalizedStatus
        // Payable after acceptance (active) and while completion is wrapping up.
        guard status == "active" || status == "completed" else { return false }
        // Already funded or paid out — do not open a second charge for the same contract GMV.
        if !heldEscrowPayments.isEmpty || !releasedEscrowPayments.isEmpty {
            return false
        }
        return true
    }

    var body: some View {
        contractBody
            .navigationTitle(contract?.displayTitle ?? "Contract")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbarBackground(BrandTheme.navy, for: .navigationBar)
            .task { await load() }
            .refreshable { await load() }
            .modifier(ContractSheetsModifier(
                showDisputeSheet: $showDisputeSheet,
                showReviewSheet: $showReviewSheet,
                showGuaranteeClaimSheet: $showGuaranteeClaimSheet,
                contractID: contract?.id,
                // FR-6.2: customer→provider vs provider→customer labels on fixed wire dims.
                isCustomerReviewing: contract?.isCustomer(userId: currentUserID) ?? true,
                onMessage: { message in
                    statusIsError = false
                    statusMessage = message
                    Task { await load() }
                }
            ))
            #if canImport(UIKit)
            .sheet(item: $documentShareItem) { item in
                ActivityShareSheet(items: [item.url])
            }
            .fullScreenCover(isPresented: $showCameraPicker) {
                CameraImagePicker(image: $cameraImage)
            }
            #endif
            .onChange(of: photoPickerItem) { _, item in
                guard let item, let phase = pendingPhotoPhase else { return }
                Task { await uploadPickedPhoto(item: item, phase: phase) }
            }
            .onChange(of: cameraImage) { _, image in
                guard let image, let phase = pendingPhotoPhase else { return }
                Task { await uploadCameraPhoto(image, phase: phase) }
            }
            .cameraDeniedAlert(isPresented: $showCameraDeniedAlert)
            .alert(
                "Request milestone revision",
                isPresented: Binding(
                    get: { pendingMilestoneRevisionID != nil },
                    set: { if !$0 { pendingMilestoneRevisionID = nil } }
                )
            ) {
                TextField("What needs to change? (min 200 characters)", text: $revisionNotesText, axis: .vertical)
                Button("Send request") {
                    guard let mid = pendingMilestoneRevisionID else { return }
                    let notes = revisionNotesText.trimmingCharacters(in: .whitespacesAndNewlines)
                    guard notes.count >= 200 else { return }
                    pendingMilestoneRevisionID = nil
                    Task {
                        await runMilestone(mid) {
                            try await APIClient.shared.requestMilestoneRevision(id: mid, notes: notes)
                        }
                    }
                }
                .disabled(revisionNotesText.trimmingCharacters(in: .whitespacesAndNewlines).count < 200)
                Button("Cancel", role: .cancel) {
                    pendingMilestoneRevisionID = nil
                }
            } message: {
                let count = revisionNotesText.trimmingCharacters(in: .whitespacesAndNewlines).count
                let remaining = max(0, 200 - count)
                Text(
                    remaining > 0
                        ? "Describe what the provider should fix (min 200 characters; \(remaining) more needed). Max 3 revisions per milestone."
                        : "Describe what the provider should fix. This sets the milestone back to revision requested. Max 3 revisions per milestone."
                )
            }
            .modifier(ContractConfirmationsModifier(
                showCancelConfirm: $showCancelConfirm,
                showMarkCompleteConfirm: $showMarkCompleteConfirm,
                showApproveCompletionConfirm: $showApproveCompletionConfirm,
                showNoShowConfirm: $showNoShowConfirm,
                showAbandonmentConfirm: $showAbandonmentConfirm,
                showPayEscrowConfirm: $showPayEscrowConfirm,
                pendingMilestoneApproveID: $pendingMilestoneApproveID,
                pendingReleasePayment: $pendingReleasePayment,
                payEscrowAmountLabel: contract.map { MoneyFormat.usd(cents: $0.amountCents ?? 0) } ?? "",
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
                },
                onPayEscrow: {
                    Task { await payAndHoldEscrow() }
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

            localTermsSection(contract)

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

            serviceLocationSection(contract)

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

            workspaceSection(contract)

            recurringSection(contract)

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

    /// FR-5.4: agreed local terms from chat Accept (or award residual bind).
    /// Mirrors web contract detail `local_terms` card. Amount is free-text notes
    /// from chat (not cents wire) — display as-is; never treat as payment input.
    @ViewBuilder
    private func localTermsSection(_ contract: ContractDetail) -> some View {
        if let terms = contract.localTerms, terms.hasDisplayableContent {
            Section {
                if let payment = terms.paymentLabel {
                    LabeledContent("Payment type") {
                        Text(payment)
                            .font(.subheadline.weight(.medium))
                            .foregroundStyle(BrandTheme.textPrimary)
                            .multilineTextAlignment(.trailing)
                    }
                    .accessibilityLabel("Payment type \(payment)")
                }
                if let amount = terms.amount, !amount.isEmpty {
                    LabeledContent("Amount notes") {
                        Text(amount)
                            .font(.subheadline.weight(.medium).monospacedDigit())
                            .foregroundStyle(BrandTheme.textPrimary)
                            .multilineTextAlignment(.trailing)
                            .textSelection(.enabled)
                    }
                    .accessibilityLabel("Amount notes \(amount)")
                }
                if let milestones = terms.milestones, !milestones.isEmpty {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Milestones")
                            .font(.caption)
                            .foregroundStyle(BrandTheme.textSecondary)
                        Text(milestones)
                            .font(.subheadline)
                            .foregroundStyle(BrandTheme.textPrimary)
                            .fixedSize(horizontal: false, vertical: true)
                            .textSelection(.enabled)
                    }
                    .accessibilityElement(children: .combine)
                    .accessibilityLabel("Milestones \(milestones)")
                }
                if let description = terms.description, !description.isEmpty {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Notes")
                            .font(.caption)
                            .foregroundStyle(BrandTheme.textSecondary)
                        Text(description)
                            .font(.subheadline)
                            .foregroundStyle(BrandTheme.textPrimary)
                            .fixedSize(horizontal: false, vertical: true)
                            .textSelection(.enabled)
                    }
                    .accessibilityElement(children: .combine)
                    .accessibilityLabel("Notes \(description)")
                }
                if let acceptedAt = terms.acceptedAt, !acceptedAt.isEmpty {
                    LabeledContent("Accepted at") {
                        Text(CatalogDateFormat.friendlyDateTime(acceptedAt))
                            .font(.caption)
                            .foregroundStyle(BrandTheme.textSecondary)
                    }
                }
            } header: {
                Text("Agreed local terms").brandSectionHeader()
            } footer: {
                Text(
                    terms.boundAtAward
                        ? "Payment terms accepted in chat and applied when the contract was created."
                        : "Payment terms accepted in chat."
                )
                .foregroundStyle(BrandTheme.textSecondary)
            }
            .listRowBackground(BrandTheme.navyElevated)
        }
    }

    /// Party-only exact service address + Get Directions (FR-10.4).
    /// Loaded from linked job; absent when non-party or job has no address.
    @ViewBuilder
    private func serviceLocationSection(_ contract: ContractDetail) -> some View {
        if let line = partyDirectionsAddress(for: contract) {
            Section {
                LabeledContent("Service address") {
                    Text(line)
                        .foregroundStyle(BrandTheme.textPrimary)
                        .multilineTextAlignment(.trailing)
                        .textSelection(.enabled)
                }
                .accessibilityLabel("Service address \(line)")

                Button {
                    DirectionsHelper.openDirections(
                        address: line,
                        openURL: { openURL($0) }
                    )
                } label: {
                    Label("Get Directions", systemImage: "arrow.triangle.turn.up.right.diamond.fill")
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .frame(minHeight: 44)
                }
                .tint(BrandTheme.accent)
                .accessibilityHint("Opens Apple Maps or Google Maps with the service address")
            } header: {
                Text("Location").brandSectionHeader()
            } footer: {
                Text("Exact address is only shown to contract parties after award.")
                    .foregroundStyle(BrandTheme.textSecondary)
            }
            .listRowBackground(BrandTheme.navyElevated)
        }
    }

    /// Exact single-line address only when current user is a contract party and
    /// the linked job returned server-gated `exact_address`.
    private func partyDirectionsAddress(for contract: ContractDetail) -> String? {
        let isParty = contract.isCustomer(userId: currentUserID)
            || contract.isProvider(userId: currentUserID)
        guard isParty else { return nil }
        guard let exact = serviceExactAddress, exact.isDirectionsReady else { return nil }
        return exact.singleLine
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
                        .foregroundStyle(BrandTheme.ctaLabelOnGold)
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

    // MARK: Recurring (FR-18)

    @ViewBuilder
    private func recurringSection(_ contract: ContractDetail) -> some View {
        let config = recurringConfig ?? contract.recurring
        if let config {
            Section {
                LabeledContent("Frequency", value: config.displayFrequency)
                LabeledContent("Status") {
                    Text(config.displayStatus)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(config.isPaused ? BrandTheme.warning : BrandTheme.textPrimary)
                }
                LabeledContent("Rate") {
                    Text(config.displayRate)
                        .font(.subheadline.monospacedDigit())
                        .foregroundStyle(BrandTheme.goldBright)
                }
                if let next = config.nextOccurrence, !next.isEmpty {
                    LabeledContent("Next", value: CatalogDateFormat.friendlyDateTime(next))
                }
                // FR-18.3 — customer toggles auto-approve (PATCH /recurring).
                if contract.isCustomer(userId: currentUserID), !config.isCancelled {
                    Toggle(
                        "Auto-approve visits",
                        isOn: Binding(
                            get: { config.autoApprove == true },
                            set: { newValue in
                                Task {
                                    await runRecurringConfigAction(
                                        title: "Update auto-approve",
                                        success: newValue
                                            ? "Visits will auto-approve on complete."
                                            : "Auto-approve turned off — you’ll approve each visit."
                                    ) {
                                        try await APIClient.shared.updateRecurringConfig(
                                            contractId: contract.id,
                                            autoApprove: newValue
                                        )
                                    }
                                }
                            }
                        )
                    )
                    .tint(BrandTheme.accent)
                    .frame(minHeight: 44)
                    .disabled(actingActionTitle != nil)
                    .accessibilityHint("When on, completed visits approve without a separate customer step")
                } else if config.autoApprove == true {
                    LabeledContent("Auto-approve", value: "On")
                } else {
                    LabeledContent("Auto-approve", value: "Off")
                }

                // FR-18.4 — propose rate for future instances (customer).
                if contract.isCustomer(userId: currentUserID), !config.isCancelled {
                    HStack {
                        Text("Future rate ($)")
                            .foregroundStyle(BrandTheme.textPrimary)
                        TextField(
                            "e.g. \(MoneyFormat.usd(cents: config.rateCents ?? contract.amountCents ?? 0).replacingOccurrences(of: "$", with: ""))",
                            text: $recurringRateText
                        )
                        .keyboardType(.decimalPad)
                        .multilineTextAlignment(.trailing)
                        .frame(minHeight: 44)
                    }
                    Button {
                        Task {
                            guard let cents = MoneyFormat.cents(fromDollarsText: recurringRateText),
                                  cents > 0
                            else {
                                statusIsError = true
                                statusMessage = "Enter a valid future rate in dollars."
                                return
                            }
                            await runRecurringConfigAction(
                                title: "Update rate",
                                success: "Proposed rate updated for future visits."
                            ) {
                                try await APIClient.shared.updateRecurringConfig(
                                    contractId: contract.id,
                                    proposedRateCents: cents
                                )
                            }
                        }
                    } label: {
                        Text("Save future rate")
                            .frame(maxWidth: .infinity, minHeight: 44)
                    }
                    .buttonStyle(.bordered)
                    .tint(BrandTheme.accent)
                    .disabled(actingActionTitle != nil || recurringRateText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    .accessibilityHint("Applies the new rate to future recurring instances only")
                }

                // FR-16.7: only when gateway projects payment_retry_count / next_retry_at.
                if config.hasPaymentRetryInfo {
                    if let count = config.paymentRetryCount, count > 0 {
                        let threshold = config.paymentRetryThreshold ?? 3
                        LabeledContent("Payment retries") {
                            Text("\(count) of \(threshold)")
                                .font(.subheadline.monospacedDigit().weight(.semibold))
                                .foregroundStyle(
                                    count >= threshold ? BrandTheme.destructive : BrandTheme.warning
                                )
                        }
                        .accessibilityLabel("Payment retries \(count) of \(threshold)")
                    }
                    if let retryAt = config.nextRetryAt, !retryAt.isEmpty {
                        LabeledContent("Next auto-retry") {
                            Text(CatalogDateFormat.friendlyDateTime(retryAt))
                                .font(.caption)
                                .foregroundStyle(BrandTheme.warning)
                        }
                        .accessibilityLabel(
                            "Next automatic payment retry \(CatalogDateFormat.friendlyDateTime(retryAt))"
                        )
                    }
                }

                if !config.isCancelled {
                    if config.isActive {
                        actionButton(
                            title: "Pause schedule",
                            systemImage: "pause.circle",
                            tint: BrandTheme.warning,
                            prominent: false
                        ) {
                            await runRecurringConfigAction(title: "Pause schedule", success: "Recurring schedule paused.") {
                                try await APIClient.shared.pauseRecurring(contractId: contract.id)
                            }
                        }
                    }
                    if config.isPaused {
                        actionButton(
                            title: "Resume schedule",
                            systemImage: "play.circle",
                            tint: BrandTheme.accent,
                            prominent: true
                        ) {
                            await runRecurringConfigAction(title: "Resume schedule", success: "Recurring schedule resumed.") {
                                try await APIClient.shared.resumeRecurring(contractId: contract.id)
                            }
                        }
                        .foregroundStyle(BrandTheme.ctaLabelOnGold)
                    }
                    actionButton(
                        title: "Cancel schedule",
                        systemImage: "xmark.circle",
                        tint: BrandTheme.destructive,
                        prominent: false
                    ) {
                        pendingConfirmActionTitle = "Cancel schedule"
                        showCancelRecurringConfirm = true
                    }
                } else if contract.isCustomer(userId: currentUserID) {
                    // FR-18.7 residual: no backend provider substitution — honest repost CTA.
                    Text("Need the remaining visits covered? Post a new job for the remaining schedule. Completed visits with the original provider stay on this timeline.")
                        .font(.footnote)
                        .foregroundStyle(BrandTheme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                    NavigationLink {
                        PostJobView(
                            preferInstantMatch: false,
                            prefillRecurring: true,
                            prefillFrequency: config.frequency,
                            prefillTitle: contract.jobTitle,
                            prefillPropertyId: repostPropertyId,
                            prefillCategoryId: repostCategoryId,
                            prefillCategoryName: repostCategoryName,
                            prefillStartingBidCents: repostStartingBidCents ?? contract.amountCents
                        )
                    } label: {
                        Label("Post a new job for remaining visits", systemImage: "arrow.triangle.2.circlepath")
                            .frame(maxWidth: .infinity, minHeight: 44)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(BrandTheme.accent)
                    .foregroundStyle(BrandTheme.ctaLabelOnGold)
                    .accessibilityHint("Opens post-job with recurring prefilled for remaining visits. Does not transfer the old provider.")
                }

                if recurringInstances.isEmpty {
                    Text("No occurrences yet. The first instance is created when both parties accept a recurring job.")
                        .font(.footnote)
                        .foregroundStyle(BrandTheme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                } else {
                    ForEach(recurringInstances) { instance in
                        recurringInstanceRow(instance, contract: contract)
                    }
                }
            } header: {
                Text("Recurring schedule").brandSectionHeader()
            } footer: {
                Text(
                    config.hasPaymentRetryInfo
                        ? "Payment setup failed previously; the platform retries CreatePayment on a day-3/day-7 schedule (pauses at 3 failures). Pause stops new visits; cancel ends after the next occurrence notice. Money is never invented client-side."
                        : "Pause stops new visits; cancel ends the schedule after the next occurrence notice. Approving a visit may open PaymentSheet for that visit’s server amount (held escrow). Money is never invented client-side."
                )
                .foregroundStyle(BrandTheme.textSecondary)
            }
            .listRowBackground(BrandTheme.navyElevated)
            .confirmationDialog(
                "Cancel this recurring schedule?",
                isPresented: $showCancelRecurringConfirm,
                titleVisibility: .visible
            ) {
                Button("Cancel schedule", role: .destructive) {
                    Task {
                        await runRecurringConfigAction(
                            title: "Cancel schedule",
                            success: "Recurring schedule cancelled."
                        ) {
                            try await APIClient.shared.cancelRecurring(contractId: contract.id)
                        }
                    }
                }
                Button("Keep schedule", role: .cancel) {}
            } message: {
                Text("Cancellation takes effect after the next scheduled occurrence (1-visit notice). Completed visits stay on the timeline.")
            }
        }
    }

    @ViewBuilder
    private func recurringInstanceRow(
        _ instance: ContractRecurringInstance,
        contract: ContractDetail
    ) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(instance.displayDate)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(BrandTheme.textPrimary)
                Spacer()
                Text(instance.displayStatus)
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(BrandTheme.textSecondary)
            }
            HStack {
                Text(instance.displayAmount)
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(BrandTheme.goldBright)
                if instance.autoApproved == true {
                    Text("Auto-approved")
                        .font(.caption2)
                        .foregroundStyle(BrandTheme.success)
                } else if let approvedAt = instance.approvedAt, !approvedAt.isEmpty {
                    Text("Approved")
                        .font(.caption2)
                        .foregroundStyle(BrandTheme.success)
                }
                if instance.paymentFunded == true {
                    Text("Escrow funded")
                        .font(.caption2)
                        .foregroundStyle(BrandTheme.success)
                }
            }
            let isProvider = contract.isProvider(userId: currentUserID)
            let isCustomer = contract.isCustomer(userId: currentUserID)
            if isProvider && instance.isCompletable {
                Button {
                    Task { await completeRecurringInstance(instance, contractId: contract.id) }
                } label: {
                    if actingRecurringInstanceID == instance.id {
                        ProgressView()
                            .frame(maxWidth: .infinity, minHeight: 44)
                    } else {
                        Label("Mark visit complete", systemImage: "checkmark.circle")
                            .frame(maxWidth: .infinity, minHeight: 44)
                    }
                }
                .buttonStyle(.bordered)
                .tint(BrandTheme.accent)
                .disabled(actingRecurringInstanceID != nil || actingActionTitle != nil)
            }
            if isCustomer && instance.isApprovable && instance.autoApproved != true {
                Button {
                    Task { await approveRecurringInstance(instance, contractId: contract.id) }
                } label: {
                    if actingRecurringInstanceID == instance.id && !isPayingRecurringInstance {
                        ProgressView()
                            .frame(maxWidth: .infinity, minHeight: 44)
                    } else {
                        Label("Approve visit", systemImage: "hand.thumbsup")
                            .frame(maxWidth: .infinity, minHeight: 44)
                    }
                }
                .buttonStyle(.borderedProminent)
                .tint(BrandTheme.accent)
                .foregroundStyle(BrandTheme.ctaLabelOnGold)
                .disabled(
                    actingRecurringInstanceID != nil
                        || actingActionTitle != nil
                        || isPayingRecurringInstance
                )
            }
            // Pay CTA when approve/complete returned a real client_secret, or residual
            // CreatePayment when approved/auto and not yet funded (gateway payment_funded).
            let pendingForInstance =
                (pendingRecurringPay?.instance.id == instance.id) ? pendingRecurringPay : nil
            let showPendingPay =
                isCustomer
                && instance.paymentFunded != true
                && (pendingForInstance?.hasPayCTA == true)
            let showResidualPay =
                isCustomer
                && instance.isPayable
                && pendingForInstance?.hasPayCTA != true
            if showPendingPay, let pending = pendingForInstance {
                Button {
                    Task { await payRecurringInstanceEscrow(pending, contract: contract) }
                } label: {
                    if isPayingRecurringInstance && actingRecurringInstanceID == instance.id {
                        ProgressView()
                            .frame(maxWidth: .infinity, minHeight: 44)
                    } else {
                        Label(
                            "Pay visit · \(instance.displayAmount)",
                            systemImage: "creditcard"
                        )
                        .frame(maxWidth: .infinity, minHeight: 44)
                    }
                }
                .buttonStyle(.borderedProminent)
                .tint(BrandTheme.accent)
                .foregroundStyle(BrandTheme.ctaLabelOnGold)
                .disabled(isPayingRecurringInstance || actingActionTitle != nil)
                .accessibilityHint(
                    "Confirms the PaymentIntent for this visit amount, then captures into escrow"
                )
            } else if showResidualPay {
                // Residual / soft-replay CreatePayment with recurring_instance_id
                // (sticky create-payment key + UNIQUE instance on server).
                Button {
                    Task { await payAutoApprovedRecurringVisit(instance, contract: contract) }
                } label: {
                    if isPayingRecurringInstance && actingRecurringInstanceID == instance.id {
                        ProgressView()
                            .frame(maxWidth: .infinity, minHeight: 44)
                    } else {
                        Label(
                            "Pay visit · \(instance.displayAmount)",
                            systemImage: "creditcard"
                        )
                        .frame(maxWidth: .infinity, minHeight: 44)
                    }
                }
                .buttonStyle(.borderedProminent)
                .tint(BrandTheme.accent)
                .foregroundStyle(BrandTheme.ctaLabelOnGold)
                .disabled(isPayingRecurringInstance || actingActionTitle != nil)
                .accessibilityHint(
                    "Creates or soft-replays a PaymentIntent for this visit, confirms, then captures into escrow"
                )
            }
        }
        .padding(.vertical, 4)
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
                        .foregroundStyle(BrandTheme.ctaLabelOnGold)
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
                    if isCustomer && canFundEscrow(for: contract) {
                        Text("Next: pay & hold escrow below (server contract amount) so funds are secured before or during work.")
                            .font(.caption.weight(.medium))
                            .foregroundStyle(BrandTheme.goldBright.opacity(0.95))
                            .fixedSize(horizontal: false, vertical: true)
                    }
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
                        .foregroundStyle(BrandTheme.ctaLabelOnGold)
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
                    .foregroundStyle(BrandTheme.ctaLabelOnGold)
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

    // MARK: Provider workspace (check-in / photos)

    @ViewBuilder
    private func workspaceSection(_ contract: ContractDetail) -> some View {
        let status = contract.normalizedStatus
        let showWorkspace = contract.isProvider(userId: currentUserID)
            && (status == "active" || status == "completed" || contract.hasStarted)

        if showWorkspace {
        Section {
            Text(LocationPurposeCopy.jobSiteCheckInPrePrompt)
                .font(.footnote)
                .foregroundStyle(BrandTheme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
                .listRowBackground(BrandTheme.navyElevated)

            LabeledContent("Session") {
                Text(workSession?.displayStatus ?? "Loading…")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(
                        workSession?.isCheckedIn == true
                            ? BrandTheme.success
                            : BrandTheme.textPrimary
                    )
            }
            .listRowBackground(BrandTheme.navyElevated)

            if let checkedIn = workSession?.checkedInAt, !checkedIn.isEmpty {
                LabeledContent("Checked in") {
                    Text(CatalogDateFormat.friendlyDateTime(checkedIn))
                        .font(.caption)
                        .foregroundStyle(BrandTheme.textSecondary)
                }
                .listRowBackground(BrandTheme.navyElevated)
            }
            if let checkedOut = workSession?.checkedOutAt, !checkedOut.isEmpty {
                LabeledContent("Checked out") {
                    Text(CatalogDateFormat.friendlyDateTime(checkedOut))
                        .font(.caption)
                        .foregroundStyle(BrandTheme.textSecondary)
                }
                .listRowBackground(BrandTheme.navyElevated)
            }
            if let duration = workSession?.displayDuration {
                LabeledContent("Duration") {
                    Text(duration)
                        .font(.subheadline.monospacedDigit())
                        .foregroundStyle(BrandTheme.goldBright)
                }
                .listRowBackground(BrandTheme.navyElevated)
            }

            if workSession?.isCheckedIn != true {
                Button {
                    Task { await performCheckIn() }
                } label: {
                    if isWorkspaceActing {
                        ProgressView()
                            .tint(BrandTheme.ctaLabelOnGold)
                            .frame(maxWidth: .infinity, minHeight: 44)
                    } else {
                        Label("Check in at job site", systemImage: "mappin.and.ellipse")
                            .frame(maxWidth: .infinity, minHeight: 44)
                    }
                }
                .buttonStyle(.borderedProminent)
                .tint(BrandTheme.teal)
                .disabled(isWorkspaceActing)
                .listRowBackground(BrandTheme.navyElevated)
                .accessibilityHint("Uses GPS to confirm you arrived at the job site")
            } else {
                Button {
                    Task { await performCheckOut() }
                } label: {
                    if isWorkspaceActing {
                        ProgressView()
                            .tint(BrandTheme.ctaLabelOnGold)
                            .frame(maxWidth: .infinity, minHeight: 44)
                    } else {
                        Label("Check out", systemImage: "figure.walk.departure")
                            .frame(maxWidth: .infinity, minHeight: 44)
                    }
                }
                .buttonStyle(.borderedProminent)
                .tint(BrandTheme.warning)
                .disabled(isWorkspaceActing)
                .listRowBackground(BrandTheme.navyElevated)
                .accessibilityHint("Ends the on-site work session with GPS confirmation")
            }

            if let beforePhotoURL, !beforePhotoURL.isEmpty {
                LabeledContent("Before photo") {
                    Text("Uploaded")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(BrandTheme.success)
                }
                .listRowBackground(BrandTheme.navyElevated)
            }
            if let afterPhotoURL, !afterPhotoURL.isEmpty {
                LabeledContent("After photo") {
                    Text("Uploaded")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(BrandTheme.success)
                }
                .listRowBackground(BrandTheme.navyElevated)
            }

            photoActionsRow(phase: .before, title: "Upload before photo", systemImage: "camera")
            photoActionsRow(phase: .after, title: "Upload after photo", systemImage: "camera.fill")
        } header: {
            Text("On-site workspace").brandSectionHeader()
        } footer: {
            Text("Check-in requires GPS within the job-site fence. Before/after photos are stored as job evidence (max 10MB). Mark complete may require an after photo on the server.")
                .foregroundStyle(BrandTheme.textSecondary)
        }
        } // showWorkspace
    }

    @ViewBuilder
    private func photoActionsRow(phase: CompletionPhotoPhase, title: String, systemImage: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(BrandTheme.textPrimary)
            HStack(spacing: 12) {
                PhotosPicker(selection: $photoPickerItem, matching: .images) {
                    Label("Library", systemImage: "photo")
                        .frame(maxWidth: .infinity, minHeight: 44)
                }
                .buttonStyle(.bordered)
                .disabled(isWorkspaceActing)
                .simultaneousGesture(TapGesture().onEnded {
                    pendingPhotoPhase = phase
                })

                #if canImport(UIKit)
                Button {
                    pendingPhotoPhase = phase
                    Task {
                        let result = await CameraAuthorization.prepareToPresent()
                        switch result {
                        case .ready:
                            showCameraPicker = true
                        case .denied:
                            showCameraDeniedAlert = true
                        case .unavailable:
                            statusIsError = true
                            statusMessage = "Camera is unavailable on this device. Use the photo library instead."
                        }
                    }
                } label: {
                    Label("Camera", systemImage: systemImage)
                        .frame(maxWidth: .infinity, minHeight: 44)
                }
                .buttonStyle(.bordered)
                .disabled(isWorkspaceActing)
                #endif
            }
        }
        .listRowBackground(BrandTheme.navyElevated)
        .accessibilityElement(children: .contain)
    }

    // MARK: Escrow / payment capture + release (FR-9 services)

    @ViewBuilder
    private func escrowSection(_ contract: ContractDetail) -> some View {
        let isCustomer = contract.isCustomer(userId: currentUserID)
        let isProvider = contract.isProvider(userId: currentUserID)
        let held = heldEscrowPayments
        let released = releasedEscrowPayments
        let pending = pendingCapturePayments
        let canPay = canFundEscrow(for: contract)

        // Surface when there are payment rows, when customer can fund, or when
        // completion is in play (customer may still need to release after approve).
        let relevantStage = contract.normalizedStatus == "completed"
            || contract.normalizedStatus == "active"
            || contract.hasCompletedMark
        let hasRows = !held.isEmpty || !released.isEmpty || !pending.isEmpty
        if (isCustomer || isProvider) && (hasRows || relevantStage || canPay) {
            Section {
                if canPay {
                    feeBreakdownBlock(contract)

                    Text(
                        "Pay the contract amount to hold funds in escrow. Apple Pay / card via Stripe PaymentSheet. Charge amount is the server contract total — not client fee math."
                    )
                    .font(.footnote)
                    .foregroundStyle(BrandTheme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .listRowBackground(BrandTheme.navyElevated)

                    Button {
                        showPayEscrowConfirm = true
                    } label: {
                        if isPayingEscrow {
                            ProgressView()
                                .tint(BrandTheme.ctaLabelOnGold)
                                .frame(maxWidth: .infinity, minHeight: 44)
                        } else {
                            Label(
                                "Pay & hold escrow · \(MoneyFormat.usd(cents: contract.amountCents ?? 0))",
                                systemImage: "creditcard.fill"
                            )
                            .frame(maxWidth: .infinity, minHeight: 44)
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(BrandTheme.accent)
                    .foregroundStyle(BrandTheme.ctaLabelOnGold)
                    .disabled(isBusyForEscrowActions)
                    .accessibilityHint(
                        "Creates a PaymentIntent for this contract amount, opens PaymentSheet, then captures into escrow"
                    )
                    .listRowBackground(BrandTheme.navyElevated)
                }

                if held.isEmpty && released.isEmpty && !canPay {
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

                ForEach(pending) { payment in
                    VStack(alignment: .leading, spacing: 6) {
                        HStack(alignment: .firstTextBaseline) {
                            Text(payment.displayAmount)
                                .font(.body.weight(.semibold).monospacedDigit())
                                .foregroundStyle(BrandTheme.goldBright)
                            Spacer()
                            Text(payment.displayStatus)
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(BrandTheme.warning)
                        }
                        Text("Payment \(String(payment.id.prefix(8)))… — authorization pending capture.")
                            .font(.caption2.monospaced())
                            .foregroundStyle(BrandTheme.textSecondary)
                            .textSelection(.enabled)
                        if isCustomer && canPay {
                            Text("Use Pay & hold escrow above to complete authorization and capture.")
                                .font(.caption)
                                .foregroundStyle(BrandTheme.textSecondary)
                        }
                    }
                    .padding(.vertical, 4)
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
                                        .tint(BrandTheme.ctaLabelOnGold)
                                        .frame(maxWidth: .infinity, minHeight: 44)
                                } else {
                                    Label("Release escrow · \(payment.displayAmount)", systemImage: "lock.open")
                                        .frame(maxWidth: .infinity, minHeight: 44)
                                }
                            }
                            .buttonStyle(.borderedProminent)
                            .tint(BrandTheme.success)
                            .disabled(isBusyForEscrowActions)
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
                Text("Services: customer pays via POST /payments + PaymentSheet + POST /payments/{id}/process (sticky Idempotency-Key). Release is POST /payments/{id}/release. Amounts are server fields only — no client fee math. Goods orders use Orders pickup handshake, not this control.")
                    .foregroundStyle(BrandTheme.textSecondary)
            }
        }
    }

    /// Server fee lines for display only — never used as the charge amount.
    @ViewBuilder
    private func feeBreakdownBlock(_ contract: ContractDetail) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Fee breakdown (server)")
                .font(.caption.weight(.semibold))
                .foregroundStyle(BrandTheme.textSecondary)

            if let feeBreakdown {
                feeRow(label: "Contract / charge", value: feeBreakdown.displayTotal)
                if let pct = PaymentFeeBreakdown.formatPercent(feeBreakdown.feePercentage) {
                    feeRow(label: "Platform fee (\(pct))", value: feeBreakdown.displayPlatformFee)
                } else {
                    feeRow(label: "Platform fee", value: feeBreakdown.displayPlatformFee)
                }
                if let pct = PaymentFeeBreakdown.formatPercent(feeBreakdown.guaranteePercentage) {
                    feeRow(label: "Guarantee fee (\(pct))", value: feeBreakdown.displayGuaranteeFee)
                } else {
                    feeRow(label: "Guarantee fee", value: feeBreakdown.displayGuaranteeFee)
                }
                if let lead = feeBreakdown.displayLeadGenFee {
                    if let pct = PaymentFeeBreakdown.formatPercent(feeBreakdown.leadGenPercentage) {
                        feeRow(label: "Lead-gen fee (\(pct))", value: lead)
                    } else {
                        feeRow(label: "Lead-gen fee", value: lead)
                    }
                }
                feeRow(label: "Provider receives", value: feeBreakdown.displayProviderPayout)
                Text("You pay the contract total. Platform and guarantee fees come from the provider payout (server math).")
                    .font(.caption2)
                    .foregroundStyle(BrandTheme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            } else {
                // Fallback while fees load / if calculate-fees fails — still show server contract amount.
                feeRow(
                    label: "Contract / charge",
                    value: MoneyFormat.usd(cents: contract.amountCents ?? 0)
                )
                Text("Fee lines load from POST /payments/calculate-fees when available.")
                    .font(.caption2)
                    .foregroundStyle(BrandTheme.textSecondary)
            }
        }
        .padding(.vertical, 4)
        .listRowBackground(BrandTheme.navyElevated)
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder
    private func feeRow(label: String, value: String) -> some View {
        HStack {
            Text(label)
                .font(.caption)
                .foregroundStyle(BrandTheme.textSecondary)
            Spacer()
            Text(value)
                .font(.caption.monospacedDigit().weight(.medium))
                .foregroundStyle(BrandTheme.textPrimary)
        }
    }

    private var isBusyForEscrowActions: Bool {
        releasingPaymentID != nil
            || isPayingEscrow
            || actingActionTitle != nil
            || actingMilestoneID != nil
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
                    .tint(prominent ? BrandTheme.ctaLabelOnGold : BrandTheme.accent)
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
                || isPayingEscrow
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
                            .tint(BrandTheme.ctaLabelOnGold)
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
                            .tint(BrandTheme.ctaLabelOnGold)
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

            if isCustomer && milestone.canRequestRevisionAsCustomer && contract.normalizedStatus == "active" {
                Button {
                    revisionNotesText = ""
                    pendingMilestoneRevisionID = milestone.id
                } label: {
                    Label(
                        "Request revision (\(milestone.revisionsRemaining) left)",
                        systemImage: "arrow.uturn.backward"
                    )
                    .frame(maxWidth: .infinity, minHeight: 44)
                }
                .buttonStyle(.bordered)
                .tint(BrandTheme.warning)
                .disabled(actingActionTitle != nil || actingMilestoneID != nil)
                .accessibilityHint(
                    "Ask the provider to revise this milestone before you approve it. Minimum 200 characters. \(milestone.revisionsRemaining) of 3 revisions remaining."
                )
            } else if isCustomer,
                      milestone.normalizedStatus == "submitted",
                      (milestone.revisionCount ?? 0) >= 3,
                      contract.normalizedStatus == "active"
            {
                Text("Revision limit reached (3 of 3). Approve the milestone or open a dispute.")
                    .font(.caption)
                    .foregroundStyle(BrandTheme.warning)
                    .fixedSize(horizontal: false, vertical: true)
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
                        .tint(BrandTheme.ctaLabelOnGold)
                        .frame(maxWidth: .infinity, minHeight: 44)
                } else {
                    Label("Submit change order", systemImage: "doc.badge.plus")
                        .frame(maxWidth: .infinity, minHeight: 44)
                }
            }
            .buttonStyle(.borderedProminent)
            .tint(BrandTheme.gold)
            .foregroundStyle(BrandTheme.ctaLabelOnGold)
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
                                .tint(BrandTheme.ctaLabelOnGold)
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
                                    .tint(BrandTheme.ctaLabelOnGold)
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
                        .foregroundStyle(BrandTheme.ctaLabelOnGold)
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
                    .foregroundStyle(BrandTheme.ctaLabelOnGold)
                }
            } header: {
                Text("NoMarkup Guarantee").brandSectionHeader()
            } footer: {
                Text("Claims are reviewed by support. When support approves a payout, the platform refunds the contract payment server-side (no client money math). Evidence uploads are available on the web dashboard.")
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
                title: "Download contract document",
                systemImage: "doc.richtext",
                tint: BrandTheme.teal,
                prominent: false
            ) {
                await openContractPDF(contract)
            }
            actionButton(
                title: "Download invoice",
                systemImage: "doc.text",
                tint: BrandTheme.accent,
                prominent: false
            ) {
                await openContractInvoice(contract)
            }
            .foregroundStyle(BrandTheme.ctaLabelOnGold)
        } header: {
            Text("Documents").brandSectionHeader()
        } footer: {
            Text("Downloads an authenticated HTML summary or invoice and opens the share sheet so you can Save/Print/AirDrop.")
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
            // Fetch change orders + claim + escrow payments + fee preview in parallel.
            async let ordersResult = Self.loadChangeOrders(
                contractId: contractID,
                fallback: detail.changeOrders ?? []
            )
            async let claimResult = Self.loadGuaranteeClaim(contractId: contractID)
            async let paymentsResult = Self.loadContractPayments(contractId: contractID)
            async let feesResult = Self.loadFeeBreakdown(amountCents: detail.amountCents)
            async let addressResult = Self.loadPartyExactAddress(
                jobId: detail.jobId,
                userId: currentUserID,
                isCustomer: detail.isCustomer(userId: currentUserID),
                isProvider: detail.isProvider(userId: currentUserID)
            )
            async let repostPrefill = Self.loadRepostPrefill(jobId: detail.jobId)
            async let recurringResult = Self.loadRecurringBundle(
                contractId: contractID,
                embedded: detail.recurring
            )
            changeOrders = await ordersResult
            guaranteeClaim = await claimResult
            contractPayments = await paymentsResult
            feeBreakdown = await feesResult
            serviceExactAddress = await addressResult
            let prefill = await repostPrefill
            repostPropertyId = prefill.propertyId
            repostCategoryId = prefill.categoryId
            repostCategoryName = prefill.categoryName
            repostStartingBidCents = prefill.startingBidCents ?? detail.amountCents
            let recurring = await recurringResult
            recurringConfig = recurring.config
            recurringInstances = recurring.instances

            if detail.isProvider(userId: currentUserID) {
                workSession = try? await APIClient.shared.fetchWorkSession(contractId: contractID)
                if autoCheckInOnAppear, !didAttemptAutoCheckIn {
                    didAttemptAutoCheckIn = true
                    if workSession?.isCheckedIn != true {
                        await performCheckIn()
                    }
                }
            }
        } catch {
            if contract == nil {
                errorMessage = error.localizedDescription
            } else {
                statusIsError = true
                statusMessage = error.localizedDescription
            }
        }
    }

    /// Soft-fail FR-18.7 prefill fields from the linked job.
    private static func loadRepostPrefill(jobId: String?) async -> (
        propertyId: String?,
        categoryId: String?,
        categoryName: String?,
        startingBidCents: Int64?
    ) {
        guard let jobId, !jobId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return (nil, nil, nil, nil)
        }
        do {
            let job = try await APIClient.shared.fetchJob(id: jobId)
            let prop = job.propertyId?.trimmingCharacters(in: .whitespacesAndNewlines)
            let cat = job.categoryId?.trimmingCharacters(in: .whitespacesAndNewlines)
            let name = job.categoryName?.trimmingCharacters(in: .whitespacesAndNewlines)
            return (
                (prop?.isEmpty == false) ? prop : nil,
                (cat?.isEmpty == false) ? cat : nil,
                (name?.isEmpty == false) ? name : nil,
                job.startingBidCents
            )
        } catch {
            return (nil, nil, nil, nil)
        }
    }

    /// Soft-fail load of party-only `exact_address` from the linked job.
    /// Server only returns it for owner / awarded provider — non-parties get nil.
    private static func loadPartyExactAddress(
        jobId: String?,
        userId: String?,
        isCustomer: Bool,
        isProvider: Bool
    ) async -> JobExactAddress? {
        guard isCustomer || isProvider else { return nil }
        guard let jobId, !jobId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return nil
        }
        guard userId?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false else {
            return nil
        }
        do {
            let job = try await APIClient.shared.fetchJob(id: jobId)
            return job.exactAddress
        } catch {
            return nil
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

    /// Load pending + held + released payments for this contract. Fail-soft on list errors.
    private static func loadContractPayments(contractId: String) async -> [ContractPayment] {
        // Status filters so fund / release CTAs work without pulling full history.
        async let pending = (try? await APIClient.shared.fetchPaymentsForContract(
            contractId: contractId,
            status: "pending"
        )) ?? []
        async let escrow = (try? await APIClient.shared.fetchPaymentsForContract(
            contractId: contractId,
            status: "escrow"
        )) ?? []
        async let released = (try? await APIClient.shared.fetchPaymentsForContract(
            contractId: contractId,
            status: "released"
        )) ?? []
        let open = await pending
        let held = await escrow
        let done = await released
        var byID: [String: ContractPayment] = [:]
        for payment in open + held + done {
            byID[payment.id] = payment
        }
        return Array(byID.values).sorted { lhs, rhs in
            (lhs.createdAt ?? "") > (rhs.createdAt ?? "")
        }
    }

    /// Display-only fee preview from server (`POST /payments/calculate-fees`).
    private static func loadFeeBreakdown(amountCents: Int64?) async -> PaymentFeeBreakdown? {
        guard let amountCents, amountCents > 0 else { return nil }
        return try? await APIClient.shared.calculatePaymentFees(amountCents: amountCents)
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

    /// FR-9: create PaymentIntent for server contract amount → PaymentSheet → process/capture.
    /// Never invents a charge amount; uses `contract.amountCents` from GET /contracts/{id}.
    @MainActor
    private func payAndHoldEscrow() async {
        guard let contract else { return }
        guard canFundEscrow(for: contract) else {
            statusIsError = true
            statusMessage = "This contract is not payable, or escrow is already funded."
            return
        }
        guard let amountCents = contract.amountCents, amountCents > 0 else {
            statusIsError = true
            statusMessage = "Contract has no server amount to charge."
            return
        }

        isPayingEscrow = true
        statusMessage = nil
        statusIsError = false
        defer { isPayingEscrow = false }

        do {
            // 1) Create PI (sticky Idempotency-Key create-payment:{contract}:{amount}:).
            let created = try await APIClient.shared.createContractPayment(
                contractId: contract.id,
                amountCents: amountCents,
                providerId: contract.providerId
            )

            // 2) Authorize via PaymentSheet (or skip on dev-stack sentinel secrets).
            if created.isDevClientSecret {
                // Dev payment service returns pi_dev_secret_* when Stripe is unwired.
                // Capture path still works via ProcessPayment stub.
            } else if let secret = created.clientSecret, created.hasConfirmableSecret {
                try await RailACheckout.presentPaymentSheet(clientSecret: secret)
            } else {
                statusIsError = true
                statusMessage =
                    "Payment created but no confirmable client_secret was returned. Retry shortly, or check Stripe configuration."
                await refreshSideData()
                return
            }

            // 3) Capture → escrow (sticky process-payment:{id}).
            let held = try await APIClient.shared.processContractPayment(paymentId: created.id)
            await APIClient.shared.clearCreateContractPaymentIdempotency(
                contractId: contract.id,
                amountCents: amountCents
            )

            if let idx = contractPayments.firstIndex(where: { $0.id == held.id }) {
                contractPayments[idx] = held
            } else {
                contractPayments.insert(held, at: 0)
            }
            statusIsError = false
            statusMessage =
                "Payment complete — \(held.displayAmount) is held in escrow. Release after you approve the work."
            await refreshSideData()
        } catch let error as RailACheckout.CheckoutError where error.isCanceled {
            statusIsError = false
            statusMessage =
                "Payment canceled. You can try again; create uses a sticky Idempotency-Key so retries reuse the same intent."
            await refreshSideData()
        } catch let error as APIClientError where error.isUnauthorized {
            statusIsError = true
            statusMessage = "Sign in required. Your session is missing or expired — please sign in again."
        } catch {
            statusIsError = true
            statusMessage = error.localizedDescription
            await refreshSideData()
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
        async let fees = Self.loadFeeBreakdown(amountCents: contract?.amountCents)
        async let recurring = Self.loadRecurringBundle(
            contractId: contractID,
            embedded: contract?.recurring ?? recurringConfig
        )
        changeOrders = await orders
        guaranteeClaim = await claim
        contractPayments = await payments
        if let fees = await fees {
            feeBreakdown = fees
        }
        let rec = await recurring
        recurringConfig = rec.config
        recurringInstances = rec.instances
    }

    private static func loadRecurringBundle(
        contractId: String,
        embedded: ContractRecurringConfig?
    ) async -> (config: ContractRecurringConfig?, instances: [ContractRecurringInstance]) {
        // Prefer dedicated endpoints; fall back to embedded config on GetContract.
        let config: ContractRecurringConfig?
        if let fetched = try? await APIClient.shared.fetchRecurringConfig(contractId: contractId) {
            config = fetched
        } else {
            config = embedded
        }
        guard config != nil else {
            return (nil, [])
        }
        let instances = (try? await APIClient.shared.fetchRecurringInstances(contractId: contractId)) ?? []
        return (config, instances)
    }

    @MainActor
    private func runRecurringConfigAction(
        title: String,
        success: String,
        _ work: () async throws -> ContractRecurringConfig
    ) async {
        actingActionTitle = title
        pendingConfirmActionTitle = nil
        statusMessage = nil
        statusIsError = false
        defer { actingActionTitle = nil }
        do {
            recurringConfig = try await work()
            statusIsError = false
            statusMessage = success
            await refreshSideData()
            // Keep contract.recurring in sync when present.
            if var detail = contract {
                detail.recurring = recurringConfig
                contract = detail
            }
        } catch let error as APIClientError where error.isUnauthorized {
            statusIsError = true
            statusMessage = "Sign in required. Your session is missing or expired — please sign in again."
        } catch {
            statusIsError = true
            statusMessage = error.localizedDescription
        }
    }

    @MainActor
    private func completeRecurringInstance(
        _ instance: ContractRecurringInstance,
        contractId: String
    ) async {
        actingRecurringInstanceID = instance.id
        statusMessage = nil
        statusIsError = false
        defer { actingRecurringInstanceID = nil }
        do {
            let result = try await APIClient.shared.completeRecurringInstance(
                contractId: contractId,
                instanceId: instance.id
            )
            if let idx = recurringInstances.firstIndex(where: { $0.id == result.instance.id }) {
                recurringInstances[idx] = result.instance
            }
            statusIsError = false
            let autoApproved = result.instance.autoApproved == true
            if result.wasOffSessionCharged {
                // Off-session success: funds held; no PaymentSheet / invent no secret.
                pendingRecurringPay = nil
                if let payment = result.payment {
                    upsertContractPayment(payment)
                }
                statusMessage = autoApproved
                    ? "Visit complete and auto-approved. Saved card charged off-session — \(result.instance.displayAmount) held in escrow."
                    : "Visit complete. Saved card charged off-session — \(result.instance.displayAmount) held in escrow."
            } else if result.hasPayCTA {
                // Gateway CreatePayment on auto-approve — real client_secret only.
                pendingRecurringPay = result
                if let payment = result.payment {
                    upsertContractPayment(payment)
                }
                let residualHint: String = {
                    guard let r = result.offSessionChargeResidual?.trimmingCharacters(in: .whitespacesAndNewlines),
                          !r.isEmpty
                    else { return "" }
                    return " (on-session residual: \(r))"
                }()
                statusMessage = autoApproved
                    ? "Visit complete and auto-approved. Pay visit when ready to hold escrow (\(result.instance.displayAmount)).\(residualHint)"
                    : "Visit marked complete. PaymentIntent ready for \(result.instance.displayAmount).\(residualHint)"
                // Pay CTA is customer-only; auto-present if this session is the customer
                // (unusual for complete, which is provider-only server-side).
                if let contract, contract.isCustomer(userId: currentUserID) {
                    await payRecurringInstanceEscrow(result, contract: contract)
                }
            } else if autoApproved {
                pendingRecurringPay = nil
                if let residual = result.paymentResidual, !residual.isEmpty {
                    let detail = result.paymentError
                        ?? "Visit complete and auto-approved; escrow PaymentIntent was not created (\(residual)). Customer can pay via Pay visit."
                    statusMessage = detail
                } else {
                    statusMessage = "Visit complete and auto-approved."
                }
            } else {
                pendingRecurringPay = nil
                statusMessage = "Visit marked complete."
            }
        } catch {
            statusIsError = true
            statusMessage = error.localizedDescription
        }
    }

    /// Customer funds an auto-approved visit when complete response client_secret
    /// is not on this device (provider completed elsewhere). Uses POST /payments
    /// with recurring_instance_id — never invents amount (server instance cents).
    @MainActor
    private func payAutoApprovedRecurringVisit(
        _ instance: ContractRecurringInstance,
        contract: ContractDetail
    ) async {
        guard contract.isCustomer(userId: currentUserID) else {
            statusIsError = true
            statusMessage = "Only the customer can fund visit escrow."
            return
        }
        guard let amountCents = instance.amountCents, amountCents > 0 else {
            statusIsError = true
            statusMessage = "This visit has no server amount to charge."
            return
        }

        actingRecurringInstanceID = instance.id
        isPayingRecurringInstance = true
        statusMessage = nil
        statusIsError = false
        defer {
            isPayingRecurringInstance = false
            actingRecurringInstanceID = nil
        }

        do {
            let created = try await APIClient.shared.createContractPayment(
                contractId: contract.id,
                amountCents: amountCents,
                providerId: contract.providerId,
                recurringInstanceId: instance.id
            )
            if created.isDevClientSecret {
                // Dev stub — skip PaymentSheet.
            } else if let secret = created.clientSecret, created.hasConfirmableSecret {
                try await RailACheckout.presentPaymentSheet(clientSecret: secret)
            } else {
                statusIsError = true
                statusMessage =
                    "Payment created but no confirmable client_secret was returned. Retry shortly, or check Stripe configuration."
                await refreshSideData()
                return
            }

            let held = try await APIClient.shared.processContractPayment(paymentId: created.id)
            upsertContractPayment(held)
            pendingRecurringPay = nil
            statusIsError = false
            statusMessage =
                "Visit paid — \(held.displayAmount) held in escrow. Release after work is done."
            await refreshSideData()
        } catch let error as RailACheckout.CheckoutError where error.isCanceled {
            statusIsError = false
            statusMessage =
                "Payment canceled. Tap Pay visit to retry; create uses a sticky Idempotency-Key."
        } catch let error as APIClientError where error.isUnauthorized {
            statusIsError = true
            statusMessage = "Sign in required. Your session is missing or expired — please sign in again."
        } catch {
            statusIsError = true
            statusMessage = error.localizedDescription
            await refreshSideData()
        }
    }

    @MainActor
    private func approveRecurringInstance(
        _ instance: ContractRecurringInstance,
        contractId: String
    ) async {
        actingRecurringInstanceID = instance.id
        statusMessage = nil
        statusIsError = false
        defer { actingRecurringInstanceID = nil }
        do {
            let result = try await APIClient.shared.approveRecurringInstance(
                contractId: contractId,
                instanceId: instance.id
            )
            if let idx = recurringInstances.firstIndex(where: { $0.id == result.instance.id }) {
                recurringInstances[idx] = result.instance
            }
            statusIsError = false
            if result.wasOffSessionCharged {
                // Default PM already charged off-session — no PaymentSheet.
                pendingRecurringPay = nil
                if let payment = result.payment {
                    upsertContractPayment(payment)
                }
                statusMessage =
                    "Visit approved. Saved card charged off-session — \(result.instance.displayAmount) held in escrow."
            } else if result.hasPayCTA {
                // Keep pay CTA; auto-start PaymentSheet when secret is confirmable.
                pendingRecurringPay = result
                if let payment = result.payment {
                    upsertContractPayment(payment)
                }
                let residualHint: String = {
                    guard let r = result.offSessionChargeResidual?.trimmingCharacters(in: .whitespacesAndNewlines),
                          !r.isEmpty
                    else { return "" }
                    // e.g. on_session_residual after skip/decline/SCA — pay in-app.
                    return " (on-session residual: \(r))"
                }()
                statusMessage =
                    "Visit approved. Complete payment for \(result.instance.displayAmount) to hold escrow.\(residualHint)"
                // Present sheet immediately (CTA remains if user cancels).
                if let contract {
                    await payRecurringInstanceEscrow(result, contract: contract)
                }
            } else if let residual = result.paymentResidual, !residual.isEmpty {
                pendingRecurringPay = nil
                let detail = result.paymentError
                    ?? "Visit approved; escrow PaymentIntent was not created (\(residual)). Use contract Pay & hold escrow or retry later."
                statusMessage = detail
                // Residual is not a hard failure of approve — soft warning.
                statusIsError = false
            } else {
                pendingRecurringPay = nil
                statusMessage = "Visit approved."
            }
            await refreshSideData()
        } catch {
            statusIsError = true
            statusMessage = error.localizedDescription
        }
    }

    /// Confirm + capture the PI returned from approve (or residual Pay CTA).
    /// Never invents amount or secret — only uses gateway-returned client_secret.
    @MainActor
    private func payRecurringInstanceEscrow(
        _ pending: RecurringApproveResult,
        contract: ContractDetail
    ) async {
        guard pending.hasPayCTA else {
            statusIsError = true
            statusMessage = "No confirmable payment secret for this visit."
            return
        }
        guard let paymentId = pending.paymentId?.trimmingCharacters(in: .whitespacesAndNewlines),
              !paymentId.isEmpty
        else {
            statusIsError = true
            statusMessage = "Visit approved but payment id missing — cannot capture escrow."
            return
        }

        actingRecurringInstanceID = pending.instance.id
        isPayingRecurringInstance = true
        statusMessage = nil
        statusIsError = false
        defer {
            isPayingRecurringInstance = false
            actingRecurringInstanceID = nil
        }

        do {
            if let secret = pending.clientSecret?.trimmingCharacters(in: .whitespacesAndNewlines),
               !secret.isEmpty {
                let isDev = secret.hasPrefix("pi_dev_") || secret.hasPrefix("dev_")
                let isConfirmable = secret.hasPrefix("pi_") && secret.contains("_secret_")
                if isDev {
                    // Dev stub PI — skip PaymentSheet; process still advances escrow.
                } else if isConfirmable {
                    try await RailACheckout.presentPaymentSheet(clientSecret: secret)
                } else {
                    statusIsError = true
                    statusMessage =
                        "Payment created but no confirmable client_secret was returned."
                    return
                }
            }

            let held = try await APIClient.shared.processContractPayment(paymentId: paymentId)
            upsertContractPayment(held)
            pendingRecurringPay = nil
            statusIsError = false
            statusMessage =
                "Visit paid — \(held.displayAmount) held in escrow. Release after work is done."
            await refreshSideData()
        } catch let error as RailACheckout.CheckoutError where error.isCanceled {
            // Keep pendingRecurringPay so Pay CTA remains.
            statusIsError = false
            statusMessage =
                "Payment canceled. Tap Pay visit to retry; approve already used a sticky server idempotency key."
        } catch let error as APIClientError where error.isUnauthorized {
            statusIsError = true
            statusMessage = "Sign in required. Your session is missing or expired — please sign in again."
        } catch {
            statusIsError = true
            statusMessage = error.localizedDescription
            await refreshSideData()
        }
    }

    private func upsertContractPayment(_ payment: ContractPayment) {
        if let idx = contractPayments.firstIndex(where: { $0.id == payment.id }) {
            contractPayments[idx] = payment
        } else {
            contractPayments.insert(payment, at: 0)
        }
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

    // MARK: Workspace actions

    @MainActor
    private func performCheckIn() async {
        isWorkspaceActing = true
        statusMessage = nil
        statusIsError = false
        defer { isWorkspaceActing = false }
        do {
            let coord = try await locationProvider.currentCoordinate()
            let response = try await APIClient.shared.checkInToContract(
                id: contractID,
                lat: coord.latitude,
                lng: coord.longitude
            )
            workSession = try? await APIClient.shared.fetchWorkSession(contractId: contractID)
            statusIsError = false
            if let at = response.checkedInAt, !at.isEmpty {
                statusMessage = "Checked in at \(CatalogDateFormat.friendlyDateTime(at))."
            } else {
                statusMessage = "Checked in at the job site."
            }
        } catch {
            statusIsError = true
            statusMessage = error.localizedDescription
        }
    }

    @MainActor
    private func performCheckOut() async {
        isWorkspaceActing = true
        statusMessage = nil
        statusIsError = false
        defer { isWorkspaceActing = false }
        do {
            let coord = try await locationProvider.currentCoordinate()
            let response = try await APIClient.shared.checkOutOfContract(
                id: contractID,
                lat: coord.latitude,
                lng: coord.longitude
            )
            workSession = try? await APIClient.shared.fetchWorkSession(contractId: contractID)
            statusIsError = false
            if let mins = response.durationMinutes {
                let hours = mins / 60
                let rem = mins % 60
                let label = hours > 0 ? "\(hours)h \(rem)m" : "\(rem) min"
                statusMessage = "Checked out — worked \(label)."
            } else {
                statusMessage = "Checked out."
            }
        } catch {
            statusIsError = true
            statusMessage = error.localizedDescription
        }
    }

    @MainActor
    private func uploadPickedPhoto(item: PhotosPickerItem, phase: CompletionPhotoPhase) async {
        isWorkspaceActing = true
        statusMessage = nil
        statusIsError = false
        defer {
            isWorkspaceActing = false
            photoPickerItem = nil
            pendingPhotoPhase = nil
        }
        do {
            guard let data = try await item.loadTransferable(type: Data.self) else {
                statusIsError = true
                statusMessage = "Could not read the selected photo."
                return
            }
            #if canImport(UIKit)
            let jpeg: Data
            if let image = UIImage(data: data), let encoded = image.jpegData(compressionQuality: 0.85) {
                jpeg = encoded
            } else {
                jpeg = data
            }
            #else
            let jpeg = data
            #endif
            try await uploadCompletionJPEG(jpeg, phase: phase)
        } catch {
            statusIsError = true
            statusMessage = error.localizedDescription
        }
    }

    @MainActor
    private func uploadCameraPhoto(_ image: UIImage, phase: CompletionPhotoPhase) async {
        isWorkspaceActing = true
        statusMessage = nil
        statusIsError = false
        defer {
            isWorkspaceActing = false
            cameraImage = nil
            pendingPhotoPhase = nil
        }
        guard let jpeg = image.jpegData(compressionQuality: 0.85) else {
            statusIsError = true
            statusMessage = "Could not encode the camera photo."
            return
        }
        do {
            try await uploadCompletionJPEG(jpeg, phase: phase)
        } catch {
            statusIsError = true
            statusMessage = error.localizedDescription
        }
    }

    @MainActor
    private func uploadCompletionJPEG(_ jpeg: Data, phase: CompletionPhotoPhase) async throws {
        let response = try await APIClient.shared.uploadCompletionPhoto(
            contractId: contractID,
            imageJPEG: jpeg,
            phase: phase,
            filename: "completion-\(phase.rawValue).jpg"
        )
        if phase == .before {
            beforePhotoURL = response.url
        } else {
            afterPhotoURL = response.url
        }
        statusIsError = false
        statusMessage = phase == .before ? "Before photo uploaded." : "After photo uploaded."
    }

    @MainActor
    private func openContractPDF(_ contract: ContractDetail) async {
        actingActionTitle = "Download contract document"
        statusMessage = nil
        statusIsError = false
        defer { actingActionTitle = nil }
        do {
            let file = try await APIClient.shared.downloadContractDocument(id: contract.id)
            let url = try writeContractTempFile(data: file.data, filename: file.filename)
            documentShareItem = ExportFileShareItem(url: url)
            statusIsError = false
            statusMessage = "Contract document ready — choose Save or Share."
        } catch {
            statusIsError = true
            statusMessage = error.localizedDescription
        }
    }

    @MainActor
    private func openContractInvoice(_ contract: ContractDetail) async {
        actingActionTitle = "Download invoice"
        statusMessage = nil
        statusIsError = false
        defer { actingActionTitle = nil }
        do {
            let data = try await APIClient.shared.downloadContractInvoice(id: contract.id)
            let url = try writeContractTempFile(
                data: data,
                filename: "invoice-\(String(contract.id.prefix(8))).html"
            )
            documentShareItem = ExportFileShareItem(url: url)
            statusIsError = false
            statusMessage = "Invoice ready — choose Save or Share."
        } catch {
            statusIsError = true
            statusMessage = error.localizedDescription
        }
    }

    private func writeContractTempFile(data: Data, filename: String) throws -> URL {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(filename)
        try data.write(to: url, options: .atomic)
        return url
    }
}

// MARK: - Sheets / confirms (split for type-checker)

private struct ContractSheetsModifier: ViewModifier {
    @Binding var showDisputeSheet: Bool
    @Binding var showReviewSheet: Bool
    @Binding var showGuaranteeClaimSheet: Bool
    let contractID: String?
    /// True when current user is the customer (customer→provider review labels).
    var isCustomerReviewing: Bool = true
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
                    LeaveReviewSheet(
                        contractID: contractID,
                        isCustomerReviewing: isCustomerReviewing,
                        onSuccess: onMessage
                    )
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
    @Binding var showPayEscrowConfirm: Bool
    @Binding var pendingMilestoneApproveID: String?
    @Binding var pendingReleasePayment: ContractPayment?
    var payEscrowAmountLabel: String
    let onCancel: () -> Void
    let onMarkComplete: () -> Void
    let onApproveCompletion: () -> Void
    let onReportNoShow: () -> Void
    let onReportAbandonment: () -> Void
    let onApproveMilestone: (String) -> Void
    let onReleaseEscrow: (ContractPayment) -> Void
    let onPayEscrow: () -> Void

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
                "Pay and hold escrow?",
                isPresented: $showPayEscrowConfirm,
                titleVisibility: .visible
            ) {
                Button("Pay \(payEscrowAmountLabel)", action: onPayEscrow)
                Button("Not now", role: .cancel) {}
            } message: {
                Text("Charges the server contract amount (\(payEscrowAmountLabel)) via Stripe PaymentSheet (Apple Pay when available). Funds stay in escrow until you release them after approving work. Sticky Idempotency-Key on create + process.")
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
    @State private var evidenceURLs: [String] = []
    @State private var isUploadingEvidence = false
    @State private var isSubmitting = false
    @State private var errorMessage: String?

    private var canSubmitDispute: Bool {
        !isSubmitting
            && !isUploadingEvidence
            && !descriptionText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

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
                    Text("Opens a formal dispute on this contract. Attach photo evidence when possible.")
                        .foregroundStyle(BrandTheme.textSecondary)
                }

                PhotoPickSection(
                    context: .job,
                    maxCount: 6,
                    photoURLs: $evidenceURLs,
                    isUploading: $isUploadingEvidence,
                    errorMessage: $errorMessage,
                    sectionTitle: "Evidence photos",
                    footerText: "Optional. Up to 6 photos · JPEG/PNG/WebP · 10 MB each. Library or camera; uploads before submit."
                )

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
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }
                        .disabled(isSubmitting)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Submit") {
                        Task { await submit() }
                    }
                    .disabled(!canSubmitDispute)
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
                description: descriptionText,
                evidenceURLs: evidenceURLs
            )
            onSuccess(
                evidenceURLs.isEmpty
                    ? "Dispute opened."
                    : "Dispute opened with \(evidenceURLs.count) evidence photo(s)."
            )
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

// MARK: - Leave review sheet

private struct LeaveReviewSheet: View {
    let contractID: String
    /// FR-6.2: when true, customer→provider dims; else provider→customer real wire fields.
    var isCustomerReviewing: Bool = true
    var onSuccess: (String) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var rating = 5
    // Customer → provider
    @State private var qualityRating = 5
    @State private var communicationRating = 5
    @State private var timelinessRating = 5
    @State private var valueRating = 5
    // Provider → customer (FR-6.2 real columns)
    @State private var paymentPromptnessRating = 5
    @State private var scopeAccuracyRating = 5
    @State private var accessRating = 5
    @State private var comment = ""
    @State private var isSubmitting = false
    @State private var isLoadingEligibility = true
    @State private var eligibility: ReviewEligibility?
    @State private var errorMessage: String?

    private var commentCount: Int {
        comment.trimmingCharacters(in: .whitespacesAndNewlines).count
    }

    private var canSubmit: Bool {
        !isSubmitting
            && commentCount >= 50
            && (eligibility?.isEligible == true)
    }

    var body: some View {
        NavigationStack {
            Form {
                if isLoadingEligibility {
                    Section {
                        ProgressView("Checking eligibility…")
                            .tint(BrandTheme.accent)
                            .listRowBackground(BrandTheme.navyElevated)
                    }
                } else if let eligibility, !eligibility.isEligible {
                    Section {
                        Text(eligibility.blockedReason ?? "Not eligible to review.")
                            .font(.subheadline)
                            .foregroundStyle(BrandTheme.warning)
                            .fixedSize(horizontal: false, vertical: true)
                            .listRowBackground(BrandTheme.navyElevated)
                    } header: {
                        Text("Not available").brandSectionHeader()
                    }
                } else {
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

                        if isCustomerReviewing {
                            Stepper(value: $qualityRating, in: 1 ... 5) {
                                Text("Quality of work \(qualityRating)/5")
                            }
                            .listRowBackground(BrandTheme.navyElevated)
                            .accessibilityLabel("Quality of work \(qualityRating) of 5")
                            Stepper(value: $communicationRating, in: 1 ... 5) {
                                Text("Communication \(communicationRating)/5")
                            }
                            .listRowBackground(BrandTheme.navyElevated)
                            .accessibilityLabel("Communication \(communicationRating) of 5")
                            Stepper(value: $timelinessRating, in: 1 ... 5) {
                                Text("Timeliness \(timelinessRating)/5")
                            }
                            .listRowBackground(BrandTheme.navyElevated)
                            .accessibilityLabel("Timeliness \(timelinessRating) of 5")
                            Stepper(value: $valueRating, in: 1 ... 5) {
                                Text("Value \(valueRating)/5")
                            }
                            .listRowBackground(BrandTheme.navyElevated)
                            .accessibilityLabel("Value \(valueRating) of 5")
                        } else {
                            Stepper(value: $paymentPromptnessRating, in: 1 ... 5) {
                                Text("Payment promptness \(paymentPromptnessRating)/5")
                            }
                            .listRowBackground(BrandTheme.navyElevated)
                            .accessibilityLabel("Payment promptness \(paymentPromptnessRating) of 5")
                            Stepper(value: $scopeAccuracyRating, in: 1 ... 5) {
                                Text("Accuracy of scope \(scopeAccuracyRating)/5")
                            }
                            .listRowBackground(BrandTheme.navyElevated)
                            .accessibilityLabel("Accuracy of scope \(scopeAccuracyRating) of 5")
                            Stepper(value: $accessRating, in: 1 ... 5) {
                                Text("Property access \(accessRating)/5")
                            }
                            .listRowBackground(BrandTheme.navyElevated)
                            .accessibilityLabel("Property access \(accessRating) of 5")
                        }

                        TextField("Comment (required, 50+ characters)", text: $comment, axis: .vertical)
                            .lineLimit(4 ... 10)
                            .listRowBackground(BrandTheme.navyElevated)
                        Text("\(commentCount) / 50 minimum")
                            .font(.caption.monospacedDigit())
                            .foregroundStyle(commentCount >= 50 ? BrandTheme.success : BrandTheme.warning)
                            .listRowBackground(BrandTheme.navyElevated)
                    } header: {
                        Text("Review").brandSectionHeader()
                    } footer: {
                        Text("Reviews are double-blind: they become visible once both parties have submitted. Window is 90 days after completion. Category ratings use role-specific fields (FR-6.2).")
                            .foregroundStyle(BrandTheme.textSecondary)
                    }
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
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }
                        .disabled(isSubmitting)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Submit") {
                        Task { await submit() }
                    }
                    .disabled(!canSubmit)
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
            .task { await loadEligibility() }
        }
        .tint(BrandTheme.accent)
    }

    @MainActor
    private func loadEligibility() async {
        isLoadingEligibility = true
        defer { isLoadingEligibility = false }
        do {
            eligibility = try await APIClient.shared.fetchReviewEligibility(contractId: contractID)
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
            // Allow form if eligibility endpoint fails — server still enforces.
            eligibility = ReviewEligibility(eligible: true, alreadyReviewed: false, reviewWindowClosesAt: nil)
        }
    }

    @MainActor
    private func submit() async {
        errorMessage = nil
        isSubmitting = true
        defer { isSubmitting = false }
        do {
            if isCustomerReviewing {
                _ = try await APIClient.shared.createContractReview(
                    id: contractID,
                    rating: rating,
                    comment: comment,
                    qualityRating: qualityRating,
                    communicationRating: communicationRating,
                    timelinessRating: timelinessRating,
                    valueRating: valueRating
                )
            } else {
                _ = try await APIClient.shared.createContractReview(
                    id: contractID,
                    rating: rating,
                    comment: comment,
                    paymentPromptnessRating: paymentPromptnessRating,
                    scopeAccuracyRating: scopeAccuracyRating,
                    accessRating: accessRating
                )
            }
            onSuccess("Review submitted.")
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

// MARK: - Guarantee claim sheet

private struct GuaranteeClaimSheet: View {
    /// Product parity with web GuaranteeClaimForm + OpenDisputeSheet evidence path.
    private static let maxEvidencePhotos = 6
    private static let minDescriptionChars = 50

    let contractID: String
    var onSuccess: (String) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var reason: GuaranteeClaimReason = .quality
    @State private var descriptionText = ""
    @State private var evidenceURLs: [String] = []
    @State private var isUploadingEvidence = false
    @State private var isSubmitting = false
    @State private var errorMessage: String?

    private var descriptionCount: Int {
        descriptionText.trimmingCharacters(in: .whitespacesAndNewlines).count
    }

    private var descriptionValid: Bool {
        descriptionCount >= Self.minDescriptionChars
    }

    private var hasEvidence: Bool {
        !evidenceURLs.isEmpty
    }

    private var canSubmitClaim: Bool {
        !isSubmitting
            && !isUploadingEvidence
            && descriptionValid
            && hasEvidence
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

                    Text("\(descriptionCount) / \(Self.minDescriptionChars) min")
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(descriptionValid ? BrandTheme.success : BrandTheme.warning)
                        .listRowBackground(BrandTheme.navyElevated)
                        .accessibilityLabel(
                            descriptionValid
                                ? "Description length meets the minimum"
                                : "Description needs \(Self.minDescriptionChars - descriptionCount) more characters"
                        )
                } header: {
                    Text("Guarantee claim").brandSectionHeader()
                } footer: {
                    Text("Files a NoMarkup Guarantee claim on this completed contract. Photo evidence is required (same path as disputes). Our team reviews claims within ~48 hours.")
                        .foregroundStyle(BrandTheme.textSecondary)
                }

                PhotoPickSection(
                    context: .job,
                    maxCount: Self.maxEvidencePhotos,
                    photoURLs: $evidenceURLs,
                    isUploading: $isUploadingEvidence,
                    errorMessage: $errorMessage,
                    sectionTitle: "Evidence photos (required)",
                    footerText: "At least 1 photo required · up to \(Self.maxEvidencePhotos) · JPEG/PNG/WebP · 10 MB each. Library or camera; uploads before submit."
                )

                if !hasEvidence && !isUploadingEvidence {
                    Section {
                        Text("Add at least one photo showing the issue before submitting.")
                            .font(.footnote)
                            .foregroundStyle(BrandTheme.warning)
                            .fixedSize(horizontal: false, vertical: true)
                            .listRowBackground(BrandTheme.navyElevated)
                            .accessibilityLabel("Evidence required: add at least one photo")
                    }
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
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }
                        .disabled(isSubmitting)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Submit") {
                        Task { await submit() }
                    }
                    .disabled(!canSubmitClaim)
                    .fontWeight(.semibold)
                    .accessibilityHint(
                        canSubmitClaim
                            ? "Submits the guarantee claim with \(evidenceURLs.count) photo(s)"
                            : "Requires a 50-character description and at least one evidence photo"
                    )
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
    }

    @MainActor
    private func submit() async {
        errorMessage = nil
        guard descriptionValid else {
            errorMessage = "Description must be at least \(Self.minDescriptionChars) characters."
            return
        }
        guard hasEvidence else {
            errorMessage = "Add at least one evidence photo before submitting."
            return
        }
        isSubmitting = true
        defer { isSubmitting = false }
        do {
            _ = try await APIClient.shared.submitGuaranteeClaim(
                contractId: contractID,
                reason: reason.rawValue,
                description: descriptionText,
                evidenceURLs: evidenceURLs
            )
            onSuccess(
                "Guarantee claim submitted with \(evidenceURLs.count) evidence photo(s)."
            )
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
