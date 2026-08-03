/// Generated protobuf types and gRPC service definitions.
///
/// Module hierarchy mirrors proto package paths so relative imports resolve correctly.

#[allow(clippy::all, clippy::pedantic, clippy::nursery, dead_code)]
pub mod nomarkup {
    pub mod common {
        pub mod v1 {
            tonic::include_proto!("nomarkup.common.v1");
        }
    }
    pub mod imaging {
        pub mod v1 {
            tonic::include_proto!("nomarkup.imaging.v1");
        }
    }
}

// Re-export for convenience.
pub use nomarkup::imaging::v1 as imaging_proto;
pub use nomarkup::imaging::v1::imaging_service_server::{ImagingService, ImagingServiceServer};

use std::sync::Arc;

use tonic::{Request, Response, Status};
use tracing::{info, warn};

use crate::engine::ImagePipeline;
use crate::models::{
    ImageFormat, ImageVariant, ImagingError, MAX_BATCH_IMAGES, ProcessingOptions, ResizeMode,
    UploadContext,
};

/// gRPC service implementation wrapping the image processing pipeline.
pub struct ImagingServiceImpl {
    pipeline: Arc<ImagePipeline>,
}

impl ImagingServiceImpl {
    #[must_use]
    pub const fn new(pipeline: Arc<ImagePipeline>) -> Self {
        Self { pipeline }
    }
}

#[tonic::async_trait]
impl ImagingService for ImagingServiceImpl {
    async fn process_image(
        &self,
        request: Request<imaging_proto::ProcessImageRequest>,
    ) -> Result<Response<imaging_proto::ProcessImageResponse>, Status> {
        let req = request.into_inner();
        if req.source_url.is_empty() {
            return Err(Status::invalid_argument("source_url is required"));
        }

        let source_key = url_to_key(&req.source_url);
        let opts = proto_options_to_domain(req.options.as_ref())?;

        match self.pipeline.process_image(&source_key, &opts).await {
            Ok((variant, blur_hash)) => {
                info!(
                    source = %source_key,
                    width = variant.width,
                    height = variant.height,
                    format = ?variant.format,
                    "grpc process_image completed"
                );
                Ok(Response::new(imaging_proto::ProcessImageResponse {
                    result: Some(variant_to_proto(&variant)),
                    blur_hash: blur_hash.unwrap_or_default(),
                    original_width: variant.width as i32,
                    original_height: variant.height as i32,
                }))
            }
            Err(e) => {
                warn!(source = %source_key, error = %e, "grpc process_image failed");
                Err(imaging_error_to_status(e))
            }
        }
    }

    async fn generate_thumbnail(
        &self,
        request: Request<imaging_proto::GenerateThumbnailRequest>,
    ) -> Result<Response<imaging_proto::GenerateThumbnailResponse>, Status> {
        let req = request.into_inner();
        if req.source_url.is_empty() {
            return Err(Status::invalid_argument("source_url is required"));
        }

        let source_key = url_to_key(&req.source_url);
        let width = if req.width > 0 { req.width as u32 } else { 200 };
        let height = if req.height > 0 {
            req.height as u32
        } else {
            200
        };
        let mode = proto_resize_mode(req.resize_mode);

        let variant = self
            .pipeline
            .generate_thumbnail(&source_key, width, height, mode)
            .await
            .map_err(imaging_error_to_status)?;

        Ok(Response::new(imaging_proto::GenerateThumbnailResponse {
            thumbnail: Some(variant_to_proto(&variant)),
        }))
    }

