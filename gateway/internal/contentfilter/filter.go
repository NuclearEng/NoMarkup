// Package contentfilter provides pre-post keyword/phrase screening for UGC
// (listings, jobs, chat, reviews). It is a baseline blocklist for App Store
// compliance (ASR-1.2.a, ASR-1.1.3.b, ASR-1.4.3.c, ASR-1.1.4) — not a
// substitute for human moderation or ML classifiers.
//
// Matched terms are intended for structured server logs only; never return
// Matched to clients (it can itself be offensive or aid evasion).
package contentfilter

import (
	"regexp"
	"strings"
	"sync"
	"unicode"
)

// Result is the outcome of CheckUserText.
type Result struct {
	Allowed bool
	// Reason is a stable short code for logs / metrics (never a free-form sentence).
	// Empty when Allowed is true.
	Reason string
	// Matched is the surface term that fired the rule (logs only).
	Matched string
}

// Stable reason codes returned in Result.Reason when Allowed is false.
const (
	ReasonProhibitedWeapons    = "prohibited_weapons"
	ReasonProhibitedSubstances = "prohibited_substances"
	ReasonSexualContent        = "sexual_content"
	ReasonHateOrAbuse          = "hate_or_abuse"
	ReasonEmpty                = "empty"
)

type rule struct {
	// phrase is matched case-insensitively with word-boundary awareness
	// (see matchPhrase). Multi-word phrases require whitespace-normalized
	// adjacency.
	phrase string
	reason string
}

