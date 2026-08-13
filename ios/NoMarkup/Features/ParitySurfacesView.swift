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

/// Admin desk: flags, disputes, users (suspend/ban/reactivate/finalize-deletion),
/// goods/user reports, fraud, advances, jobs, listings, goods disputes, markets,
/// taxonomy questions, insurers, challenges (+ other AdminOpsViews panels).
/// Requires admin role; soft 403, never crashes.
struct AdminConsoleView: View {
    private enum SectionTab: String, CaseIterable, Identifiable {
        case flags = "Flags"
        case jobs = "Jobs"
        case listings = "Listings"
        case disputes = "Disputes"
        case goodsDisputes = "Goods disputes"
        case guarantee = "Guarantee"
        case verification = "Verify"
        case licenses = "Licenses"
        case insurance = "Insurance"
        case reviews = "Reviews"
        case users = "Users"
        case goodsReports = "Goods"
        case userReports = "Users reports"
        case fraud = "Fraud"
        case advances = "Advances"
        case fees = "Fees"
        case banking = "Banking"
        case platform = "Platform"
        case markets = "Markets"
        case taxonomy = "Taxonomy"
        case insurers = "Insurers"
        case challenges = "Challenges"

        var id: String { rawValue }

        /// Menu + destination id slug (`admin.console.tab.<slug>`, `admin.<slug>.root`).
        var slug: String {
            rawValue.lowercased().replacingOccurrences(of: " ", with: "-")
        }

        /// Tabs hosted by standalone AdminOpsViews panels (own List + load).
        var isOpsPanel: Bool {
            switch self {
            case .jobs, .listings, .goodsDisputes,
                 .guarantee, .verification, .licenses, .insurance, .reviews,
                 .fees, .banking, .platform,
                 .markets, .taxonomy, .insurers, .challenges:
                return true
            default:
                return false
            }
        }
    }

    private enum ReportKind {
        case goods
        case user
    }

    private enum FraudReviewAction: String, Identifiable {
        case legitimate = "resolved_legitimate"
        case fraud = "resolved_fraud"
        case dismiss = "dismissed"

        var id: String { rawValue }

        var label: String {
            switch self {
            case .legitimate: return "Legitimate"
            case .fraud: return "Confirm fraud"
            case .dismiss: return "Dismiss"
            }
        }
    }

    private enum DisputeResolveAction: String, Identifiable {
        case favorCustomer = "favor_customer"
        case favorProvider = "favor_provider"
        case split = "split"
        case dismissed = "dismissed"

        var id: String { rawValue }

        var label: String {
            switch self {
            case .favorCustomer: return "Favor customer"
            case .favorProvider: return "Favor provider"
            case .split: return "Split"
            case .dismissed: return "Dismiss"
            }
        }
    }

    private enum UserModerationAction: String, Identifiable {
        case suspend
        case ban

        var id: String { rawValue }

        var label: String {
            switch self {
            case .suspend: return "Suspend"
            case .ban: return "Ban"
            }
        }
    }

    @EnvironmentObject private var auth: AuthViewModel
    @Environment(\.openURL) private var openURL
    @State private var tab: SectionTab = .flags
    @State private var flags: [AdminFeatureFlag] = []
    @State private var disputes: [AdminDisputeRow] = []
    @State private var users: [AdminUserRow] = []
    @State private var goodsReports: [AdminReportRow] = []
    @State private var userReports: [AdminReportRow] = []
    @State private var fraudAlerts: [AdminFraudAlert] = []
    @State private var advances: [WorkingCapitalAdvance] = []
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var actionMessage: String?
    @State private var forbidden = false
    /// Flag keys currently being mutated (toggle or rollout save).
    @State private var busyFlagKeys: Set<String> = []
    /// Draft rollout % keyed by flag key (string so TextField stays editable).
    @State private var rolloutDrafts: [String: String] = [:]
    @State private var busyFraudIDs: Set<String> = []
    @State private var fraudReviewTarget: AdminFraudAlert?
    @State private var fraudReviewNotes = ""
    @State private var fraudReviewAction: FraudReviewAction = .legitimate
    @State private var fraudRestrictUser = false
    @State private var fraudBanUser = false
    @State private var showFraudReviewSheet = false
    @State private var busyDisputeIDs: Set<String> = []
    @State private var disputeResolveTarget: AdminDisputeRow?
    @State private var disputeResolveNotes = ""
    @State private var disputeResolveAction: DisputeResolveAction = .favorCustomer
    @State private var disputeRefundText = ""
    @State private var disputeGuaranteeOutcome = ""
    @State private var showDisputeResolveSheet = false
    @State private var busyReportIDs: Set<String> = []
    @State private var busyUserIDs: Set<String> = []
    @State private var pendingFinalizeUser: AdminUserRow?
    @State private var busyAdvanceIDs: Set<String> = []
    @State private var userActionTarget: AdminUserRow?
    @State private var userActionKind: UserModerationAction = .suspend
    @State private var userActionReason = ""
    @State private var showUserActionSheet = false

