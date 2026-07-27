import SwiftUI

/// Navigable taxonomy tree for create flows (jobs + listings).
/// Loads `GET /api/v1/categories/tree` and writes the selected category `id` + display name
/// into the provided bindings when the user confirms a row.
struct CategoryPickerView: View {
    @Binding var selectedId: String
    @Binding var selectedName: String

    @Environment(\.dismiss) private var dismiss

    @State private var roots: [CategoryNode] = []
    @State private var isLoading = false
    @State private var errorMessage: String?

    var body: some View {
        Group {
            if isLoading && roots.isEmpty {
                ProgressView("Loading categories…")
                    .tint(BrandTheme.accent)
                    .foregroundStyle(BrandTheme.textSecondary)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .brandScreenBackground()
            } else if let errorMessage, roots.isEmpty {
                BrandEmptyState(
                    title: "Couldn’t load categories",
                    systemImage: "square.grid.2x2",
                    message: errorMessage,
                    actionTitle: "Try again"
                ) {
                    Task { await loadTree() }
                }
            } else if roots.isEmpty {
                BrandEmptyState(
                    title: "No categories",
                    systemImage: "tray",
                    message: "The taxonomy is empty. Pull to refresh or try again later."
                )
            } else {
                List {
                    Section {
                        Text("Browse the category tree and pick the best match. The selected category id is sent to the API.")
                            .font(.subheadline)
                            .foregroundStyle(BrandTheme.textSecondary)
                            .fixedSize(horizontal: false, vertical: true)
                            .listRowBackground(BrandTheme.navyElevated)
                    }

                    if !selectedId.isEmpty {
                        Section {
                            HStack(spacing: 10) {
                                Image(systemName: "checkmark.circle.fill")
                                    .foregroundStyle(BrandTheme.success)
                                    .accessibilityHidden(true)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(selectedName.isEmpty ? selectedId : selectedName)
                                        .font(.body.weight(.semibold))
                                        .foregroundStyle(BrandTheme.textPrimary)
                                        .lineLimit(2)
                                    Text("Currently selected")
                                        .font(.caption)
                                        .foregroundStyle(BrandTheme.textSecondary)
                                }
                                Spacer(minLength: 8)
                                Button("Clear") {
                                    selectedId = ""
                                    selectedName = ""
                                }
                                .font(.subheadline.weight(.medium))
                                .foregroundStyle(BrandTheme.destructive)
                                .frame(minHeight: 44)
                            }
                            .listRowBackground(BrandTheme.navyElevated)
                        } header: {
                            Text("Selection").brandSectionHeader()
                        }
                    }

                    Section {
                        ForEach(activeRoots) { node in
                            CategoryTreeNodeRow(
                                node: node,
                                selectedId: $selectedId,
                                selectedName: $selectedName,
                                onSelect: { dismissIfPossible() }
                            )
                        }
                    } header: {
                        Text("Categories").brandSectionHeader()
                    }
                }
                .brandListBackground()
                .refreshable { await loadTree() }
            }
        }
        .navigationTitle("Category")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbarBackground(BrandTheme.navy, for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
        .tint(BrandTheme.accent)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button("Done") { dismiss() }
                    .disabled(selectedId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    .accessibilityLabel("Done")
                    .accessibilityHint("Confirms the selected category and closes the picker")
            }
        }
        .task { await loadTree() }
    }

    private var activeRoots: [CategoryNode] {
        roots.filter { $0.active != false }
    }

    private func dismissIfPossible() {
        // Nested NavigationLinks keep their own stack; Done on the root picker
        // is the primary exit. Intermediate selects still write bindings immediately.
    }

    @MainActor
    private func loadTree() async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }
        do {
            let tree = try await APIClient.shared.fetchCategoryTree()
            roots = tree
        } catch {
            if roots.isEmpty {
                errorMessage = error.localizedDescription
            }
        }
    }
}

// MARK: - Recursive row

