import SwiftUI

/// Buyer/seller order list — pay pending orders and complete escrow pickup handshake.
///
/// Goods escrow path (server-driven; no client money math):
/// 1. `POST /orders/{id}/pay` → Stripe PI (held)
/// 2. `POST /orders/{id}/confirm-pickup` (buyer) + `POST …/seller-confirm` (seller)
/// 3. Mutual confirm flips `escrow_status` to `released`; payment worker transfers.
/// Service contracts use `POST /payments/{id}/release` instead (see ContractDetailView).
struct MyOrdersView: View {
    @EnvironmentObject private var auth: AuthViewModel

    @State private var orders: [ListingOrderSummary] = []
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var payingOrderID: String?
    @State private var actingOrderID: String?
    @State private var statusMessage: String?
    @State private var statusIsError = false
    @State private var currentUserID: String?
    @State private var disputeOrder: ListingOrderSummary?
    @State private var noShowOrder: ListingOrderSummary?
    @State private var pendingPickupOrder: ListingOrderSummary?
    @State private var pendingSellerConfirmOrder: ListingOrderSummary?
    @State private var reviewOrder: ListingOrderSummary?

    private var isBusy: Bool {
        payingOrderID != nil || actingOrderID != nil
    }

    var body: some View {
        Group {
            if !auth.isAuthenticated {
                BrandEmptyState(
                    title: "Sign in required",
                    systemImage: "person.crop.circle.badge.exclamationmark",
                    message: "Sign in to view marketplace orders and pay with Apple Pay when an auction ends or you buy now.",
                    actionTitle: "Sign in"
                ) {
                    auth.signOut()
                }
            } else if auth.isScaffoldSession {
                BrandEmptyState(
                    title: "Sign in required",
                    systemImage: "hammer",
                    message: "Browse-only mode has no API credentials. Sign in against a live gateway to load orders and complete escrow payment."
                )
            } else if isLoading && orders.isEmpty {
                ProgressView("Loading orders…")
                    .tint(BrandTheme.accent)
                    .foregroundStyle(BrandTheme.textSecondary)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .brandScreenBackground()
            } else if let errorMessage, orders.isEmpty {
                BrandEmptyState(
                    title: "Couldn’t load orders",
                    systemImage: "exclamationmark.triangle",
                    message: errorMessage,
                    actionTitle: "Try again"
                ) {
                    Task { await load() }
                }
            } else if orders.isEmpty {
                BrandEmptyState(
                    title: "No orders yet",
                    systemImage: "bag",
                    message: "When you buy with Buy Now or win a local goods auction, orders show up here. Escrow holds funds until pickup."
                )
            } else {
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
                        ForEach(orders) { order in
                            orderRow(order)
                                .listRowBackground(BrandTheme.navyElevated)
                        }
                    } footer: {
                        Text("Pay → hold in escrow → buyer confirm pickup + seller confirm. Escrow releases automatically on the server when both confirm (no separate release button on goods). Amounts shown are server-side only.")
                            .foregroundStyle(BrandTheme.textSecondary)
                    }
                }
                .brandListBackground()
            }
        }
        .navigationTitle("Orders")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbarBackground(BrandTheme.navy, for: .navigationBar)
        .task { await load() }
        .refreshable { await load() }
        .sheet(item: $disputeOrder) { order in
            OrderDisputeSheet(order: order) { message, isError in
                statusMessage = message
                statusIsError = isError
                disputeOrder = nil
                if !isError {
                    Task { await load() }
                }
            }
        }
        .sheet(item: $noShowOrder) { order in
            OrderNoShowSheet(order: order) { message, isError in
                statusMessage = message
                statusIsError = isError
                noShowOrder = nil
                if !isError {
                    Task { await load() }
                }
            }
        }
        .sheet(item: $reviewOrder) { order in
            LeaveOrderReviewSheet(order: order) { message, isError in
                statusMessage = message
                statusIsError = isError
                reviewOrder = nil
                if !isError {
                    Task { await load() }
                }
            }
        }
        .confirmationDialog(
            "Confirm you picked up this item?",
            isPresented: Binding(
                get: { pendingPickupOrder != nil },
                set: { if !$0 { pendingPickupOrder = nil } }
            ),
            titleVisibility: .visible
        ) {
            Button("Confirm pickup") {
                guard let order = pendingPickupOrder else { return }
                pendingPickupOrder = nil
                Task { await confirmPickup(order) }
            }
            Button("Cancel", role: .cancel) { pendingPickupOrder = nil }
        } message: {
            Text("This tells the seller you’ve received the goods and advances the escrow handshake.")
        }
        .confirmationDialog(
            "Confirm handoff as seller?",
            isPresented: Binding(
                get: { pendingSellerConfirmOrder != nil },
                set: { if !$0 { pendingSellerConfirmOrder = nil } }
            ),
            titleVisibility: .visible
        ) {
            Button("Seller confirm") {
                guard let order = pendingSellerConfirmOrder else { return }
                pendingSellerConfirmOrder = nil
                Task { await sellerConfirm(order) }
            }
            Button("Cancel", role: .cancel) { pendingSellerConfirmOrder = nil }
        } message: {
            Text("Confirm the buyer took possession. When both sides confirm, escrow can release.")
        }
    }

    @ViewBuilder
    private func orderRow(_ order: ListingOrderSummary) -> some View {
        let showBuyerConfirm = order.canConfirmPickupAsBuyer(userId: currentUserID)
        let showSellerConfirm = order.canSellerConfirm(userId: currentUserID)
        let showDispute = order.canFileDisputeAsBuyer(userId: currentUserID)
        let showNoShow = order.canReportNoShow(userId: currentUserID)
        let showReview = order.canLeaveReview(userId: currentUserID)

        VStack(alignment: .leading, spacing: 8) {
            Text(order.displayTitle)
                .font(.headline)
                .foregroundStyle(BrandTheme.textPrimary)
                .fixedSize(horizontal: false, vertical: true)

            HStack {
                Text(order.displayAmount)
                    .font(.subheadline.weight(.semibold).monospacedDigit())
                    .foregroundStyle(BrandTheme.goldBright)
                Spacer()
                Text(order.displayStatus)
                    .font(.caption.weight(.medium))
                    .foregroundStyle(BrandTheme.textSecondary)
                    .multilineTextAlignment(.trailing)
            }

            if let roleLabel = roleCaption(for: order) {
                Text(roleLabel)
                    .font(.caption2)
                    .foregroundStyle(BrandTheme.bidActive.opacity(0.9))
            }

            if let next = order.nextActionCaption(userId: currentUserID) {
                Text(next)
                    .font(.caption.weight(.medium))
                    .foregroundStyle(BrandTheme.goldBright.opacity(0.95))
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityLabel(next)
            }

            if order.needsPayment {
                Button {
                    Task { await pay(order) }
                } label: {
                    if payingOrderID == order.id {
                        ProgressView()
                            .tint(BrandTheme.ctaLabelOnGold)
                            .frame(maxWidth: .infinity, minHeight: 44)
                    } else {
                        Label("Pay with Apple Pay", systemImage: "apple.logo")
                            .frame(maxWidth: .infinity, minHeight: 44)
                    }
                }
                .buttonStyle(.borderedProminent)
                .tint(BrandTheme.accent)
                .foregroundStyle(BrandTheme.ctaLabelOnGold)
                .disabled(isBusy)
                .accessibilityHint("Opens Apple Pay or card checkout for this order")
            }

            if showBuyerConfirm {
                Button {
                    pendingPickupOrder = order
                } label: {
                    if actingOrderID == order.id {
                        ProgressView()
                            .tint(BrandTheme.ctaLabelOnGold)
                            .frame(maxWidth: .infinity, minHeight: 44)
                    } else {
                        Label("Confirm pickup", systemImage: "checkmark.circle")
                            .frame(maxWidth: .infinity, minHeight: 44)
                    }
                }
                .buttonStyle(.borderedProminent)
                .tint(BrandTheme.success)
                .disabled(isBusy)
                .accessibilityHint("Confirms you picked up the item; mutual confirm releases escrow on the server")
            }

            if showSellerConfirm {
                Button {
                    pendingSellerConfirmOrder = order
                } label: {
                    if actingOrderID == order.id {
                        ProgressView()
                            .tint(BrandTheme.ctaLabelOnGold)
                            .frame(maxWidth: .infinity, minHeight: 44)
                    } else {
                        Label("Seller confirm", systemImage: "hand.thumbsup")
                            .frame(maxWidth: .infinity, minHeight: 44)
                    }
                }
                .buttonStyle(.borderedProminent)
                .tint(BrandTheme.teal)
                .disabled(isBusy)
                .accessibilityHint("Confirms the handoff as the seller; mutual confirm releases escrow on the server")
            }

            if showDispute {
                Button {
                    disputeOrder = order
                } label: {
                    Label("File dispute", systemImage: "exclamationmark.bubble")
                        .frame(maxWidth: .infinity, minHeight: 44)
                }
                .buttonStyle(.bordered)
                .disabled(isBusy)
                .accessibilityHint("Opens a form to dispute this order with support")
            }

            if showNoShow {
                Button(role: .destructive) {
                    noShowOrder = order
                } label: {
                    Label("Report no-show", systemImage: "person.slash")
                        .frame(maxWidth: .infinity, minHeight: 44)
                }
                .disabled(isBusy)
                .accessibilityHint("Reports that the other party did not show up for pickup")
            }

            if showReview {
                Button {
                    reviewOrder = order
                } label: {
                    Label("Leave review", systemImage: "star")
                        .frame(maxWidth: .infinity, minHeight: 44)
                }
                .buttonStyle(.borderedProminent)
                .tint(BrandTheme.accent)
                .foregroundStyle(BrandTheme.ctaLabelOnGold)
                .disabled(isBusy)
                .accessibilityHint("Rate this completed marketplace order")
            }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .contain)
    }

    private func roleCaption(for order: ListingOrderSummary) -> String? {
        guard let me = currentUserID, !me.isEmpty else { return nil }
        if order.buyerId == me, order.sellerId == me {
            return "You are buyer and seller"
        }
        if order.buyerId == me { return "You are the buyer" }
        if order.sellerId == me { return "You are the seller" }
        return nil
    }

    @MainActor
    private func load() async {
        guard auth.isAuthenticated, !auth.isScaffoldSession else { return }
        isLoading = orders.isEmpty
        errorMessage = nil
        defer { isLoading = false }

        if currentUserID == nil {
            currentUserID = await APIClient.shared.currentUserID()
        }

        do {
            let response = try await APIClient.shared.fetchMyOrders()
            orders = response.orders
        } catch {
            if orders.isEmpty {
                errorMessage = error.localizedDescription
            }
        }
    }

    @MainActor
    private func pay(_ order: ListingOrderSummary) async {
        statusMessage = nil
        statusIsError = false
        payingOrderID = order.id
        defer { payingOrderID = nil }

        do {
            let intent = try await APIClient.shared.payOrder(orderId: order.id)
            guard let secret = intent.clientSecret, intent.hasConfirmableSecret else {
                statusIsError = true
                statusMessage = "Could not start payment for this order. Try again shortly."
                return
            }
            try await RailACheckout.presentPaymentSheet(clientSecret: secret)
            statusIsError = false
            statusMessage = "Payment complete — funds are held in escrow until pickup."
            await load()
        } catch let error as RailACheckout.CheckoutError where error.isCanceled {
            statusIsError = false
            statusMessage = "Payment canceled."
        } catch let error as APIClientError where error.isUnauthorized {
            statusIsError = true
            statusMessage = "Sign in required. Your session is missing or expired — please sign in again."
        } catch {
            statusIsError = true
            statusMessage = error.localizedDescription
        }
    }

    @MainActor
    private func confirmPickup(_ order: ListingOrderSummary) async {
        statusMessage = nil
        statusIsError = false
        actingOrderID = order.id
        defer { actingOrderID = nil }

        do {
            let result = try await APIClient.shared.confirmOrderPickup(orderId: order.id)
            statusIsError = false
            if result.bothConfirmed == true || result.escrowStatus?.lowercased() == "released" {
                statusMessage = "Pickup confirmed by both sides — escrow released."
            } else {
                statusMessage = "Pickup confirmed. Waiting for the seller to confirm so escrow can release."
            }
            await load()
        } catch let error as APIClientError where error.isUnauthorized {
            statusIsError = true
            statusMessage = "Sign in required. Your session is missing or expired — please sign in again."
        } catch {
            statusIsError = true
            statusMessage = error.localizedDescription
        }
    }

    @MainActor
    private func sellerConfirm(_ order: ListingOrderSummary) async {
        statusMessage = nil
        statusIsError = false
        actingOrderID = order.id
        defer { actingOrderID = nil }

        do {
            let result = try await APIClient.shared.sellerConfirmOrder(orderId: order.id)
            statusIsError = false
            if result.bothConfirmed == true || result.escrowStatus?.lowercased() == "released" {
                statusMessage = "Seller confirmed — escrow released to you."
            } else {
                statusMessage = "Seller confirmed. Waiting for the buyer to confirm pickup so escrow can release."
            }
            await load()
        } catch let error as APIClientError where error.isUnauthorized {
            statusIsError = true
            statusMessage = "Sign in required. Your session is missing or expired — please sign in again."
        } catch {
            statusIsError = true
            statusMessage = error.localizedDescription
        }
    }
}

