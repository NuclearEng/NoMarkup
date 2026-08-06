import SwiftUI

/// Full product parity hub: BNPL, insurance, advances, instant payout, expenses, tax.
/// Each section is gated by `FeatureFlags.isEnabled` (server-driven; no hard-offs).
struct BusinessFeaturesHubView: View {
    @EnvironmentObject private var auth: AuthViewModel
    @EnvironmentObject private var flags: FeatureFlags

    var body: some View {
        List {
            Section {
                Text("These surfaces match the web provider portal and customer payment tools. Availability follows live feature flags from the server.")
                    .font(.footnote)
                    .foregroundStyle(BrandTheme.textSecondary)
                    .listRowBackground(BrandTheme.navyElevated)
            }

            Section {
                featureLink(
                    flag: "customer_bnpl",
                    title: "Payment plans (BNPL)",
                    systemImage: "calendar.badge.clock",
                    destination: InstallmentsListView()
                )
                featureLink(
                    flag: "per_job_insurance",
                    title: "Insurance policies",
                    systemImage: "shield.checkered",
                    destination: InsurancePoliciesView()
                )
                featureLink(
                    flag: "working_capital",
                    title: "Working capital advances",
                    systemImage: "building.columns",
                    destination: AdvancesView()
                )
                featureLink(
                    flag: "instant_payout",
                    title: "Instant payout",
                    systemImage: "bolt.fill",
                    destination: InstantPayoutView()
                )
            } header: {
                Text("Money rails").brandSectionHeader()
            } footer: {
                Text("When a flag is off, the server returns 503 for that rail — UI stays visible but actions explain the gate.")
                    .foregroundStyle(BrandTheme.textSecondary)
            }

            Section {
                NavigationLink {
                    ExpensesView()
                } label: {
                    Label("Business expenses", systemImage: "receipt")
                }
                .frame(minHeight: 44)

                NavigationLink {
                    ProviderInvoicesView()
                } label: {
                    Label("Invoices", systemImage: "doc.plaintext")
                }
                .frame(minHeight: 44)
                .accessibilityIdentifier("business.row.invoices")
                .accessibilityHint("View and share invoices for completed contracts")

                NavigationLink {
                    TaxCenterView()
                } label: {
                    Label("Tax center", systemImage: "doc.richtext")
                }
                .frame(minHeight: 44)
            } header: {
                Text("Provider business OS").brandSectionHeader()
            }

            Section {
                NavigationLink {
                    InsuranceQuoteFlowView()
                } label: {
                    Label("Insurance quote", systemImage: "shield.lefthalf.filled")
                }
                .frame(minHeight: 44)
                .disabled(!flags.isEnabled("per_job_insurance") && !flags.isEnabled("insurance_competition"))
                .accessibilityIdentifier("business.row.insuranceQuote")
                .accessibilityHint("Request a per-job insurance quote for a contract")

                NavigationLink {
                    InsuranceProductsBrowseView()
                } label: {
                    Label("Browse insurance products", systemImage: "cross.case")
                }
                .frame(minHeight: 44)
                .disabled(!flags.isEnabled("per_job_insurance") && !flags.isEnabled("insurance_competition"))
            } header: {
                Text("Insurance catalog").brandSectionHeader()
            }
        }
        .brandListBackground()
        .navigationTitle("Business & finance")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .brandNavigationBarChrome()
        .task { await flags.refresh() }
    }

    @ViewBuilder
    private func featureLink<D: View>(
        flag: String,
        title: String,
        systemImage: String,
        destination: D
    ) -> some View {
        let on = flags.isEnabled(flag)
        NavigationLink {
            destination
        } label: {
            HStack {
                Label(title, systemImage: systemImage)
                Spacer()
                Text(on ? "On" : "Flag off")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(on ? BrandTheme.success : BrandTheme.textSecondary)
            }
            .frame(minHeight: 44)
        }
        .listRowBackground(BrandTheme.navyElevated)
        .accessibilityHint(on ? "Open \(title)" : "\(title) flag is currently off on the server")
    }
}

// MARK: - Installments

struct InstallmentsListView: View {
    @EnvironmentObject private var auth: AuthViewModel
    @EnvironmentObject private var flags: FeatureFlags
    @State private var plans: [InstallmentPlan] = []
    @State private var isLoading = false
    @State private var errorMessage: String?

