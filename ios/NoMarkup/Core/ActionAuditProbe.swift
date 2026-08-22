import UIKit

/// Process-wide UI probe so every screen appear and control activation is
/// recorded without wrapping each SwiftUI `Button` by hand.
///
/// - `viewDidAppear` → kind `screen` (hosting controller title / class)
/// - `sendAction` → kind `ui` (accessibility id or label — never field values)
///
/// `UITextField` / `UITextView` actions are ignored so typing (including
/// passwords) is never logged. HTTP hops are recorded separately by `APIClient`.
enum ActionAuditProbe {
    nonisolated(unsafe) private static var installed = false

    static func install() {
        guard !installed else { return }
        installed = true
        swizzle(
            UIApplication.self,
            #selector(UIApplication.sendAction(_:to:from:for:)),
            #selector(UIApplication.nm_audit_sendAction(_:to:from:for:))
        )
        swizzle(
            UIViewController.self,
            #selector(UIViewController.viewDidAppear(_:)),
            #selector(UIViewController.nm_audit_viewDidAppear(_:))
        )
    }

    private static func swizzle(_ cls: AnyClass, _ original: Selector, _ replacement: Selector) {
        guard
            let a = class_getInstanceMethod(cls, original),
            let b = class_getInstanceMethod(cls, replacement)
        else { return }
        method_exchangeImplementations(a, b)
    }

    static func label(for sender: Any?) -> String {
        if sender is UITextField || sender is UITextView {
            return ""
        }
        if let view = sender as? UIView {
            let id = view.accessibilityIdentifier?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            if !id.isEmpty { return id }
            let label = view.accessibilityLabel?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            if !label.isEmpty { return label }
        }
        if let item = sender as? UIBarButtonItem {
            let id = item.accessibilityIdentifier?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            if !id.isEmpty { return id }
            let title = item.title?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            if !title.isEmpty { return title }
            let label = item.accessibilityLabel?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            if !label.isEmpty { return label }
        }
        if let control = sender as? UIControl {
            return String(describing: type(of: control))
        }
        return ""
    }

    static func screenName(for controller: UIViewController) -> String {
        let title = controller.navigationItem.title
            ?? controller.title
            ?? ""
        let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmed.isEmpty { return trimmed }
        let raw = String(describing: type(of: controller))
        // SwiftUI pages are UIHostingController — only log when they have a title
        // (navigationTitle). Skip keyboard / system UIKit controllers.
        if raw.contains("Hosting") { return "" }
        if raw.hasPrefix("UI") || raw.hasPrefix("_") || raw.contains("Keyboard") || raw.contains("Input") {
            return ""
        }
        return raw
    }
}

extension UIApplication {
    @objc func nm_audit_sendAction(
        _ action: Selector,
        to target: Any?,
        from sender: Any?,
        for event: UIEvent?
    ) -> Bool {
        let label = ActionAuditProbe.label(for: sender)
        if !label.isEmpty {
            ClientActionLog.shared.recordUI(method: "TAP", path: label, kind: "ui")
        }
        return nm_audit_sendAction(action, to: target, from: sender, for: event)
    }
}

extension UIViewController {
    @objc func nm_audit_viewDidAppear(_ animated: Bool) {
        nm_audit_viewDidAppear(animated)
        let name = ActionAuditProbe.screenName(for: self)
        if !name.isEmpty {
            ClientActionLog.shared.recordUI(method: "SCREEN", path: name, kind: "screen")
        }
    }
}
