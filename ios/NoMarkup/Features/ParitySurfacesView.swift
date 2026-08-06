import CoreLocation
import MapKit
import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

// MARK: - Payments history (web `/payments`)

/// Tabbed payment ledger — `GET /api/v1/payments` with optional status filter.
struct PaymentsHistoryView: View {
    private enum Tab: String, CaseIterable, Identifiable {
        case all = "All"
        case pending = "Pending"
        case escrow = "Escrow"
        case completed = "Done"
        case failed = "Failed"
        case refunded = "Refund"

        var id: String { rawValue }

        var statusFilter: String? {
            switch self {
            case .all: return nil
            case .pending: return "pending"
            case .escrow: return "escrow"
            case .completed: return "completed"
            case .failed: return "failed"
            case .refunded: return "refunded"
            }
        }
    }

    @EnvironmentObject private var auth: AuthViewModel
    @State private var tab: Tab = .all
    @State private var payments: [ContractPayment] = []
    @State private var isLoading = false
    @State private var errorMessage: String?

    var body: some View {
        Group {
            if auth.isScaffoldSession || !auth.isAuthenticated {
                BrandEmptyState(
                    title: "Sign in required",
                    systemImage: "creditcard",
                    message: "Sign in to view your payment and escrow history."
                )
            } else if isLoading && payments.isEmpty {
                BrandLoadingScreen(kind: .form, accessibilityLabel: "Loading payments…")
            } else if let errorMessage, payments.isEmpty {
                BrandEmptyState(
                    title: "Couldn’t load payments",
                    systemImage: "exclamationmark.triangle",
                    message: errorMessage,
                    actionTitle: "Try again"
                ) {
                    Task { await load() }
                }
            } else if payments.isEmpty {
                BrandEmptyState(
                    title: emptyTitle,
                    systemImage: "creditcard",
                    message: emptyMessage
                )
            } else {
                List(payments) { payment in
                    paymentRow(payment)
                        .listRowBackground(BrandTheme.navyElevated)
                }
                .brandListBackground()
            }
        }
        .navigationTitle("Payments")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .brandNavigationBarChrome()
        .safeAreaInset(edge: .top, spacing: 0) {
            if auth.isAuthenticated, !auth.isScaffoldSession {
                Picker("Status", selection: $tab) {
                    ForEach(Tab.allCases) { t in
                        Text(t.rawValue).tag(t)
                    }
                }
                .pickerStyle(.segmented)
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
                .background(BrandTheme.navy)
                .accessibilityIdentifier("payments.history.segment")
            }
        }
        .task(id: tab) { await load() }
        .refreshable { await load() }
        .accessibilityIdentifier("payments.history.root")
    }

    private var emptyTitle: String {
        tab == .all ? "No payments yet" : "No \(tab.rawValue.lowercased()) payments"
    }

    private var emptyMessage: String {
        switch tab {
        case .all:
            return "Service contract escrow and releases appear here after you pay or get paid."
        case .escrow:
            return "No funds currently held in escrow."
        default:
            return "Nothing in this status right now."
        }
    }

    @ViewBuilder
    private func paymentRow(_ payment: ContractPayment) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(payment.displayAmount)
                    .font(.headline.monospacedDigit())
                    .foregroundStyle(BrandTheme.goldBright)
                Spacer(minLength: 8)
                Text(payment.displayStatus)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(BrandTheme.textSecondary)
            }
            if let contractNumber = payment.contractNumber?.trimmingCharacters(in: .whitespacesAndNewlines),
               !contractNumber.isEmpty
            {
                Text("Contract \(contractNumber)")
                    .font(.subheadline)
                    .foregroundStyle(BrandTheme.textPrimary)
            } else if let cid = payment.contractId, !cid.isEmpty {
                Text("Contract · \(String(cid.prefix(8)))…")
                    .font(.subheadline.monospaced())
                    .foregroundStyle(BrandTheme.textSecondary)
            }
            if let created = payment.createdAt, !created.isEmpty {
                Text(CatalogDateFormat.friendlyDateTime(created))
                    .font(.caption)
                    .foregroundStyle(BrandTheme.textSecondary)
            }
            if let payout = payment.displayProviderPayout {
                Text("Provider payout \(payout)")
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(BrandTheme.textSecondary)
            }
        }
        .frame(minHeight: 44)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(payment.displayAmount), \(payment.displayStatus)")
    }

    @MainActor
    private func load() async {
        guard auth.isAuthenticated, !auth.isScaffoldSession else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            let response = try await APIClient.shared.fetchPayments(
                status: tab.statusFilter,
                page: 1,
                pageSize: 50
            )
            payments = response.payments
            errorMessage = nil
        } catch {
            if payments.isEmpty {
                errorMessage = error.localizedDescription
            }
        }
    }
}

