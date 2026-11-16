package handler

import (
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// ─────────────────────────────────────────────────────────────────────────────
// Structural CI gate for the §14 public DATA-layer CDN cache.
//
// The runtime guard in publicCacheDenied stops a personalized response from
// being stamped `public, s-maxage` when the gateway resolved a user for the
// request. It cannot see the OTHER way a handler could become personalized:
// parsing the Authorization header (or a cookie, or the client IP) itself on a
// route where the auth middleware never runs, so no claims land in the context.
//
// This test closes that hole at CI time. It parses the handler package, finds
// every function that reaches writeCachedJSON, walks the package-local call
// graph out of it, and fails if any reachable function so much as MENTIONS a
// per-caller input. A cached handler must be a pure function of the URL.
// ─────────────────────────────────────────────────────────────────────────────

// cachedWriterName is the helper whose call sites this gate protects. Pinned as
// a constant so a rename cannot silently disable the gate — the "gate is not
// vacuous" assertion below fails if no call site is found.
const cachedWriterName = "writeCachedJSON"

// bannedHeaders are request headers whose value identifies or segments the
// caller. Reading one inside a publicly-cached response makes the response vary
// by something the CDN does not key on.
var bannedHeaders = map[string]string{
	"authorization":       "carries the caller's bearer token",
	"cookie":              "carries per-caller state",
	"x-device-id":         "segments the caller (experiment bucketing)",
	"x-forwarded-for":     "identifies the caller's network location",
	"x-real-ip":           "identifies the caller's network location",
	"cf-connecting-ip":    "identifies the caller's network location",
	"cf-ipcountry":        "segments the caller by geography",
	"accept-language":     "segments the caller by locale",
	"x-user-id":           "identifies the caller",
	"x-forwarded-user":    "identifies the caller",
	"proxy-authorization": "carries caller credentials",
}

// bannedMiddlewareSymbols are identity/segmentation accessors exported by the
// middleware package.
var bannedMiddlewareSymbols = map[string]string{
	"GetClaims":            "reads the authenticated caller's claims",
	"Claims":               "references the authenticated caller's claims",
	"ClaimsContextKey":     "reaches into the claims context slot directly",
	"GetExperiment":        "reads a per-caller experiment bucket",
	"ExperimentAssignment": "references a per-caller experiment bucket",
	"WithExperiment":       "installs per-caller experiment bucketing",
}

// bannedSelectors are method/field names that yield per-caller input regardless
// of the receiver they hang off.
var bannedSelectors = map[string]string{
	"ValidateToken": "validates a caller-supplied JWT",
	"Cookie":        "reads a request cookie",
	"RemoteAddr":    "reads the caller's address",
}

// bannedLocalFuncs are package-local helpers that derive from the caller.
var bannedLocalFuncs = map[string]string{
	"remoteIP": "derives the caller's IP",
	"hashIP":   "derives from the caller's IP",
}

type funcKey struct {
	recv string // receiver type name; "" for a package-level func
	name string
}

func (k funcKey) String() string {
	if k.recv == "" {
		return k.name
	}
	return k.recv + "." + k.name
}

type guardViolation struct {
	pos   string
	chain []funcKey
	expr  string
	why   string
}

func (v guardViolation) String() string {
	parts := make([]string, 0, len(v.chain))
	for _, k := range v.chain {
		parts = append(parts, k.String())
	}
	return fmt.Sprintf("%s: %s — %s (reached via %s)",
		v.pos, v.expr, v.why, strings.Join(parts, " -> "))
}

// parsedPackage is the AST view the gate analyses.
type parsedPackage struct {
	fset  *token.FileSet
	files []*ast.File
}

// parseHandlerPackage parses every non-test .go file in the handler package.
func parseHandlerPackage(t *testing.T) parsedPackage {
	t.Helper()

	entries, err := os.ReadDir(".")
	require.NoError(t, err, "read handler package dir")

	fset := token.NewFileSet()
	files := make([]*ast.File, 0, len(entries))
	for _, e := range entries {
		name := e.Name()
		if e.IsDir() || !strings.HasSuffix(name, ".go") || strings.HasSuffix(name, "_test.go") {
			continue
		}
		f, err := parser.ParseFile(fset, filepath.Join(".", name), nil, parser.SkipObjectResolution)
		require.NoErrorf(t, err, "parse %s", name)
		files = append(files, f)
	}
	require.NotEmpty(t, files, "handler package has no source files")

	return parsedPackage{fset: fset, files: files}
}

// receiverTypeName returns the (possibly pointer-dereferenced) receiver type
// name and the receiver variable name for a method, or "", "" for a func.
func receiverTypeName(fd *ast.FuncDecl) (typeName, varName string) {
	if fd.Recv == nil || len(fd.Recv.List) == 0 {
		return "", ""
	}
	field := fd.Recv.List[0]
	if len(field.Names) > 0 {
		varName = field.Names[0].Name
	}
	expr := field.Type
	if star, ok := expr.(*ast.StarExpr); ok {
		expr = star.X
	}
	if ident, ok := expr.(*ast.Ident); ok {
		typeName = ident.Name
	}
	return typeName, varName
}

// indexFuncs maps every declared func/method to its declaration.
func (p parsedPackage) indexFuncs() map[funcKey]*ast.FuncDecl {
	index := make(map[funcKey]*ast.FuncDecl)
	for _, f := range p.files {
		for _, decl := range f.Decls {
			fd, ok := decl.(*ast.FuncDecl)
			if !ok || fd.Body == nil {
				continue
			}
			recv, _ := receiverTypeName(fd)
			index[funcKey{recv: recv, name: fd.Name.Name}] = fd
		}
	}
	return index
}

// callsIdent reports whether the body contains a direct call to the named
// package-level function.
func callsIdent(fd *ast.FuncDecl, name string) bool {
	found := false
	ast.Inspect(fd.Body, func(n ast.Node) bool {
		call, ok := n.(*ast.CallExpr)
		if !ok {
			return true
		}
		if ident, ok := call.Fun.(*ast.Ident); ok && ident.Name == name {
			found = true
			return false
		}
		return true
	})
	return found
}

// isHTTPHandlerShaped reports whether fd has the `(http.ResponseWriter,
// *http.Request)` signature with no results — i.e. it is itself a route handler.
func isHTTPHandlerShaped(fd *ast.FuncDecl) bool {
	ft := fd.Type
	if ft.Results != nil && len(ft.Results.List) > 0 {
		return false
	}
	if ft.Params == nil || len(ft.Params.List) != 2 {
		return false
	}
	name := func(e ast.Expr) string {
		if star, ok := e.(*ast.StarExpr); ok {
			e = star.X
		}
		sel, ok := e.(*ast.SelectorExpr)
		if !ok {
			return ""
		}
		return sel.Sel.Name
	}
	return name(ft.Params.List[0].Type) == "ResponseWriter" &&
		name(ft.Params.List[1].Type) == "Request"
}

// localCallees returns the package-local functions this declaration calls.
// Resolution is lexical, not type-checked: a plain `foo(...)` resolves to the
// package-level `foo`, and `h.foo(...)` where `h` is this method's receiver
// resolves to a method on the same type. Calls through any other value (a
// repository field, an interface) are not followed — see the documented limits
// on TestCachedHandlersAreNotPersonalized.
//
// Two edges are deliberately NOT followed:
//
//   - writeCachedJSON itself. It is the sink under audit, not part of any
//     handler's payload computation, and its own runtime guard legitimately
//     reads the caller's claims to decide the cache policy.
//   - a callee that is itself an http handler. A cached handler that delegates
//     to another handler (chi route collisions such as /listings/{id} vs
//     /listings/mine do this) is handing the response over wholesale; the callee
//     writes its own body. If that callee writes a cacheable response it is
//     enumerated as a seed in its own right, so nothing goes unaudited.
func localCallees(fd *ast.FuncDecl, index map[funcKey]*ast.FuncDecl) []funcKey {
	recvType, recvVar := receiverTypeName(fd)
	seen := make(map[funcKey]struct{})
	out := make([]funcKey, 0, 8)

	add := func(k funcKey) {
		callee, ok := index[k]
		if !ok {
			return
		}
		if k.recv == "" && k.name == cachedWriterName {
			return
		}
		if isHTTPHandlerShaped(callee) {
			return
		}
		if _, dup := seen[k]; dup {
			return
		}
		seen[k] = struct{}{}
		out = append(out, k)
	}

	ast.Inspect(fd.Body, func(n ast.Node) bool {
		call, ok := n.(*ast.CallExpr)
		if !ok {
			return true
		}
		switch fun := call.Fun.(type) {
		case *ast.Ident:
			add(funcKey{name: fun.Name})
		case *ast.SelectorExpr:
			if x, ok := fun.X.(*ast.Ident); ok && recvVar != "" && x.Name == recvVar {
				add(funcKey{recv: recvType, name: fun.Sel.Name})
			}
		}
		return true
	})
	return out
}

// stringLit returns the unquoted value of a string literal expression.
func stringLit(e ast.Expr) (string, bool) {
	lit, ok := e.(*ast.BasicLit)
	if !ok || lit.Kind != token.STRING {
		return "", false
	}
	s, err := strconv.Unquote(lit.Value)
	if err != nil {
		return "", false
	}
	return s, true
}

// isHeaderAccess reports whether expr is `<something>.Header`.
func isHeaderAccess(e ast.Expr) bool {
	sel, ok := e.(*ast.SelectorExpr)
	return ok && sel.Sel.Name == "Header"
}

// scanIdentityReads finds every per-caller input referenced in fd's body.
func scanIdentityReads(fset *token.FileSet, fd *ast.FuncDecl) []guardViolation {
	var found []guardViolation
	report := func(n ast.Node, expr, why string) {
		found = append(found, guardViolation{
			pos:  fset.Position(n.Pos()).String(),
			expr: expr,
			why:  why,
		})
	}

	ast.Inspect(fd.Body, func(n ast.Node) bool {
		switch node := n.(type) {
		case *ast.CallExpr:
			// remoteIP(...) / hashIP(...)
			if ident, ok := node.Fun.(*ast.Ident); ok {
				if why, bad := bannedLocalFuncs[ident.Name]; bad {
					report(node, ident.Name+"(...)", why)
				}
				return true
			}
			sel, ok := node.Fun.(*ast.SelectorExpr)
			if !ok {
				return true
			}
			// r.Header.Get("Authorization")
			if sel.Sel.Name == "Get" && isHeaderAccess(sel.X) && len(node.Args) == 1 {
				if name, ok := stringLit(node.Args[0]); ok {
					if why, bad := bannedHeaders[strings.ToLower(name)]; bad {
						report(node, `Header.Get("`+name+`")`, why)
					}
				}
			}
		case *ast.IndexExpr:
			// r.Header["Authorization"]
			if isHeaderAccess(node.X) {
				if name, ok := stringLit(node.Index); ok {
					if why, bad := bannedHeaders[strings.ToLower(name)]; bad {
						report(node, `Header["`+name+`"]`, why)
					}
				}
			}
		case *ast.SelectorExpr:
			if x, ok := node.X.(*ast.Ident); ok && x.Name == "middleware" {
				if why, bad := bannedMiddlewareSymbols[node.Sel.Name]; bad {
					report(node, "middleware."+node.Sel.Name, why)
					return true
				}
			}
			if why, bad := bannedSelectors[node.Sel.Name]; bad {
				report(node, "."+node.Sel.Name, why)
			}
		}
		return true
	})
	return found
}

// auditCachedWriters is the gate itself: seed at every function that reaches
// writeCachedJSON, walk the package-local call graph, and collect every
// per-caller input found along the way.
func auditCachedWriters(p parsedPackage) (seeds []funcKey, violations []guardViolation) {
	index := p.indexFuncs()

	for key, fd := range index {
		if callsIdent(fd, cachedWriterName) {
			seeds = append(seeds, key)
		}
	}
	sort.Slice(seeds, func(i, j int) bool { return seeds[i].String() < seeds[j].String() })

	for _, seed := range seeds {
		visited := map[funcKey]struct{}{seed: {}}
		type step struct {
			key   funcKey
			chain []funcKey
		}
		queue := []step{{key: seed, chain: []funcKey{seed}}}

		for len(queue) > 0 {
			cur := queue[0]
			queue = queue[1:]
			fd := index[cur.key]

			for _, v := range scanIdentityReads(p.fset, fd) {
				v.chain = cur.chain
				violations = append(violations, v)
			}

			for _, callee := range localCallees(fd, index) {
				if _, seen := visited[callee]; seen {
					continue
				}
				visited[callee] = struct{}{}
				chain := make([]funcKey, len(cur.chain), len(cur.chain)+1)
				copy(chain, cur.chain)
				queue = append(queue, step{key: callee, chain: append(chain, callee)})
			}
		}
	}
	return seeds, violations
}

// TestCachedHandlersAreNotPersonalized is the structural control this whole
// mechanism rests on. It FAILS if any handler that writes a publicly-cacheable
// response — or any package-local helper it calls — reads the caller's identity,
// credentials, IP, locale, or experiment bucket.
//
// Why this and not a runtime check alone: on a public route the auth middleware
// never runs, so no claims exist for publicCacheDenied to see. A handler that
// parsed the Authorization header itself would be invisible at runtime and
// perfectly visible here.
//
// Honest limits — this gate does NOT catch:
//   - identity read inside a function in ANOTHER package that a cached handler
//     calls (no type-checked cross-package call graph here);
//   - identity read through a value that is not the method receiver, e.g.
//     h.someRepo.LookupCaller(r) — the call graph walk stops at the field;
//   - a downstream gRPC service personalizing its own response;
//   - a response that is public but wrong (see the CDN-rule note in the report):
//     it prevents a per-user body from being STORED publicly, not a public body
//     from being SERVED to a signed-in caller.
func TestCachedHandlersAreNotPersonalized(t *testing.T) {
	t.Parallel()

	pkg := parseHandlerPackage(t)
	seeds, violations := auditCachedWriters(pkg)

	// The gate must not be vacuous: if writeCachedJSON is renamed or every call
	// site disappears, fail rather than pass silently.
	require.NotEmptyf(t, seeds,
		"no %s call sites found — the cache guard is not analysing anything", cachedWriterName)
	t.Logf("audited %d handlers that write publicly-cacheable responses", len(seeds))

	if len(violations) > 0 {
		msgs := make([]string, 0, len(violations))
		for _, v := range violations {
			msgs = append(msgs, "  "+v.String())
		}
		sort.Strings(msgs)
		t.Fatalf(
			"a publicly-cacheable handler reads per-caller input.\n"+
				"At a CDN that means one caller's response is served to everyone.\n"+
				"Either drop the personalization, or switch the handler to writeJSON "+
				"and mount it inside the authenticated subtree.\n\n%s",
			strings.Join(msgs, "\n"),
		)
	}
}

// TestCacheGuardDetectsPersonalization proves the gate above is not passing by
// accident. It runs the same analysis over synthetic sources that make each
// realistic personalization mistake and asserts every one is caught.
func TestCacheGuardDetectsPersonalization(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name     string
		src      string
		wantExpr string
	}{
		{
			name: "handler reads resolved claims directly",
			src: `package handler
func (h *X) GetThing(w http.ResponseWriter, r *http.Request) {
	out := map[string]any{"id": 1}
	if claims, ok := middleware.GetClaims(r.Context()); ok {
		out["is_following"] = claims.UserID
	}
	writeCachedJSON(w, r, 200, out, 60, 300)
}`,
			wantExpr: "middleware.GetClaims",
		},
		{
			name: "handler parses the bearer token itself",
			src: `package handler
func (h *X) GetThing(w http.ResponseWriter, r *http.Request) {
	tok := r.Header.Get("Authorization")
	writeCachedJSON(w, r, 200, tok, 60, 300)
}`,
			wantExpr: `Header.Get("Authorization")`,
		},
		{
			name: "handler validates a token via the auth middleware",
			src: `package handler
func (h *X) GetThing(w http.ResponseWriter, r *http.Request) {
	c, _ := h.authMW.ValidateToken("t")
	writeCachedJSON(w, r, 200, c, 60, 300)
}`,
			wantExpr: ".ValidateToken",
		},
		{
			name: "handler reads a cookie",
			src: `package handler
func (h *X) GetThing(w http.ResponseWriter, r *http.Request) {
	c, _ := r.Cookie("refresh_token")
	writeCachedJSON(w, r, 200, c, 60, 300)
}`,
			wantExpr: ".Cookie",
		},
		{
			name: "handler segments by client IP",
			src: `package handler
func (h *X) GetThing(w http.ResponseWriter, r *http.Request) {
	writeCachedJSON(w, r, 200, remoteIP(r), 60, 300)
}`,
			wantExpr: "remoteIP(...)",
		},
		{
			name: "handler segments by locale",
			src: `package handler
func (h *X) GetThing(w http.ResponseWriter, r *http.Request) {
	writeCachedJSON(w, r, 200, r.Header.Get("Accept-Language"), 60, 300)
}`,
			wantExpr: `Header.Get("Accept-Language")`,
		},
		{
			name: "handler reads an experiment bucket",
			src: `package handler
func (h *X) GetThing(w http.ResponseWriter, r *http.Request) {
	v, _ := middleware.GetExperiment(r.Context(), "ranking")
	writeCachedJSON(w, r, 200, v, 60, 300)
}`,
			wantExpr: "middleware.GetExperiment",
		},
		{
			name: "personalization hides one hop away in a same-type helper",
			src: `package handler
func (h *X) GetThing(w http.ResponseWriter, r *http.Request) {
	writeCachedJSON(w, r, 200, h.decorate(r), 60, 300)
}
func (h *X) decorate(r *http.Request) any {
	claims, _ := middleware.GetClaims(r.Context())
	return claims
}`,
			wantExpr: "middleware.GetClaims",
		},
		{
			name: "personalization hides in a package-level helper",
			src: `package handler
func (h *X) GetThing(w http.ResponseWriter, r *http.Request) {
	writeCachedJSON(w, r, 200, decorateThing(r), 60, 300)
}
func decorateThing(r *http.Request) any {
	return r.Header.Get("X-Device-ID")
}`,
			wantExpr: `Header.Get("X-Device-ID")`,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			fset := token.NewFileSet()
			f, err := parser.ParseFile(fset, "synthetic.go", tc.src, parser.SkipObjectResolution)
			require.NoError(t, err)

			seeds, violations := auditCachedWriters(parsedPackage{fset: fset, files: []*ast.File{f}})
			require.NotEmpty(t, seeds, "synthetic source must contain a cached writer")
			require.NotEmpty(t, violations, "gate failed to detect the personalization")

			exprs := make([]string, 0, len(violations))
			for _, v := range violations {
				exprs = append(exprs, v.expr)
			}
			assert.Contains(t, exprs, tc.wantExpr)
		})
	}
}

// TestCacheGuardAcceptsPublicHandlers guards the gate against over-firing: a
// handler that keys only off the URL must pass cleanly, or the gate becomes
// noise that gets disabled.
func TestCacheGuardAcceptsPublicHandlers(t *testing.T) {
	t.Parallel()

	src := `package handler
func (h *X) GetThing(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	page := r.URL.Query().Get("page")
	if !isValidUUID(id) {
		writeError(w, 400, "invalid id")
		return
	}
	writeCachedJSON(w, r, 200, h.load(r.Context(), id, page), 60, 300)
}
func (h *X) load(ctx context.Context, id, page string) any { return nil }`

	fset := token.NewFileSet()
	f, err := parser.ParseFile(fset, "synthetic.go", src, parser.SkipObjectResolution)
	require.NoError(t, err)

	seeds, violations := auditCachedWriters(parsedPackage{fset: fset, files: []*ast.File{f}})
	require.Len(t, seeds, 1)
	assert.Empty(t, violations)
}
