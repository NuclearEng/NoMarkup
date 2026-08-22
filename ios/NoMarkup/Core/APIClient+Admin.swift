import Foundation

// MARK: - Admin console APIs (parity with web `/admin/*`)
// Auth: Bearer + admin role. Non-admins receive 403.

extension APIClient {
    /// GET `/api/v1/admin/flags` — full flag rows with rollout %.
    func fetchAdminFlags() async throws -> [AdminFeatureFlag] {
        let response: AdminFlagsResponse = try await getJSON(
            pathComponents: ["api", "v1", "admin", "flags"],
            authorized: true
        )
        return response.flags
    }

    /// GET `/api/v1/admin/disputes`
    func fetchAdminDisputes(page: Int = 1, pageSize: Int = 40) async throws -> AdminDisputesResponse {
        try await getJSON(
            pathComponents: ["api", "v1", "admin", "disputes"],
            query: [
                URLQueryItem(name: "page", value: String(max(1, page))),
                URLQueryItem(name: "page_size", value: String(min(max(1, pageSize), 100))),
            ],
            authorized: true
        )
    }

    /// GET `/api/v1/admin/users`
    func fetchAdminUsers(page: Int = 1, pageSize: Int = 40, q: String? = nil) async throws -> AdminUsersResponse {
        var query = [
            URLQueryItem(name: "page", value: String(max(1, page))),
            URLQueryItem(name: "page_size", value: String(min(max(1, pageSize), 100))),
        ]
        if let q, !q.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            query.append(URLQueryItem(name: "q", value: q.trimmingCharacters(in: .whitespacesAndNewlines)))
        }
        return try await getJSON(
            pathComponents: ["api", "v1", "admin", "users"],
            query: query,
            authorized: true
        )
    }

    /// GET `/api/v1/admin/goods-reports` (listing reports queue)
    func fetchAdminGoodsReports(page: Int = 1, pageSize: Int = 40) async throws -> AdminReportsResponse {
        try await getJSON(
            pathComponents: ["api", "v1", "admin", "goods-reports"],
            query: [
                URLQueryItem(name: "page", value: String(max(1, page))),
                URLQueryItem(name: "page_size", value: String(min(max(1, pageSize), 100))),
            ],
            authorized: true
        )
    }

    /// GET `/api/v1/admin/job-reports` (job UGC reports queue)
    func fetchAdminJobReports(page: Int = 1, pageSize: Int = 40) async throws -> AdminReportsResponse {
        try await getJSON(
            pathComponents: ["api", "v1", "admin", "job-reports"],
            query: [
                URLQueryItem(name: "page", value: String(max(1, page))),
                URLQueryItem(name: "page_size", value: String(min(max(1, pageSize), 100))),
            ],
            authorized: true
        )
    }

    /// GET `/api/v1/admin/user-reports`
    func fetchAdminUserReports(page: Int = 1, pageSize: Int = 40) async throws -> AdminReportsResponse {
        try await getJSON(
            pathComponents: ["api", "v1", "admin", "user-reports"],
            query: [
                URLQueryItem(name: "page", value: String(max(1, page))),
                URLQueryItem(name: "page_size", value: String(min(max(1, pageSize), 100))),
            ],
            authorized: true
        )
    }

    /// GET `/api/v1/admin/fraud/alerts`
    func fetchAdminFraudAlerts(page: Int = 1, pageSize: Int = 40) async throws -> AdminFraudResponse {
        try await getJSON(
            pathComponents: ["api", "v1", "admin", "fraud", "alerts"],
            query: [
                URLQueryItem(name: "page", value: String(max(1, page))),
                URLQueryItem(name: "page_size", value: String(min(max(1, pageSize), 100))),
            ],
            authorized: true
        )
    }

    // MARK: Write operations

    /// PUT `/api/v1/admin/flags/{key}` — toggle `enabled` and optionally set sticky `rollout_percent`.
    /// Omit `rolloutPercent` to leave the cohort unchanged. Money/regulated keys reject 1–99.
    @discardableResult
    func updateAdminFlag(
        key: String,
        enabled: Bool,
        rolloutPercent: Int? = nil
    ) async throws -> AdminFeatureFlagUpdateResponse {
        let trimmed = key.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "Flag key is required.")
        }
        if let p = rolloutPercent, p < 0 || p > 100 {
            throw APIClientError.httpStatus(400, detail: "Rollout percent must be between 0 and 100.")
        }
        let body = UpdateAdminFlagBody(enabled: enabled, rolloutPercent: rolloutPercent)
        return try await putJSON(
            pathComponents: ["api", "v1", "admin", "flags", trimmed],
            body: body,
            authorized: .required
        )
    }

    /// POST `/api/v1/admin/fraud/alerts/{id}/review`
    /// Status: `open` | `investigating` | `resolved_fraud` | `resolved_legitimate` | `dismissed`.
    @discardableResult
    func reviewAdminFraudAlert(
        id: String,
        status: String,
        resolutionNotes: String = "",
        restrictUser: Bool = false,
        banUser: Bool = false
    ) async throws -> AdminFraudAlert {
        let trimmed = id.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "Alert id is required.")
        }
        let statusTrimmed = status.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !statusTrimmed.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "Status is required.")
        }
        let body = ReviewAdminFraudAlertBody(
            status: statusTrimmed,
            resolutionNotes: resolutionNotes.trimmingCharacters(in: .whitespacesAndNewlines),
            restrictUser: restrictUser,
            banUser: banUser
        )
        let response: AdminFraudReviewResponse = try await postJSON(
            pathComponents: ["api", "v1", "admin", "fraud", "alerts", trimmed, "review"],
            body: body,
            authorized: .required
        )
        guard let alert = response.alert else {
            throw APIClientError.decoding("Fraud review response missing alert.")
        }
        return alert
    }

    /// POST `/api/v1/admin/disputes/{id}/resolve`
    /// Resolution types: `favor_customer` | `favor_provider` | `split` | `dismissed` (web parity).
    @discardableResult
    func resolveAdminDispute(
        id: String,
        resolutionType: String,
        resolutionNotes: String = "",
        refundAmountCents: Int64? = nil,
        guaranteeOutcome: String? = nil
    ) async throws -> AdminDisputeRow {
        let trimmed = id.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "Dispute id is required.")
        }
        let typeTrimmed = resolutionType.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !typeTrimmed.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "Resolution type is required.")
        }
        let body = ResolveAdminDisputeBody(
            resolutionType: typeTrimmed,
            resolutionNotes: resolutionNotes.trimmingCharacters(in: .whitespacesAndNewlines),
            refundAmountCents: refundAmountCents,
            guaranteeOutcome: guaranteeOutcome
        )
        let response: AdminDisputeResolveResponse = try await postJSON(
            pathComponents: ["api", "v1", "admin", "disputes", trimmed, "resolve"],
            body: body,
            authorized: .required
        )
        guard let dispute = response.dispute else {
            throw APIClientError.decoding("Dispute resolve response missing dispute.")
        }
        return dispute
    }

    /// POST `/api/v1/admin/goods-reports/{id}/resolve`
    /// Actions: `dismiss` | `actioned` | `review`.
    @discardableResult
    func resolveAdminGoodsReport(
        id: String,
        action: String,
        notes: String = ""
    ) async throws -> AdminReportResolveResponse {
        try await resolveAdminReport(
            pathSegment: "goods-reports",
            id: id,
            action: action,
            notes: notes
        )
    }

    /// POST `/api/v1/admin/job-reports/{id}/resolve`
    /// Actions: `dismiss` | `actioned` | `review`.
    @discardableResult
    func resolveAdminJobReport(
        id: String,
        action: String,
        notes: String = ""
    ) async throws -> AdminReportResolveResponse {
        try await resolveAdminReport(
            pathSegment: "job-reports",
            id: id,
            action: action,
            notes: notes
        )
    }

    /// POST `/api/v1/admin/user-reports/{id}/resolve`
    /// Actions: `dismiss` | `actioned` | `review`.
    @discardableResult
    func resolveAdminUserReport(
        id: String,
        action: String,
        notes: String = ""
    ) async throws -> AdminReportResolveResponse {
        try await resolveAdminReport(
            pathSegment: "user-reports",
            id: id,
            action: action,
            notes: notes
        )
    }

    private func resolveAdminReport(
        pathSegment: String,
        id: String,
        action: String,
        notes: String
    ) async throws -> AdminReportResolveResponse {
        let trimmed = id.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "Report id is required.")
        }
        let actionTrimmed = action.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard actionTrimmed == "dismiss" || actionTrimmed == "actioned" || actionTrimmed == "review" else {
            throw APIClientError.httpStatus(400, detail: "Action must be dismiss, actioned, or review.")
        }
        let body = ResolveAdminReportBody(
            action: actionTrimmed,
            notes: notes.trimmingCharacters(in: .whitespacesAndNewlines)
        )
        return try await postJSON(
            pathComponents: ["api", "v1", "admin", pathSegment, trimmed, "resolve"],
            body: body,
            authorized: .required
        )
    }

    /// POST `/api/v1/admin/users/{id}/suspend` — body `{ reason }`.
    @discardableResult
    func suspendAdminUser(id: String, reason: String) async throws -> AdminUserRow {
        try await mutateAdminUser(id: id, pathAction: "suspend", reason: reason)
    }

    /// POST `/api/v1/admin/users/{id}/ban` — body `{ reason }`.
    @discardableResult
    func banAdminUser(id: String, reason: String) async throws -> AdminUserRow {
        try await mutateAdminUser(id: id, pathAction: "ban", reason: reason)
    }

    /// POST `/api/v1/admin/users/{id}/reactivate` — optional body; empty payload is valid.
    @discardableResult
    func reactivateAdminUser(id: String) async throws -> AdminUserRow {
        let trimmed = id.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "User id is required.")
        }
        let response: AdminUserMutationResponse = try await postJSON(
            pathComponents: ["api", "v1", "admin", "users", trimmed, "reactivate"],
            body: EmptyBody(),
            authorized: .required
        )
        guard let user = response.user else {
            throw APIClientError.decoding("Reactivate response missing user.")
        }
        return user
    }

    private func mutateAdminUser(id: String, pathAction: String, reason: String) async throws -> AdminUserRow {
        let trimmed = id.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "User id is required.")
        }
        let reasonTrimmed = reason.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !reasonTrimmed.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "Reason is required.")
        }
        let response: AdminUserMutationResponse = try await postJSON(
            pathComponents: ["api", "v1", "admin", "users", trimmed, pathAction],
            body: AdminUserReasonBody(reason: reasonTrimmed),
            authorized: .required
        )
        guard let user = response.user else {
            throw APIClientError.decoding("User \(pathAction) response missing user.")
        }
        return user
    }

    /// GET `/api/v1/admin/advances` — working capital queue (all providers).
    func fetchAdminAdvances(
        page: Int = 1,
        pageSize: Int = 40,
        status: String? = nil
    ) async throws -> AdvancesResponse {
        var query = [
            URLQueryItem(name: "page", value: String(max(1, page))),
            URLQueryItem(name: "page_size", value: String(min(max(1, pageSize), 100))),
        ]
        if let status, !status.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            query.append(
                URLQueryItem(
                    name: "status",
                    value: status.trimmingCharacters(in: .whitespacesAndNewlines)
                )
            )
        }
        return try await getJSON(
            pathComponents: ["api", "v1", "admin", "advances"],
            query: query,
            authorized: true
        )
    }

    /// POST `/api/v1/admin/advances/{id}/review` — `action`: `approve` | `reject`.
    @discardableResult
    func reviewAdminAdvance(
        id: String,
        action: String,
        reason: String = ""
    ) async throws -> WorkingCapitalAdvance {
        let trimmed = id.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "Advance id is required.")
        }
        let actionTrimmed = action.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard actionTrimmed == "approve" || actionTrimmed == "reject" else {
            throw APIClientError.httpStatus(400, detail: "Action must be approve or reject.")
        }
        let body = ReviewAdminAdvanceBody(
            action: actionTrimmed,
            reason: reason.trimmingCharacters(in: .whitespacesAndNewlines)
        )
        let response: AdvanceEnvelope = try await postJSON(
            pathComponents: ["api", "v1", "admin", "advances", trimmed, "review"],
            body: body,
            authorized: .required
        )
        guard let advance = response.advance else {
            throw APIClientError.decoding("Advance review response missing advance.")
        }
        return advance
    }

    // MARK: - Jobs moderation

    /// GET `/api/v1/admin/jobs?page=&page_size=`
    func fetchAdminJobs(page: Int = 1, pageSize: Int = 40) async throws -> AdminJobsResponse {
        try await getJSON(
            pathComponents: ["api", "v1", "admin", "jobs"],
            query: [
                URLQueryItem(name: "page", value: String(max(1, page))),
                URLQueryItem(name: "page_size", value: String(min(max(1, pageSize), 100))),
            ],
            authorized: true
        )
    }

    /// POST `/api/v1/admin/jobs/{id}/suspend` — body `{ reason }`.
    @discardableResult
    func suspendAdminJob(id: String, reason: String) async throws -> AdminJobRow {
        let trimmed = id.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "Job id is required.")
        }
        let reasonTrimmed = reason.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !reasonTrimmed.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "Reason is required.")
        }
        let response: AdminJobMutationResponse = try await postJSON(
            pathComponents: ["api", "v1", "admin", "jobs", trimmed, "suspend"],
            body: AdminReasonBody(reason: reasonTrimmed),
            authorized: .required
        )
        guard let job = response.job else {
            throw APIClientError.decoding("Job suspend response missing job.")
        }
        return job
    }

    /// POST `/api/v1/admin/jobs/{id}/remove` — body `{ reason }`.
    func removeAdminJob(id: String, reason: String) async throws {
        let trimmed = id.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "Job id is required.")
        }
        let reasonTrimmed = reason.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !reasonTrimmed.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "Reason is required.")
        }
        let _: AdminJobRemoveResponse = try await postJSON(
            pathComponents: ["api", "v1", "admin", "jobs", trimmed, "remove"],
            body: AdminReasonBody(reason: reasonTrimmed),
            authorized: .required
        )
    }

    // MARK: - Listings moderation

    /// GET `/api/v1/admin/listings?page=&page_size=`
    func fetchAdminListings(page: Int = 1, pageSize: Int = 40) async throws -> AdminListingsResponse {
        try await getJSON(
            pathComponents: ["api", "v1", "admin", "listings"],
            query: [
                URLQueryItem(name: "page", value: String(max(1, page))),
                URLQueryItem(name: "page_size", value: String(min(max(1, pageSize), 100))),
            ],
            authorized: true
        )
    }

    /// POST `/api/v1/admin/listings/{id}/suspend` — body `{ reason }`.
    @discardableResult
    func suspendAdminListing(id: String, reason: String) async throws -> AdminListingMutationResponse {
        let trimmed = id.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "Listing id is required.")
        }
        let reasonTrimmed = reason.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !reasonTrimmed.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "Reason is required.")
        }
        return try await postJSON(
            pathComponents: ["api", "v1", "admin", "listings", trimmed, "suspend"],
            body: AdminReasonBody(reason: reasonTrimmed),
            authorized: .required
        )
    }

    /// POST `/api/v1/admin/listings/{id}/reactivate`
    @discardableResult
    func reactivateAdminListing(id: String) async throws -> AdminListingMutationResponse {
        let trimmed = id.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "Listing id is required.")
        }
        return try await postJSON(
            pathComponents: ["api", "v1", "admin", "listings", trimmed, "reactivate"],
            body: EmptyBody(),
            authorized: .required
        )
    }

    /// POST `/api/v1/admin/listings/{id}/cancel` — body `{ reason }`.
    @discardableResult
    func cancelAdminListing(id: String, reason: String) async throws -> AdminListingMutationResponse {
        let trimmed = id.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "Listing id is required.")
        }
        let reasonTrimmed = reason.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !reasonTrimmed.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "Reason is required.")
        }
        return try await postJSON(
            pathComponents: ["api", "v1", "admin", "listings", trimmed, "cancel"],
            body: AdminReasonBody(reason: reasonTrimmed),
            authorized: .required
        )
    }

    // MARK: - Goods disputes

    /// GET `/api/v1/admin/disputes/goods`
    func fetchAdminGoodsDisputes(page: Int = 1, pageSize: Int = 40) async throws -> AdminGoodsDisputesResponse {
        try await getJSON(
            pathComponents: ["api", "v1", "admin", "disputes", "goods"],
            query: [
                URLQueryItem(name: "page", value: String(max(1, page))),
                URLQueryItem(name: "page_size", value: String(min(max(1, pageSize), 100))),
            ],
            authorized: true
        )
    }

    /// POST `/api/v1/admin/disputes/goods/{id}/resolve`
    /// Resolution: `refund_full` | `refund_partial` | `release_to_seller` | `no_action`.
    @discardableResult
    func resolveAdminGoodsDispute(
        id: String,
        resolution: String,
        refundToBuyerCents: Int64? = nil,
        transferToSellerCents: Int64? = nil,
        notes: String = ""
    ) async throws -> AdminGoodsDisputeResolveResponse {
        let trimmed = id.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "Dispute id is required.")
        }
        let resolutionTrimmed = resolution.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let allowed: Set<String> = [
            "refund_full", "refund_partial", "release_to_seller", "no_action",
        ]
        guard allowed.contains(resolutionTrimmed) else {
            throw APIClientError.httpStatus(
                400,
                detail: "Resolution must be refund_full, refund_partial, release_to_seller, or no_action."
            )
        }
        if let refund = refundToBuyerCents, refund < 0 {
            throw APIClientError.httpStatus(400, detail: "Refund amount must not be negative.")
        }
        if let transfer = transferToSellerCents, transfer < 0 {
            throw APIClientError.httpStatus(400, detail: "Transfer amount must not be negative.")
        }
        let body = ResolveAdminGoodsDisputeBody(
            resolution: resolutionTrimmed,
            refundToBuyerCents: refundToBuyerCents,
            transferToSellerCents: transferToSellerCents,
            notes: notes.trimmingCharacters(in: .whitespacesAndNewlines)
        )
        return try await postJSON(
            pathComponents: ["api", "v1", "admin", "disputes", "goods", trimmed, "resolve"],
            body: body,
            authorized: .required
        )
    }

    // MARK: Markets rollout

    /// GET `/api/v1/admin/markets` — full catalog (active + inactive).
    func fetchAdminMarkets() async throws -> MarketsResponse {
        try await getJSON(
            pathComponents: ["api", "v1", "admin", "markets"],
            authorized: true
        )
    }

    /// POST `/api/v1/admin/markets/activate` — body `{ active/is_active, slugs?, region_code?, country? }`.
    @discardableResult
    func setAdminMarketsActive(
        active: Bool,
        slugs: [String]? = nil,
        regionCode: String? = nil,
        country: String? = nil
    ) async throws -> AdminMarketsActivateResponse {
        let cleanedSlugs = (slugs ?? [])
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        let region = regionCode?.trimmingCharacters(in: .whitespacesAndNewlines)
        let countryTrimmed = country?.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        guard !cleanedSlugs.isEmpty
            || (region?.isEmpty == false)
            || countryTrimmed == "US"
            || countryTrimmed == "MX"
        else {
            throw APIClientError.httpStatus(
                400,
                detail: "Provide at least one of slugs, region_code, or country."
            )
        }
        let body = SetAdminMarketsActiveBody(
            active: active,
            slugs: cleanedSlugs.isEmpty ? nil : cleanedSlugs,
            regionCode: (region?.isEmpty == false) ? region : nil,
            country: (countryTrimmed == "US" || countryTrimmed == "MX") ? countryTrimmed : nil
        )
        return try await postJSON(
            pathComponents: ["api", "v1", "admin", "markets", "activate"],
            body: body,
            authorized: .required
        )
    }

    // MARK: Category questions (public list + admin writes)

    /// GET `/api/v1/categories/{id}/questions` — public ordered set (no admin list route).
    func fetchCategoryQuestions(categoryId: String) async throws -> [CategoryQuestionRow] {
        let trimmed = categoryId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "Category id is required.")
        }
        let response: CategoryQuestionsResponse = try await getJSON(
            pathComponents: ["api", "v1", "categories", trimmed, "questions"],
            authorized: false
        )
        return response.questions
    }

    /// POST `/api/v1/admin/category-questions`
    @discardableResult
    func createAdminCategoryQuestion(
        categoryId: String,
        question: String,
        questionType: String = "text",
        required: Bool = false,
        displayOrder: Int = 0,
        options: [String]? = nil
    ) async throws -> CategoryQuestionRow {
        let cat = categoryId.trimmingCharacters(in: .whitespacesAndNewlines)
        let q = question.trimmingCharacters(in: .whitespacesAndNewlines)
        let typeTrimmed = questionType.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !cat.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "Category id is required.")
        }
        guard !q.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "Question is required.")
        }
        let body = CreateAdminCategoryQuestionBody(
            categoryId: cat,
            question: q,
            questionType: typeTrimmed.isEmpty ? "text" : typeTrimmed,
            required: required,
            displayOrder: displayOrder,
            options: options
        )
        return try await postJSON(
            pathComponents: ["api", "v1", "admin", "category-questions"],
            body: body,
            authorized: .required
        )
    }

    /// PATCH `/api/v1/admin/category-questions/{id}`
    @discardableResult
    func updateAdminCategoryQuestion(
        id: String,
        question: String? = nil,
        questionType: String? = nil,
        required: Bool? = nil,
        displayOrder: Int? = nil
    ) async throws -> AdminCategoryQuestionMutationResponse {
        let trimmed = id.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "Question id is required.")
        }
        let body = UpdateAdminCategoryQuestionBody(
            question: question?.trimmingCharacters(in: .whitespacesAndNewlines),
            questionType: questionType?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(),
            required: required,
            displayOrder: displayOrder
        )
        return try await patchJSON(
            pathComponents: ["api", "v1", "admin", "category-questions", trimmed],
            body: body,
            authorized: .required
        )
    }

    /// DELETE `/api/v1/admin/category-questions/{id}`
    @discardableResult
    func deleteAdminCategoryQuestion(id: String) async throws -> AdminCategoryQuestionMutationResponse {
        let trimmed = id.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "Question id is required.")
        }
        return try await deleteJSON(
            pathComponents: ["api", "v1", "admin", "category-questions", trimmed],
            authorized: .required
        )
    }

    // MARK: Insurers (flag `insurance_competition`)

    /// GET `/api/v1/admin/insurers`
    func fetchAdminInsurers() async throws -> [AdminInsurer] {
        let response: AdminInsurersResponse = try await getJSON(
            pathComponents: ["api", "v1", "admin", "insurers"],
            authorized: true
        )
        return response.insurers
    }

    /// POST `/api/v1/admin/insurers` — onboard carrier (+ optional rate card).
    @discardableResult
    func createAdminInsurer(
        name: String,
        slug: String,
        status: String = "pending",
        payoutAccount: String? = nil,
        rateCard: [AdminInsurerRateCardInput] = []
    ) async throws -> AdminInsurer {
        let nameTrimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let slugTrimmed = slug.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !nameTrimmed.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "Name is required.")
        }
        guard !slugTrimmed.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "Slug is required.")
        }
        let body = CreateAdminInsurerBody(
            name: nameTrimmed,
            slug: slugTrimmed,
            status: status.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(),
            payoutAccount: payoutAccount?.trimmingCharacters(in: .whitespacesAndNewlines),
            rateCard: rateCard
        )
        return try await postJSON(
            pathComponents: ["api", "v1", "admin", "insurers"],
            body: body,
            authorized: .required
        )
    }

    /// PUT `/api/v1/admin/insurers/{id}` — approve / suspend (or pending).
    @discardableResult
    func updateAdminInsurerStatus(id: String, status: String) async throws -> AdminInsurer {
        let trimmed = id.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "Insurer id is required.")
        }
        let statusTrimmed = status.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard statusTrimmed == "pending"
            || statusTrimmed == "approved"
            || statusTrimmed == "suspended"
        else {
            throw APIClientError.httpStatus(400, detail: "Status must be pending, approved, or suspended.")
        }
        let body = UpdateAdminInsurerBody(status: statusTrimmed)
        return try await putJSON(
            pathComponents: ["api", "v1", "admin", "insurers", trimmed],
            body: body,
            authorized: .required
        )
    }

    // MARK: Challenges

    /// GET `/api/v1/admin/challenges`
    func fetchAdminChallenges() async throws -> [AdminChallengeRow] {
        let response: AdminChallengesResponse = try await getJSON(
            pathComponents: ["api", "v1", "admin", "challenges"],
            authorized: true
        )
        return response.challenges
    }

    /// POST `/api/v1/admin/challenges`
    @discardableResult
    func createAdminChallenge(_ input: CreateAdminChallengeInput) async throws -> AdminChallengeRow {
        let title = input.title.trimmingCharacters(in: .whitespacesAndNewlines)
        let description = input.description.trimmingCharacters(in: .whitespacesAndNewlines)
        let challengeType = input.challengeType.trimmingCharacters(in: .whitespacesAndNewlines)
        let rewardType = input.rewardType.trimmingCharacters(in: .whitespacesAndNewlines)
        let rewardValue = input.rewardValue.trimmingCharacters(in: .whitespacesAndNewlines)
        let startsAt = input.startsAt.trimmingCharacters(in: .whitespacesAndNewlines)
        let endsAt = input.endsAt.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !title.isEmpty, !description.isEmpty, !challengeType.isEmpty,
              input.targetValue > 0, !rewardType.isEmpty, !rewardValue.isEmpty,
              !startsAt.isEmpty, !endsAt.isEmpty
        else {
            throw APIClientError.httpStatus(400, detail: "Missing required challenge fields.")
        }
        let body = CreateAdminChallengeBody(
            title: title,
            description: description,
            challengeType: challengeType,
            targetValue: input.targetValue,
            rewardType: rewardType,
            rewardValue: rewardValue,
            startsAt: startsAt,
            endsAt: endsAt,
            isSeasonal: input.isSeasonal,
            seasonName: input.seasonName?.trimmingCharacters(in: .whitespacesAndNewlines),
            maxParticipants: input.maxParticipants
        )
        return try await postJSON(
            pathComponents: ["api", "v1", "admin", "challenges"],
            body: body,
            authorized: .required
        )
    }

    // MARK: User GDPR finalize

    /// POST `/api/v1/admin/users/{id}/finalize-deletion` — bypass 30-day grace (admin override).
    @discardableResult
    func finalizeAdminUserDeletion(id: String) async throws -> AdminFinalizeDeletionResponse {
        let trimmed = id.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "User id is required.")
        }
        return try await postJSON(
            pathComponents: ["api", "v1", "admin", "users", trimmed, "finalize-deletion"],
            body: EmptyBody(),
            authorized: .required
        )
    }

    // MARK: Advances disburse (flag: working_capital)

    /// POST `/api/v1/admin/advances/{id}/disburse` — money path; empty body.
    @discardableResult
    func disburseAdminAdvance(id: String) async throws -> WorkingCapitalAdvance {
        let trimmed = id.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "Advance id is required.")
        }
        let response: AdvanceEnvelope = try await postJSON(
            pathComponents: ["api", "v1", "admin", "advances", trimmed, "disburse"],
            body: EmptyBody(),
            authorized: .required
        )
        guard let advance = response.advance else {
            throw APIClientError.decoding("Advance disburse response missing advance.")
        }
        return advance
    }

    // MARK: Guarantee claims (flag: nomarkup_guarantee)

    /// GET `/api/v1/admin/guarantee-claims`
    func fetchAdminGuaranteeClaims(
        page: Int = 1,
        pageSize: Int = 40,
        status: String? = nil
    ) async throws -> AdminGuaranteeClaimsResponse {
        var query = [
            URLQueryItem(name: "page", value: String(max(1, page))),
            URLQueryItem(name: "page_size", value: String(min(max(1, pageSize), 100))),
        ]
        if let status, !status.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            query.append(
                URLQueryItem(
                    name: "status",
                    value: status.trimmingCharacters(in: .whitespacesAndNewlines)
                )
            )
        }
        return try await getJSON(
            pathComponents: ["api", "v1", "admin", "guarantee-claims"],
            query: query,
            authorized: true
        )
    }

    /// PUT `/api/v1/admin/guarantee-claims/{id}/review`
    /// Body: `{ approved, resolution_notes, payout_cents? }`. Notes required server-side.
    @discardableResult
    func reviewAdminGuaranteeClaim(
        id: String,
        approved: Bool,
        resolutionNotes: String,
        payoutCents: Int64? = nil
    ) async throws -> AdminDisputeRow {
        let trimmed = id.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "Claim id is required.")
        }
        let notes = resolutionNotes.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !notes.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "Resolution notes are required.")
        }
        if let payoutCents, payoutCents < 0 {
            throw APIClientError.httpStatus(400, detail: "Payout amount must not be negative.")
        }
        let body = ReviewAdminGuaranteeClaimBody(
            approved: approved,
            resolutionNotes: notes,
            payoutCents: payoutCents
        )
        let response: AdminGuaranteeClaimReviewResponse = try await putJSON(
            pathComponents: ["api", "v1", "admin", "guarantee-claims", trimmed, "review"],
            body: body,
            authorized: .required
        )
        guard let claim = response.guaranteeClaim else {
            throw APIClientError.decoding("Guarantee review response missing claim.")
        }
        return claim
    }

    // MARK: Verification queue

    /// GET `/api/v1/admin/verification/queue`
    func fetchAdminVerificationQueue(
        page: Int = 1,
        pageSize: Int = 40
    ) async throws -> AdminVerificationQueueResponse {
        try await getJSON(
            pathComponents: ["api", "v1", "admin", "verification", "queue"],
            query: [
                URLQueryItem(name: "page", value: String(max(1, page))),
                URLQueryItem(name: "page_size", value: String(min(max(1, pageSize), 100))),
            ],
            authorized: true
        )
    }

    /// POST `/api/v1/admin/verification/{id}/review`
    /// Body: `{ approved, rejection_reason? }`. Rejection reason required when not approved.
    @discardableResult
    func reviewAdminVerification(
        id: String,
        approved: Bool,
        rejectionReason: String? = nil
    ) async throws -> AdminVerificationReviewResponse {
        let trimmed = id.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "Document id is required.")
        }
        let reason = rejectionReason?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !approved, reason.isEmpty {
            throw APIClientError.httpStatus(
                400,
                detail: "Rejection reason is required when not approved."
            )
        }
        let body = ReviewAdminVerificationBody(
            approved: approved,
            rejectionReason: reason.isEmpty ? nil : reason
        )
        return try await postJSON(
            pathComponents: ["api", "v1", "admin", "verification", trimmed, "review"],
            body: body,
            authorized: .required
        )
    }

    // MARK: Licenses (flag: legal_services)

    /// GET `/api/v1/admin/licenses` — default `status=pending`.
    func fetchAdminLicenses(
        status: String = "pending",
        page: Int = 1,
        pageSize: Int = 40
    ) async throws -> AdminLicensesResponse {
        let statusTrimmed = status.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let allowed: Set<String> = ["pending", "verified", "rejected", "all"]
        guard allowed.contains(statusTrimmed) else {
            throw APIClientError.httpStatus(
                400,
                detail: "status must be pending, verified, rejected, or all."
            )
        }
        return try await getJSON(
            pathComponents: ["api", "v1", "admin", "licenses"],
            query: [
                URLQueryItem(name: "status", value: statusTrimmed),
                URLQueryItem(name: "page", value: String(max(1, page))),
                URLQueryItem(name: "page_size", value: String(min(max(1, pageSize), 100))),
            ],
            authorized: true
        )
    }

    /// PUT `/api/v1/admin/licenses/{id}` — body `{ status: pending|verified|rejected }`.
    @discardableResult
    func reviewAdminLicense(id: String, status: String) async throws -> ProviderLicense {
        let trimmed = id.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "License id is required.")
        }
        let statusTrimmed = status.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard statusTrimmed == "pending"
            || statusTrimmed == "verified"
            || statusTrimmed == "rejected"
        else {
            throw APIClientError.httpStatus(
                400,
                detail: "status must be pending, verified, or rejected."
            )
        }
        return try await putJSON(
            pathComponents: ["api", "v1", "admin", "licenses", trimmed],
            body: ReviewAdminLicenseBody(status: statusTrimmed),
            authorized: .required
        )
    }

    // MARK: Insurance claims (flag: per_job_insurance)

    /// GET `/api/v1/admin/insurance/claims`
    func fetchAdminInsuranceClaims(
        page: Int = 1,
        pageSize: Int = 40,
        status: String? = nil
    ) async throws -> AdminInsuranceClaimsResponse {
        var query = [
            URLQueryItem(name: "page", value: String(max(1, page))),
            URLQueryItem(name: "page_size", value: String(min(max(1, pageSize), 100))),
        ]
        if let status, !status.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            query.append(
                URLQueryItem(
                    name: "status",
                    value: status.trimmingCharacters(in: .whitespacesAndNewlines)
                )
            )
        }
        return try await getJSON(
            pathComponents: ["api", "v1", "admin", "insurance", "claims"],
            query: query,
            authorized: true
        )
    }

    /// POST `/api/v1/admin/insurance/claims/{id}/review`
    /// Body: `{ approved, approved_amount_cents?, assessor_notes?, denial_reason? }`.
    @discardableResult
    func reviewAdminInsuranceClaim(
        id: String,
        approved: Bool,
        approvedAmountCents: Int64? = nil,
        assessorNotes: String? = nil,
        denialReason: String? = nil
    ) async throws -> InsuranceClaim {
        let trimmed = id.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "Claim id is required.")
        }
        if let approvedAmountCents, approvedAmountCents < 0 {
            throw APIClientError.httpStatus(400, detail: "Approved amount must not be negative.")
        }
        let body = ReviewAdminInsuranceClaimBody(
            approved: approved,
            approvedAmountCents: approvedAmountCents,
            assessorNotes: assessorNotes?.trimmingCharacters(in: .whitespacesAndNewlines),
            denialReason: denialReason?.trimmingCharacters(in: .whitespacesAndNewlines)
        )
        return try await postJSON(
            pathComponents: ["api", "v1", "admin", "insurance", "claims", trimmed, "review"],
            body: body,
            authorized: .required
        )
    }

    // MARK: Flagged reviews

    /// GET `/api/v1/admin/reviews/flagged`
    func fetchAdminFlaggedReviews(
        page: Int = 1,
        pageSize: Int = 40,
        status: String? = nil
    ) async throws -> AdminFlaggedReviewsResponse {
        var query = [
            URLQueryItem(name: "page", value: String(max(1, page))),
            URLQueryItem(name: "page_size", value: String(min(max(1, pageSize), 100))),
        ]
        if let status, !status.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            query.append(
                URLQueryItem(
                    name: "status",
                    value: status.trimmingCharacters(in: .whitespacesAndNewlines)
                )
            )
        }
        return try await getJSON(
            pathComponents: ["api", "v1", "admin", "reviews", "flagged"],
            query: query,
            authorized: true
        )
    }

    /// POST `/api/v1/admin/reviews/flags/{id}/resolve`
    /// Body: `{ action: uphold|dismiss, notes? }`.
    @discardableResult
    func resolveAdminReviewFlag(
        id: String,
        action: String,
        notes: String = ""
    ) async throws -> AdminReviewFlagResolveResponse {
        let trimmed = id.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "Flag id is required.")
        }
        let actionTrimmed = action.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard actionTrimmed == "uphold" || actionTrimmed == "dismiss" else {
            throw APIClientError.httpStatus(400, detail: "Action must be uphold or dismiss.")
        }
        let body = ResolveAdminReviewFlagBody(
            action: actionTrimmed,
            notes: notes.trimmingCharacters(in: .whitespacesAndNewlines)
        )
        return try await postJSON(
            pathComponents: ["api", "v1", "admin", "reviews", "flags", trimmed, "resolve"],
            body: body,
            authorized: .required
        )
    }

    /// DELETE `/api/v1/admin/reviews/{id}` — body `{ reason }` (required).
    @discardableResult
    func removeAdminReview(id: String, reason: String) async throws -> AdminReviewRemoveResponse {
        let trimmed = id.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "Review id is required.")
        }
        let reasonTrimmed = reason.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !reasonTrimmed.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "Reason is required.")
        }
        return try await deleteJSON(
            pathComponents: ["api", "v1", "admin", "reviews", trimmed],
            body: AdminReviewRemoveBody(reason: reasonTrimmed),
            authorized: .required
        )
    }


    // MARK: - Fees / payments

    /// GET `/api/v1/admin/payments/fee-config` — active platform (or category) fee rates.
    /// Percentages are 0…1 fractions; bounds are integer cents.
    func fetchAdminFeeConfig(categoryId: String? = nil) async throws -> AdminFeeConfig {
        var query: [URLQueryItem] = []
        if let categoryId, !categoryId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            query.append(
                URLQueryItem(
                    name: "category_id",
                    value: categoryId.trimmingCharacters(in: .whitespacesAndNewlines)
                )
            )
        }
        return try await getJSON(
            pathComponents: ["api", "v1", "admin", "payments", "fee-config"],
            query: query,
            authorized: true
        )
    }

    /// PUT `/api/v1/admin/payments/fee-config` — update default (or category) fee config.
    /// Send percentages as 0…1 fractions and money as integer cents (web admin parity).
    @discardableResult
    func updateAdminFeeConfig(_ body: AdminFeeConfigUpdateBody) async throws -> AdminFeeConfig {
        let response: AdminFeeConfigUpdateResponse = try await putJSON(
            pathComponents: ["api", "v1", "admin", "payments", "fee-config"],
            body: body,
            authorized: .required
        )
        if let config = response.config {
            return config
        }
        return AdminFeeConfig(
            feePercentage: body.feePercentage,
            guaranteePercentage: body.guaranteePercentage,
            minFeeCents: body.minFeeCents,
            maxFeeCents: body.maxFeeCents,
            leadGenEnabled: body.leadGenEnabled,
            leadGenPercentage: body.leadGenPercentage,
            leadGenMinFeeCents: body.leadGenMinFeeCents,
            leadGenMaxFeeCents: body.leadGenMaxFeeCents
        )
    }

    /// GET `/api/v1/admin/custom-fees` — admin-named additive platform fees.
    func fetchAdminCustomFees() async throws -> [AdminCustomFee] {
        let response: AdminCustomFeesResponse = try await getJSON(
            pathComponents: ["api", "v1", "admin", "custom-fees"],
            authorized: true
        )
        return response.fees ?? []
    }

    /// POST `/api/v1/admin/custom-fees` — persist a named fee (rate_bps, 500 = 5%).
    @discardableResult
    func createAdminCustomFee(name: String, rateBps: Int) async throws -> AdminCustomFee {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "Fee name is required.")
        }
        let response: AdminCustomFeeMutationResponse = try await postJSON(
            pathComponents: ["api", "v1", "admin", "custom-fees"],
            body: AdminCustomFeeCreateBody(name: trimmed, rateBps: rateBps),
            authorized: .required
        )
        if let fee = response.fee {
            return fee
        }
        return AdminCustomFee(id: "", name: trimmed, rateBps: rateBps, active: true)
    }

    /// PATCH `/api/v1/admin/custom-fees/{id}`
    @discardableResult
    func updateAdminCustomFee(
        id: String,
        name: String? = nil,
        rateBps: Int? = nil,
        active: Bool? = nil
    ) async throws -> AdminCustomFee {
        let trimmed = id.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "Custom fee id is required.")
        }
        let response: AdminCustomFeeMutationResponse = try await patchJSON(
            pathComponents: ["api", "v1", "admin", "custom-fees", trimmed],
            body: AdminCustomFeeUpdateBody(name: name, rateBps: rateBps, active: active),
            authorized: .required
        )
        if let fee = response.fee {
            return fee
        }
        return AdminCustomFee(id: trimmed, name: name ?? "", rateBps: rateBps ?? 0, active: active ?? true)
    }

    /// DELETE `/api/v1/admin/custom-fees/{id}` — soft-deactivate (dropped from live calc).
    func deleteAdminCustomFee(id: String) async throws {
        let trimmed = id.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "Custom fee id is required.")
        }
        try await deleteEmpty(
            pathComponents: ["api", "v1", "admin", "custom-fees", trimmed],
            authorized: .required
        )
    }

    /// GET `/api/v1/admin/revenue` — GMV / revenue aggregates (+ optional date range).
    func fetchAdminRevenue(
        startDate: String? = nil,
        endDate: String? = nil,
        groupBy: String? = nil
    ) async throws -> AdminRevenueReport {
        var query: [URLQueryItem] = []
        if let startDate, !startDate.isEmpty {
            query.append(URLQueryItem(name: "start_date", value: startDate))
        }
        if let endDate, !endDate.isEmpty {
            query.append(URLQueryItem(name: "end_date", value: endDate))
        }
        if let groupBy, !groupBy.isEmpty {
            query.append(URLQueryItem(name: "group_by", value: groupBy))
        }
        return try await getJSON(
            pathComponents: ["api", "v1", "admin", "revenue"],
            query: query,
            authorized: true
        )
    }

    /// GET `/api/v1/admin/payments?page=&page_size=`
    func fetchAdminPayments(
        page: Int = 1,
        pageSize: Int = 40,
        status: String? = nil
    ) async throws -> AdminPaymentsResponse {
        var query = [
            URLQueryItem(name: "page", value: String(max(1, page))),
            URLQueryItem(name: "page_size", value: String(min(max(1, pageSize), 100))),
        ]
        if let status, !status.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            query.append(
                URLQueryItem(
                    name: "status",
                    value: status.trimmingCharacters(in: .whitespacesAndNewlines)
                )
            )
        }
        return try await getJSON(
            pathComponents: ["api", "v1", "admin", "payments"],
            query: query,
            authorized: true
        )
    }

    // MARK: - Banking

    /// GET `/api/v1/admin/banking` — platform payout bank account (`account` may be null).
    func fetchAdminBanking() async throws -> AdminBankingResponse {
        try await getJSON(
            pathComponents: ["api", "v1", "admin", "banking"],
            authorized: true
        )
    }

    /// POST `/api/v1/admin/banking` + `Idempotency-Key` — set platform bank from Stripe `btok_…`.
    @discardableResult
    func setAdminBanking(
        bankAccountToken: String,
        accountHolderName: String,
        accountHolderType: String
    ) async throws -> AdminPlatformBankAccount {
        let token = bankAccountToken.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !token.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "Bank account token is required.")
        }
        let name = accountHolderName.trimmingCharacters(in: .whitespacesAndNewlines)
        let type = accountHolderType.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let typeNormalized = (type == "company") ? "company" : "individual"
        let opKey = "admin-platform-banking"
        let headers = idempotencyHeader(for: opKey)
        let body = SetAdminBankingBody(
            bankAccountToken: token,
            accountHolderName: name,
            accountHolderType: typeNormalized
        )
        do {
            let response: AdminBankingResponse = try await postJSON(
                pathComponents: ["api", "v1", "admin", "banking"],
                body: body,
                authorized: .required,
                headers: headers
            )
            clearIdempotencyKey(opKey)
            guard let account = response.account else {
                throw APIClientError.decoding("Set banking response missing account.")
            }
            return account
        } catch {
            if let api = error as? APIClientError, case .httpStatus(let code, _) = api, (400 ... 499).contains(code) {
                clearIdempotencyKey(opKey)
            }
            throw error
        }
    }

    /// DELETE `/api/v1/admin/banking/{id}`
    @discardableResult
    func deleteAdminBanking(id: String) async throws -> AdminBankingDeleteResponse {
        let trimmed = id.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            throw APIClientError.httpStatus(400, detail: "Bank account id is required.")
        }
        return try await deleteJSON(
            pathComponents: ["api", "v1", "admin", "banking", trimmed],
            authorized: .required
        )
    }

    // MARK: - Platform

    /// GET `/api/v1/admin/platform/metrics`
    func fetchAdminPlatformMetrics(
        startDate: String? = nil,
        endDate: String? = nil
    ) async throws -> AdminPlatformMetrics {
        var query: [URLQueryItem] = []
        if let startDate, !startDate.isEmpty {
            query.append(URLQueryItem(name: "start_date", value: startDate))
        }
        if let endDate, !endDate.isEmpty {
            query.append(URLQueryItem(name: "end_date", value: endDate))
        }
        return try await getJSON(
            pathComponents: ["api", "v1", "admin", "platform", "metrics"],
            query: query,
            authorized: true
        )
    }

    /// GET `/api/v1/admin/platform/growth`
    func fetchAdminPlatformGrowth(
        startDate: String? = nil,
        endDate: String? = nil,
        groupBy: String? = nil
    ) async throws -> AdminGrowthMetrics {
        var query: [URLQueryItem] = []
        if let startDate, !startDate.isEmpty {
            query.append(URLQueryItem(name: "start_date", value: startDate))
        }
        if let endDate, !endDate.isEmpty {
            query.append(URLQueryItem(name: "end_date", value: endDate))
        }
        if let groupBy, !groupBy.isEmpty {
            query.append(URLQueryItem(name: "group_by", value: groupBy))
        }
        return try await getJSON(
            pathComponents: ["api", "v1", "admin", "platform", "growth"],
            query: query,
            authorized: true
        )
    }

    /// GET `/api/v1/admin/subscriptions`
    func fetchAdminSubscriptions(
        page: Int = 1,
        pageSize: Int = 40,
        status: String? = nil
    ) async throws -> AdminSubscriptionsResponse {
        var query = [
            URLQueryItem(name: "page", value: String(max(1, page))),
            URLQueryItem(name: "page_size", value: String(min(max(1, pageSize), 100))),
        ]
        if let status, !status.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            query.append(
                URLQueryItem(
                    name: "status",
                    value: status.trimmingCharacters(in: .whitespacesAndNewlines)
                )
            )
        }
        return try await getJSON(
            pathComponents: ["api", "v1", "admin", "subscriptions"],
            query: query,
            authorized: true
        )
    }

}
// MARK: - Admin models