// MARK: - Positions blotter (web `/me/positions`)

/// Active market exposure: service bids, goods bids, watchlist — dual-rail desk.
struct PositionsBlotterView: View {
    @EnvironmentObject private var auth: AuthViewModel
    @State private var jobBids: [MyJobBidRow] = []
    @State private var listingBids: [MyListingBidEntry] = []
    @State private var watched: [ListingSummary] = []
    @State private var isLoading = false
    @State private var errorMessage: String?

    var body: some View {
        Group {
            if auth.isScaffoldSession || !auth.isAuthenticated {
                BrandEmptyState(
                    title: "Sign in required",
                    systemImage: "chart.bar.doc.horizontal",
                    message: "Sign in to see open bids and watched auctions on one desk."
                )
            } else if isLoading && isEmpty {
                BrandLoadingScreen(kind: .form, accessibilityLabel: "Loading positions…")
            } else if let errorMessage, isEmpty {
                BrandEmptyState(
                    title: "Couldn’t load positions",
                    systemImage: "exclamationmark.triangle",
                    message: errorMessage,
                    actionTitle: "Try again"
                ) {
                    Task { await load() }
                }
            } else {
                List {
                    Section {
                        if jobBids.isEmpty {
                            Text("No active service bids.")
                                .font(.caption)
                                .foregroundStyle(BrandTheme.textSecondary)
                        } else {
                            ForEach(jobBids) { bid in
                                NavigationLink {
                                    if let jobId = bid.jobId, !jobId.isEmpty {
                                        JobDetailView(jobID: jobId, preview: nil)
                                    } else {
                                        Text("Job unavailable")
                                            .foregroundStyle(BrandTheme.textSecondary)
                                    }
                                } label: {
                                    VStack(alignment: .leading, spacing: 4) {
                                        Text(bid.displayTitle)
                                            .font(.subheadline.weight(.semibold))
                                            .foregroundStyle(BrandTheme.textPrimary)
                                        Text("\(bid.displayAmount) · \(bid.displayStatus)")
                                            .font(.caption.monospacedDigit())
                                            .foregroundStyle(BrandTheme.goldBright)
                                    }
                                    .frame(minHeight: 44)
                                }
                            }
                        }
                    } header: {
                        Text("Service bids").brandSectionHeader()
                    }

                    Section {
                        if listingBids.isEmpty {
                            Text("No goods bids.")
                                .font(.caption)
                                .foregroundStyle(BrandTheme.textSecondary)
                        } else {
                            ForEach(listingBids) { entry in
                                NavigationLink {
                                    if let lid = entry.listingIdForAPI {
                                        ListingDetailView(listingID: lid, preview: nil)
                                    } else {
                                        Text("Listing unavailable")
                                            .foregroundStyle(BrandTheme.textSecondary)
                                    }
                                } label: {
                                    VStack(alignment: .leading, spacing: 4) {
                                        Text(entry.displayTitle)
                                            .font(.subheadline.weight(.semibold))
                                            .foregroundStyle(BrandTheme.textPrimary)
                                        HStack(spacing: 8) {
                                            Text(entry.displayAmount)
                                                .font(.caption.monospacedDigit())
                                                .foregroundStyle(BrandTheme.goldBright)
                                            if entry.isWinning {
                                                Text("Leading")
                                                    .font(.caption2.weight(.bold))
                                                    .foregroundStyle(BrandTheme.success)
                                            }
                                        }
                                    }
                                    .frame(minHeight: 44)
                                }
                            }
                        }
                    } header: {
                        Text("Goods bids").brandSectionHeader()
                    }

                    Section {
                        if watched.isEmpty {
                            Text("Watchlist is empty.")
                                .font(.caption)
                                .foregroundStyle(BrandTheme.textSecondary)
                        } else {
                            ForEach(watched) { listing in
                                NavigationLink {
                                    ListingDetailView(listingID: listing.id, preview: listing)
                                } label: {
                                    VStack(alignment: .leading, spacing: 4) {
                                        Text(listing.displayTitle)
                                            .font(.subheadline.weight(.semibold))
                                            .foregroundStyle(BrandTheme.textPrimary)
                                        Text("\(listing.displayPrice) · \(listing.priceCaption)")
                                            .font(.caption.monospacedDigit())
                                            .foregroundStyle(BrandTheme.goldBright)
                                    }
                                    .frame(minHeight: 44)
                                }
                            }
                        }
                    } header: {
                        Text("Watchlist").brandSectionHeader()
                    } footer: {
                        Text("Open exposure across reverse-auction jobs and forward-auction goods.")
                            .foregroundStyle(BrandTheme.textSecondary)
                    }
                }
                .brandListBackground()
            }
        }
        .navigationTitle("Positions")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .brandNavigationBarChrome()
        .task { await load() }
        .refreshable { await load() }
        .accessibilityIdentifier("positions.blotter.root")
    }

