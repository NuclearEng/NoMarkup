/// Image processing pipeline backed by the `image` crate and AWS S3-compatible
/// (MinIO) object storage.
///
/// Handles resize, format conversion, EXIF stripping (by re-encoding),
/// BlurHash generation, and context-specific processing pipelines for job
/// photos, portfolio images, avatars, and documents.
use std::io::Cursor;

use aws_sdk_s3::presigning::PresigningConfig;
use aws_sdk_s3::primitives::ByteStream;
use image::imageops::FilterType;
use image::{DynamicImage, GenericImageView, ImageFormat as ImgFmt};
use uuid::Uuid;

use crate::models::{
    ImageFormat, ImageVariant, ImagingError, ProcessedJobPhoto, ProcessingOptions, ResizeMode,
    UploadContext, ALLOWED_MIME_TYPES, DEFAULT_QUALITY, MAX_FILE_SIZE_BYTES, PRESIGN_EXPIRY_SECS,
};

/// Core image pipeline — stateless beyond the S3 client handle.
pub struct ImagePipeline {
    s3_client: aws_sdk_s3::Client,
    bucket: String,
    public_url_base: String,
}

impl ImagePipeline {
    /// Create a new pipeline.
    ///
    /// * `s3_client` – configured `aws-sdk-s3` client (pointed at MinIO)
    /// * `bucket` – the bucket name, e.g. `"nomarkup"`
    /// * `public_url_base` – base URL for constructing public object URLs,
    ///   e.g. `"http://localhost:9000/nomarkup"`
    #[must_use]
    pub fn new(s3_client: aws_sdk_s3::Client, bucket: String, public_url_base: String) -> Self {
        Self {
            s3_client,
            bucket,
            public_url_base,
        }
    }

    // -----------------------------------------------------------------------
    // Public API
    // -----------------------------------------------------------------------

    /// Process a single image: download, resize/reformat, optionally compute
    /// BlurHash, upload the result, and return the variant metadata.
    pub async fn process_image(
        &self,
        source_key: &str,
        opts: &ProcessingOptions,
    ) -> Result<(ImageVariant, Option<String>), ImagingError> {
        let raw = self.download_from_s3(source_key).await?;
        let img = decode_image(&raw)?;
        let (orig_w, orig_h) = img.dimensions();

        let resized = resize_image(&img, opts.max_width, opts.max_height, opts.resize_mode);
        let encoded = encode_image(&resized, opts.format, opts.quality)?;

        let (rw, rh) = resized.dimensions();
        let dest_key = self.variant_key(source_key, "processed", opts.format);
        self.upload_to_s3(&dest_key, &encoded, opts.format.mime_type())
            .await?;

        let blur_hash = if opts.generate_blur_hash {
            Some(compute_blur_hash(&resized))
        } else {
            None
        };

        let variant = ImageVariant {
            url: self.public_url(&dest_key),
            width: rw,
            height: rh,
            format: opts.format,
            size_bytes: encoded.len() as u32,
            variant_name: "processed".into(),
        };

        tracing::info!(
            source = source_key,
            orig_w,
            orig_h,
            out_w = rw,
            out_h = rh,
            format = ?opts.format,
            size = encoded.len(),
            "image processed"
        );

        Ok((variant, blur_hash))
    }

    /// Generate a single thumbnail from a source image.
    pub async fn generate_thumbnail(
        &self,
        source_key: &str,
        width: u32,
        height: u32,
        mode: ResizeMode,
    ) -> Result<ImageVariant, ImagingError> {
        let raw = self.download_from_s3(source_key).await?;
        let img = decode_image(&raw)?;
        let resized = resize_image(&img, width, height, mode);
        let encoded = encode_image(&resized, ImageFormat::Jpeg, DEFAULT_QUALITY)?;

        let (rw, rh) = resized.dimensions();
        let dest_key = self.variant_key(source_key, "thumbnail", ImageFormat::Jpeg);
        self.upload_to_s3(&dest_key, &encoded, ImageFormat::Jpeg.mime_type())
            .await?;

        Ok(ImageVariant {
            url: self.public_url(&dest_key),
            width: rw,
            height: rh,
            format: ImageFormat::Jpeg,
            size_bytes: encoded.len() as u32,
            variant_name: "thumbnail".into(),
        })
    }

    /// Process a batch of job photos. For each photo, create large (1200),
    /// medium (600), thumbnail (200) variants plus a BlurHash.
    pub async fn process_job_photos(
        &self,
        job_id: &str,
        source_keys: &[String],
    ) -> Result<Vec<ProcessedJobPhoto>, ImagingError> {
        let mut results = Vec::with_capacity(source_keys.len());

        for source_key in source_keys {
            let raw = self.download_from_s3(source_key).await?;
            let img = decode_image(&raw)?;
            let blur_hash = compute_blur_hash(&img);

            let large = self
                .create_variant(&img, source_key, job_id, "large", 1200, 1200, ResizeMode::Fit)
                .await?;
            let medium = self
                .create_variant(&img, source_key, job_id, "medium", 600, 600, ResizeMode::Fit)
                .await?;
            let thumbnail = self
                .create_variant(
                    &img,
                    source_key,
                    job_id,
                    "thumbnail",
                    200,
                    200,
                    ResizeMode::Fit,
                )
                .await?;

            results.push(ProcessedJobPhoto {
                original_url: self.public_url(source_key),
                large,
                medium,
                thumbnail,
                blur_hash,
            });
        }

        Ok(results)
    }

