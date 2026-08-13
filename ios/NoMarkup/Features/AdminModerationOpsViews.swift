import SwiftUI

// MARK: - Soft flag gate helper

private func softFlagMessage(key: String, detail: String) -> String {
    let cleaned = detail.trimmingCharacters(in: .whitespacesAndNewlines)
    if !cleaned.isEmpty, cleaned.lowercased() != "service temporarily unavailable" {
        return "\(cleaned) (flag: \(key))."
    }
    return "The \(key) feature flag is off or the rail is unavailable (HTTP 503). Enable the flag on the server and try again."
}

// MARK: - Guarantee claims (flag: nomarkup_guarantee)

/// Admin guarantee queue: approve/deny with notes + optional payout dollars→cents.
struct AdminGuaranteeOpsView: View {
    @Binding var forbidden: Bool
    @Binding var actionMessage: String?

    @State private var claims: [AdminDisputeRow] = []
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var flagOffMessage: String?
    @State private var busyIDs: Set<String> = []
    @State private var reviewTarget: AdminDisputeRow?
    @State private var approved = true
    @State private var notes = ""
    @State private var payoutDollars = ""
    @State private var showReviewSheet = false

    var body: some View {
        Group {
            if isLoading && claims.isEmpty && flagOffMessage == nil {
                BrandLoadingScreen(kind: .form, accessibilityLabel: "Loading guarantee claims…")
            } else if let flagOffMessage {
                BrandEmptyState(
                    title: "Guarantee unavailable",
                    systemImage: "shield.slash",
                    message: flagOffMessage,
                    actionTitle: "Try again"
                ) { Task { await load() } }
            } else if let errorMessage, claims.isEmpty {
                BrandEmptyState(
                    title: "Couldn’t load guarantee claims",
                    systemImage: "exclamationmark.triangle",
                    message: errorMessage,
                    actionTitle: "Try again"
                ) { Task { await load() } }
            } else {
                List {
                    if claims.isEmpty {
                        Text("No guarantee claims.")
                            .foregroundStyle(BrandTheme.textSecondary)
                            .listRowBackground(BrandTheme.navyElevated)
                    } else {
                        ForEach(claims) { claim in claimRow(claim) }
                    }
                }
                .brandListBackground()
            }
        }
        .sheet(isPresented: $showReviewSheet) { reviewSheet }
        .task { await load() }
        .refreshable { await load() }
        .accessibilityIdentifier("admin.guarantee.root")
    }

    @ViewBuilder
    private func claimRow(_ claim: AdminDisputeRow) -> some View {
        let busy = busyIDs.contains(claim.id)
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(claim.status ?? "open")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(BrandTheme.textPrimary)
                    if let t = claim.disputeType {
                        Text(t).font(.caption).foregroundStyle(BrandTheme.textSecondary)
                    }
                    if let d = claim.description, !d.isEmpty {
                        Text(d).font(.caption).foregroundStyle(BrandTheme.textSecondary).lineLimit(2)
                    }
                    if let cid = claim.contractId, !cid.isEmpty {
                        Text("Contract \(String(cid.prefix(8)))…")
                            .font(.caption2.monospaced())
                            .foregroundStyle(BrandTheme.textSecondary)
                    }
                    Text(String(claim.id.prefix(8)) + "…")
                        .font(.caption2.monospaced())
                        .foregroundStyle(BrandTheme.textSecondary)
                }
                Spacer(minLength: 8)
                if busy { ProgressView().controlSize(.small) }
            }
            if claim.isOpenForResolution {
                Button("Review") {
                    reviewTarget = claim
                    approved = true
                    notes = ""
                    payoutDollars = ""
                    showReviewSheet = true
                }
                .font(.caption.weight(.semibold))
                .disabled(busy)
                .frame(minHeight: 44)
                .accessibilityIdentifier("admin.guarantee.review.\(claim.id)")
            }
        }
        .listRowBackground(BrandTheme.navyElevated)
    }

    private var reviewSheet: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("Outcome", selection: $approved) {
                        Text("Approve").tag(true)
                        Text("Deny").tag(false)
                    }
                    .pickerStyle(.segmented)
                    .accessibilityIdentifier("admin.guarantee.approved")
                    TextField("Resolution notes (required)", text: $notes, axis: .vertical)
                        .lineLimit(3 ... 6)
                        .accessibilityIdentifier("admin.guarantee.notes")
                    if approved {
                        TextField("Payout dollars (optional)", text: $payoutDollars)
                            #if os(iOS)
                            .keyboardType(.decimalPad)
                            #endif
                            .accessibilityIdentifier("admin.guarantee.payout")
                    }
                } footer: {
                    Text("PUT /admin/guarantee-claims/{id}/review. Dollars → cents. Flag nomarkup_guarantee (503 when off).")
                }
            }
            .navigationTitle("Review claim")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { showReviewSheet = false }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Submit") { Task { await submitReview() } }
                        .disabled(
                            reviewTarget == nil
                                || notes.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                                || busyIDs.contains(reviewTarget?.id ?? "")
                        )
                        .accessibilityIdentifier("admin.guarantee.submit")
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    @MainActor
    private func submitReview() async {
        guard let target = reviewTarget else { return }
        guard !busyIDs.contains(target.id) else { return }
        let notesTrimmed = notes.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !notesTrimmed.isEmpty else {
            actionMessage = "Resolution notes are required."
            BrandHaptics.warning()
            return
        }
        var payoutCents: Int64?
        if approved {
            let raw = payoutDollars.trimmingCharacters(in: .whitespacesAndNewlines)
            if !raw.isEmpty {
                guard let dollars = Double(raw), dollars >= 0 else {
                    actionMessage = "Payout must be a non-negative dollar amount."
                    BrandHaptics.warning()
                    return
                }
                payoutCents = Int64((dollars * 100.0).rounded())
            }
        }
        busyIDs.insert(target.id)
        defer { busyIDs.remove(target.id) }
        do {
            let updated = try await APIClient.shared.reviewAdminGuaranteeClaim(
                id: target.id,
                approved: approved,
                resolutionNotes: notesTrimmed,
                payoutCents: payoutCents
            )
            if let idx = claims.firstIndex(where: { $0.id == target.id }) {
                claims[idx] = updated
            }
            showReviewSheet = false
            reviewTarget = nil
            actionMessage = approved ? "Guarantee claim approved." : "Guarantee claim denied."
            BrandHaptics.success()
            await load()
        } catch let error as APIClientError where error.isForbidden {
            showReviewSheet = false
            forbidden = true
            BrandHaptics.error()
        } catch let error as APIClientError where error.isServiceUnavailable {
            showReviewSheet = false
            flagOffMessage = softFlagMessage(key: "nomarkup_guarantee", detail: error.localizedDescription)
            BrandHaptics.warning()
        } catch {
            actionMessage = error.localizedDescription
            BrandHaptics.error()
        }
    }

    @MainActor
    private func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            claims = try await APIClient.shared.fetchAdminGuaranteeClaims().guaranteeClaims
            errorMessage = nil
            flagOffMessage = nil
        } catch let error as APIClientError {
            if error.isForbidden {
                forbidden = true
                errorMessage = nil
                flagOffMessage = nil
            } else if error.isServiceUnavailable {
                claims = []
                flagOffMessage = softFlagMessage(key: "nomarkup_guarantee", detail: error.localizedDescription)
                errorMessage = nil
                BrandHaptics.warning()
            } else if claims.isEmpty {
                errorMessage = error.localizedDescription
            } else {
                actionMessage = error.localizedDescription
                BrandHaptics.error()
            }
        } catch {
            if claims.isEmpty { errorMessage = error.localizedDescription }
            else { actionMessage = error.localizedDescription; BrandHaptics.error() }
        }
    }
}

