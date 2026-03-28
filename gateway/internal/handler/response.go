package handler

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"regexp"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

var uuidRegex = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

func isValidUUID(s string) bool {
	return uuidRegex.MatchString(s)
}

func writeJSON(w http.ResponseWriter, code int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		slog.Error("failed to encode response", "error", err)
	}
}

func writeError(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}

func decodeJSON(w http.ResponseWriter, r *http.Request, dst interface{}) bool {
	if err := json.NewDecoder(r.Body).Decode(dst); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return false
	}
	return true
}

func writeGRPCError(w http.ResponseWriter, err error) {
	st, ok := status.FromError(err)
	if !ok {
		slog.Error("non-grpc error", "error", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	slog.Warn("grpc call failed",
		"code", st.Code().String(),
		"message", st.Message(),
	)

	switch st.Code() {
	case codes.AlreadyExists:
		writeError(w, http.StatusConflict, st.Message())
	case codes.Unauthenticated:
		writeError(w, http.StatusUnauthorized, st.Message())
	case codes.NotFound:
		writeError(w, http.StatusNotFound, st.Message())
	case codes.PermissionDenied:
		writeError(w, http.StatusForbidden, st.Message())
	case codes.InvalidArgument:
		writeError(w, http.StatusBadRequest, st.Message())
	case codes.FailedPrecondition:
		writeError(w, http.StatusUnprocessableEntity, st.Message())
	case codes.ResourceExhausted:
		writeError(w, http.StatusTooManyRequests, st.Message())
	default:
		writeError(w, http.StatusInternalServerError, "internal error")
	}
}