    /// Process a portfolio image: full (1600), display (800), thumbnail (300)
    /// variants plus BlurHash.
    pub async fn process_portfolio_image(
        &self,
        user_id: &str,
        source_key: &str,
    ) -> Result<(ImageVariant, ImageVariant, ImageVariant, String), ImagingError> {
        let raw = self.download_from_s3(source_key).await?;
        let img = decode_image(&raw)?;
        let blur_hash = compute_blur_hash(&img);

        let full = self
            .create_variant(&img, source_key, user_id, "full", 1600, 1600, ResizeMode::Fit)
            .await?;
        let display = self
            .create_variant(
                &img,
                source_key,
                user_id,
                "display",
                800,
                800,
                ResizeMode::Fit,
            )
            .await?;
        let thumb = self
            .create_variant(
                &img,
                source_key,
                user_id,
                "thumbnail",
                300,
                300,
                ResizeMode::Fit,
            )
            .await?;

        Ok((full, display, thumb, blur_hash))
    }

    /// Process an avatar image: center-crop to square then create large (400),
    /// medium (200), small (80) variants.
    pub async fn process_avatar(
        &self,
        user_id: &str,
        source_key: &str,
    ) -> Result<(ImageVariant, ImageVariant, ImageVariant, String), ImagingError> {
        let raw = self.download_from_s3(source_key).await?;
        let img = decode_image(&raw)?;

        // Center-crop to square before resizing.
        let square = crop_center_square(&img);
        let blur_hash = compute_blur_hash(&square);

        let large = self
            .create_variant(
                &square,
                source_key,
                user_id,
                "large",
                400,
                400,
                ResizeMode::Exact,
            )
            .await?;
        let medium = self
            .create_variant(
                &square,
                source_key,
                user_id,
                "medium",
                200,
                200,
                ResizeMode::Exact,
            )
            .await?;
        let small = self
            .create_variant(
                &square,
                source_key,
                user_id,
                "small",
                80,
                80,
                ResizeMode::Exact,
            )
            .await?;

        // Primary avatar URL is the medium variant.
        Ok((large, medium, small, blur_hash))
    }

    /// Process a document image: auto-orient (re-encode) without resizing,
    /// plus a thumbnail for admin review.
    pub async fn process_document(
        &self,
        user_id: &str,
        source_key: &str,
        _document_type: &str,
    ) -> Result<(ImageVariant, ImageVariant, u32, u32), ImagingError> {
        let raw = self.download_from_s3(source_key).await?;
        let img = decode_image(&raw)?;
        let (orig_w, orig_h) = img.dimensions();

        // Re-encode at original size (strips EXIF, auto-orients).
        let encoded = encode_image(&img, ImageFormat::Jpeg, 90)?;
        let dest_key = format!(
            "documents/{user_id}/processed/{}.jpg",
            Uuid::now_v7()
        );
        self.upload_to_s3(&dest_key, &encoded, "image/jpeg").await?;

        let processed = ImageVariant {
            url: self.public_url(&dest_key),
            width: orig_w,
            height: orig_h,
            format: ImageFormat::Jpeg,
            size_bytes: encoded.len() as u32,
            variant_name: "processed".into(),
        };

        // Thumbnail for admin review UI.
        let thumb = self
            .create_variant(
                &img,
                source_key,
                user_id,
                "doc-thumb",
                300,
                300,
                ResizeMode::Fit,
            )
            .await?;

        Ok((processed, thumb, orig_w, orig_h))
    }

