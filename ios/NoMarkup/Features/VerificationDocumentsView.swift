import PhotosUI
import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

/// Provider verification documents — list + upload.
///
/// APIs:
/// - `GET  /api/v1/providers/me/documents` → `{ "documents": [] }`
/// - `POST /api/v1/providers/me/documents` after imaging pipeline
///   (`context: document` → owned `documents/{userID}/…` key).
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
                ProgressView("Loading documents…")
                    .tint(BrandTheme.accent)
                    .foregroundStyle(BrandTheme.textSecondary)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .brandScreenBackground()
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
            } else if documents.isEmpty {
                BrandEmptyState(
                    title: "No documents yet",
                    systemImage: "doc.badge.plus",
                    message: "Upload a photo of your driver’s license, insurance, or trade license for platform review. JPEG, PNG, or WebP up to 10 MB.",
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
        .toolbarBackground(BrandTheme.navy, for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
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
        auth.isAuthenticated && !auth.isScaffoldSession && hasProviderRole
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

            Section {
                ForEach(documents) { doc in
                    documentRow(doc)
                        .listRowBackground(BrandTheme.navyElevated)
                }
            } header: {
                Text("\(documents.count) document\(documents.count == 1 ? "" : "s")").brandSectionHeader()
            } footer: {
                Text("JPEG, PNG, or WebP up to 10 MB. MIME type is re-checked server-side; only files you upload under your account can be registered.")
                    .foregroundStyle(BrandTheme.textSecondary)
            }

            Section {
                Button {
                    showUploadSheet = true
                } label: {
                    Label("Upload another document", systemImage: "doc.badge.plus")
                }
                .frame(minHeight: 44)
                .listRowBackground(BrandTheme.navyElevated)
                .accessibilityHint("Choose document type and pick a photo to submit for review")
            }
        }
        .brandListBackground()
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
            HStack {
                if let count = doc.resubmissionCount, count > 0 {
                    Text("Resubmissions: \(count)")
                        .font(.caption2)
                        .foregroundStyle(BrandTheme.textSecondary)
                }
                Spacer()
                if let expires = doc.expiresAt, !expires.isEmpty {
                    Text("Expires \(CatalogDateFormat.friendlyDateTime(expires))")
                        .font(.caption2)
                        .foregroundStyle(BrandTheme.textSecondary)
                }
            }
        }
        .frame(minHeight: 44)
        .accessibilityElement(children: .combine)
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

    let onUploaded: (ProviderDocumentUploadResult) -> Void

    @State private var selectedType: ProviderDocumentType = .driversLicense
    @State private var pickerItem: PhotosPickerItem?
    @State private var showCamera = false
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
                    Picker("Document type", selection: $selectedType) {
                        ForEach(ProviderDocumentType.allCases) { type in
                            Text(type.displayLabel).tag(type)
                        }
                    }
                    .pickerStyle(.navigationLink)
                    .frame(minHeight: 44)
                    .accessibilityLabel("Document type")

                    Text(selectedType.detail)
                        .font(.caption)
                        .foregroundStyle(BrandTheme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                } header: {
                    Text("Type").brandSectionHeader()
                } footer: {
                    Text("Must match a supported verification type. Review is handled by the platform.")
                        .foregroundStyle(BrandTheme.textSecondary)
                }
                .listRowBackground(BrandTheme.navyElevated)

                Section {
                    PhotosPicker(
                        selection: $pickerItem,
                        matching: .images,
                        photoLibrary: .shared()
                    ) {
                        HStack {
                            Label(
                                hasCapture || pickerItem != nil ? "Change from library" : "Choose from library",
                                systemImage: "photo.on.rectangle.angled"
                            )
                            Spacer()
                            if isUploading {
                                ProgressView()
                                    .tint(BrandTheme.accent)
                            } else if hasCapture || pickerItem != nil {
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
                        if item != nil { hasCapture = true }
                    }

                    #if canImport(UIKit)
                    Button {
                        showCamera = true
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
                    .onChange(of: cameraImage) { _, image in
                        if image != nil {
                            hasCapture = true
                            pickerItem = nil
                        }
                    }
                    #endif
                } header: {
                    Text("Photo").brandSectionHeader()
                } footer: {
                    Text("Library or camera. JPEG, PNG, WebP. Max 10 MB. PDF is not accepted on this path.")
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
            .toolbarBackground(BrandTheme.navy, for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
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
                    .disabled(isUploading || !hasCapture || !auth.isAuthenticated || auth.isScaffoldSession)
                    .accessibilityLabel("Submit verification document")
                }
            }
        }
        .preferredColorScheme(.dark)
        .tint(BrandTheme.accent)
    }

    @MainActor
    private func submit() async {
        guard auth.isAuthenticated, !auth.isScaffoldSession else {
            errorMessage = "Sign in as a provider to upload documents."
            return
        }

        errorMessage = nil
        isUploading = true
        defer { isUploading = false }

        do {
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
                errorMessage = "Choose or capture a photo of the document first."
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