struct AdminFeatureFlag: Decodable, Sendable, Hashable, Identifiable {
    var key: String
    var enabled: Bool?
    var description: String?
    var rolloutPercent: Int?
    var binaryOnly: Bool?
    var updatedAt: String?

    var id: String { key }

    var displayTitle: String { key.replacingOccurrences(of: "_", with: " ") }
    var isOn: Bool { enabled == true }
    var isBinaryOnly: Bool { binaryOnly == true }
}

struct AdminFeatureFlagUpdateResponse: Decodable, Sendable {
    var key: String?
    var enabled: Bool?
    var rolloutPercent: Int?
    var binaryOnly: Bool?
}

/// PUT body for `/api/v1/admin/flags/{key}`.
private struct UpdateAdminFlagBody: Encodable {
    var enabled: Bool
    var rolloutPercent: Int?

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(enabled, forKey: .enabled)
        // Omit rollout when nil so the server leaves the column unchanged.
        if let rolloutPercent {
            try c.encode(rolloutPercent, forKey: .rolloutPercent)
        }
    }

    private enum CodingKeys: String, CodingKey {
        case enabled
        case rolloutPercent
    }
}

struct AdminFlagsResponse: Decodable, Sendable {
    var flags: [AdminFeatureFlag]

    init(from decoder: Decoder) throws {
        if let arr = try? decoder.singleValueContainer().decode([AdminFeatureFlag].self) {
            flags = arr
            return
        }
        let c = try decoder.container(keyedBy: CodingKeys.self)
        flags = try c.decodeIfPresent([AdminFeatureFlag].self, forKey: .flags) ?? []
    }