    /// Generate a pre-signed PUT URL for direct client upload to S3/MinIO.
    ///
    /// Returns `(upload_url, object_key, expires_at_seconds)`.
    pub async fn get_upload_url(
        &self,
        user_id: &str,
        filename: &str,
        mime_type: &str,
        file_size: i64,
        context: UploadContext,
    ) -> Result<(String, String, i64), ImagingError> {
        // Validate MIME type.
        if !ALLOWED_MIME_TYPES.contains(&mime_type) {
            return Err(ImagingError::UnsupportedMimeType(mime_type.into()));
        }

        // Validate file size.
        if file_size > MAX_FILE_SIZE_BYTES {
            return Err(ImagingError::FileTooLarge {
                size: file_size,
                limit: MAX_FILE_SIZE_BYTES,
            });
        }
        if file_size <= 0 {
            return Err(ImagingError::InvalidArgument(
                "file_size_bytes must be positive".into(),
            ));
        }

        // Determine extension from MIME type.
        let ext = ImageFormat::from_mime(mime_type)
            .map(|f| f.extension())
            .unwrap_or("bin");

        // Sanitize filename: take only the stem of the original filename.
        let stem = std::path::Path::new(filename)
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("upload");

        let object_key = format!(
            "{}/{}/raw/{}_{}.{}",
            context.path_prefix(),
            user_id,
            stem,
            Uuid::now_v7(),
            ext
        );

        let expires_in = std::time::Duration::from_secs(PRESIGN_EXPIRY_SECS);
        let presign_config = PresigningConfig::builder()
            .expires_in(expires_in)
            .build()
            .map_err(|e| ImagingError::S3Error(format!("presign config: {e}")))?;

        let presigned = self
            .s3_client
            .put_object()
            .bucket(&self.bucket)
            .key(&object_key)
            .content_type(mime_type)
            .presigned(presign_config)
            .await
            .map_err(|e| ImagingError::S3Error(format!("presign PUT: {e}")))?;

        let expires_at = chrono::Utc::now().timestamp() + PRESIGN_EXPIRY_SECS as i64;

        tracing::info!(
            user_id,
            object_key = object_key.as_str(),
            mime_type,
            file_size,
            "upload URL generated"
        );

        Ok((presigned.uri().to_string(), object_key, expires_at))
    }

    /// Confirm that an upload completed successfully. Issues a HEAD request
    /// to verify the object exists and check its content type.
    ///
    /// Returns `(confirmed_url, content_type_valid, actual_content_type)`.
    pub async fn confirm_upload(
        &self,
        object_key: &str,
        _user_id: &str,
    ) -> Result<(String, bool, String), ImagingError> {
        let head = self
            .s3_client
            .head_object()
            .bucket(&self.bucket)
            .key(object_key)
            .send()
            .await
            .map_err(|e| {
                let msg = format!("{e}");
                if msg.contains("NoSuchKey") || msg.contains("NotFound") || msg.contains("404") {
                    ImagingError::NotFound(format!("object not found: {object_key}"))
                } else {
                    ImagingError::S3Error(format!("HEAD {object_key}: {e}"))
                }
            })?;

        let actual_ct = head
            .content_type()
            .unwrap_or("application/octet-stream")
            .to_string();

        let valid = ALLOWED_MIME_TYPES.contains(&actual_ct.as_str());
        let url = self.public_url(object_key);

        tracing::info!(
            object_key,
            actual_content_type = actual_ct.as_str(),
            valid,
            "upload confirmed"
        );

        Ok((url, valid, actual_ct))
    }

    // -----------------------------------------------------------------------
    // Internal helpers
    // -----------------------------------------------------------------------

    /// Download an object from S3 and return its raw bytes.
    async fn download_from_s3(&self, key: &str) -> Result<Vec<u8>, ImagingError> {
        let resp = self
            .s3_client
            .get_object()
            .bucket(&self.bucket)
            .key(key)
            .send()
            .await
            .map_err(|e| {
                let msg = format!("{e}");
                if msg.contains("NoSuchKey") || msg.contains("NotFound") || msg.contains("404") {
                    ImagingError::NotFound(format!("object not found: {key}"))
                } else {
                    ImagingError::S3Error(format!("GET {key}: {e}"))
                }
            })?;

        let bytes = resp
            .body
            .collect()
            .await
            .map_err(|e| ImagingError::S3Error(format!("read body {key}: {e}")))?
            .into_bytes()
            .to_vec();

        Ok(bytes)
    }

    /// Upload bytes to S3.
    async fn upload_to_s3(
        &self,
        key: &str,
        data: &[u8],
        content_type: &str,
    ) -> Result<(), ImagingError> {
        self.s3_client
            .put_object()
            .bucket(&self.bucket)
            .key(key)
            .content_type(content_type)
            .body(ByteStream::from(data.to_vec()))
            .send()
            .await
            .map_err(|e| ImagingError::S3Error(format!("PUT {key}: {e}")))?;

        Ok(())
    }

    /// Create a resized variant, upload it, and return metadata.
    async fn create_variant(
        &self,
        img: &DynamicImage,
        _source_key: &str,
        context_id: &str,
        variant_name: &str,
        max_w: u32,
        max_h: u32,
        mode: ResizeMode,
    ) -> Result<ImageVariant, ImagingError> {
        let resized = resize_image(img, max_w, max_h, mode);
        let encoded = encode_image(&resized, ImageFormat::Jpeg, DEFAULT_QUALITY)?;
        let (rw, rh) = resized.dimensions();

        let dest_key = format!(
            "{context_id}/{variant_name}/{}.jpg",
            Uuid::now_v7()
        );
        self.upload_to_s3(&dest_key, &encoded, "image/jpeg").await?;

        Ok(ImageVariant {
            url: self.public_url(&dest_key),
            width: rw,
            height: rh,
            format: ImageFormat::Jpeg,
            size_bytes: encoded.len() as u32,
            variant_name: variant_name.into(),
        })
    }