// MARK: - Verification queue

struct AdminVerificationOpsView: View {
    @Binding var forbidden: Bool
    @Binding var actionMessage: String?

    @State private var documents: [AdminVerificationDocument] = []
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var busyIDs: Set<String> = []
    @State private var rejectTarget: AdminVerificationDocument?
    @State private var rejectionReason = ""
    @State private var showRejectSheet = false

    var body: some View {
        Group {
            if isLoading && documents.isEmpty {
                BrandLoadingScreen(kind: .form, accessibilityLabel: "Loading verification queue…")
            } else if let errorMessage, documents.isEmpty {
                BrandEmptyState(
                    title: "Couldn’t load verification queue",
                    systemImage: "exclamationmark.triangle",
                    message: errorMessage,
                    actionTitle: "Try again"
                ) { Task { await load() } }
            } else {
                List {
                    if documents.isEmpty {
                        Text("No pending verification documents.")
                            .foregroundStyle(BrandTheme.textSecondary)
                            .listRowBackground(BrandTheme.navyElevated)
                    } else {
                        ForEach(documents) { doc in docRow(doc) }
                    }
                }
                .brandListBackground()
            }
        }
        .sheet(isPresented: $showRejectSheet) { rejectSheet }
        .task { await load() }
        .refreshable { await load() }
        .accessibilityIdentifier("admin.verify.root")
    }

    @ViewBuilder
    private func docRow(_ doc: AdminVerificationDocument) -> some View {
        let busy = busyIDs.contains(doc.id)
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(doc.displayUser)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(BrandTheme.textPrimary)
                    Text(doc.displayType).font(.caption).foregroundStyle(BrandTheme.textSecondary)
                    Text(doc.displayStatus).font(.caption.weight(.semibold)).foregroundStyle(BrandTheme.textSecondary)
                    if let name = doc.fileName, !name.isEmpty {
                        Text(name).font(.caption2).foregroundStyle(BrandTheme.textSecondary).lineLimit(1)
                    }
                    Text(String(doc.id.prefix(8)) + "…")
                        .font(.caption2.monospaced())
                        .foregroundStyle(BrandTheme.textSecondary)
                }
                Spacer(minLength: 8)
                if busy { ProgressView().controlSize(.small) }
            }
            HStack(spacing: 8) {
                Button("Approve") { Task { await review(doc, approved: true) } }
                    .font(.caption.weight(.semibold))
                    .disabled(busy)
                    .frame(minHeight: 44)
                    .accessibilityIdentifier("admin.verification.approve.\(doc.id)")
                Button("Reject", role: .destructive) {
                    rejectTarget = doc
                    rejectionReason = ""
                    showRejectSheet = true
                }
                .font(.caption.weight(.semibold))
                .disabled(busy)
                .frame(minHeight: 44)
                .accessibilityIdentifier("admin.verification.reject.\(doc.id)")
            }
        }
        .listRowBackground(BrandTheme.navyElevated)
    }

    private var rejectSheet: some View {
        NavigationStack {
            Form {
                Section {
                    if let target = rejectTarget {
                        Text(target.displayUser).font(.subheadline.weight(.semibold))
                        Text(target.displayType).font(.caption).foregroundStyle(BrandTheme.textSecondary)
                    }
                    TextField("Rejection reason (required)", text: $rejectionReason, axis: .vertical)
                        .lineLimit(3 ... 6)
                        .accessibilityIdentifier("admin.verification.rejectionReason")
                } footer: {
                    Text("POST /admin/verification/{id}/review with approved=false.")
                }
            }
            .navigationTitle("Reject document")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { showRejectSheet = false }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Reject") {
                        Task {
                            guard let target = rejectTarget else { return }
                            await review(target, approved: false, reason: rejectionReason)
                        }
                    }
                    .disabled(
                        rejectTarget == nil
                            || rejectionReason.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                            || busyIDs.contains(rejectTarget?.id ?? "")
                    )
                    .accessibilityIdentifier("admin.verification.rejectSubmit")
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    @MainActor
    private func review(_ doc: AdminVerificationDocument, approved: Bool, reason: String = "") async {
        guard !busyIDs.contains(doc.id) else { return }
        let reasonTrimmed = reason.trimmingCharacters(in: .whitespacesAndNewlines)
        if !approved, reasonTrimmed.isEmpty {
            actionMessage = "Rejection reason is required."
            BrandHaptics.warning()
            return
        }
        busyIDs.insert(doc.id)
        defer { busyIDs.remove(doc.id) }
        do {
            _ = try await APIClient.shared.reviewAdminVerification(
                id: doc.id,
                approved: approved,
                rejectionReason: approved ? nil : reasonTrimmed
            )
            documents.removeAll { $0.id == doc.id }
            showRejectSheet = false
            rejectTarget = nil
            actionMessage = approved ? "Document approved." : "Document rejected."
            BrandHaptics.success()
        } catch let error as APIClientError where error.isForbidden {
            showRejectSheet = false
            forbidden = true
            BrandHaptics.error()
        } catch {
            actionMessage = error.localizedDescription
            BrandHaptics.error()
        }
    }

    @MainActor
    private func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            documents = try await APIClient.shared.fetchAdminVerificationQueue().documents
            errorMessage = nil
        } catch let error as APIClientError {
            if error.isForbidden {
                forbidden = true
                errorMessage = nil
            } else if documents.isEmpty {
                errorMessage = error.localizedDescription
            } else {
                actionMessage = error.localizedDescription
                BrandHaptics.error()
            }
        } catch {
            if documents.isEmpty { errorMessage = error.localizedDescription }
            else { actionMessage = error.localizedDescription; BrandHaptics.error() }
        }
    }
}

// MARK: - Licenses (flag: legal_services)

struct AdminLicensesOpsView: View {
    @Binding var forbidden: Bool
    @Binding var actionMessage: String?

    @State private var licenses: [ProviderLicense] = []
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var flagOffMessage: String?
    @State private var busyIDs: Set<String> = []

    var body: some View {
        Group {
            if isLoading && licenses.isEmpty && flagOffMessage == nil {
                BrandLoadingScreen(kind: .form, accessibilityLabel: "Loading licenses…")
            } else if let flagOffMessage {
                BrandEmptyState(
                    title: "Licenses unavailable",
                    systemImage: "scalemass",
                    message: flagOffMessage,
                    actionTitle: "Try again"
                ) { Task { await load() } }
            } else if let errorMessage, licenses.isEmpty {
                BrandEmptyState(
                    title: "Couldn’t load licenses",
                    systemImage: "exclamationmark.triangle",
                    message: errorMessage,
                    actionTitle: "Try again"
                ) { Task { await load() } }
            } else {
                List {
                    if licenses.isEmpty {
                        Text("No pending licenses.")
                            .foregroundStyle(BrandTheme.textSecondary)
                            .listRowBackground(BrandTheme.navyElevated)
                    } else {
                        ForEach(licenses) { license in licenseRow(license) }
                    }
                }
                .brandListBackground()
            }
        }
        .task { await load() }
        .refreshable { await load() }
        .accessibilityIdentifier("admin.licenses.root")
    }