    enum CodingKeys: String, CodingKey { case flags }
}

struct AdminDisputeRow: Decodable, Sendable, Hashable, Identifiable {
    var id: String
    var contractId: String?
    var status: String?
    var disputeType: String?
    var description: String?
    var openedBy: String?
    var createdAt: String?
    var isGuaranteeClaim: Bool?
    var resolutionType: String?
    var resolutionNotes: String?

    var isOpenForResolution: Bool {
        let s = (status ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return s.isEmpty || s == "open" || s == "under_review" || s == "escalated"
    }
}

struct AdminDisputesResponse: Decodable, Sendable {
    var disputes: [AdminDisputeRow]

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        disputes = try c.decodeIfPresent([AdminDisputeRow].self, forKey: .disputes) ?? []
    }

    enum CodingKeys: String, CodingKey { case disputes }
}

struct AdminDisputeResolveResponse: Decodable, Sendable {
    var dispute: AdminDisputeRow?
}

/// POST body for `/api/v1/admin/disputes/{id}/resolve`.
private struct ResolveAdminDisputeBody: Encodable {
    var resolutionType: String
    var resolutionNotes: String
    var refundAmountCents: Int64?
    var guaranteeOutcome: String?

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(resolutionType, forKey: .resolutionType)
        try c.encode(resolutionNotes, forKey: .resolutionNotes)
        if let refundAmountCents {
            try c.encode(refundAmountCents, forKey: .refundAmountCents)
        }
        if let guaranteeOutcome {
            try c.encode(guaranteeOutcome, forKey: .guaranteeOutcome)
        }
    }

    private enum CodingKeys: String, CodingKey {
        case resolutionType
        case resolutionNotes
        case refundAmountCents
        case guaranteeOutcome
    }
}

