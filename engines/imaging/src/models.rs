use serde::{Deserialize, Serialize};

/// Supported output formats for image processing.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ImageFormat {
    Jpeg,
    Png,
    WebP,
}

impl ImageFormat {
    /// File extension for the format.
    #[must_use]
    pub fn extension(self) -> &'static str {
        match self {
            Self::Jpeg => "jpg",
            Self::Png => "png",
            Self::WebP => "webp",
        }
    }

    /// MIME type for the format.
    #[must_use]
    pub fn mime_type(self) -> &'static str {
        match self {
            Self::Jpeg => "image/jpeg",
            Self::Png => "image/png",
            Self::WebP => "image/webp",
        }
    }

    /// Parse a MIME type string into an `ImageFormat`.
    #[must_use]
    pub fn from_mime(mime: &str) -> Option<Self> {
        match mime {
            "image/jpeg" | "image/jpg" => Some(Self::Jpeg),
            "image/png" => Some(Self::Png),
            "image/webp" => Some(Self::WebP),
            _ => None,
        }
    }

    /// Convert the `image` crate's output format enum.
    #[must_use]
    pub fn to_image_format(self) -> image::ImageFormat {
        match self {
            Self::Jpeg => image::ImageFormat::Jpeg,
            Self::Png => image::ImageFormat::Png,
            Self::WebP => image::ImageFormat::WebP,
        }
    }
}

/// Resize strategy.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ResizeMode {
    /// Fit within bounds, maintain aspect ratio (may be smaller than target).
    Fit,
    /// Fill bounds, crop excess (center crop to exact dimensions).
    Fill,
    /// Stretch to exact dimensions (ignores aspect ratio).
    Exact,
}

/// Options controlling how an image is processed.
#[derive(Debug, Clone)]
pub struct ProcessingOptions {
    pub max_width: u32,
    pub max_height: u32,
    pub resize_mode: ResizeMode,
    /// JPEG/WebP quality 1-100. Default: 85.
    pub quality: u8,
    pub format: ImageFormat,
    pub strip_exif: bool,
    pub auto_orient: bool,
    pub generate_blur_hash: bool,
}

impl Default for ProcessingOptions {
    fn default() -> Self {
        Self {
            max_width: 1600,
            max_height: 1600,
            resize_mode: ResizeMode::Fit,
            quality: 85,
            format: ImageFormat::Jpeg,
            strip_exif: true,
            auto_orient: true,
            generate_blur_hash: false,
        }
    }
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

/// A fully processed job photo with multiple size variants.
#[derive(Debug, Clone)]
pub struct ProcessedJobPhoto {
    pub original_url: String,
    pub large: ImageVariant,
    pub medium: ImageVariant,
    pub thumbnail: ImageVariant,
    pub blur_hash: String,
}

/// Upload context determines storage paths and validation rules.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum UploadContext {
    Avatar,
    Portfolio,
    JobPhoto,
    Document,
    ReviewPhoto,
}

impl UploadContext {
    /// Convert a string context to the enum. Returns `None` for unknown contexts.
    #[must_use]
    pub fn from_str_context(s: &str) -> Option<Self> {
        match s {
            "avatar" => Some(Self::Avatar),
            "portfolio" => Some(Self::Portfolio),
            "job_photo" => Some(Self::JobPhoto),
            "document" => Some(Self::Document),
            "review_photo" => Some(Self::ReviewPhoto),
            _ => None,
        }
    }

    /// S3 path prefix for this context.
    #[must_use]
    pub fn path_prefix(self) -> &'static str {
        match self {
            Self::Avatar => "avatars",
            Self::Portfolio => "portfolio",
            Self::JobPhoto => "job-photos",
            Self::Document => "documents",
            Self::ReviewPhoto => "review-photos",
        }
    }
}

/// Allowed MIME types for image uploads.
pub const ALLOWED_MIME_TYPES: &[&str] = &["image/jpeg", "image/png", "image/webp"];

/// Maximum upload file size: 10 MB.
pub const MAX_FILE_SIZE_BYTES: i64 = 10_485_760;

/// Default JPEG/WebP quality.
pub const DEFAULT_QUALITY: u8 = 85;

/// Pre-signed URL expiry in seconds (15 minutes).
pub const PRESIGN_EXPIRY_SECS: u64 = 900;

/// Errors originating from the imaging pipeline.
#[derive(Debug, thiserror::Error)]
pub enum ImagingError {
    #[error("invalid argument: {0}")]
    InvalidArgument(String),

    #[error("unsupported format: {0}")]
    UnsupportedFormat(String),

    #[error("file too large: {size} bytes exceeds limit of {limit} bytes")]
    FileTooLarge { size: i64, limit: i64 },

    #[error("unsupported MIME type: {0}")]
    UnsupportedMimeType(String),

    #[error("S3 error: {0}")]
    S3Error(String),

    #[error("image decode error: {0}")]
    DecodeError(String),

    #[error("image encode error: {0}")]
    EncodeError(String),

    #[error("object not found: {0}")]
    NotFound(String),

    #[error("internal error: {0}")]
    Internal(String),
}