    @ViewBuilder
    private func licenseRow(_ license: ProviderLicense) -> some View {
        let busy = busyIDs.contains(license.id)
        let status = (license.status ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(license.displayType)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(BrandTheme.textPrimary)
                    Text(license.displayStatus)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(BrandTheme.textSecondary)
                    Text("\(license.displayJurisdiction) · \(license.maskedNumber)")
                        .font(.caption)
                        .foregroundStyle(BrandTheme.textSecondary)
                    if let pid = license.providerId, !pid.isEmpty {
                        Text("Provider \(String(pid.prefix(8)))…")
                            .font(.caption2.monospaced())
                            .foregroundStyle(BrandTheme.textSecondary)
                    }
                }
                Spacer(minLength: 8)
                if busy { ProgressView().controlSize(.small) }
            }
            if status == "pending" || status.isEmpty {
                HStack(spacing: 8) {
                    Button("Verify") { Task { await review(license, status: "verified") } }
                        .font(.caption.weight(.semibold))
                        .disabled(busy)
                        .frame(minHeight: 44)
                        .accessibilityIdentifier("admin.license.verify.\(license.id)")
                    Button("Reject", role: .destructive) {
                        Task { await review(license, status: "rejected") }
                    }
                    .font(.caption.weight(.semibold))
                    .disabled(busy)
                    .frame(minHeight: 44)
                    .accessibilityIdentifier("admin.license.reject.\(license.id)")
                }
            }
        }
        .listRowBackground(BrandTheme.navyElevated)
    }

    @MainActor
    private func review(_ license: ProviderLicense, status: String) async {
        guard !busyIDs.contains(license.id) else { return }
        busyIDs.insert(license.id)
        defer { busyIDs.remove(license.id) }
        do {
            let updated = try await APIClient.shared.reviewAdminLicense(id: license.id, status: status)
            if let idx = licenses.firstIndex(where: { $0.id == license.id }) {
                licenses[idx] = updated
            }
            actionMessage = status == "verified" ? "License verified." : "License rejected."
            BrandHaptics.success()
            await load()
        } catch let error as APIClientError where error.isForbidden {
            forbidden = true
            BrandHaptics.error()
        } catch let error as APIClientError where error.isServiceUnavailable {
            flagOffMessage = softFlagMessage(key: "legal_services", detail: error.localizedDescription)
            BrandHaptics.warning()
        } catch {
            actionMessage = error.localizedDescription
            BrandHaptics.error()
        }
    }

    @MainActor
    private func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            licenses = try await APIClient.shared.fetchAdminLicenses(status: "pending").licenses
            errorMessage = nil
            flagOffMessage = nil
        } catch let error as APIClientError {
            if error.isForbidden {
                forbidden = true
                errorMessage = nil
                flagOffMessage = nil
            } else if error.isServiceUnavailable {
                licenses = []
                flagOffMessage = softFlagMessage(key: "legal_services", detail: error.localizedDescription)
                errorMessage = nil
                BrandHaptics.warning()
            } else if licenses.isEmpty {
                errorMessage = error.localizedDescription
            } else {
                actionMessage = error.localizedDescription
                BrandHaptics.error()
            }
        } catch {
            if licenses.isEmpty { errorMessage = error.localizedDescription }
            else { actionMessage = error.localizedDescription; BrandHaptics.error() }
        }
    }
}

// MARK: - Insurance claims (flag: per_job_insurance)

struct AdminInsuranceOpsView: View {
    @Binding var forbidden: Bool
    @Binding var actionMessage: String?

    @State private var claims: [InsuranceClaim] = []
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var flagOffMessage: String?
    @State private var busyIDs: Set<String> = []
    @State private var reviewTarget: InsuranceClaim?
    @State private var approved = true
    @State private var approvedDollars = ""
    @State private var assessorNotes = ""
    @State private var denialReason = ""
    @State private var showReviewSheet = false

    var body: some View {
        Group {
            if isLoading && claims.isEmpty && flagOffMessage == nil {
                BrandLoadingScreen(kind: .form, accessibilityLabel: "Loading insurance claims…")
            } else if let flagOffMessage {
                BrandEmptyState(
                    title: "Insurance claims unavailable",
                    systemImage: "umbrella",
                    message: flagOffMessage,
                    actionTitle: "Try again"
                ) { Task { await load() } }
            } else if let errorMessage, claims.isEmpty {
                BrandEmptyState(
                    title: "Couldn’t load insurance claims",
                    systemImage: "exclamationmark.triangle",
                    message: errorMessage,
                    actionTitle: "Try again"
                ) { Task { await load() } }
            } else {
                List {
                    if claims.isEmpty {
                        Text("No insurance claims.")
                            .foregroundStyle(BrandTheme.textSecondary)
                            .listRowBackground(BrandTheme.navyElevated)
                    } else {
                        ForEach(claims) { claim in claimRow(claim) }
                    }
                }
                .brandListBackground()
            }
        }
        .sheet(isPresented: $showReviewSheet) { reviewSheet }
        .task { await load() }
        .refreshable { await load() }
        .accessibilityIdentifier("admin.insurance.root")
    }