struct AdminUserRow: Decodable, Sendable, Hashable, Identifiable {
    var id: String
    var email: String?
    var displayName: String?
    var roles: [String]?
    var createdAt: String?
    var status: String?

    var displayLabel: String {
        let name = displayName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !name.isEmpty { return name }
        let e = email?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return e.isEmpty ? id : e
    }

    var normalizedStatus: String {
        (status ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }

    var isSuspended: Bool { normalizedStatus == "suspended" }
    var isBanned: Bool { normalizedStatus == "banned" }
    /// Mirrors web: Suspend disabled when already suspended (or banned).
    var canSuspend: Bool { !isSuspended && !isBanned }
    /// Ban disabled when already banned.
    var canBan: Bool { !isBanned }
    var canReactivate: Bool { isSuspended }

    var displayStatus: String {
        let s = normalizedStatus
        return s.isEmpty ? "unknown" : s
    }
}

struct AdminUsersResponse: Decodable, Sendable {
    var users: [AdminUserRow]

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        users = try c.decodeIfPresent([AdminUserRow].self, forKey: .users) ?? []
    }

    enum CodingKeys: String, CodingKey { case users }
}

struct AdminUserMutationResponse: Decodable, Sendable {
    var user: AdminUserRow?
}

/// POST body for suspend/ban.
private struct AdminUserReasonBody: Encodable {
    var reason: String
}

