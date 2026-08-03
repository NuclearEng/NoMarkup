/// Image processing pipeline backed by the `image` crate and AWS S3-compatible
/// (`MinIO`) object storage.
///
/// Handles resize, format conversion, EXIF stripping, EXIF auto-orientation,
/// `BlurHash` generation, and context-specific processing pipelines for job
/// photos, portfolio images, avatars, and documents.
///
/// # Metadata (privacy) invariant
///
/// Every **image** byte sequence this pipeline uploads or returns is produced
/// by a full decode → transform → re-encode cycle. The `image` crate's
/// encoders write no EXIF/XMP/IPTC, so **no image output can carry the
/// original's metadata** (camera GPS coordinates in particular). Because the
/// EXIF orientation tag is dropped with the rest of the metadata, the decoder
/// applies it to the pixels first (see [`decode_image`]), so stripped outputs
/// still display upright.
///
/// **PDF exception (document / chat_attachment contexts only):** PDFs are
/// stored pass-through after magic-byte sniff on confirm. Process endpoints
/// that require an image decoder fail closed on PDF.
use std::io::Cursor;
use std::sync::Arc;

use aws_sdk_s3::presigning::PresigningConfig;
use aws_sdk_s3::primitives::ByteStream;
use image::imageops::FilterType;
use image::metadata::Orientation;
use image::{
    DynamicImage, GenericImageView, ImageDecoder, ImageFormat as ImgFmt, ImageReader, Limits,
};
use uuid::Uuid;

use crate::models::{
    DEFAULT_QUALITY, ImageFormat, ImageVariant, ImagingError,
    MAX_DECODE_ALLOC_BYTES, MAX_DECODE_DIMENSION, MAX_FILE_SIZE_BYTES, PRESIGN_EXPIRY_SECS,
    ProcessedJobPhoto, ProcessingOptions, ResizeMode, UploadContext,
    allowed_mime_types_for_object_key, extension_for_mime, is_pdf_bytes, sniff_content_type,
};

// ---------------------------------------------------------------------------
// Blocking-pool boundary
// ---------------------------------------------------------------------------
//
// Everything in this section is the CPU half of the pipeline. The S3 calls
// around it stay on the async runtime; only pure decode/resize/encode/BlurHash
// work crosses onto `spawn_blocking`.

/// A CPU-rendered image, ready to hand to S3.
#[derive(Debug, Clone)]
pub struct RenderedImage {
    pub data: Vec<u8>,
    pub width: u32,
    pub height: u32,
}

/// Output of the single-image render stage.
#[derive(Debug, Clone)]
pub struct ProcessedRender {
    pub image: RenderedImage,
    pub original_width: u32,
    pub original_height: u32,
    pub blur_hash: Option<String>,
}

/// Run a CPU-bound image transform on Tokio's blocking pool.
///
/// Decode → resize → encode is pure CPU: a measured ~29.5 ms for one
/// 1080p → 800 px WebP resize (`benches/imaging_bench.rs`). Executed inline on
/// the async runtime it owns a Tokio worker for that entire time, and with
/// roughly `num_cpus` concurrent requests every worker is busy — so *all*
/// async work on the instance stalls, including this process's own gRPC health
/// responses. The liveness probe then fails and Kubernetes restarts the pod
/// mid-work. `spawn_blocking` moves the work onto the blocking pool, off the
/// runtime's workers (CLAUDE.md §5: "Tokio — never block the runtime").
///
/// A panic inside the closure arrives as a `JoinError` and is mapped to
/// `Internal` rather than unwinding through the connection.
async fn run_cpu<F, T>(f: F) -> Result<T, ImagingError>
where
    F: FnOnce() -> Result<T, ImagingError> + Send + 'static,
    T: Send + 'static,
{
    tokio::task::spawn_blocking(f)
        .await
        .map_err(|e| ImagingError::Internal(format!("image worker task failed: {e}")))?
}

/// Decode raw bytes into a shared image, off the async runtime.
///
/// Returns an `Arc` so the multi-variant pipelines can hand the same decoded
/// image to several blocking renders without re-decoding or deep-copying it.
// Split out from the render spans because the batch pipelines decode once and
// render many: when a batch is slow, this span answers whether the cost was
// the single decode or the N renders that followed.
#[tracing::instrument(skip_all, fields(input_bytes = raw.len()), err)]
pub async fn decode_shared(raw: Vec<u8>) -> Result<Arc<DynamicImage>, ImagingError> {
    run_cpu(move || decode_image(&raw).map(Arc::new)).await
}