    /// Build a variant key from the source key by replacing the last segment.
    fn variant_key(&self, source_key: &str, variant: &str, fmt: ImageFormat) -> String {
        let stem = source_key
            .rsplit('/')
            .next()
            .and_then(|f| f.rsplit_once('.'))
            .map(|(s, _)| s)
            .unwrap_or("img");

        // Derive directory from source key.
        let dir = source_key
            .rsplit_once('/')
            .map(|(d, _)| d)
            .unwrap_or("misc");

        format!("{dir}/{variant}/{stem}_{}.{}", Uuid::now_v7(), fmt.extension())
    }

    /// Construct the public URL for an object key.
    fn public_url(&self, key: &str) -> String {
        format!("{}/{}", self.public_url_base, key)
    }
}

// ---------------------------------------------------------------------------
// Pure functions – no I/O
// ---------------------------------------------------------------------------

/// Decode raw bytes into a `DynamicImage`.
fn decode_image(data: &[u8]) -> Result<DynamicImage, ImagingError> {
    image::load_from_memory(data).map_err(|e| ImagingError::DecodeError(e.to_string()))
}

/// Resize an image according to the given mode and maximum dimensions.
///
/// * `Fit`   – fits within `max_w x max_h`, preserving aspect ratio.
/// * `Fill`  – center-crops to `max_w x max_h` after scaling up the shorter
///             dimension.
/// * `Exact` – stretches/squishes to exactly `max_w x max_h`.
fn resize_image(img: &DynamicImage, max_w: u32, max_h: u32, mode: ResizeMode) -> DynamicImage {
    if max_w == 0 || max_h == 0 {
        return img.clone();
    }

    let (w, h) = img.dimensions();

    match mode {
        ResizeMode::Fit => {
            // Only downscale, never upscale.
            if w <= max_w && h <= max_h {
                return img.clone();
            }
            img.resize(max_w, max_h, FilterType::Lanczos3)
        }
        ResizeMode::Fill => {
            // Scale so the smaller dimension matches, then center-crop.
            let scale = f64::max(
                f64::from(max_w) / f64::from(w),
                f64::from(max_h) / f64::from(h),
            );

            #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
            let scaled_w = (f64::from(w) * scale).round() as u32;
            #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
            let scaled_h = (f64::from(h) * scale).round() as u32;

            let scaled = img.resize_exact(scaled_w, scaled_h, FilterType::Lanczos3);

            let x = (scaled_w.saturating_sub(max_w)) / 2;
            let y = (scaled_h.saturating_sub(max_h)) / 2;
            scaled.crop_imm(x, y, max_w.min(scaled_w), max_h.min(scaled_h))
        }
        ResizeMode::Exact => img.resize_exact(max_w, max_h, FilterType::Lanczos3),
    }
}

/// Encode a `DynamicImage` to bytes in the specified format and quality.
fn encode_image(img: &DynamicImage, fmt: ImageFormat, quality: u8) -> Result<Vec<u8>, ImagingError> {
    let mut buf = Cursor::new(Vec::new());

    match fmt {
        ImageFormat::Jpeg => {
            let encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buf, quality);
            img.write_with_encoder(encoder)
                .map_err(|e| ImagingError::EncodeError(format!("JPEG: {e}")))?;
        }
        ImageFormat::Png => {
            img.write_to(&mut buf, ImgFmt::Png)
                .map_err(|e| ImagingError::EncodeError(format!("PNG: {e}")))?;
        }
        ImageFormat::WebP => {
            // The `image` crate v0.25 supports WebP encoding natively.
            img.write_to(&mut buf, ImgFmt::WebP)
                .map_err(|e| ImagingError::EncodeError(format!("WebP: {e}")))?;
        }
    }

    Ok(buf.into_inner())
}

/// Crop the center of an image to a square (side = min(width, height)).
fn crop_center_square(img: &DynamicImage) -> DynamicImage {
    let (w, h) = img.dimensions();
    let side = w.min(h);
    let x = (w - side) / 2;
    let y = (h - side) / 2;
    img.crop_imm(x, y, side, side)
}