struct AdminReportRow: Decodable, Sendable, Hashable, Identifiable {
    var id: String
    var status: String?
    var reason: String?
    var targetId: String?
    var reporterId: String?
    var createdAt: String?
    var listingId: String?
    var userId: String?

    /// Open or intermediate (`reviewed`) — not terminal `dismissed` / `actioned`.
    var isOpenForResolution: Bool {
        let s = (status ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if s.isEmpty || s == "open" || s == "pending" || s == "reviewed" { return true }
        return s != "dismissed" && s != "actioned"
    }
}

struct AdminReportsResponse: Decodable, Sendable {
    var reports: [AdminReportRow]

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        if let r = try c.decodeIfPresent([AdminReportRow].self, forKey: .reports) {
            reports = r
        } else if let r = try c.decodeIfPresent([AdminReportRow].self, forKey: .goodsReports) {
            reports = r
        } else if let r = try c.decodeIfPresent([AdminReportRow].self, forKey: .jobReports) {
            reports = r
        } else if let r = try c.decodeIfPresent([AdminReportRow].self, forKey: .userReports) {
            reports = r
        } else {
            reports = []
        }
    }

    enum CodingKeys: String, CodingKey {
        case reports
        case goodsReports
        case jobReports
        case userReports
    }
}

struct AdminFraudAlert: Decodable, Sendable, Hashable, Identifiable {
    var id: String
    var severity: String?
    var aggregateRiskLevel: String?
    var status: String?
    var summary: String?
    var resolutionNotes: String?
    var createdAt: String?
    var userId: String?

    var displayRisk: String {
        let raw = (aggregateRiskLevel ?? severity ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        return raw.isEmpty ? "alert" : raw
    }

    var isResolved: Bool {
        let s = (status ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return s == "resolved_fraud" || s == "resolved_legitimate" || s == "dismissed"
    }
}

struct AdminFraudResponse: Decodable, Sendable {
    var alerts: [AdminFraudAlert]

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        if let a = try c.decodeIfPresent([AdminFraudAlert].self, forKey: .alerts) {
            alerts = a
        } else if let a = try c.decodeIfPresent([AdminFraudAlert].self, forKey: .items) {
            alerts = a
        } else {
            alerts = []
        }
    }

    enum CodingKeys: String, CodingKey { case alerts, items }
}

struct AdminFraudReviewResponse: Decodable, Sendable {
    var alert: AdminFraudAlert?
}

/// POST body for `/api/v1/admin/fraud/alerts/{id}/review`.
private struct ReviewAdminFraudAlertBody: Encodable {
    var status: String
    var resolutionNotes: String
    var restrictUser: Bool
    var banUser: Bool
}

struct AdminReportResolveResponse: Decodable, Sendable {
    var reportId: String?
    var status: String?
}

/// POST body for goods/user report resolve.
private struct ResolveAdminReportBody: Encodable {
    var action: String
    var notes: String
}

/// POST body for `/api/v1/admin/advances/{id}/review`.
private struct ReviewAdminAdvanceBody: Encodable {
    var action: String
    var reason: String
}

// MARK: - Fees / payments models

/// Active fee config from GET `/api/v1/admin/payments/fee-config`.
/// Percentages are 0…1 fractions (0.08 = 8%); fee bounds are integer cents.
struct AdminFeeConfig: Decodable, Sendable, Hashable {
    var feePercentage: Double?
    var guaranteePercentage: Double?
    var minFeeCents: Int64?
    var maxFeeCents: Int64?
    var leadGenEnabled: Bool?
    var leadGenPercentage: Double?
    var leadGenMinFeeCents: Int64?
    var leadGenMaxFeeCents: Int64?

