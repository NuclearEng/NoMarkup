import SwiftUI

/// Signed-in contracts workspace — service reverse-auction awards.
///
/// `GET /api/v1/contracts` → NavigationLink into `ContractDetailView`.
struct ContractsView: View {
    @EnvironmentObject private var auth: AuthViewModel

    @State private var contracts: [ContractSummary] = []
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var currentUserID: String?

    var body: some View {
        Group {
            if !auth.isAuthenticated {
                BrandEmptyState(
                    title: "Sign in required",
                    systemImage: "person.crop.circle.badge.exclamationmark",
                    message: "Sign in to view service contracts awarded from reverse-auction jobs.",
                    actionTitle: "Sign in"
                ) {
                    auth.signOut()
                }
            } else if auth.isScaffoldSession {
                BrandEmptyState(
                    title: "Sign in required",
                    systemImage: "hammer",
                    message: "Browse-only mode has no API credentials. Sign in against a live gateway to load contracts."
                )
            } else if isLoading && contracts.isEmpty {
                ProgressView("Loading contracts…")
                    .tint(BrandTheme.accent)
                    .foregroundStyle(BrandTheme.textSecondary)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .brandScreenBackground()
            } else if let errorMessage, contracts.isEmpty {
                BrandEmptyState(
                    title: "Couldn’t load contracts",
                    systemImage: "exclamationmark.triangle",
                    message: errorMessage,
                    actionTitle: "Try again"
                ) {
                    Task { await load() }
                }
            } else if contracts.isEmpty {
                BrandEmptyState(
                    title: "No contracts yet",
                    systemImage: "doc.text",
                    message: "When a job bid is awarded, the service contract appears here. Accept, start work, complete milestones, and release escrow — no platform markup on the bid."
                )
            } else {
                List {
                    Section {
                        ForEach(contracts) { contract in
                            NavigationLink {
                                ContractDetailView(contractID: contract.id)
                            } label: {
                                contractRow(contract)
                            }
                            .listRowBackground(BrandTheme.navyElevated)
                            .frame(minHeight: 44)
                        }
                    } header: {
                        Text("\(contracts.count) contract\(contracts.count == 1 ? "" : "s")")
                            .brandSectionHeader()
                    } footer: {
                        Text("Contracts are the service side of NoMarkup: reverse-auction awards, milestones, and mutual completion. Local goods orders live under Orders.")
                            .foregroundStyle(BrandTheme.textSecondary)
                    }
                }
                .brandListBackground()
            }
        }
        .navigationTitle("Contracts")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbarBackground(BrandTheme.navy, for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
        .task { await load() }
        .refreshable { await load() }
    }

    @ViewBuilder
    private func contractRow(_ contract: ContractSummary) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Text(contract.displayTitle)
                    .font(.headline)
                    .foregroundStyle(BrandTheme.textPrimary)
                    .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 8)
                statusChip(contract)
            }

            HStack {
                Text(contract.displayAmount)
                    .font(.subheadline.weight(.semibold).monospacedDigit())
                    .foregroundStyle(BrandTheme.goldBright)
                Spacer()
                if let created = contract.createdAt, !created.isEmpty {
                    Text(CatalogDateFormat.friendlyDateTime(created))
                        .font(.caption2)
                        .foregroundStyle(BrandTheme.textSecondary)
                }
            }

            if let caption = roleCaption(for: contract) {
                Text(caption)
                    .font(.caption2)
                    .foregroundStyle(BrandTheme.bidActive.opacity(0.9))
            }

            if let number = contract.contractNumber, !number.isEmpty {
                Text(number)
                    .font(.caption2.monospaced())
                    .foregroundStyle(BrandTheme.textSecondary)
            }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(contract.displayTitle), \(contract.displayStatus), \(contract.displayAmount)")
    }

    @ViewBuilder
    private func statusChip(_ contract: ContractSummary) -> some View {
        let style = contract.statusStyle
        Text(contract.displayStatus)
            .font(.caption2.weight(.semibold))
            .foregroundStyle(chipForeground(style))
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(chipBackground(style), in: Capsule())
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

    private func chipBackground(_ style: StatusChipStyle) -> Color {
        chipForeground(style).opacity(0.16)
    }

    private func roleCaption(for contract: ContractSummary) -> String? {
        guard let me = currentUserID, !me.isEmpty else { return nil }
        if contract.isCustomer(userId: me), contract.isProvider(userId: me) {
            return "You are customer and provider"
        }
        if contract.isCustomer(userId: me) { return "You are the customer" }
        if contract.isProvider(userId: me) { return "You are the provider" }
        return nil
    }

    @MainActor
    private func load() async {
        guard auth.isAuthenticated, !auth.isScaffoldSession else { return }
        isLoading = contracts.isEmpty
        errorMessage = nil
        defer { isLoading = false }

        if currentUserID == nil {
            currentUserID = await APIClient.shared.currentUserID()
        }

        do {
            let response = try await APIClient.shared.fetchContracts(page: 1, pageSize: 50)
            contracts = response.contracts.filter { !$0.id.isEmpty }
        } catch {
            if contracts.isEmpty {
                errorMessage = error.localizedDescription
            }
        }
    }
}

#Preview {
    NavigationStack {
        ContractsView()
            .environmentObject(AuthViewModel())
    }
    .preferredColorScheme(.dark)
    .tint(BrandTheme.accent)
}