    private var isEmpty: Bool {
        jobBids.isEmpty && listingBids.isEmpty && watched.isEmpty
    }

    @MainActor
    private func load() async {
        guard auth.isAuthenticated, !auth.isScaffoldSession else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            async let jobs = APIClient.shared.fetchMyJobBids(page: 1, pageSize: 40)
            async let goods = APIClient.shared.fetchMyListingBids(page: 1, pageSize: 40)
            async let watch = APIClient.shared.fetchWatchlist(page: 1, pageSize: 40)
            let jobResp = try await jobs
            let goodsResp = try await goods
            let watchResp = try await watch
            jobBids = jobResp.bids
            listingBids = goodsResp.bids
            watched = watchResp.listings
            errorMessage = nil
        } catch {
            if isEmpty {
                errorMessage = error.localizedDescription
            }
        }
    }
}

// MARK: - Fair price index

/// Category fair-price lookup — `GET /api/v1/analytics/fair-price` (side 1 services).
struct FairPriceIndexView: View {
    @State private var categories: [ServiceCategorySummary] = []
    @State private var selectedCategoryId = ""
    @State private var selectedCategoryName = ""
    @State private var side: Int = 1
    @State private var fair: FairPriceResponse?
    @State private var isLoadingPrice = false
    @State private var errorMessage: String?

    var body: some View {
        List {
            Section {
                Text("Market median and p25–p75 bands from the fair-price engine. Soft-empty when a category has no index yet.")
                    .font(.footnote)
                    .foregroundStyle(BrandTheme.textSecondary)
                    .listRowBackground(BrandTheme.navyElevated)
            }

            Section {
                Picker("Side", selection: $side) {
                    Text("Services").tag(1)
                    Text("Goods").tag(2)
                }
                .pickerStyle(.segmented)
                .listRowBackground(BrandTheme.navyElevated)
                .accessibilityIdentifier("fairPrice.side")

                NavigationLink {
                    CategoryPickerView(selectedId: $selectedCategoryId, selectedName: $selectedCategoryName)
                } label: {
                    HStack {
                        Text("Category")
                        Spacer()
                        Text(selectedCategoryName.isEmpty ? "Choose…" : selectedCategoryName)
                            .foregroundStyle(
                                selectedCategoryName.isEmpty
                                    ? BrandTheme.textSecondary
                                    : BrandTheme.goldBright
                            )
                            .lineLimit(1)
                    }
                    .frame(minHeight: 44)
                }
                .listRowBackground(BrandTheme.navyElevated)
                .accessibilityIdentifier("fairPrice.category")
            } header: {
                Text("Lookup").brandSectionHeader()
            }

            Section {
                if isLoadingPrice {
                    HStack {
                        ProgressView()
                            .tint(BrandTheme.accent)
                        Text("Loading index…")
                            .font(.subheadline)
                            .foregroundStyle(BrandTheme.textSecondary)
                    }
                    .listRowBackground(BrandTheme.navyElevated)
                } else if let errorMessage {
                    Text(errorMessage)
                        .font(.subheadline)
                        .foregroundStyle(BrandTheme.warning)
                        .listRowBackground(BrandTheme.navyElevated)
                } else if selectedCategoryId.isEmpty {
                    Text("Pick a category to load the fair-price band.")
                        .font(.subheadline)
                        .foregroundStyle(BrandTheme.textSecondary)
                        .listRowBackground(BrandTheme.navyElevated)
                } else if let fair, fair.isUsable {
                    LabeledContent("Median") {
                        Text(MoneyFormat.usd(cents: fair.priceCents ?? 0))
                            .font(.body.monospacedDigit().weight(.semibold))
                            .foregroundStyle(BrandTheme.goldBright)
                    }
                    .listRowBackground(BrandTheme.navyElevated)
                    if let lo = fair.p25Cents, let hi = fair.p75Cents, lo > 0, hi > 0 {
                        LabeledContent("p25 – p75") {
                            Text("\(MoneyFormat.usd(cents: lo)) – \(MoneyFormat.usd(cents: hi))")
                                .font(.body.monospacedDigit())
                                .foregroundStyle(BrandTheme.textPrimary)
                        }
                        .listRowBackground(BrandTheme.navyElevated)
                    }
                    if let label = fair.confidenceLabel?.trimmingCharacters(in: .whitespacesAndNewlines),
                       !label.isEmpty
                    {
                        LabeledContent("Confidence", value: label)
                            .listRowBackground(BrandTheme.navyElevated)
                    }
                    if let n = fair.nEff, n > 0 {
                        LabeledContent("Effective n") {
                            Text(String(format: "%.1f", n))
                                .font(.body.monospacedDigit())
                        }
                        .listRowBackground(BrandTheme.navyElevated)
                    }
                    if let hint = fair.hintCaption {
                        Text(hint)
                            .font(.caption)
                            .foregroundStyle(BrandTheme.textSecondary)
                            .listRowBackground(BrandTheme.navyElevated)
                    }
                } else {
                    Text("No fair-price data for this category yet.")
                        .font(.subheadline)
                        .foregroundStyle(BrandTheme.textSecondary)
                        .listRowBackground(BrandTheme.navyElevated)
                }
            } header: {
                Text("Index").brandSectionHeader()
            }

            if !categories.isEmpty {
                Section {
                    ForEach(categories.prefix(12)) { cat in
                        Button {
                            selectedCategoryId = cat.id
                            selectedCategoryName = cat.displayName
                        } label: {
                            HStack {
                                Text(cat.displayName)
                                    .foregroundStyle(BrandTheme.textPrimary)
                                Spacer()
                                if cat.id == selectedCategoryId {
                                    Image(systemName: "checkmark")
                                        .foregroundStyle(BrandTheme.goldBright)
                                }
                            }
                            .frame(minHeight: 44)
                        }
                        .listRowBackground(BrandTheme.navyElevated)
                    }
                } header: {
                    Text("Quick pick").brandSectionHeader()
                }
            }
        }
        .brandListBackground()
        .navigationTitle("Fair price")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .brandNavigationBarChrome()
        .task { await loadCategories() }
        .task(id: "\(selectedCategoryId)|\(side)") { await loadPrice() }
        .onChange(of: side) { _, _ in BrandHaptics.selection() }
        .accessibilityIdentifier("fairPrice.root")
    }

