import AVFoundation
import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

// MARK: - Camera authorization (IOS-MED.5)

/// Result of checking / requesting camera (video) permission before presenting UI.
enum CameraPresentResult: Sendable, Equatable {
    /// Authorized (or just granted) — safe to present `CameraImagePicker`.
    case ready
    /// Denied or restricted — show Settings alert + library fallback copy.
    case denied
    /// Device has no camera source.
    case unavailable
}

/// Pre-flight for `UIImagePickerController` camera presentation.
enum CameraAuthorization {
    /// Check `AVCaptureDevice` video status; request if `.notDetermined`.
    /// Call from MainActor before setting `showCamera = true`.
    @MainActor
    static func prepareToPresent() async -> CameraPresentResult {
        #if canImport(UIKit)
        guard UIImagePickerController.isSourceTypeAvailable(.camera) else {
            return .unavailable
        }
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            return .ready
        case .notDetermined:
            let granted = await AVCaptureDevice.requestAccess(for: .video)
            return granted ? .ready : .denied
        case .denied, .restricted:
            return .denied
        @unknown default:
            return .denied
        }
        #else
        return .unavailable
        #endif
    }
}

extension View {
    /// Alert when camera permission is denied/restricted: Open Settings + library fallback message.
    func cameraDeniedAlert(isPresented: Binding<Bool>) -> some View {
        alert("Camera Access Needed", isPresented: isPresented) {
            #if canImport(UIKit)
            Button("Open Settings") {
                if let url = URL(string: UIApplication.openSettingsURLString) {
                    UIApplication.shared.open(url)
                }
            }
            #endif
            Button("OK", role: .cancel) {}
        } message: {
            Text(
                "Camera access is turned off. Enable it in Settings, or choose a photo from your library instead."
            )
        }
    }
}

#if canImport(UIKit)
/// UIKit bridge for camera capture (PhotosPicker is library-only).
/// Present only after `CameraAuthorization.prepareToPresent() == .ready`.
struct CameraImagePicker: UIViewControllerRepresentable {
    @Binding var image: UIImage?
    @Environment(\.dismiss) private var dismiss

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        // Prefer camera; fall back to library only if camera hardware is gone mid-session.
        picker.sourceType = UIImagePickerController.isSourceTypeAvailable(.camera)
            ? .camera
            : .photoLibrary
        picker.allowsEditing = false
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ uiViewController: UIImagePickerController, context: Context) {}

    func makeCoordinator() -> Coordinator {
        Coordinator(self)
    }

    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let parent: CameraImagePicker

        init(_ parent: CameraImagePicker) {
            self.parent = parent
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
            parent.dismiss()
        }

        func imagePickerController(
            _ picker: UIImagePickerController,
            didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]
        ) {
            // Prefer edited if present; otherwise original. ImageUploader normalizes orientation.
            let captured = (info[.editedImage] as? UIImage) ?? (info[.originalImage] as? UIImage)
            parent.image = captured
            parent.dismiss()
        }
    }
}
#endif