    /// Whole-number percent for UI steppers (fraction 0.08 → 8).
    static func percentDisplay(fromFraction fraction: Double?) -> String {
        guard let fraction else { return "" }
        let pct = fraction * 100
        if abs(pct.rounded() - pct) < 0.000_1 {
            return String(Int(pct.rounded()))
        }
        return String(format: "%.2f", pct)
    }

    /// Convert UI whole-number percent text → 0…1 fraction for the API.
    static func fraction(fromPercentText text: String) -> Double? {
        let cleaned = text.trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: "%", with: "")
        guard !cleaned.isEmpty, let value = Double(cleaned), value >= 0, value <= 100 else {
            return nil
        }
        return value / 100
    }

    /// Parse dollar text into integer cents, allowing zero (empty → 0).
    static func centsAllowingZero(fromDollarsText text: String) -> Int64? {
        let cleaned = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if cleaned.isEmpty { return 0 }
        if let positive = MoneyFormat.cents(fromDollarsText: cleaned) {
            return positive
        }
        // MoneyFormat rejects zero; accept explicit 0 / 0.00.
        var s = cleaned.replacingOccurrences(of: "$", with: "")
            .replacingOccurrences(of: ",", with: "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard let decimal = Decimal(string: s), decimal == 0 else { return nil }
        return 0
    }
}

/// PUT body for `/api/v1/admin/payments/fee-config`.
struct AdminFeeConfigUpdateBody: Encodable, Sendable {
    var feePercentage: Double
    var guaranteePercentage: Double
    var minFeeCents: Int64
    var maxFeeCents: Int64?
    var leadGenEnabled: Bool
    var leadGenPercentage: Double
    var leadGenMinFeeCents: Int64
    var leadGenMaxFeeCents: Int64?
    var categoryId: String?

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(feePercentage, forKey: .feePercentage)
        try c.encode(guaranteePercentage, forKey: .guaranteePercentage)
        try c.encode(minFeeCents, forKey: .minFeeCents)
        if let maxFeeCents {
            try c.encode(maxFeeCents, forKey: .maxFeeCents)
        }
        try c.encode(leadGenEnabled, forKey: .leadGenEnabled)
        try c.encode(leadGenPercentage, forKey: .leadGenPercentage)
        try c.encode(leadGenMinFeeCents, forKey: .leadGenMinFeeCents)
        // Explicit null when cleared so the server can drop the cap.
        try c.encode(leadGenMaxFeeCents, forKey: .leadGenMaxFeeCents)
        if let categoryId, !categoryId.isEmpty {
            try c.encode(categoryId, forKey: .categoryId)
        }
    }

    private enum CodingKeys: String, CodingKey {
        case feePercentage
        case guaranteePercentage
        case minFeeCents
        case maxFeeCents
        case leadGenEnabled
        case leadGenPercentage
        case leadGenMinFeeCents
        case leadGenMaxFeeCents
        case categoryId
    }
}

private struct AdminFeeConfigUpdateResponse: Decodable, Sendable {
    var config: AdminFeeConfig?
}

struct AdminCustomFee: Decodable, Identifiable, Sendable, Hashable {
    var id: String
    var name: String
    var rateBps: Int
    var active: Bool? = true
    var createdAt: String? = nil
    var updatedAt: String? = nil

    var percentDisplay: String {
        let pct = Double(rateBps) / 100.0
        if abs(pct.rounded() - pct) < 0.000_1 {
            return String(Int(pct.rounded()))
        }
        return String(format: "%.2f", pct)
    }
}

private struct AdminCustomFeesResponse: Decodable, Sendable {
    var fees: [AdminCustomFee]?
}

private struct AdminCustomFeeMutationResponse: Decodable, Sendable {
    var fee: AdminCustomFee?
}

private struct AdminCustomFeeCreateBody: Encodable, Sendable {
    var name: String
    var rateBps: Int
}

private struct AdminCustomFeeUpdateBody: Encodable, Sendable {
    var name: String?
    var rateBps: Int?
    var active: Bool?
}

struct AdminRevenueReport: Decodable, Sendable {
    var dataPoints: [AdminRevenueDataPoint]?
    var totalGmvCents: Int64?
    var totalRevenueCents: Int64?
    var totalGuaranteeFundCents: Int64?
    var effectiveTakeRate: Double?

    var displayRows: [(key: String, value: String)] {
        var rows: [(String, String)] = []
        if let v = totalGmvCents {
            rows.append(("total_gmv_cents", MoneyFormat.usd(cents: v)))
        }
        if let v = totalRevenueCents {
            rows.append(("total_revenue_cents", MoneyFormat.usd(cents: v)))
        }
        if let v = totalGuaranteeFundCents {
            rows.append(("total_guarantee_fund_cents", MoneyFormat.usd(cents: v)))
        }
        if let v = effectiveTakeRate {
            rows.append(("effective_take_rate", String(format: "%.4f", v)))
        }
        return rows
    }
}

struct AdminRevenueDataPoint: Decodable, Sendable, Hashable {
    var periodStart: String?
    var gmvCents: Int64?
    var revenueCents: Int64?
    var transactionCount: Int64?
}

struct AdminPaymentRow: Decodable, Sendable, Hashable, Identifiable {
    var id: String
    var contractId: String?
    var customerId: String?
    var providerId: String?
    var amountCents: Int64?
    var platformFeeCents: Int64?
    var guaranteeFeeCents: Int64?
    var providerPayoutCents: Int64?
    var status: String?
    var createdAt: String?

    var displayAmount: String { MoneyFormat.usd(cents: amountCents ?? 0) }
    var displayStatus: String {
        let s = (status ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        return s.isEmpty ? "unknown" : s
    }
}

struct AdminPaymentsResponse: Decodable, Sendable {
    var payments: [AdminPaymentRow]
    var totalAmountCents: Int64?
    var totalFeesCents: Int64?

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        payments = try c.decodeIfPresent([AdminPaymentRow].self, forKey: .payments) ?? []
        totalAmountCents = try c.decodeIfPresent(Int64.self, forKey: .totalAmountCents)
        totalFeesCents = try c.decodeIfPresent(Int64.self, forKey: .totalFeesCents)
    }

    enum CodingKeys: String, CodingKey {
        case payments
        case totalAmountCents
        case totalFeesCents
    }
}

// MARK: - Banking models

struct AdminPlatformBankAccount: Decodable, Sendable, Hashable, Identifiable {
    var id: String
    var stripeExternalAccountId: String?
    var bankName: String?
    var accountHolderName: String?
    var accountHolderType: String?
    var last4: String?
    var routingLast4: String?
    var currency: String?
    var country: String?
    var status: String?
    var isDefault: Bool?
    var createdAt: String?
    var updatedAt: String?

    var displayLast4: String {
        let l = (last4 ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        return l.isEmpty ? "••••" : "••••\(l)"
    }

    var displayTitle: String {
        let bank = (bankName ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if bank.isEmpty { return "Platform account \(displayLast4)" }
        return "\(bank) \(displayLast4)"
    }
}

struct AdminBankingResponse: Decodable, Sendable {
    var account: AdminPlatformBankAccount?
}

struct AdminBankingDeleteResponse: Decodable, Sendable {
    var deleted: Bool?
}

private struct SetAdminBankingBody: Encodable {
    var bankAccountToken: String
    var accountHolderName: String
    var accountHolderType: String
}

// MARK: - Platform metrics models

struct AdminPlatformMetrics: Decodable, Sendable, Hashable {
    var totalGmvCents: Int64?
    var totalRevenueCents: Int64?
    var totalGuaranteeFundCents: Int64?
    var effectiveTakeRate: Double?
    var totalUsers: Int64?
    var activeUsers: Int64?
    var newUsers: Int64?
    var totalJobsPosted: Int64?
    var totalJobsCompleted: Int64?
    var jobFillRate: Double?
    var jobCompletionRate: Double?
    var totalBids: Int64?
    var avgBidsPerJob: Double?
    var disputesOpened: Int64?
    var disputesResolved: Int64?
    var disputeRate: Double?
    var guaranteeClaims: Int64?
    var guaranteePayoutsCents: Int64?

    /// Monospaced key/value rows for ops display.
    var displayRows: [(key: String, value: String)] {
        func cents(_ v: Int64?) -> String? {
            guard let v else { return nil }
            return MoneyFormat.usd(cents: v)
        }
        func num(_ v: Int64?) -> String? {
            guard let v else { return nil }
            return String(v)
        }
        func rate(_ v: Double?) -> String? {
            guard let v else { return nil }
            return String(format: "%.4f", v)
        }
        let pairs: [(String, String?)] = [
            ("total_gmv_cents", cents(totalGmvCents)),
            ("total_revenue_cents", cents(totalRevenueCents)),
            ("total_guarantee_fund_cents", cents(totalGuaranteeFundCents)),
            ("effective_take_rate", rate(effectiveTakeRate)),
            ("total_users", num(totalUsers)),
            ("active_users", num(activeUsers)),
            ("new_users", num(newUsers)),
            ("total_jobs_posted", num(totalJobsPosted)),
            ("total_jobs_completed", num(totalJobsCompleted)),
            ("job_fill_rate", rate(jobFillRate)),
            ("job_completion_rate", rate(jobCompletionRate)),
            ("total_bids", num(totalBids)),
            ("avg_bids_per_job", rate(avgBidsPerJob)),
            ("disputes_opened", num(disputesOpened)),
            ("disputes_resolved", num(disputesResolved)),
            ("dispute_rate", rate(disputeRate)),
            ("guarantee_claims", num(guaranteeClaims)),
            ("guarantee_payouts_cents", cents(guaranteePayoutsCents)),
        ]
        return pairs.compactMap { key, value in
            guard let value else { return nil }
            return (key, value)
        }
    }
}

struct AdminGrowthMetrics: Decodable, Sendable {
    var dataPoints: [AdminGrowthDataPoint]?
    var gmvGrowthRate: Double?
    var userGrowthRate: Double?
    var jobGrowthRate: Double?

    var summaryRows: [(key: String, value: String)] {
        var rows: [(String, String)] = []
        if let v = gmvGrowthRate {
            rows.append(("gmv_growth_rate", String(format: "%.4f", v)))
        }
        if let v = userGrowthRate {
            rows.append(("user_growth_rate", String(format: "%.4f", v)))
        }
        if let v = jobGrowthRate {
            rows.append(("job_growth_rate", String(format: "%.4f", v)))
        }
        return rows
    }
}

struct AdminGrowthDataPoint: Decodable, Sendable, Hashable, Identifiable {
    var periodStart: String?
    var newUsers: Int64?
    var newProviders: Int64?
    var jobsPosted: Int64?
    var jobsCompleted: Int64?
    var gmvCents: Int64?
    var revenueCents: Int64?

    var id: String { periodStart ?? UUID().uuidString }
}

struct AdminSubscriptionRow: Decodable, Sendable, Hashable, Identifiable {
    var id: String
    var userId: String?
    var tierId: String?
    var status: String?
    var createdAt: String?
}

struct AdminSubscriptionsResponse: Decodable, Sendable {
    var subscriptions: [AdminSubscriptionRow]
    var totalMrrCents: Int64?

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        subscriptions = try c.decodeIfPresent([AdminSubscriptionRow].self, forKey: .subscriptions) ?? []
        totalMrrCents = try c.decodeIfPresent(Int64.self, forKey: .totalMrrCents)
    }

    enum CodingKeys: String, CodingKey {
        case subscriptions
        case totalMrrCents
    }
}

// MARK: - Jobs moderation models

struct AdminJobRow: Decodable, Sendable, Hashable, Identifiable {
    var id: String
    var title: String?
    var description: String?
    var customerId: String?
    var status: String?
    var startingBidCents: Int64?
    var bidCount: Int?
    var categoryId: String?
    var categoryName: String?
    var createdAt: String?
    var auctionEndsAt: String?