    @MainActor
    private func loadCategories() async {
        do {
            categories = try await APIClient.shared.fetchServiceCategories(level: 1)
        } catch {
            // Non-blocking quick-pick list.
            categories = []
        }
    }

    @MainActor
    private func loadPrice() async {
        guard !selectedCategoryId.isEmpty else {
            fair = nil
            errorMessage = nil
            return
        }
        isLoadingPrice = true
        defer { isLoadingPrice = false }
        do {
            fair = try await APIClient.shared.fetchFairPrice(
                categoryId: selectedCategoryId,
                side: side
            )
            errorMessage = nil
        } catch {
            fair = nil
            errorMessage = error.localizedDescription
        }
    }
}

// MARK: - Marketplace map (web `/marketplace/map`)

/// MapKit pins for active goods listings with pickup coordinates.
struct MarketplaceMapView: View {
    @State private var listings: [ListingSummary] = []
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var selectedListing: ListingSummary?
    @State private var position: MapCameraPosition = .region(
        MKCoordinateRegion(
            center: CLLocationCoordinate2D(latitude: 39.8283, longitude: -98.5795),
            span: MKCoordinateSpan(latitudeDelta: 25, longitudeDelta: 25)
        )
    )
    @State private var userCoordinate: CLLocationCoordinate2D?
    @State private var locationManager = MapLocationManager()
    @State private var showLocationPrePrompt = false
    @State private var shouldRecenterOnUser = true

    private var mappable: [ListingSummary] {
        listings.filter { $0.pickupLat != nil && $0.pickupLng != nil }
    }

