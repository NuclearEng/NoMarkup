# App Icon — dark / tinted appearances (DES.6)

## Current shipping asset

- SpringBoard / App Store: `ios/NoMarkup/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png`
- Source master: `brand/app-icon-champagne-m.png` (and related candidates in this folder)

## Dark & tinted slots (iOS 18+)

Xcode supports optional **luminosity dark** and **tinted** appearances on the single-size iOS app icon. We intentionally ship **one universal 1024×1024** until a designed dark variant exists.

**TODO (do not invent):**

1. Design a true dark-mode App Icon (navy field + champagne M↓) that does not simply invert the light asset.
2. Optionally design a tinted monochrome silhouette for iOS home-screen tinting.
3. Drop PNGs into `AppIcon.appiconset` and wire `Contents.json` appearances:

```json
{
  "images" : [
    {
      "filename" : "AppIcon-1024.png",
      "idiom" : "universal",
      "platform" : "ios",
      "size" : "1024x1024"
    },
    {
      "appearances" : [
        { "appearance" : "luminosity", "value" : "dark" }
      ],
      "filename" : "AppIcon-1024-dark.png",
      "idiom" : "universal",
      "platform" : "ios",
      "size" : "1024x1024"
    },
    {
      "appearances" : [
        { "appearance" : "luminosity", "value" : "tinted" }
      ],
      "filename" : "AppIcon-1024-tinted.png",
      "idiom" : "universal",
      "platform" : "ios",
      "size" : "1024x1024"
    }
  ],
  "info" : { "author" : "xcode", "version" : 1 }
}
```

Until those files land, the universal light asset is used for all appearances (system may apply automatic adjustments).
