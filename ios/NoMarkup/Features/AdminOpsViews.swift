import SwiftUI

// MARK: - Admin ops panels
// Hosted by `AdminConsoleView` when `SectionTab.isOpsPanel` (own List + load).
// Binding order: `forbidden`, `actionMessage` (console hosts both).

// MARK: Jobs

struct AdminJobsOpsView: View {
    @Binding var forbidden: Bool
    @Binding var actionMessage: String?

    @State private var jobs: [AdminJobRow] = []
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var busyIDs: Set<String> = []
    @State private var reasonTarget: AdminJobRow?
    @State private var reasonAction: JobAction = .suspend
    @State private var reasonText = ""
    @State private var showReasonSheet = false

    private enum JobAction: String {
        case suspend
        case remove

        var label: String {
            switch self {
            case .suspend: return "Suspend"
            case .remove: return "Remove"
            }
        }
    }

    var body: some View {
        List {
            if isLoading && jobs.isEmpty {
                Text("Loading jobs…")
                    .foregroundStyle(BrandTheme.textSecondary)
                    .listRowBackground(BrandTheme.navyElevated)
            } else if let errorMessage, jobs.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Text(errorMessage)
                        .font(.caption)
                        .foregroundStyle(BrandTheme.warning)
                    Button("Try again") { Task { await load() } }
                        .font(.caption.weight(.semibold))
                        .frame(minHeight: 44)
                }
                .listRowBackground(BrandTheme.navyElevated)
            } else if jobs.isEmpty {
                Text("No jobs.")
                    .foregroundStyle(BrandTheme.textSecondary)
                    .listRowBackground(BrandTheme.navyElevated)
            } else {
                ForEach(jobs) { job in
                    let busy = busyIDs.contains(job.id)
                    VStack(alignment: .leading, spacing: 8) {
                        HStack(alignment: .top) {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(job.displayTitle)
                                    .font(.subheadline.weight(.semibold))
                                    .foregroundStyle(BrandTheme.textPrimary)
                                Text(job.displayStatus)
                                    .font(.caption.weight(.semibold))
                                    .foregroundStyle(BrandTheme.textSecondary)
                                Text(job.displayStartingBid)
                                    .font(.caption.monospacedDigit())
                                    .foregroundStyle(BrandTheme.goldBright)
                                Text(String(job.id.prefix(8)) + "…")
                                    .font(.caption2.monospaced())
                                    .foregroundStyle(BrandTheme.textSecondary)
                            }
                            Spacer(minLength: 8)
                            if busy {
                                ProgressView().controlSize(.small)
                            }
                        }
                        HStack(spacing: 8) {
                            if job.canSuspend {
                                Button("Suspend") {
                                    reasonTarget = job
                                    reasonAction = .suspend
                                    reasonText = ""
                                    showReasonSheet = true
                                }
                                .font(.caption.weight(.semibold))
                                .disabled(busy)
                                .frame(minHeight: 44)
                                .accessibilityIdentifier("admin.job.suspend.\(job.id)")
                            }
                            if job.canRemove {
                                Button("Remove", role: .destructive) {
                                    reasonTarget = job
                                    reasonAction = .remove
                                    reasonText = ""
                                    showReasonSheet = true
                                }
                                .font(.caption.weight(.semibold))
                                .disabled(busy)
                                .frame(minHeight: 44)
                                .accessibilityIdentifier("admin.job.remove.\(job.id)")
                            }
                        }
                    }
                    .listRowBackground(BrandTheme.navyElevated)
                }
            }
        }
        .brandListBackground()
        .refreshable { await load() }
        .task { await load() }
        .sheet(isPresented: $showReasonSheet) {
            NavigationStack {
                Form {
                    Section {
                        if let target = reasonTarget {
                            Text(target.displayTitle)
                                .font(.subheadline.weight(.semibold))
                        }
                        TextField("Reason (required)", text: $reasonText, axis: .vertical)
                            .lineLimit(2 ... 5)
                            .accessibilityIdentifier("admin.job.reason")
                    } footer: {
                        Text("POST /admin/jobs/{id}/\(reasonAction.rawValue)")
                    }
                }
                .navigationTitle(reasonAction.label)
                #if os(iOS)
                .navigationBarTitleDisplayMode(.inline)
                #endif
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Cancel") { showReasonSheet = false }
                    }
                    ToolbarItem(placement: .confirmationAction) {
                        Button(reasonAction.label) {
                            Task { await submitJobAction() }
                        }
                        .disabled(
                            reasonTarget == nil
                                || reasonText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                                || busyIDs.contains(reasonTarget?.id ?? "")
                        )
                        .accessibilityIdentifier("admin.job.submit")
                    }
                }
            }
            .presentationDetents([.medium])
        }
        .accessibilityIdentifier("admin.jobs.root")
    }

    @MainActor
    private func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            jobs = try await APIClient.shared.fetchAdminJobs().jobs
            errorMessage = nil
            forbidden = false
        } catch let error as APIClientError where error.isForbidden {
            forbidden = true
            errorMessage = nil
        } catch {
            if jobs.isEmpty { errorMessage = error.localizedDescription }
        }
    }

    @MainActor
    private func submitJobAction() async {
        guard let target = reasonTarget else { return }
        let reason = reasonText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !reason.isEmpty, !busyIDs.contains(target.id) else { return }
        busyIDs.insert(target.id)
        defer { busyIDs.remove(target.id) }
        do {
            switch reasonAction {
            case .suspend:
                let updated = try await APIClient.shared.suspendAdminJob(id: target.id, reason: reason)
                if let idx = jobs.firstIndex(where: { $0.id == target.id }) {
                    jobs[idx] = updated
                }
                actionMessage = "Job suspended."
            case .remove:
                try await APIClient.shared.removeAdminJob(id: target.id, reason: reason)
                jobs.removeAll { $0.id == target.id }
                actionMessage = "Job removed."
            }
            showReasonSheet = false
            reasonTarget = nil
            BrandHaptics.success()
        } catch let error as APIClientError where error.isForbidden {
            showReasonSheet = false
            forbidden = true
            BrandHaptics.error()
        } catch {
            actionMessage = error.localizedDescription
            BrandHaptics.error()
        }
    }
}