// baselineRules is the v1 App Store / community-guidelines blocklist.
// Keep entries specific enough to avoid common false positives (e.g. bare
// "magazine" is omitted because it collides with publications).
var baselineRules = []rule{
	// ── Firearms / ammo (ASR-1.1.3.b) ─────────────────────────────────
	{phrase: "firearm", reason: ReasonProhibitedWeapons},
	{phrase: "firearms", reason: ReasonProhibitedWeapons},
	{phrase: "handgun", reason: ReasonProhibitedWeapons},
	{phrase: "handguns", reason: ReasonProhibitedWeapons},
	{phrase: "pistol", reason: ReasonProhibitedWeapons},
	{phrase: "pistols", reason: ReasonProhibitedWeapons},
	{phrase: "revolver", reason: ReasonProhibitedWeapons},
	{phrase: "shotgun", reason: ReasonProhibitedWeapons},
	{phrase: "shotguns", reason: ReasonProhibitedWeapons},
	{phrase: "rifle", reason: ReasonProhibitedWeapons},
	{phrase: "rifles", reason: ReasonProhibitedWeapons},
	{phrase: "assault rifle", reason: ReasonProhibitedWeapons},
	{phrase: "assault weapon", reason: ReasonProhibitedWeapons},
	{phrase: "machine gun", reason: ReasonProhibitedWeapons},
	{phrase: "submachine gun", reason: ReasonProhibitedWeapons},
	{phrase: "ammunition", reason: ReasonProhibitedWeapons},
	{phrase: "ammo", reason: ReasonProhibitedWeapons},
	{phrase: "gun for sale", reason: ReasonProhibitedWeapons},
	{phrase: "guns for sale", reason: ReasonProhibitedWeapons},
	{phrase: "ghost gun", reason: ReasonProhibitedWeapons},
	{phrase: "ghost guns", reason: ReasonProhibitedWeapons},
	{phrase: "ar-15", reason: ReasonProhibitedWeapons},
	{phrase: "ar15", reason: ReasonProhibitedWeapons},
	{phrase: "ak-47", reason: ReasonProhibitedWeapons},
	{phrase: "ak47", reason: ReasonProhibitedWeapons},
	{phrase: "glock", reason: ReasonProhibitedWeapons},
	{phrase: "silencer", reason: ReasonProhibitedWeapons},
	{phrase: "suppressor", reason: ReasonProhibitedWeapons},
	{phrase: "high capacity magazine", reason: ReasonProhibitedWeapons},
	{phrase: "gun magazine", reason: ReasonProhibitedWeapons},
	{phrase: "ammo magazine", reason: ReasonProhibitedWeapons},
	// bare "gun"/"guns" — high signal for a marketplace prohibited-item ban
	{phrase: "gun", reason: ReasonProhibitedWeapons},
	{phrase: "guns", reason: ReasonProhibitedWeapons},

	// ── Tobacco / vape (ASR-1.4.3.c) ──────────────────────────────────
	{phrase: "cigarette", reason: ReasonProhibitedSubstances},
	{phrase: "cigarettes", reason: ReasonProhibitedSubstances},
	{phrase: "tobacco", reason: ReasonProhibitedSubstances},
	{phrase: "chewing tobacco", reason: ReasonProhibitedSubstances},
	{phrase: "cigar", reason: ReasonProhibitedSubstances},
	{phrase: "cigars", reason: ReasonProhibitedSubstances},
	{phrase: "vape", reason: ReasonProhibitedSubstances},
	{phrase: "vapes", reason: ReasonProhibitedSubstances},
	{phrase: "vaping", reason: ReasonProhibitedSubstances},
	{phrase: "vape pen", reason: ReasonProhibitedSubstances},
	{phrase: "nicotine", reason: ReasonProhibitedSubstances},
	{phrase: "nicotine pouch", reason: ReasonProhibitedSubstances},
	{phrase: "e-cigarette", reason: ReasonProhibitedSubstances},
	{phrase: "e cigarette", reason: ReasonProhibitedSubstances},
	{phrase: "ecigarette", reason: ReasonProhibitedSubstances},
	{phrase: "juul", reason: ReasonProhibitedSubstances},

	// ── Controlled substances (ASR-1.4.3.c) — not cannabis ────────────
	{phrase: "cocaine", reason: ReasonProhibitedSubstances},
	{phrase: "crack cocaine", reason: ReasonProhibitedSubstances},
	{phrase: "heroin", reason: ReasonProhibitedSubstances},
	{phrase: "methamphetamine", reason: ReasonProhibitedSubstances},
	{phrase: "meth", reason: ReasonProhibitedSubstances},
	{phrase: "fentanyl", reason: ReasonProhibitedSubstances},
	{phrase: "oxycodone", reason: ReasonProhibitedSubstances},
	{phrase: "oxycontin", reason: ReasonProhibitedSubstances},
	{phrase: "mdma", reason: ReasonProhibitedSubstances},
	{phrase: "ecstasy", reason: ReasonProhibitedSubstances},
	{phrase: "lsd", reason: ReasonProhibitedSubstances},
	{phrase: "ketamine", reason: ReasonProhibitedSubstances},
	{phrase: "street drugs", reason: ReasonProhibitedSubstances},

	// ── Sexual / exploitative (ASR-1.1.4 baseline) ────────────────────
	{phrase: "porn", reason: ReasonSexualContent},
	{phrase: "pornography", reason: ReasonSexualContent},
	{phrase: "porno", reason: ReasonSexualContent},
	{phrase: "xxx video", reason: ReasonSexualContent},
	{phrase: "adult video", reason: ReasonSexualContent},
	{phrase: "prostitution", reason: ReasonSexualContent},
	{phrase: "escort service", reason: ReasonSexualContent},
	{phrase: "escort services", reason: ReasonSexualContent},
	{phrase: "sexual services", reason: ReasonSexualContent},
	{phrase: "sex for sale", reason: ReasonSexualContent},
	{phrase: "sex trafficking", reason: ReasonSexualContent},
	{phrase: "child porn", reason: ReasonSexualContent},
	{phrase: "child pornography", reason: ReasonSexualContent},
	{phrase: "csam", reason: ReasonSexualContent},
	{phrase: "underage sex", reason: ReasonSexualContent},
	{phrase: "nude photos for sale", reason: ReasonSexualContent},
	{phrase: "nudes for sale", reason: ReasonSexualContent},

	// ── Extreme hate / abuse (small careful list) ─────────────────────
	// Intentional short list of extreme slurs only — not general profanity.
	{phrase: "nigger", reason: ReasonHateOrAbuse},
	{phrase: "niggers", reason: ReasonHateOrAbuse},
	{phrase: "kike", reason: ReasonHateOrAbuse},
	{phrase: "kikes", reason: ReasonHateOrAbuse},
	{phrase: "spic", reason: ReasonHateOrAbuse},
	{phrase: "spics", reason: ReasonHateOrAbuse},
	{phrase: "chink", reason: ReasonHateOrAbuse},
	{phrase: "chinks", reason: ReasonHateOrAbuse},
	{phrase: "faggot", reason: ReasonHateOrAbuse},
	{phrase: "faggots", reason: ReasonHateOrAbuse},
	{phrase: "tranny", reason: ReasonHateOrAbuse},
	{phrase: "trannies", reason: ReasonHateOrAbuse},
}