    var body: some View {
        Group {
            if !flags.isEnabled("customer_bnpl") {
                BrandEmptyState(
                    title: "Installments unavailable",
                    systemImage: "calendar.badge.exclamationmark",
                    message: "The customer_bnpl feature flag is off. Enable it on the server to create payment plans."
                )
            } else if isLoading && plans.isEmpty {
                BrandLoadingScreen(kind: .form, accessibilityLabel: "Loading plans…")
            } else if let errorMessage, plans.isEmpty {
                BrandEmptyState(
                    title: "Couldn’t load plans",
                    systemImage: "exclamationmark.triangle",
                    message: errorMessage
                )
            } else if plans.isEmpty {
                BrandEmptyState(
                    title: "No installment plans",
                    systemImage: "calendar",
                    message: "Create a plan from a completed contract detail (when BNPL is enabled)."
                )
            } else {
                List(plans) { plan in
                    NavigationLink {
                        InstallmentPlanDetailView(planId: plan.id, preview: plan)
                    } label: {
                        VStack(alignment: .leading, spacing: 6) {
                            Text(plan.displayTotal)
                                .font(.headline.monospacedDigit())
                                .foregroundStyle(BrandTheme.goldBright)
                            Text("\(plan.installmentCount ?? 0) payments · \(plan.displayStatus)")
                                .font(.caption)
                                .foregroundStyle(BrandTheme.textSecondary)
                        }
                    }
                    .frame(minHeight: 44)
                    .listRowBackground(BrandTheme.navyElevated)
                    .accessibilityHint("Opens installment schedule")
                }
                .brandListBackground()
            }
        }
        .navigationTitle("Payment plans")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .task { await load() }
        .refreshable { await load() }
    }