    #[tracing::instrument(
        skip_all,
        fields(
            batch_size = tracing::field::Empty,
            succeeded = tracing::field::Empty,
            failed = tracing::field::Empty,
        )
    )]
    async fn batch_process_images(
        &self,
        request: Request<imaging_proto::BatchProcessImagesRequest>,
    ) -> Result<Response<imaging_proto::BatchProcessImagesResponse>, Status> {
        let req = request.into_inner();
        tracing::Span::current().record("batch_size", req.images.len());
        if req.images.is_empty() {
            return Err(Status::invalid_argument(
                "at least one image request is required",
            ));
        }
        // Bound the CPU work one caller can request. Without this the batch
        // size is whatever the client sends, and each image is tens of ms of
        // decode/resize/encode on the blocking pool.
        if req.images.len() > MAX_BATCH_IMAGES {
            return Err(Status::invalid_argument(format!(
                "batch too large: {} images exceeds the limit of {MAX_BATCH_IMAGES}; split the request",
                req.images.len()
            )));
        }

        let mut results = Vec::with_capacity(req.images.len());
        let mut succeeded = 0i32;
        let mut failed = 0i32;

        for (idx, img_req) in req.images.into_iter().enumerate() {
            if img_req.source_url.is_empty() {
                results.push(imaging_proto::BatchImageResult {
                    index: idx as i32,
                    success: false,
                    result: None,
                    error: "source_url is required".into(),
                });
                failed += 1;
                continue;
            }

            let source_key = url_to_key(&img_req.source_url);
            let opts = match proto_options_to_domain(img_req.options.as_ref()) {
                Ok(o) => o,
                Err(e) => {
                    results.push(imaging_proto::BatchImageResult {
                        index: idx as i32,
                        success: false,
                        result: None,
                        error: e.message().to_string(),
                    });
                    failed += 1;
                    continue;
                }
            };

            match self.pipeline.process_image(&source_key, &opts).await {
                Ok((variant, _blur)) => {
                    results.push(imaging_proto::BatchImageResult {
                        index: idx as i32,
                        success: true,
                        result: Some(variant_to_proto(&variant)),
                        error: String::new(),
                    });
                    succeeded += 1;
                }
                Err(e) => {
                    results.push(imaging_proto::BatchImageResult {
                        index: idx as i32,
                        success: false,
                        result: None,
                        error: e.to_string(),
                    });
                    failed += 1;
                }
            }
        }

        let span = tracing::Span::current();
        span.record("succeeded", succeeded);
        span.record("failed", failed);

        Ok(Response::new(imaging_proto::BatchProcessImagesResponse {
            results,
            succeeded,
            failed,
        }))
    }

    async fn process_job_photos(
        &self,
        request: Request<imaging_proto::ProcessJobPhotosRequest>,
    ) -> Result<Response<imaging_proto::ProcessJobPhotosResponse>, Status> {
        let req = request.into_inner();
        if req.job_id.is_empty() {
            return Err(Status::invalid_argument("job_id is required"));
        }
        if req.source_urls.is_empty() {
            return Err(Status::invalid_argument(
                "at least one source_url is required",
            ));
        }
        // Same bound as BatchProcessImages — this path is heavier still, since
        // every source renders four outputs (original + large + medium +
        // thumbnail) plus a BlurHash.
        if req.source_urls.len() > MAX_BATCH_IMAGES {
            return Err(Status::invalid_argument(format!(
                "batch too large: {} photos exceeds the limit of {MAX_BATCH_IMAGES}; split the request",
                req.source_urls.len()
            )));
        }

        let keys: Vec<String> = req.source_urls.iter().map(|u| url_to_key(u)).collect();

        let photos = self
            .pipeline
            .process_job_photos(&req.job_id, &keys)
            .await
            .map_err(imaging_error_to_status)?;

        let proto_photos: Vec<imaging_proto::ProcessedJobPhoto> = photos
            .into_iter()
            .map(|p| imaging_proto::ProcessedJobPhoto {
                original_url: p.original_url,
                large: Some(variant_to_proto(&p.large)),
                medium: Some(variant_to_proto(&p.medium)),
                thumbnail: Some(variant_to_proto(&p.thumbnail)),
                blur_hash: p.blur_hash,
            })
            .collect();

        Ok(Response::new(imaging_proto::ProcessJobPhotosResponse {
            photos: proto_photos,
        }))
    }

    async fn process_portfolio_image(
        &self,
        request: Request<imaging_proto::ProcessPortfolioImageRequest>,
    ) -> Result<Response<imaging_proto::ProcessPortfolioImageResponse>, Status> {
        let req = request.into_inner();
        if req.user_id.is_empty() {
            return Err(Status::invalid_argument("user_id is required"));
        }
        if req.source_url.is_empty() {
            return Err(Status::invalid_argument("source_url is required"));
        }

        let source_key = url_to_key(&req.source_url);

        let (full, display, thumb, blur_hash) = self
            .pipeline
            .process_portfolio_image(&req.user_id, &source_key)
            .await
            .map_err(imaging_error_to_status)?;

        Ok(Response::new(
            imaging_proto::ProcessPortfolioImageResponse {
                full: Some(variant_to_proto(&full)),
                display: Some(variant_to_proto(&display)),
                thumbnail: Some(variant_to_proto(&thumb)),
                blur_hash,
            },
        ))
    }

    async fn process_avatar(
        &self,
        request: Request<imaging_proto::ProcessAvatarRequest>,
    ) -> Result<Response<imaging_proto::ProcessAvatarResponse>, Status> {
        let req = request.into_inner();
        if req.user_id.is_empty() {
            return Err(Status::invalid_argument("user_id is required"));
        }
        if req.source_url.is_empty() {
            return Err(Status::invalid_argument("source_url is required"));
        }

        let source_key = url_to_key(&req.source_url);

        let (large, medium, small, _blur_hash) = self
            .pipeline
            .process_avatar(&req.user_id, &source_key)
            .await
            .map_err(imaging_error_to_status)?;

        // Primary avatar URL is the medium variant.
        let avatar_url = medium.url.clone();

        Ok(Response::new(imaging_proto::ProcessAvatarResponse {
            large: Some(variant_to_proto(&large)),
            medium: Some(variant_to_proto(&medium)),
            small: Some(variant_to_proto(&small)),
            avatar_url,
        }))
    }

    async fn process_document(
        &self,
        request: Request<imaging_proto::ProcessDocumentRequest>,
    ) -> Result<Response<imaging_proto::ProcessDocumentResponse>, Status> {
        let req = request.into_inner();
        if req.user_id.is_empty() {
            return Err(Status::invalid_argument("user_id is required"));
        }
        if req.source_url.is_empty() {
            return Err(Status::invalid_argument("source_url is required"));
        }

        let source_key = url_to_key(&req.source_url);

        let (processed, thumb, orig_w, orig_h) = self
            .pipeline
            .process_document(&req.user_id, &source_key, &req.document_type)
            .await
            .map_err(imaging_error_to_status)?;

        Ok(Response::new(imaging_proto::ProcessDocumentResponse {
            processed: Some(variant_to_proto(&processed)),
            thumbnail: Some(variant_to_proto(&thumb)),
            original_width: orig_w as i32,
            original_height: orig_h as i32,
        }))
    }

    async fn get_upload_url(
        &self,
        request: Request<imaging_proto::GetUploadUrlRequest>,
    ) -> Result<Response<imaging_proto::GetUploadUrlResponse>, Status> {
        let req = request.into_inner();
        if req.user_id.is_empty() {
            return Err(Status::invalid_argument("user_id is required"));
        }
        if req.filename.is_empty() {
            return Err(Status::invalid_argument("filename is required"));
        }
        if req.mime_type.is_empty() {
            return Err(Status::invalid_argument("mime_type is required"));
        }

        let context = parse_upload_context(&req.context)?;

        let (upload_url, object_key, expires_at) = self
            .pipeline
            .get_upload_url(
                &req.user_id,
                &req.filename,
                &req.mime_type,
                i64::from(req.file_size_bytes),
                context,
            )
            .await
            .map_err(imaging_error_to_status)?;

        Ok(Response::new(imaging_proto::GetUploadUrlResponse {
            upload_url,
            object_key,
            expires_at: Some(prost_types::Timestamp {
                seconds: expires_at,
                nanos: 0,
            }),
        }))
    }

    async fn confirm_upload(
        &self,
        request: Request<imaging_proto::ConfirmUploadRequest>,
    ) -> Result<Response<imaging_proto::ConfirmUploadResponse>, Status> {
        let req = request.into_inner();
        if req.object_key.is_empty() {
            return Err(Status::invalid_argument("object_key is required"));
        }
        if req.user_id.is_empty() {
            return Err(Status::invalid_argument("user_id is required"));
        }

        let (source_url, valid, error_msg) = match self
            .pipeline
            .confirm_upload(&req.object_key, &req.user_id)
            .await
        {
            Ok((url, is_valid, actual_ct)) => {
                // On the invalid path, carry the bare detected content type
                // (e.g. "application/octet-stream") in `error`. The gateway
                // surfaces it to the web client as `actual_content_type`, which
                // renders it inline ("detected content type \"...\""), so a
                // prefixed sentence would read awkwardly there.
                let err = if is_valid { String::new() } else { actual_ct };
                (url, is_valid, err)
            }
            Err(ImagingError::NotFound(msg)) => (String::new(), false, msg),
            Err(e) => return Err(imaging_error_to_status(e)),
        };

        Ok(Response::new(imaging_proto::ConfirmUploadResponse {
            source_url,
            valid,
            error: error_msg,
        }))
    }
}