    @ViewBuilder
    private func claimRow(_ claim: InsuranceClaim) -> some View {
        let busy = busyIDs.contains(claim.id)
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(claim.displayClaimed)
                        .font(.subheadline.weight(.semibold).monospacedDigit())
                        .foregroundStyle(BrandTheme.goldBright)
                    Text(claim.displayStatus)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(BrandTheme.textSecondary)
                    if let t = claim.claimType, !t.isEmpty {
                        Text(t).font(.caption).foregroundStyle(BrandTheme.textSecondary)
                    }
                    if let d = claim.description, !d.isEmpty {
                        Text(d).font(.caption).foregroundStyle(BrandTheme.textSecondary).lineLimit(2)
                    }
                    Text(String(claim.id.prefix(8)) + "…")
                        .font(.caption2.monospaced())
                        .foregroundStyle(BrandTheme.textSecondary)
                }
                Spacer(minLength: 8)
                if busy { ProgressView().controlSize(.small) }
            }
            if claim.isOpenForReview {
                Button("Review") {
                    reviewTarget = claim
                    approved = true
                    approvedDollars = ""
                    assessorNotes = ""
                    denialReason = ""
                    showReviewSheet = true
                }
                .font(.caption.weight(.semibold))
                .disabled(busy)
                .frame(minHeight: 44)
                .accessibilityIdentifier("admin.insurance.review.\(claim.id)")
            }
        }
        .listRowBackground(BrandTheme.navyElevated)
    }

    private var reviewSheet: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("Outcome", selection: $approved) {
                        Text("Approve").tag(true)
                        Text("Deny").tag(false)
                    }
                    .pickerStyle(.segmented)
                    .accessibilityIdentifier("admin.insurance.approved")
                    if approved {
                        TextField("Approved amount (dollars)", text: $approvedDollars)
                            #if os(iOS)
                            .keyboardType(.decimalPad)
                            #endif
                            .accessibilityIdentifier("admin.insurance.approvedAmount")
                        TextField("Assessor notes", text: $assessorNotes, axis: .vertical)
                            .lineLimit(2 ... 5)
                            .accessibilityIdentifier("admin.insurance.assessorNotes")
                    } else {
                        TextField("Denial reason", text: $denialReason, axis: .vertical)
                            .lineLimit(2 ... 5)
                            .accessibilityIdentifier("admin.insurance.denialReason")
                    }
                } footer: {
                    Text("POST /admin/insurance/claims/{id}/review. Flag per_job_insurance (503 when off).")
                }
            }
            .navigationTitle("Review claim")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { showReviewSheet = false }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Submit") { Task { await submitReview() } }
                        .disabled(reviewTarget == nil || busyIDs.contains(reviewTarget?.id ?? ""))
                        .accessibilityIdentifier("admin.insurance.submit")
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    @MainActor
    private func submitReview() async {
        guard let target = reviewTarget else { return }
        guard !busyIDs.contains(target.id) else { return }
        var amountCents: Int64?
        if approved {
            let raw = approvedDollars.trimmingCharacters(in: .whitespacesAndNewlines)
            if !raw.isEmpty {
                guard let dollars = Double(raw), dollars >= 0 else {
                    actionMessage = "Approved amount must be a non-negative dollar value."
                    BrandHaptics.warning()
                    return
                }
                amountCents = Int64((dollars * 100.0).rounded())
            }
        }
        busyIDs.insert(target.id)
        defer { busyIDs.remove(target.id) }
        do {
            let updated = try await APIClient.shared.reviewAdminInsuranceClaim(
                id: target.id,
                approved: approved,
                approvedAmountCents: amountCents,
                assessorNotes: assessorNotes.isEmpty ? nil : assessorNotes,
                denialReason: approved ? nil : (denialReason.isEmpty ? nil : denialReason)
            )
            if let idx = claims.firstIndex(where: { $0.id == target.id }) {
                claims[idx] = updated
            }
            showReviewSheet = false
            reviewTarget = nil
            actionMessage = approved ? "Insurance claim approved." : "Insurance claim denied."
            BrandHaptics.success()
            await load()
        } catch let error as APIClientError where error.isForbidden {
            showReviewSheet = false
            forbidden = true
            BrandHaptics.error()
        } catch let error as APIClientError where error.isServiceUnavailable {
            showReviewSheet = false
            flagOffMessage = softFlagMessage(key: "per_job_insurance", detail: error.localizedDescription)
            BrandHaptics.warning()
        } catch {
            actionMessage = error.localizedDescription
            BrandHaptics.error()
        }
    }

    @MainActor
    private func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            claims = try await APIClient.shared.fetchAdminInsuranceClaims().claims
            errorMessage = nil
            flagOffMessage = nil
        } catch let error as APIClientError {
            if error.isForbidden {
                forbidden = true
                errorMessage = nil
                flagOffMessage = nil
            } else if error.isServiceUnavailable {
                claims = []
                flagOffMessage = softFlagMessage(key: "per_job_insurance", detail: error.localizedDescription)
                errorMessage = nil
                BrandHaptics.warning()
            } else if claims.isEmpty {
                errorMessage = error.localizedDescription
            } else {
                actionMessage = error.localizedDescription
                BrandHaptics.error()
            }
        } catch {
            if claims.isEmpty { errorMessage = error.localizedDescription }
            else { actionMessage = error.localizedDescription; BrandHaptics.error() }
        }
    }
}

// MARK: - Flagged reviews

struct AdminFlaggedReviewsOpsView: View {
    @Binding var forbidden: Bool
    @Binding var actionMessage: String?

    @State private var flags: [AdminFlaggedReview] = []
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var busyFlagIDs: Set<String> = []
    @State private var busyReviewIDs: Set<String> = []
    @State private var resolveTarget: AdminFlaggedReview?
    @State private var resolveAction = "dismiss"
    @State private var resolveNotes = ""
    @State private var showResolveSheet = false
    @State private var removeTarget: AdminFlaggedReview?
    @State private var removeReason = ""
    @State private var showRemoveSheet = false

    var body: some View {
        Group {
            if isLoading && flags.isEmpty {
                BrandLoadingScreen(kind: .form, accessibilityLabel: "Loading flagged reviews…")
            } else if let errorMessage, flags.isEmpty {
                BrandEmptyState(
                    title: "Couldn’t load flagged reviews",
                    systemImage: "exclamationmark.triangle",
                    message: errorMessage,
                    actionTitle: "Try again"
                ) { Task { await load() } }
            } else {
                List {
                    if flags.isEmpty {
                        Text("No flagged reviews.")
                            .foregroundStyle(BrandTheme.textSecondary)
                            .listRowBackground(BrandTheme.navyElevated)
                    } else {
                        ForEach(flags) { flag in flagRow(flag) }
                    }
                }
                .brandListBackground()
            }
        }
        .sheet(isPresented: $showResolveSheet) { resolveSheet }
        .sheet(isPresented: $showRemoveSheet) { removeSheet }
        .task { await load() }
        .refreshable { await load() }
        .accessibilityIdentifier("admin.reviews.root")
    }

