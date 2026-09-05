package service

// Trust-tiered search ranking (MOVE B2).
//
// A provider/seller's trust tier becomes a MODEST, explainable ranking signal
// so higher-trust sellers rank higher, ceteris paribus. Two cooperating pieces:
//
//  1. The indexer writes a numeric `trust_rank` attribute on each document
//     (trustRankForTier). It is a small 0..4 integer, NOT a dominant factor —
//     it only breaks ties / nudges, it can't bury a strong text match.
//  2. Meilisearch is configured with `trust_rank:desc` appended AFTER the
//     default relevancy ranking rules, so text relevance always wins first and
//     trust only decides among otherwise-comparable hits.
//
// Everything here is gated by the `trust_ranking` flag (env TRUST_RANKING,
// read once at startup). Flag OFF ⇒ the `trust_rank` attribute is omitted and
// the ranking rule is not added ⇒ ordering is byte-for-byte the legacy order
// (fail closed).
//
// trustRankForTier is a PURE function (no I/O) so it is trivially unit-tested
// and deterministic — the same property every other money/score helper in this
// codebase holds.

// trustRankForTier maps a trust-engine tier string to a small non-negative
// ranking weight. Higher tier ⇒ higher weight ⇒ ranks higher when relevance
// ties. The vocabulary matches the trust engine: new|rising|trusted|top_rated
// (+ under_review). Anything unknown (or under_review) gets the floor, 0, so a
// missing/flagged seller is never boosted.
//
//	top_rated     → 4
//	trusted       → 3
//	rising        → 2
//	new           → 1
//	under_review  → 0
//	unknown / ""  → 0  (fail closed)
func trustRankForTier(tier string) int {
	switch tier {
	case "top_rated":
		return 4
	case "trusted":
		return 3
	case "rising":
		return 2
	case "new":
		return 1
	default:
		// under_review, unspecified, or anything unrecognized: no boost.
		return 0
	}
}
