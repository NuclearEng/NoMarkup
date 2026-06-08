package handler

import (
	"log/slog"
	"net/http"
	"os"
	"strconv"
	"time"

	"github.com/nomarkup/nomarkup/gateway/internal/cache"
	userv1 "github.com/nomarkup/nomarkup/proto/user/v1"
)

const categoryTreeCacheTTL = 1 * time.Hour

// CategoriesHandler handles HTTP endpoints for service categories.
type CategoriesHandler struct {
	userClient userv1.UserServiceClient
	cache      *cache.Client
	// cacheVersion namespaces the Redis tree cache key by release. The category
	// taxonomy only changes via data migrations (no runtime write path), so
	// there is no event to invalidate on. Keying the cache by APP_VERSION means
	// every deploy starts a fresh key — a migration that adds categories is
	// reflected immediately instead of serving stale data for up to the 1h TTL.
	cacheVersion string
}

// NewCategoriesHandler creates a new CategoriesHandler.
func NewCategoriesHandler(userClient userv1.UserServiceClient, cacheClient *cache.Client) *CategoriesHandler {
	version := os.Getenv("APP_VERSION")
	if version == "" {
		version = "dev"
	}
	return &CategoriesHandler{userClient: userClient, cache: cacheClient, cacheVersion: version}
}

// List handles GET /api/v1/categories.
func (h *CategoriesHandler) List(w http.ResponseWriter, r *http.Request) {
	req := &userv1.GetServiceCategoriesRequest{}

	if levelStr := r.URL.Query().Get("level"); levelStr != "" {
		level, err := strconv.Atoi(levelStr)
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid level parameter")
			return
		}
		l := int32(level)
		req.Level = &l
	}

	if parentID := r.URL.Query().Get("parent_id"); parentID != "" {
		req.ParentId = &parentID
	}

	resp, err := h.userClient.GetServiceCategories(r.Context(), req)
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	cats := make([]map[string]interface{}, 0, len(resp.GetCategories()))
	for _, c := range resp.GetCategories() {
		cats = append(cats, protoCategoryToJSON(c))
	}
	// Category taxonomy is admin-managed and near-static → long edge TTL
	// (5m CDN + 1h stale-while-revalidate). Public, no per-user data.
	writeCachedJSON(w, r, http.StatusOK, map[string]interface{}{"categories": cats}, 300, 3600)
}

// Tree handles GET /api/v1/categories/tree.
func (h *CategoriesHandler) Tree(w http.ResponseWriter, r *http.Request) {
	cacheKey := cache.Key("categories", "tree", h.cacheVersion)

	// Try cache first.
	var cached map[string]interface{}
	if h.cache.GetJSON(r.Context(), cacheKey, &cached) {
		slog.Debug("cache hit", "key", cacheKey)
		writeCachedJSON(w, r, http.StatusOK, cached, 300, 3600)
		return
	}

	resp, err := h.userClient.GetCategoryTree(r.Context(), &userv1.GetCategoryTreeRequest{})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	cats := make([]map[string]interface{}, 0, len(resp.GetCategories()))
	for _, c := range resp.GetCategories() {
		cats = append(cats, protoCategoryTreeToJSON(c))
	}
	result := map[string]interface{}{"categories": cats}

	// Store in cache.
	h.cache.SetJSON(r.Context(), cacheKey, result, categoryTreeCacheTTL)
	slog.Debug("cache miss, stored", "key", cacheKey, "ttl", categoryTreeCacheTTL)

	writeCachedJSON(w, r, http.StatusOK, result, 300, 3600)
}

func protoCategoryToJSON(c *userv1.ServiceCategory) map[string]interface{} {
	return map[string]interface{}{
		"id":          c.GetId(),
		"parent_id":   c.GetParentId(),
		"name":        c.GetName(),
		"slug":        c.GetSlug(),
		"level":       c.GetLevel(),
		"description": c.GetDescription(),
		"icon":        c.GetIcon(),
		"sort_order":  c.GetSortOrder(),
		"active":      c.GetActive(),
	}
}

func protoCategoryTreeToJSON(c *userv1.ServiceCategory) map[string]interface{} {
	result := protoCategoryToJSON(c)
	children := make([]map[string]interface{}, 0, len(c.GetChildren()))
	for _, child := range c.GetChildren() {
		children = append(children, protoCategoryTreeToJSON(child))
	}
	result["children"] = children
	return result
}