    @ViewBuilder
    private func flagRow(_ flag: AdminFlaggedReview) -> some View {
        let busy = busyFlagIDs.contains(flag.id)
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(flag.displayReason)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(BrandTheme.textPrimary)
                    Text(flag.displayStatus)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(BrandTheme.textSecondary)
                    Text(flag.displaySnippet)
                        .font(.caption)
                        .foregroundStyle(BrandTheme.textSecondary)
                        .lineLimit(3)
                    if let rating = flag.reviewRating {
                        Text("Rating \(rating)").font(.caption2).foregroundStyle(BrandTheme.textSecondary)
                    }
                    Text("Flag \(String(flag.id.prefix(8)))…")
                        .font(.caption2.monospaced())
                        .foregroundStyle(BrandTheme.textSecondary)
                }
                Spacer(minLength: 8)
                if busy { ProgressView().controlSize(.small) }
            }
            if flag.isPending {
                HStack(spacing: 8) {
                    Button("Uphold") {
                        resolveTarget = flag
                        resolveAction = "uphold"
                        resolveNotes = ""
                        showResolveSheet = true
                    }
                    .font(.caption.weight(.semibold))
                    .disabled(busy)
                    .frame(minHeight: 44)
                    .accessibilityIdentifier("admin.review.uphold.\(flag.id)")
                    Button("Dismiss") {
                        resolveTarget = flag
                        resolveAction = "dismiss"
                        resolveNotes = ""
                        showResolveSheet = true
                    }
                    .font(.caption.weight(.semibold))
                    .disabled(busy)
                    .frame(minHeight: 44)
                    .accessibilityIdentifier("admin.review.dismiss.\(flag.id)")
                    if let reviewId = flag.reviewId, !reviewId.isEmpty {
                        Button("Remove review", role: .destructive) {
                            removeTarget = flag
                            removeReason = ""
                            showRemoveSheet = true
                        }
                        .font(.caption.weight(.semibold))
                        .disabled(busy || busyReviewIDs.contains(reviewId))
                        .frame(minHeight: 44)
                        .accessibilityIdentifier("admin.review.remove.\(flag.id)")
                    }
                }
            }
        }
        .listRowBackground(BrandTheme.navyElevated)
    }

    private var resolveSheet: some View {
        NavigationStack {
            Form {
                Section {
                    Text(resolveAction == "uphold" ? "Uphold flag" : "Dismiss flag")
                        .font(.subheadline.weight(.semibold))
                    TextField("Notes (optional)", text: $resolveNotes, axis: .vertical)
                        .lineLimit(2 ... 5)
                        .accessibilityIdentifier("admin.review.resolveNotes")
                } footer: {
                    Text("POST /admin/reviews/flags/{id}/resolve with action=\(resolveAction).")
                }
            }
            .navigationTitle("Resolve flag")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { showResolveSheet = false }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Submit") { Task { await submitResolve() } }
                        .disabled(resolveTarget == nil || busyFlagIDs.contains(resolveTarget?.id ?? ""))
                        .accessibilityIdentifier("admin.review.resolveSubmit")
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private var removeSheet: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Reason (required)", text: $removeReason, axis: .vertical)
                        .lineLimit(3 ... 6)
                        .accessibilityIdentifier("admin.review.removeReason")
                } footer: {
                    Text("DELETE /admin/reviews/{id} with reason.")
                }
            }
            .navigationTitle("Remove review")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { showRemoveSheet = false }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Remove", role: .destructive) { Task { await submitRemove() } }
                        .disabled(
                            removeTarget?.reviewId == nil
                                || removeReason.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                                || busyReviewIDs.contains(removeTarget?.reviewId ?? "")
                        )
                        .accessibilityIdentifier("admin.review.removeSubmit")
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    @MainActor
    private func submitResolve() async {
        guard let target = resolveTarget else { return }
        guard !busyFlagIDs.contains(target.id) else { return }
        busyFlagIDs.insert(target.id)
        defer { busyFlagIDs.remove(target.id) }
        do {
            let result = try await APIClient.shared.resolveAdminReviewFlag(
                id: target.id,
                action: resolveAction,
                notes: resolveNotes
            )
            if let idx = flags.firstIndex(where: { $0.id == target.id }) {
                flags[idx].status = result.status ?? resolveAction
            }
            showResolveSheet = false
            resolveTarget = nil
            actionMessage = resolveAction == "uphold" ? "Flag upheld." : "Flag dismissed."
            BrandHaptics.success()
            await load()
        } catch let error as APIClientError where error.isForbidden {
            showResolveSheet = false
            forbidden = true
            BrandHaptics.error()
        } catch {
            actionMessage = error.localizedDescription
            BrandHaptics.error()
        }
    }

    @MainActor
    private func submitRemove() async {
        guard let target = removeTarget, let reviewId = target.reviewId, !reviewId.isEmpty else { return }
        guard !busyReviewIDs.contains(reviewId) else { return }
        let reason = removeReason.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !reason.isEmpty else {
            actionMessage = "Reason is required."
            BrandHaptics.warning()
            return
        }
        busyReviewIDs.insert(reviewId)
        defer { busyReviewIDs.remove(reviewId) }
        do {
            _ = try await APIClient.shared.removeAdminReview(id: reviewId, reason: reason)
            flags.removeAll { $0.reviewId == reviewId }
            showRemoveSheet = false
            removeTarget = nil
            actionMessage = "Review removed."
            BrandHaptics.success()
            await load()
        } catch let error as APIClientError where error.isForbidden {
            showRemoveSheet = false
            forbidden = true
            BrandHaptics.error()
        } catch {
            actionMessage = error.localizedDescription
            BrandHaptics.error()
        }
    }

    @MainActor
    private func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            flags = try await APIClient.shared.fetchAdminFlaggedReviews(status: "pending").flags
            errorMessage = nil
        } catch let error as APIClientError {
            if error.isForbidden {
                forbidden = true
                errorMessage = nil
            } else if flags.isEmpty {
                errorMessage = error.localizedDescription
            } else {
                actionMessage = error.localizedDescription
                BrandHaptics.error()
            }
        } catch {
            if flags.isEmpty { errorMessage = error.localizedDescription }
            else { actionMessage = error.localizedDescription; BrandHaptics.error() }
        }
    }
}

// MARK: - Fees / Banking / Platform (complete admin ops)

struct AdminFeesView: View {
    var embedded: Bool = false
    @Binding var forbidden: Bool
    @Binding var actionMessage: String?

    @State private var feePercentText = ""
    @State private var guaranteePercentText = ""
    @State private var minFeeDollars = ""
    @State private var maxFeeDollars = ""
    @State private var leadGenEnabled = false
    @State private var leadGenPercentText = ""
    @State private var leadGenMinDollars = ""
    @State private var leadGenMaxDollars = ""
    @State private var revenue: AdminRevenueReport?
    @State private var recentPayments: [AdminPaymentRow] = []
    @State private var isLoading = false
    @State private var isSaving = false
    @State private var errorMessage: String?
    @State private var hasLoaded = false

    init(
        embedded: Bool = false,
        forbidden: Binding<Bool> = .constant(false),
        actionMessage: Binding<String?> = .constant(nil)
    ) {
        self.embedded = embedded
        self._forbidden = forbidden
        self._actionMessage = actionMessage
    }