    var displayTitle: String {
        let t = title?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return t.isEmpty ? "Job \(String(id.prefix(8)))…" : t
    }

    var displayStatus: String {
        let s = (status ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        return s.isEmpty ? "unknown" : s
    }

    var normalizedStatus: String {
        displayStatus.lowercased()
    }

    /// Suspend when still live / open (not already terminal).
    var canSuspend: Bool {
        let s = normalizedStatus
        return s == "active" || s == "draft" || s.isEmpty
    }

    /// Remove when not already cancelled/removed.
    var canRemove: Bool {
        let s = normalizedStatus
        return s != "cancelled" && s != "removed" && s != "completed"
    }

    var displayStartingBid: String {
        MoneyFormat.usd(cents: startingBidCents ?? 0)
    }
}

struct AdminJobsResponse: Decodable, Sendable {
    var jobs: [AdminJobRow]

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        jobs = try c.decodeIfPresent([AdminJobRow].self, forKey: .jobs) ?? []
    }

    enum CodingKeys: String, CodingKey { case jobs }
}

struct AdminJobMutationResponse: Decodable, Sendable {
    var job: AdminJobRow?
}

struct AdminJobRemoveResponse: Decodable, Sendable {
    var message: String?
}

/// Shared reason body for suspend/remove/cancel admin mutations.
private struct AdminReasonBody: Encodable {
    var reason: String
}

// MARK: - Listings moderation models

struct AdminListingRow: Decodable, Sendable, Hashable, Identifiable {
    var id: String
    var title: String?
    var sellerId: String?
    var sellerEmail: String?
    var status: String?
    var isHidden: Bool?
    var hiddenReason: String?
    var startingPriceCents: Int64?
    var currentBidCents: Int64?
    var bidCount: Int?
    var openReportCount: Int?
    var auctionEndsAt: String?
    var createdAt: String?

    var displayTitle: String {
        let t = title?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return t.isEmpty ? "Listing \(String(id.prefix(8)))…" : t
    }

    var displayStatus: String {
        let s = (status ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        return s.isEmpty ? "unknown" : s
    }

    var hidden: Bool { isHidden == true }

    var normalizedStatus: String {
        displayStatus.lowercased()
    }

    var canSuspend: Bool {
        !hidden && normalizedStatus != "cancelled"
    }

    var canReactivate: Bool {
        hidden && normalizedStatus != "cancelled"
    }

    var canCancel: Bool {
        normalizedStatus != "cancelled"
    }

    var displayPrice: String {
        if let current = currentBidCents {
            return MoneyFormat.usd(cents: current)
        }
        return MoneyFormat.usd(cents: startingPriceCents ?? 0)
    }
}

struct AdminListingsResponse: Decodable, Sendable {
    var listings: [AdminListingRow]

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        listings = try c.decodeIfPresent([AdminListingRow].self, forKey: .listings) ?? []
    }

    enum CodingKeys: String, CodingKey { case listings }
}

struct AdminListingMutationResponse: Decodable, Sendable {
    var listingId: String?
    var status: String?
    var hidden: Bool?
}

// MARK: - Goods dispute models

struct AdminGoodsDisputeRow: Decodable, Sendable, Hashable, Identifiable {
    var id: String
    var listingOrderId: String?
    var listingId: String?
    var listingTitle: String?
    var openedBy: String?
    var openedByEmail: String?
    var disputeType: String?
    var description: String?
    var status: String?
    var amountCents: Int64?
    var refundToBuyerCents: Int64?
    var transferToSellerCents: Int64?
    var createdAt: String?
    var resolvedAt: String?

    var displayTitle: String {
        let t = listingTitle?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !t.isEmpty { return t }
        let dtype = disputeType?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return dtype.isEmpty ? "Dispute \(String(id.prefix(8)))…" : dtype
    }

    var displayStatus: String {
        let s = (status ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        return s.isEmpty ? "unknown" : s
    }

    var displayAmount: String {
        MoneyFormat.usd(cents: amountCents ?? 0)
    }

    var isOpenForResolution: Bool {
        let s = displayStatus.lowercased()
        return s.isEmpty || s == "open" || s == "under_review" || s == "escalated" || s == "pending"
    }
}

struct AdminGoodsDisputesResponse: Decodable, Sendable {
    var disputes: [AdminGoodsDisputeRow]

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        disputes = try c.decodeIfPresent([AdminGoodsDisputeRow].self, forKey: .disputes) ?? []
    }

    enum CodingKeys: String, CodingKey { case disputes }
}

struct AdminGoodsDisputeResolveResponse: Decodable, Sendable {
    var disputeId: String?
    var status: String?
    var resolution: String?
}

/// POST body for `/api/v1/admin/disputes/goods/{id}/resolve`.
private struct ResolveAdminGoodsDisputeBody: Encodable {
    var resolution: String
    var refundToBuyerCents: Int64?
    var transferToSellerCents: Int64?
    var notes: String

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(resolution, forKey: .resolution)
        try c.encode(notes, forKey: .notes)
        if let refundToBuyerCents {
            try c.encode(refundToBuyerCents, forKey: .refundToBuyerCents)
        }
        if let transferToSellerCents {
            try c.encode(transferToSellerCents, forKey: .transferToSellerCents)
        }
    }

    private enum CodingKeys: String, CodingKey {
        case resolution
        case refundToBuyerCents
        case transferToSellerCents
        case notes
    }
}

// MARK: - Markets activate

struct AdminMarketsActivateResponse: Decodable, Sendable {
    var updated: Int64?
    var active: Bool?
}

private struct SetAdminMarketsActiveBody: Encodable {
    var active: Bool
    var slugs: [String]?
    var regionCode: String?
    var country: String?

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(active, forKey: .active)
        if let slugs, !slugs.isEmpty {
            try c.encode(slugs, forKey: .slugs)
        }
        if let regionCode, !regionCode.isEmpty {
            try c.encode(regionCode, forKey: .regionCode)
        }
        if let country, !country.isEmpty {
            try c.encode(country, forKey: .country)
        }
    }

    private enum CodingKeys: String, CodingKey {
        case active
        case slugs
        case regionCode
        case country
    }
}

// MARK: - Category questions

struct CategoryQuestionRow: Decodable, Sendable, Hashable, Identifiable {
    var id: String
    var categoryId: String?
    var question: String?
    var questionType: String?
    var required: Bool?
    var displayOrder: Int?
    var createdAt: String?

    var displayQuestion: String {
        let q = question?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return q.isEmpty ? "Question \(String(id.prefix(8)))…" : q
    }

    var displayType: String {
        let t = (questionType ?? "text").trimmingCharacters(in: .whitespacesAndNewlines)
        return t.isEmpty ? "text" : t
    }
}

struct CategoryQuestionsResponse: Decodable, Sendable {
    var questions: [CategoryQuestionRow]

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        questions = try c.decodeIfPresent([CategoryQuestionRow].self, forKey: .questions) ?? []
    }

    enum CodingKeys: String, CodingKey { case questions }
}

struct AdminCategoryQuestionMutationResponse: Decodable, Sendable {
    var updated: Bool?
    var deleted: Bool?
}

private struct CreateAdminCategoryQuestionBody: Encodable {
    var categoryId: String
    var question: String
    var questionType: String
    var required: Bool
    var displayOrder: Int
    var options: [String]?

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(categoryId, forKey: .categoryId)
        try c.encode(question, forKey: .question)
        try c.encode(questionType, forKey: .questionType)
        try c.encode(required, forKey: .required)
        try c.encode(displayOrder, forKey: .displayOrder)
        if let options, !options.isEmpty {
            try c.encode(options, forKey: .options)
        }
    }

    private enum CodingKeys: String, CodingKey {
        case categoryId
        case question
        case questionType
        case required
        case displayOrder
        case options
    }
}

private struct UpdateAdminCategoryQuestionBody: Encodable {
    var question: String?
    var questionType: String?
    var required: Bool?
    var displayOrder: Int?

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        if let question, !question.isEmpty {
            try c.encode(question, forKey: .question)
        }
        if let questionType, !questionType.isEmpty {
            try c.encode(questionType, forKey: .questionType)
        }
        if let required {
            try c.encode(required, forKey: .required)
        }
        if let displayOrder {
            try c.encode(displayOrder, forKey: .displayOrder)
        }
    }

    private enum CodingKeys: String, CodingKey {
        case question
        case questionType
        case required
        case displayOrder
    }
}

// MARK: - Insurers

struct AdminInsurerProduct: Decodable, Sendable, Hashable, Identifiable {
    var id: String
    var productType: String?
    var baseRateBps: Int?
    var minPremiumCents: Int64?
    var active: Bool?
}

struct AdminInsurer: Decodable, Sendable, Hashable, Identifiable {
    var id: String
    var name: String?
    var slug: String?
    var status: String?
    var payoutAccount: String?
    var products: [AdminInsurerProduct]?
    var createdAt: String?

    var displayName: String {
        let n = name?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !n.isEmpty { return n }
        let s = slug?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return s.isEmpty ? id : s
    }

    var normalizedStatus: String {
        (status ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }

    var displayStatus: String {
        let s = normalizedStatus
        return s.isEmpty ? "unknown" : s
    }

    var canApprove: Bool { normalizedStatus != "approved" }
    var canSuspend: Bool { normalizedStatus != "suspended" }
}

struct AdminInsurersResponse: Decodable, Sendable {
    var insurers: [AdminInsurer]

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        insurers = try c.decodeIfPresent([AdminInsurer].self, forKey: .insurers) ?? []
    }