// MARK: - Dispute sheet

private struct OrderDisputeSheet: View {
    let order: ListingOrderSummary
    var onFinished: (String, Bool) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var reason: ListingDisputeReason = .itemNotAsDescribed
    @State private var descriptionText = ""
    @State private var isSubmitting = false
    @State private var localError: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text(order.displayTitle)
                        .font(.headline)
                        .foregroundStyle(BrandTheme.textPrimary)
                    Text(order.displayAmount)
                        .font(.subheadline.monospacedDigit())
                        .foregroundStyle(BrandTheme.goldBright)
                } header: {
                    Text("Order").brandSectionHeader()
                }

                Section {
                    Picker("Reason", selection: $reason) {
                        ForEach(ListingDisputeReason.allCases) { item in
                            Text(item.displayName).tag(item)
                        }
                    }
                    .frame(minHeight: 44)
                    .accessibilityLabel("Dispute reason")
                } header: {
                    Text("Why are you disputing?").brandSectionHeader()
                }

                Section {
                    TextEditor(text: $descriptionText)
                        .frame(minHeight: 140)
                        .accessibilityLabel("Dispute description")
                } header: {
                    Text("Description (min 20 characters)").brandSectionHeader()
                } footer: {
                    Text("Buyer-only. Allowed while funds are held or shortly after pickup confirmation. Support reviews and may reverse escrow.")
                        .foregroundStyle(BrandTheme.textSecondary)
                }

                if let localError {
                    Section {
                        Text(localError)
                            .font(.footnote)
                            .foregroundStyle(BrandTheme.destructive)
                    }
                }

                Section {
                    Button {
                        Task { await submit() }
                    } label: {
                        if isSubmitting {
                            ProgressView()
                                .tint(BrandTheme.ctaLabelOnGold)
                                .frame(maxWidth: .infinity, minHeight: 44)
                        } else {
                            Text("Submit dispute")
                                .frame(maxWidth: .infinity, minHeight: 44)
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(BrandTheme.accent)
                    .foregroundStyle(BrandTheme.ctaLabelOnGold)
                    .disabled(isSubmitting || descriptionText.trimmingCharacters(in: .whitespacesAndNewlines).count < 20)
                }
            }
            .brandListBackground()
            .navigationTitle("File dispute")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                        .frame(minHeight: 44)
                }
            }
        }
    }

    @MainActor
    private func submit() async {
        localError = nil
        let trimmed = descriptionText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.count >= 20 else {
            localError = "Description must be at least 20 characters."
            return
        }
        isSubmitting = true
        defer { isSubmitting = false }

        do {
            let result = try await APIClient.shared.fileOrderDispute(
                orderId: order.id,
                reason: reason,
                description: trimmed
            )
            let id = result.disputeId ?? "submitted"
            onFinished("Dispute \(id) filed. Support will review and update escrow if needed.", false)
            dismiss()
        } catch {
            localError = error.localizedDescription
        }
    }
}