    var body: some View {
        Group {
            if isLoading && !hasLoaded {
                BrandLoadingScreen(kind: .form, accessibilityLabel: "Loading fee configuration…")
            } else if let errorMessage, !hasLoaded {
                BrandEmptyState(
                    title: "Couldn’t load fees",
                    systemImage: "exclamationmark.triangle",
                    message: errorMessage,
                    actionTitle: "Try again"
                ) { Task { await load() } }
            } else {
                Form {
                    Section {
                        HStack {
                            Text("Platform fee %")
                            Spacer()
                            TextField("0–100", text: $feePercentText)
                                #if os(iOS)
                                .keyboardType(.decimalPad)
                                #endif
                                .multilineTextAlignment(.trailing)
                                .frame(maxWidth: 96)
                                .accessibilityIdentifier("admin.fees.feePct")
                        }
                        .listRowBackground(BrandTheme.navyElevated)
                        .frame(minHeight: 44)
                        HStack {
                            Text("Guarantee %")
                            Spacer()
                            TextField("0–100", text: $guaranteePercentText)
                                #if os(iOS)
                                .keyboardType(.decimalPad)
                                #endif
                                .multilineTextAlignment(.trailing)
                                .frame(maxWidth: 96)
                                .accessibilityIdentifier("admin.fees.guaranteePct")
                        }
                        .listRowBackground(BrandTheme.navyElevated)
                        .frame(minHeight: 44)
                        HStack {
                            Text("Min fee (USD)")
                            Spacer()
                            TextField("0.00", text: $minFeeDollars)
                                #if os(iOS)
                                .keyboardType(.decimalPad)
                                #endif
                                .multilineTextAlignment(.trailing)
                                .frame(maxWidth: 96)
                                .accessibilityIdentifier("admin.fees.minFee")
                        }
                        .listRowBackground(BrandTheme.navyElevated)
                        .frame(minHeight: 44)
                        HStack {
                            Text("Max fee (USD, optional)")
                            Spacer()
                            TextField("0.00", text: $maxFeeDollars)
                                #if os(iOS)
                                .keyboardType(.decimalPad)
                                #endif
                                .multilineTextAlignment(.trailing)
                                .frame(maxWidth: 96)
                                .accessibilityIdentifier("admin.fees.maxFee")
                        }
                        .listRowBackground(BrandTheme.navyElevated)
                        .frame(minHeight: 44)
                    } header: {
                        Text("Platform fees").brandSectionHeader()
                    } footer: {
                        Text("Percents are whole numbers (8 = 8%). API stores 0…1 fractions; money is integer cents.")
                            .font(.caption2)
                    }

                    Section {
                        Toggle("Lead-gen fee enabled", isOn: $leadGenEnabled)
                            .tint(BrandTheme.gold)
                            .accessibilityIdentifier("admin.fees.leadGenEnabled")
                        HStack {
                            Text("Lead-gen %")
                            Spacer()
                            TextField("0–100", text: $leadGenPercentText)
                                #if os(iOS)
                                .keyboardType(.decimalPad)
                                #endif
                                .multilineTextAlignment(.trailing)
                                .frame(maxWidth: 96)
                                .disabled(!leadGenEnabled)
                                .accessibilityIdentifier("admin.fees.leadGenPct")
                        }
                        .listRowBackground(BrandTheme.navyElevated)
                        .frame(minHeight: 44)
                        HStack {
                            Text("Lead-gen min (USD)")
                            Spacer()
                            TextField("0.00", text: $leadGenMinDollars)
                                #if os(iOS)
                                .keyboardType(.decimalPad)
                                #endif
                                .multilineTextAlignment(.trailing)
                                .frame(maxWidth: 96)
                                .disabled(!leadGenEnabled)
                                .accessibilityIdentifier("admin.fees.leadGenMin")
                        }
                        .listRowBackground(BrandTheme.navyElevated)
                        .frame(minHeight: 44)
                        HStack {
                            Text("Lead-gen max (USD, optional)")
                            Spacer()
                            TextField("0.00", text: $leadGenMaxDollars)
                                #if os(iOS)
                                .keyboardType(.decimalPad)
                                #endif
                                .multilineTextAlignment(.trailing)
                                .frame(maxWidth: 96)
                                .disabled(!leadGenEnabled)
                                .accessibilityIdentifier("admin.fees.leadGenMax")
                        }
                        .listRowBackground(BrandTheme.navyElevated)
                        .frame(minHeight: 44)
                    } header: {
                        Text("Lead generation").brandSectionHeader()
                    } footer: {
                        Text("Requires the lead_gen feature flag ON to enable.")
                            .font(.caption2)
                    }

                    Section {
                        Button {
                            Task { await save() }
                        } label: {
                            if isSaving {
                                ProgressView().frame(maxWidth: .infinity)
                            } else {
                                Text("Save fee config")
                                    .font(.subheadline.weight(.semibold))
                                    .frame(maxWidth: .infinity)
                            }
                        }
                        .disabled(isSaving)
                        .frame(minHeight: 44)
                        .listRowBackground(BrandTheme.gold.opacity(0.2))
                        .accessibilityIdentifier("admin.fees.save")
                    }

                    if let revenue, !revenue.displayRows.isEmpty {
                        Section {
                            ForEach(revenue.displayRows, id: \.key) { row in
                                HStack {
                                    Text(row.key).font(.caption.monospaced()).foregroundStyle(BrandTheme.textSecondary)
                                    Spacer()
                                    Text(row.value).font(.caption.monospacedDigit().weight(.semibold))
                                }
                                .listRowBackground(BrandTheme.navyElevated)
                                .frame(minHeight: 44)
                            }
                        } header: {
                            Text("Revenue").brandSectionHeader()
                        }
                    }

                    if !recentPayments.isEmpty {
                        Section {
                            ForEach(recentPayments) { payment in
                                VStack(alignment: .leading, spacing: 4) {
                                    HStack {
                                        Text(payment.displayAmount)
                                            .font(.subheadline.weight(.semibold).monospacedDigit())
                                            .foregroundStyle(BrandTheme.goldBright)
                                        Spacer()
                                        Text(payment.displayStatus)
                                            .font(.caption)
                                            .foregroundStyle(BrandTheme.textSecondary)
                                    }
                                    Text(String(payment.id.prefix(12)) + "…")
                                        .font(.caption2.monospaced())
                                        .foregroundStyle(BrandTheme.textSecondary)
                                }
                                .listRowBackground(BrandTheme.navyElevated)
                                .frame(minHeight: 44)
                            }
                        } header: {
                            Text("Recent payments").brandSectionHeader()
                        }
                    }
                }
                .brandListBackground()
            }
        }
        .task { await load() }
        .refreshable { await load() }
        .accessibilityIdentifier("admin.fees.root")
    }

    private func applyConfig(_ config: AdminFeeConfig) {
        feePercentText = AdminFeeConfig.percentDisplay(fromFraction: config.feePercentage)
        guaranteePercentText = AdminFeeConfig.percentDisplay(fromFraction: config.guaranteePercentage)
        minFeeDollars = dollarsText(cents: config.minFeeCents)
        maxFeeDollars = optionalDollarsText(cents: config.maxFeeCents)
        leadGenEnabled = config.leadGenEnabled == true
        leadGenPercentText = AdminFeeConfig.percentDisplay(fromFraction: config.leadGenPercentage)
        leadGenMinDollars = dollarsText(cents: config.leadGenMinFeeCents)
        leadGenMaxDollars = optionalDollarsText(cents: config.leadGenMaxFeeCents)
    }

    private func dollarsText(cents: Int64?) -> String {
        guard let cents, cents > 0 else { return "" }
        return "\(Decimal(cents) / 100)"
    }

    private func optionalDollarsText(cents: Int64?) -> String {
        guard let cents, cents > 0 else { return "" }
        return dollarsText(cents: cents)
    }