// MARK: Listings

struct AdminListingsOpsView: View {
    @Binding var forbidden: Bool
    @Binding var actionMessage: String?

    @State private var listings: [AdminListingRow] = []
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var busyIDs: Set<String> = []
    @State private var reasonTarget: AdminListingRow?
    @State private var reasonAction: ListingAction = .suspend
    @State private var reasonText = ""
    @State private var showReasonSheet = false

    private enum ListingAction: String {
        case suspend
        case cancel

        var label: String {
            switch self {
            case .suspend: return "Suspend"
            case .cancel: return "Cancel"
            }
        }
    }

    var body: some View {
        List {
            if isLoading && listings.isEmpty {
                Text("Loading listings…")
                    .foregroundStyle(BrandTheme.textSecondary)
                    .listRowBackground(BrandTheme.navyElevated)
            } else if let errorMessage, listings.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Text(errorMessage)
                        .font(.caption)
                        .foregroundStyle(BrandTheme.warning)
                    Button("Try again") { Task { await load() } }
                        .font(.caption.weight(.semibold))
                        .frame(minHeight: 44)
                }
                .listRowBackground(BrandTheme.navyElevated)
            } else if listings.isEmpty {
                Text("No listings.")
                    .foregroundStyle(BrandTheme.textSecondary)
                    .listRowBackground(BrandTheme.navyElevated)
            } else {
                ForEach(listings) { listing in
                    let busy = busyIDs.contains(listing.id)
                    VStack(alignment: .leading, spacing: 8) {
                        HStack(alignment: .top) {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(listing.displayTitle)
                                    .font(.subheadline.weight(.semibold))
                                    .foregroundStyle(BrandTheme.textPrimary)
                                Text(listing.displayStatus)
                                    .font(.caption.weight(.semibold))
                                    .foregroundStyle(BrandTheme.textSecondary)
                                if listing.isHidden == true {
                                    Text("Hidden")
                                        .font(.caption2)
                                        .foregroundStyle(BrandTheme.warning)
                                }
                                Text(String(listing.id.prefix(8)) + "…")
                                    .font(.caption2.monospaced())
                                    .foregroundStyle(BrandTheme.textSecondary)
                            }
                            Spacer(minLength: 8)
                            if busy {
                                ProgressView().controlSize(.small)
                            }
                        }
                        HStack(spacing: 8) {
                            if listing.canSuspend {
                                Button("Suspend") {
                                    reasonTarget = listing
                                    reasonAction = .suspend
                                    reasonText = ""
                                    showReasonSheet = true
                                }
                                .font(.caption.weight(.semibold))
                                .disabled(busy)
                                .frame(minHeight: 44)
                                .accessibilityIdentifier("admin.listing.suspend.\(listing.id)")
                            }
                            if listing.canReactivate {
                                Button("Reactivate") {
                                    Task { await reactivate(listing) }
                                }
                                .font(.caption.weight(.semibold))
                                .disabled(busy)
                                .frame(minHeight: 44)
                                .accessibilityIdentifier("admin.listing.reactivate.\(listing.id)")
                            }
                            if listing.canCancel {
                                Button("Cancel", role: .destructive) {
                                    reasonTarget = listing
                                    reasonAction = .cancel
                                    reasonText = ""
                                    showReasonSheet = true
                                }
                                .font(.caption.weight(.semibold))
                                .disabled(busy)
                                .frame(minHeight: 44)
                                .accessibilityIdentifier("admin.listing.cancel.\(listing.id)")
                            }
                        }
                    }
                    .listRowBackground(BrandTheme.navyElevated)
                }
            }
        }
        .brandListBackground()
        .refreshable { await load() }
        .task { await load() }
        .sheet(isPresented: $showReasonSheet) {
            NavigationStack {
                Form {
                    Section {
                        if let target = reasonTarget {
                            Text(target.displayTitle)
                                .font(.subheadline.weight(.semibold))
                        }
                        TextField("Reason (required)", text: $reasonText, axis: .vertical)
                            .lineLimit(2 ... 5)
                            .accessibilityIdentifier("admin.listing.reason")
                    } footer: {
                        Text("POST /admin/listings/{id}/\(reasonAction.rawValue)")
                    }
                }
                .navigationTitle(reasonAction.label)
                #if os(iOS)
                .navigationBarTitleDisplayMode(.inline)
                #endif
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Cancel") { showReasonSheet = false }
                    }
                    ToolbarItem(placement: .confirmationAction) {
                        Button(reasonAction.label) {
                            Task { await submitListingAction() }
                        }
                        .disabled(
                            reasonTarget == nil
                                || reasonText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                                || busyIDs.contains(reasonTarget?.id ?? "")
                        )
                        .accessibilityIdentifier("admin.listing.submit")
                    }
                }
            }
            .presentationDetents([.medium])
        }
        .accessibilityIdentifier("admin.listings.root")
    }

    @MainActor
    private func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            listings = try await APIClient.shared.fetchAdminListings().listings
            errorMessage = nil
            forbidden = false
        } catch let error as APIClientError where error.isForbidden {
            forbidden = true
            errorMessage = nil
        } catch {
            if listings.isEmpty { errorMessage = error.localizedDescription }
        }
    }

    @MainActor
    private func applyMutation(_ result: AdminListingMutationResponse, id: String) {
        if let idx = listings.firstIndex(where: { $0.id == id }) {
            if let status = result.status {
                listings[idx].status = status
            }
            if let hidden = result.hidden {
                listings[idx].isHidden = hidden
            }
        }
    }

    @MainActor
    private func submitListingAction() async {
        guard let target = reasonTarget else { return }
        let reason = reasonText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !reason.isEmpty, !busyIDs.contains(target.id) else { return }
        busyIDs.insert(target.id)
        defer { busyIDs.remove(target.id) }
        do {
            let result: AdminListingMutationResponse
            switch reasonAction {
            case .suspend:
                result = try await APIClient.shared.suspendAdminListing(id: target.id, reason: reason)
                actionMessage = "Listing suspended."
            case .cancel:
                result = try await APIClient.shared.cancelAdminListing(id: target.id, reason: reason)
                actionMessage = "Listing cancelled."
            }
            applyMutation(result, id: target.id)
            showReasonSheet = false
            reasonTarget = nil
            BrandHaptics.success()
            await load()
        } catch let error as APIClientError where error.isForbidden {
            showReasonSheet = false
            forbidden = true
            BrandHaptics.error()
        } catch {
            actionMessage = error.localizedDescription
            BrandHaptics.error()
        }
    }

    @MainActor
    private func reactivate(_ listing: AdminListingRow) async {
        guard !busyIDs.contains(listing.id) else { return }
        busyIDs.insert(listing.id)
        defer { busyIDs.remove(listing.id) }
        do {
            let result = try await APIClient.shared.reactivateAdminListing(id: listing.id)
            applyMutation(result, id: listing.id)
            actionMessage = "Listing reactivated."
            BrandHaptics.success()
            await load()
        } catch let error as APIClientError where error.isForbidden {
            forbidden = true
            BrandHaptics.error()
        } catch {
            actionMessage = error.localizedDescription
            BrandHaptics.error()
        }
    }
}

