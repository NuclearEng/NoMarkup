import SwiftUI

/// Public reviews for a user — `GET /api/v1/users/{id}/reviews`.
/// FR-6.5 respond (reviewee only, ≤500 chars) + FR-6.8 flag (auth, not own review).
/// PRD §11: share review text + URL via ShareLink (referral when available).
struct UserReviewsView: View {
    let userId: String
    var displayName: String?

    @EnvironmentObject private var auth: AuthViewModel

    @State private var reviews: [ReviewRow] = []
    @State private var averageRating: Double?
    @State private var totalReviews: Int?
    @State private var pagination: PaginationMeta?
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var currentUserID: String?
    @State private var referralCode: String?
    @State private var referralShareURL: String?

    @State private var respondTarget: ReviewRow?
    @State private var flagTarget: ReviewRow?
    @State private var actionBanner: String?
    @State private var actionBannerIsError = false

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
        .task {
            resolveCurrentUser()
            await load()
        }
        .refreshable {
            resolveCurrentUser()
            await load()
        }
        .sheet(item: $respondTarget) { review in
            RespondToReviewSheet(review: review) { message in
                actionBannerIsError = false
                actionBanner = message
                Task { await load() }
            }
        }
        .sheet(item: $flagTarget) { review in
            FlagReviewSheet(review: review) { message in
                actionBannerIsError = false
                actionBanner = message
                Task { await load() }
            }
        }
    }

    private var listContent: some View {
        List {
            if let actionBanner {
                Section {
                    Text(actionBanner)
                        .font(.footnote)
                        .foregroundStyle(actionBannerIsError ? BrandTheme.destructive : BrandTheme.success)
                        .fixedSize(horizontal: false, vertical: true)
                        .listRowBackground(BrandTheme.navyElevated)
                }
            }

            Section {
                VStack(alignment: .leading, spacing: 10) {
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
                            Text(String(localized: "\(total) reviews"))
                                .font(.subheadline)
                                .foregroundStyle(BrandTheme.textSecondary)
                                .monospacedDigit()
                        }
                    }

                    if let avgShare = averageSharePayload {
                        shareLink(for: avgShare, label: "Share rating")
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
        VStack(alignment: .leading, spacing: 8) {
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

            if review.isFlagged == true {
                Label("Flagged for review", systemImage: "exclamationmark.triangle.fill")
                    .font(.caption.weight(.medium))
                    .foregroundStyle(BrandTheme.warning)
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

            if review.hasResponse, let response = review.response {
                VStack(alignment: .leading, spacing: 4) {
                    Label(response.displayResponder, systemImage: "bubble.left")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(BrandTheme.textSecondary)
                    Text(response.displayComment)
                        .font(.subheadline)
                        .foregroundStyle(BrandTheme.textPrimary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(BrandTheme.navy.opacity(0.55), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            }

            actionButtons(for: review)

            shareLink(for: reviewSharePayload(review), label: "Share review")
        }
        .padding(.vertical, 4)
        .frame(minHeight: 44, alignment: .topLeading)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(review.displayReviewer), \(review.displayRating). \(review.displayComment)")
    }

    @ViewBuilder
    private func actionButtons(for review: ReviewRow) -> some View {
        let canRespond = canRespondTo(review)
        let canFlag = canFlag(review)
        if canRespond || canFlag {
            HStack(spacing: 12) {
                if canRespond {
                    Button {
                        respondTarget = review
                    } label: {
                        Label("Respond", systemImage: "bubble.left")
                            .frame(minHeight: 44)
                    }
                    .buttonStyle(.bordered)
                    .tint(BrandTheme.accent)
                    .accessibilityHint("Post a public response to this review, maximum 500 characters")
                }
                if canFlag {
                    Button {
                        flagTarget = review
                    } label: {
                        Label("Report", systemImage: "flag")
                            .frame(minHeight: 44)
                    }
                    .buttonStyle(.bordered)
                    .tint(BrandTheme.destructive)
                    .accessibilityHint("Flag this review for fraud or abuse moderation")
                }
                Spacer(minLength: 0)
            }
        }
    }

    private var averageSharePayload: ShareCardText.SharePayload? {
        guard let averageRating, averageRating > 0 else { return nil }
        let rounded = Int(averageRating.rounded())
        return ShareCardText.review(
            rating: max(1, min(5, rounded)),
            revieweeName: displayName,
            comment: nil,
            referralCode: referralCode,
            shareURLString: referralShareURL
        )
    }

    private func reviewSharePayload(_ review: ReviewRow) -> ShareCardText.SharePayload {
        ShareCardText.review(
            rating: review.rating,
            revieweeName: displayName,
            comment: review.comment,
            referralCode: referralCode,
            shareURLString: referralShareURL
        )
    }

    private func shareLink(for payload: ShareCardText.SharePayload, label: String) -> some View {
        ShareLink(
            item: payload.url,
            subject: Text(payload.subject),
            message: Text(payload.message)
        ) {
            Label(label, systemImage: "square.and.arrow.up")
                .font(.subheadline.weight(.semibold))
                .frame(maxWidth: .infinity, alignment: .leading)
                .frame(minHeight: 44)
        }
        .tint(BrandTheme.accent)
        .accessibilityHint("Opens the system share sheet with review text and a NoMarkup link")
    }

    /// Reviewee only, single public response (server enforces party + once).
    private func canRespondTo(_ review: ReviewRow) -> Bool {
        guard auth.isAuthenticated, !auth.isScaffoldSession else { return false }
        guard review.hasResponse == false else { return false }
        guard let uid = currentUserID?.trimmingCharacters(in: .whitespacesAndNewlines), !uid.isEmpty else {
            return false
        }
        guard let reviewee = review.revieweeId?.trimmingCharacters(in: .whitespacesAndNewlines),
              !reviewee.isEmpty
        else {
            return false
        }
        return uid.caseInsensitiveCompare(reviewee) == .orderedSame
    }

    /// Any signed-in user except the original reviewer; already-flagged reviews hide the control.
    private func canFlag(_ review: ReviewRow) -> Bool {
        guard auth.isAuthenticated, !auth.isScaffoldSession else { return false }
        if review.isFlagged == true { return false }
        guard let uid = currentUserID?.trimmingCharacters(in: .whitespacesAndNewlines), !uid.isEmpty else {
            return false
        }
        if let reviewer = review.reviewerId?.trimmingCharacters(in: .whitespacesAndNewlines),
           !reviewer.isEmpty,
           uid.caseInsensitiveCompare(reviewer) == .orderedSame
        {
            return false
        }
        return true
    }

    @MainActor
    private func resolveCurrentUser() {
        guard auth.isAuthenticated, !auth.isScaffoldSession else {
            currentUserID = nil
            return
        }
        Task { @MainActor in
            currentUserID = await APIClient.shared.currentUserID()
        }
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

        if auth.isAuthenticated, !auth.isScaffoldSession {
            if let referral = try? await APIClient.shared.fetchReferralCode() {
                let code = referral.code?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
                referralCode = code.isEmpty ? nil : code
                let url = referral.shareUrl?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
                referralShareURL = url.isEmpty ? nil : url
            }
        }

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

// MARK: - Respond sheet (FR-6.5)

private struct RespondToReviewSheet: View {
    let review: ReviewRow
    var onSuccess: (String) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var comment = ""
    @State private var errorMessage: String?
    @State private var isSubmitting = false

    private var trimmedCount: Int {
        comment.trimmingCharacters(in: .whitespacesAndNewlines).count
    }

    private var canSubmit: Bool {
        trimmedCount >= 10 && trimmedCount <= 500 && !isSubmitting
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text(review.displayComment)
                        .font(.subheadline)
                        .foregroundStyle(BrandTheme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                        .listRowBackground(BrandTheme.navyElevated)
                } header: {
                    Text("Original review").brandSectionHeader()
                }

                Section {
                    TextField("Your public response", text: $comment, axis: .vertical)
                        .lineLimit(4 ... 12)
                        .listRowBackground(BrandTheme.navyElevated)
                    Text("\(trimmedCount) / 500 · minimum 10")
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(countColor)
                        .listRowBackground(BrandTheme.navyElevated)
                } header: {
                    Text("Response").brandSectionHeader()
                } footer: {
                    Text("One public response per review. Content is filtered server-side; keep it professional.")
                        .foregroundStyle(BrandTheme.textSecondary)
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
            .navigationTitle("Respond")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbarBackground(BrandTheme.navy, for: .navigationBar)
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
            .interactiveDismissDisabled(isSubmitting)
        }
        .tint(BrandTheme.accent)
    }

    private var countColor: Color {
        if trimmedCount > 500 { return BrandTheme.destructive }
        if trimmedCount >= 10 { return BrandTheme.success }
        return BrandTheme.warning
    }

    @MainActor
    private func submit() async {
        errorMessage = nil
        let trimmed = comment.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.count >= 10, trimmed.count <= 500 else {
            errorMessage = "Response must be 10–500 characters."
            return
        }
        isSubmitting = true
        defer { isSubmitting = false }
        do {
            try await APIClient.shared.respondToReview(id: review.id, comment: trimmed)
            onSuccess("Response posted.")
            dismiss()
        } catch let error as APIClientError where error.isUnauthorized {
            errorMessage = "Sign in required. Your session is missing or expired."
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

// MARK: - Flag sheet (FR-6.8)

private enum ReviewFlagReasonOption: String, CaseIterable, Identifiable {
    case inappropriate
    case fake
    case harassment
    case spam
    case irrelevant

    var id: String { rawValue }

    var label: String {
        switch self {
        case .inappropriate: return "Inappropriate"
        case .fake: return "Fake"
        case .harassment: return "Harassment"
        case .spam: return "Spam"
        case .irrelevant: return "Irrelevant"
        }
    }
}

private struct FlagReviewSheet: View {
    let review: ReviewRow
    var onSuccess: (String) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var reason: ReviewFlagReasonOption = .inappropriate
    @State private var details = ""
    @State private var errorMessage: String?
    @State private var isSubmitting = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text(review.displayComment)
                        .font(.subheadline)
                        .foregroundStyle(BrandTheme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                        .listRowBackground(BrandTheme.navyElevated)
                } header: {
                    Text("Review").brandSectionHeader()
                }

                Section {
                    Picker("Reason", selection: $reason) {
                        ForEach(ReviewFlagReasonOption.allCases) { option in
                            Text(option.label).tag(option)
                        }
                    }
                    .listRowBackground(BrandTheme.navyElevated)
                    .frame(minHeight: 44)

                    TextField("Details (optional)", text: $details, axis: .vertical)
                        .lineLimit(2 ... 6)
                        .listRowBackground(BrandTheme.navyElevated)
                } header: {
                    Text("Report").brandSectionHeader()
                } footer: {
                    Text("Flags enter the admin moderation queue. False reports may affect your trust standing.")
                        .foregroundStyle(BrandTheme.textSecondary)
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
            .navigationTitle("Report review")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbarBackground(BrandTheme.navy, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }
                        .disabled(isSubmitting)
                        .frame(minHeight: 44)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Flag") {
                        Task { await submit() }
                    }
                    .disabled(isSubmitting)
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
            .interactiveDismissDisabled(isSubmitting)
        }
        .tint(BrandTheme.accent)
    }

    @MainActor
    private func submit() async {
        errorMessage = nil
        isSubmitting = true
        defer { isSubmitting = false }
        do {
            try await APIClient.shared.flagReview(
                id: review.id,
                reason: reason.rawValue,
                details: details.trimmingCharacters(in: .whitespacesAndNewlines)
            )
            onSuccess("Review flagged for moderation.")
            dismiss()
        } catch let error as APIClientError where error.isUnauthorized {
            errorMessage = "Sign in required. Your session is missing or expired."
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

#Preview {
    NavigationStack {
        UserReviewsView(
            userId: "00000000-0000-0000-0000-000000000001",
            displayName: "Sample Provider"
        )
        .environmentObject(AuthViewModel())
    }
    .preferredColorScheme(.dark)
    .tint(BrandTheme.accent)
}