    @MainActor
    private func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            async let configTask = APIClient.shared.fetchAdminFeeConfig()
            async let revenueTask = APIClient.shared.fetchAdminRevenue()
            async let paymentsTask = APIClient.shared.fetchAdminPayments(page: 1, pageSize: 20)
            applyConfig(try await configTask)
            revenue = try? await revenueTask
            recentPayments = (try? await paymentsTask)?.payments ?? []
            forbidden = false
            errorMessage = nil
            hasLoaded = true
        } catch let error as APIClientError where error.isForbidden {
            forbidden = true
            errorMessage = nil
        } catch {
            if !hasLoaded { errorMessage = error.localizedDescription }
            else { actionMessage = error.localizedDescription }
            BrandHaptics.error()
        }
    }

    @MainActor
    private func save() async {
        guard !isSaving else { return }
        guard let feePct = AdminFeeConfig.fraction(fromPercentText: feePercentText) else {
            actionMessage = "Platform fee % must be 0–100."
            BrandHaptics.warning()
            return
        }
        guard let guaranteePct = AdminFeeConfig.fraction(fromPercentText: guaranteePercentText) else {
            actionMessage = "Guarantee % must be 0–100."
            BrandHaptics.warning()
            return
        }
        guard let minCents = AdminFeeConfig.centsAllowingZero(fromDollarsText: minFeeDollars) else {
            actionMessage = "Min fee must be a valid dollar amount (or empty for $0)."
            BrandHaptics.warning()
            return
        }
        let maxTrimmed = maxFeeDollars.trimmingCharacters(in: .whitespacesAndNewlines)
        let maxCents: Int64?
        if maxTrimmed.isEmpty {
            maxCents = nil
        } else if let parsed = AdminFeeConfig.centsAllowingZero(fromDollarsText: maxTrimmed) {
            maxCents = parsed
        } else {
            actionMessage = "Max fee must be a valid dollar amount."
            BrandHaptics.warning()
            return
        }

        let leadPct: Double
        let leadMin: Int64
        let leadMax: Int64?
        if leadGenEnabled {
            guard let lp = AdminFeeConfig.fraction(fromPercentText: leadGenPercentText) else {
                actionMessage = "Lead-gen % must be 0–100 when enabled."
                BrandHaptics.warning()
                return
            }
            guard let lm = AdminFeeConfig.centsAllowingZero(fromDollarsText: leadGenMinDollars) else {
                actionMessage = "Lead-gen min fee must be a valid dollar amount."
                BrandHaptics.warning()
                return
            }
            let lmaxTrim = leadGenMaxDollars.trimmingCharacters(in: .whitespacesAndNewlines)
            if lmaxTrim.isEmpty {
                leadMax = nil
            } else if let parsed = AdminFeeConfig.centsAllowingZero(fromDollarsText: lmaxTrim) {
                leadMax = parsed
            } else {
                actionMessage = "Lead-gen max fee must be a valid dollar amount."
                BrandHaptics.warning()
                return
            }
            leadPct = lp
            leadMin = lm
        } else {
            leadPct = AdminFeeConfig.fraction(fromPercentText: leadGenPercentText) ?? 0
            leadMin = AdminFeeConfig.centsAllowingZero(fromDollarsText: leadGenMinDollars) ?? 0
            let lmaxTrim = leadGenMaxDollars.trimmingCharacters(in: .whitespacesAndNewlines)
            leadMax = lmaxTrim.isEmpty ? nil : AdminFeeConfig.centsAllowingZero(fromDollarsText: lmaxTrim)
        }

        isSaving = true
        defer { isSaving = false }
        do {
            let body = AdminFeeConfigUpdateBody(
                feePercentage: feePct,
                guaranteePercentage: guaranteePct,
                minFeeCents: minCents,
                maxFeeCents: maxCents,
                leadGenEnabled: leadGenEnabled,
                leadGenPercentage: leadPct,
                leadGenMinFeeCents: leadMin,
                leadGenMaxFeeCents: leadMax,
                categoryId: nil
            )
            applyConfig(try await APIClient.shared.updateAdminFeeConfig(body))
            actionMessage = "Fee configuration saved."
            BrandHaptics.success()
        } catch let error as APIClientError where error.isForbidden {
            forbidden = true
            BrandHaptics.error()
        } catch {
            actionMessage = error.localizedDescription
            BrandHaptics.error()
        }
    }
}

struct AdminBankingView: View {
    var embedded: Bool = false
    @Binding var forbidden: Bool
    @Binding var actionMessage: String?

    @State private var account: AdminPlatformBankAccount?
    @State private var tokenText = ""
    @State private var holderName = ""
    @State private var holderType = "individual"
    @State private var isLoading = false
    @State private var isSaving = false
    @State private var isDeleting = false
    @State private var errorMessage: String?
    @State private var hasLoaded = false
    @State private var showDeleteConfirm = false

    private let holderTypes = ["individual", "company"]

    init(
        embedded: Bool = false,
        forbidden: Binding<Bool> = .constant(false),
        actionMessage: Binding<String?> = .constant(nil)
    ) {
        self.embedded = embedded
        self._forbidden = forbidden
        self._actionMessage = actionMessage
    }

    var body: some View {
        Group {
            if isLoading && !hasLoaded {
                BrandLoadingScreen(kind: .form, accessibilityLabel: "Loading platform banking…")
            } else if let errorMessage, !hasLoaded {
                BrandEmptyState(
                    title: "Couldn’t load banking",
                    systemImage: "exclamationmark.triangle",
                    message: errorMessage,
                    actionTitle: "Try again"
                ) { Task { await load() } }
            } else {
                Form {
                    Section {
                        if let account {
                            VStack(alignment: .leading, spacing: 8) {
                                Text(account.displayTitle)
                                    .font(.subheadline.weight(.semibold))
                                Text("Last4 \(account.last4 ?? "—")")
                                    .font(.caption.monospaced())
                                    .foregroundStyle(BrandTheme.goldBright)
                                if let routing = account.routingLast4, !routing.isEmpty {
                                    Text("Routing last4 \(routing)")
                                        .font(.caption2.monospaced())
                                        .foregroundStyle(BrandTheme.textSecondary)
                                }
                                if let holder = account.accountHolderName, !holder.isEmpty {
                                    Text(holder).font(.caption).foregroundStyle(BrandTheme.textSecondary)
                                }
                            }
                            .listRowBackground(BrandTheme.navyElevated)
                            .frame(minHeight: 44)
                            .accessibilityIdentifier("admin.banking.current")
                            Button(role: .destructive) { showDeleteConfirm = true } label: {
                                if isDeleting { ProgressView() } else { Text("Remove bank account") }
                            }
                            .disabled(isDeleting || isSaving)
                            .frame(minHeight: 44)
                            .listRowBackground(BrandTheme.navyElevated)
                            .accessibilityIdentifier("admin.banking.delete")
                        } else {
                            Text("No platform bank set. Add a Stripe bank-account token (btok_…).")
                                .font(.caption)
                                .foregroundStyle(BrandTheme.textSecondary)
                                .listRowBackground(BrandTheme.navyElevated)
                        }
                    } header: {
                        Text("Current account").brandSectionHeader()
                    }

                    Section {
                        TextField("Stripe bank_account_token (btok_…)", text: $tokenText)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .font(.caption.monospaced())
                            .listRowBackground(BrandTheme.navyElevated)
                            .accessibilityIdentifier("admin.banking.token")
                        TextField("Account holder name", text: $holderName)
                            .listRowBackground(BrandTheme.navyElevated)
                            .accessibilityIdentifier("admin.banking.holderName")
                        Picker("Holder type", selection: $holderType) {
                            ForEach(holderTypes, id: \.self) { Text($0.capitalized).tag($0) }
                        }
                        .listRowBackground(BrandTheme.navyElevated)
                        .accessibilityIdentifier("admin.banking.holderType")
                        Button {
                            Task { await save() }
                        } label: {
                            if isSaving {
                                ProgressView().frame(maxWidth: .infinity)
                            } else {
                                Text(account == nil ? "Set bank account" : "Replace bank account")
                                    .font(.subheadline.weight(.semibold))
                                    .frame(maxWidth: .infinity)
                            }
                        }
                        .disabled(isSaving || isDeleting || tokenText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                        .frame(minHeight: 44)
                        .listRowBackground(BrandTheme.gold.opacity(0.2))
                        .accessibilityIdentifier("admin.banking.save")
                    } header: {
                        Text("Set account").brandSectionHeader()
                    } footer: {
                        Text("Only the btok_… token is sent. Idempotency-Key is attached automatically.")
                            .font(.caption2)
                    }
                }
                .brandListBackground()
            }
        }
        .confirmationDialog(
            "Remove platform bank account?",
            isPresented: $showDeleteConfirm,
            titleVisibility: .visible
        ) {
            Button("Delete account", role: .destructive) { Task { await deleteAccount() } }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Platform fee payouts will stop routing until a new account is set.")
        }
        .task { await load() }
        .refreshable { await load() }
        .accessibilityIdentifier("admin.banking.root")
    }

    @MainActor
    private func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            let response = try await APIClient.shared.fetchAdminBanking()
            account = response.account
            if let name = response.account?.accountHolderName, holderName.isEmpty { holderName = name }
            if let type = response.account?.accountHolderType, holderTypes.contains(type.lowercased()) {
                holderType = type.lowercased()
            }
            forbidden = false
            errorMessage = nil
            hasLoaded = true
        } catch let error as APIClientError where error.isForbidden {
            forbidden = true
            errorMessage = nil
        } catch {
            if !hasLoaded { errorMessage = error.localizedDescription }
            else { actionMessage = error.localizedDescription }
            BrandHaptics.error()
        }
    }

    @MainActor
    private func save() async {
        guard !isSaving else { return }
        let token = tokenText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !token.isEmpty else {
            actionMessage = "Bank account token is required."
            BrandHaptics.warning()
            return
        }
        isSaving = true
        defer { isSaving = false }
        do {
            let updated = try await APIClient.shared.setAdminBanking(
                bankAccountToken: token,
                accountHolderName: holderName,
                accountHolderType: holderType
            )
            account = updated
            tokenText = ""
            actionMessage = "Platform bank account saved (\(updated.displayLast4))."
            BrandHaptics.success()
        } catch let error as APIClientError where error.isForbidden {
            forbidden = true
            BrandHaptics.error()
        } catch {
            actionMessage = error.localizedDescription
            BrandHaptics.error()
        }
    }

    @MainActor
    private func deleteAccount() async {
        guard let id = account?.id, !isDeleting else { return }
        isDeleting = true
        defer { isDeleting = false }
        do {
            _ = try await APIClient.shared.deleteAdminBanking(id: id)
            account = nil
            actionMessage = "Platform bank account removed."
            BrandHaptics.success()
        } catch let error as APIClientError where error.isForbidden {
            forbidden = true
            BrandHaptics.error()
        } catch {
            actionMessage = error.localizedDescription
            BrandHaptics.error()
        }
    }
}