    var body: some View {
        content
            .navigationTitle("Marketplace map")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .brandNavigationBarChrome()
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        Task { await reload(recenter: true) }
                    } label: {
                        Label("Refresh", systemImage: "arrow.clockwise")
                    }
                    .frame(minHeight: 44)
                    .disabled(isLoading)
                    .accessibilityIdentifier("marketplace.map.refresh")
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        requestUserLocation()
                    } label: {
                        Label("My location", systemImage: "location.fill")
                    }
                    .frame(minHeight: 44)
                    .accessibilityHint("Centers the map on your location when permitted")
                }
            }
            .task {
                locationManager.onUpdate = { coord in
                    userCoordinate = coord
                }
                await reload(recenter: true)
            }
            .onChange(of: userCoordinate?.latitude) { _, _ in
                if let userCoordinate, mappable.isEmpty || shouldRecenterOnUser {
                    Task { await reloadAround(userCoordinate, recenter: true) }
                }
            }
            .navigationDestination(item: $selectedListing) { listing in
                ListingDetailView(listingID: listing.id, preview: listing)
            }
            .alert("Location for nearby listings", isPresented: $showLocationPrePrompt) {
                Button("Continue") {
                    locationManager.requestWhenInUse()
                }
                Button("Not now", role: .cancel) {}
            } message: {
                Text(LocationPurposeCopy.marketPickerPrePrompt)
            }
            .accessibilityIdentifier("marketplace.map.root")
    }

    private var content: some View {
        ZStack {
            Map(position: $position) {
                UserAnnotation()
                ForEach(mappable) { listing in
                    if let lat = listing.pickupLat, let lng = listing.pickupLng {
                        Annotation(
                            listing.displayTitle,
                            coordinate: CLLocationCoordinate2D(latitude: lat, longitude: lng)
                        ) {
                            Button {
                                selectedListing = listing
                            } label: {
                                VStack(spacing: 2) {
                                    Image(systemName: "bag.circle.fill")
                                        .font(.title2)
                                        .foregroundStyle(BrandTheme.accent)
                                        .shadow(color: .black.opacity(0.35), radius: 3, y: 1)
                                    Text(listing.displayPrice)
                                        .font(.caption2.weight(.semibold).monospacedDigit())
                                        .foregroundStyle(BrandTheme.ctaLabelOnGold)
                                        .padding(.horizontal, 6)
                                        .padding(.vertical, 2)
                                        .background(BrandTheme.gold, in: Capsule())
                                }
                                .frame(minWidth: 44, minHeight: 44)
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel("\(listing.displayTitle), \(listing.displayPrice)")
                            .accessibilityHint("Opens listing detail")
                        }
                    }
                }
            }
            .mapStyle(.standard(elevation: .realistic))
            .mapControls {
                MapCompass()
                MapPitchToggle()
                MapUserLocationButton()
            }

            if isLoading && listings.isEmpty {
                BrandLoadingScreen(kind: .form, accessibilityLabel: "Loading marketplace map…")
                    .padding(16)
                    .background(BrandTheme.navyElevated.opacity(0.92), in: RoundedRectangle(cornerRadius: 12))
            }

            if let errorMessage, listings.isEmpty {
                VStack(spacing: 12) {
                    Text("Couldn’t load listings")
                        .font(.headline)
                        .foregroundStyle(BrandTheme.textPrimary)
                    Text(errorMessage)
                        .font(.subheadline)
                        .foregroundStyle(BrandTheme.textSecondary)
                        .multilineTextAlignment(.center)
                    Button("Try again") {
                        Task { await reload(recenter: false) }
                    }
                    .brandPrimaryButton()
                    .frame(maxWidth: 200)
                }
                .padding(24)
                .brandCard(padding: 20)
                .padding(24)
            }

            VStack {
                Spacer()
                HStack {
                    Text(footerLabel)
                        .font(.caption)
                        .foregroundStyle(BrandTheme.textSecondary)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                        .background(BrandTheme.navyElevated.opacity(0.92), in: Capsule())
                        .padding(12)
                    Spacer()
                }
            }
        }
        .brandScreenBackground()
    }

    private var footerLabel: String {
        if isLoading { return "Updating…" }
        let count = mappable.count
        if count == 0 { return "No listings with map pins nearby" }
        return "\(String(localized: "\(count) listings")) with pickup pins"
    }

    private func requestUserLocation() {
        switch locationManager.authorizationStatus {
        case .notDetermined:
            showLocationPrePrompt = true
        case .authorizedAlways, .authorizedWhenInUse:
            locationManager.requestWhenInUse()
            if let userCoordinate {
                Task { await reloadAround(userCoordinate, recenter: true) }
            }
        case .denied, .restricted:
            errorMessage = "Location is off. Open Settings → NoMarkup → Location, or pan the map to explore listings."
            #if canImport(UIKit)
            if let url = URL(string: UIApplication.openSettingsURLString) {
                UIApplication.shared.open(url)
            }
            #endif
        @unknown default:
            break
        }
    }

    @MainActor
    private func reload(recenter: Bool) async {
        if let userCoordinate {
            await reloadAround(userCoordinate, recenter: recenter)
            return
        }
        if locationManager.authorizationStatus == .notDetermined {
            showLocationPrePrompt = true
        } else if locationManager.authorizationStatus == .authorizedWhenInUse
            || locationManager.authorizationStatus == .authorizedAlways
        {
            locationManager.requestWhenInUse()
        }
        await reloadAround(nil, recenter: false)
    }

    @MainActor
    private func reloadAround(_ coordinate: CLLocationCoordinate2D?, recenter: Bool) async {
        isLoading = true
        if listings.isEmpty { errorMessage = nil }
        defer { isLoading = false }

        do {
            let response = try await APIClient.shared.fetchListings(
                page: 1,
                pageSize: 100,
                latitude: coordinate?.latitude,
                longitude: coordinate?.longitude,
                radiusKm: coordinate == nil ? nil : 50
            )
            listings = response.listings
            errorMessage = nil

            if recenter {
                if let coordinate {
                    position = .region(
                        MKCoordinateRegion(
                            center: coordinate,
                            span: MKCoordinateSpan(latitudeDelta: 0.4, longitudeDelta: 0.4)
                        )
                    )
                    shouldRecenterOnUser = false
                } else if let first = mappable.first,
                          let lat = first.pickupLat,
                          let lng = first.pickupLng
                {
                    position = .region(
                        MKCoordinateRegion(
                            center: CLLocationCoordinate2D(latitude: lat, longitude: lng),
                            span: MKCoordinateSpan(latitudeDelta: 0.5, longitudeDelta: 0.5)
                        )
                    )
                }
            }
        } catch {
            if listings.isEmpty {
                errorMessage = error.localizedDescription
            }
        }
    }
}

