import SwiftUI

/// Buyer wishlist / price alerts — `GET|POST|DELETE /api/v1/me/wishlist`.
/// Keyword + max price; when a local goods listing matches, you get notified.
struct WishlistView: View {
    @EnvironmentObject private var auth: AuthViewModel

    @State private var items: [WishlistItem] = []
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var statusMessage: String?
    @State private var statusIsError = false
    @State private var deletingID: String?

    @State private var newKeyword = ""
    @State private var maxPriceText = ""
    @State private var isCreating = false

    private var parsedMaxCents: Int64? {
        MoneyFormat.cents(fromDollarsText: maxPriceText)
    }

    private var canCreate: Bool {
        !newKeyword.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && parsedMaxCents != nil
            && !isCreating
    }

    var body: some View {
        Group {
            if !auth.isAuthenticated {
                BrandEmptyState(
                    title: "Sign in required",
                    systemImage: "person.crop.circle.badge.exclamationmark",
                    message: "Sign in to save wishlist keywords and get price alerts when matching local goods go live.",
                    actionTitle: "Sign in"
                ) {
                    auth.signOut()
                }
            } else if auth.isScaffoldSession {
                BrandEmptyState(
                    title: "Sign in required",
                    systemImage: "hammer",
                    message: "Browse-only mode has no API credentials. Sign in against a live gateway to manage your wishlist."
                )
            } else if isLoading && items.isEmpty {
                ProgressView("Loading wishlist…")
                    .tint(BrandTheme.accent)
                    .foregroundStyle(BrandTheme.textSecondary)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .brandScreenBackground()
            } else if let errorMessage, items.isEmpty {
                BrandEmptyState(
                    title: "Couldn’t load wishlist",
                    systemImage: "exclamationmark.triangle",
                    message: errorMessage,
                    actionTitle: "Try again"
                ) {
                    Task { await load() }
                }
            } else {
                listContent
            }
        }
        .navigationTitle("Wishlist")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbarBackground(BrandTheme.navy, for: .navigationBar)
        .task { await load() }
        .refreshable { await load() }
    }

    private var listContent: some View {
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
                TextField("Keyword", text: $newKeyword, prompt: Text("e.g. 4 wheeler, dining table"))
                    .textContentType(.none)
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.never)
                    .frame(minHeight: 44)
                    .accessibilityLabel("Wishlist keyword")