struct AdminPlatformMetricsView: View {
    var embedded: Bool = false
    @Binding var forbidden: Bool
    @Binding var actionMessage: String?

    @State private var metrics: AdminPlatformMetrics?
    @State private var growth: AdminGrowthMetrics?
    @State private var subscriptions: [AdminSubscriptionRow] = []
    @State private var totalMrrCents: Int64?
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var hasLoaded = false

    init(
        embedded: Bool = false,
        forbidden: Binding<Bool> = .constant(false),
        actionMessage: Binding<String?> = .constant(nil)
    ) {
        self.embedded = embedded
        self._forbidden = forbidden
        self._actionMessage = actionMessage
    }

    var body: some View {
        Group {
            if isLoading && !hasLoaded {
                BrandLoadingScreen(kind: .form, accessibilityLabel: "Loading platform metrics…")
            } else if let errorMessage, !hasLoaded {
                BrandEmptyState(
                    title: "Couldn’t load metrics",
                    systemImage: "exclamationmark.triangle",
                    message: errorMessage,
                    actionTitle: "Try again"
                ) { Task { await load() } }
            } else {
                List {
                    if let metrics {
                        Section {
                            ForEach(metrics.displayRows, id: \.key) { row in
                                HStack {
                                    Text(row.key).font(.caption.monospaced()).foregroundStyle(BrandTheme.textSecondary)
                                    Spacer()
                                    Text(row.value).font(.caption.monospacedDigit().weight(.semibold))
                                }
                                .listRowBackground(BrandTheme.navyElevated)
                                .frame(minHeight: 44)
                            }
                        } header: {
                            Text("Metrics").brandSectionHeader()
                        }
                    }
                    if let growth {
                        Section {
                            ForEach(growth.summaryRows, id: \.key) { row in
                                HStack {
                                    Text(row.key).font(.caption.monospaced()).foregroundStyle(BrandTheme.textSecondary)
                                    Spacer()
                                    Text(row.value).font(.caption.monospacedDigit().weight(.semibold))
                                }
                                .listRowBackground(BrandTheme.navyElevated)
                                .frame(minHeight: 44)
                            }
                            if let points = growth.dataPoints {
                                ForEach(points.prefix(12)) { point in
                                    VStack(alignment: .leading, spacing: 4) {
                                        Text(point.periodStart ?? "period")
                                            .font(.caption.monospaced())
                                        Text(
                                            "users=\(point.newUsers ?? 0) providers=\(point.newProviders ?? 0) jobs=\(point.jobsPosted ?? 0)/\(point.jobsCompleted ?? 0) gmv=\(MoneyFormat.usd(cents: point.gmvCents ?? 0)) rev=\(MoneyFormat.usd(cents: point.revenueCents ?? 0))"
                                        )
                                        .font(.caption2.monospaced())
                                        .foregroundStyle(BrandTheme.textSecondary)
                                    }
                                    .listRowBackground(BrandTheme.navyElevated)
                                }
                            }
                        } header: {
                            Text("Growth").brandSectionHeader()
                        }
                    }
                    Section {
                        if let mrr = totalMrrCents {
                            HStack {
                                Text("total_mrr_cents").font(.caption.monospaced()).foregroundStyle(BrandTheme.textSecondary)
                                Spacer()
                                Text(MoneyFormat.usd(cents: mrr)).font(.caption.monospacedDigit().weight(.semibold))
                            }
                            .listRowBackground(BrandTheme.navyElevated)
                            .frame(minHeight: 44)
                        }
                        if subscriptions.isEmpty {
                            Text("No subscriptions.")
                                .font(.caption)
                                .foregroundStyle(BrandTheme.textSecondary)
                                .listRowBackground(BrandTheme.navyElevated)
                        } else {
                            ForEach(subscriptions) { sub in
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(sub.status ?? "unknown").font(.subheadline.weight(.semibold))
                                    Text("id \(String(sub.id.prefix(12)))…")
                                        .font(.caption2.monospaced())
                                        .foregroundStyle(BrandTheme.textSecondary)
                                }
                                .listRowBackground(BrandTheme.navyElevated)
                                .frame(minHeight: 44)
                            }
                        }
                    } header: {
                        Text("Subscriptions").brandSectionHeader()
                    }
                }
                .brandListBackground()
            }
        }
        .task { await load() }
        .refreshable { await load() }
        .accessibilityIdentifier("admin.platform.root")
    }

    @MainActor
    private func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            async let metricsTask = APIClient.shared.fetchAdminPlatformMetrics()
            async let growthTask = APIClient.shared.fetchAdminPlatformGrowth()
            async let subsTask = APIClient.shared.fetchAdminSubscriptions(page: 1, pageSize: 40)
            metrics = try await metricsTask
            growth = try? await growthTask
            if let subs = try? await subsTask {
                subscriptions = subs.subscriptions
                totalMrrCents = subs.totalMrrCents
            }
            forbidden = false
            errorMessage = nil
            hasLoaded = true
        } catch let error as APIClientError where error.isForbidden {
            forbidden = true
            errorMessage = nil
        } catch {
            if !hasLoaded { errorMessage = error.localizedDescription }
            BrandHaptics.error()
        }
    }
}