    var body: some View {
        adminConsoleBody
        .navigationTitle("Admin")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .brandNavigationBarChrome()
        .safeAreaInset(edge: .top, spacing: 0) {
            if auth.isAuthenticated, !auth.isScaffoldSession, !forbidden {
                adminTabStrip
            }
        }
        .sheet(isPresented: $showFraudReviewSheet) {
            fraudReviewSheet
        }
        .sheet(isPresented: $showDisputeResolveSheet) {
            disputeResolveSheet
        }
        .sheet(isPresented: $showUserActionSheet) {
            userActionSheet
        }
        .confirmationDialog(
            "Finalize account deletion?",
            isPresented: Binding(
                get: { pendingFinalizeUser != nil },
                set: { if !$0 { pendingFinalizeUser = nil } }
            ),
            titleVisibility: .visible
        ) {
            Button("Finalize deletion", role: .destructive) {
                guard let user = pendingFinalizeUser else { return }
                pendingFinalizeUser = nil
                Task { await finalizeUserDeletion(user) }
            }
            Button("Cancel", role: .cancel) { pendingFinalizeUser = nil }
        } message: {
            if let user = pendingFinalizeUser {
                Text("Permanently erase \(user.displayLabel) now, bypassing the 30-day grace. This cannot be undone.")
            } else {
                Text("Permanently erase this account now, bypassing the 30-day grace. This cannot be undone.")
            }
        }
        .task(id: tab) { await load() }
        .refreshable { await load() }
        .accessibilityIdentifier("admin.console.root")
    }

