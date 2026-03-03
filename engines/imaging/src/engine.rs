/// Image processing pipeline using the `image` crate (with `libvips` FFI for production).
///
/// Handles resize, format conversion, EXIF stripping, `BlurHash` generation,
/// and context-specific processing (job photos, portfolio, avatars, documents).
///
/// Target: < 200ms p99 latency for image processing.
pub struct ImagePipeline;

impl ImagePipeline {
    #[must_use]
    pub fn new() -> Self {
        Self
    }
}

impl Default for ImagePipeline {
    fn default() -> Self {
        Self::new()
    }
}
