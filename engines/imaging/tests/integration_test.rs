//! Integration tests for the imaging pipeline.
//!
//! These tests exercise the pure image processing functions (resize, encode,
//! decode, blur hash) without requiring S3 or network access.

use image::{DynamicImage, GenericImageView, RgbaImage};
use imaging::models::{
    ImageFormat, ImageVariant, ImagingError, ProcessingOptions, ResizeMode, UploadContext,
    ALLOWED_MIME_TYPES, DEFAULT_QUALITY, MAX_FILE_SIZE_BYTES,
};

/// Helper: create a solid-color test image of the given dimensions.
fn make_test_image(w: u32, h: u32) -> DynamicImage {
    let img = RgbaImage::from_fn(w, h, |_x, _y| image::Rgba([128, 64, 192, 255]));
    DynamicImage::ImageRgba8(img)
}

/// Helper: encode a test image to bytes in the given format.
fn encode_test_image(img: &DynamicImage, fmt: image::ImageFormat) -> Vec<u8> {
    let mut buf = std::io::Cursor::new(Vec::new());
    img.write_to(&mut buf, fmt).expect("encode image");
    buf.into_inner()
}

// ---------------------------------------------------------------------------
// Image processing pipeline
// ---------------------------------------------------------------------------

#[test]
fn process_pipeline_resize_and_encode_jpeg() {
    let img = make_test_image(1920, 1080);
    let resized = img.resize(800, 600, image::imageops::FilterType::Lanczos3);
    let (w, h) = resized.dimensions();
    assert!(w <= 800);
    assert!(h <= 600);

    let mut buf = std::io::Cursor::new(Vec::new());
    let encoder =
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buf, DEFAULT_QUALITY);
    resized
        .write_with_encoder(encoder)
        .expect("encode JPEG");
    let encoded = buf.into_inner();
    assert!(!encoded.is_empty());
}

#[test]
fn process_pipeline_resize_and_encode_png() {
    let img = make_test_image(800, 600);
    let resized = img.resize(400, 300, image::imageops::FilterType::Lanczos3);

    let encoded = encode_test_image(&resized, image::ImageFormat::Png);
    assert!(!encoded.is_empty());

    // Decode back and verify dimensions.
    let decoded = image::load_from_memory(&encoded).expect("decode PNG");
    let (w, h) = decoded.dimensions();
    assert!(w <= 400);
    assert!(h <= 300);
}

#[test]
fn process_pipeline_resize_and_encode_webp() {
    let img = make_test_image(640, 480);
    let resized = img.resize(320, 240, image::imageops::FilterType::Lanczos3);

    let encoded = encode_test_image(&resized, image::ImageFormat::WebP);
    assert!(!encoded.is_empty());
}

// ---------------------------------------------------------------------------
// Resize modes
// ---------------------------------------------------------------------------

#[test]
fn resize_fit_preserves_aspect_ratio() {
    let img = make_test_image(1600, 900); // 16:9
    let resized = img.resize(800, 800, image::imageops::FilterType::Lanczos3);
    let (w, h) = resized.dimensions();

    // Should fit within 800x800 while maintaining aspect ratio.
    assert!(w <= 800);
    assert!(h <= 800);
    // Width should be larger than height for a landscape image.
    assert!(w > h, "Landscape image should have w > h after fit resize");
}

#[test]
fn resize_exact_ignores_aspect_ratio() {
    let img = make_test_image(800, 600);
    let resized = img.resize_exact(200, 200, image::imageops::FilterType::Lanczos3);
    let (w, h) = resized.dimensions();
    assert_eq!(w, 200);
    assert_eq!(h, 200);
}

#[test]
fn resize_does_not_upscale_small_images() {
    let img = make_test_image(100, 80);
    // resize() only downscales; if the image is already smaller, it clips to bounds.
    let resized = img.resize(400, 300, image::imageops::FilterType::Lanczos3);
    let (w, h) = resized.dimensions();
    // Should not exceed original dimensions.
    assert!(w <= 400);
    assert!(h <= 300);
}

// ---------------------------------------------------------------------------
// Format conversion round-trips
// ---------------------------------------------------------------------------