// MARK: - No-show sheet

private struct OrderNoShowSheet: View {
    let order: ListingOrderSummary
    var onFinished: (String, Bool) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var notes = ""
    @State private var isSubmitting = false
    @State private var localError: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text(order.displayTitle)
                        .font(.headline)
                        .foregroundStyle(BrandTheme.textPrimary)
                    Text("Only report a no-show if the other party failed to appear during the agreed pickup window while funds are still held in escrow.")
                        .font(.footnote)
                        .foregroundStyle(BrandTheme.textSecondary)
                } header: {
                    Text("Report no-show").brandSectionHeader()
                }

                Section {
                    TextEditor(text: $notes)
                        .frame(minHeight: 100)
                        .accessibilityLabel("Optional notes")
                } header: {
                    Text("Notes (optional)").brandSectionHeader()
                } footer: {
                    Text("Repeated no-shows can trigger a temporary bidding cooldown for the absent party.")
                        .foregroundStyle(BrandTheme.textSecondary)
                }

                if let localError {
                    Section {
                        Text(localError)
                            .font(.footnote)
                            .foregroundStyle(BrandTheme.destructive)
                    }
                }

                Section {
                    Button(role: .destructive) {
                        Task { await submit() }
                    } label: {
                        if isSubmitting {
                            ProgressView()
                                .frame(maxWidth: .infinity, minHeight: 44)
                        } else {
                            Text("Submit no-show report")
                                .frame(maxWidth: .infinity, minHeight: 44)
                        }
                    }
                    .disabled(isSubmitting)
                }
            }
            .brandListBackground()
            .navigationTitle("No-show")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                        .frame(minHeight: 44)
                }
            }
        }
    }

    @MainActor
    private func submit() async {
        localError = nil
        isSubmitting = true
        defer { isSubmitting = false }

        do {
            let result = try await APIClient.shared.reportOrderNoShow(
                orderId: order.id,
                notes: notes
            )
            var message = "No-show reported."
            if let count = result.newNoShowCount {
                message += " Their no-show count is now \(count)."
            }
            if result.shadowBanTriggered == true {
                message += " A temporary bidding cooldown was applied."
            }
            onFinished(message, false)
            dismiss()
        } catch {
            localError = error.localizedDescription
        }
    }
}