/// Full single-image render — validate, decode, resize, encode, and optionally
/// compute the `BlurHash` — in one trip to the blocking pool.
// The engine's real cost centre: ~29.5ms of CPU for one 1080p → 800px WebP
// (p99 < 200ms, CLAUDE.md §8). The span deliberately wraps the *async* fn
// rather than the closure inside `run_cpu`, for two reasons: `spawn_blocking`
// moves the closure to another thread where the tracing context does not
// follow, and wrapping out here also captures time spent *queued* for a
// blocking worker — which is precisely how this engine degrades under load,
// and would be invisible from inside the closure.
#[tracing::instrument(
    skip_all,
    fields(
        input_bytes = raw.len(),
        format = ?opts.format,
        quality = opts.quality,
        blur_hash = opts.generate_blur_hash,
        source_width = tracing::field::Empty,
        source_height = tracing::field::Empty,
        output_width = tracing::field::Empty,
        output_height = tracing::field::Empty,
        output_bytes = tracing::field::Empty,
    ),
    err
)]
pub async fn render_processed(
    raw: Vec<u8>,
    opts: ProcessingOptions,
) -> Result<ProcessedRender, ImagingError> {
    let rendered = run_cpu(move || {
        validate_image_format(&raw)?;

        let img = decode_image_with_orientation(&raw, opts.auto_orient)?;
        let (original_width, original_height) = img.dimensions();

        let resized = resize_image(&img, opts.max_width, opts.max_height, opts.resize_mode);
        let data = encode_image(&resized, opts.format, opts.quality)?;
        if data.is_empty() {
            return Err(ImagingError::Internal("encoder produced zero bytes".into()));
        }

        let (width, height) = resized.dimensions();
        let blur_hash = if opts.generate_blur_hash {
            Some(compute_blur_hash(&resized))
        } else {
            None
        };

        Ok(ProcessedRender {
            image: RenderedImage {
                data,
                width,
                height,
            },
            original_width,
            original_height,
            blur_hash,
        })
    })
    .await?;

    // Dimensions are the difference between "a slow engine" and "someone
    // uploaded a 40-megapixel photo", which is the first question an operator
    // asks about a slow image request.
    let span = tracing::Span::current();
    span.record("source_width", rendered.original_width);
    span.record("source_height", rendered.original_height);
    span.record("output_width", rendered.image.width);
    span.record("output_height", rendered.image.height);
    span.record("output_bytes", rendered.image.data.len());

    Ok(rendered)
}

/// Resize and encode one variant of an already-decoded image, off the runtime.
// Per *variant*, not per pixel or per row.
#[tracing::instrument(
    skip_all,
    fields(max_width = max_w, max_height = max_h, format = ?fmt, quality),
    err
)]
pub async fn render_variant(
    img: Arc<DynamicImage>,
    max_w: u32,
    max_h: u32,
    mode: ResizeMode,
    fmt: ImageFormat,
    quality: u8,
) -> Result<RenderedImage, ImagingError> {
    run_cpu(move || {
        let resized = resize_image(&img, max_w, max_h, mode);
        let data = encode_image(&resized, fmt, quality)?;
        if data.is_empty() {
            return Err(ImagingError::Internal("encoder produced zero bytes".into()));
        }

        let (width, height) = resized.dimensions();
        Ok(RenderedImage {
            data,
            width,
            height,
        })
    })
    .await
}

/// Re-encode an already-decoded image at full resolution, off the runtime.
pub async fn render_full_size(
    img: Arc<DynamicImage>,
    fmt: ImageFormat,
    quality: u8,
) -> Result<RenderedImage, ImagingError> {
    run_cpu(move || {
        let data = encode_image(&img, fmt, quality)?;
        if data.is_empty() {
            return Err(ImagingError::Internal("encoder produced zero bytes".into()));
        }

        let (width, height) = img.dimensions();
        Ok(RenderedImage {
            data,
            width,
            height,
        })
    })
    .await
}

/// Compute the `BlurHash` off the runtime (a 32x32 downscale plus a DCT).
#[tracing::instrument(skip_all, err)]
pub async fn render_blur_hash(img: Arc<DynamicImage>) -> Result<String, ImagingError> {
    run_cpu(move || Ok(compute_blur_hash(&img))).await
}

/// Center-crop to a square off the runtime.
pub async fn render_center_square(
    img: Arc<DynamicImage>,
) -> Result<Arc<DynamicImage>, ImagingError> {
    run_cpu(move || Ok(Arc::new(crop_center_square(&img)))).await
}

/// Core image pipeline — stateless beyond the S3 client handle.
pub struct ImagePipeline {
    s3_client: aws_sdk_s3::Client,
    bucket: String,
    public_url_base: String,
}