// ---------------------------------------------------------------------------
// Conversion helpers
// ---------------------------------------------------------------------------

/// Extract the S3 object key from a full URL.
/// If the URL is already a key (no scheme), return as-is.
fn url_to_key(url: &str) -> String {
    // URLs like "http://localhost:9000/nomarkup/avatars/user1/raw/file.jpg"
    // We need to extract "avatars/user1/raw/file.jpg".
    if let Some(rest) = url
        .strip_prefix("http://")
        .or_else(|| url.strip_prefix("https://"))
    {
        // Skip host, then skip bucket name (first path segment after host).
        if let Some(path_start) = rest.find('/') {
            let path = &rest[path_start + 1..];
            // The first segment of the path is the bucket name.
            if let Some(key_start) = path.find('/') {
                return path[key_start + 1..].to_string();
            }
            return path.to_string();
        }
    }
    url.to_string()
}

/// Convert proto `ProcessingOptions` to domain `ProcessingOptions`.
///
/// # Errors
///
/// Returns a gRPC `Status::invalid_argument` if an unsupported format
/// (e.g. AVIF) is requested.
fn proto_options_to_domain(
    opts: Option<&imaging_proto::ProcessingOptions>,
) -> Result<ProcessingOptions, Status> {
    let Some(o) = opts else {
        return Ok(ProcessingOptions::default());
    };

    Ok(ProcessingOptions {
        max_width: if o.max_width > 0 {
            o.max_width as u32
        } else {
            1600
        },
        max_height: if o.max_height > 0 {
            o.max_height as u32
        } else {
            1600
        },
        resize_mode: proto_resize_mode(o.resize_mode),
        quality: if o.quality > 0 && o.quality <= 100 {
            o.quality as u8
        } else {
            85
        },
        format: proto_image_format(o.output_format)?,
        strip_exif: o.strip_exif,
        auto_orient: o.auto_orient,
        generate_blur_hash: o.generate_blur_hash,
    })
}

