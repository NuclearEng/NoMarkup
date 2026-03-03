module github.com/nomarkup/nomarkup/gateway

go 1.22

require (
	github.com/go-chi/chi/v5 v5.1.0
	github.com/go-chi/cors v1.2.1
)

replace github.com/nomarkup/nomarkup/proto => ../proto/gen/go