// MARK: - Leave goods order review (FE-14)

private struct LeaveOrderReviewSheet: View {
    let order: ListingOrderSummary
    var onFinished: (String, Bool) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var rating = 5
    @State private var comment = ""
    @State private var isSubmitting = false
    @State private var isLoadingEligibility = true
    @State private var eligibility: ListingOrderReviewEligibility?
    @State private var localError: String?

    private var canSubmit: Bool {
        !isSubmitting && (eligibility?.isEligible == true)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text(order.displayTitle)
                        .font(.headline)
                        .foregroundStyle(BrandTheme.textPrimary)
                    Text(order.displayAmount)
                        .font(.subheadline.monospacedDigit())
                        .foregroundStyle(BrandTheme.goldBright)
                } header: {
                    Text("Order").brandSectionHeader()
                }

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

                        TextField("Comment (optional, max 2000)", text: $comment, axis: .vertical)
                            .lineLimit(3 ... 8)
                            .listRowBackground(BrandTheme.navyElevated)
                    } header: {
                        Text("Review").brandSectionHeader()
                    } footer: {
                        Text("Goods reviews publish immediately (not double-blind). Overall rating is required. Window is 14 days after escrow release.")
                            .foregroundStyle(BrandTheme.textSecondary)
                    }
                }

                if let localError {
                    Section {
                        Text(localError)
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
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }
                        .disabled(isSubmitting)
                        .frame(minHeight: 44)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Submit") {
                        Task { await submit() }
                    }
                    .disabled(!canSubmit)
                    .fontWeight(.semibold)
                    .frame(minHeight: 44)
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
            eligibility = try await APIClient.shared.fetchListingOrderReviewEligibility(orderId: order.id)
            localError = nil
        } catch {
            localError = error.localizedDescription
            eligibility = ListingOrderReviewEligibility(eligible: false, alreadyReviewed: false, reviewWindowClosesAt: nil)
        }
    }

    @MainActor
    private func submit() async {
        localError = nil
        isSubmitting = true
        defer { isSubmitting = false }
        do {
            _ = try await APIClient.shared.createListingOrderReview(
                orderId: order.id,
                rating: rating,
                comment: comment
            )
            onFinished("Review submitted.", false)
            dismiss()
        } catch {
            localError = error.localizedDescription
        }
    }
}

#Preview {
    NavigationStack {
        MyOrdersView()
            .environmentObject(AuthViewModel())
    }
    .preferredColorScheme(.dark)
    .tint(BrandTheme.accent)
}