// MARK: Goods disputes

struct AdminGoodsDisputesOpsView: View {
    @Binding var forbidden: Bool
    @Binding var actionMessage: String?

    @State private var disputes: [AdminGoodsDisputeRow] = []
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var busyIDs: Set<String> = []
    @State private var resolveTarget: AdminGoodsDisputeRow?
    @State private var resolveAction = "refund_full"
    @State private var resolveNotes = ""
    @State private var resolveRefundText = ""
    @State private var resolveTransferText = ""
    @State private var showResolveSheet = false

    private let resolutions: [(id: String, label: String)] = [
        ("refund_full", "Refund full"),
        ("refund_partial", "Refund partial"),
        ("release_to_seller", "Release to seller"),
        ("no_action", "No action"),
    ]

    var body: some View {
        List {
            if isLoading && disputes.isEmpty {
                Text("Loading goods disputes…")
                    .foregroundStyle(BrandTheme.textSecondary)
                    .listRowBackground(BrandTheme.navyElevated)
            } else if let errorMessage, disputes.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Text(errorMessage)
                        .font(.caption)
                        .foregroundStyle(BrandTheme.warning)
                    Button("Try again") { Task { await load() } }
                        .font(.caption.weight(.semibold))
                        .frame(minHeight: 44)
                }
                .listRowBackground(BrandTheme.navyElevated)
            } else if disputes.isEmpty {
                Text("No goods disputes.")
                    .foregroundStyle(BrandTheme.textSecondary)
                    .listRowBackground(BrandTheme.navyElevated)
            } else {
                ForEach(disputes) { d in
                    let busy = busyIDs.contains(d.id)
                    VStack(alignment: .leading, spacing: 8) {
                        HStack(alignment: .top) {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(d.displayTitle)
                                    .font(.subheadline.weight(.semibold))
                                    .foregroundStyle(BrandTheme.textPrimary)
                                Text(d.displayStatus)
                                    .font(.caption.weight(.semibold))
                                    .foregroundStyle(BrandTheme.textSecondary)
                                Text(d.displayAmount)
                                    .font(.caption.monospacedDigit())
                                    .foregroundStyle(BrandTheme.goldBright)
                                Text(String(d.id.prefix(8)) + "…")
                                    .font(.caption2.monospaced())
                                    .foregroundStyle(BrandTheme.textSecondary)
                            }
                            Spacer(minLength: 8)
                            if busy {
                                ProgressView().controlSize(.small)
                            }
                        }
                        if d.isOpenForResolution {
                            Button("Resolve") {
                                resolveTarget = d
                                resolveAction = "refund_full"
                                resolveNotes = ""
                                resolveRefundText = ""
                                resolveTransferText = ""
                                showResolveSheet = true
                            }
                            .font(.caption.weight(.semibold))
                            .disabled(busy)
                            .frame(minHeight: 44)
                            .accessibilityIdentifier("admin.goodsDispute.resolve.\(d.id)")
                        }
                    }
                    .listRowBackground(BrandTheme.navyElevated)
                }
            }
        }
        .brandListBackground()
        .refreshable { await load() }
        .task { await load() }
        .sheet(isPresented: $showResolveSheet) {
            NavigationStack {
                Form {
                    Section {
                        Picker("Resolution", selection: $resolveAction) {
                            ForEach(resolutions, id: \.id) { r in
                                Text(r.label).tag(r.id)
                            }
                        }
                        .pickerStyle(.inline)
                        TextField("Notes", text: $resolveNotes, axis: .vertical)
                            .lineLimit(2 ... 5)
                            .accessibilityIdentifier("admin.goodsDispute.notes")
                        if resolveAction == "refund_partial" {
                            DollarAmountField(
                                text: $resolveRefundText,
                                placeholder: "0.00",
                                accessibilityLabelText: "Refund to buyer in dollars"
                            )
                            .accessibilityIdentifier("admin.goodsDispute.refund")
                            DollarAmountField(
                                text: $resolveTransferText,
                                placeholder: "0.00",
                                accessibilityLabelText: "Transfer to seller in dollars"
                            )
                            .accessibilityIdentifier("admin.goodsDispute.transfer")
                        }
                    } footer: {
                        Text("POST /admin/disputes/goods/{id}/resolve. Partial amounts are integer cents on the wire.")
                    }
                }
                .navigationTitle("Resolve goods dispute")
                #if os(iOS)
                .navigationBarTitleDisplayMode(.inline)
                #endif
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Cancel") { showResolveSheet = false }
                    }
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Resolve") {
                            Task { await submitResolve() }
                        }
                        .disabled(
                            resolveTarget == nil
                                || busyIDs.contains(resolveTarget?.id ?? "")
                        )
                        .accessibilityIdentifier("admin.goodsDispute.submit")
                    }
                }
            }
            .presentationDetents([.medium, .large])
        }
        .accessibilityIdentifier("admin.goodsDisputes.root")
    }

    @MainActor
    private func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            disputes = try await APIClient.shared.fetchAdminGoodsDisputes().disputes
            errorMessage = nil
            forbidden = false
        } catch let error as APIClientError where error.isForbidden {
            forbidden = true
            errorMessage = nil
        } catch {
            if disputes.isEmpty { errorMessage = error.localizedDescription }
        }
    }

    @MainActor
    private func submitResolve() async {
        guard let target = resolveTarget else { return }
        guard !busyIDs.contains(target.id) else { return }
        busyIDs.insert(target.id)
        defer { busyIDs.remove(target.id) }
        do {
            let refundCents = resolveAction == "refund_partial"
                ? MoneyFormat.cents(fromDollarsText: resolveRefundText)
                : nil
            let transferCents = resolveAction == "refund_partial"
                ? MoneyFormat.cents(fromDollarsText: resolveTransferText)
                : nil
            if resolveAction == "refund_partial", refundCents == nil, transferCents == nil {
                BrandHaptics.warning()
                errorMessage = "Enter a refund and/or transfer amount for partial resolution."
                return
            }
            let result = try await APIClient.shared.resolveAdminGoodsDispute(
                id: target.id,
                resolution: resolveAction,
                refundToBuyerCents: refundCents,
                transferToSellerCents: transferCents,
                notes: resolveNotes
            )
            if let idx = disputes.firstIndex(where: { $0.id == target.id }) {
                disputes[idx].status = result.status ?? "resolved"
            }
            showResolveSheet = false
            resolveTarget = nil
            actionMessage = "Goods dispute resolved (\(resolveAction))."
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
}

// MARK: Markets

struct AdminMarketsOpsView: View {
    @Binding var forbidden: Bool
    @Binding var actionMessage: String?

    @State private var markets: [MarketRow] = []
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var busySlugs: Set<String> = []

    var body: some View {
        List {
            if isLoading && markets.isEmpty {
                Text("Loading markets…")
                    .foregroundStyle(BrandTheme.textSecondary)
                    .listRowBackground(BrandTheme.navyElevated)
            } else if let errorMessage, markets.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Text(errorMessage)
                        .font(.caption)
                        .foregroundStyle(BrandTheme.warning)
                    Button("Try again") { Task { await load() } }
                        .font(.caption.weight(.semibold))
                        .frame(minHeight: 44)
                }
                .listRowBackground(BrandTheme.navyElevated)
            } else if markets.isEmpty {
                Text("No markets in catalog.")
                    .foregroundStyle(BrandTheme.textSecondary)
                    .listRowBackground(BrandTheme.navyElevated)
            } else {
                ForEach(markets) { market in
                    let slug = market.slug ?? market.id
                    let busy = busySlugs.contains(slug)
                    let active = market.isActive == true
                    HStack(alignment: .center, spacing: 12) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(market.displayName)
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(BrandTheme.textPrimary)
                            HStack(spacing: 6) {
                                if let region = market.regionLabel {
                                    Text(region)
                                        .font(.caption)
                                        .foregroundStyle(BrandTheme.textSecondary)
                                }
                                if let country = market.country, !country.isEmpty {
                                    Text(country)
                                        .font(.caption2.monospaced())
                                        .foregroundStyle(BrandTheme.textSecondary)
                                }
                                Text(slug)
                                    .font(.caption2.monospaced())
                                    .foregroundStyle(BrandTheme.textSecondary)
                            }
                        }
                        Spacer(minLength: 8)
                        if busy {
                            ProgressView().controlSize(.small)
                        }
                        Toggle(
                            "",
                            isOn: Binding(
                                get: { active },
                                set: { newValue in
                                    Task { await setActive(market, active: newValue) }
                                }
                            )
                        )
                        .labelsHidden()
                        .disabled(busy || (market.slug ?? "").isEmpty)
                        .accessibilityLabel("Activate \(market.displayName)")
                        .accessibilityIdentifier("admin.market.toggle.\(slug)")
                    }
                    .listRowBackground(BrandTheme.navyElevated)
                    .frame(minHeight: 44)
                }
            }
        }
        .brandListBackground()
        .refreshable { await load() }
        .task { await load() }
        .accessibilityIdentifier("admin.markets.root")
    }

    @MainActor
    private func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            markets = try await APIClient.shared.fetchAdminMarkets().markets
            errorMessage = nil
            forbidden = false
        } catch let error as APIClientError where error.isForbidden {
            forbidden = true
            errorMessage = nil
        } catch {
            if markets.isEmpty { errorMessage = error.localizedDescription }
        }
    }

    @MainActor
    private func setActive(_ market: MarketRow, active: Bool) async {
        let slug = (market.slug ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !slug.isEmpty, !busySlugs.contains(slug) else { return }
        busySlugs.insert(slug)
        defer { busySlugs.remove(slug) }
        do {
            let result = try await APIClient.shared.setAdminMarketsActive(
                active: active,
                slugs: [slug]
            )
            if let idx = markets.firstIndex(where: { $0.id == market.id || $0.slug == slug }) {
                markets[idx].isActive = result.active ?? active
            }
            let n = result.updated ?? 1
            actionMessage = active
                ? "Activated \(n) market(s) (\(slug))."
                : "Deactivated \(n) market(s) (\(slug))."
            BrandHaptics.success()
        } catch let error as APIClientError where error.isForbidden {
            forbidden = true
            BrandHaptics.error()
            await load()
        } catch {
            actionMessage = error.localizedDescription
            BrandHaptics.error()
            await load()
        }
    }
}