impl ImagePipeline {
    /// Create a new pipeline.
    ///
    /// * `s3_client` – configured `aws-sdk-s3` client (pointed at `MinIO`)
    /// * `bucket` – the bucket name, e.g. `"nomarkup"`
    /// * `public_url_base` – base URL for constructing public object URLs,
    ///   e.g. `"http://localhost:9000/nomarkup"`
    #[must_use]
    pub const fn new(
        s3_client: aws_sdk_s3::Client,
        bucket: String,
        public_url_base: String,
    ) -> Self {
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
    /// `BlurHash`, upload the result, and return the variant metadata.
    // One span per image, so a batch RPC shows N children and a slow batch can
    // be attributed to a specific source object. The S3 round trips and the
    // CPU render each get their own child span underneath, which is what
    // separates "storage is slow" from "the encode is slow".
    #[tracing::instrument(skip_all, fields(source_key = %source_key, format = ?opts.format), err)]
    pub async fn process_image(
        &self,
        source_key: &str,
        opts: &ProcessingOptions,
    ) -> Result<(ImageVariant, Option<String>), ImagingError> {
        let _timer = crate::metrics::IMAGE_PROCESSING_DURATION.start_timer();
        let raw = self.download_from_s3(source_key).await?;

        // Stripping is the only supported mode: the output below is always a
        // re-encode (which drops all metadata), never a copy of the original
        // bytes. `strip_exif=false` cannot round-trip metadata — surface that
        // instead of silently ignoring the flag.
        if !opts.strip_exif {
            tracing::debug!(
                source = source_key,
                "strip_exif=false requested, but every output is re-encoded; \
                 original metadata is not preserved"
            );
        }

        // Validate + decode + resize + encode (+ BlurHash) on the blocking
        // pool; the S3 round trips on either side stay on the async runtime.
        let rendered = render_processed(raw, opts.clone()).await?;

        let dest_key = self.variant_key(source_key, "processed", opts.format);
        self.upload_to_s3(&dest_key, &rendered.image.data, opts.format.mime_type())
            .await?;

        let variant = ImageVariant {
            url: self.public_url(&dest_key),
            width: rendered.image.width,
            height: rendered.image.height,
            format: opts.format,
            size_bytes: rendered.image.data.len() as u32,
            variant_name: "processed".into(),
        };

        crate::metrics::IMAGES_PROCESSED_TOTAL.inc();

        tracing::info!(
            source = source_key,
            orig_w = rendered.original_width,
            orig_h = rendered.original_height,
            out_w = rendered.image.width,
            out_h = rendered.image.height,
            format = ?opts.format,
            size = rendered.image.data.len(),
            "image processed"
        );

        Ok((variant, rendered.blur_hash))
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

        let img = decode_shared(raw).await?;
        let rendered =
            render_variant(img, width, height, mode, ImageFormat::Jpeg, DEFAULT_QUALITY).await?;

        let dest_key = self.variant_key(source_key, "thumbnail", ImageFormat::Jpeg);
        self.upload_to_s3(&dest_key, &rendered.data, ImageFormat::Jpeg.mime_type())
            .await?;

        Ok(ImageVariant {
            url: self.public_url(&dest_key),
            width: rendered.width,
            height: rendered.height,
            format: ImageFormat::Jpeg,
            size_bytes: rendered.data.len() as u32,
            variant_name: "thumbnail".into(),
        })
    }

    /// Process a batch of job photos. For each photo, create large (1200),
    /// medium (600), thumbnail (200) variants plus a `BlurHash`.
    pub async fn process_job_photos(
        &self,
        job_id: &str,
        source_keys: &[String],
    ) -> Result<Vec<ProcessedJobPhoto>, ImagingError> {
        let mut results = Vec::with_capacity(source_keys.len());

        for source_key in source_keys {
            let raw = self.download_from_s3(source_key).await?;
            let img = decode_shared(raw).await?;
            let blur_hash = render_blur_hash(Arc::clone(&img)).await?;

            // Privacy: never hand back the raw upload's URL. The raw object
            // retains whatever EXIF the camera wrote — including GPS
            // coordinates — so exposing it as `original_url` would leak the
            // customer's location. Re-encode the original at full resolution
            // (metadata-free, orientation already applied by decode_image)
            // and return that sanitized copy as the "original".
            let original = render_full_size(Arc::clone(&img), ImageFormat::Jpeg, 90).await?;
            let original_key = format!("{job_id}/original/{}.jpg", Uuid::now_v7());
            self.upload_to_s3(&original_key, &original.data, "image/jpeg")
                .await?;

            let large = self
                .create_variant(
                    Arc::clone(&img),
                    source_key,
                    job_id,
                    "large",
                    1200,
                    1200,
                    ResizeMode::Fit,
                )
                .await?;
            let medium = self
                .create_variant(
                    Arc::clone(&img),
                    source_key,
                    job_id,
                    "medium",
                    600,
                    600,
                    ResizeMode::Fit,
                )
                .await?;
            let thumbnail = self
                .create_variant(
                    img,
                    source_key,
                    job_id,
                    "thumbnail",
                    200,
                    200,
                    ResizeMode::Fit,
                )
                .await?;

            results.push(ProcessedJobPhoto {
                original_url: self.public_url(&original_key),
                large,
                medium,
                thumbnail,
                blur_hash,
            });
        }

        Ok(results)
    }

    /// Process a portfolio image: full (1600), display (800), thumbnail (300)
    /// variants plus `BlurHash`.
    pub async fn process_portfolio_image(
        &self,
        user_id: &str,
        source_key: &str,
    ) -> Result<(ImageVariant, ImageVariant, ImageVariant, String), ImagingError> {
        let raw = self.download_from_s3(source_key).await?;
        let img = decode_shared(raw).await?;
        let blur_hash = render_blur_hash(Arc::clone(&img)).await?;

        let full = self
            .create_variant(
                Arc::clone(&img),
                source_key,
                user_id,
                "full",
                1600,
                1600,
                ResizeMode::Fit,
            )
            .await?;
        let display = self
            .create_variant(
                Arc::clone(&img),
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
                img,
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
        let img = decode_shared(raw).await?;

        // Center-crop to square before resizing.
        let square = render_center_square(img).await?;
        let blur_hash = render_blur_hash(Arc::clone(&square)).await?;

        let large = self
            .create_variant(
                Arc::clone(&square),
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
                Arc::clone(&square),
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
                square,
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
        // PDF is stored pass-through on confirm; process endpoints require a
        // decodable image (admin thumbnails / EXIF strip). Fail closed.
        if is_pdf_bytes(&raw) {
            return Err(ImagingError::InvalidArgument(
                "PDF documents are stored as pass-through; process/document requires an image"
                    .into(),
            ));
        }
        let img = decode_shared(raw).await?;

        // Re-encode at original size (strips EXIF, auto-orients).
        let original = render_full_size(Arc::clone(&img), ImageFormat::Jpeg, 90).await?;
        let (orig_w, orig_h) = (original.width, original.height);

        let dest_key = format!("documents/{user_id}/processed/{}.jpg", Uuid::now_v7());
        self.upload_to_s3(&dest_key, &original.data, "image/jpeg")
            .await?;

        let processed = ImageVariant {
            url: self.public_url(&dest_key),
            width: orig_w,
            height: orig_h,
            format: ImageFormat::Jpeg,
            size_bytes: original.data.len() as u32,
            variant_name: "processed".into(),
        };

        // Thumbnail for admin review UI.
        let thumb = self
            .create_variant(
                img,
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
        // Validate MIME type against the context allow-list. PDF is only
        // accepted for document / chat_attachment; pure image contexts stay
        // fail-closed on non-images.
        if !context.allowed_mime_types().contains(&mime_type) {
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

        // Determine extension from MIME type (includes application/pdf → pdf).
        let ext = extension_for_mime(mime_type);

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

        // Bind the declared size INTO the signature.
        //
        // `file_size` is supplied by the client and was only ever compared
        // against MAX_FILE_SIZE_BYTES before signing — it never constrained
        // the upload itself. A caller could declare 1 KB, receive a valid
        // presigned URL, and then PUT gigabytes: S3 honours the signature, not
        // our earlier check. Signing `content_length` makes S3 reject any body
        // whose length differs from what was authorized, so the size limit is
        // enforced by the storage layer rather than on trust.
        let signed_len = file_size;
        let presigned = self
            .s3_client
            .put_object()
            .bucket(&self.bucket)
            .key(&object_key)
            .content_type(mime_type)
            .content_length(signed_len)
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
        // Download the object and sniff its REAL format from the magic bytes.
        // We deliberately do NOT trust the stored Content-Type metadata: that
        // value is whatever the client declared on the presigned PUT, so a
        // text/binary file renamed `.jpg` and uploaded with
        // `Content-Type: image/jpeg` would otherwise pass validation. Sniffing
        // the bytes is the actual server-side MIME check (CLAUDE.md §6: never
        // trust client-supplied content type; validate server-side).
        let bytes = self.download_from_s3(object_key).await?;

        // Magic-byte sniff: JPEG/PNG/WebP via image crate + PDF header.
        // Never trust client-declared Content-Type on the presigned PUT.
        let actual_ct = sniff_content_type(&bytes);

        // Context is inferred from the key prefix so PDF is only valid under
        // documents/ and chat-attachments/; image-only prefixes stay fail-closed.
        let allowed = allowed_mime_types_for_object_key(object_key);
        let valid = allowed.contains(&actual_ct.as_str());
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
                // Match the typed service error, not the Display string: the SDK's
                // error text doesn't contain "NoSuchKey", so a brittle string match
                // mislabelled every missing object as an S3Error -> 500 instead of a
                // 404. is_no_such_key() is the stable, version-safe check.
                if e.as_service_error()
                    .is_some_and(aws_sdk_s3::operation::get_object::GetObjectError::is_no_such_key)
                {
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
    ///
    /// Takes the decoded image by `Arc` so the resize/encode can be moved onto
    /// the blocking pool without cloning pixel data; the upload stays async.
    async fn create_variant(
        &self,
        img: Arc<DynamicImage>,
        _source_key: &str,
        context_id: &str,
        variant_name: &str,
        max_w: u32,
        max_h: u32,
        mode: ResizeMode,
    ) -> Result<ImageVariant, ImagingError> {
        let rendered =
            render_variant(img, max_w, max_h, mode, ImageFormat::Jpeg, DEFAULT_QUALITY).await?;

        let dest_key = format!("{context_id}/{variant_name}/{}.jpg", Uuid::now_v7());
        self.upload_to_s3(&dest_key, &rendered.data, "image/jpeg")
            .await?;

        Ok(ImageVariant {
            url: self.public_url(&dest_key),
            width: rendered.width,
            height: rendered.height,
            format: ImageFormat::Jpeg,
            size_bytes: rendered.data.len() as u32,
            variant_name: variant_name.into(),
        })
    }

    /// Build a variant key from the source key by replacing the last segment.
    fn variant_key(&self, source_key: &str, variant: &str, fmt: ImageFormat) -> String {
        let stem = source_key
            .rsplit('/')
            .next()
            .and_then(|f| f.rsplit_once('.'))
            .map_or("img", |(s, _)| s);

        // Derive directory from source key.
        let dir = source_key.rsplit_once('/').map_or("misc", |(d, _)| d);

        format!(
            "{dir}/{variant}/{stem}_{}.{}",
            Uuid::now_v7(),
            fmt.extension()
        )
    }

    /// Construct the public URL for an object key.
    fn public_url(&self, key: &str) -> String {
        format!("{}/{}", self.public_url_base, key)
    }
}

// ---------------------------------------------------------------------------
// Pure functions – no I/O
// ---------------------------------------------------------------------------

/// Validate that decoded image bytes are in a supported format.
fn validate_image_format(data: &[u8]) -> Result<(), ImagingError> {
    let guess = image::guess_format(data)
        .map_err(|e| ImagingError::DecodeError(format!("cannot detect format: {e}")))?;
    match guess {
        ImgFmt::Jpeg | ImgFmt::Png | ImgFmt::WebP => Ok(()),
        other => Err(ImagingError::UnsupportedFormat(format!("{other:?}"))),
    }
}

/// Decode raw bytes into a `DynamicImage`, applying the EXIF orientation tag
/// to the pixels (auto-orient always on — this is the right default for every
/// context pipeline, since all outputs are re-encoded without metadata and
/// would otherwise display sideways for camera-rotated photos).
fn decode_image(data: &[u8]) -> Result<DynamicImage, ImagingError> {
    decode_image_with_orientation(data, true)
}

/// Decode raw bytes into a `DynamicImage`.
///
/// When `auto_orient` is true, the EXIF orientation tag is read from the
/// metadata (the `image` crate does NOT apply it on decode for JPEG) and the
/// corresponding rotation/flip is applied to the pixels, so re-encoded outputs
/// — which carry no EXIF — still display upright.
///
/// Fail-soft: a missing, unreadable, or garbage EXIF segment is treated as
/// orientation 1 (no transform); it never fails the decode.
fn decode_image_with_orientation(
    data: &[u8],
    auto_orient: bool,
) -> Result<DynamicImage, ImagingError> {
    // Bound the decode. Without explicit limits a small, well-formed
    // "decompression bomb" (a few KB of PNG describing enormous dimensions)
    // allocates its full uncompressed size before anything else runs — and an
    // allocator abort is one of the few failures a catch_unwind boundary
    // cannot rescue, so it takes the whole process down rather than one
    // request. The caps below sit far above any legitimate photo.
    let mut limits = Limits::default();
    limits.max_image_width = Some(MAX_DECODE_DIMENSION);
    limits.max_image_height = Some(MAX_DECODE_DIMENSION);
    limits.max_alloc = Some(MAX_DECODE_ALLOC_BYTES);

    let mut reader = ImageReader::new(Cursor::new(data))
        .with_guessed_format()
        .map_err(|e| ImagingError::DecodeError(e.to_string()))?;
    reader.limits(limits);

    let mut decoder = reader
        .into_decoder()
        .map_err(|e| ImagingError::DecodeError(e.to_string()))?;

    // Must be read before consuming the decoder. unwrap_or = fail-soft on
    // corrupt EXIF.
    let orientation = if auto_orient {
        decoder.orientation().unwrap_or(Orientation::NoTransforms)
    } else {
        Orientation::NoTransforms
    };

    let mut img = DynamicImage::from_decoder(decoder)
        .map_err(|e| ImagingError::DecodeError(e.to_string()))?;
    img.apply_orientation(orientation);
    Ok(img)
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
fn encode_image(
    img: &DynamicImage,
    fmt: ImageFormat,
    quality: u8,
) -> Result<Vec<u8>, ImagingError> {
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

/// Compute a simple `BlurHash` string from a downscaled image.
///
/// This is a lightweight implementation that produces a valid 4x3 component
/// `BlurHash`. The image is first downscaled to 32x32, then the DC and AC
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
        (max_ac.mul_add(166.0, -0.5).floor() as u32).clamp(0, 82)
    } else {
        0
    };
    hash.push_str(&base83_encode(quantised_max, 1));

    let real_max = if quantised_max == 0 {
        1.0
    } else {
        (f64::from(quantised_max) + 1.0) / 167.0
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
        1.055f64.mul_add(v.powf(1.0 / 2.4), -0.055)
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
        ALLOWED_MIME_TYPES, DEFAULT_QUALITY, ImageFormat, ImagingError, MAX_FILE_SIZE_BYTES,
        PRESIGN_EXPIRY_SECS, ProcessingOptions, ResizeMode, UploadContext,
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
        assert_eq!(
            ImageFormat::from_mime("image/jpeg"),
            Some(ImageFormat::Jpeg)
        );
        assert_eq!(ImageFormat::from_mime("image/jpg"), Some(ImageFormat::Jpeg));
        assert_eq!(ImageFormat::from_mime("image/png"), Some(ImageFormat::Png));
        assert_eq!(
            ImageFormat::from_mime("image/webp"),
            Some(ImageFormat::WebP)
        );
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
        assert_eq!(
            UploadContext::from_str_context("avatar"),
            Some(UploadContext::Avatar)
        );
        assert_eq!(
            UploadContext::from_str_context("portfolio"),
            Some(UploadContext::Portfolio)
        );
        assert_eq!(
            UploadContext::from_str_context("job_photo"),
            Some(UploadContext::JobPhoto)
        );
        assert_eq!(
            UploadContext::from_str_context("document"),
            Some(UploadContext::Document)
        );
        assert_eq!(
            UploadContext::from_str_context("review_photo"),
            Some(UploadContext::ReviewPhoto)
        );
        assert_eq!(
            UploadContext::from_str_context("listing"),
            Some(UploadContext::Listing)
        );
        assert_eq!(
            UploadContext::from_str_context("chat_attachment"),
            Some(UploadContext::ChatAttachment)
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
        assert_eq!(UploadContext::Listing.path_prefix(), "listings");
        assert_eq!(UploadContext::ChatAttachment.path_prefix(), "chat-attachments");
    }

    #[test]
    fn pdf_only_on_document_and_chat_contexts() {
        assert!(UploadContext::Document.allows_pdf());
        assert!(UploadContext::ChatAttachment.allows_pdf());
        assert!(!UploadContext::Avatar.allows_pdf());
        assert!(!UploadContext::JobPhoto.allows_pdf());
        assert!(!UploadContext::Listing.allows_pdf());
        assert!(UploadContext::Document
            .allowed_mime_types()
            .contains(&"application/pdf"));
        assert!(!UploadContext::Avatar
            .allowed_mime_types()
            .contains(&"application/pdf"));
    }

    #[test]
    fn sniff_content_type_pdf_and_images() {
        assert_eq!(sniff_content_type(b"%PDF-1.4 rest"), "application/pdf");
        assert_eq!(
            sniff_content_type(&[0xFF, 0xD8, 0xFF, 0xE0, 0, 0, 0, 0]),
            "image/jpeg"
        );
        assert_eq!(sniff_content_type(b"not-an-image"), "application/octet-stream");
        assert!(is_pdf_bytes(b"%PDF-1.7"));
        assert!(!is_pdf_bytes(b"JFIF"));
    }

    #[test]
    fn object_key_prefix_gates_pdf() {
        assert!(allowed_mime_types_for_object_key("documents/u/raw/a.pdf")
            .contains(&"application/pdf"));
        assert!(allowed_mime_types_for_object_key("chat-attachments/u/raw/a.pdf")
            .contains(&"application/pdf"));
        assert!(!allowed_mime_types_for_object_key("avatars/u/raw/a.pdf")
            .contains(&"application/pdf"));
        assert!(!allowed_mime_types_for_object_key("job-photos/u/raw/a.pdf")
            .contains(&"application/pdf"));
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
        // Global image list stays PDF-free; document context is separate.
        assert!(!ALLOWED_MIME_TYPES.contains(&"application/pdf"));
        assert_eq!(extension_for_mime("application/pdf"), "pdf");
        assert_eq!(extension_for_mime("image/jpeg"), "jpg");
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
    // EXIF stripping + auto-orient
    // ------------------------------------------------------------------

    /// Build a minimal EXIF APP1 segment (marker + length + "Exif\0\0" +
    /// little-endian TIFF block) carrying an orientation tag (0x0112) and a
    /// GPS IFD (0x8825) with a GPSLatitudeRef entry — i.e. exactly the kind
    /// of location-bearing metadata a phone camera writes.
    fn exif_app1_segment(orientation: u16) -> Vec<u8> {
        let mut tiff = Vec::new();
        // TIFF header: byte order, magic 42, IFD0 offset 8.
        tiff.extend_from_slice(b"II");
        tiff.extend_from_slice(&42u16.to_le_bytes());
        tiff.extend_from_slice(&8u32.to_le_bytes());
        // IFD0 (at offset 8): 2 entries.
        tiff.extend_from_slice(&2u16.to_le_bytes());
        // Entry 1 — Orientation (0x0112), SHORT, count 1, inline value.
        tiff.extend_from_slice(&0x0112u16.to_le_bytes());
        tiff.extend_from_slice(&3u16.to_le_bytes());
        tiff.extend_from_slice(&1u32.to_le_bytes());
        tiff.extend_from_slice(&orientation.to_le_bytes());
        tiff.extend_from_slice(&[0, 0]);
        // Entry 2 — GPS IFD pointer (0x8825), LONG, count 1, offset 38.
        tiff.extend_from_slice(&0x8825u16.to_le_bytes());
        tiff.extend_from_slice(&4u16.to_le_bytes());
        tiff.extend_from_slice(&1u32.to_le_bytes());
        tiff.extend_from_slice(&38u32.to_le_bytes());
        // Next-IFD offset: none.
        tiff.extend_from_slice(&0u32.to_le_bytes());
        // GPS IFD (at offset 38): 1 entry — GPSLatitudeRef (0x0001), ASCII "N\0".
        tiff.extend_from_slice(&1u16.to_le_bytes());
        tiff.extend_from_slice(&0x0001u16.to_le_bytes());
        tiff.extend_from_slice(&2u16.to_le_bytes());
        tiff.extend_from_slice(&2u32.to_le_bytes());
        tiff.extend_from_slice(b"N\0\0\0");
        tiff.extend_from_slice(&0u32.to_le_bytes());

        let mut app1 = vec![0xFF, 0xE1];
        // Segment length covers the length field itself + payload.
        let len = 2 + 6 + tiff.len();
        app1.extend_from_slice(&(len as u16).to_be_bytes());
        app1.extend_from_slice(b"Exif\0\0");
        app1.extend_from_slice(&tiff);
        app1
    }

    /// Splice an APP1 segment into a freshly encoded JPEG, right after SOI —
    /// the position the EXIF spec mandates.
    fn splice_app1(jpeg: &[u8], app1: &[u8]) -> Vec<u8> {
        assert_eq!(&jpeg[..2], &[0xFF, 0xD8], "fixture must start with SOI");
        let mut out = Vec::with_capacity(jpeg.len() + app1.len());
        out.extend_from_slice(&jpeg[..2]);
        out.extend_from_slice(app1);
        out.extend_from_slice(&jpeg[2..]);
        out
    }

    /// Encode a `w`x`h` test image as JPEG with an EXIF segment carrying the
    /// given orientation plus a GPS tag.
    fn jpeg_with_exif(w: u32, h: u32, orientation: u16) -> Vec<u8> {
        let jpeg = encode_image(&make_test_image(w, h), ImageFormat::Jpeg, 90)
            .expect("encode EXIF fixture");
        splice_app1(&jpeg, &exif_app1_segment(orientation))
    }

    fn contains_subsequence(haystack: &[u8], needle: &[u8]) -> bool {
        haystack.windows(needle.len()).any(|w| w == needle)
    }

    #[test]
    fn exif_fixture_actually_carries_exif_and_gps() {
        // Sanity-check the fixture builder: if this fails, the strip tests
        // below prove nothing.
        let bytes = jpeg_with_exif(64, 32, 6);
        assert!(contains_subsequence(&bytes, b"Exif"));
        // GPS IFD pointer tag (0x8825 little-endian, type LONG) as laid out
        // by exif_app1_segment.
        assert!(contains_subsequence(&bytes, &[0x25, 0x88, 0x04, 0x00]));
        // And the decoder agrees there is an orientation to apply.
        let mut decoder = ImageReader::new(Cursor::new(bytes.as_slice()))
            .with_guessed_format()
            .expect("guess format")
            .into_decoder()
            .expect("decoder");
        assert_eq!(
            decoder.orientation().expect("read orientation"),
            Orientation::Rotate90
        );
    }

    #[test]
    fn pipeline_output_strips_exif_and_gps_for_every_format() {
        let input = jpeg_with_exif(64, 32, 1);
        assert!(contains_subsequence(&input, b"Exif"));

        // Same composition as every pipeline path: decode → resize → encode.
        let img = decode_image(&input).expect("decode");
        let resized = resize_image(&img, 32, 32, ResizeMode::Fit);

        for fmt in [ImageFormat::Jpeg, ImageFormat::Png, ImageFormat::WebP] {
            let out = encode_image(&resized, fmt, DEFAULT_QUALITY).expect("encode");
            assert!(
                !contains_subsequence(&out, b"Exif"),
                "{fmt:?} output must not contain an EXIF segment"
            );
            assert!(
                !contains_subsequence(&out, &[0x25, 0x88, 0x04, 0x00]),
                "{fmt:?} output must not contain the GPS IFD entry"
            );
        }
    }

    #[test]
    fn full_size_reencode_strips_exif() {
        // The job-photo "original" path re-encodes WITHOUT resizing — make
        // sure that path is metadata-free too.
        let input = jpeg_with_exif(64, 32, 1);
        let img = decode_image(&input).expect("decode");
        let out = encode_image(&img, ImageFormat::Jpeg, 90).expect("encode");
        assert!(!contains_subsequence(&out, b"Exif"));
    }

    #[test]
    fn auto_orient_rotates_orientation_6_dimensions() {
        // Orientation 6 = 90° CW: an 80x40 landscape must come out 40x80.
        let input = jpeg_with_exif(80, 40, 6);
        let img = decode_image(&input).expect("decode");
        assert_eq!(img.dimensions(), (40, 80));
    }

    #[test]
    fn auto_orient_orientation_3_keeps_dimensions() {
        // Orientation 3 = 180°: dimensions unchanged, decode still succeeds.
        let input = jpeg_with_exif(80, 40, 3);
        let img = decode_image(&input).expect("decode");
        assert_eq!(img.dimensions(), (80, 40));
    }

    #[test]
    fn auto_orient_disabled_ignores_orientation_tag() {
        let input = jpeg_with_exif(80, 40, 6);
        let img = decode_image_with_orientation(&input, false).expect("decode");
        assert_eq!(img.dimensions(), (80, 40));
    }

    #[test]
    fn oriented_image_survives_reencode_with_rotated_dimensions() {
        // End-to-end: rotated camera shot → pipeline → upright, EXIF-free.
        let input = jpeg_with_exif(80, 40, 6);
        let img = decode_image(&input).expect("decode");
        let out = encode_image(&img, ImageFormat::Jpeg, DEFAULT_QUALITY).expect("encode");
        assert!(!contains_subsequence(&out, b"Exif"));
        let roundtrip = decode_image(&out).expect("decode output");
        assert_eq!(roundtrip.dimensions(), (40, 80));
    }

    #[test]
    fn garbage_exif_payload_decodes_without_panic() {
        // Valid APP1 framing, "Exif\0\0" magic, garbage TIFF body.
        let jpeg =
            encode_image(&make_test_image(48, 24), ImageFormat::Jpeg, 90).expect("encode fixture");
        let mut app1 = vec![0xFF, 0xE1];
        let garbage = [0xABu8; 40];
        app1.extend_from_slice(&((2 + 6 + garbage.len()) as u16).to_be_bytes());
        app1.extend_from_slice(b"Exif\0\0");
        app1.extend_from_slice(&garbage);
        let input = splice_app1(&jpeg, &app1);

        // Fail-soft: garbage EXIF → orientation 1, decode still succeeds.
        let img = decode_image(&input).expect("decode with garbage EXIF");
        assert_eq!(img.dimensions(), (48, 24));
    }

    #[test]
    fn out_of_range_orientation_values_are_treated_as_identity() {
        // EXIF orientation is only defined for 1..=8; 0 and 9+ are invalid
        // tag values and must fall back to no-transform, never panic.
        for orientation in [0u16, 9, 99, u16::MAX] {
            let input = jpeg_with_exif(80, 40, orientation);
            let img = decode_image(&input).expect("decode");
            assert_eq!(
                img.dimensions(),
                (80, 40),
                "invalid orientation {orientation} must not transform"
            );
        }
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
        assert_eq!(
            hash.len(),
            28,
            "4x3 BlurHash should be 28 chars, got {}",
            hash.len()
        );
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
    // Blocking-pool boundary
    // ------------------------------------------------------------------

    /// The CPU stage must run on the blocking pool, not on a runtime worker.
    ///
    /// The runtime here has exactly one async worker thread, which is the
    /// sharpest form of the production failure: if decode/resize/encode is
    /// polled inline, nothing else on that thread — including this process's
    /// own gRPC health handler — makes progress until it finishes.
    ///
    /// The test asserts both directions so it cannot silently pass if the
    /// `spawn_blocking` hop is removed:
    ///
    ///   * control — the same work called directly advances the heartbeat by
    ///     exactly zero ticks (the old behaviour),
    ///   * treatment — the same work via [`render_processed`] lets the
    ///     heartbeat keep ticking.
    #[test]
    fn cpu_render_runs_off_the_async_runtime() {
        use std::sync::atomic::{AtomicU64, Ordering};
        use std::time::Duration;

        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("build single-worker runtime");

        rt.block_on(async {
            let raw = encode_image(&make_test_image(1600, 1200), ImageFormat::Jpeg, 90)
                .expect("encode fixture");

            let ticks = Arc::new(AtomicU64::new(0));
            let counter = Arc::clone(&ticks);
            let heartbeat = tokio::spawn(async move {
                loop {
                    tokio::time::sleep(Duration::from_millis(1)).await;
                    counter.fetch_add(1, Ordering::Relaxed);
                }
            });

            // Let the heartbeat get scheduled and start ticking.
            tokio::time::sleep(Duration::from_millis(20)).await;

            let opts = ProcessingOptions {
                max_width: 800,
                max_height: 800,
                generate_blur_hash: true,
                ..ProcessingOptions::default()
            };

            // Control: the pre-fix code path — pure CPU polled inline. There is
            // no await between these two reads, so on a single-worker runtime
            // the heartbeat provably cannot advance.
            let before_inline = ticks.load(Ordering::Relaxed);
            let img = decode_image_with_orientation(&raw, opts.auto_orient).expect("decode");
            let resized = resize_image(&img, opts.max_width, opts.max_height, opts.resize_mode);
            let inline_encoded = encode_image(&resized, opts.format, opts.quality).expect("encode");
            let after_inline = ticks.load(Ordering::Relaxed);

            assert!(!inline_encoded.is_empty());
            assert_eq!(
                after_inline, before_inline,
                "control: inline CPU work starves every other task on the runtime"
            );

            // Treatment: the same work through the blocking-pool boundary.
            let before = ticks.load(Ordering::Relaxed);
            let rendered = render_processed(raw, opts).await.expect("render");
            let after = ticks.load(Ordering::Relaxed);

            heartbeat.abort();

            assert!(!rendered.image.data.is_empty());
            assert!(rendered.blur_hash.is_some());
            assert_eq!(rendered.original_width, 1600);
            assert_eq!(rendered.original_height, 1200);
            assert!(
                after > before,
                "runtime must keep polling other tasks while the CPU render is in flight \
                 (heartbeat ticks {before} -> {after})"
            );
        });
    }

    /// Every render helper is an `async fn` that hands its work to
    /// `spawn_blocking`, so a panic inside the image crate arrives as a
    /// `JoinError` and becomes an `Internal` error instead of unwinding
    /// through the gRPC connection.
    #[tokio::test]
    async fn render_helpers_surface_decode_errors_not_panics() {
        let err = decode_shared(vec![0, 1, 2, 3])
            .await
            .expect_err("garbage bytes must not decode");
        assert!(matches!(err, ImagingError::DecodeError(_)));

        let err = render_processed(vec![0, 1, 2, 3], ProcessingOptions::default())
            .await
            .expect_err("garbage bytes must not render");
        // guess_format runs first, so this is the unsupported-format arm.
        assert!(matches!(
            err,
            ImagingError::DecodeError(_) | ImagingError::UnsupportedFormat(_)
        ));
    }

    /// The multi-variant paths share one decoded image across renders.
    #[tokio::test]
    async fn render_variant_reuses_a_shared_decode() {
        let raw = encode_image(&make_test_image(400, 300), ImageFormat::Jpeg, 90)
            .expect("encode fixture");
        let img = decode_shared(raw).await.expect("decode");

        let large = render_variant(
            Arc::clone(&img),
            200,
            200,
            ResizeMode::Fit,
            ImageFormat::Jpeg,
            DEFAULT_QUALITY,
        )
        .await
        .expect("render large");
        let small = render_variant(
            Arc::clone(&img),
            50,
            50,
            ResizeMode::Exact,
            ImageFormat::Jpeg,
            DEFAULT_QUALITY,
        )
        .await
        .expect("render small");

        assert!(large.width <= 200 && large.height <= 200);
        assert_eq!((small.width, small.height), (50, 50));
        assert!(!large.data.is_empty() && !small.data.is_empty());

        // The source image is still owned solely by this test plus the two
        // completed renders' released clones.
        assert_eq!(Arc::strong_count(&img), 1);

        let square = render_center_square(img).await.expect("crop");
        assert_eq!(square.dimensions(), (300, 300));
        let hash = render_blur_hash(square).await.expect("blur hash");
        assert_eq!(hash.len(), 28);
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
