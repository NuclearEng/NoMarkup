# SIM-TEST.5/6 — tab bar lost after Account → Following

**Cause:** iOS 18+/26 implicitly hides `.tabBar` on some pushed Account lists and does not restore it on pop. Trigger surfaces: `FollowingView.swift:106` (eager `NavigationLink { ProviderDetailView }` — no `LazyView`, unlike `ProvidersView.swift:67`) and `ProvidersView.swift:18` (`.searchable` on a pushed hub). Walk log: `54-account-following` then first `WALK-SKIP tab-Account`; test06 lost the shell after Providers.

**Fix:** `keepRootTabBarVisible()` (`.toolbar(.visible, for: .tabBar)`) on Account root, Following / Feed / Providers / ProviderDetail, and every `LazyView` destination. Following now defers `ProviderDetailView` via `LazyView`. `popToRoot("Account")` pops via Back first when `app.tabBars` is missing so a hide-on-push still restores chrome.

**Not done:** no commit. Message thread rows already use `messages.row.{id}`.
