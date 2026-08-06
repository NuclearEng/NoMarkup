import SwiftUI

/// Defers construction of a destination view until it is actually presented.
///
/// Account / long-form lists with many `NavigationLink(destination:)` builders
/// can overflow the main thread stack on device when SwiftUI specializes
/// destination metadata for every row at once (`Thread stack size exceeded`).
/// Wrap destinations in `LazyView { … }` so only the tapped row is initialized.
struct LazyView<Content: View>: View {
    private let build: () -> Content

    init(@ViewBuilder _ build: @escaping () -> Content) {
        self.build = build
    }

    var body: some View {
        build()
    }
}