// MARK: Taxonomy / category questions

struct AdminTaxonomyOpsView: View {
    @Binding var forbidden: Bool
    @Binding var actionMessage: String?

    @State private var flatCategories: [ServiceCategorySummary] = []
    @State private var selectedCategoryId: String?
    @State private var questions: [CategoryQuestionRow] = []
    @State private var isLoadingCategories = false
    @State private var isLoadingQuestions = false
    @State private var errorMessage: String?
    @State private var busyQuestionIDs: Set<String> = []
    @State private var showAddSheet = false
    @State private var newQuestionText = ""
    @State private var newQuestionType = "text"
    @State private var newQuestionRequired = false
    @State private var isCreating = false

    private let questionTypes = ["text", "number", "select", "multiselect", "boolean", "date"]

    var body: some View {
        List {
            Section {
                if isLoadingCategories && flatCategories.isEmpty {
                    Text("Loading categories…")
                        .foregroundStyle(BrandTheme.textSecondary)
                        .listRowBackground(BrandTheme.navyElevated)
                } else if flatCategories.isEmpty {
                    Text(errorMessage ?? "No categories available.")
                        .foregroundStyle(BrandTheme.textSecondary)
                        .listRowBackground(BrandTheme.navyElevated)
                } else {
                    Picker("Category", selection: $selectedCategoryId) {
                        Text("Select…").tag(Optional<String>.none)
                        ForEach(flatCategories) { cat in
                            Text(cat.displayName).tag(Optional(cat.id))
                        }
                    }
                    .listRowBackground(BrandTheme.navyElevated)
                    .accessibilityIdentifier("admin.taxonomy.categoryPicker")
                    .onChange(of: selectedCategoryId) { _, _ in
                        Task { await loadQuestions() }
                    }
                }
            } header: {
                Text("Category").brandSectionHeader()
            }

            Section {
                if selectedCategoryId == nil {
                    Text("Pick a category to manage pre-quote questions.")
                        .font(.caption)
                        .foregroundStyle(BrandTheme.textSecondary)
                        .listRowBackground(BrandTheme.navyElevated)
                } else if isLoadingQuestions && questions.isEmpty {
                    Text("Loading questions…")
                        .foregroundStyle(BrandTheme.textSecondary)
                        .listRowBackground(BrandTheme.navyElevated)
                } else if questions.isEmpty {
                    Text("No questions for this category.")
                        .foregroundStyle(BrandTheme.textSecondary)
                        .listRowBackground(BrandTheme.navyElevated)
                } else {
                    ForEach(questions) { q in
                        let busy = busyQuestionIDs.contains(q.id)
                        HStack(alignment: .top, spacing: 12) {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(q.displayQuestion)
                                    .font(.subheadline.weight(.semibold))
                                    .foregroundStyle(BrandTheme.textPrimary)
                                HStack(spacing: 8) {
                                    Text(q.displayType)
                                        .font(.caption2.monospaced())
                                        .foregroundStyle(BrandTheme.textSecondary)
                                    if q.required == true {
                                        Text("Required")
                                            .font(.caption2)
                                            .foregroundStyle(BrandTheme.warning)
                                    }
                                }
                            }
                            Spacer(minLength: 8)
                            if busy {
                                ProgressView().controlSize(.small)
                            }
                            Button(role: .destructive) {
                                Task { await deleteQuestion(q) }
                            } label: {
                                Image(systemName: "trash")
                            }
                            .disabled(busy)
                            .frame(minWidth: 44, minHeight: 44)
                            .accessibilityLabel("Delete question")
                            .accessibilityIdentifier("admin.taxonomy.delete.\(q.id)")
                        }
                        .listRowBackground(BrandTheme.navyElevated)
                    }
                }

                Button {
                    newQuestionText = ""
                    newQuestionType = "text"
                    newQuestionRequired = false
                    showAddSheet = true
                } label: {
                    Label("Add question", systemImage: "plus.circle")
                }
                .disabled(selectedCategoryId == nil)
                .frame(minHeight: 44)
                .listRowBackground(BrandTheme.navyElevated)
                .accessibilityIdentifier("admin.taxonomy.add")
            } header: {
                Text("Questions").brandSectionHeader()
            }
        }
        .brandListBackground()
        .sheet(isPresented: $showAddSheet) {
            addQuestionSheet
        }
        .task { await loadCategories() }
        .accessibilityIdentifier("admin.taxonomy.root")
    }

    private var addQuestionSheet: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Question text", text: $newQuestionText, axis: .vertical)
                        .lineLimit(2 ... 4)
                        .accessibilityIdentifier("admin.taxonomy.newQuestion")
                    Picker("Type", selection: $newQuestionType) {
                        ForEach(questionTypes, id: \.self) { t in
                            Text(t).tag(t)
                        }
                    }
                    Toggle("Required", isOn: $newQuestionRequired)
                } footer: {
                    Text("POST /admin/category-questions. List via public GET /categories/{id}/questions.")
                }
            }
            .navigationTitle("Add question")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { showAddSheet = false }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Create") {
                        Task { await createQuestion() }
                    }
                    .disabled(
                        isCreating
                            || newQuestionText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                            || selectedCategoryId == nil
                    )
                    .accessibilityIdentifier("admin.taxonomy.createSubmit")
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    @MainActor
    private func loadCategories() async {
        isLoadingCategories = true
        defer { isLoadingCategories = false }
        do {
            let tree = try await APIClient.shared.fetchCategoryTree()
            flatCategories = Self.flatten(tree)
            errorMessage = nil
        } catch {
            if flatCategories.isEmpty {
                errorMessage = error.localizedDescription
            }
        }
    }

    private static func flatten(_ nodes: [CategoryNode], prefix: String = "") -> [ServiceCategorySummary] {
        var out: [ServiceCategorySummary] = []
        for node in nodes {
            let name = node.displayName
            let labeled = prefix.isEmpty ? name : "\(prefix) › \(name)"
            out.append(
                ServiceCategorySummary(
                    id: node.id,
                    parentId: node.parentId,
                    name: labeled,
                    slug: node.slug,
                    level: node.level,
                    description: node.description,
                    icon: node.icon,
                    active: node.active
                )
            )
            if let children = node.children, !children.isEmpty {
                out.append(contentsOf: flatten(children, prefix: labeled))
            }
        }
        return out
    }

    @MainActor
    private func loadQuestions() async {
        guard let categoryId = selectedCategoryId else {
            questions = []
            return
        }
        isLoadingQuestions = true
        defer { isLoadingQuestions = false }
        do {
            questions = try await APIClient.shared.fetchCategoryQuestions(categoryId: categoryId)
            forbidden = false
        } catch let error as APIClientError where error.isForbidden {
            forbidden = true
        } catch {
            actionMessage = error.localizedDescription
            questions = []
        }
    }

    @MainActor
    private func createQuestion() async {
        guard let categoryId = selectedCategoryId else { return }
        let text = newQuestionText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !isCreating else { return }
        isCreating = true
        defer { isCreating = false }
        do {
            let created = try await APIClient.shared.createAdminCategoryQuestion(
                categoryId: categoryId,
                question: text,
                questionType: newQuestionType,
                required: newQuestionRequired,
                displayOrder: questions.count
            )
            questions.append(created)
            showAddSheet = false
            actionMessage = "Question added."
            BrandHaptics.success()
        } catch let error as APIClientError where error.isForbidden {
            showAddSheet = false
            forbidden = true
            BrandHaptics.error()
        } catch {
            actionMessage = error.localizedDescription
            BrandHaptics.error()
        }
    }

    @MainActor
    private func deleteQuestion(_ question: CategoryQuestionRow) async {
        guard !busyQuestionIDs.contains(question.id) else { return }
        busyQuestionIDs.insert(question.id)
        defer { busyQuestionIDs.remove(question.id) }
        do {
            _ = try await APIClient.shared.deleteAdminCategoryQuestion(id: question.id)
            questions.removeAll { $0.id == question.id }
            actionMessage = "Question deleted."
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

// MARK: Insurers

struct AdminInsurersOpsView: View {
    @Binding var forbidden: Bool
    @Binding var actionMessage: String?

    @State private var insurers: [AdminInsurer] = []
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var flagOff = false
    @State private var busyIDs: Set<String> = []
    @State private var showCreateSheet = false
    @State private var createName = ""
    @State private var createSlug = ""
    @State private var isCreating = false

    var body: some View {
        List {
            if flagOff {
                Text("Insurer admin requires the insurance_competition feature flag.")
                    .font(.caption)
                    .foregroundStyle(BrandTheme.warning)
                    .listRowBackground(BrandTheme.navyElevated)
            } else if isLoading && insurers.isEmpty {
                Text("Loading insurers…")
                    .foregroundStyle(BrandTheme.textSecondary)
                    .listRowBackground(BrandTheme.navyElevated)
            } else if let errorMessage, insurers.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Text(errorMessage)
                        .font(.caption)
                        .foregroundStyle(BrandTheme.warning)
                    Button("Try again") { Task { await load() } }
                        .font(.caption.weight(.semibold))
                        .frame(minHeight: 44)
                }
                .listRowBackground(BrandTheme.navyElevated)
            } else if insurers.isEmpty {
                Text("No insurers onboarded.")
                    .foregroundStyle(BrandTheme.textSecondary)
                    .listRowBackground(BrandTheme.navyElevated)
            } else {
                ForEach(insurers) { insurer in
                    let busy = busyIDs.contains(insurer.id)
                    VStack(alignment: .leading, spacing: 8) {
                        HStack(alignment: .top) {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(insurer.displayName)
                                    .font(.subheadline.weight(.semibold))
                                    .foregroundStyle(BrandTheme.textPrimary)
                                Text(insurer.displayStatus)
                                    .font(.caption.weight(.semibold))
                                    .foregroundStyle(BrandTheme.textSecondary)
                                if let slug = insurer.slug, !slug.isEmpty {
                                    Text(slug)
                                        .font(.caption2.monospaced())
                                        .foregroundStyle(BrandTheme.textSecondary)
                                }
                                if let products = insurer.products, !products.isEmpty {
                                    Text("\(products.count) product(s)")
                                        .font(.caption2)
                                        .foregroundStyle(BrandTheme.textSecondary)
                                }
                            }
                            Spacer(minLength: 8)
                            if busy {
                                ProgressView().controlSize(.small)
                            }
                        }
                        HStack(spacing: 8) {
                            if insurer.canApprove {
                                Button("Approve") {
                                    Task { await setStatus(insurer, status: "approved") }
                                }
                                .font(.caption.weight(.semibold))
                                .disabled(busy)
                                .frame(minHeight: 44)
                                .accessibilityIdentifier("admin.insurer.approve.\(insurer.id)")
                            }
                            if insurer.canSuspend {
                                Button("Suspend", role: .destructive) {
                                    Task { await setStatus(insurer, status: "suspended") }
                                }
                                .font(.caption.weight(.semibold))
                                .disabled(busy)
                                .frame(minHeight: 44)
                                .accessibilityIdentifier("admin.insurer.suspend.\(insurer.id)")
                            }
                        }
                    }
                    .listRowBackground(BrandTheme.navyElevated)
                }
            }

            Button {
                createName = ""
                createSlug = ""
                showCreateSheet = true
            } label: {
                Label("Onboard insurer", systemImage: "plus.circle")
            }
            .disabled(flagOff)
            .frame(minHeight: 44)
            .listRowBackground(BrandTheme.navyElevated)
            .accessibilityIdentifier("admin.insurer.add")
        }
        .brandListBackground()
        .refreshable { await load() }
        .task { await load() }
        .sheet(isPresented: $showCreateSheet) {
            createInsurerSheet
        }
        .accessibilityIdentifier("admin.insurers.root")
    }

    private var createInsurerSheet: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Name", text: $createName)
                        .accessibilityIdentifier("admin.insurer.name")
                    TextField("Slug", text: $createSlug)
                        #if os(iOS)
                        .textInputAutocapitalization(.never)
                        #endif
                        .autocorrectionDisabled()
                        .accessibilityIdentifier("admin.insurer.slug")
                } footer: {
                    Text("POST /admin/insurers. Status starts as pending; approve from the list.")
                }
            }
            .navigationTitle("Onboard insurer")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { showCreateSheet = false }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Create") {
                        Task { await createInsurer() }
                    }
                    .disabled(
                        isCreating
                            || createName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                            || createSlug.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                    )
                    .accessibilityIdentifier("admin.insurer.createSubmit")
                }
            }
        }
        .presentationDetents([.medium])
    }

    @MainActor
    private func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            insurers = try await APIClient.shared.fetchAdminInsurers()
            errorMessage = nil
            flagOff = false
            forbidden = false
        } catch let error as APIClientError where error.isForbidden {
            forbidden = true
            errorMessage = nil
        } catch let error as APIClientError {
            if case .httpStatus(let code, _) = error, code == 503 {
                flagOff = true
                errorMessage = nil
            } else if insurers.isEmpty {
                errorMessage = error.localizedDescription
            }
        } catch {
            if insurers.isEmpty {
                errorMessage = error.localizedDescription
            }
        }
    }

    @MainActor
    private func setStatus(_ insurer: AdminInsurer, status: String) async {
        guard !busyIDs.contains(insurer.id) else { return }
        busyIDs.insert(insurer.id)
        defer { busyIDs.remove(insurer.id) }
        do {
            let updated = try await APIClient.shared.updateAdminInsurerStatus(
                id: insurer.id,
                status: status
            )
            if let idx = insurers.firstIndex(where: { $0.id == insurer.id }) {
                insurers[idx] = updated
            }
            actionMessage = "Insurer \(updated.displayName) → \(status)."
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
    private func createInsurer() async {
        let name = createName.trimmingCharacters(in: .whitespacesAndNewlines)
        let slug = createSlug.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty, !slug.isEmpty, !isCreating else { return }
        isCreating = true
        defer { isCreating = false }
        do {
            let created = try await APIClient.shared.createAdminInsurer(name: name, slug: slug)
            insurers.insert(created, at: 0)
            showCreateSheet = false
            actionMessage = "Insurer \(created.displayName) onboarded."
            BrandHaptics.success()
        } catch let error as APIClientError where error.isForbidden {
            showCreateSheet = false
            forbidden = true
            BrandHaptics.error()
        } catch {
            actionMessage = error.localizedDescription
            BrandHaptics.error()
        }
    }
}

// MARK: Challenges

struct AdminChallengesOpsView: View {
    @Binding var forbidden: Bool
    @Binding var actionMessage: String?

    @State private var challenges: [AdminChallengeRow] = []
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var showCreateSheet = false
    @State private var isCreating = false

    @State private var title = ""
    @State private var description = ""
    @State private var challengeType = "complete_jobs"
    @State private var targetValue = "5"
    @State private var rewardType = "badge"
    @State private var rewardValue = "starter"
    @State private var startsAt = Date()
    @State private var endsAt = Calendar.current.date(byAdding: .day, value: 30, to: Date()) ?? Date()
    @State private var isSeasonal = false
    @State private var seasonName = ""

    private let challengeTypes = [
        "complete_jobs", "win_auctions", "referrals", "reviews", "listings_sold",
    ]
    private let rewardTypes = ["badge", "credit", "fee_discount", "boost"]

    private static let rfc3339: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()

    var body: some View {
        List {
            if isLoading && challenges.isEmpty {
                Text("Loading challenges…")
                    .foregroundStyle(BrandTheme.textSecondary)
                    .listRowBackground(BrandTheme.navyElevated)
            } else if let errorMessage, challenges.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Text(errorMessage)
                        .font(.caption)
                        .foregroundStyle(BrandTheme.warning)
                    Button("Try again") { Task { await load() } }
                        .font(.caption.weight(.semibold))
                        .frame(minHeight: 44)
                }
                .listRowBackground(BrandTheme.navyElevated)
            } else if challenges.isEmpty {
                Text("No challenges.")
                    .foregroundStyle(BrandTheme.textSecondary)
                    .listRowBackground(BrandTheme.navyElevated)
            } else {
                ForEach(challenges) { challenge in
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            Text(challenge.displayTitle)
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(BrandTheme.textPrimary)
                            Spacer(minLength: 8)
                            if challenge.isActive == true {
                                Text("ACTIVE")
                                    .font(.caption2.weight(.bold))
                                    .foregroundStyle(BrandTheme.goldBright)
                            }
                        }
                        Text(challenge.displayType)
                            .font(.caption)
                            .foregroundStyle(BrandTheme.textSecondary)
                        Text(challenge.participantsLabel)
                            .font(.caption2)
                            .foregroundStyle(BrandTheme.textSecondary)
                        if let reward = challenge.rewardValue, !reward.isEmpty {
                            Text("Reward: \(challenge.rewardType ?? "") \(reward)")
                                .font(.caption2)
                                .foregroundStyle(BrandTheme.textSecondary)
                        }
                    }
                    .listRowBackground(BrandTheme.navyElevated)
                    .frame(minHeight: 44)
                    .accessibilityIdentifier("admin.challenge.row.\(challenge.id)")
                }
            }

            Button {
                resetCreateForm()
                showCreateSheet = true
            } label: {
                Label("Create challenge", systemImage: "plus.circle")
            }
            .frame(minHeight: 44)
            .listRowBackground(BrandTheme.navyElevated)
            .accessibilityIdentifier("admin.challenge.add")
        }
        .brandListBackground()
        .refreshable { await load() }
        .task { await load() }
        .sheet(isPresented: $showCreateSheet) {
            createChallengeSheet
        }
        .accessibilityIdentifier("admin.challenges.root")
    }

    private var createChallengeSheet: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Title", text: $title)
                        .accessibilityIdentifier("admin.challenge.title")
                    TextField("Description", text: $description, axis: .vertical)
                        .lineLimit(2 ... 4)
                        .accessibilityIdentifier("admin.challenge.description")
                    Picker("Type", selection: $challengeType) {
                        ForEach(challengeTypes, id: \.self) { t in
                            Text(t.replacingOccurrences(of: "_", with: " ").capitalized).tag(t)
                        }
                    }
                    TextField("Target value", text: $targetValue)
                        #if os(iOS)
                        .keyboardType(.numberPad)
                        #endif
                        .accessibilityIdentifier("admin.challenge.target")
                    Picker("Reward type", selection: $rewardType) {
                        ForEach(rewardTypes, id: \.self) { t in
                            Text(t.replacingOccurrences(of: "_", with: " ").capitalized).tag(t)
                        }
                    }
                    TextField("Reward value", text: $rewardValue)
                        .accessibilityIdentifier("admin.challenge.rewardValue")
                    DatePicker("Starts", selection: $startsAt, displayedComponents: [.date, .hourAndMinute])
                    DatePicker("Ends", selection: $endsAt, displayedComponents: [.date, .hourAndMinute])
                    Toggle("Seasonal", isOn: $isSeasonal)
                    if isSeasonal {
                        TextField("Season name", text: $seasonName)
                    }
                } footer: {
                    Text("POST /admin/challenges. Dates encode as RFC3339.")
                }
            }
            .navigationTitle("Create challenge")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { showCreateSheet = false }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Create") {
                        Task { await createChallenge() }
                    }
                    .disabled(isCreating || !canSubmitCreate)
                    .accessibilityIdentifier("admin.challenge.createSubmit")
                }
            }
        }
        .presentationDetents([.large])
    }

    private var canSubmitCreate: Bool {
        !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !description.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && (Int(targetValue.trimmingCharacters(in: .whitespacesAndNewlines)) ?? 0) > 0
            && !rewardValue.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && endsAt > startsAt
    }

    private func resetCreateForm() {
        title = ""
        description = ""
        challengeType = "complete_jobs"
        targetValue = "5"
        rewardType = "badge"
        rewardValue = "starter"
        startsAt = Date()
        endsAt = Calendar.current.date(byAdding: .day, value: 30, to: Date()) ?? Date()
        isSeasonal = false
        seasonName = ""
    }

    @MainActor
    private func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            challenges = try await APIClient.shared.fetchAdminChallenges()
            errorMessage = nil
            forbidden = false
        } catch let error as APIClientError where error.isForbidden {
            forbidden = true
            errorMessage = nil
        } catch {
            if challenges.isEmpty {
                errorMessage = error.localizedDescription
            }
        }
    }

    @MainActor
    private func createChallenge() async {
        guard canSubmitCreate, !isCreating else { return }
        guard let target = Int(targetValue.trimmingCharacters(in: .whitespacesAndNewlines)), target > 0 else {
            actionMessage = "Target value must be a positive integer."
            BrandHaptics.warning()
            return
        }
        isCreating = true
        defer { isCreating = false }
        let input = CreateAdminChallengeInput(
            title: title,
            description: description,
            challengeType: challengeType,
            targetValue: target,
            rewardType: rewardType,
            rewardValue: rewardValue,
            startsAt: Self.rfc3339.string(from: startsAt),
            endsAt: Self.rfc3339.string(from: endsAt),
            isSeasonal: isSeasonal,
            seasonName: isSeasonal ? seasonName : nil,
            maxParticipants: nil
        )
        do {
            let created = try await APIClient.shared.createAdminChallenge(input)
            challenges.insert(created, at: 0)
            showCreateSheet = false
            actionMessage = "Challenge “\(created.displayTitle)” created."
            BrandHaptics.success()
        } catch let error as APIClientError where error.isForbidden {
            showCreateSheet = false
            forbidden = true
            BrandHaptics.error()
        } catch {
            actionMessage = error.localizedDescription
            BrandHaptics.error()
        }
    }
}

// MARK: - Additional admin ops panels (console tab hosts)
