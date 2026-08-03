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
    pub const fn extension(self) -> &'static str {
        match self {
            Self::Jpeg => "jpg",
            Self::Png => "png",
            Self::WebP => "webp",
        }
    }

    /// MIME type for the format.
    #[must_use]
    pub const fn mime_type(self) -> &'static str {
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
    // Lib/test surface; the binary's libvips encode path selects the format
    // directly, so this `image`-crate mapping is unused in the `bin` target.
    #[allow(dead_code)]
    #[must_use]
    pub const fn to_image_format(self) -> image::ImageFormat {
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
    /// Remove EXIF metadata (privacy). Stripping is the only supported mode:
    /// the pipeline re-encodes every output (decode → transform → encode),
    /// which drops all metadata — EXIF/GPS/XMP/IPTC — regardless of this
    /// flag; no output path copies original bytes. `false` does NOT
    /// round-trip metadata (the pipeline logs when it is requested). Kept on
    /// the wire contract for forward compatibility.
    pub strip_exif: bool,
    /// Apply the EXIF orientation tag to the pixels before resize/encode,
    /// then strip (matches the proto contract: "apply EXIF orientation then
    /// strip"). Without this, camera-rotated photos would display sideways
    /// once their orientation tag is stripped. Fail-soft: unreadable or
    /// garbage EXIF is treated as orientation 1 (no transform).
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
    Listing,
    /// Chat file attachments (PDF invoices, scope docs). Pass-through storage only.
    ChatAttachment,
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
            "listing" => Some(Self::Listing),
            "chat_attachment" => Some(Self::ChatAttachment),
            _ => None,
        }
    }

    /// S3 path prefix for this context.
    #[must_use]
    pub const fn path_prefix(self) -> &'static str {
        match self {
            Self::Avatar => "avatars",
            Self::Portfolio => "portfolio",
            Self::JobPhoto => "job-photos",
            Self::Document => "documents",
            Self::ReviewPhoto => "review-photos",
            Self::Listing => "listings",
            Self::ChatAttachment => "chat-attachments",
        }
    }

    /// Whether this context may store PDF pass-through (no decode/re-encode).
    ///
    /// Image-only contexts (avatar, job photos, …) stay fail-closed on non-images.
    /// Verification docs and chat file attach accept `application/pdf` (FR-2.2 / FR-8.3).
    #[must_use]
    pub const fn allows_pdf(self) -> bool {
        matches!(self, Self::Document | Self::ChatAttachment)
    }

    /// MIME types accepted for presign on this context.
    #[must_use]
    pub const fn allowed_mime_types(self) -> &'static [&'static str] {
        if self.allows_pdf() {
            DOCUMENT_ALLOWED_MIME_TYPES
        } else {
            ALLOWED_MIME_TYPES
        }
    }
}

/// Allowed MIME types for pure image uploads (avatar, portfolio, job_photo, listing, …).
pub const ALLOWED_MIME_TYPES: &[&str] = &["image/jpeg", "image/png", "image/webp"];

/// Document + chat-attachment contexts: images and PDF pass-through.
pub const DOCUMENT_ALLOWED_MIME_TYPES: &[&str] =
    &["image/jpeg", "image/png", "image/webp", "application/pdf"];

/// Wire MIME for PDF uploads.
pub const MIME_APPLICATION_PDF: &str = "application/pdf";

/// Infer allowed MIME set from an object-key prefix (confirm path has no context field).
///
/// Keys are `{context_prefix}/{user_id}/…`. PDF is valid only under document /
/// chat-attachment prefixes; every other prefix stays image-only (fail closed).
#[must_use]
pub fn allowed_mime_types_for_object_key(object_key: &str) -> &'static [&'static str] {
    if object_key.starts_with("documents/") || object_key.starts_with("chat-attachments/") {
        DOCUMENT_ALLOWED_MIME_TYPES
    } else {
        ALLOWED_MIME_TYPES
    }
}

/// Sniff content type from magic bytes. Supports JPEG/PNG/WebP + PDF.
///
/// Returns `application/octet-stream` when the payload is not an allowed image
/// or PDF — callers treat that as invalid against the context allow-list.
#[must_use]
pub fn sniff_content_type(bytes: &[u8]) -> String {
    // PDF: "%PDF" at offset 0 (ISO 32000).
    if bytes.len() >= 4 && bytes[0] == b'%' && bytes[1] == b'P' && bytes[2] == b'D' && bytes[3] == b'F'
    {
        return MIME_APPLICATION_PDF.to_string();
    }
    match image::guess_format(bytes) {
        Ok(image::ImageFormat::Jpeg) => "image/jpeg".to_string(),
        Ok(image::ImageFormat::Png) => "image/png".to_string(),
        Ok(image::ImageFormat::WebP) => "image/webp".to_string(),
        _ => "application/octet-stream".to_string(),
    }
}

/// True when bytes look like a PDF (magic header).
#[must_use]
pub fn is_pdf_bytes(bytes: &[u8]) -> bool {
    sniff_content_type(bytes) == MIME_APPLICATION_PDF
}

/// File extension for a declared MIME type used at presign.
#[must_use]
pub fn extension_for_mime(mime_type: &str) -> &'static str {
    if mime_type == MIME_APPLICATION_PDF {
        return "pdf";
    }
    ImageFormat::from_mime(mime_type).map_or("bin", ImageFormat::extension)
}

/// Maximum upload file size: 10 MB.
pub const MAX_FILE_SIZE_BYTES: i64 = 10_485_760;

/// Maximum width or height accepted by the decoder, in pixels.
///
/// A compressed image bounded by [`MAX_FILE_SIZE_BYTES`] can still describe
/// enormous dimensions — that is the decompression-bomb shape — and the
/// decoder allocates the full uncompressed buffer before any of our code
/// runs. 20 000 px is roughly 4x the long edge of a 100 MP sensor, so it
/// rejects bombs without touching real photographs.
pub const MAX_DECODE_DIMENSION: u32 = 20_000;

/// Hard ceiling on decoder allocation: 256 MB.
///
/// Backstop for dimension combinations that individually pass the width and
/// height caps (e.g. 20 000 x 20 000 x 4 bytes ≈ 1.6 GB). An allocator abort
/// is one of the few failures a `catch_unwind` boundary cannot rescue, so it
/// would take the whole process down rather than failing one request.
pub const MAX_DECODE_ALLOC_BYTES: u64 = 256 * 1024 * 1024;

/// Maximum number of images accepted in a single batch RPC.
///
/// `BatchProcessImages` and `ProcessJobPhotos` previously validated only that
/// the list was non-empty, so one caller could hand the engine an unbounded
/// amount of CPU work in a single request. Each 1080p image costs roughly
/// 30 ms of decode + resize + encode (`benches/imaging_bench.rs`), and the
/// job-photo path renders four outputs per image, so an uncapped batch is a
/// trivial denial-of-service against a fixed-size blocking pool.
///
/// 16 sits above the product limit — the job and listing forms cap uploads at
/// 10 photos (`web/src/components/forms/JobPostingForm.tsx`) — while bounding
/// one request to well under a second of pooled CPU.
pub const MAX_BATCH_IMAGES: usize = 16;

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
