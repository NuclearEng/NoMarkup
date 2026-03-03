package handler

import (
	"net/http"
	"strconv"

	userv1 "github.com/nomarkup/nomarkup/proto/user/v1"
)

// CategoriesHandler handles HTTP endpoints for service categories.
type CategoriesHandler struct {
	userClient userv1.UserServiceClient
}

// NewCategoriesHandler creates a new CategoriesHandler.
func NewCategoriesHandler(userClient userv1.UserServiceClient) *CategoriesHandler {
	return &CategoriesHandler{userClient: userClient}
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
	writeJSON(w, http.StatusOK, map[string]interface{}{"categories": cats})
}

// Tree handles GET /api/v1/categories/tree.
func (h *CategoriesHandler) Tree(w http.ResponseWriter, r *http.Request) {
	resp, err := h.userClient.GetCategoryTree(r.Context(), &userv1.GetCategoryTreeRequest{})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	cats := make([]map[string]interface{}, 0, len(resp.GetCategories()))
	for _, c := range resp.GetCategories() {
		cats = append(cats, protoCategoryTreeToJSON(c))
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"categories": cats})
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