var (
	rulesOnce     sync.Once
	compiledRules []compiledRule
)

type compiledRule struct {
	// re matches the phrase with word boundaries where practical.
	re     *regexp.Regexp
	reason string
	// phrase is retained for Matched when the regex itself mangles display.
	phrase string
}

func ensureRules() {
	rulesOnce.Do(func() {
		compiledRules = make([]compiledRule, 0, len(baselineRules))
		for _, r := range baselineRules {
			// Escape metacharacters then allow flexible internal whitespace
			// for multi-word phrases. Word boundaries via (?i)\b...\b.
			escaped := regexp.QuoteMeta(strings.ToLower(strings.TrimSpace(r.phrase)))
			// QuoteMeta leaves spaces as spaces; collapse multi-space in source
			// phrases to \s+ so "e cigarette" matches "e  cigarette".
			parts := strings.Fields(escaped)
			body := strings.Join(parts, `\s+`)
			// Use ASCII word-boundary-ish: not preceded/followed by letter or digit.
			// Standard \b is fine for alphanumeric tokens; hyphenated tokens like
			// ar-15 still work because - is non-word.
			pattern := `(?i)(?:^|[^a-zA-Z0-9])(` + body + `)(?:[^a-zA-Z0-9]|$)`
			re, err := regexp.Compile(pattern)
			if err != nil {
				// Skip broken rules rather than panicking at init — a missing
				// rule is better than taking down the gateway process.
				continue
			}
			compiledRules = append(compiledRules, compiledRule{
				re:     re,
				reason: r.reason,
				phrase: r.phrase,
			})
		}
	})
}

// CheckUserText evaluates free-text UGC for policy violations.
//
// Empty / whitespace-only input is Allowed with no reason (callers enforce
// required fields separately). Non-empty text that matches a blocklist rule
// returns Allowed=false with a stable Reason code.
func CheckUserText(text string) Result {
	trimmed := strings.TrimSpace(text)
	if trimmed == "" {
		return Result{Allowed: true, Reason: "", Matched: ""}
	}

	ensureRules()

	// Normalize for matching: lowercase + collapse internal whitespace runs.
	// Keep original trimmed for Matched extraction via the capture group.
	normalized := normalizeForMatch(trimmed)

	for _, r := range compiledRules {
		if loc := r.re.FindStringSubmatchIndex(normalized); loc != nil && len(loc) >= 4 {
			// Group 1 is the phrase capture.
			start, end := loc[2], loc[3]
			matched := normalized[start:end]
			return Result{
				Allowed: false,
				Reason:  r.reason,
				Matched: matched,
			}
		}
	}
	return Result{Allowed: true}
}

// CheckUserTexts concatenates non-empty fields (title + description etc.)
// and runs a single CheckUserText pass. Prefer this when several fields form
// one user-facing unit of content so multi-field phrase splits still match.
func CheckUserTexts(parts ...string) Result {
	var b strings.Builder
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		if b.Len() > 0 {
			b.WriteByte(' ')
		}
		b.WriteString(p)
	}
	return CheckUserText(b.String())
}

func normalizeForMatch(s string) string {
	// Lowercase + map runs of unicode space to a single ASCII space.
	var b strings.Builder
	b.Grow(len(s))
	prevSpace := false
	for _, r := range strings.ToLower(s) {
		if unicode.IsSpace(r) {
			if !prevSpace {
				b.WriteByte(' ')
				prevSpace = true
			}
			continue
		}
		prevSpace = false
		b.WriteRune(r)
	}
	return strings.TrimSpace(b.String())
}
