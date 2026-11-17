package main

// ── Ordinate pairs: DOUBLE PRECISION lat/lng drained into ciphertext (138) ──
//
// The fourth shape of column. contract_work_sessions (migration 123) stored
// each check-in and check-out point as two plaintext DOUBLE PRECISION columns.
// Those points are geo-fenced to within 500 m of a customer home, so migration
// 138 gave each pair an encrypted sibling holding secretbox("<lat>,<lng>") —
// the jobs.service_location_encrypted wire format — and from 138 the gateway
// writes only the sibling.
//
// This pass drains rows written before that: it seals the pair into the
// sibling and NULLs both ordinates in the SAME UPDATE, the DATE-pair rule of
// migration 106, so a surviving non-NULL ordinate always means "not yet
// processed" — which is exactly what pii_plaintext_audit tests (migration 139).
//
// ── Which value wins ─────────────────────────────────────────────────────
// A present plaintext pair is always the NEWEST value: a 138+ gateway never
// writes it, and clears it on every write, so plaintext beside ciphertext can
// only mean a pre-138 pod refreshed the row after a 138 pod wrote it (during a
// rolling deploy). The plaintext is therefore sealed and REPLACES the sibling.
// Unlike the geometry pass this destroys nothing: the plaintext is the exact
// value, not a rounded one.
//
// ── Live writes ──────────────────────────────────────────────────────────
// The gateway keeps writing while this runs, so every UPDATE is conditional on
// the six columns still holding the values that were scanned. A row changed in
// between is skipped (and logged); a re-run picks it up.

import (
	"context"
	"fmt"
	"log"
)

// ordinatePairSpec is one lat/lng pair and its encrypted sibling.
type ordinatePairSpec struct {
	latCol, lngCol, encCol string
}

// ordinateSpec is a table whose pairs are reconciled together, in one UPDATE
// per row.
//
// selectSQL returns id::text then, per pair, (enc, lat, lng); it takes
// ($1 = keyset cursor, $2 = limit) ordered by id::text.
//
// updateSQL takes $1 = id, then one new enc value per pair, then the scanned
// (enc, lat, lng) of every pair as the optimistic-concurrency guard, and NULLs
// every ordinate.
type ordinateSpec struct {
	name      string
	pairs     []ordinatePairSpec
	selectSQL string
	updateSQL string
}

var ordinateSpecs = []ordinateSpec{
	{
		name: "contract_work_sessions",
		pairs: []ordinatePairSpec{
			{latCol: "check_in_lat", lngCol: "check_in_lng", encCol: "check_in_location_encrypted"},
			{latCol: "check_out_lat", lngCol: "check_out_lng", encCol: "check_out_location_encrypted"},
		},
		selectSQL: `
			SELECT id::text,
			       check_in_location_encrypted, check_in_lat, check_in_lng,
			       check_out_location_encrypted, check_out_lat, check_out_lng
			  FROM contract_work_sessions
			 WHERE id::text > $1
			 ORDER BY id::text
			 LIMIT $2`,
		updateSQL: `
			UPDATE contract_work_sessions
			   SET check_in_location_encrypted  = $2,
			       check_out_location_encrypted = $3,
			       check_in_lat  = NULL,
			       check_in_lng  = NULL,
			       check_out_lat = NULL,
			       check_out_lng = NULL
			 WHERE id::text = $1
			   AND check_in_location_encrypted  IS NOT DISTINCT FROM $4
			   AND check_in_lat                 IS NOT DISTINCT FROM $5
			   AND check_in_lng                 IS NOT DISTINCT FROM $6
			   AND check_out_location_encrypted IS NOT DISTINCT FROM $7
			   AND check_out_lat                IS NOT DISTINCT FROM $8
			   AND check_out_lng                IS NOT DISTINCT FROM $9`,
	},
}

// ordinatePair is one scanned pair.
type ordinatePair struct {
	enc      *string
	lat, lng *float64
}

// ordinateRow is one scanned record, pairs positionally matching the spec.
type ordinateRow struct {
	id    string
	pairs []ordinatePair
}

type ordinateAction int

const (
	ordinateNothing ordinateAction = iota // already drained and current
	ordinateEncrypt                       // plaintext pair sealed into the sibling
	ordinateRekey                         // sibling moved from PREVIOUS to PRIMARY
)