/// Compute a simple BlurHash string from a downscaled image.
///
/// This is a lightweight implementation that produces a valid 4x3 component
/// BlurHash. The image is first downscaled to 32x32, then the DC and AC
/// components are computed via DCT and base83-encoded.
fn compute_blur_hash(img: &DynamicImage) -> String {
    let small = img.resize_exact(32, 32, FilterType::Lanczos3).to_rgba8();
    let (sw, sh) = (small.width() as usize, small.height() as usize);

    let components_x: usize = 4;
    let components_y: usize = 3;

    // Extract linear RGB pixels (sRGB -> linear).
    let pixels: Vec<[f64; 3]> = small
        .pixels()
        .map(|p| {
            [
                srgb_to_linear(p.0[0]),
                srgb_to_linear(p.0[1]),
                srgb_to_linear(p.0[2]),
            ]
        })
        .collect();

    let mut factors: Vec<[f64; 3]> = Vec::with_capacity(components_x * components_y);

    for j in 0..components_y {
        for i in 0..components_x {
            let mut r = 0.0_f64;
            let mut g = 0.0_f64;
            let mut b = 0.0_f64;

            for y in 0..sh {
                for x in 0..sw {
                    let basis = (std::f64::consts::PI * (i as f64) * (x as f64) / sw as f64).cos()
                        * (std::f64::consts::PI * (j as f64) * (y as f64) / sh as f64).cos();
                    let px = &pixels[y * sw + x];
                    r += basis * px[0];
                    g += basis * px[1];
                    b += basis * px[2];
                }
            }

            let scale = if i == 0 && j == 0 {
                1.0 / (sw * sh) as f64
            } else {
                2.0 / (sw * sh) as f64
            };

            factors.push([r * scale, g * scale, b * scale]);
        }
    }

    // Encode to BlurHash string.
    encode_blurhash(components_x, components_y, &factors)
}

// ---------------------------------------------------------------------------
// BlurHash encoding helpers (base83)
// ---------------------------------------------------------------------------

const BASE83_CHARS: &[u8] =
    b"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#$%*+,-.:;=?@[]^_{|}~";

fn base83_encode(value: u32, length: usize) -> String {
    let mut result = vec![0u8; length];
    for i in 1..=length {
        let digit = (value / 83u32.pow((length - i) as u32)) % 83;
        result[i - 1] = BASE83_CHARS[digit as usize];
    }
    String::from_utf8(result).unwrap_or_default()
}

fn encode_blurhash(cx: usize, cy: usize, factors: &[[f64; 3]]) -> String {
    let size_flag = (cx - 1) + (cy - 1) * 9;
    let mut hash = base83_encode(size_flag as u32, 1);

    // Quantise the maximum AC component value.
    let mut max_ac = 0.0_f64;
    for factor in factors.iter().skip(1) {
        for &c in factor {
            max_ac = max_ac.max(c.abs());
        }
    }

    let quantised_max = if max_ac > 0.0 {
        ((max_ac * 166.0 - 0.5).floor() as u32).clamp(0, 82)
    } else {
        0
    };
    hash.push_str(&base83_encode(quantised_max, 1));

    let real_max = if quantised_max == 0 {
        1.0
    } else {
        (quantised_max as f64 + 1.0) / 167.0
    };

    // DC component.
    let dc = &factors[0];
    let dc_value = encode_dc(dc[0], dc[1], dc[2]);
    hash.push_str(&base83_encode(dc_value, 4));

    // AC components.
    for factor in factors.iter().skip(1) {
        let ac_value = encode_ac(factor[0], factor[1], factor[2], real_max);
        hash.push_str(&base83_encode(ac_value, 2));
    }

    hash
}

fn linear_to_srgb(value: f64) -> u32 {
    let v = value.clamp(0.0, 1.0);
    let s = if v <= 0.003_130_8 {
        v * 12.92
    } else {
        1.055 * v.powf(1.0 / 2.4) - 0.055
    };
    (s * 255.0 + 0.5) as u32
}

fn srgb_to_linear(value: u8) -> f64 {
    let v = f64::from(value) / 255.0;
    if v <= 0.04045 {
        v / 12.92
    } else {
        ((v + 0.055) / 1.055).powf(2.4)
    }
}

fn encode_dc(r: f64, g: f64, b: f64) -> u32 {
    let ir = linear_to_srgb(r);
    let ig = linear_to_srgb(g);
    let ib = linear_to_srgb(b);
    (ir << 16) + (ig << 8) + ib
}

fn sign_pow(value: f64, exp: f64) -> f64 {
    value.abs().powf(exp).copysign(value)
}