// MARK: - Admin console (web `/admin/*`)

/// Read-only admin desk: flags, disputes, users, reports, fraud.
/// Requires admin role server-side; non-admins get an empty/403 state.
struct AdminConsoleView: View {
    private enum SectionTab: String, CaseIterable, Identifiable {
        case flags = "Flags"
        case disputes = "Disputes"
        case users = "Users"
        case goodsReports = "Goods"
        case userReports = "Users reports"
        case fraud = "Fraud"

        var id: String { rawValue }
    }

    @EnvironmentObject private var auth: AuthViewModel
    @State private var tab: SectionTab = .flags
    @State private var flags: [AdminFeatureFlag] = []
    @State private var disputes: [AdminDisputeRow] = []
    @State private var users: [AdminUserRow] = []
    @State private var goodsReports: [AdminReportRow] = []
    @State private var userReports: [AdminReportRow] = []
    @State private var fraudAlerts: [AdminFraudAlert] = []
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var forbidden = false

    var body: some View {
        Group {
            if auth.isScaffoldSession || !auth.isAuthenticated {
                BrandEmptyState(
                    title: "Sign in required",
                    systemImage: "lock.shield",
                    message: "Admin console requires an authenticated admin session."
                )
            } else if forbidden {
                BrandEmptyState(
                    title: "Admin only",
                    systemImage: "hand.raised.fill",
                    message: "This account does not have the admin role. Contact a platform operator if you need access."
                )
            } else if isLoading && isEmpty {
                BrandLoadingScreen(kind: .form, accessibilityLabel: "Loading admin console…")
            } else if let errorMessage, isEmpty {
                BrandEmptyState(
                    title: "Couldn’t load admin data",
                    systemImage: "exclamationmark.triangle",
                    message: errorMessage,
                    actionTitle: "Try again"
                ) {
                    Task { await load() }
                }
            } else {
                List {
                    switch tab {
                    case .flags:
                        ForEach(flags) { flag in
                            HStack(alignment: .top, spacing: 12) {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(flag.displayTitle)
                                        .font(.subheadline.weight(.semibold))
                                        .foregroundStyle(BrandTheme.textPrimary)
                                    Text(flag.key)
                                        .font(.caption2.monospaced())
                                        .foregroundStyle(BrandTheme.textSecondary)
                                    if let pct = flag.rolloutPercent {
                                        Text("Rollout \(pct)%")
                                            .font(.caption)
                                            .foregroundStyle(BrandTheme.textSecondary)
                                    }
                                }
                                Spacer()
                                Text(flag.isOn ? "ON" : "OFF")
                                    .font(.caption.weight(.bold))
                                    .foregroundStyle(flag.isOn ? BrandTheme.success : BrandTheme.textSecondary)
                            }
                            .listRowBackground(BrandTheme.navyElevated)
                            .frame(minHeight: 44)
                        }
                    case .disputes:
                        if disputes.isEmpty {
                            Text("No open disputes.")
                                .foregroundStyle(BrandTheme.textSecondary)
                                .listRowBackground(BrandTheme.navyElevated)
                        } else {
                            ForEach(disputes) { d in
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(d.status ?? "unknown")
                                        .font(.subheadline.weight(.semibold))
                                    if let t = d.disputeType {
                                        Text(t).font(.caption).foregroundStyle(BrandTheme.textSecondary)
                                    }
                                    Text(String(d.id.prefix(8)) + "…")
                                        .font(.caption2.monospaced())
                                        .foregroundStyle(BrandTheme.textSecondary)
                                }
                                .listRowBackground(BrandTheme.navyElevated)
                            }
                        }
                    case .users:
                        ForEach(users) { u in
                            VStack(alignment: .leading, spacing: 4) {
                                Text(u.displayLabel)
                                    .font(.subheadline.weight(.semibold))
                                if let roles = u.roles, !roles.isEmpty {
                                    Text(roles.joined(separator: ", "))
                                        .font(.caption)
                                        .foregroundStyle(BrandTheme.textSecondary)
                                }
                            }
                            .listRowBackground(BrandTheme.navyElevated)
                            .frame(minHeight: 44)
                        }
                    case .goodsReports:
                        reportRows(goodsReports)
                    case .userReports:
                        reportRows(userReports)
                    case .fraud:
                        if fraudAlerts.isEmpty {
                            Text("No fraud alerts.")
                                .foregroundStyle(BrandTheme.textSecondary)
                                .listRowBackground(BrandTheme.navyElevated)
                        } else {
                            ForEach(fraudAlerts) { a in
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(a.severity ?? a.status ?? "alert")
                                        .font(.subheadline.weight(.semibold))
                                    if let s = a.summary {
                                        Text(s)
                                            .font(.caption)
                                            .foregroundStyle(BrandTheme.textSecondary)
                                    }
                                }
                                .listRowBackground(BrandTheme.navyElevated)
                            }
                        }
                    }
                }
                .brandListBackground()
            }
        }
        .navigationTitle("Admin")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .brandNavigationBarChrome()
        .safeAreaInset(edge: .top, spacing: 0) {
            if auth.isAuthenticated, !auth.isScaffoldSession, !forbidden {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(SectionTab.allCases) { t in
                            Button {
                                BrandHaptics.selection()
                                tab = t
                            } label: {
                                Text(t.rawValue)
                                    .font(.caption.weight(.semibold))
                                    .padding(.horizontal, 12)
                                    .padding(.vertical, 8)
                                    .background(
                                        tab == t ? BrandTheme.gold : BrandTheme.navyElevated,
                                        in: Capsule()
                                    )
                                    .foregroundStyle(
                                        tab == t ? BrandTheme.ctaLabelOnGold : BrandTheme.textSecondary
                                    )
                            }
                            .frame(minHeight: 44)
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 8)
                }
                .background(BrandTheme.navy)
                .accessibilityIdentifier("admin.console.tabs")
            }
        }
        .task(id: tab) { await load() }
        .refreshable { await load() }
        .accessibilityIdentifier("admin.console.root")
    }

    private var isEmpty: Bool {
        switch tab {
        case .flags: return flags.isEmpty
        case .disputes: return disputes.isEmpty
        case .users: return users.isEmpty
        case .goodsReports: return goodsReports.isEmpty
        case .userReports: return userReports.isEmpty
        case .fraud: return fraudAlerts.isEmpty
        }
    }

    @ViewBuilder
    private func reportRows(_ rows: [AdminReportRow]) -> some View {
        if rows.isEmpty {
            Text("No reports.")
                .foregroundStyle(BrandTheme.textSecondary)
                .listRowBackground(BrandTheme.navyElevated)
        } else {
            ForEach(rows) { r in
                VStack(alignment: .leading, spacing: 4) {
                    Text(r.status ?? "open")
                        .font(.subheadline.weight(.semibold))
                    if let reason = r.reason {
                        Text(reason)
                            .font(.caption)
                            .foregroundStyle(BrandTheme.textSecondary)
                    }
                }
                .listRowBackground(BrandTheme.navyElevated)
            }
        }
    }

    @MainActor
    private func load() async {
        guard auth.isAuthenticated, !auth.isScaffoldSession else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            switch tab {
            case .flags:
                flags = try await APIClient.shared.fetchAdminFlags()
            case .disputes:
                disputes = try await APIClient.shared.fetchAdminDisputes().disputes
            case .users:
                users = try await APIClient.shared.fetchAdminUsers().users
            case .goodsReports:
                goodsReports = try await APIClient.shared.fetchAdminGoodsReports().reports
            case .userReports:
                userReports = try await APIClient.shared.fetchAdminUserReports().reports
            case .fraud:
                fraudAlerts = try await APIClient.shared.fetchAdminFraudAlerts().alerts
            }
            forbidden = false
            errorMessage = nil
        } catch let error as APIClientError {
            if error.isForbidden {
                forbidden = true
                errorMessage = nil
            } else if isEmpty {
                errorMessage = error.localizedDescription
            }
        } catch {
            if isEmpty {
                errorMessage = error.localizedDescription
            }
        }
    }
}