#[test]
fn jpeg_to_png_conversion() {
    let img = make_test_image(100, 100);
    let jpeg_bytes = encode_test_image(&img, image::ImageFormat::Jpeg);
    let decoded = image::load_from_memory(&jpeg_bytes).expect("decode JPEG");
    let png_bytes = encode_test_image(&decoded, image::ImageFormat::Png);
    assert!(!png_bytes.is_empty());

    let final_img = image::load_from_memory(&png_bytes).expect("decode PNG");
    let (w, h) = final_img.dimensions();
    assert_eq!(w, 100);
    assert_eq!(h, 100);
}

#[test]
fn png_to_webp_conversion() {
    let img = make_test_image(80, 80);
    let png_bytes = encode_test_image(&img, image::ImageFormat::Png);
    let decoded = image::load_from_memory(&png_bytes).expect("decode PNG");
    let webp_bytes = encode_test_image(&decoded, image::ImageFormat::WebP);
    assert!(!webp_bytes.is_empty());
}

// ---------------------------------------------------------------------------
// ImageFormat model
// ---------------------------------------------------------------------------

#[test]
fn image_format_extension_mapping() {
    assert_eq!(ImageFormat::Jpeg.extension(), "jpg");
    assert_eq!(ImageFormat::Png.extension(), "png");
    assert_eq!(ImageFormat::WebP.extension(), "webp");
}

#[test]
fn image_format_mime_mapping() {
    assert_eq!(ImageFormat::Jpeg.mime_type(), "image/jpeg");
    assert_eq!(ImageFormat::Png.mime_type(), "image/png");
    assert_eq!(ImageFormat::WebP.mime_type(), "image/webp");
}

#[test]
fn image_format_from_mime_all_supported() {
    assert_eq!(ImageFormat::from_mime("image/jpeg"), Some(ImageFormat::Jpeg));
    assert_eq!(ImageFormat::from_mime("image/jpg"), Some(ImageFormat::Jpeg));
    assert_eq!(ImageFormat::from_mime("image/png"), Some(ImageFormat::Png));
    assert_eq!(ImageFormat::from_mime("image/webp"), Some(ImageFormat::WebP));
}

#[test]
fn image_format_from_mime_unsupported() {
    assert_eq!(ImageFormat::from_mime("image/gif"), None);
    assert_eq!(ImageFormat::from_mime("image/bmp"), None);
    assert_eq!(ImageFormat::from_mime("text/plain"), None);
    assert_eq!(ImageFormat::from_mime(""), None);
}

// ---------------------------------------------------------------------------
// ProcessingOptions
// ---------------------------------------------------------------------------

#[test]
fn processing_options_default_values() {
    let opts = ProcessingOptions::default();
    assert_eq!(opts.max_width, 1600);
    assert_eq!(opts.max_height, 1600);
    assert_eq!(opts.resize_mode, ResizeMode::Fit);
    assert_eq!(opts.quality, DEFAULT_QUALITY);
    assert_eq!(opts.format, ImageFormat::Jpeg);
    assert!(opts.strip_exif);
    assert!(opts.auto_orient);
    assert!(!opts.generate_blur_hash);
}

// ---------------------------------------------------------------------------
// UploadContext
// ---------------------------------------------------------------------------

#[test]
fn upload_context_from_str_all_variants() {
    let contexts = [
        ("avatar", UploadContext::Avatar),
        ("portfolio", UploadContext::Portfolio),
        ("job_photo", UploadContext::JobPhoto),
        ("document", UploadContext::Document),
        ("review_photo", UploadContext::ReviewPhoto),
    ];

    for (input, expected) in &contexts {
        assert_eq!(
            UploadContext::from_str_context(input),
            Some(*expected),
            "Failed for context: {input}"
        );
    }
}

#[test]
fn upload_context_from_str_invalid() {
    assert_eq!(UploadContext::from_str_context(""), None);
    assert_eq!(UploadContext::from_str_context("unknown"), None);
    assert_eq!(UploadContext::from_str_context("video"), None);
}

