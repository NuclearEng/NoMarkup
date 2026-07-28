import AppIntents
import SwiftUI
import WidgetKit

@main
struct NoMarkupWidgetBundle: WidgetBundle {
    var body: some Widget {
        ActiveBidsWidget()
        NextClosingWidget()
        #if canImport(ActivityKit)
        AuctionLiveActivityWidget()
        #endif
        // IOS-SYS.MISC.2: Control Center / Lock Screen controls are iOS 18-only
        // (`ControlWidget` / `StaticControlConfiguration` / `ControlWidgetButton` are all
        // `@available(iOS 18.0, *)` in the installed SDK) while this target's floor is
        // 17.0, so the controls join through the builder's verified limited-availability
        // path (`WidgetBundleBuilder.buildLimitedAvailability`, iOS 16.1+; "if statements
        // in a WidgetBundleBuilder can only be used with #available clauses").
        if #available(iOS 18.0, *) {
            NoMarkupControlsBundle().body
        }
    }
}

// MARK: - Control Center controls (IOS-SYS.MISC.2)

/// iOS 18 controls, nested so the whole bundle keeps the 17.0 floor.
///
/// MISC.2: the buttons intentionally do NOT reference the app target's
/// `OpenPostJobIntent` / `CheckInToJobIntent` types. A control's action intent is
/// compiled into and executed in the widget-extension process, and those types exist
/// only in the app target's Sources — and cannot be moved here cleanly: their
/// `perform()` calls `DeepLinkRouter.shared.open(...)`, which only navigates inside
/// the app process, and compiling the same intent structs into both targets would
/// register duplicate intents in both bundles' App Intents metadata. The SDK-verified
/// equivalent used instead: an extension-local intent with `openAppWhenRun = true`
/// returning `.result(opensIntent: OpenURLIntent(...))` (both iOS 18+ in the installed
/// AppIntents swiftinterface) aimed at the same `nomarkup://` routes those app intents
/// open (`DeepLinkRouter` parses `post-job` → `.postJob` and `check-in` →
/// `.checkIn(contractID: nil)`; the app handles them via `onOpenURL`). Behavior
/// matches the app intents' navigation; the app-side signed-out experience is the
/// login screen, same as any deep link while signed out.
@available(iOS 18.0, *)
struct NoMarkupControlsBundle: WidgetBundle {
    var body: some Widget {
        PostJobControlWidget()
        CheckInControlWidget()
    }
}

/// "Post a job" control — opens the native post-job flow.
@available(iOS 18.0, *)
struct PostJobControlWidget: ControlWidget {
    /// Kind naming follows the plain widget kinds in `WidgetSharedStore`
    /// ("ActiveBidsWidget" / "NextClosingWidget").
    static let kind = "PostJobControl"

    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: Self.kind) {
            ControlWidgetButton(action: OpenPostJobControlIntent()) {
                Label("Post a Job", systemImage: "plus.circle.fill")
            }
        }
        .displayName("Post a Job")
        .description("Start a new reverse-auction service job on NoMarkup.")
    }
}

/// "Check in" control — opens the job-site check-in flow (contract picker).
@available(iOS 18.0, *)
struct CheckInControlWidget: ControlWidget {
    static let kind = "CheckInControl"

    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: Self.kind) {
            ControlWidgetButton(action: CheckInControlIntent()) {
                Label("Check In", systemImage: "mappin.and.ellipse")
            }
        }
        .displayName("Check In to Job")
        .description("Open NoMarkup to check in at a job site.")
    }
}

/// Extension-local mirror of the app target's `OpenPostJobIntent` (see the
/// MISC.2 note on `NoMarkupControlsBundle` for why the app type is not reused).
@available(iOS 18.0, *)
struct OpenPostJobControlIntent: AppIntent {
    static var title: LocalizedStringResource { "Post a Job" }
    static var description: IntentDescription {
        IntentDescription("Start a new reverse-auction service job on NoMarkup.")
    }
    static var openAppWhenRun: Bool { true }

    /// Constant scheme URL parsed by `DeepLinkRouter` (`post-job` → `.postJob`).
    private static let deepLinkURL = URL(string: "nomarkup://post-job")!

    func perform() async throws -> some IntentResult & OpensIntent {
        .result(opensIntent: OpenURLIntent(Self.deepLinkURL))
    }
}

/// Extension-local mirror of the app target's `CheckInToJobIntent` (no contract
/// parameter — a control button fires without configuration, so it opens the
/// same contract-picker path as `CheckInToJobIntent` with no contract selected).
@available(iOS 18.0, *)
struct CheckInControlIntent: AppIntent {
    static var title: LocalizedStringResource { "Check In to Job" }
    static var description: IntentDescription {
        IntentDescription("Opens NoMarkup so you can check in at a job site for dispute protection.")
    }
    static var openAppWhenRun: Bool { true }

    /// Constant scheme URL parsed by `DeepLinkRouter` (`check-in` → `.checkIn(contractID: nil)`).
    private static let deepLinkURL = URL(string: "nomarkup://check-in")!

    func perform() async throws -> some IntentResult & OpensIntent {
        .result(opensIntent: OpenURLIntent(Self.deepLinkURL))
    }
}