    enum CodingKeys: String, CodingKey { case insurers }
}

struct AdminInsurerRateCardInput: Encodable, Sendable {
    var productType: String
    var baseRateBps: Int
    var minPremiumCents: Int64
    var active: Bool?
}

private struct CreateAdminInsurerBody: Encodable {
    var name: String
    var slug: String
    var status: String
    var payoutAccount: String?
    var rateCard: [AdminInsurerRateCardInput]

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(name, forKey: .name)
        try c.encode(slug, forKey: .slug)
        try c.encode(status, forKey: .status)
        if let payoutAccount, !payoutAccount.isEmpty {
            try c.encode(payoutAccount, forKey: .payoutAccount)
        }
        if !rateCard.isEmpty {
            try c.encode(rateCard, forKey: .rateCard)
        }
    }

    private enum CodingKeys: String, CodingKey {
        case name
        case slug
        case status
        case payoutAccount
        case rateCard
    }
}

private struct UpdateAdminInsurerBody: Encodable {
    var status: String
}

// MARK: - Admin challenges

struct AdminChallengeRow: Decodable, Sendable, Hashable, Identifiable {
    var id: String
    var title: String?
    var description: String?
    var challengeType: String?
    var targetValue: Int?
    var rewardType: String?
    var rewardValue: String?
    var startsAt: String?
    var endsAt: String?
    var isSeasonal: Bool?
    var seasonName: String?
    var maxParticipants: Int?
    var participantCount: Int?
    var completedCount: Int?
    var isActive: Bool?
    var createdAt: String?
    var updatedAt: String?

    var displayTitle: String {
        let t = title?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return t.isEmpty ? "Challenge" : t
    }

    var displayType: String {
        let t = (challengeType ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        return t.isEmpty ? "—" : t.replacingOccurrences(of: "_", with: " ").capitalized
    }

    var participantsLabel: String {
        let p = participantCount ?? 0
        let c = completedCount ?? 0
        return "\(p) joined · \(c) completed"
    }
}

struct AdminChallengesResponse: Decodable, Sendable {
    var challenges: [AdminChallengeRow]

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        challenges = try c.decodeIfPresent([AdminChallengeRow].self, forKey: .challenges) ?? []
    }

    enum CodingKeys: String, CodingKey { case challenges }
}

struct CreateAdminChallengeInput: Sendable {
    var title: String
    var description: String
    var challengeType: String
    var targetValue: Int
    var rewardType: String
    var rewardValue: String
    var startsAt: String
    var endsAt: String
    var isSeasonal: Bool
    var seasonName: String?
    var maxParticipants: Int?
}

private struct CreateAdminChallengeBody: Encodable {
    var title: String
    var description: String
    var challengeType: String
    var targetValue: Int
    var rewardType: String
    var rewardValue: String
    var startsAt: String
    var endsAt: String
    var isSeasonal: Bool
    var seasonName: String?
    var maxParticipants: Int?

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(title, forKey: .title)
        try c.encode(description, forKey: .description)
        try c.encode(challengeType, forKey: .challengeType)
        try c.encode(targetValue, forKey: .targetValue)
        try c.encode(rewardType, forKey: .rewardType)
        try c.encode(rewardValue, forKey: .rewardValue)
        try c.encode(startsAt, forKey: .startsAt)
        try c.encode(endsAt, forKey: .endsAt)
        try c.encode(isSeasonal, forKey: .isSeasonal)
        if let seasonName, !seasonName.isEmpty {
            try c.encode(seasonName, forKey: .seasonName)
        }
        if let maxParticipants {
            try c.encode(maxParticipants, forKey: .maxParticipants)
        }
    }

    private enum CodingKeys: String, CodingKey {
        case title
        case description
        case challengeType
        case targetValue
        case rewardType
        case rewardValue
        case startsAt
        case endsAt
        case isSeasonal
        case seasonName
        case maxParticipants
    }
}

// MARK: - Finalize deletion

struct AdminFinalizeDeletionResponse: Decodable, Sendable {
    var finalizedAt: String?
    var rowsAffected: [String: Int64]?
    var stripeCustomerOutcome: String?
    var stripeAccountOutcome: String?

    /// Flexible decode: `rows_affected` may be a map or omitted.
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        finalizedAt = try c.decodeIfPresent(String.self, forKey: .finalizedAt)
        stripeCustomerOutcome = try c.decodeIfPresent(String.self, forKey: .stripeCustomerOutcome)
        stripeAccountOutcome = try c.decodeIfPresent(String.self, forKey: .stripeAccountOutcome)
        if let map = try? c.decodeIfPresent([String: Int64].self, forKey: .rowsAffected) {
            rowsAffected = map
        } else {
            rowsAffected = nil
        }
    }

    private enum CodingKeys: String, CodingKey {
        case finalizedAt
        case rowsAffected
        case stripeCustomerOutcome
        case stripeAccountOutcome
    }
}

// MARK: - Guarantee claims models

struct AdminGuaranteeClaimsResponse: Decodable, Sendable {
    var guaranteeClaims: [AdminDisputeRow]

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        guaranteeClaims = try c.decodeIfPresent([AdminDisputeRow].self, forKey: .guaranteeClaims) ?? []
    }

    enum CodingKeys: String, CodingKey { case guaranteeClaims }
}

struct AdminGuaranteeClaimReviewResponse: Decodable, Sendable {
    var guaranteeClaim: AdminDisputeRow?
    var refundPaymentId: String?
    var refundAmountCents: Int64?
}

private struct ReviewAdminGuaranteeClaimBody: Encodable {
    var approved: Bool
    var resolutionNotes: String
    var payoutCents: Int64?

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(approved, forKey: .approved)
        try c.encode(resolutionNotes, forKey: .resolutionNotes)
        if let payoutCents {
            try c.encode(payoutCents, forKey: .payoutCents)
        }
    }

    private enum CodingKeys: String, CodingKey {
        case approved
        case resolutionNotes
        case payoutCents
    }
}

// MARK: - Verification queue models

struct AdminVerificationDocument: Decodable, Sendable, Hashable, Identifiable {
    var id: String
    var userId: String?
    var userEmail: String?
    var userDisplayName: String?
    var documentType: String?
    var status: String?
    var fileName: String?
    var fileUrl: String?
    var createdAt: String?

    var displayUser: String {
        let name = userDisplayName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !name.isEmpty { return name }
        let e = userEmail?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !e.isEmpty { return e }
        let uid = userId?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return uid.isEmpty ? id : String(uid.prefix(8)) + "…"
    }

    var displayType: String {
        let t = documentType?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return t.isEmpty ? "Document" : t.replacingOccurrences(of: "_", with: " ").capitalized
    }

    var displayStatus: String {
        StatusChipStyle.displayLabel(status ?? "pending")
    }
}

struct AdminVerificationQueueResponse: Decodable, Sendable {
    var documents: [AdminVerificationDocument]

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        documents = try c.decodeIfPresent([AdminVerificationDocument].self, forKey: .documents) ?? []
    }

    enum CodingKeys: String, CodingKey { case documents }
}

struct AdminVerificationReviewResponse: Decodable, Sendable {
    var status: String?
}

private struct ReviewAdminVerificationBody: Encodable {
    var approved: Bool
    var rejectionReason: String?

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(approved, forKey: .approved)
        if let rejectionReason, !rejectionReason.isEmpty {
            try c.encode(rejectionReason, forKey: .rejectionReason)
        }
    }

    private enum CodingKeys: String, CodingKey {
        case approved
        case rejectionReason
    }
}

// MARK: - Licenses models

struct AdminLicensesResponse: Decodable, Sendable {
    var licenses: [ProviderLicense]

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        licenses = try c.decodeIfPresent([ProviderLicense].self, forKey: .licenses) ?? []
    }

    enum CodingKeys: String, CodingKey { case licenses }
}

private struct ReviewAdminLicenseBody: Encodable {
    var status: String
}

// MARK: - Insurance claims admin models

struct AdminInsuranceClaimsResponse: Decodable, Sendable {
    var claims: [InsuranceClaim]

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        claims = try c.decodeIfPresent([InsuranceClaim].self, forKey: .claims) ?? []
    }

    enum CodingKeys: String, CodingKey { case claims }
}

private struct ReviewAdminInsuranceClaimBody: Encodable {
    var approved: Bool
    var approvedAmountCents: Int64?
    var assessorNotes: String?
    var denialReason: String?

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(approved, forKey: .approved)
        if let approvedAmountCents {
            try c.encode(approvedAmountCents, forKey: .approvedAmountCents)
        }
        if let assessorNotes, !assessorNotes.isEmpty {
            try c.encode(assessorNotes, forKey: .assessorNotes)
        }
        if let denialReason, !denialReason.isEmpty {
            try c.encode(denialReason, forKey: .denialReason)
        }
    }

    private enum CodingKeys: String, CodingKey {
        case approved
        case approvedAmountCents
        case assessorNotes
        case denialReason
    }
}

// MARK: - Flagged reviews models

struct AdminFlaggedReview: Decodable, Sendable, Hashable, Identifiable {
    var id: String
    var reviewId: String?
    var flaggedBy: String?
    var reason: String?
    var details: String?
    var status: String?
    var createdAt: String?
    var reviewContent: String?
    var reviewerName: String?
    var reviewRating: Int?

    var displayReason: String {
        let r = reason?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return r.isEmpty ? "flagged" : r.replacingOccurrences(of: "_", with: " ")
    }

    var displayStatus: String {
        StatusChipStyle.displayLabel(status ?? "pending")
    }

    var isPending: Bool {
        let s = (status ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return s.isEmpty || s == "pending"
    }

    var displaySnippet: String {
        let c = reviewContent?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if c.isEmpty { return "No review text." }
        if c.count <= 140 { return c }
        return String(c.prefix(140)) + "…"
    }
}

struct AdminFlaggedReviewsResponse: Decodable, Sendable {
    var flags: [AdminFlaggedReview]

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        if let f = try c.decodeIfPresent([AdminFlaggedReview].self, forKey: .flags) {
            flags = f
        } else if let f = try c.decodeIfPresent([AdminFlaggedReview].self, forKey: .flaggedReviews) {
            flags = f
        } else {
            flags = []
        }
    }

    enum CodingKeys: String, CodingKey {
        case flags
        case flaggedReviews
    }
}

struct AdminReviewFlagResolveResponse: Decodable, Sendable {
    var status: String?
}

private struct ResolveAdminReviewFlagBody: Encodable {
    var action: String
    var notes: String
}

struct AdminReviewRemoveResponse: Decodable, Sendable {
    var message: String?
}

private struct AdminReviewRemoveBody: Encodable {
    var reason: String
}