private struct CategoryTreeNodeRow: View {
    let node: CategoryNode
    @Binding var selectedId: String
    @Binding var selectedName: String
    var onSelect: () -> Void

    private var isSelected: Bool {
        selectedId == node.id
    }

    var body: some View {
        if node.hasActiveChildren {
            NavigationLink {
                CategorySubtreeView(
                    node: node,
                    selectedId: $selectedId,
                    selectedName: $selectedName,
                    onSelect: onSelect
                )
            } label: {
                categoryLabel(showsChevronHint: true)
            }
            .frame(minHeight: 44)
            .listRowBackground(BrandTheme.navyElevated)
            .accessibilityHint("Opens subcategories for \(node.displayName)")
        } else {
            Button {
                applySelection()
            } label: {
                categoryLabel(showsChevronHint: false)
            }
            .buttonStyle(.plain)
            .frame(minHeight: 44)
            .listRowBackground(BrandTheme.navyElevated)
            .accessibilityHint("Selects \(node.displayName)")
        }
    }

    @ViewBuilder
    private func categoryLabel(showsChevronHint: Bool) -> some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text(node.displayName)
                    .font(.body.weight(isSelected ? .semibold : .regular))
                    .foregroundStyle(BrandTheme.textPrimary)
                    .multilineTextAlignment(.leading)
                if let slug = node.slug?.trimmingCharacters(in: .whitespacesAndNewlines), !slug.isEmpty {
                    Text(slug)
                        .font(.caption)
                        .foregroundStyle(BrandTheme.textSecondary)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 8)
            if isSelected {
                Image(systemName: "checkmark.circle.fill")
                    .foregroundStyle(BrandTheme.success)
                    .accessibilityLabel("Selected")
            } else if showsChevronHint {
                Text("\(node.activeChildren.count)")
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(BrandTheme.textSecondary)
                    .accessibilityLabel("\(node.activeChildren.count) subcategories")
            }
        }
        .contentShape(Rectangle())
        .frame(minHeight: 44)
    }

    private func applySelection() {
        selectedId = node.id
        selectedName = node.displayName
        onSelect()
    }
}

// MARK: - Subtree screen

private struct CategorySubtreeView: View {
    let node: CategoryNode
    @Binding var selectedId: String
    @Binding var selectedName: String
    var onSelect: () -> Void

    private var isSelected: Bool {
        selectedId == node.id
    }

    var body: some View {
        List {
            Section {
                Button {
                    selectedId = node.id
                    selectedName = node.displayName
                    onSelect()
                } label: {
                    HStack(spacing: 10) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Use “\(node.displayName)”")
                                .font(.body.weight(.semibold))
                                .foregroundStyle(BrandTheme.textPrimary)
                            Text("Select this category")
                                .font(.caption)
                                .foregroundStyle(BrandTheme.textSecondary)
                        }
                        Spacer(minLength: 8)
                        if isSelected {
                            Image(systemName: "checkmark.circle.fill")
                                .foregroundStyle(BrandTheme.success)
                        }
                    }
                    .frame(minHeight: 44)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .listRowBackground(BrandTheme.navyElevated)
                .accessibilityHint("Selects \(node.displayName) without drilling further")
            }

            Section {
                ForEach(node.activeChildren) { child in
                    CategoryTreeNodeRow(
                        node: child,
                        selectedId: $selectedId,
                        selectedName: $selectedName,
                        onSelect: onSelect
                    )
                }
            } header: {
                Text("Subcategories").brandSectionHeader()
            }
        }
        .brandListBackground()
        .navigationTitle(node.displayName)
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbarBackground(BrandTheme.navy, for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
        .tint(BrandTheme.accent)
    }
}

#Preview {
    NavigationStack {
        CategoryPickerView(
            selectedId: .constant(""),
            selectedName: .constant("")
        )
    }
    .preferredColorScheme(.dark)
    .tint(BrandTheme.accent)
}
