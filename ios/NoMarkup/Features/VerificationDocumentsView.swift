import PhotosUI
import SwiftUI
import UniformTypeIdentifiers
#if canImport(UIKit)
import UIKit
#endif

/// Provider verification documents — list + upload.
///
/// APIs:
/// - `GET  /api/v1/providers/me/documents` → `{ "documents": [] }`
/// - `POST /api/v1/providers/me/documents` after imaging pipeline
///   (`context: document` → owned `documents/{userID}/…` key).
///
/// **FR-2.2:** JPEG, PNG, WebP (photo/camera) and PDF (Files picker). Imaging
/// accepts `application/pdf` only on `document` / `chat_attachment` contexts;
/// confirm sniffs magic bytes; process endpoints stay image-only (pass-through).
///
/// **FR-2.8** — when `expires_at` is present, rows show expiry and warn when
/// within 30 days (or expired). Renewal is re-upload; no Checkr integration.
///
/// **FR-2.10** — when API provides `resubmission_count`, rows show
/// "N of 3" attempts. Max 3 resubmissions after rejection; contact support
/// after the third rejection (server tracks count on reject).
struct VerificationDocumentsView: View {
    @EnvironmentObject private var auth: AuthViewModel

    @State private var documents: [ProviderVerificationDocument] = []
    @State private var isLoading = false
    @State private var loadError: String?
    @State private var needsSignIn = false
    @State private var hasProviderRole = true

    @State private var showUploadSheet = false
    @State private var statusMessage: String?
    @State private var actionError: String?

    private var expiringSoonDocuments: [ProviderVerificationDocument] {
        documents.filter(\.isExpiringWithin30Days)
    }

    private var expiredDocuments: [ProviderVerificationDocument] {
        documents.filter(\.isExpired)
    }

