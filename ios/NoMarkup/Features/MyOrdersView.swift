import SwiftUI

/// Buyer/seller order list — pay pending orders and complete escrow pickup handshake.
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
                        Text("Pending orders use Apple Pay (or card) via Stripe. After payment, both buyer and seller confirm pickup to release escrow — fair trade, no platform markup on the bid.")
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
        .toolbarBackground(.visible, for: .navigationBar)
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
    }

    @ViewBuilder
    private func orderRow(_ order: ListingOrderSummary) -> some View {
        let showBuyerConfirm = order.canConfirmPickupAsBuyer(userId: currentUserID)
        let showSellerConfirm = order.canSellerConfirm(userId: currentUserID)
        let showDispute = order.canFileDisputeAsBuyer(userId: currentUserID)
        let showNoShow = order.canReportNoShow(userId: currentUserID)

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

            if order.needsPayment {
                Button {
                    Task { await pay(order) }
                } label: {
                    if payingOrderID == order.id {
                        ProgressView()
                            .tint(BrandTheme.navy)
                            .frame(maxWidth: .infinity, minHeight: 44)
                    } else {
                        Label("Pay with Apple Pay", systemImage: "apple.logo")
                            .frame(maxWidth: .infinity, minHeight: 44)
                    }
                }
                .buttonStyle(.borderedProminent)
                .tint(BrandTheme.accent)
                .disabled(isBusy)
                .accessibilityHint("Opens Apple Pay or card checkout for this order")
            }

            if showBuyerConfirm {
                Button {
                    Task { await confirmPickup(order) }
                } label: {
                    if actingOrderID == order.id {
                        ProgressView()
                            .tint(BrandTheme.navy)
                            .frame(maxWidth: .infinity, minHeight: 44)
                    } else {
                        Label("Confirm pickup", systemImage: "checkmark.circle")
                            .frame(maxWidth: .infinity, minHeight: 44)
                    }
                }
                .buttonStyle(.borderedProminent)
                .tint(BrandTheme.success)
                .disabled(isBusy)
                .accessibilityHint("Confirms you picked up the item and starts escrow release")
            }

            if showSellerConfirm {
                Button {
                    Task { await sellerConfirm(order) }
                } label: {
                    if actingOrderID == order.id {
                        ProgressView()
                            .tint(BrandTheme.navy)
                            .frame(maxWidth: .infinity, minHeight: 44)
                    } else {
                        Label("Seller confirm", systemImage: "hand.thumbsup")
                            .frame(maxWidth: .infinity, minHeight: 44)
                    }
                }
                .buttonStyle(.borderedProminent)
                .tint(BrandTheme.teal)
                .disabled(isBusy)
                .accessibilityHint("Confirms the handoff as the seller to release escrow")
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
                                .tint(BrandTheme.navy)
                                .frame(maxWidth: .infinity, minHeight: 44)
                        } else {
                            Text("Submit dispute")
                                .frame(maxWidth: .infinity, minHeight: 44)
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(BrandTheme.accent)
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

#Preview {
    NavigationStack {
        MyOrdersView()
            .environmentObject(AuthViewModel())
    }
    .preferredColorScheme(.dark)
    .tint(BrandTheme.accent)
}
