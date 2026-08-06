import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

/// Provider invoices list — web `/provider/business/invoices` parity lite.
///
/// Lists completed service contracts and downloads the authenticated HTML invoice
/// via `GET /api/v1/contracts/{id}/invoice/download` (same path as ContractDetailView).
/// Optional PDF URL probe via `fetchContractPDFURL` when available.
struct ProviderInvoicesView: View {
    @EnvironmentObject private var auth: AuthViewModel

    @State private var contracts: [ContractSummary] = []
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var statusMessage: String?
    @State private var statusIsError = false
    @State private var downloadingID: String?
    @State private var documentShareItem: ExportFileShareItem?
    @State private var tempFileURL: URL?

    var body: some View {
        Group {
            if auth.isScaffoldSession {
                BrandEmptyState(
                    title: "Sign in required",
                    systemImage: "doc.richtext",
                    message: "Browse-only mode has no API credentials. Sign in as a provider to view invoices.",
                    actionTitle: "Sign out to log in",
                    action: { auth.signOut() }
                )
            } else if !auth.isAuthenticated {
                BrandEmptyState(
                    title: "Sign in required",
                    systemImage: "lock.circle",
                    message: "Sign in to view and share invoices for completed contracts.",
                    actionTitle: "Sign in",
                    action: { auth.signOut() }
                )
            } else if isLoading && contracts.isEmpty {
                BrandLoadingScreen(kind: .catalog, rows: 5, accessibilityLabel: "Loading invoices…")
            } else if let errorMessage, contracts.isEmpty {
                BrandEmptyState(
                    title: "Couldn’t load invoices",
                    systemImage: "exclamationmark.triangle",
                    message: errorMessage,
                    actionTitle: "Try again"
                ) {
                    Task { await load() }
                }
            } else if contracts.isEmpty {
                BrandEmptyState(
                    title: "No invoices yet",
                    systemImage: "doc.text",
                    message: "Invoices appear here after you complete reverse-auction contracts. Complete jobs from Contracts to generate them."
                )
            } else {
                List {
                    Section {
                        Text("Completed contracts ready for invoice download. Share opens the system sheet so you can Save, Print, or AirDrop the HTML invoice.")
                            .font(.footnote)
                            .foregroundStyle(BrandTheme.textSecondary)
                            .listRowBackground(BrandTheme.navyElevated)
                    }

                    Section {
                        ForEach(contracts) { contract in
                            invoiceRow(contract)
                                .listRowBackground(BrandTheme.navyElevated)
                        }
                    } header: {
                        Text("Completed contracts (\(contracts.count))").brandSectionHeader()
                    } footer: {
                        Text("Uses GET /contracts/{id}/invoice/download (HTML). PDF path is used when the gateway exposes it.")
                            .foregroundStyle(BrandTheme.textSecondary)
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
                }
                .brandListBackground()
            }
        }
        .navigationTitle("Invoices")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .brandNavigationBarChrome()
        .task { await load() }
        .refreshable { await load() }
        .sheet(item: $documentShareItem, onDismiss: cleanupTempFile) { item in
            #if canImport(UIKit)
            ActivityShareSheet(items: [item.url])
            #else
            Text("Share is available on iOS.")
                .padding()
            #endif
        }
        .accessibilityIdentifier("provider.invoices.root")
    }

    @ViewBuilder
    private func invoiceRow(_ contract: ContractSummary) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(contract.displayTitle)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(BrandTheme.textPrimary)
                        .fixedSize(horizontal: false, vertical: true)
                    if let number = contract.contractNumber, !number.isEmpty {
                        Text(number)
                            .font(.caption2.monospaced())
                            .foregroundStyle(BrandTheme.textSecondary)
                    }
                }
                Spacer(minLength: 8)
                Text(contract.displayAmount)
                    .font(.subheadline.weight(.bold).monospacedDigit())
                    .foregroundStyle(BrandTheme.goldBright)
            }

            HStack {
                if let completed = contract.completedAt, !completed.isEmpty {
                    Text(CatalogDateFormat.friendlyDateTime(completed))
                        .font(.caption2.monospacedDigit())
                        .foregroundStyle(BrandTheme.textSecondary)
                } else if let created = contract.createdAt, !created.isEmpty {
                    Text(CatalogDateFormat.friendlyDateTime(created))
                        .font(.caption2.monospacedDigit())
                        .foregroundStyle(BrandTheme.textSecondary)
                }
                Spacer()
                Text(contract.displayStatus)
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(BrandTheme.success)
            }

            HStack(spacing: 10) {
                Button {
                    Task { await downloadInvoice(contract) }
                } label: {
                    if downloadingID == contract.id {
                        ProgressView()
                            .tint(BrandTheme.ctaLabelOnGold)
                            .frame(maxWidth: .infinity, minHeight: 44)
                    } else {
                        Label("Share invoice", systemImage: "square.and.arrow.up")
                            .frame(maxWidth: .infinity, minHeight: 44)
                    }
                }
                .buttonStyle(.borderedProminent)
                .tint(BrandTheme.gold)
                .foregroundStyle(BrandTheme.ctaLabelOnGold)
                .disabled(downloadingID != nil)
                .accessibilityLabel("Share invoice for \(contract.displayTitle)")
                .accessibilityHint("Downloads the invoice and opens the share sheet")

                NavigationLink {
                    ContractDetailView(contractID: contract.id)
                } label: {
                    Label("Open", systemImage: "doc.text.magnifyingglass")
                        .frame(minHeight: 44)
                }
                .accessibilityHint("Opens the full contract detail")
            }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .contain)
    }

    @MainActor
    private func load() async {
        guard auth.isAuthenticated, !auth.isScaffoldSession else { return }
        isLoading = contracts.isEmpty
        errorMessage = nil
        defer { isLoading = false }

        do {
            let response = try await APIClient.shared.fetchContracts(
                page: 1,
                pageSize: 50,
                status: "completed"
            )
            contracts = response.contracts.filter { !$0.id.isEmpty }
        } catch {
            if contracts.isEmpty {
                errorMessage = error.localizedDescription
            }
        }
    }

    @MainActor
    private func downloadInvoice(_ contract: ContractSummary) async {
        downloadingID = contract.id
        statusMessage = nil
        statusIsError = false
        defer { downloadingID = nil }

        do {
            // Prefer invoice HTML (matches web print/download). Fall back to document path.
            let data: Data
            let filename: String
            do {
                data = try await APIClient.shared.downloadContractInvoice(id: contract.id)
                filename = "invoice-\(String(contract.id.prefix(8))).html"
            } catch {
                let doc = try await APIClient.shared.downloadContractDocument(id: contract.id)
                data = doc.data
                filename = doc.filename
            }

            let url = try writeTempFile(data: data, filename: filename)
            tempFileURL = url
            documentShareItem = ExportFileShareItem(url: url)
            statusIsError = false
            statusMessage = "Invoice ready — choose Save, Print, or Share."
            BrandHaptics.success()
        } catch {
            statusIsError = true
            statusMessage = error.localizedDescription
            BrandHaptics.error()
        }
    }

    private func writeTempFile(data: Data, filename: String) throws -> URL {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(filename)
        try data.write(to: url, options: .atomic)
        return url
    }

    private func cleanupTempFile() {
        if let tempFileURL {
            try? FileManager.default.removeItem(at: tempFileURL)
        }
        tempFileURL = nil
        documentShareItem = nil
    }
}

#Preview {
    NavigationStack {
        ProviderInvoicesView()
            .environmentObject(AuthViewModel())
    }
    .preferredColorScheme(.dark)
    .tint(BrandTheme.accent)
}