    var body: some View {
        Group {
            if auth.isScaffoldSession {
                BrandEmptyState(
                    title: "Sign in required",
                    systemImage: "hammer.fill",
                    message: "Browse-only mode has no API token. Sign in with a real account to manage verification documents.",
                    actionTitle: "Sign out to log in",
                    action: { auth.signOut() }
                )
            } else if !auth.isAuthenticated || needsSignIn {
                BrandEmptyState(
                    title: "Sign in required",
                    systemImage: "lock.circle",
                    message: "Sign in as a provider to view and upload verification documents.",
                    actionTitle: "Sign in",
                    action: { auth.signOut() }
                )
            } else if isLoading && documents.isEmpty && loadError == nil {
                BrandLoadingScreen(kind: .catalog, rows: 4, accessibilityLabel: "Loading documents…")
            } else if let loadError, documents.isEmpty {
                BrandEmptyState(
                    title: "Couldn’t load documents",
                    systemImage: "wifi.exclamationmark",
                    message: loadError,
                    actionTitle: "Try again",
                    action: { Task { await load() } }
                )
            } else if !hasProviderRole {
                BrandEmptyState(
                    title: "Provider role required",
                    systemImage: "wrench.and.screwdriver",
                    message: "Enable the provider role in Profile settings to manage verification documents.",
                    actionTitle: nil,
                    action: nil
                )
                .safeAreaInset(edge: .bottom) {
                    NavigationLink {
                        ProfileSettingsView()
                    } label: {
                        Text("Open Profile settings")
                            .font(.body.weight(.semibold))
                            .frame(maxWidth: .infinity)
                            .frame(minHeight: 48)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(BrandTheme.accent)
                    .foregroundStyle(BrandTheme.ctaLabelOnGold)
                    .padding(.horizontal, 24)
                    .padding(.bottom, 24)
                    .accessibilityHint("Enable the provider role so you can upload verification documents")
                }
            } else if documents.isEmpty {
                BrandEmptyState(
                    title: "No documents yet",
                    systemImage: "doc.badge.plus",
                    message: "Upload a photo or PDF of your driver’s license, insurance, or trade license for platform review. JPEG, PNG, WebP, or PDF up to 10 MB.",
                    actionTitle: "Upload document",
                    action: { showUploadSheet = true }
                )
            } else {
                listContent
            }
        }
        .navigationTitle("Verification docs")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .brandNavigationBarChrome()
        .toolbar {
            if canUpload {
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        showUploadSheet = true
                    } label: {
                        Image(systemName: "plus.circle.fill")
                    }
                    .accessibilityLabel("Upload verification document")
                }
            }
        }
        .task { await load() }
        .refreshable { await load() }
        .sheet(isPresented: $showUploadSheet) {
            UploadVerificationDocumentSheet(
                allowedTypes: uploadableDocumentTypes,
                onUploaded: { result in
                    showUploadSheet = false
                    let status = result.displayStatus
                    statusMessage = "Document submitted (\(status)). It will appear after review updates."
                    actionError = nil
                    Task { await load() }
                }
            )
            .environmentObject(auth)
        }
    }

    private var canUpload: Bool {
        auth.isAuthenticated && !auth.isScaffoldSession && hasProviderRole && !uploadableDocumentTypes.isEmpty
    }

    /// Document types that still accept a new upload (FR-2.10: not hard-locked).
    private var uploadableDocumentTypes: [ProviderDocumentType] {
        let locked = Set(
            documents
                .filter(\.isResubmissionLocked)
                .compactMap { $0.documentType?.trimmingCharacters(in: .whitespacesAndNewlines) }
                .filter { !$0.isEmpty }
        )
        return ProviderDocumentType.allCases.filter { !locked.contains($0.rawValue) }
    }

    /// Types that have exhausted resubmissions (contact support).
    private var lockedDocuments: [ProviderVerificationDocument] {
        documents.filter(\.isResubmissionLocked)
    }

    private var listContent: some View {
        List {
            if let statusMessage {
                Section {
                    Text(statusMessage)
                        .font(.footnote)
                        .foregroundStyle(BrandTheme.success)
                        .fixedSize(horizontal: false, vertical: true)
                        .listRowBackground(BrandTheme.navyElevated)
                }
            }
            if let actionError {
                Section {
                    Text(actionError)
                        .font(.footnote)
                        .foregroundStyle(BrandTheme.destructive)
                        .fixedSize(horizontal: false, vertical: true)
                        .listRowBackground(BrandTheme.navyElevated)
                }
            }

            // FR-2.8 — surface expiry warnings above the list when API provides expires_at.
            if !expiredDocuments.isEmpty || !expiringSoonDocuments.isEmpty {
                Section {
                    expirationAlertBanner
                        .listRowBackground(BrandTheme.navyElevated)
                } header: {
                    Text("Expiration").brandSectionHeader()
                }
            }

            if !lockedDocuments.isEmpty {
                Section {
                    Label {
                        Text(lockedDocuments.count == 1
                             ? "1 document type has no re-uploads left. Contact support to continue verification for that type."
                             : "\(lockedDocuments.count) document types have no re-uploads left. Contact support to continue verification for those types.")
                            .font(.footnote)
                            .foregroundStyle(BrandTheme.destructive)
                            .fixedSize(horizontal: false, vertical: true)
                    } icon: {
                        Image(systemName: "lock.fill")
                            .foregroundStyle(BrandTheme.destructive)
                    }
                    .accessibilityLabel("Resubmission lockout")
                    .listRowBackground(BrandTheme.navyElevated)
                } header: {
                    Text("Support required").brandSectionHeader()
                }
            }

            Section {
                ForEach(documents) { doc in
                    documentRow(doc)
                        .listRowBackground(BrandTheme.navyElevated)
                }
            } header: {
                Text(String(localized: "\(documents.count) documents")).brandSectionHeader()
            } footer: {
                Text("JPEG, PNG, WebP, or PDF up to 10 MB. MIME type is re-checked server-side (magic bytes); only files you upload under your account can be registered. Insurance and licenses with an expiry date should be renewed before they expire so you can keep bidding on new jobs. After rejection you may re-upload up to 3 times (resubmission count shown per document); after 3 rejections contact support — further uploads for that type are blocked.")
                    .foregroundStyle(BrandTheme.textSecondary)
            }

            Section {
                if canUpload {
                    Button {
                        showUploadSheet = true
                    } label: {
                        Label("Upload another document", systemImage: "doc.badge.plus")
                    }
                    .frame(minHeight: 44)
                    .listRowBackground(BrandTheme.navyElevated)
                    .accessibilityHint("Choose document type and pick a photo or PDF to submit for review")
                } else {
                    Text("All listed document types are locked after 3 rejections. Contact support to continue.")
                        .font(.footnote)
                        .foregroundStyle(BrandTheme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                        .listRowBackground(BrandTheme.navyElevated)
                        .accessibilityLabel("No document types available to upload")
                }
            }
        }
        .brandListBackground()
    }

    @ViewBuilder
    private var expirationAlertBanner: some View {
        VStack(alignment: .leading, spacing: 8) {
            if !expiredDocuments.isEmpty {
                Label {
                    Text(expiredDocuments.count == 1
                         ? "1 document has expired. Upload a renewed copy to restore verified status for new bids."
                         : "\(expiredDocuments.count) documents have expired. Upload renewed copies to restore verified status for new bids.")
                        .font(.footnote)
                        .foregroundStyle(BrandTheme.destructive)
                        .fixedSize(horizontal: false, vertical: true)
                } icon: {
                    Image(systemName: "exclamationmark.octagon.fill")
                        .foregroundStyle(BrandTheme.destructive)
                }
                .accessibilityLabel("Expired documents warning")
            }
            if !expiringSoonDocuments.isEmpty {
                Label {
                    Text(expiringSoonDocuments.count == 1
                         ? "1 document expires within 30 days. Renew it before it lapses."
                         : "\(expiringSoonDocuments.count) documents expire within 30 days. Renew them before they lapse.")
                        .font(.footnote)
                        .foregroundStyle(BrandTheme.warning)
                        .fixedSize(horizontal: false, vertical: true)
                } icon: {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .foregroundStyle(BrandTheme.warning)
                }
                .accessibilityLabel("Documents expiring soon warning")
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, 4)
    }

    @ViewBuilder
    private func documentRow(_ doc: ProviderVerificationDocument) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(doc.displayType)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(BrandTheme.textPrimary)
                    .lineLimit(2)
                Spacer(minLength: 8)
                Text(doc.displayStatus)
                    .font(.caption.weight(.medium))
                    .foregroundStyle(statusColor(doc.statusStyle))
            }
            if let reason = doc.rejectionReason?.trimmingCharacters(in: .whitespacesAndNewlines),
               !reason.isEmpty {
                Text(reason)
                    .font(.caption)
                    .foregroundStyle(BrandTheme.destructive)
                    .fixedSize(horizontal: false, vertical: true)
            }
            // FR-2.10 — surface attempt count / max 3 when API provides it.
            // Show on rejected docs always; on other statuses only when count > 0.
            let isRejected = (doc.status ?? "").lowercased() == "rejected"
            let showResubmission = doc.resubmissionCount.map { $0 > 0 || isRejected } ?? false
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                if showResubmission, let count = doc.resubmissionCount {
                    let remaining = max(0, 3 - count)
                    Text("Resubmissions: \(count) of 3")
                        .font(.caption2.weight(.medium).monospacedDigit())
                        .foregroundStyle(count >= 3 ? BrandTheme.destructive : BrandTheme.textSecondary)
                    if isRejected, count >= 3 {
                        Text("Contact support to continue")
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(BrandTheme.destructive)
                    } else if isRejected, remaining > 0 {
                        Text(remaining == 1 ? "1 re-upload left" : "\(remaining) re-uploads left")
                            .font(.caption2)
                            .foregroundStyle(BrandTheme.warning)
                    }
                }
                Spacer(minLength: 8)
                if doc.expiresAtDate != nil || (doc.expiresAt.map { !$0.isEmpty } ?? false) {
                    expirationLabel(for: doc)
                }
            }
        }
        .frame(minHeight: 44)
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder
    private func expirationLabel(for doc: ProviderVerificationDocument) -> some View {
        let expiresRaw = doc.expiresAt?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let friendly: String = {
            if !expiresRaw.isEmpty {
                return CatalogDateFormat.friendlyDateTime(expiresRaw)
            }
            return "unknown date"
        }()

        if doc.isExpired {
            Label("Expired \(friendly)", systemImage: "calendar.badge.exclamationmark")
                .font(.caption2.weight(.semibold))
                .foregroundStyle(BrandTheme.destructive)
                .labelStyle(.titleAndIcon)
                .accessibilityLabel("Expired on \(friendly). Upload a renewed document.")
        } else if doc.isExpiringWithin30Days {
            let days = doc.daysUntilExpiry ?? 0
            let dayPhrase = days <= 1 ? "1 day" : "\(days) days"
            Label("Expires \(friendly) · \(dayPhrase) left", systemImage: "calendar.badge.clock")
                .font(.caption2.weight(.semibold))
                .foregroundStyle(BrandTheme.warning)
                .labelStyle(.titleAndIcon)
                .accessibilityLabel("Expires \(friendly), within 30 days. \(dayPhrase) remaining.")
        } else if !expiresRaw.isEmpty {
            Text("Expires \(friendly)")
                .font(.caption2)
                .foregroundStyle(BrandTheme.textSecondary)
                .accessibilityLabel("Expires \(friendly)")
        }
    }

    private func statusColor(_ style: StatusChipStyle) -> Color {
        switch style {
        case .success: return BrandTheme.success
        case .info: return BrandTheme.accent
        case .warning: return BrandTheme.warning
        case .danger: return BrandTheme.destructive
        case .neutral: return BrandTheme.textSecondary
        }
    }

    @MainActor
    private func load() async {
        guard auth.isAuthenticated, !auth.isScaffoldSession else { return }

        isLoading = documents.isEmpty
        loadError = nil
        needsSignIn = false
        defer { isLoading = false }

        do {
            documents = try await APIClient.shared.fetchMyProviderDocuments()
            hasProviderRole = true
        } catch let error as APIClientError where error.isUnauthorized {
            needsSignIn = true
            documents = []
        } catch let error as APIClientError where error.isForbidden {
            hasProviderRole = false
            documents = []
        } catch {
            if documents.isEmpty {
                loadError = error.localizedDescription
            }
        }
    }
}