                DollarAmountField(
                    text: $maxPriceText,
                    placeholder: "0.00",
                    accessibilityLabelText: "Maximum price in dollars",
                    showParsedPreview: true
                )
                .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))

                Button {
                    Task { await create() }
                } label: {
                    if isCreating {
                        ProgressView()
                            .tint(BrandTheme.navy)
                            .frame(maxWidth: .infinity, minHeight: 44)
                    } else {
                        Text("Add to wishlist")
                            .frame(maxWidth: .infinity, minHeight: 44)
                    }
                }
                .buttonStyle(.borderedProminent)
                .tint(BrandTheme.accent)
                .disabled(!canCreate)
            } header: {
                Text("New alert").brandSectionHeader()
            } footer: {
                Text("We’ll notify you when a local goods listing matches your keyword and is at or below your max price. Forward auctions only — local pickup.")
                    .foregroundStyle(BrandTheme.textSecondary)
            }
            .listRowBackground(BrandTheme.navyElevated)

            Section {
                if items.isEmpty {
                    Text("No wishlist items yet.")
                        .font(.subheadline)
                        .foregroundStyle(BrandTheme.textSecondary)
                        .frame(minHeight: 44)
                        .listRowBackground(BrandTheme.navyElevated)
                } else {
                    ForEach(items) { item in
                        wishlistRow(item)
                            .listRowBackground(BrandTheme.navyElevated)
                            // DES.7 — swipe/Edit delete plus long-press context menu
                            // (VoiceOver / pointer / full-keyboard).
                            .contextMenu {
                                Button(role: .destructive) {
                                    Task { await delete(item) }
                                } label: {
                                    Label("Remove alert", systemImage: "trash")
                                }
                                .disabled(deletingID == item.id)
                            }
                    }
                    .onDelete { indexSet in
                        Task { await delete(at: indexSet) }
                    }
                }
            } header: {
                Text("Yours").brandSectionHeader()
            } footer: {
                Text("Price alerts fire when matching marketplace goods go active. Swipe left, long-press, or tap Edit to remove an alert.")
                    .foregroundStyle(BrandTheme.textSecondary)
            }
        }
        .brandListBackground()
        // DES.7 — non-gesture delete affordance: Edit mode exposes per-row
        // delete buttons for the `.onDelete` rows above.
        .toolbar {
            if !items.isEmpty {
                ToolbarItem(placement: .topBarTrailing) {
                    EditButton()
                        .frame(minHeight: 44)
                }
            }
        }
    }

    @ViewBuilder
    private func wishlistRow(_ item: WishlistItem) -> some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text(item.displayKeyword)
                    .font(.headline)
                    .foregroundStyle(BrandTheme.textPrimary)
                    .fixedSize(horizontal: false, vertical: true)
                Text("Up to \(MoneyFormat.usd(cents: (item.maxPriceCents ?? 0)))")
                    .font(.subheadline.weight(.semibold).monospacedDigit())
                    .foregroundStyle(BrandTheme.goldBright)
                if let category = item.categoryName?.trimmingCharacters(in: .whitespacesAndNewlines),
                   !category.isEmpty {
                    Text(category)
                        .font(.caption)
                        .foregroundStyle(BrandTheme.textSecondary)
                }
            }
            Spacer(minLength: 8)
            if deletingID == item.id {
                ProgressView()
                    .tint(BrandTheme.accent)
            }
        }
        .padding(.vertical, 4)
        .frame(minHeight: 44)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(
            "\(item.displayKeyword), max \(MoneyFormat.usd(cents: (item.maxPriceCents ?? 0)))"
        )
    }

    @MainActor
    private func load() async {
        guard auth.isAuthenticated, !auth.isScaffoldSession else { return }
        isLoading = items.isEmpty
        errorMessage = nil
        defer { isLoading = false }

        do {
            items = try await APIClient.shared.fetchWishlist().wishlistItems
        } catch {
            if items.isEmpty {
                errorMessage = error.localizedDescription
            }
        }
    }

    @MainActor
    private func create() async {
        statusMessage = nil
        statusIsError = false
        guard let cents = parsedMaxCents else {
            statusIsError = true
            statusMessage = "Enter a max price in dollars (example 125.00)."
            return
        }

        isCreating = true
        defer { isCreating = false }

        do {
            let created = try await APIClient.shared.createWishlistItem(
                keyword: newKeyword.trimmingCharacters(in: .whitespacesAndNewlines),
                maxPriceCents: cents
            )
            items.insert(created, at: 0)
            newKeyword = ""
            maxPriceText = ""
            statusIsError = false
            statusMessage = "Added “\(created.keyword)” — we’ll alert you on matching goods."
        } catch let error as APIClientError where error.isUnauthorized {
            statusIsError = true
            statusMessage = "Sign in required. Your session is missing or expired — please sign in again."
        } catch {
            statusIsError = true
            statusMessage = error.localizedDescription
        }
    }

    @MainActor
    private func delete(at offsets: IndexSet) async {
        for index in offsets {
            guard items.indices.contains(index) else { continue }
            await delete(items[index])
        }
    }

    @MainActor
    private func delete(_ item: WishlistItem) async {
        statusMessage = nil
        statusIsError = false
        deletingID = item.id
        defer { deletingID = nil }

        do {
            try await APIClient.shared.deleteWishlistItem(id: item.id)
            items.removeAll { $0.id == item.id }
        } catch {
            statusIsError = true
            statusMessage = error.localizedDescription
        }
    }
}

#Preview {
    NavigationStack {
        WishlistView()
            .environmentObject(AuthViewModel())
    }
    .preferredColorScheme(.dark)
    .tint(BrandTheme.accent)
}
