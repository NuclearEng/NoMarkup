import CoreLocation
import MapKit
import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

/// MapKit jobs map — `GET /api/v1/jobs/map` pins (no Mapbox SDK).
/// FR-10.2: category + min starting bid filters (category via API; min bid client-side —
/// map endpoint has `max_price_cents` only, not min). Schedule is not on map pins → omitted.
/// Tap a pin → `JobDetailView`. Centers on user location when permitted.
struct JobsMapView: View {
    @State private var pins: [JobMapPin] = []
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var selectedPin: JobMapPin?
    @State private var position: MapCameraPosition = .region(
        MKCoordinateRegion(
            // Default: continental US midpoint until location resolves.
            center: CLLocationCoordinate2D(latitude: 39.8283, longitude: -98.5795),
            span: MKCoordinateSpan(latitudeDelta: 25, longitudeDelta: 25)
        )
    )
    @State private var userCoordinate: CLLocationCoordinate2D?
    @State private var locationManager = MapLocationManager()
    @State private var showLocationPrePrompt = false
    @State private var shouldRecenterOnUser = true

    /// FR-10.2 map filters (parity with JobsView browse filters where API allows).
    @State private var filterCategoryId = ""
    @State private var filterCategoryName = ""
    @State private var minStartingBidText = ""
    @State private var showFilters = false

    private let defaultRadiusKm: Double = 25

    private var minStartingBidCents: Int64? {
        let t = minStartingBidText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty else { return nil }
        return MoneyFormat.cents(fromDollarsText: t)
    }

    private var hasActiveFilters: Bool {
        !filterCategoryId.isEmpty || minStartingBidCents != nil
    }

