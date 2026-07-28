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
    }
}
