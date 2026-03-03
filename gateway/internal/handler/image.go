package handler

import (
	"encoding/json"
	"net/http"

	imagingv1 "github.com/nomarkup/nomarkup/proto/imaging/v1"

	"github.com/nomarkup/nomarkup/gateway/internal/middleware"
)

// ImageHandler handles HTTP endpoints for the imaging pipeline.
type ImageHandler struct {
	imagingClient imagingv1.ImagingServiceClient
}

// NewImageHandler creates a new ImageHandler.
func NewImageHandler(client imagingv1.ImagingServiceClient) *ImageHandler {
	return &ImageHandler{imagingClient: client}
}

// GetUploadURL handles POST /api/v1/images/upload-url.
// Body: { "filename": "...", "mime_type": "...", "file_size_bytes": 12345, "context": "avatar" }
func (h *ImageHandler) GetUploadURL(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "authentication required")
		return
	}

	var body struct {
		Filename      string `json:"filename"`
		MimeType      string `json:"mime_type"`
		FileSizeBytes int32  `json:"file_size_bytes"`
		Context       string `json:"context"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if body.Filename == "" {
		writeError(w, http.StatusBadRequest, "filename is required")
		return
	}
	if body.MimeType == "" {
		writeError(w, http.StatusBadRequest, "mime_type is required")
		return
	}
	if body.FileSizeBytes <= 0 {
		writeError(w, http.StatusBadRequest, "file_size_bytes must be positive")
		return
	}
	if body.Context == "" {
		writeError(w, http.StatusBadRequest, "context is required")
		return
	}

	resp, err := h.imagingClient.GetUploadURL(r.Context(), &imagingv1.GetUploadURLRequest{
		UserId:        claims.UserID,
		Filename:      body.Filename,
		MimeType:      body.MimeType,
		FileSizeBytes: body.FileSizeBytes,
		Context:       body.Context,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	result := map[string]interface{}{
		"upload_url": resp.GetUploadUrl(),
		"object_key": resp.GetObjectKey(),
	}
	if resp.GetExpiresAt() != nil {
		result["expires_at"] = formatTimestamp(resp.GetExpiresAt())
	}

	writeJSON(w, http.StatusOK, result)
}

// ConfirmUpload handles POST /api/v1/images/confirm.
// Body: { "object_key": "...", "context": "avatar" }
func (h *ImageHandler) ConfirmUpload(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "authentication required")
		return
	}

	var body struct {
		ObjectKey string `json:"object_key"`
		Context   string `json:"context"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if body.ObjectKey == "" {
		writeError(w, http.StatusBadRequest, "object_key is required")
		return
	}

	resp, err := h.imagingClient.ConfirmUpload(r.Context(), &imagingv1.ConfirmUploadRequest{
		ObjectKey: body.ObjectKey,
		UserId:    claims.UserID,
		Context:   body.Context,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	result := map[string]interface{}{
		"source_url": resp.GetSourceUrl(),
		"valid":      resp.GetValid(),
	}
	if resp.GetError() != "" {
		result["error"] = resp.GetError()
	}

	writeJSON(w, http.StatusOK, result)
}

// ProcessImage handles POST /api/v1/images/process.
// Body: { "source_url": "...", "context": "job_photo", "options": { ... } }
func (h *ImageHandler) ProcessImage(w http.ResponseWriter, r *http.Request) {
	_, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "authentication required")
		return
	}

	var body struct {
		SourceURL string                  `json:"source_url"`
		Context   string                  `json:"context"`
		Options   *processImageOptionsDTO `json:"options"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if body.SourceURL == "" {
		writeError(w, http.StatusBadRequest, "source_url is required")
		return
	}

	grpcReq := &imagingv1.ProcessImageRequest{
		SourceUrl: body.SourceURL,
		Context:   body.Context,
	}

	if body.Options != nil {
		grpcReq.Options = &imagingv1.ProcessingOptions{
			MaxWidth:         body.Options.MaxWidth,
			MaxHeight:        body.Options.MaxHeight,
			ResizeMode:       parseResizeMode(body.Options.ResizeMode),
			Quality:          body.Options.Quality,
			OutputFormat:     parseImageFormat(body.Options.OutputFormat),
			StripExif:        body.Options.StripExif,
			AutoOrient:       body.Options.AutoOrient,
			GenerateBlurHash: body.Options.GenerateBlurHash,
		}
	}

	resp, err := h.imagingClient.ProcessImage(r.Context(), grpcReq)
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	result := map[string]interface{}{
		"original_width":  resp.GetOriginalWidth(),
		"original_height": resp.GetOriginalHeight(),
	}
	if resp.GetResult() != nil {
		result["result"] = imageVariantToJSON(resp.GetResult())
	}
	if resp.GetBlurHash() != "" {
		result["blur_hash"] = resp.GetBlurHash()
	}

	writeJSON(w, http.StatusOK, result)
}

// ---------------------------------------------------------------------------
// DTO and conversion helpers
// ---------------------------------------------------------------------------

type processImageOptionsDTO struct {
	MaxWidth         int32  `json:"max_width"`
	MaxHeight        int32  `json:"max_height"`
	ResizeMode       string `json:"resize_mode"`
	Quality          int32  `json:"quality"`
	OutputFormat     string `json:"output_format"`
	StripExif        bool   `json:"strip_exif"`
	AutoOrient       bool   `json:"auto_orient"`
	GenerateBlurHash bool   `json:"generate_blur_hash"`
}

func imageVariantToJSON(v *imagingv1.ImageVariant) map[string]interface{} {
	if v == nil {
		return map[string]interface{}{}
	}
	return map[string]interface{}{
		"url":          v.GetUrl(),
		"width":        v.GetWidth(),
		"height":       v.GetHeight(),
		"format":       imageFormatToString(v.GetFormat()),
		"size_bytes":   v.GetSizeBytes(),
		"variant_name": v.GetVariantName(),
	}
}

func imageFormatToString(f imagingv1.ImageFormat) string {
	switch f {
	case imagingv1.ImageFormat_IMAGE_FORMAT_JPEG:
		return "jpeg"
	case imagingv1.ImageFormat_IMAGE_FORMAT_PNG:
		return "png"
	case imagingv1.ImageFormat_IMAGE_FORMAT_WEBP:
		return "webp"
	case imagingv1.ImageFormat_IMAGE_FORMAT_AVIF:
		return "avif"
	default:
		return "unspecified"
	}
}

func parseResizeMode(s string) imagingv1.ResizeMode {
	switch s {
	case "fit":
		return imagingv1.ResizeMode_RESIZE_MODE_FIT
	case "fill":
		return imagingv1.ResizeMode_RESIZE_MODE_FILL
	case "exact":
		return imagingv1.ResizeMode_RESIZE_MODE_EXACT
	default:
		return imagingv1.ResizeMode_RESIZE_MODE_FIT
	}
}

func parseImageFormat(s string) imagingv1.ImageFormat {
	switch s {
	case "jpeg", "jpg":
		return imagingv1.ImageFormat_IMAGE_FORMAT_JPEG
	case "png":
		return imagingv1.ImageFormat_IMAGE_FORMAT_PNG
	case "webp":
		return imagingv1.ImageFormat_IMAGE_FORMAT_WEBP
	case "avif":
		return imagingv1.ImageFormat_IMAGE_FORMAT_AVIF
	default:
		return imagingv1.ImageFormat_IMAGE_FORMAT_JPEG
	}
}
