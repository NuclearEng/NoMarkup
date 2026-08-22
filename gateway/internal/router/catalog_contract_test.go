package router

import (
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"testing"
	"unicode"
)

// Catalog JSON (generated from docs/workflows/catalog.yaml) must name only
// routes that exist in router.go. A renamed Chi pattern cannot stay green.

type catalogFile struct {
	Workflows []catalogWorkflow `json:"workflows"`
}

type catalogWorkflow struct {
	ID     string `json:"id"`
	Method any    `json:"method"`
	Path   any    `json:"path"`
}

type chiRoute struct {
	Method string
	Path   string
}

func TestCatalogRoutesExistInChi(t *testing.T) {
	t.Parallel()

	_, thisFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller failed")
	}
	dir := filepath.Dir(thisFile)
	catalogPath := filepath.Join(dir, "..", "..", "..", "docs", "workflows", "catalog.json")
	routerPath := filepath.Join(dir, "router.go")

	raw, err := os.ReadFile(catalogPath)
	if err != nil {
		t.Fatalf("read catalog.json: %v", err)
	}
	var catalog catalogFile
	if err := json.Unmarshal(raw, &catalog); err != nil {
		t.Fatalf("parse catalog.json: %v", err)
	}
	if len(catalog.Workflows) < 15 {
		t.Fatalf("catalog.json too small (%d workflows); generate from catalog.yaml", len(catalog.Workflows))
	}

	src, err := os.ReadFile(routerPath)
	if err != nil {
		t.Fatalf("read router.go: %v", err)
	}
	routes := scanChiRoutes(string(src))
	if len(routes) < 50 {
		t.Fatalf("chi scan found too few routes (%d) — parser bug?", len(routes))
	}

	for _, wf := range catalog.Workflows {
		method, _ := wf.Method.(string)
		path, _ := wf.Path.(string)
		if method == "" || path == "" {
			continue
		}
		if !chiHasRoute(routes, method, path) {
			t.Errorf("catalog %s: no Chi %s %s in router.go", wf.ID, strings.ToUpper(method), path)
		}
	}
}

func TestCatalogChiSourceScanNested(t *testing.T) {
	t.Parallel()
	src := `
func New() {
	r.Route("/api/v1", func(r chi.Router) {
		r.Route("/orders", func(r chi.Router) {
			r.With(middleware.RequireIdempotencyKey(cacheClient)).
				Post("/{id}/pay", listingOrdersHandler.PayOrder)
		})
		r.Route("/jobs", func(r chi.Router) {
			r.Post("/", jobHandler.Create)
			r.Post("/{id}/bids", bidHandler.PlaceBid)
		})
		r.Get("/admin/flags", featureFlagHandler.ListFeatureFlags)
	})
	r.Get("/api/v1/listings/mine", listingsHandler.MyListings)
}
`
	routes := scanChiRoutes(src)
	want := []chiRoute{
		{Method: "POST", Path: "/api/v1/orders/{id}/pay"},
		{Method: "POST", Path: "/api/v1/jobs"},
		{Method: "POST", Path: "/api/v1/jobs/{id}/bids"},
		{Method: "GET", Path: "/api/v1/admin/flags"},
		{Method: "GET", Path: "/api/v1/listings/mine"},
	}
	for _, w := range want {
		if !chiHasRoute(routes, w.Method, w.Path) {
			t.Errorf("missing %s %s in %v", w.Method, w.Path, routes)
		}
	}
}

func chiHasRoute(routes []chiRoute, method, catalogPath string) bool {
	wantMethod := strings.ToUpper(method)
	want := normalizeChiPath(catalogPath)
	for _, r := range routes {
		if r.Method != wantMethod {
			continue
		}
		if normalizeChiPath(r.Path) == want {
			return true
		}
	}
	return false
}

var chiParam = regexp.MustCompile(`\{[^}]+\}`)