// MARK: - Installment plan detail (BNPL field compatibility)

/// Detail for `InstallmentPlan` — id, contractId, installmentCount, totalAmountCents,
/// status, and schedule rows (`installmentNumber`, `amountCents`, `status`, `dueDate`, `paidAt`).
struct InstallmentPlanDetailView: View {
    let planId: String
    var preview: InstallmentPlan?

    @EnvironmentObject private var auth: AuthViewModel
    @State private var plan: InstallmentPlan?
    @State private var isLoading = false
    @State private var errorMessage: String?

    init(planId: String, preview: InstallmentPlan? = nil) {
        self.planId = planId
        self.preview = preview
        _plan = State(initialValue: preview)
    }

    var body: some View {
        Group {
            if isLoading && plan == nil {
                BrandLoadingScreen(kind: .form, accessibilityLabel: "Loading plan…")
            } else if let errorMessage, plan == nil {
                BrandEmptyState(
                    title: "Couldn’t load plan",
                    systemImage: "exclamationmark.triangle",
                    message: errorMessage,
                    actionTitle: "Try again"
                ) {
                    Task { await load() }
                }
            } else if let plan {
                List {
                    Section {
                        LabeledContent("Total") {
                            Text(plan.displayTotal)
                                .font(.body.monospacedDigit().weight(.semibold))
                                .foregroundStyle(BrandTheme.goldBright)
                        }
                        LabeledContent("Status", value: plan.displayStatus)
                        if let count = plan.installmentCount {
                            LabeledContent("Installments", value: "\(count)")
                        }
                        if let cid = plan.contractId, !cid.isEmpty {
                            LabeledContent("Contract") {
                                Text(String(cid.prefix(8)) + "…")
                                    .font(.caption.monospaced())
                            }
                        }
                        LabeledContent("Plan ID") {
                            Text(String(plan.id.prefix(8)) + "…")
                                .font(.caption.monospaced())
                        }
                    } header: {
                        Text("Plan").brandSectionHeader()
                    }
                    .listRowBackground(BrandTheme.navyElevated)

                    if let rows = plan.installments, !rows.isEmpty {
                        Section {
                            ForEach(rows) { row in
                                VStack(alignment: .leading, spacing: 4) {
                                    HStack {
                                        Text("#\(row.installmentNumber ?? 0)")
                                            .font(.subheadline.weight(.semibold))
                                        Spacer()
                                        Text(row.displayAmount)
                                            .font(.subheadline.monospacedDigit())
                                            .foregroundStyle(BrandTheme.goldBright)
                                    }
                                    Text(StatusChipStyle.displayLabel(row.status ?? "unknown"))
                                        .font(.caption)
                                        .foregroundStyle(BrandTheme.textSecondary)
                                    if let due = row.dueDate, !due.isEmpty {
                                        Text("Due \(CatalogDateFormat.friendlyDateTime(due))")
                                            .font(.caption)
                                            .foregroundStyle(BrandTheme.textSecondary)
                                    }
                                    if let paid = row.paidAt, !paid.isEmpty {
                                        Text("Paid \(CatalogDateFormat.friendlyDateTime(paid))")
                                            .font(.caption)
                                            .foregroundStyle(BrandTheme.success)
                                    }
                                }
                                .listRowBackground(BrandTheme.navyElevated)
                                .frame(minHeight: 44)
                            }
                        } header: {
                            Text("Schedule").brandSectionHeader()
                        }
                    }
                }
                .brandListBackground()
            } else {
                BrandEmptyState(
                    title: "Plan not found",
                    systemImage: "calendar",
                    message: "This installment plan could not be loaded."
                )
            }
        }
        .navigationTitle("Payment plan")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .brandNavigationBarChrome()
        .task { await load() }
        .refreshable { await load() }
    }

    @MainActor
    private func load() async {
        guard auth.isAuthenticated, !auth.isScaffoldSession else { return }
        let id = planId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !id.isEmpty else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            plan = try await APIClient.shared.fetchInstallmentPlan(id: id)
            errorMessage = nil
        } catch {
            if plan == nil {
                errorMessage = error.localizedDescription
            }
        }
    }
}