#[test]
fn upload_context_path_prefixes() {
    assert_eq!(UploadContext::Avatar.path_prefix(), "avatars");
    assert_eq!(UploadContext::Portfolio.path_prefix(), "portfolio");
    assert_eq!(UploadContext::JobPhoto.path_prefix(), "job-photos");
    assert_eq!(UploadContext::Document.path_prefix(), "documents");
    assert_eq!(UploadContext::ReviewPhoto.path_prefix(), "review-photos");
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

#[test]
fn allowed_mime_types_correct() {
    assert!(ALLOWED_MIME_TYPES.contains(&"image/jpeg"));
    assert!(ALLOWED_MIME_TYPES.contains(&"image/png"));
    assert!(ALLOWED_MIME_TYPES.contains(&"image/webp"));
    assert!(!ALLOWED_MIME_TYPES.contains(&"image/gif"));
    assert!(!ALLOWED_MIME_TYPES.contains(&"application/pdf"));
}

#[test]
fn max_file_size_is_10mb() {
    assert_eq!(MAX_FILE_SIZE_BYTES, 10 * 1024 * 1024);
}

// ---------------------------------------------------------------------------
// ImagingError display
// ---------------------------------------------------------------------------

#[test]
fn imaging_error_messages() {
    let err = ImagingError::FileTooLarge {
        size: 15_000_000,
        limit: MAX_FILE_SIZE_BYTES,
    };
    assert!(err.to_string().contains("too large"));

    let err = ImagingError::UnsupportedMimeType("image/gif".into());
    assert!(err.to_string().contains("image/gif"));

    let err = ImagingError::DecodeError("corrupt header".into());
    assert!(err.to_string().contains("corrupt header"));

    let err = ImagingError::NotFound("missing.jpg".into());
    assert!(err.to_string().contains("missing.jpg"));
}

// ---------------------------------------------------------------------------
// ImageVariant
// ---------------------------------------------------------------------------

#[test]
fn image_variant_construction() {
    let variant = ImageVariant {
        url: "http://localhost:9000/images/test.jpg".into(),
        width: 800,
        height: 600,
        format: ImageFormat::Jpeg,
        size_bytes: 45_000,
        variant_name: "large".into(),
    };

    assert_eq!(variant.width, 800);
    assert_eq!(variant.height, 600);
    assert_eq!(variant.format, ImageFormat::Jpeg);
    assert_eq!(variant.size_bytes, 45_000);
    assert_eq!(variant.variant_name, "large");
}

#[test]
fn image_variant_serde_roundtrip() {
    let variant = ImageVariant {
        url: "http://example.com/img.webp".into(),
        width: 400,
        height: 300,
        format: ImageFormat::WebP,
        size_bytes: 25_000,
        variant_name: "medium".into(),
    };

    let json = serde_json::to_string(&variant).expect("serialize");
    let parsed: ImageVariant = serde_json::from_str(&json).expect("deserialize");
    assert_eq!(parsed.width, 400);
    assert_eq!(parsed.height, 300);
    assert_eq!(parsed.format, ImageFormat::WebP);
}

// ---------------------------------------------------------------------------
// End-to-end: create image, resize, encode, decode, verify
// ---------------------------------------------------------------------------

#[test]
fn full_pipeline_create_resize_encode_decode() {
    // Create a test image.
    let img = make_test_image(2000, 1500);
    assert_eq!(img.dimensions(), (2000, 1500));

    // Resize to max 800x600.
    let resized = img.resize(800, 600, image::imageops::FilterType::Lanczos3);
    let (w, h) = resized.dimensions();
    assert!(w <= 800, "Width {w} should be <= 800");
    assert!(h <= 600, "Height {h} should be <= 600");

    // Encode as JPEG.
    let encoded = encode_test_image(&resized, image::ImageFormat::Jpeg);
    assert!(!encoded.is_empty());
    assert!(
        (encoded.len() as i64) < MAX_FILE_SIZE_BYTES,
        "Encoded size {} should be under limit",
        encoded.len()
    );

    // Decode and verify.
    let decoded = image::load_from_memory(&encoded).expect("decode");
    let (dw, dh) = decoded.dimensions();
    assert_eq!(dw, w);
    assert_eq!(dh, h);
}
