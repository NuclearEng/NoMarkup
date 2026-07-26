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
                        Text("Pending orders use Apple Pay (or card) via Stripe. Escrow holds funds until pickup is confirmed — fair trade, no platform markup on the bid.")
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
    }

    @ViewBuilder
    private func orderRow(_ order: ListingOrderSummary) -> some View {
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
    .preferredColorScheme(.dark)
    .tint(BrandTheme.accent)
}