func normalizeChiPath(p string) string {
	p = strings.TrimSpace(p)
	if p != "/" {
		p = strings.TrimRight(p, "/")
	}
	return chiParam.ReplaceAllString(p, "{}")
}

func scanChiRoutes(src string) []chiRoute {
	src = stripLineComments(src)
	var routes []chiRoute
	var stack []string
	var routeAtDepth []int
	pendingRoute := ""
	depth := 0
	i := 0
	for i < len(src) {
		if src[i] == '"' {
			_, next := readString(src, i)
			i = next
			continue
		}
		if src[i] == '{' {
			depth++
			if pendingRoute != "" {
				stack = append(stack, pendingRoute)
				routeAtDepth = append(routeAtDepth, depth)
				pendingRoute = ""
			}
			i++
			continue
		}
		if src[i] == '}' {
			if len(routeAtDepth) > 0 && routeAtDepth[len(routeAtDepth)-1] == depth {
				stack = stack[:len(stack)-1]
				routeAtDepth = routeAtDepth[:len(routeAtDepth)-1]
			}
			depth--
			i++
			continue
		}

		if ident, next := readIdent(src, i); ident != "" {
			if ident == "Route" && next < len(src) && src[next] == '(' {
				if path, after := readFirstStringArg(src, next); path != "" {
					pendingRoute = path
					i = after
					continue
				}
			}
			if isChiMethod(ident) && next < len(src) && src[next] == '(' {
				if path, after := readFirstStringArg(src, next); path != "" {
					full := joinChi(stack, path)
					routes = append(routes, chiRoute{Method: strings.ToUpper(ident), Path: full})
					i = after
					continue
				}
			}
			i = next
			continue
		}
		i++
	}
	return routes
}

func isChiMethod(ident string) bool {
	switch ident {
	case "Get", "Head", "Post", "Put", "Patch", "Delete", "Options", "Connect", "Trace":
		return true
	default:
		return false
	}
}

func joinChi(stack []string, leaf string) string {
	prefix := strings.Join(stack, "")
	if prefix == "" {
		return leaf
	}
	if leaf == "" || leaf == "/" {
		return strings.TrimRight(prefix, "/")
	}
	return strings.TrimRight(prefix, "/") + "/" + strings.TrimLeft(leaf, "/")
}

func stripLineComments(src string) string {
	var b strings.Builder
	b.Grow(len(src))
	i := 0
	for i < len(src) {
		if src[i] == '"' {
			s, next := readString(src, i)
			b.WriteString(s)
			i = next
			continue
		}
		if src[i] == '/' && i+1 < len(src) && src[i+1] == '/' {
			for i < len(src) && src[i] != '\n' {
				i++
			}
			continue
		}
		b.WriteByte(src[i])
		i++
	}
	return b.String()
}

func readString(src string, i int) (string, int) {
	if i >= len(src) || src[i] != '"' {
		return "", i
	}
	j := i + 1
	for j < len(src) {
		if src[j] == '\\' && j+1 < len(src) {
			j += 2
			continue
		}
		if src[j] == '"' {
			return src[i : j+1], j + 1
		}
		j++
	}
	return src[i:], len(src)
}

func readIdent(src string, i int) (string, int) {
	if i >= len(src) {
		return "", i
	}
	if !unicode.IsLetter(rune(src[i])) && src[i] != '_' {
		return "", i
	}
	j := i + 1
	for j < len(src) && (unicode.IsLetter(rune(src[j])) || unicode.IsDigit(rune(src[j])) || src[j] == '_') {
		j++
	}
	return src[i:j], j
}

func readFirstStringArg(src string, openParen int) (string, int) {
	i := openParen + 1
	for i < len(src) && unicode.IsSpace(rune(src[i])) {
		i++
	}
	if i >= len(src) || src[i] != '"' {
		return "", openParen + 1
	}
	lit, next := readString(src, i)
	if len(lit) < 2 {
		return "", next
	}
	return lit[1 : len(lit)-1], next
}