fn encode_ac(r: f64, g: f64, b: f64, max_ac: f64) -> u32 {
    let quant_r = ((sign_pow(r / max_ac, 0.5) * 9.0 + 9.5).floor() as u32).clamp(0, 18);
    let quant_g = ((sign_pow(g / max_ac, 0.5) * 9.0 + 9.5).floor() as u32).clamp(0, 18);
    let quant_b = ((sign_pow(b / max_ac, 0.5) * 9.0 + 9.5).floor() as u32).clamp(0, 18);
    quant_r * 19 * 19 + quant_g * 19 + quant_b
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{
        ImageFormat, ImagingError, ProcessingOptions, ResizeMode, UploadContext,
        ALLOWED_MIME_TYPES, DEFAULT_QUALITY, MAX_FILE_SIZE_BYTES, PRESIGN_EXPIRY_SECS,
    };
    use image::{DynamicImage, RgbaImage};

    /// Helper: create a solid-color test image of the given dimensions.
    fn make_test_image(w: u32, h: u32) -> DynamicImage {
        let img = RgbaImage::from_fn(w, h, |_x, _y| image::Rgba([128, 64, 192, 255]));
        DynamicImage::ImageRgba8(img)
    }

    // ------------------------------------------------------------------
    // ImageFormat
    // ------------------------------------------------------------------

    #[test]
    fn image_format_extension() {
        assert_eq!(ImageFormat::Jpeg.extension(), "jpg");
        assert_eq!(ImageFormat::Png.extension(), "png");
        assert_eq!(ImageFormat::WebP.extension(), "webp");
    }

    #[test]
    fn image_format_mime_type() {
        assert_eq!(ImageFormat::Jpeg.mime_type(), "image/jpeg");
        assert_eq!(ImageFormat::Png.mime_type(), "image/png");
        assert_eq!(ImageFormat::WebP.mime_type(), "image/webp");
    }

    #[test]
    fn image_format_from_mime() {
        assert_eq!(ImageFormat::from_mime("image/jpeg"), Some(ImageFormat::Jpeg));
        assert_eq!(ImageFormat::from_mime("image/jpg"), Some(ImageFormat::Jpeg));
        assert_eq!(ImageFormat::from_mime("image/png"), Some(ImageFormat::Png));
        assert_eq!(ImageFormat::from_mime("image/webp"), Some(ImageFormat::WebP));
        assert_eq!(ImageFormat::from_mime("image/gif"), None);
        assert_eq!(ImageFormat::from_mime("text/html"), None);
    }

    #[test]
    fn image_format_to_image_format() {
        assert_eq!(
            ImageFormat::Jpeg.to_image_format(),
            image::ImageFormat::Jpeg
        );
        assert_eq!(ImageFormat::Png.to_image_format(), image::ImageFormat::Png);
        assert_eq!(
            ImageFormat::WebP.to_image_format(),
            image::ImageFormat::WebP
        );
    }

    // ------------------------------------------------------------------
    // ResizeMode + ProcessingOptions
    // ------------------------------------------------------------------

    #[test]
    fn processing_options_default() {
        let opts = ProcessingOptions::default();
        assert_eq!(opts.max_width, 1600);
        assert_eq!(opts.max_height, 1600);
        assert_eq!(opts.resize_mode, ResizeMode::Fit);
        assert_eq!(opts.quality, 85);
        assert_eq!(opts.format, ImageFormat::Jpeg);
        assert!(opts.strip_exif);
        assert!(opts.auto_orient);
        assert!(!opts.generate_blur_hash);
    }

    // ------------------------------------------------------------------
    // UploadContext
    // ------------------------------------------------------------------

    #[test]
    fn upload_context_from_str() {
        assert_eq!(UploadContext::from_str_context("avatar"), Some(UploadContext::Avatar));
        assert_eq!(UploadContext::from_str_context("portfolio"), Some(UploadContext::Portfolio));
        assert_eq!(UploadContext::from_str_context("job_photo"), Some(UploadContext::JobPhoto));
        assert_eq!(UploadContext::from_str_context("document"), Some(UploadContext::Document));
        assert_eq!(
            UploadContext::from_str_context("review_photo"),
            Some(UploadContext::ReviewPhoto)
        );
        assert_eq!(UploadContext::from_str_context("unknown"), None);
    }

    #[test]
    fn upload_context_path_prefix() {
        assert_eq!(UploadContext::Avatar.path_prefix(), "avatars");
        assert_eq!(UploadContext::Portfolio.path_prefix(), "portfolio");
        assert_eq!(UploadContext::JobPhoto.path_prefix(), "job-photos");
        assert_eq!(UploadContext::Document.path_prefix(), "documents");
        assert_eq!(UploadContext::ReviewPhoto.path_prefix(), "review-photos");
    }

    // ------------------------------------------------------------------
    // Constants
    // ------------------------------------------------------------------

    #[test]
    fn allowed_mime_types_contains_core_formats() {
        assert!(ALLOWED_MIME_TYPES.contains(&"image/jpeg"));
        assert!(ALLOWED_MIME_TYPES.contains(&"image/png"));
        assert!(ALLOWED_MIME_TYPES.contains(&"image/webp"));
        assert!(!ALLOWED_MIME_TYPES.contains(&"image/gif"));
    }

    #[test]
    fn max_file_size_is_10mb() {
        assert_eq!(MAX_FILE_SIZE_BYTES, 10 * 1024 * 1024);
    }

    #[test]
    fn default_quality_is_85() {
        assert_eq!(DEFAULT_QUALITY, 85);
    }

    #[test]
    fn presign_expiry_is_15_minutes() {
        assert_eq!(PRESIGN_EXPIRY_SECS, 900);
    }

    // ------------------------------------------------------------------
    // resize_image
    // ------------------------------------------------------------------

    #[test]
    fn resize_fit_downscales() {
        let img = make_test_image(800, 600);
        let resized = resize_image(&img, 400, 300, ResizeMode::Fit);
        let (w, h) = resized.dimensions();
        assert!(w <= 400);
        assert!(h <= 300);
    }

    #[test]
    fn resize_fit_does_not_upscale() {
        let img = make_test_image(200, 150);
        let resized = resize_image(&img, 400, 300, ResizeMode::Fit);
        let (w, h) = resized.dimensions();
        // Should return original dimensions since image is smaller than target.
        assert_eq!(w, 200);
        assert_eq!(h, 150);
    }

    #[test]
    fn resize_exact_stretches() {
        let img = make_test_image(800, 600);
        let resized = resize_image(&img, 100, 200, ResizeMode::Exact);
        let (w, h) = resized.dimensions();
        assert_eq!(w, 100);
        assert_eq!(h, 200);
    }

    #[test]
    fn resize_fill_center_crops() {
        let img = make_test_image(800, 600);
        let resized = resize_image(&img, 200, 200, ResizeMode::Fill);
        let (w, h) = resized.dimensions();
        assert_eq!(w, 200);
        assert_eq!(h, 200);
    }

    #[test]
    fn resize_zero_width_returns_clone() {
        let img = make_test_image(100, 100);
        let resized = resize_image(&img, 0, 100, ResizeMode::Fit);
        assert_eq!(resized.dimensions(), (100, 100));
    }

    #[test]
    fn resize_zero_height_returns_clone() {
        let img = make_test_image(100, 100);
        let resized = resize_image(&img, 100, 0, ResizeMode::Fit);
        assert_eq!(resized.dimensions(), (100, 100));
    }

    // ------------------------------------------------------------------
    // crop_center_square
    // ------------------------------------------------------------------

    #[test]
    fn crop_center_square_landscape() {
        let img = make_test_image(800, 400);
        let cropped = crop_center_square(&img);
        let (w, h) = cropped.dimensions();
        assert_eq!(w, 400);
        assert_eq!(h, 400);
    }

    #[test]
    fn crop_center_square_portrait() {
        let img = make_test_image(400, 800);
        let cropped = crop_center_square(&img);
        let (w, h) = cropped.dimensions();
        assert_eq!(w, 400);
        assert_eq!(h, 400);
    }

    #[test]
    fn crop_center_square_already_square() {
        let img = make_test_image(500, 500);
        let cropped = crop_center_square(&img);
        let (w, h) = cropped.dimensions();
        assert_eq!(w, 500);
        assert_eq!(h, 500);
    }

    // ------------------------------------------------------------------
    // encode_image / decode_image round-trip
    // ------------------------------------------------------------------

    #[test]
    fn encode_jpeg_produces_bytes() {
        let img = make_test_image(100, 100);
        let encoded = encode_image(&img, ImageFormat::Jpeg, 85).expect("encode JPEG");
        assert!(!encoded.is_empty());
    }

    #[test]
    fn encode_png_produces_bytes() {
        let img = make_test_image(100, 100);
        let encoded = encode_image(&img, ImageFormat::Png, 85).expect("encode PNG");
        assert!(!encoded.is_empty());
    }

    #[test]
    fn encode_webp_produces_bytes() {
        let img = make_test_image(100, 100);
        let encoded = encode_image(&img, ImageFormat::WebP, 85).expect("encode WebP");
        assert!(!encoded.is_empty());
    }

    #[test]
    fn encode_decode_roundtrip_jpeg() {
        let img = make_test_image(50, 50);
        let encoded = encode_image(&img, ImageFormat::Jpeg, 90).expect("encode");
        let decoded = decode_image(&encoded).expect("decode");
        let (w, h) = decoded.dimensions();
        assert_eq!(w, 50);
        assert_eq!(h, 50);
    }

    #[test]
    fn encode_decode_roundtrip_png() {
        let img = make_test_image(50, 50);
        let encoded = encode_image(&img, ImageFormat::Png, 90).expect("encode");
        let decoded = decode_image(&encoded).expect("decode");
        let (w, h) = decoded.dimensions();
        assert_eq!(w, 50);
        assert_eq!(h, 50);
    }

    #[test]
    fn decode_invalid_bytes_returns_error() {
        let result = decode_image(&[0, 1, 2, 3]);
        assert!(result.is_err());
    }

    // ------------------------------------------------------------------
    // srgb_to_linear / linear_to_srgb
    // ------------------------------------------------------------------

    #[test]
    fn srgb_linear_black() {
        assert!((srgb_to_linear(0) - 0.0).abs() < f64::EPSILON);
    }

    #[test]
    fn srgb_linear_white() {
        assert!((srgb_to_linear(255) - 1.0).abs() < 0.001);
    }

    #[test]
    fn linear_srgb_black() {
        assert_eq!(linear_to_srgb(0.0), 0);
    }

    #[test]
    fn linear_srgb_white() {
        assert_eq!(linear_to_srgb(1.0), 255);
    }

    #[test]
    fn srgb_linear_roundtrip_midtones() {
        // Not a perfect roundtrip due to quantization but should be close.
        for v in [50u8, 100, 128, 200] {
            let linear = srgb_to_linear(v);
            let back = linear_to_srgb(linear);
            assert!(
                (back as i32 - i32::from(v)).unsigned_abs() <= 1,
                "roundtrip failed for {v}: got {back}"
            );
        }
    }

    // ------------------------------------------------------------------
    // sign_pow
    // ------------------------------------------------------------------

    #[test]
    fn sign_pow_positive() {
        let result = sign_pow(4.0, 0.5);
        assert!((result - 2.0).abs() < f64::EPSILON);
    }

    #[test]
    fn sign_pow_negative() {
        let result = sign_pow(-4.0, 0.5);
        assert!((result - (-2.0)).abs() < f64::EPSILON);
    }

    #[test]
    fn sign_pow_zero() {
        let result = sign_pow(0.0, 0.5);
        assert!((result).abs() < f64::EPSILON);
    }

    // ------------------------------------------------------------------
    // base83_encode
    // ------------------------------------------------------------------

    #[test]
    fn base83_encode_zero() {
        let encoded = base83_encode(0, 1);
        assert_eq!(encoded, "0");
    }

    #[test]
    fn base83_encode_length_respected() {
        let encoded = base83_encode(42, 4);
        assert_eq!(encoded.len(), 4);
    }

    #[test]
    fn base83_encode_uses_valid_chars() {
        let encoded = base83_encode(1234, 3);
        for c in encoded.chars() {
            assert!(
                BASE83_CHARS.contains(&(c as u8)),
                "invalid base83 char: {c}"
            );
        }
    }

    // ------------------------------------------------------------------
    // compute_blur_hash
    // ------------------------------------------------------------------

    #[test]
    fn blur_hash_produces_nonempty_string() {
        let img = make_test_image(100, 100);
        let hash = compute_blur_hash(&img);
        assert!(!hash.is_empty());
    }

    #[test]
    fn blur_hash_length_for_4x3_components() {
        // BlurHash format: 1 (size flag) + 1 (max AC) + 4 (DC) + (4*3-1)*2 (AC) = 28
        let img = make_test_image(64, 64);
        let hash = compute_blur_hash(&img);
        assert_eq!(hash.len(), 28, "4x3 BlurHash should be 28 chars, got {}", hash.len());
    }

    #[test]
    fn blur_hash_deterministic() {
        let img = make_test_image(50, 50);
        let hash1 = compute_blur_hash(&img);
        let hash2 = compute_blur_hash(&img);
        assert_eq!(hash1, hash2);
    }

    #[test]
    fn blur_hash_uses_valid_base83_chars() {
        let img = make_test_image(80, 60);
        let hash = compute_blur_hash(&img);
        for c in hash.chars() {
            assert!(
                BASE83_CHARS.contains(&(c as u8)),
                "invalid base83 char in blur hash: {c}"
            );
        }
    }

    // ------------------------------------------------------------------
    // ImagingError display messages
    // ------------------------------------------------------------------

    #[test]
    fn imaging_error_display() {
        let err = ImagingError::FileTooLarge {
            size: 20_000_000,
            limit: 10_485_760,
        };
        assert!(err.to_string().contains("too large"));

        let err = ImagingError::UnsupportedMimeType("image/gif".into());
        assert!(err.to_string().contains("image/gif"));
    }

    // ------------------------------------------------------------------
    // Pipeline variant_key helper
    // ------------------------------------------------------------------
    // variant_key is a private method on ImagePipeline, but we can test the
    // public models that feed into it.

    #[test]
    fn image_variant_construction() {
        let v = ImageVariant {
            url: "http://example.com/img.jpg".into(),
            width: 800,
            height: 600,
            format: ImageFormat::Jpeg,
            size_bytes: 50_000,
            variant_name: "large".into(),
        };
        assert_eq!(v.width, 800);
        assert_eq!(v.height, 600);
        assert_eq!(v.format, ImageFormat::Jpeg);
    }

    // ------------------------------------------------------------------
    // proptest
    // ------------------------------------------------------------------

    mod proptests {
        use super::*;
        use proptest::prelude::*;

        proptest! {
            #[test]
            fn srgb_to_linear_in_0_to_1(v in 0u8..=255) {
                let linear = srgb_to_linear(v);
                prop_assert!(linear >= 0.0);
                prop_assert!(linear <= 1.0);
            }

            #[test]
            fn linear_to_srgb_in_0_to_255(v in 0.0..=1.0_f64) {
                let srgb = linear_to_srgb(v);
                prop_assert!(srgb <= 255);
            }

            #[test]
            fn base83_encode_never_panics(value in 0u32..100_000, length in 1usize..=6) {
                let encoded = base83_encode(value, length);
                prop_assert_eq!(encoded.len(), length);
            }

            #[test]
            fn resize_image_never_panics(
                w in 1u32..=50,
                h in 1u32..=50,
                tw in 0u32..=100,
                th in 0u32..=100,
                mode in 0u8..=2,
            ) {
                let img = make_test_image(w, h);
                let resize_mode = match mode {
                    0 => ResizeMode::Fit,
                    1 => ResizeMode::Fill,
                    _ => ResizeMode::Exact,
                };
                let _ = resize_image(&img, tw, th, resize_mode);
            }
        }
    }
}
