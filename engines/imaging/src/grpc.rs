/// Generated protobuf types and gRPC service definitions.
///
/// Module hierarchy mirrors proto package paths so relative imports resolve correctly.

#[allow(clippy::all, clippy::pedantic, dead_code)]
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

use crate::engine::ImagePipeline;
use crate::models::{
    ImageFormat, ImageVariant, ImagingError, ProcessingOptions, ResizeMode, UploadContext,
};

/// gRPC service implementation wrapping the image processing pipeline.
pub struct ImagingServiceImpl {
    pipeline: Arc<ImagePipeline>,
}

impl ImagingServiceImpl {
    #[must_use]
    pub fn new(pipeline: Arc<ImagePipeline>) -> Self {
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
        let opts = proto_options_to_domain(req.options.as_ref());

        let (variant, blur_hash) = self
            .pipeline
            .process_image(&source_key, &opts)
            .await
            .map_err(imaging_error_to_status)?;

        Ok(Response::new(imaging_proto::ProcessImageResponse {
            result: Some(variant_to_proto(&variant)),
            blur_hash: blur_hash.unwrap_or_default(),
            original_width: variant.width as i32,
            original_height: variant.height as i32,
        }))
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

    async fn batch_process_images(
        &self,
        request: Request<imaging_proto::BatchProcessImagesRequest>,
    ) -> Result<Response<imaging_proto::BatchProcessImagesResponse>, Status> {
        let req = request.into_inner();
        if req.images.is_empty() {
            return Err(Status::invalid_argument(
                "at least one image request is required",
            ));
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
            let opts = proto_options_to_domain(img_req.options.as_ref());

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
                let err = if is_valid {
                    String::new()
                } else {
                    format!("unsupported content type: {actual_ct}")
                };
                (url, is_valid, err)
            }
            Err(ImagingError::NotFound(msg)) => {
                (String::new(), false, msg)
            }
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
    if let Some(rest) = url.strip_prefix("http://").or_else(|| url.strip_prefix("https://")) {
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
fn proto_options_to_domain(opts: Option<&imaging_proto::ProcessingOptions>) -> ProcessingOptions {
    let Some(o) = opts else {
        return ProcessingOptions::default();
    };

    ProcessingOptions {
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
        format: proto_image_format(o.output_format),
        strip_exif: o.strip_exif,
        auto_orient: o.auto_orient,
        generate_blur_hash: o.generate_blur_hash,
    }
}

/// Convert proto resize mode int to domain enum.
fn proto_resize_mode(v: i32) -> ResizeMode {
    match v {
        1 => ResizeMode::Fit,
        2 => ResizeMode::Fill,
        3 => ResizeMode::Exact,
        _ => ResizeMode::Fit,
    }
}

/// Convert proto image format int to domain enum.
fn proto_image_format(v: i32) -> ImageFormat {
    match v {
        1 => ImageFormat::Jpeg,
        2 => ImageFormat::Png,
        3 => ImageFormat::WebP,
        _ => ImageFormat::Jpeg,
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
fn domain_format_to_proto(f: ImageFormat) -> i32 {
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
            "invalid context '{s}': expected one of avatar, portfolio, job_photo, document, review_photo"
        ))
    })
}

/// Map `ImagingError` to a gRPC `Status`.
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