    @MainActor
    private func load() async {
        guard auth.isAuthenticated, !auth.isScaffoldSession else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            plans = try await APIClient.shared.fetchInstallmentPlans()
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

// MARK: - Insurance

struct InsurancePoliciesView: View {
    @EnvironmentObject private var auth: AuthViewModel
    @State private var policies: [InsurancePolicy] = []
    @State private var isLoading = false
    @State private var errorMessage: String?

    var body: some View {
        Group {
            if isLoading && policies.isEmpty {
                BrandLoadingScreen(kind: .form, accessibilityLabel: "Loading policies…")
            } else if policies.isEmpty {
                BrandEmptyState(
                    title: "No policies yet",
                    systemImage: "shield",
                    message: "Purchase coverage from a contract detail when insurance is enabled."
                )
            } else {
                List(policies) { policy in
                    VStack(alignment: .leading, spacing: 4) {
                        Text(policy.displayStatus)
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(BrandTheme.textPrimary)
                        Text("Premium \(MoneyFormat.usd(cents: policy.premiumCents ?? 0))")
                            .font(.caption)
                            .foregroundStyle(BrandTheme.textSecondary)
                    }
                    .listRowBackground(BrandTheme.navyElevated)
                }
                .brandListBackground()
            }
        }
        .navigationTitle("Insurance")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .task { await load() }
        .refreshable { await load() }
    }

    @MainActor
    private func load() async {
        guard auth.isAuthenticated, !auth.isScaffoldSession else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            policies = try await APIClient.shared.fetchInsurancePolicies()
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

struct InsuranceProductsBrowseView: View {
    @EnvironmentObject private var auth: AuthViewModel
    @State private var products: [InsuranceProduct] = []
    @State private var isLoading = false

    var body: some View {
        Group {
            if isLoading && products.isEmpty {
                BrandLoadingScreen(kind: .form, accessibilityLabel: "Loading products…")
            } else {
                List(products) { product in
                    VStack(alignment: .leading, spacing: 4) {
                        Text(product.displayName)
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(BrandTheme.textPrimary)
                        if let description = product.description, !description.isEmpty {
                            Text(description)
                                .font(.caption)
                                .foregroundStyle(BrandTheme.textSecondary)
                        }
                        Text("From \(product.displayPremium)")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(BrandTheme.goldBright)
                    }
                    .listRowBackground(BrandTheme.navyElevated)
                }
                .brandListBackground()
            }
        }
        .navigationTitle("Insurance products")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .task {
            guard auth.isAuthenticated else { return }
            isLoading = true
            defer { isLoading = false }
            products = (try? await APIClient.shared.fetchInsuranceProducts()) ?? []
        }
    }
}

// MARK: - Insurance quote flow (web `/insurance/quotes` lite)

/// Contract + product → `POST /api/v1/insurance/quote` (+ optional purchase).
/// Account + Business hub entry. Server-gated by `per_job_insurance` / `insurance_competition`.
struct InsuranceQuoteFlowView: View {
    @EnvironmentObject private var auth: AuthViewModel
    @EnvironmentObject private var flags: FeatureFlags

    @State private var contractIdText = ""
    @State private var products: [InsuranceProduct] = []
    @State private var selectedProductId: String?
    @State private var paymentMethods: [PaymentMethodRow] = []
    @State private var selectedPaymentMethodId: String?
    @State private var quote: InsuranceQuote?
    @State private var isLoadingCatalog = false
    @State private var isQuoting = false
    @State private var isPurchasing = false
    @State private var statusMessage: String?
    @State private var statusIsError = false
    @State private var loadError: String?

    private var insuranceEnabled: Bool {
        flags.isEnabled("per_job_insurance") || flags.isEnabled("insurance_competition")
    }

    private var selectedProduct: InsuranceProduct? {
        guard let selectedProductId else { return nil }
        return products.first(where: { $0.id == selectedProductId })
    }

    var body: some View {
        Group {
            if auth.isScaffoldSession || !auth.isAuthenticated {
                BrandEmptyState(
                    title: "Sign in required",
                    systemImage: "shield.lefthalf.filled",
                    message: "Sign in to request a per-job insurance quote for a contract."
                )
            } else if !insuranceEnabled {
                BrandEmptyState(
                    title: "Insurance unavailable",
                    systemImage: "shield.slash",
                    message: "per_job_insurance and insurance_competition flags are off. Enable one on the server to quote coverage."
                )
            } else if isLoadingCatalog && products.isEmpty && loadError == nil {
                BrandLoadingScreen(kind: .form, accessibilityLabel: "Loading insurance products…")
            } else if let loadError, products.isEmpty {
                BrandEmptyState(
                    title: "Couldn’t load products",
                    systemImage: "exclamationmark.triangle",
                    message: loadError,
                    actionTitle: "Try again"
                ) {
                    Task { await loadCatalog() }
                }
            } else {
                quoteForm
            }
        }
        .navigationTitle("Insurance quote")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .brandNavigationBarChrome()
        .task {
            await flags.refresh()
            await loadCatalog()
        }
        .accessibilityIdentifier("insurance.quote.flow")
    }

    private var quoteForm: some View {
        Form {
            Section {
                TextField("Contract ID", text: $contractIdText)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .font(.body.monospaced())
                    .frame(minHeight: 44)
                    .listRowBackground(BrandTheme.navyElevated)
                    .accessibilityLabel("Contract identifier")
                    .accessibilityIdentifier("insurance.quote.contractId")
            } header: {
                Text("Contract").brandSectionHeader()
            } footer: {
                Text("Use the contract UUID from a completed or in-progress reverse-auction job.")
                    .foregroundStyle(BrandTheme.textSecondary)
            }

            Section {
                if products.isEmpty {
                    Text("No insurance products returned. Check the catalog flag or admin product seed.")
                        .font(.footnote)
                        .foregroundStyle(BrandTheme.textSecondary)
                        .listRowBackground(BrandTheme.navyElevated)
                } else {
                    ForEach(products) { product in
                        Button {
                            selectedProductId = product.id
                            quote = nil
                            statusMessage = nil
                            BrandHaptics.selection()
                        } label: {
                            HStack(alignment: .top, spacing: 12) {
                                Image(systemName: selectedProductId == product.id
                                      ? "checkmark.circle.fill"
                                      : "circle")
                                    .foregroundStyle(
                                        selectedProductId == product.id
                                            ? BrandTheme.goldBright
                                            : BrandTheme.textSecondary
                                    )
                                    .accessibilityHidden(true)
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(product.displayName)
                                        .font(.subheadline.weight(.semibold))
                                        .foregroundStyle(BrandTheme.textPrimary)
                                    if let description = product.description, !description.isEmpty {
                                        Text(description)
                                            .font(.caption)
                                            .foregroundStyle(BrandTheme.textSecondary)
                                            .fixedSize(horizontal: false, vertical: true)
                                    }
                                    Text("From \(product.displayPremium)")
                                        .font(.caption.weight(.semibold).monospacedDigit())
                                        .foregroundStyle(BrandTheme.goldBright)
                                }
                                Spacer(minLength: 0)
                            }
                            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .listRowBackground(BrandTheme.navyElevated)
                        .accessibilityAddTraits(selectedProductId == product.id ? [.isSelected] : [])
                        .accessibilityHint("Selects this product for quoting")
                    }
                }
            } header: {
                Text("Product").brandSectionHeader()
            }

            Section {
                Button {
                    Task { await requestQuote() }
                } label: {
                    if isQuoting {
                        ProgressView()
                            .tint(BrandTheme.ctaLabelOnGold)
                            .frame(maxWidth: .infinity, minHeight: 44)
                    } else {
                        Text("Get quote")
                            .frame(maxWidth: .infinity, minHeight: 44)
                    }
                }
                .buttonStyle(.borderedProminent)
                .tint(BrandTheme.gold)
                .foregroundStyle(BrandTheme.ctaLabelOnGold)
                .disabled(isQuoting || selectedProductId == nil)
                .listRowBackground(BrandTheme.navyElevated)
                .accessibilityIdentifier("insurance.quote.submit")
            }

            if let quote {
                Section {
                    LabeledContent("Premium") {
                        Text(quote.displayPremium)
                            .font(.body.weight(.semibold).monospacedDigit())
                            .foregroundStyle(BrandTheme.goldBright)
                    }
                    if let coverage = quote.coverageCents, coverage > 0 {
                        LabeledContent("Coverage") {
                            Text(MoneyFormat.usd(cents: coverage))
                                .font(.body.monospacedDigit())
                        }
                    }
                    if let productId = quote.productId ?? selectedProductId, !productId.isEmpty {
                        LabeledContent("Product") {
                            Text(String(productId.prefix(8)) + "…")
                                .font(.caption.monospaced())
                                .foregroundStyle(BrandTheme.textSecondary)
                        }
                    }
                    if let quoteId = quote.quoteId, !quoteId.isEmpty {
                        LabeledContent("Quote ID") {
                            Text(String(quoteId.prefix(8)) + "…")
                                .font(.caption.monospaced())
                                .foregroundStyle(BrandTheme.textSecondary)
                        }
                    }
                } header: {
                    Text("Quote").brandSectionHeader()
                }
                .listRowBackground(BrandTheme.navyElevated)
            }

            if quote != nil {
                Section {
                    if paymentMethods.isEmpty {
                        Text("Add a payment method under Account → Payment methods to purchase coverage.")
                            .font(.footnote)
                            .foregroundStyle(BrandTheme.textSecondary)
                            .listRowBackground(BrandTheme.navyElevated)
                    } else {
                        Picker("Payment method", selection: $selectedPaymentMethodId) {
                            Text("Select card").tag(String?.none)
                            ForEach(paymentMethods) { method in
                                Text(method.displayLabel).tag(Optional(method.id))
                            }
                        }
                        .listRowBackground(BrandTheme.navyElevated)
                        .accessibilityIdentifier("insurance.quote.paymentMethod")

                        Button {
                            Task { await purchase() }
                        } label: {
                            if isPurchasing {
                                ProgressView()
                                    .tint(BrandTheme.ctaLabelOnGold)
                                    .frame(maxWidth: .infinity, minHeight: 44)
                            } else {
                                Text("Purchase coverage")
                                    .frame(maxWidth: .infinity, minHeight: 44)
                            }
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(BrandTheme.gold)
                        .foregroundStyle(BrandTheme.ctaLabelOnGold)
                        .disabled(isPurchasing || selectedPaymentMethodId == nil)
                        .listRowBackground(BrandTheme.navyElevated)
                        .accessibilityIdentifier("insurance.quote.purchase")
                    }
                } header: {
                    Text("Purchase").brandSectionHeader()
                } footer: {
                    Text("Purchase posts to the insurance rail with a sticky Idempotency-Key. Fail closed when the flag is off.")
                        .foregroundStyle(BrandTheme.textSecondary)
                }
            }

            if let statusMessage {
                Section {
                    Text(statusMessage)
                        .font(.footnote)
                        .foregroundStyle(statusIsError ? BrandTheme.destructive : BrandTheme.success)
                        .fixedSize(horizontal: false, vertical: true)
                        .listRowBackground(BrandTheme.navyElevated)
                        .accessibilityIdentifier("insurance.quote.status")
                }
            }
        }
        .brandListBackground()
    }

    @MainActor
    private func loadCatalog() async {
        guard auth.isAuthenticated, !auth.isScaffoldSession else { return }
        isLoadingCatalog = true
        defer { isLoadingCatalog = false }
        do {
            async let productList = APIClient.shared.fetchInsuranceProducts()
            async let methods = APIClient.shared.fetchPaymentMethods()
            products = try await productList
            paymentMethods = (try? await methods)?.methods ?? []
            if selectedProductId == nil {
                selectedProductId = products.first?.id
            }
            if selectedPaymentMethodId == nil {
                selectedPaymentMethodId = paymentMethods.first(where: { $0.isDefault == true })?.id
                    ?? paymentMethods.first?.id
            }
            loadError = nil
        } catch {
            if products.isEmpty {
                loadError = error.localizedDescription
            }
        }
    }

    @MainActor
    private func requestQuote() async {
        let contractId = contractIdText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !contractId.isEmpty else {
            statusMessage = "Enter a contract id."
            statusIsError = true
            BrandHaptics.warning()
            return
        }
        guard let productId = selectedProductId, !productId.isEmpty else {
            statusMessage = "Select an insurance product."
            statusIsError = true
            BrandHaptics.warning()
            return
        }
        isQuoting = true
        defer { isQuoting = false }
        do {
            quote = try await APIClient.shared.quoteInsurance(
                contractId: contractId,
                productId: productId
            )
            statusMessage = "Quote ready — review premium before purchase."
            statusIsError = false
            BrandHaptics.success()
        } catch {
            quote = nil
            statusMessage = error.localizedDescription
            statusIsError = true
            BrandHaptics.error()
        }
    }

    @MainActor
    private func purchase() async {
        let contractId = contractIdText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !contractId.isEmpty else {
            statusMessage = "Enter a contract id."
            statusIsError = true
            return
        }
        guard let productId = selectedProductId ?? quote?.productId, !productId.isEmpty else {
            statusMessage = "Select an insurance product."
            statusIsError = true
            return
        }
        guard let paymentMethodId = selectedPaymentMethodId, !paymentMethodId.isEmpty else {
            statusMessage = "Select a payment method."
            statusIsError = true
            return
        }
        isPurchasing = true
        defer { isPurchasing = false }
        do {
            let policy = try await APIClient.shared.purchaseInsurance(
                contractId: contractId,
                productId: productId,
                paymentMethodId: paymentMethodId
            )
            statusMessage = "Coverage purchased · \(policy.displayStatus) · \(MoneyFormat.usd(cents: policy.premiumCents ?? 0))"
            statusIsError = false
            BrandHaptics.success()
        } catch {
            statusMessage = error.localizedDescription
            statusIsError = true
            BrandHaptics.error()
        }
    }
}

// MARK: - Advances

struct AdvancesView: View {
    @EnvironmentObject private var auth: AuthViewModel
    @EnvironmentObject private var flags: FeatureFlags
    @State private var advances: [WorkingCapitalAdvance] = []
    @State private var credit: CreditLimit?
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var repayAmountText = ""
    @State private var repayingId: String?
    @State private var requestContractId = ""
    @State private var requestAmountText = ""
    @State private var isRequesting = false

    var body: some View {
        List {
            if !flags.isEnabled("working_capital") {
                Section {
                    Text("working_capital flag is off on the server.")
                        .font(.footnote)
                        .foregroundStyle(BrandTheme.warning)
                        .listRowBackground(BrandTheme.navyElevated)
                }
            }
            if let credit {
                Section {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Available credit")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(BrandTheme.textSecondary)
                        Text(credit.displayAvailable)
                            .font(.title2.weight(.bold).monospacedDigit())
                            .foregroundStyle(BrandTheme.goldBright)
                    }
                    .listRowBackground(BrandTheme.navyElevated)
                } header: {
                    Text("Credit limit").brandSectionHeader()
                }
            }
            Section {
                TextField("Contract ID", text: $requestContractId)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .font(.body.monospaced())
                    .frame(minHeight: 44)
                    .listRowBackground(BrandTheme.navyElevated)
                    .accessibilityLabel("Contract identifier for advance")
                DollarAmountField(text: $requestAmountText, placeholder: "Advance amount $")
                    .listRowBackground(BrandTheme.navyElevated)
                Button {
                    Task { await requestAdvance() }
                } label: {
                    if isRequesting {
                        ProgressView()
                            .tint(BrandTheme.ctaLabelOnGold)
                            .frame(maxWidth: .infinity, minHeight: 44)
                    } else {
                        Text("Request advance")
                            .frame(maxWidth: .infinity, minHeight: 44)
                    }
                }
                .buttonStyle(.borderedProminent)
                .tint(BrandTheme.gold)
                .foregroundStyle(BrandTheme.ctaLabelOnGold)
                .disabled(isRequesting || !flags.isEnabled("working_capital"))
                .listRowBackground(BrandTheme.navyElevated)
            } header: {
                Text("Request advance").brandSectionHeader()
            } footer: {
                Text("Against a funded service contract. Server enforces credit limit.")
                    .foregroundStyle(BrandTheme.textSecondary)
            }
            Section {
                if advances.isEmpty {
                    Text("No advances yet. Request from a funded contract.")
                        .font(.footnote)
                        .foregroundStyle(BrandTheme.textSecondary)
                        .listRowBackground(BrandTheme.navyElevated)
                } else {
                    ForEach(advances) { advance in
                        VStack(alignment: .leading, spacing: 8) {
                            HStack {
                                Text(advance.displayAmount)
                                    .font(.headline.monospacedDigit())
                                    .foregroundStyle(BrandTheme.goldBright)
                                Spacer()
                                Text(advance.displayStatus)
                                    .font(.caption.weight(.semibold))
                                    .foregroundStyle(BrandTheme.textSecondary)
                            }
                            Text("Outstanding \(MoneyFormat.usd(cents: advance.outstandingCents))")
                                .font(.caption)
                                .foregroundStyle(BrandTheme.textSecondary)
                            if advance.outstandingCents > 0 {
                                HStack {
                                    DollarAmountField(text: $repayAmountText, placeholder: "Repay $")
                                    Button("Repay") {
                                        Task { await repay(advance) }
                                    }
                                    .buttonStyle(.borderedProminent)
                                    .tint(BrandTheme.teal)
                                    .disabled(repayingId != nil)
                                }
                            }
                        }
                        .listRowBackground(BrandTheme.navyElevated)
                    }
                }
            } header: {
                Text("Advances").brandSectionHeader()
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
        .navigationTitle("Working capital")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .task { await load() }
        .refreshable { await load() }
    }

    @MainActor
    private func load() async {
        guard auth.isAuthenticated, !auth.isScaffoldSession else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            async let a = APIClient.shared.fetchMyAdvances()
            async let c = APIClient.shared.fetchCreditLimit()
            advances = try await a
            credit = try? await c
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    @MainActor
    private func requestAdvance() async {
        let cid = requestContractId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cid.isEmpty else {
            errorMessage = "Enter a contract id."
            BrandHaptics.warning()
            return
        }
        guard let cents = MoneyFormat.cents(fromDollarsText: requestAmountText), cents > 0 else {
            errorMessage = "Enter a valid advance amount."
            BrandHaptics.warning()
            return
        }
        isRequesting = true
        defer { isRequesting = false }
        do {
            _ = try await APIClient.shared.requestAdvance(contractId: cid, amountCents: cents)
            requestAmountText = ""
            errorMessage = nil
            BrandHaptics.success()
            await load()
        } catch {
            errorMessage = error.localizedDescription
            BrandHaptics.error()
        }
    }

    @MainActor
    private func repay(_ advance: WorkingCapitalAdvance) async {
        guard let cents = MoneyFormat.cents(fromDollarsText: repayAmountText), cents > 0 else {
            errorMessage = "Enter a valid repayment amount."
            return
        }
        repayingId = advance.id
        defer { repayingId = nil }
        do {
            _ = try await APIClient.shared.repayAdvance(id: advance.id, amountCents: cents)
            repayAmountText = ""
            await load()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

// MARK: - Instant payout

struct InstantPayoutView: View {
    @EnvironmentObject private var auth: AuthViewModel
    @EnvironmentObject private var flags: FeatureFlags
    @State private var summary: InstantPayoutSummary?
    @State private var amountText = ""
    @State private var isSubmitting = false
    @State private var statusMessage: String?
    @State private var statusIsError = false

    var body: some View {
        Form {
            if !flags.isEnabled("instant_payout") {
                Section {
                    Text("instant_payout flag is off. Enable the flag to request instant Connect payouts.")
                        .font(.footnote)
                        .foregroundStyle(BrandTheme.warning)
                        .listRowBackground(BrandTheme.navyElevated)
                }
            }
            Section {
                Text(summary?.displayAvailable ?? "—")
                    .font(.title2.weight(.bold).monospacedDigit())
                    .foregroundStyle(BrandTheme.goldBright)
                    .listRowBackground(BrandTheme.navyElevated)
            } header: {
                Text("Available").brandSectionHeader()
            }
            Section {
                DollarAmountField(text: $amountText, placeholder: "Amount $")
                    .listRowBackground(BrandTheme.navyElevated)
                Button {
                    Task { await submit() }
                } label: {
                    if isSubmitting {
                        ProgressView().tint(BrandTheme.ctaLabelOnGold)
                            .frame(maxWidth: .infinity, minHeight: 44)
                    } else {
                        Text("Request instant payout")
                            .frame(maxWidth: .infinity, minHeight: 44)
                    }
                }
                .buttonStyle(.borderedProminent)
                .tint(BrandTheme.gold)
                .foregroundStyle(BrandTheme.ctaLabelOnGold)
                .disabled(isSubmitting || !flags.isEnabled("instant_payout"))
                .listRowBackground(BrandTheme.navyElevated)
            } header: {
                Text("Payout").brandSectionHeader()
            }
            if let statusMessage {
                Section {
                    Text(statusMessage)
                        .font(.footnote)
                        .foregroundStyle(statusIsError ? BrandTheme.destructive : BrandTheme.success)
                        .listRowBackground(BrandTheme.navyElevated)
                }
            }
        }
        .brandListBackground()
        .navigationTitle("Instant payout")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .task {
            summary = try? await APIClient.shared.fetchInstantPayoutSummary()
        }
    }

    @MainActor
    private func submit() async {
        guard let cents = MoneyFormat.cents(fromDollarsText: amountText), cents > 0 else {
            statusIsError = true
            statusMessage = "Enter a valid amount."
            return
        }
        isSubmitting = true
        defer { isSubmitting = false }
        do {
            let result = try await APIClient.shared.requestInstantPayout(amountCents: cents)
            statusIsError = false
            statusMessage = "Submitted \(MoneyFormat.usd(cents: result.amountCents ?? cents))."
            summary = try? await APIClient.shared.fetchInstantPayoutSummary()
        } catch {
            statusIsError = true
            statusMessage = error.localizedDescription
        }
    }
}

// MARK: - Expenses

struct ExpensesView: View {
    @EnvironmentObject private var auth: AuthViewModel
    @State private var expenses: [ProviderExpense] = []
    @State private var category = "supplies"
    @State private var amountText = ""
    @State private var note = ""
    @State private var isLoading = false
    @State private var errorMessage: String?

    var body: some View {
        List {
            Section {
                TextField("Category", text: $category)
                    .listRowBackground(BrandTheme.navyElevated)
                DollarAmountField(text: $amountText, placeholder: "Amount $")
                    .listRowBackground(BrandTheme.navyElevated)
                TextField("Description", text: $note, axis: .vertical)
                    .listRowBackground(BrandTheme.navyElevated)
                Button("Add expense") {
                    Task { await add() }
                }
                .frame(minHeight: 44)
                .listRowBackground(BrandTheme.navyElevated)
            } header: {
                Text("New expense").brandSectionHeader()
            }
            Section {
                if expenses.isEmpty {
                    Text("No expenses yet.")
                        .font(.footnote)
                        .foregroundStyle(BrandTheme.textSecondary)
                        .listRowBackground(BrandTheme.navyElevated)
                } else {
                    ForEach(expenses) { exp in
                        HStack {
                            VStack(alignment: .leading) {
                                Text(exp.category ?? "Expense")
                                    .font(.subheadline.weight(.semibold))
                                if let d = exp.description, !d.isEmpty {
                                    Text(d).font(.caption).foregroundStyle(BrandTheme.textSecondary)
                                }
                            }
                            Spacer()
                            Text(exp.displayAmount)
                                .font(.subheadline.monospacedDigit())
                                .foregroundStyle(BrandTheme.goldBright)
                        }
                        .listRowBackground(BrandTheme.navyElevated)
                        // DES.7 — swipe delete plus long-press context menu alternative.
                        .swipeActions {
                            Button(role: .destructive) {
                                Task { await delete(exp) }
                            } label: {
                                Label("Delete", systemImage: "trash")
                            }
                        }
                        .contextMenu {
                            Button(role: .destructive) {
                                Task { await delete(exp) }
                            } label: {
                                Label("Delete expense", systemImage: "trash")
                            }
                        }
                    }
                }
            } header: {
                Text("Ledger").brandSectionHeader()
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
        .navigationTitle("Expenses")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .task { await load() }
        .refreshable { await load() }
    }

    @MainActor
    private func load() async {
        guard auth.isAuthenticated else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            expenses = try await APIClient.shared.fetchExpenses()
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    @MainActor
    private func add() async {
        guard let cents = MoneyFormat.cents(fromDollarsText: amountText), cents > 0 else {
            errorMessage = "Enter a valid amount."
            return
        }
        let date = ISO8601DateFormatter().string(from: Date()).prefix(10)
        do {
            _ = try await APIClient.shared.createExpense(
                category: category.trimmingCharacters(in: .whitespacesAndNewlines),
                amountCents: cents,
                description: note,
                expenseDate: String(date)
            )
            amountText = ""
            note = ""
            await load()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    @MainActor
    private func delete(_ exp: ProviderExpense) async {
        do {
            try await APIClient.shared.deleteExpense(id: exp.id)
            await load()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

// MARK: - Tax

struct TaxCenterView: View {
    @EnvironmentObject private var auth: AuthViewModel
    @State private var forms: [TaxForm] = []
    @State private var estimate: TaxEstimate?
    @State private var errorMessage: String?
    @State private var statusMessage: String?
    @State private var statusIsError = false
    @State private var isGenerating = false
    @State private var downloadingYear: Int?
    @State private var documentShareItem: ExportFileShareItem?
    @State private var selectedYear: Int = Calendar.current.component(.year, from: Date())

    private var currentYear: Int {
        Calendar.current.component(.year, from: Date())
    }

    private var yearChoices: [Int] {
        let y = currentYear
        return [y, y - 1, y - 2]
    }

    var body: some View {
        List {
            Section {
                Picker("Tax year", selection: $selectedYear) {
                    ForEach(yearChoices, id: \.self) { y in
                        Text(String(y)).tag(y)
                    }
                }
                .frame(minHeight: 44)
                .listRowBackground(BrandTheme.navyElevated)
                .onChange(of: selectedYear) { _, _ in
                    Task { await load() }
                }
            } header: {
                Text("Year").brandSectionHeader()
            }

            Section {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Estimated tax")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(BrandTheme.textSecondary)
                    Text(estimate?.displayEstimate ?? "—")
                        .font(.title2.weight(.bold).monospacedDigit())
                        .foregroundStyle(BrandTheme.goldBright)
                    if let net = estimate?.displayNetEarnings, estimate?.netEarningsCents != nil {
                        Text("Net earnings \(net)")
                            .font(.caption)
                            .foregroundStyle(BrandTheme.textSecondary)
                    }
                    if let rate = estimate?.displayEffectiveRate {
                        Text("Effective rate \(rate)")
                            .font(.caption)
                            .foregroundStyle(BrandTheme.textSecondary)
                    }
                    Text("Figures are computed server-side in integer cents — never recalculated on device.")
                        .font(.caption2)
                        .foregroundStyle(BrandTheme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .listRowBackground(BrandTheme.navyElevated)
            } header: {
                Text("Estimated tax \(selectedYear)").brandSectionHeader()
            }

            Section {
                Button {
                    Task { await generate() }
                } label: {
                    if isGenerating {
                        ProgressView()
                            .tint(BrandTheme.ctaLabelOnGold)
                            .frame(maxWidth: .infinity, minHeight: 44)
                    } else {
                        Label("Generate 1099-NEC for \(selectedYear)", systemImage: "doc.badge.plus")
                            .frame(maxWidth: .infinity, minHeight: 44)
                    }
                }
                .buttonStyle(.borderedProminent)
                .tint(BrandTheme.accent)
                .foregroundStyle(BrandTheme.ctaLabelOnGold)
                .disabled(isGenerating || downloadingYear != nil)
                .listRowBackground(BrandTheme.navyElevated)
                .accessibilityHint("Creates a 1099-NEC tax form for the selected year on the server")
            } header: {
                Text("Generate").brandSectionHeader()
            } footer: {
                Text("Generation is server-side from your paid compensation. Download returns HTML you can save or print.")
                    .foregroundStyle(BrandTheme.textSecondary)
            }

            Section {
                if forms.isEmpty {
                    Text("No tax forms generated yet.")
                        .font(.footnote)
                        .foregroundStyle(BrandTheme.textSecondary)
                        .listRowBackground(BrandTheme.navyElevated)
                } else {
                    ForEach(forms) { form in
                        VStack(alignment: .leading, spacing: 8) {
                            HStack {
                                Text(form.formType ?? "1099-NEC")
                                    .font(.subheadline.weight(.semibold))
                                    .foregroundStyle(BrandTheme.textPrimary)
                                Spacer()
                                Text(form.taxYear.map(String.init) ?? form.year.map(String.init) ?? "")
                                    .font(.caption.monospacedDigit())
                                    .foregroundStyle(BrandTheme.textSecondary)
                            }
                            HStack {
                                Text(form.displayStatus)
                                    .font(.caption.weight(.semibold))
                                    .foregroundStyle(BrandTheme.bidActive)
                                Spacer()
                                if let cents = form.totalCompensationCents {
                                    Text(MoneyFormat.usd(cents: cents))
                                        .font(.caption.monospacedDigit())
                                        .foregroundStyle(BrandTheme.goldBright)
                                }
                            }
                            if let year = form.taxYear ?? form.year {
                                Button {
                                    Task { await download(year: year) }
                                } label: {
                                    if downloadingYear == year {
                                        ProgressView()
                                            .tint(BrandTheme.accent)
                                            .frame(maxWidth: .infinity, minHeight: 44)
                                    } else {
                                        Label("Download form", systemImage: "arrow.down.doc")
                                            .frame(maxWidth: .infinity, minHeight: 44)
                                    }
                                }
                                .buttonStyle(.bordered)
                                .disabled(isGenerating || downloadingYear != nil)
                                .accessibilityHint("Downloads the HTML 1099-NEC for year \(year)")
                            }
                        }
                        .listRowBackground(BrandTheme.navyElevated)
                    }
                }
            } header: {
                Text("Forms").brandSectionHeader()
            }

            if let statusMessage {
                Section {
                    Text(statusMessage)
                        .font(.footnote)
                        .foregroundStyle(statusIsError ? BrandTheme.destructive : BrandTheme.success)
                        .listRowBackground(BrandTheme.navyElevated)
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
        .navigationTitle("Tax center")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        #if canImport(UIKit)
        .sheet(item: $documentShareItem) { item in
            ActivityShareSheet(items: [item.url])
        }
        #endif
        .task { await load() }
        .refreshable { await load() }
    }

    @MainActor
    private func load() async {
        guard auth.isAuthenticated else { return }
        do {
            forms = try await APIClient.shared.fetchTaxForms()
            estimate = try? await APIClient.shared.fetchTaxEstimate(year: selectedYear)
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    @MainActor
    private func generate() async {
        isGenerating = true
        statusMessage = nil
        statusIsError = false
        defer { isGenerating = false }
        do {
            let form = try await APIClient.shared.generateTaxForm(year: selectedYear)
            statusIsError = false
            statusMessage = "Generated \(form.formType ?? "1099-NEC") for \(form.taxYear ?? selectedYear)."
            await load()
        } catch {
            statusIsError = true
            statusMessage = error.localizedDescription
        }
    }

    @MainActor
    private func download(year: Int) async {
        downloadingYear = year
        statusMessage = nil
        statusIsError = false
        defer { downloadingYear = nil }
        do {
            let data = try await APIClient.shared.downloadTaxForm(year: year)
            let url = FileManager.default.temporaryDirectory
                .appendingPathComponent("1099-NEC-\(year).html")
            try data.write(to: url, options: .atomic)
            documentShareItem = ExportFileShareItem(url: url)
            statusIsError = false
            statusMessage = "Tax form ready — choose Save or Share."
        } catch {
            statusIsError = true
            statusMessage = error.localizedDescription
        }
    }
}
