import SwiftUI

/// Buyer/seller order list — pay pending marketplace orders with Apple Pay.
struct MyOrdersView: View {
    @EnvironmentObject private var auth: AuthViewModel

    @State private var orders: [ListingOrderSummary] = []
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var payingOrderID: String?
    @State private var statusMessage: String?
    @State private var statusIsError = false

    var body: some View {
        Group {
            if !auth.isAuthenticated {
                ContentUnavailableView {
                    Label("Sign in required", systemImage: "person.crop.circle.badge.exclamationmark")
                } description: {
                    Text("Sign in to view your marketplace orders and pay with Apple Pay.")
                }
            } else if auth.isScaffoldSession {
                ContentUnavailableView {
                    Label("Scaffold session", systemImage: "hammer")
                } description: {
                    Text("Scaffold sessions have no API credentials. Sign in against a live gateway to load orders.")
                }
            } else if isLoading && orders.isEmpty {
                ProgressView("Loading orders…")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let errorMessage, orders.isEmpty {
                ContentUnavailableView {
                    Label("Couldn’t load orders", systemImage: "exclamationmark.triangle")
                } description: {
                    Text(errorMessage)
                } actions: {
                    Button("Try again") {
                        Task { await load() }
                    }
                    .buttonStyle(.borderedProminent)
                    .frame(minHeight: 44)
                }
            } else if orders.isEmpty {
                ContentUnavailableView {
                    Label("No orders yet", systemImage: "bag")
                } description: {
                    Text("When you buy with Buy Now or win an auction, orders show up here.")
                }
            } else {
                List {
                    if let statusMessage {
                        Section {
                            Text(statusMessage)
                                .font(.footnote)
                                .foregroundStyle(statusIsError ? .red : .secondary)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }

                    Section {
                        ForEach(orders) { order in
                            orderRow(order)
                        }
                    } footer: {
                        Text("Pending orders use Apple Pay (or card) via Stripe. Escrow holds funds until pickup is confirmed.")
                    }
                }
                .listStyle(.insetGrouped)
            }
        }
        .navigationTitle("Orders")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .task { await load() }
        .refreshable { await load() }
    }

    @ViewBuilder
    private func orderRow(_ order: ListingOrderSummary) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(order.displayTitle)
                .font(.headline)
                .fixedSize(horizontal: false, vertical: true)

            HStack {
                Text(order.displayAmount)
                    .font(.subheadline.weight(.semibold).monospacedDigit())
                Spacer()
                Text(order.displayStatus)
                    .font(.caption.weight(.medium))
                    .foregroundStyle(.secondary)
            }

            if order.needsPayment {
                Button {
                    Task { await pay(order) }
                } label: {
                    if payingOrderID == order.id {
                        ProgressView()
                            .frame(maxWidth: .infinity, minHeight: 44)
                    } else {
                        Label("Pay with Apple Pay", systemImage: "apple.logo")
                            .frame(maxWidth: .infinity, minHeight: 44)
                    }
                }
                .buttonStyle(.borderedProminent)
                .disabled(payingOrderID != nil)
                .accessibilityHint("Opens Apple Pay or card checkout for this order")
            }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
    }

    @MainActor
    private func load() async {
        guard auth.isAuthenticated, !auth.isScaffoldSession else { return }
        isLoading = orders.isEmpty
        errorMessage = nil
        defer { isLoading = false }

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
}

#Preview {
    NavigationStack {
        MyOrdersView()
            .environmentObject(AuthViewModel())
    }
}
