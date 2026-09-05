//go:build evidence

package main

import (
	"context"
	"fmt"
	"os"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/nomarkup/nomarkup/services/user/internal/crypto"
	"github.com/nomarkup/nomarkup/services/user/internal/repository"
)

// Tiny one-shot binary used to capture SQL evidence for the GDPR pipeline.
// Build with -tags=evidence to keep it out of the default service binary.
//
//	go run -tags=evidence ./cmd/gdpr-evidence <user_uuid>

func main() {
	uid := os.Args[1]
	pool, _ := pgxpool.New(context.Background(), "postgresql://nomarkup@localhost:5433/nomarkup?sslmode=disable")
	defer pool.Close()
	cipher, _ := crypto.FromEnv()
	repo := repository.NewPostgresRepository(pool, cipher)

	requestedAt, _ := time.Parse(time.RFC3339, "2026-03-01T00:00:00Z")
	_ = repo.MarkDeletionRequested(context.Background(), uid, "evidence run", requestedAt)
	counts, err := repo.FinalizeAccountDeletion(context.Background(), uid)
	if err != nil {
		fmt.Println("finalize err:", err)
		return
	}
	fmt.Printf("FINALIZE_COUNTS: %+v\n", counts)
}