/// Convert proto resize mode int to domain enum.
const fn proto_resize_mode(v: i32) -> ResizeMode {
    match v {
        1 => ResizeMode::Fit,
        2 => ResizeMode::Fill,
        3 => ResizeMode::Exact,
        _ => ResizeMode::Fit,
    }
}

/// Convert proto image format int to domain enum.
///
/// Returns `Err` for AVIF (value 4) since it is not yet supported.
fn proto_image_format(v: i32) -> Result<ImageFormat, Status> {
    match v {
        1 | 0 => Ok(ImageFormat::Jpeg),
        2 => Ok(ImageFormat::Png),
        3 => Ok(ImageFormat::WebP),
        4 => Err(Status::invalid_argument("AVIF format not yet supported")),
        _ => Ok(ImageFormat::Jpeg),
    }
}

/// Convert a domain `ImageVariant` to proto `ImageVariant`.
fn variant_to_proto(v: &ImageVariant) -> imaging_proto::ImageVariant {
    imaging_proto::ImageVariant {
        url: v.url.clone(),
        width: v.width as i32,
        height: v.height as i32,
        format: domain_format_to_proto(v.format),
        size_bytes: v.size_bytes as i32,
        variant_name: v.variant_name.clone(),
    }
}

/// Convert a domain `ImageFormat` to proto enum i32.
const fn domain_format_to_proto(f: ImageFormat) -> i32 {
    match f {
        ImageFormat::Jpeg => 1,
        ImageFormat::Png => 2,
        ImageFormat::WebP => 3,
    }
}

/// Parse a context string into an `UploadContext`, returning a gRPC error on failure.
fn parse_upload_context(s: &str) -> Result<UploadContext, Status> {
    UploadContext::from_str_context(s).ok_or_else(|| {
        Status::invalid_argument(format!(
            "invalid context '{s}': expected one of avatar, portfolio, job_photo, document, review_photo, listing, chat_attachment"
        ))
    })
}