// reconcileOrdinatePair decides one pair WITHOUT touching the database. It
// returns the value to bind for the sibling (the existing one when nothing
// changes) and the action. Every ciphertext it returns has survived
// verifyRoundTrip.
func reconcileOrdinatePair(kr keyring, where string, p ordinatePair) (*string, ordinateAction, error) {
	if p.lat != nil || p.lng != nil {
		if p.lat == nil || p.lng == nil {
			// Writers always set both or neither. Half a point cannot be
			// sealed and must not be silently dropped.
			return p.enc, ordinateNothing, fmt.Errorf("%s: only one ordinate of the pair is set; fix the row by hand", where)
		}
		if p.enc != nil && *p.enc != "" {
			if class, _ := classify(kr, *p.enc); class == classUnknown {
				return p.enc, ordinateNothing, fmt.Errorf("%s: %w", where, errUnknownKey)
			}
		}
		ct, err := sealPoint(kr, formatExactPoint(*p.lat, *p.lng))
		if err != nil {
			return p.enc, ordinateNothing, fmt.Errorf("%s: %w", where, err)
		}
		return &ct, ordinateEncrypt, nil
	}

	cur := ""
	if p.enc != nil {
		cur = *p.enc
	}
	class, plain := classify(kr, cur)
	switch class {
	case classEmpty, classCurrent:
		return p.enc, ordinateNothing, nil
	case classUnknown:
		return p.enc, ordinateNothing, fmt.Errorf("%s: %w", where, errUnknownKey)
	case classRekey:
		if _, _, err := parseExactPoint(plain); err != nil {
			return p.enc, ordinateNothing, fmt.Errorf("%s: re-keyed value does not decrypt to a point: %w", where, err)
		}
		ct, err := sealPoint(kr, plain)
		if err != nil {
			return p.enc, ordinateNothing, fmt.Errorf("%s: %w", where, err)
		}
		return &ct, ordinateRekey, nil
	case classPlaintext:
		// Not our wire format in a column that should hold ciphertext. Only an
		// un-sealed "<lat>,<lng>" literal is legitimate; seal it.
		if _, _, err := parseExactPoint(cur); err != nil {
			return p.enc, ordinateNothing, fmt.Errorf("%s: column holds a non-ciphertext value that is not a point: %w", where, err)
		}
		ct, err := sealPoint(kr, cur)
		if err != nil {
			return p.enc, ordinateNothing, fmt.Errorf("%s: %w", where, err)
		}
		return &ct, ordinateEncrypt, nil
	default:
		return p.enc, ordinateNothing, fmt.Errorf("%s: unhandled value class %d", where, class)
	}
}

func scanOrdinateTable(ctx context.Context, db querier, spec ordinateSpec, visit func(ordinateRow) error) error {
	cursor := ""
	for {
		batch, err := fetchOrdinateBatch(ctx, db, spec, cursor)
		if err != nil {
			return err
		}
		if len(batch) == 0 {
			return nil
		}
		for _, r := range batch {
			if err := visit(r); err != nil {
				return err
			}
		}
		cursor = batch[len(batch)-1].id
	}
}

func fetchOrdinateBatch(ctx context.Context, db querier, spec ordinateSpec, cursor string) ([]ordinateRow, error) {
	rows, err := db.Query(ctx, spec.selectSQL, cursor, batchSize)
	if err != nil {
		return nil, fmt.Errorf("%s ordinates: query batch: %w", spec.name, err)
	}
	defer rows.Close()

	var out []ordinateRow
	for rows.Next() {
		r := ordinateRow{pairs: make([]ordinatePair, len(spec.pairs))}
		dest := make([]any, 0, 1+3*len(spec.pairs))
		dest = append(dest, &r.id)
		for i := range r.pairs {
			dest = append(dest, &r.pairs[i].enc, &r.pairs[i].lat, &r.pairs[i].lng)
		}
		if err := rows.Scan(dest...); err != nil {
			return nil, fmt.Errorf("%s ordinates: scan: %w", spec.name, err)
		}
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("%s ordinates: rows iter: %w", spec.name, err)
	}
	return out, nil
}

// reconcileOrdinateTable runs the write pass for one ordinate spec.
func reconcileOrdinateTable(ctx context.Context, db querier, spec ordinateSpec, kr keyring, dryRun bool) (stats, error) {
	var st stats
	err := scanOrdinateTable(ctx, db, spec, func(r ordinateRow) error {
		st.rowsSeen++
		newEnc := make([]any, len(spec.pairs))
		write := false
		for i, p := range r.pairs {
			where := fmt.Sprintf("%s.%s id=%s", spec.name, spec.pairs[i].encCol, r.id)
			enc, action, err := reconcileOrdinatePair(kr, where, p)
			if err != nil {
				return err
			}
			newEnc[i] = enc
			switch action {
			case ordinateEncrypt:
				st.pointsEncrypted++
				write = true
			case ordinateRekey:
				st.pointsRekeyed++
				write = true
			default:
				st.skipped++
			}
		}
		if !write {
			return nil
		}
		if dryRun {
			log.Printf("DRY %s id=%s would_write=true", spec.name, r.id)
			st.rowsWritten++
			return nil
		}
		args := make([]any, 0, 1+4*len(spec.pairs))
		args = append(args, r.id)
		args = append(args, newEnc...)
		for _, p := range r.pairs {
			args = append(args, p.enc, p.lat, p.lng)
		}
		tag, err := db.Exec(ctx, spec.updateSQL, args...)
		if err != nil {
			return fmt.Errorf("%s ordinates: update id=%s: %w", spec.name, r.id, err)
		}
		if tag.RowsAffected() == 0 {
			log.Printf("WARN %s id=%s changed while being processed (live write); skipped — re-run to drain it", spec.name, r.id)
			return nil
		}
		st.rowsWritten++
		return nil
	})
	if err != nil {
		return st, err
	}
	log.Printf("%s ordinates: rows=%d written=%d points_encrypted=%d points_rekeyed=%d already_current=%d",
		spec.name, st.rowsSeen, st.rowsWritten, st.pointsEncrypted, st.pointsRekeyed, st.skipped)
	return st, nil
}