    var body: some View {
        content
            .navigationTitle("Jobs map")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbarBackground(BrandTheme.navy, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        showFilters.toggle()
                    } label: {
                        Label(
                            "Filters",
                            systemImage: hasActiveFilters
                                ? "line.3.horizontal.decrease.circle.fill"
                                : "line.3.horizontal.decrease.circle"
                        )
                    }
                    .frame(minHeight: 44)
                    .accessibilityHint("Filter map pins by category and minimum starting bid")
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        Task { await reload(recenter: true) }
                    } label: {
                        Label("Refresh", systemImage: "arrow.clockwise")
                    }
                    .frame(minHeight: 44)
                    .disabled(isLoading)
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
            .safeAreaInset(edge: .top, spacing: 0) {
                if showFilters {
                    mapFiltersBar
                }
            }
            .task {
                locationManager.onUpdate = { coord in
                    userCoordinate = coord
                }
                locationManager.onFail = { message in
                    // Don't clobber a successful pin load with transient GPS noise.
                    if pins.isEmpty {
                        errorMessage = "Couldn’t get your location (\(message)). Pan the map to browse jobs."
                    }
                }
                await reload(recenter: true)
            }
            .onChange(of: userCoordinate?.latitude) { _, _ in
                // After first fix, reload pins around the user once.
                if let userCoordinate, pins.isEmpty || shouldRecenterOnUser {
                    Task { await reloadAround(userCoordinate, recenter: true) }
                }
            }
            .navigationDestination(item: $selectedPin) { pin in
                JobDetailView(jobID: pin.jobId, preview: nil)
            }
            .alert("Location for nearby jobs", isPresented: $showLocationPrePrompt) {
                Button("Continue") {
                    locationManager.requestWhenInUse()
                }
                Button("Not now", role: .cancel) {}
            } message: {
                Text(LocationPurposeCopy.marketPickerPrePrompt)
            }
    }

    private var mapFiltersBar: some View {
        VStack(alignment: .leading, spacing: 10) {
            NavigationLink {
                CategoryPickerView(selectedId: $filterCategoryId, selectedName: $filterCategoryName)
            } label: {
                HStack {
                    Text("Category")
                        .foregroundStyle(BrandTheme.textPrimary)
                    Spacer()
                    Text(filterCategoryName.isEmpty ? "Any" : filterCategoryName)
                        .foregroundStyle(filterCategoryName.isEmpty ? BrandTheme.textSecondary : BrandTheme.goldBright)
                        .lineLimit(1)
                }
                .frame(minHeight: 44)
            }
            .accessibilityLabel("Filter by category")

            HStack {
                Text("Min starting bid ($)")
                    .foregroundStyle(BrandTheme.textPrimary)
                TextField("Any", text: $minStartingBidText)
                    .keyboardType(.decimalPad)
                    .multilineTextAlignment(.trailing)
                    .frame(minHeight: 44)
                    .accessibilityLabel("Minimum starting bid in dollars")
            }

            HStack {
                Button("Apply") {
                    Task { await reload(recenter: false) }
                }
                .buttonStyle(.borderedProminent)
                .tint(BrandTheme.accent)
                .frame(minHeight: 44)

                Button("Clear") {
                    filterCategoryId = ""
                    filterCategoryName = ""
                    minStartingBidText = ""
                    Task { await reload(recenter: false) }
                }
                .buttonStyle(.bordered)
                .frame(minHeight: 44)
            }

            Text("Category is applied server-side. Min bid filters pins on device (map API has no min-price param).")
                .font(.caption2)
                .foregroundStyle(BrandTheme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(BrandTheme.navyElevated)
    }

    @ViewBuilder
    private var content: some View {
        ZStack {
            Map(position: $position) {
                UserAnnotation()

                ForEach(mappablePins) { pin in
                    if let lat = pin.latitude, let lng = pin.longitude {
                        Annotation(pin.displayTitle, coordinate: CLLocationCoordinate2D(latitude: lat, longitude: lng)) {
                            Button {
                                selectedPin = pin
                            } label: {
                                VStack(spacing: 2) {
                                    Image(systemName: "mappin.circle.fill")
                                        .font(.title2)
                                        .foregroundStyle(BrandTheme.accent)
                                        .shadow(color: .black.opacity(0.35), radius: 3, y: 1)
                                    if let price = pin.priceLabel {
                                        Text(price)
                                            .font(.caption2.weight(.semibold).monospacedDigit())
                                            .foregroundStyle(BrandTheme.ctaLabelOnGold)
                                            .padding(.horizontal, 6)
                                            .padding(.vertical, 2)
                                            .background(BrandTheme.gold, in: Capsule())
                                    }
                                }
                                .frame(minWidth: 44, minHeight: 44)
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel("\(pin.displayTitle)\(pin.priceLabel.map { ", \($0)" } ?? "")")
                            .accessibilityHint("Opens job detail")
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

            if isLoading && pins.isEmpty {
                ProgressView("Loading map…")
                    .tint(BrandTheme.accent)
                    .padding(16)
                    .background(BrandTheme.navyElevated.opacity(0.92), in: RoundedRectangle(cornerRadius: 12))
            }

            if let errorMessage, pins.isEmpty {
                VStack(spacing: 12) {
                    Text("Couldn’t load map pins")
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

    /// Coordinate pins after optional client-side min starting bid filter.
    private var filteredPins: [JobMapPin] {
        guard let minCents = minStartingBidCents else { return pins }
        return pins.filter { pin in
            guard let bid = pin.startingBidCents else { return false }
            return bid >= minCents
        }
    }

    private var mappablePins: [JobMapPin] {
        filteredPins.filter(\.hasCoordinate)
    }

    private var footerLabel: String {
        if isLoading { return "Updating…" }
        let count = mappablePins.count
        if count == 0 {
            return hasActiveFilters
                ? "No open jobs match filters in this area"
                : "No open jobs in this area"
        }
        let filterNote = hasActiveFilters ? " · filtered" : ""
        return "\(String(localized: "\(count) jobs")) · \(Int(defaultRadiusKm)) km\(filterNote)"
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
            errorMessage = "Location is off. Open Settings → NoMarkup → Location, or pan the map to explore jobs."
            openAppSettingsIfPossible()
        @unknown default:
            break
        }
    }

    private func openAppSettingsIfPossible() {
        #if canImport(UIKit)
        guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
        UIApplication.shared.open(url)
        #endif
    }

    @MainActor
    private func reload(recenter: Bool) async {
        if let userCoordinate {
            await reloadAround(userCoordinate, recenter: recenter)
            return
        }
        // No user fix yet — request location (optional) and load without center.
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
        if pins.isEmpty {
            errorMessage = nil
        }
        defer { isLoading = false }

        do {
            let categoryIds: [String]? = filterCategoryId.isEmpty ? nil : [filterCategoryId]
            let response = try await APIClient.shared.fetchJobsMap(
                latitude: coordinate?.latitude,
                longitude: coordinate?.longitude,
                radiusKm: defaultRadiusKm,
                categoryIds: categoryIds
            )
            pins = response.pins
            errorMessage = nil

            if recenter {
                if let coordinate {
                    position = .region(
                        MKCoordinateRegion(
                            center: coordinate,
                            span: MKCoordinateSpan(latitudeDelta: 0.35, longitudeDelta: 0.35)
                        )
                    )
                    shouldRecenterOnUser = false
                } else if let first = mappablePins.first,
                          let lat = first.latitude,
                          let lng = first.longitude
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
            if pins.isEmpty {
                errorMessage = error.localizedDescription
            }
        }
    }
}

// MARK: - CoreLocation helper

@MainActor
final class MapLocationManager: NSObject, CLLocationManagerDelegate {
    private let manager = CLLocationManager()
    var onUpdate: ((CLLocationCoordinate2D) -> Void)?
    private(set) var authorizationStatus: CLAuthorizationStatus

    override init() {
        authorizationStatus = manager.authorizationStatus
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
    }

    func requestWhenInUse() {
        authorizationStatus = manager.authorizationStatus
        switch manager.authorizationStatus {
        case .notDetermined:
            manager.requestWhenInUseAuthorization()
        case .authorizedAlways, .authorizedWhenInUse:
            manager.requestLocation()
        default:
            break
        }
    }

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let status = manager.authorizationStatus
        Task { @MainActor in
            self.authorizationStatus = status
            if status == .authorizedWhenInUse || status == .authorizedAlways {
                self.manager.requestLocation()
            }
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let coordinate = locations.last?.coordinate else { return }
        Task { @MainActor in
            onUpdate?(coordinate)
        }
    }

    var onFail: ((String) -> Void)?

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        let message = error.localizedDescription
        Task { @MainActor in
            onFail?(message)
        }
    }
}

#Preview {
    NavigationStack {
        JobsMapView()
    }
    .preferredColorScheme(.dark)
    .tint(BrandTheme.accent)
}
