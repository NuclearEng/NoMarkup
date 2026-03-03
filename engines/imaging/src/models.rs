use serde::{Deserialize, Serialize};

/// Supported output formats for image processing.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ImageFormat {
    Jpeg,
    Png,
    WebP,
    Avif,
}

/// Resize strategy.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ResizeMode {
    Fit,
    Fill,
    Exact,
}

/// A processed image variant (e.g., thumbnail, medium, large).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImageVariant {
    pub url: String,
    pub width: u32,
    pub height: u32,
    pub format: ImageFormat,
    pub size_bytes: u32,
    pub variant_name: String,
}