/// Map `ImagingError` to a gRPC `Status`.
// (tests for the batch bounds live at the bottom of this file)
fn imaging_error_to_status(err: ImagingError) -> Status {
    match err {
        ImagingError::InvalidArgument(msg) => Status::invalid_argument(msg),
        ImagingError::UnsupportedFormat(msg) | ImagingError::UnsupportedMimeType(msg) => {
            Status::invalid_argument(msg)
        }
        ImagingError::FileTooLarge { size, limit } => Status::invalid_argument(format!(
            "file too large: {size} bytes exceeds limit of {limit} bytes"
        )),
        ImagingError::NotFound(msg) => Status::not_found(msg),
        ImagingError::DecodeError(msg) => {
            tracing::error!(error = msg.as_str(), "image decode error");
            Status::invalid_argument(format!("failed to decode image: {msg}"))
        }
        ImagingError::EncodeError(msg) => {
            tracing::error!(error = msg.as_str(), "image encode error");
            Status::internal("image encoding failed")
        }
        ImagingError::S3Error(msg) => {
            tracing::error!(error = msg.as_str(), "S3 error");
            Status::internal("storage error")
        }
        ImagingError::Internal(msg) => {
            tracing::error!(error = msg.as_str(), "internal imaging error");
            Status::internal("internal error")
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A pipeline pointed at an S3 endpoint that is never contacted: every
    /// assertion below is about request validation, which runs before the
    /// first network call.
    fn test_service() -> ImagingServiceImpl {
        let config = aws_sdk_s3::config::Builder::new()
            .behavior_version(aws_sdk_s3::config::BehaviorVersion::latest())
            .region(aws_sdk_s3::config::Region::new("us-east-1"))
            .credentials_provider(aws_sdk_s3::config::Credentials::new(
                "test", "test", None, None, "test",
            ))
            .force_path_style(true)
            .build();

        let pipeline = ImagePipeline::new(
            aws_sdk_s3::Client::from_conf(config),
            "test-bucket".to_string(),
            "http://localhost:9000/test-bucket".to_string(),
        );

        ImagingServiceImpl::new(Arc::new(pipeline))
    }

    fn image_request(idx: usize) -> imaging_proto::ProcessImageRequest {
        imaging_proto::ProcessImageRequest {
            source_url: format!("http://localhost:9000/test-bucket/raw/{idx}.jpg"),
            options: None,
            context: String::new(),
        }
    }

    /// An oversized batch is rejected up front, before any CPU work is queued.
    /// Without this bound one caller could hand the engine an unbounded number
    /// of decode/resize/encode jobs in a single RPC.
    #[tokio::test]
    async fn batch_process_rejects_oversized_batch() {
        let service = test_service();

        let images: Vec<_> = (0..=MAX_BATCH_IMAGES).map(image_request).collect();
        let status = service
            .batch_process_images(Request::new(imaging_proto::BatchProcessImagesRequest {
                images,
            }))
            .await
            .expect_err("batch above the cap must be rejected");

        assert_eq!(status.code(), tonic::Code::InvalidArgument);
        assert!(
            status.message().contains("batch too large"),
            "message should explain the limit, got: {}",
            status.message()
        );
        assert!(status.message().contains(&MAX_BATCH_IMAGES.to_string()));
    }

    #[tokio::test]
    async fn batch_process_rejects_empty_batch() {
        let service = test_service();

        let status = service
            .batch_process_images(Request::new(imaging_proto::BatchProcessImagesRequest {
                images: Vec::new(),
            }))
            .await
            .expect_err("empty batch must be rejected");

        assert_eq!(status.code(), tonic::Code::InvalidArgument);
    }

    /// The job-photo path renders four outputs per source, so it carries the
    /// same bound.
    #[tokio::test]
    async fn process_job_photos_rejects_oversized_batch() {
        let service = test_service();

        let source_urls: Vec<String> = (0..=MAX_BATCH_IMAGES)
            .map(|i| format!("http://localhost:9000/test-bucket/raw/{i}.jpg"))
            .collect();

        let status = service
            .process_job_photos(Request::new(imaging_proto::ProcessJobPhotosRequest {
                job_id: "job-1".to_string(),
                source_urls,
            }))
            .await
            .expect_err("photo batch above the cap must be rejected");

        assert_eq!(status.code(), tonic::Code::InvalidArgument);
        assert!(status.message().contains("batch too large"));
    }

    #[tokio::test]
    async fn process_job_photos_rejects_empty_batch() {
        let service = test_service();

        let status = service
            .process_job_photos(Request::new(imaging_proto::ProcessJobPhotosRequest {
                job_id: "job-1".to_string(),
                source_urls: Vec::new(),
            }))
            .await
            .expect_err("empty photo batch must be rejected");

        assert_eq!(status.code(), tonic::Code::InvalidArgument);
    }

    /// The cap must stay at or above the product limit (10 photos per job /
    /// listing form) so a legitimate upload is never rejected.
    #[test]
    fn batch_cap_covers_the_product_photo_limit() {
        const PRODUCT_PHOTO_LIMIT: usize = 10;
        const {
            assert!(
                MAX_BATCH_IMAGES >= PRODUCT_PHOTO_LIMIT,
                "cap must not reject a full 10-photo job posting"
            );
        }
    }
}