    /// Section picker. A horizontal `ScrollView` of 22 capsules inside
    /// `safeAreaInset` collapses to 0 height on iOS 26 (17e: blank band,
    /// tabs untappable). A labeled menu stays visible and reaches every tab.
    /// Per-tab ids are kept on menu rows for UITests (`admin.console.tab.*`).
    private var adminTabStrip: some View {
        HStack(spacing: 10) {
            Text("Section")
                .font(.caption.weight(.semibold))
                .foregroundStyle(BrandTheme.textSecondary)
                .accessibilityHidden(true)
            Menu {
                ForEach(SectionTab.allCases) { t in
                    Button {
                        BrandHaptics.selection()
                        tab = t
                    } label: {
                        if t == tab {
                            Label(t.rawValue, systemImage: "checkmark")
                        } else {
                            Text(t.rawValue)
                        }
                    }
                    .accessibilityIdentifier("admin.console.tab.\(t.slug)")
                }
            } label: {
                HStack(spacing: 6) {
                    Text(tab.rawValue)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(BrandTheme.ctaLabelOnGold)
                        .lineLimit(1)
                        .fixedSize(horizontal: true, vertical: false)
                    Image(systemName: "chevron.up.chevron.down")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(BrandTheme.ctaLabelOnGold)
                        .accessibilityHidden(true)
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 8)
                .background(BrandTheme.gold, in: Capsule())
                .frame(minHeight: 44)
                .fixedSize(horizontal: true, vertical: false)
                .contentShape(Capsule())
            }
            .accessibilityLabel("Admin section, \(tab.rawValue)")
            .accessibilityIdentifier("admin.console.tabs.menu")
            Spacer(minLength: 8)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 6)
        .frame(maxWidth: .infinity)
        .background(BrandTheme.surfaceRaised)
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(BrandTheme.hairline)
                .frame(height: 1)
                .accessibilityHidden(true)
        }
        .accessibilityIdentifier("admin.console.tabs")
    }

    @ViewBuilder
    private var adminConsoleBody: some View {
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
            } else if tab.isOpsPanel {
                VStack(spacing: 0) {
                    if let actionMessage {
                        Text(actionMessage)
                            .font(.caption)
                            .foregroundStyle(BrandTheme.textSecondary)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, 16)
                            .padding(.vertical, 8)
                            .background(BrandTheme.navyElevated)
                            .accessibilityIdentifier("admin.console.actionMessage")
                    }
                    switch tab {
                    case .jobs:
                        AdminJobsOpsView(forbidden: $forbidden, actionMessage: $actionMessage)
                    case .listings:
                        AdminListingsOpsView(forbidden: $forbidden, actionMessage: $actionMessage)
                    case .goodsDisputes:
                        AdminGoodsDisputesOpsView(forbidden: $forbidden, actionMessage: $actionMessage)
                    case .guarantee:
                        AdminGuaranteeOpsView(forbidden: $forbidden, actionMessage: $actionMessage)
                    case .verification:
                        AdminVerificationOpsView(forbidden: $forbidden, actionMessage: $actionMessage)
                    case .licenses:
                        AdminLicensesOpsView(forbidden: $forbidden, actionMessage: $actionMessage)
                    case .insurance:
                        AdminInsuranceOpsView(forbidden: $forbidden, actionMessage: $actionMessage)
                    case .reviews:
                        AdminFlaggedReviewsOpsView(forbidden: $forbidden, actionMessage: $actionMessage)
                    case .fees:
                        AdminFeesView(
                            embedded: true,
                            forbidden: $forbidden,
                            actionMessage: $actionMessage
                        )
                    case .banking:
                        AdminBankingView(
                            embedded: true,
                            forbidden: $forbidden,
                            actionMessage: $actionMessage
                        )
                    case .platform:
                        AdminPlatformMetricsView(
                            embedded: true,
                            forbidden: $forbidden,
                            actionMessage: $actionMessage
                        )
                    case .markets:
                        AdminMarketsOpsView(forbidden: $forbidden, actionMessage: $actionMessage)
                    case .taxonomy:
                        AdminTaxonomyOpsView(forbidden: $forbidden, actionMessage: $actionMessage)
                    case .insurers:
                        AdminInsurersOpsView(forbidden: $forbidden, actionMessage: $actionMessage)
                    case .challenges:
                        AdminChallengesOpsView(forbidden: $forbidden, actionMessage: $actionMessage)
                    default:
                        EmptyView()
                    }
                }
            } else {
                List {
                    if let actionMessage {
                        Section {
                            Text(actionMessage)
                                .font(.caption)
                                .foregroundStyle(BrandTheme.textSecondary)
                                .listRowBackground(BrandTheme.navyElevated)
                                .accessibilityIdentifier("admin.console.actionMessage")
                        }
                    }
                    switch tab {
                    case .flags:
                        flagRows
                    case .jobs, .listings, .goodsDisputes,
                         .guarantee, .verification, .licenses, .insurance, .reviews,
                         .fees, .banking, .platform,
                         .markets, .taxonomy, .insurers, .challenges:
                        EmptyView()
                    case .disputes:
                        disputeRows
                    case .users:
                        userRows
                    case .goodsReports:
                        reportRows(goodsReports, kind: .goods)
                    case .userReports:
                        reportRows(userReports, kind: .user)
                    case .fraud:
                        fraudRows
                    case .advances:
                        advanceRows
                    }
                }
                .brandListBackground()
            }
        }
        // Always present so UITests can wait on `admin.<slug>.root` even while
        // the inline list is still on BrandLoadingScreen (isLoading && isEmpty).
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("admin.\(tab.slug).root")
    }

    // MARK: - Flag rows

    @ViewBuilder
    private var flagRows: some View {
        if flags.isEmpty {
            Text("No feature flags.")
                .foregroundStyle(BrandTheme.textSecondary)
                .listRowBackground(BrandTheme.navyElevated)
        } else {
            ForEach(flags) { flag in
                let busy = busyFlagKeys.contains(flag.key)
                VStack(alignment: .leading, spacing: 10) {
                    HStack(alignment: .center, spacing: 12) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(flag.displayTitle)
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(BrandTheme.textPrimary)
                            Text(flag.key)
                                .font(.caption2.monospaced())
                                .foregroundStyle(BrandTheme.textSecondary)
                            if flag.isBinaryOnly {
                                Text("Binary only (money/regulated)")
                                    .font(.caption2)
                                    .foregroundStyle(BrandTheme.warning)
                            }
                        }
                        Spacer(minLength: 8)
                        Toggle(
                            "",
                            isOn: Binding(
                                get: { flag.isOn },
                                set: { newValue in
                                    Task { await toggleFlag(flag, enabled: newValue) }
                                }
                            )
                        )
                        .labelsHidden()
                        .disabled(busy)
                        .accessibilityLabel("Enable \(flag.key)")
                        .accessibilityIdentifier("admin.flag.toggle.\(flag.key)")
                    }
                    if !flag.isBinaryOnly {
                        HStack(spacing: 8) {
                            Text("Rollout %")
                                .font(.caption)
                                .foregroundStyle(BrandTheme.textSecondary)
                            TextField(
                                "0–100",
                                text: Binding(
                                    get: {
                                        rolloutDrafts[flag.key]
                                            ?? String(flag.rolloutPercent ?? 100)
                                    },
                                    set: { rolloutDrafts[flag.key] = $0 }
                                )
                            )
                            #if os(iOS)
                            .keyboardType(.numberPad)
                            #endif
                            .textFieldStyle(.roundedBorder)
                            .frame(maxWidth: 72)
                            .disabled(busy)
                            .accessibilityIdentifier("admin.flag.rollout.\(flag.key)")
                            Button("Save") {
                                Task { await saveFlagRollout(flag) }
                            }
                            .font(.caption.weight(.semibold))
                            .disabled(busy || !rolloutDraftChanged(flag))
                            .frame(minHeight: 44)
                            .accessibilityIdentifier("admin.flag.saveRollout.\(flag.key)")
                            if busy {
                                ProgressView()
                                    .controlSize(.small)
                            }
                        }
                    } else if busy {
                        ProgressView()
                            .controlSize(.small)
                    }
                }
                .listRowBackground(BrandTheme.navyElevated)
                .frame(minHeight: 44)
            }
        }
    }

    // MARK: - Dispute rows

    @ViewBuilder
    private var disputeRows: some View {
        if disputes.isEmpty {
            Text("No open disputes.")
                .foregroundStyle(BrandTheme.textSecondary)
                .listRowBackground(BrandTheme.navyElevated)
        } else {
            ForEach(disputes) { d in
                VStack(alignment: .leading, spacing: 8) {
                    HStack(alignment: .top) {
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
                        Spacer(minLength: 8)
                        if d.isOpenForResolution {
                            Button("Resolve") {
                                disputeResolveTarget = d
                                disputeResolveNotes = ""
                                disputeResolveAction = .favorCustomer
                                disputeRefundText = ""
                                disputeGuaranteeOutcome = ""
                                showDisputeResolveSheet = true
                            }
                            .font(.caption.weight(.semibold))
                            .disabled(busyDisputeIDs.contains(d.id))
                            .frame(minHeight: 44)
                            .accessibilityIdentifier("admin.dispute.resolve.\(d.id)")
                        }
                    }
                    Button {
                        openDisputeOnWeb(d.id)
                    } label: {
                        Label("Open on web", systemImage: "safari")
                            .font(.caption)
                    }
                    .frame(minHeight: 44)
                    .accessibilityIdentifier("admin.dispute.web.\(d.id)")
                }
                .listRowBackground(BrandTheme.navyElevated)
            }
        }
    }

    // MARK: - Fraud rows

    @ViewBuilder
    private var fraudRows: some View {
        if fraudAlerts.isEmpty {
            Text("No fraud alerts.")
                .foregroundStyle(BrandTheme.textSecondary)
                .listRowBackground(BrandTheme.navyElevated)
        } else {
            ForEach(fraudAlerts) { a in
                VStack(alignment: .leading, spacing: 8) {
                    HStack(alignment: .top) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(a.displayRisk.uppercased())
                                .font(.subheadline.weight(.semibold))
                            Text(a.status ?? "open")
                                .font(.caption)
                                .foregroundStyle(BrandTheme.textSecondary)
                            if let uid = a.userId, !uid.isEmpty {
                                Text("User \(String(uid.prefix(8)))…")
                                    .font(.caption2.monospaced())
                                    .foregroundStyle(BrandTheme.textSecondary)
                            }
                            if let s = a.summary, !s.isEmpty {
                                Text(s)
                                    .font(.caption)
                                    .foregroundStyle(BrandTheme.textSecondary)
                            }
                        }
                        Spacer(minLength: 8)
                        if !a.isResolved {
                            Button("Review") {
                                fraudReviewTarget = a
                                fraudReviewNotes = ""
                                fraudReviewAction = .legitimate
                                fraudRestrictUser = false
                                fraudBanUser = false
                                showFraudReviewSheet = true
                            }
                            .font(.caption.weight(.semibold))
                            .disabled(busyFraudIDs.contains(a.id))
                            .frame(minHeight: 44)
                            .accessibilityIdentifier("admin.fraud.review.\(a.id)")
                        }
                    }
                    if busyFraudIDs.contains(a.id) {
                        ProgressView()
                            .controlSize(.small)
                    }
                }
                .listRowBackground(BrandTheme.navyElevated)
            }
        }
    }

    // MARK: - Sheets

    private var fraudReviewSheet: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("Outcome", selection: $fraudReviewAction) {
                        ForEach([FraudReviewAction.legitimate, .fraud, .dismiss]) { action in
                            Text(action.label).tag(action)
                        }
                    }
                    .pickerStyle(.inline)
                    TextField("Resolution notes", text: $fraudReviewNotes, axis: .vertical)
                        .lineLimit(3 ... 6)
                        .accessibilityIdentifier("admin.fraud.notes")
                    Toggle("Restrict user", isOn: $fraudRestrictUser)
                        .frame(minHeight: 44)
                        .accessibilityIdentifier("admin.fraud.restrict")
                    Toggle("Ban user", isOn: $fraudBanUser)
                        .frame(minHeight: 44)
                        .tint(BrandTheme.destructive)
                        .accessibilityIdentifier("admin.fraud.ban")
                } footer: {
                    Text("POST /admin/fraud/alerts/{id}/review. Restrict/ban are applied when the alert is confirmed as fraud.")
                }
            }
            .navigationTitle("Review alert")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        showFraudReviewSheet = false
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Submit") {
                        Task { await submitFraudReview() }
                    }
                    .disabled(fraudReviewTarget == nil || busyFraudIDs.contains(fraudReviewTarget?.id ?? ""))
                    .accessibilityIdentifier("admin.fraud.submit")
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private var disputeResolveSheet: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("Resolution", selection: $disputeResolveAction) {
                        ForEach([
                            DisputeResolveAction.favorCustomer,
                            .favorProvider,
                            .split,
                            .dismissed,
                        ]) { action in
                            Text(action.label).tag(action)
                        }
                    }
                    .pickerStyle(.inline)
                    TextField("Resolution notes", text: $disputeResolveNotes, axis: .vertical)
                        .lineLimit(3 ... 6)
                        .accessibilityIdentifier("admin.dispute.notes")
                    DollarAmountField(
                        text: $disputeRefundText,
                        placeholder: "0.00",
                        accessibilityLabelText: "Optional refund amount in dollars"
                    )
                    .accessibilityIdentifier("admin.dispute.refund")
                    TextField("Guarantee outcome (optional)", text: $disputeGuaranteeOutcome)
                        .accessibilityIdentifier("admin.dispute.guaranteeOutcome")
                } footer: {
                    Text("POST /admin/disputes/{id}/resolve. Refund is sent as integer cents. Leave blank for no refund.")
                }
            }
            .navigationTitle("Resolve dispute")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        showDisputeResolveSheet = false
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Resolve") {
                        Task { await submitDisputeResolve() }
                    }
                    .disabled(
                        disputeResolveTarget == nil
                            || busyDisputeIDs.contains(disputeResolveTarget?.id ?? "")
                    )
                    .accessibilityIdentifier("admin.dispute.submit")
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private var userActionSheet: some View {
        NavigationStack {
            Form {
                Section {
                    if let target = userActionTarget {
                        Text(target.displayLabel)
                            .font(.subheadline.weight(.semibold))
                        Text(userActionKind.label)
                            .font(.caption)
                            .foregroundStyle(BrandTheme.textSecondary)
                    }
                    TextField("Reason (required)", text: $userActionReason, axis: .vertical)
                        .lineLimit(3 ... 6)
                        .accessibilityIdentifier("admin.user.reason")
                } footer: {
                    Text("POST /admin/users/{id}/\(userActionKind.rawValue). Reason is required server-side.")
                }
            }
            .navigationTitle("\(userActionKind.label) user")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        showUserActionSheet = false
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(userActionKind.label) {
                        Task { await submitUserAction() }
                    }
                    .disabled(
                        userActionTarget == nil
                            || userActionReason.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                            || busyUserIDs.contains(userActionTarget?.id ?? "")
                    )
                    .accessibilityIdentifier("admin.user.submit")
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private var isEmpty: Bool {
        switch tab {
        case .flags: return flags.isEmpty
        case .jobs, .listings, .goodsDisputes, .fees, .banking, .platform,
             .guarantee, .verification, .licenses, .insurance, .reviews,
             .markets, .taxonomy, .insurers, .challenges:
            return false // hosted panels own load state
        case .disputes: return disputes.isEmpty
        case .users: return users.isEmpty
        case .goodsReports: return goodsReports.isEmpty
        case .userReports: return userReports.isEmpty
        case .fraud: return fraudAlerts.isEmpty
        case .advances: return advances.isEmpty
        }
    }

    // MARK: - User rows

    @ViewBuilder
    private var userRows: some View {
        if users.isEmpty {
            Text("No users.")
                .foregroundStyle(BrandTheme.textSecondary)
                .listRowBackground(BrandTheme.navyElevated)
        } else {
            ForEach(users) { u in
                let busy = busyUserIDs.contains(u.id)
                VStack(alignment: .leading, spacing: 8) {
                    HStack(alignment: .top) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(u.displayLabel)
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(BrandTheme.textPrimary)
                            Text(u.displayStatus)
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(BrandTheme.textSecondary)
                            if let roles = u.roles, !roles.isEmpty {
                                Text(roles.joined(separator: ", "))
                                    .font(.caption)
                                    .foregroundStyle(BrandTheme.textSecondary)
                            }
                        }
                        Spacer(minLength: 8)
                        if busy {
                            ProgressView()
                                .controlSize(.small)
                        }
                    }
                    HStack(spacing: 8) {
                        if u.canSuspend {
                            Button("Suspend") {
                                userActionTarget = u
                                userActionKind = .suspend
                                userActionReason = ""
                                showUserActionSheet = true
                            }
                            .font(.caption.weight(.semibold))
                            .disabled(busy)
                            .frame(minHeight: 44)
                            .accessibilityIdentifier("admin.user.suspend.\(u.id)")
                        }
                        if u.canBan {
                            Button("Ban", role: .destructive) {
                                userActionTarget = u
                                userActionKind = .ban
                                userActionReason = ""
                                showUserActionSheet = true
                            }
                            .font(.caption.weight(.semibold))
                            .disabled(busy)
                            .frame(minHeight: 44)
                            .accessibilityIdentifier("admin.user.ban.\(u.id)")
                        }
                        if u.canReactivate {
                            Button("Reactivate") {
                                Task { await reactivateUser(u) }
                            }
                            .font(.caption.weight(.semibold))
                            .disabled(busy)
                            .frame(minHeight: 44)
                            .accessibilityIdentifier("admin.user.reactivate.\(u.id)")
                        }
                        Button("Finalize deletion", role: .destructive) {
                            pendingFinalizeUser = u
                        }
                        .font(.caption.weight(.semibold))
                        .disabled(busy)
                        .frame(minHeight: 44)
                        .accessibilityIdentifier("admin.user.finalize.\(u.id)")
                    }
                }
                .listRowBackground(BrandTheme.navyElevated)
                .frame(minHeight: 44)
            }
        }
    }

    // MARK: - Advance rows

    @ViewBuilder
    private var advanceRows: some View {
        if advances.isEmpty {
            Text("No working-capital advances.")
                .foregroundStyle(BrandTheme.textSecondary)
                .listRowBackground(BrandTheme.navyElevated)
        } else {
            ForEach(advances) { advance in
                let busy = busyAdvanceIDs.contains(advance.id)
                let status = (advance.status ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
                VStack(alignment: .leading, spacing: 8) {
                    HStack(alignment: .top) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(advance.displayAmount)
                                .font(.subheadline.weight(.semibold).monospacedDigit())
                                .foregroundStyle(BrandTheme.goldBright)
                            Text(advance.displayStatus)
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(BrandTheme.textSecondary)
                            if let cid = advance.contractId, !cid.isEmpty {
                                Text("Contract \(String(cid.prefix(8)))…")
                                    .font(.caption2.monospaced())
                                    .foregroundStyle(BrandTheme.textSecondary)
                            }
                        }
                        Spacer(minLength: 8)
                        if busy {
                            ProgressView()
                                .controlSize(.small)
                        }
                    }
                    if status == "requested" {
                        HStack(spacing: 8) {
                            Button("Approve") {
                                Task { await reviewAdvance(advance, action: "approve") }
                            }
                            .font(.caption.weight(.semibold))
                            .disabled(busy)
                            .frame(minHeight: 44)
                            .accessibilityIdentifier("admin.advance.approve.\(advance.id)")
                            Button("Reject", role: .destructive) {
                                Task {
                                    await reviewAdvance(
                                        advance,
                                        action: "reject",
                                        reason: "Does not meet eligibility criteria"
                                    )
                                }
                            }
                            .font(.caption.weight(.semibold))
                            .disabled(busy)
                            .frame(minHeight: 44)
                            .accessibilityIdentifier("admin.advance.reject.\(advance.id)")
                        }
                    } else if status == "approved" {
                        Button("Disburse") {
                            Task { await disburseAdvance(advance) }
                        }
                        .font(.caption.weight(.semibold))
                        .disabled(busy)
                        .frame(minHeight: 44)
                        .accessibilityIdentifier("admin.advance.disburse.\(advance.id)")
                    }
                }
                .listRowBackground(BrandTheme.navyElevated)
            }
        }
    }

    @ViewBuilder
    private func reportRows(_ rows: [AdminReportRow], kind: ReportKind) -> some View {
        if rows.isEmpty {
            Text("No reports.")
                .foregroundStyle(BrandTheme.textSecondary)
                .listRowBackground(BrandTheme.navyElevated)
        } else {
            ForEach(rows) { r in
                let busy = busyReportIDs.contains(r.id)
                VStack(alignment: .leading, spacing: 8) {
                    HStack(alignment: .top) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(r.status ?? "open")
                                .font(.subheadline.weight(.semibold))
                            if let reason = r.reason {
                                Text(reason)
                                    .font(.caption)
                                    .foregroundStyle(BrandTheme.textSecondary)
                            }
                            Text(String(r.id.prefix(8)) + "…")
                                .font(.caption2.monospaced())
                                .foregroundStyle(BrandTheme.textSecondary)
                        }
                        Spacer(minLength: 8)
                        if busy {
                            ProgressView()
                                .controlSize(.small)
                        }
                    }
                    if r.isOpenForResolution {
                        HStack(spacing: 8) {
                            Button("Dismiss") {
                                Task { await resolveReport(r, kind: kind, action: "dismiss") }
                            }
                            .font(.caption.weight(.semibold))
                            .disabled(busy)
                            .frame(minHeight: 44)
                            .accessibilityIdentifier("admin.report.dismiss.\(r.id)")
                            Button("Actioned") {
                                Task { await resolveReport(r, kind: kind, action: "actioned") }
                            }
                            .font(.caption.weight(.semibold))
                            .disabled(busy)
                            .frame(minHeight: 44)
                            .accessibilityIdentifier("admin.report.actioned.\(r.id)")
                        }
                    }
                }
                .listRowBackground(BrandTheme.navyElevated)
            }
        }
    }

    // MARK: - Mutations

    private func rolloutDraftChanged(_ flag: AdminFeatureFlag) -> Bool {
        let draft = (rolloutDrafts[flag.key] ?? String(flag.rolloutPercent ?? 100))
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard let value = Int(draft) else { return false }
        return value != (flag.rolloutPercent ?? 100)
    }

    @MainActor
    private func toggleFlag(_ flag: AdminFeatureFlag, enabled: Bool) async {
        guard !busyFlagKeys.contains(flag.key) else { return }
        busyFlagKeys.insert(flag.key)
        defer { busyFlagKeys.remove(flag.key) }
        do {
            let updated = try await APIClient.shared.updateAdminFlag(
                key: flag.key,
                enabled: enabled
            )
            if let idx = flags.firstIndex(where: { $0.key == flag.key }) {
                flags[idx].enabled = updated.enabled ?? enabled
                if let pct = updated.rolloutPercent {
                    flags[idx].rolloutPercent = pct
                    rolloutDrafts[flag.key] = String(pct)
                }
                if let binary = updated.binaryOnly {
                    flags[idx].binaryOnly = binary
                }
            }
            actionMessage = "Flag \(flag.key) \(enabled ? "enabled" : "disabled")."
            BrandHaptics.success()
        } catch let error as APIClientError where error.isForbidden {
            forbidden = true
            BrandHaptics.error()
        } catch {
            actionMessage = error.localizedDescription
            BrandHaptics.error()
            // Reload so Toggle snaps back to server truth.
            await load()
        }
    }

    @MainActor
    private func saveFlagRollout(_ flag: AdminFeatureFlag) async {
        guard !busyFlagKeys.contains(flag.key) else { return }
        let draft = (rolloutDrafts[flag.key] ?? String(flag.rolloutPercent ?? 100))
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard let pct = Int(draft), pct >= 0, pct <= 100 else {
            actionMessage = "Rollout percent must be an integer 0–100."
            BrandHaptics.warning()
            return
        }
        if flag.isBinaryOnly, pct != 0, pct != 100 {
            actionMessage = "Money/regulated flags require rollout 0 or 100."
            BrandHaptics.warning()
            return
        }
        busyFlagKeys.insert(flag.key)
        defer { busyFlagKeys.remove(flag.key) }
        do {
            let updated = try await APIClient.shared.updateAdminFlag(
                key: flag.key,
                enabled: flag.isOn,
                rolloutPercent: pct
            )
            if let idx = flags.firstIndex(where: { $0.key == flag.key }) {
                flags[idx].enabled = updated.enabled ?? flag.isOn
                flags[idx].rolloutPercent = updated.rolloutPercent ?? pct
                rolloutDrafts[flag.key] = String(flags[idx].rolloutPercent ?? pct)
            }
            actionMessage = "Rollout for \(flag.key) set to \(pct)%."
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
    private func submitFraudReview() async {
        guard let target = fraudReviewTarget else { return }
        guard !busyFraudIDs.contains(target.id) else { return }
        busyFraudIDs.insert(target.id)
        defer { busyFraudIDs.remove(target.id) }
        do {
            let updated = try await APIClient.shared.reviewAdminFraudAlert(
                id: target.id,
                status: fraudReviewAction.rawValue,
                resolutionNotes: fraudReviewNotes,
                restrictUser: fraudRestrictUser,
                banUser: fraudBanUser
            )
            if let idx = fraudAlerts.firstIndex(where: { $0.id == target.id }) {
                fraudAlerts[idx] = updated
            }
            showFraudReviewSheet = false
            fraudReviewTarget = nil
            actionMessage = "Fraud alert reviewed (\(fraudReviewAction.label.lowercased()))."
            BrandHaptics.success()
        } catch let error as APIClientError where error.isForbidden {
            showFraudReviewSheet = false
            forbidden = true
            BrandHaptics.error()
        } catch {
            actionMessage = error.localizedDescription
            BrandHaptics.error()
        }
    }

    @MainActor
    private func submitDisputeResolve() async {
        guard let target = disputeResolveTarget else { return }
        guard !busyDisputeIDs.contains(target.id) else { return }
        busyDisputeIDs.insert(target.id)
        defer { busyDisputeIDs.remove(target.id) }
        do {
            let refundCents = MoneyFormat.cents(fromDollarsText: disputeRefundText)
            let guarantee = disputeGuaranteeOutcome.trimmingCharacters(in: .whitespacesAndNewlines)
            let updated = try await APIClient.shared.resolveAdminDispute(
                id: target.id,
                resolutionType: disputeResolveAction.rawValue,
                resolutionNotes: disputeResolveNotes,
                refundAmountCents: refundCents,
                guaranteeOutcome: guarantee.isEmpty ? nil : guarantee
            )
            if let idx = disputes.firstIndex(where: { $0.id == target.id }) {
                disputes[idx] = updated
            }
            showDisputeResolveSheet = false
            disputeResolveTarget = nil
            actionMessage = "Dispute resolved (\(disputeResolveAction.label.lowercased()))."
            BrandHaptics.success()
        } catch let error as APIClientError where error.isForbidden {
            showDisputeResolveSheet = false
            forbidden = true
            BrandHaptics.error()
        } catch {
            actionMessage = error.localizedDescription
            BrandHaptics.error()
        }
    }

    @MainActor
    private func resolveReport(_ report: AdminReportRow, kind: ReportKind, action: String) async {
        guard !busyReportIDs.contains(report.id) else { return }
        busyReportIDs.insert(report.id)
        defer { busyReportIDs.remove(report.id) }
        do {
            let result: AdminReportResolveResponse
            switch kind {
            case .goods:
                result = try await APIClient.shared.resolveAdminGoodsReport(
                    id: report.id,
                    action: action
                )
            case .user:
                result = try await APIClient.shared.resolveAdminUserReport(
                    id: report.id,
                    action: action
                )
            }
            let newStatus = result.status ?? (action == "dismiss" ? "dismissed" : action)
            switch kind {
            case .goods:
                if let idx = goodsReports.firstIndex(where: { $0.id == report.id }) {
                    goodsReports[idx].status = newStatus
                }
            case .user:
                if let idx = userReports.firstIndex(where: { $0.id == report.id }) {
                    userReports[idx].status = newStatus
                }
            }
            actionMessage = "Report \(action == "dismiss" ? "dismissed" : "actioned")."
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

    @MainActor
    private func submitUserAction() async {
        guard let target = userActionTarget else { return }
        guard !busyUserIDs.contains(target.id) else { return }
        let reason = userActionReason.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !reason.isEmpty else {
            actionMessage = "Reason is required."
            BrandHaptics.warning()
            return
        }
        busyUserIDs.insert(target.id)
        defer { busyUserIDs.remove(target.id) }
        do {
            let updated: AdminUserRow
            switch userActionKind {
            case .suspend:
                updated = try await APIClient.shared.suspendAdminUser(id: target.id, reason: reason)
            case .ban:
                updated = try await APIClient.shared.banAdminUser(id: target.id, reason: reason)
            }
            if let idx = users.firstIndex(where: { $0.id == target.id }) {
                users[idx] = updated
            }
            showUserActionSheet = false
            userActionTarget = nil
            userActionReason = ""
            actionMessage = userActionKind == .suspend ? "User suspended." : "User banned."
            BrandHaptics.success()
            await load()
        } catch let error as APIClientError where error.isForbidden {
            showUserActionSheet = false
            forbidden = true
            BrandHaptics.error()
        } catch {
            actionMessage = error.localizedDescription
            BrandHaptics.error()
        }
    }

    @MainActor
    private func reactivateUser(_ user: AdminUserRow) async {
        guard !busyUserIDs.contains(user.id) else { return }
        busyUserIDs.insert(user.id)
        defer { busyUserIDs.remove(user.id) }
        do {
            let updated = try await APIClient.shared.reactivateAdminUser(id: user.id)
            if let idx = users.firstIndex(where: { $0.id == user.id }) {
                users[idx] = updated
            }
            actionMessage = "User reactivated."
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

    @MainActor
    private func finalizeUserDeletion(_ user: AdminUserRow) async {
        guard !busyUserIDs.contains(user.id) else { return }
        busyUserIDs.insert(user.id)
        defer { busyUserIDs.remove(user.id) }
        do {
            let result = try await APIClient.shared.finalizeAdminUserDeletion(id: user.id)
            let when = result.finalizedAt?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            if when.isEmpty {
                actionMessage = "Finalized deletion for \(user.displayLabel)."
            } else {
                actionMessage = "Finalized deletion for \(user.displayLabel) at \(when)."
            }
            users.removeAll { $0.id == user.id }
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

    @MainActor
    private func reviewAdvance(
        _ advance: WorkingCapitalAdvance,
        action: String,
        reason: String = ""
    ) async {
        guard !busyAdvanceIDs.contains(advance.id) else { return }
        busyAdvanceIDs.insert(advance.id)
        defer { busyAdvanceIDs.remove(advance.id) }
        do {
            let updated = try await APIClient.shared.reviewAdminAdvance(
                id: advance.id,
                action: action,
                reason: reason
            )
            if let idx = advances.firstIndex(where: { $0.id == advance.id }) {
                advances[idx] = updated
            }
            actionMessage = action == "approve" ? "Advance approved." : "Advance rejected."
            BrandHaptics.success()
            await load()
        } catch let error as APIClientError where error.isForbidden {
            forbidden = true
            BrandHaptics.error()
        } catch let error as APIClientError where error.isServiceUnavailable {
            actionMessage = softAdvanceFlagMessage(error.localizedDescription)
            BrandHaptics.warning()
        } catch {
            actionMessage = error.localizedDescription
            BrandHaptics.error()
        }
    }

    @MainActor
    private func disburseAdvance(_ advance: WorkingCapitalAdvance) async {
        guard !busyAdvanceIDs.contains(advance.id) else { return }
        busyAdvanceIDs.insert(advance.id)
        defer { busyAdvanceIDs.remove(advance.id) }
        do {
            let updated = try await APIClient.shared.disburseAdminAdvance(id: advance.id)
            if let idx = advances.firstIndex(where: { $0.id == advance.id }) {
                advances[idx] = updated
            }
            actionMessage = "Advance disbursed."
            BrandHaptics.success()
            await load()
        } catch let error as APIClientError where error.isForbidden {
            forbidden = true
            BrandHaptics.error()
        } catch let error as APIClientError where error.isServiceUnavailable {
            actionMessage = softAdvanceFlagMessage(error.localizedDescription)
            BrandHaptics.warning()
        } catch {
            actionMessage = error.localizedDescription
            BrandHaptics.error()
        }
    }

    private func softAdvanceFlagMessage(_ detail: String) -> String {
        let cleaned = detail.trimmingCharacters(in: .whitespacesAndNewlines)
        if !cleaned.isEmpty, cleaned.lowercased() != "service temporarily unavailable" {
            return "\(cleaned) (flag: working_capital)."
        }
        return "The working_capital feature flag is off or the rail is unavailable (HTTP 503)."
    }

    private func openDisputeOnWeb(_ id: String) {
        let url = AppConfig.publicWebBaseURL
            .appending(path: "admin")
            .appending(path: "disputes")
            .appending(path: id)
        openURL(url)
    }

    @MainActor
    private func load() async {
        guard auth.isAuthenticated, !auth.isScaffoldSession else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            switch tab {
            case .flags:
                let loaded = try await APIClient.shared.fetchAdminFlags()
                flags = loaded
                for flag in loaded where rolloutDrafts[flag.key] == nil {
                    rolloutDrafts[flag.key] = String(flag.rolloutPercent ?? 100)
                }
            case .jobs, .listings, .goodsDisputes,
                 .guarantee, .verification, .licenses, .insurance, .reviews,
                 .fees, .banking, .platform,
                 .markets, .taxonomy, .insurers, .challenges:
                // AdminOpsViews panels load their own data.
                break
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
            case .advances:
                advances = try await APIClient.shared.fetchAdminAdvances().advances
            }
            forbidden = false
            errorMessage = nil
        } catch let error as APIClientError {
            if error.isForbidden {
                forbidden = true
                errorMessage = nil
            } else if error.isServiceUnavailable, tab == .advances {
                advances = []
                errorMessage = nil
                actionMessage = softAdvanceFlagMessage(error.localizedDescription)
                BrandHaptics.warning()
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