// MARK: - Upload sheet

/// Document type picker + PhotosPicker → imaging `document` context → register.
private struct UploadVerificationDocumentSheet: View {
    @EnvironmentObject private var auth: AuthViewModel
    @Environment(\.dismiss) private var dismiss

    /// FR-2.10: types still eligible for upload (excludes hard-locked).
    let allowedTypes: [ProviderDocumentType]
    let onUploaded: (ProviderDocumentUploadResult) -> Void

    @State private var selectedType: ProviderDocumentType = .driversLicense
    @State private var pickerItem: PhotosPickerItem?
    @State private var showCamera = false
    @State private var showCameraDeniedAlert = false
    @State private var showPDFImporter = false
    @State private var pdfData: Data?
    @State private var pdfFilename: String?
    #if canImport(UIKit)
    @State private var cameraImage: UIImage?
    #endif
    @State private var isUploading = false
    @State private var errorMessage: String?
    @State private var hasCapture = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    if allowedTypes.isEmpty {
                        Text("No document types can be uploaded. Each type is limited to 3 resubmissions after rejection. Contact support to continue.")
                            .font(.footnote)
                            .foregroundStyle(BrandTheme.destructive)
                            .fixedSize(horizontal: false, vertical: true)
                    } else {
                        Picker("Document type", selection: $selectedType) {
                            ForEach(allowedTypes) { type in
                                Text(type.displayLabel).tag(type)
                            }
                        }
                        .pickerStyle(.navigationLink)
                        .frame(minHeight: 44)
                        .accessibilityLabel("Document type")
                        .disabled(allowedTypes.count <= 1)

                        Text(selectedType.detail)
                            .font(.caption)
                            .foregroundStyle(BrandTheme.textSecondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                } header: {
                    Text("Type").brandSectionHeader()
                } footer: {
                    Text(allowedTypes.isEmpty
                         ? "Contact support to unlock verification for locked document types."
                         : "Must match a supported verification type. Types with no re-uploads remaining are hidden. Review is handled by the platform.")
                        .foregroundStyle(BrandTheme.textSecondary)
                }
                .listRowBackground(BrandTheme.navyElevated)
                .onAppear {
                    if !allowedTypes.contains(selectedType), let first = allowedTypes.first {
                        selectedType = first
                    }
                }

                Section {
                    PhotosPicker(
                        selection: $pickerItem,
                        matching: .images,
                        photoLibrary: .shared()
                    ) {
                        HStack {
                            Label(
                                photoSelectedLabel,
                                systemImage: "photo.on.rectangle.angled"
                            )
                            Spacer()
                            if isUploading {
                                ProgressView()
                                    .tint(BrandTheme.accent)
                            } else if pickerItem != nil || cameraImageSelected {
                                Image(systemName: "checkmark.circle.fill")
                                    .foregroundStyle(BrandTheme.success)
                                    .accessibilityLabel("Photo selected")
                            }
                        }
                        .frame(minHeight: 44)
                    }
                    .disabled(isUploading)
                    .accessibilityHint("Opens the photo library. JPEG, PNG, or WebP up to 10 MB.")
                    .onChange(of: pickerItem) { _, item in
                        if item != nil {
                            hasCapture = true
                            pdfData = nil
                            pdfFilename = nil
                            #if canImport(UIKit)
                            cameraImage = nil
                            #endif
                        }
                    }

                    #if canImport(UIKit)
                    Button {
                        Task { await requestCamera() }
                    } label: {
                        Label("Take photo with camera", systemImage: "camera.fill")
                            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                    }
                    .disabled(isUploading || !UIImagePickerController.isSourceTypeAvailable(.camera))
                    .accessibilityHint("Opens the camera to photograph your document")
                    .sheet(isPresented: $showCamera) {
                        CameraImagePicker(image: $cameraImage)
                            .ignoresSafeArea()
                    }
                    .cameraDeniedAlert(isPresented: $showCameraDeniedAlert)
                    .onChange(of: cameraImage) { _, image in
                        if image != nil {
                            hasCapture = true
                            pickerItem = nil
                            pdfData = nil
                            pdfFilename = nil
                        }
                    }
                    #endif

                    Button {
                        showPDFImporter = true
                    } label: {
                        HStack {
                            Label(
                                pdfData != nil ? "Change PDF" : "Choose PDF from Files",
                                systemImage: "doc.fill"
                            )
                            Spacer()
                            if pdfData != nil && !isUploading {
                                Image(systemName: "checkmark.circle.fill")
                                    .foregroundStyle(BrandTheme.success)
                                    .accessibilityLabel("PDF selected")
                            }
                        }
                        .frame(minHeight: 44)
                    }
                    .disabled(isUploading)
                    .accessibilityHint("Opens the Files picker for a PDF up to 10 MB.")
                    .fileImporter(
                        isPresented: $showPDFImporter,
                        allowedContentTypes: [.pdf],
                        allowsMultipleSelection: false
                    ) { result in
                        switch result {
                        case .success(let urls):
                            guard let url = urls.first else { return }
                            loadPDF(from: url)
                        case .failure(let error):
                            errorMessage = error.localizedDescription
                        }
                    }
                } header: {
                    Text("File").brandSectionHeader()
                } footer: {
                    Text("Library, camera, or PDF. JPEG, PNG, WebP, or PDF. Max 10 MB. Server re-checks content type from magic bytes.")
                        .foregroundStyle(BrandTheme.textSecondary)
                }
                .listRowBackground(BrandTheme.navyElevated)

                if let errorMessage {
                    Section {
                        Text(errorMessage)
                            .font(.footnote)
                            .foregroundStyle(BrandTheme.destructive)
                            .fixedSize(horizontal: false, vertical: true)
                            .listRowBackground(BrandTheme.navyElevated)
                    }
                }
            }
            .brandListBackground()
            .navigationTitle("Upload document")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .brandNavigationBarChrome()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                        .disabled(isUploading)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        Task { await submit() }
                    } label: {
                        if isUploading {
                            ProgressView()
                                .tint(BrandTheme.accent)
                        } else {
                            Text("Submit")
                        }
                    }
                    .disabled(isUploading || !hasCapture || allowedTypes.isEmpty || !auth.isAuthenticated || auth.isScaffoldSession)
                    .accessibilityLabel("Submit verification document")
                }
            }
        }
        .tint(BrandTheme.accent)
    }

    private var photoSelectedLabel: String {
        if pickerItem != nil || cameraImageSelected {
            return "Change from library"
        }
        return "Choose from library"
    }

    private var cameraImageSelected: Bool {
        #if canImport(UIKit)
        return cameraImage != nil
        #else
        return false
        #endif
    }

    #if canImport(UIKit)
    @MainActor
    private func requestCamera() async {
        switch await CameraAuthorization.prepareToPresent() {
        case .ready:
            showCamera = true
        case .denied:
            showCameraDeniedAlert = true
        case .unavailable:
            errorMessage = "Camera is not available on this device. Choose a photo or PDF instead."
        }
    }
    #endif

    private func loadPDF(from url: URL) {
        let accessed = url.startAccessingSecurityScopedResource()
        defer {
            if accessed { url.stopAccessingSecurityScopedResource() }
        }
        do {
            let data = try Data(contentsOf: url)
            guard data.count <= ImageUploader.maxFileBytes else {
                errorMessage = "PDF must be 10 MB or smaller."
                return
            }
            guard ImageUploader.sniffMime(data) == "application/pdf" else {
                errorMessage = "Selected file is not a valid PDF."
                return
            }
            pdfData = data
            pdfFilename = url.lastPathComponent
            hasCapture = true
            pickerItem = nil
            #if canImport(UIKit)
            cameraImage = nil
            #endif
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    @MainActor
    private func submit() async {
        guard auth.isAuthenticated, !auth.isScaffoldSession else {
            errorMessage = "Sign in as a provider to upload documents."
            return
        }
        guard allowedTypes.contains(selectedType) else {
            errorMessage = "This document type has no re-uploads left. Contact support to continue."
            return
        }

        errorMessage = nil
        isUploading = true
        defer { isUploading = false }

        do {
            if let pdfData {
                let result = try await ImageUploader.uploadVerificationDocumentPDF(
                    data: pdfData,
                    filename: pdfFilename ?? "document.pdf",
                    documentType: selectedType
                )
                onUploaded(result)
                return
            }
            #if canImport(UIKit)
            if let cameraImage {
                let result = try await ImageUploader.uploadVerificationDocument(
                    uiImage: cameraImage,
                    documentType: selectedType
                )
                onUploaded(result)
                return
            }
            #endif
            guard let item = pickerItem else {
                errorMessage = "Choose a photo or PDF of the document first."
                return
            }
            let result = try await ImageUploader.uploadVerificationDocument(
                item: item,
                documentType: selectedType
            )
            onUploaded(result)
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

#Preview {
    NavigationStack {
        VerificationDocumentsView()
            .environmentObject(AuthViewModel())
    }
    .preferredColorScheme(.dark)
    .tint(BrandTheme.accent)
}
