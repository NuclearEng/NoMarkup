import SwiftUI

/// Public reviews for a user — `GET /api/v1/users/{id}/reviews`.
struct UserReviewsView: View {
    let userId: String
    var displayName: String?

    @State private var reviews: [ReviewRow] = []
    @State private var averageRating: Double?
    @State private var totalReviews: Int?
    @State private var pagination: PaginationMeta?
    @State private var isLoading = false
    @State private var errorMessage: String?

    init(userId: String, displayName: String? = nil) {
        self.userId = userId
        self.displayName = displayName
    }

    private var navigationTitleText: String {
        let name = displayName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return name.isEmpty ? "Reviews" : "Reviews · \(name)"
    }

    var body: some View {
        Group {
            if isLoading && reviews.isEmpty {
                ProgressView("Loading reviews…")
                    .tint(BrandTheme.accent)
                    .foregroundStyle(BrandTheme.textSecondary)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .brandScreenBackground()
            } else if let errorMessage, reviews.isEmpty {
                BrandEmptyState(
                    title: "Couldn’t load reviews",
                    systemImage: "exclamationmark.triangle",
                    message: errorMessage,
                    actionTitle: "Try again"
                ) {
                    Task { await load() }
                }
            } else if reviews.isEmpty {
                BrandEmptyState(
                    title: "No reviews yet",
                    systemImage: "star.bubble",
                    message: "Reviews appear after completed jobs or marketplace transactions."
                )
            } else {
                listContent
            }
        }
        .navigationTitle(navigationTitleText)
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbarBackground(BrandTheme.navy, for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
        .task { await load() }
        .refreshable { await load() }
    }

    private var listContent: some View {
        List {
            Section {
                HStack(spacing: 12) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Average rating")
                            .font(.caption)
                            .foregroundStyle(BrandTheme.textSecondary)
                        Text(displayAverage)
                            .font(.title2.weight(.semibold).monospacedDigit())
                            .foregroundStyle(BrandTheme.goldBright)
                    }
                    Spacer(minLength: 8)
                    if let total = totalReviews ?? pagination?.resolvedTotal {
                        Text("\(total) review\(total == 1 ? "" : "s")")
                            .font(.subheadline)
                            .foregroundStyle(BrandTheme.textSecondary)
                            .monospacedDigit()
                    }
                }
                .frame(minHeight: 44)
                .listRowBackground(BrandTheme.navyElevated)
            }

            Section {
                ForEach(reviews) { review in
                    reviewRow(review)
                        .listRowBackground(BrandTheme.navyElevated)
                }
            } header: {
                Text("\(reviews.count) shown").brandSectionHeader()
            }
        }
        .brandListBackground()
    }

    private var displayAverage: String {
        if let averageRating {
            return averageRating.formatted(.number.precision(.fractionLength(1)))
        }
        return "—"
    }

    @ViewBuilder
    private func reviewRow(_ review: ReviewRow) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline) {
                Text(review.displayReviewer)
                    .font(.body.weight(.medium))
                    .foregroundStyle(BrandTheme.textPrimary)
                    .lineLimit(1)
                Spacer(minLength: 8)
                Text(review.displayRating)
                    .font(.subheadline.weight(.semibold).monospacedDigit())
                    .foregroundStyle(BrandTheme.goldBright)
            }

            Text(review.displayComment)
                .font(.subheadline)
                .foregroundStyle(BrandTheme.textPrimary)
                .fixedSize(horizontal: false, vertical: true)

            if let at = review.createdAtLabel {
                Text(at)
                    .font(.caption2)
                    .foregroundStyle(BrandTheme.textSecondary)
            }
        }
        .padding(.vertical, 4)
        .frame(minHeight: 44, alignment: .topLeading)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(review.displayReviewer), \(review.displayRating). \(review.displayComment)")
    }

    @MainActor
    private func load() async {
        let trimmed = userId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            errorMessage = "User id is missing."
            return
        }

        isLoading = reviews.isEmpty
        errorMessage = nil
        defer { isLoading = false }

        do {
            let response = try await APIClient.shared.fetchUserReviews(userId: trimmed, page: 1, pageSize: 40)
            reviews = response.reviews
            averageRating = response.averageRating
            totalReviews = response.totalReviews
            pagination = response.pagination
        } catch {
            if reviews.isEmpty {
                errorMessage = error.localizedDescription
            }
        }
    }
}

#Preview {
    NavigationStack {
        UserReviewsView(
            userId: "00000000-0000-0000-0000-000000000001",
            displayName: "Sample Provider"
        )
    }
    .preferredColorScheme(.dark)
    .tint(BrandTheme.accent)
}
