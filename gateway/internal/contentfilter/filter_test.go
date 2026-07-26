package contentfilter

import (
	"strings"
	"testing"
)

func TestCheckUserText_Table(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name       string
		text       string
		wantAllow  bool
		wantReason string // only asserted when !wantAllow
	}{
		// ── Allow ────────────────────────────────────────────────────
		{"empty", "", true, ""},
		{"whitespace", "   \n\t  ", true, ""},
		{"benign furniture", "Solid oak dining table, gently used", true, ""},
		{"benign job", "Need a plumber to fix a kitchen sink leak this weekend", true, ""},
		{"magazine publication", "Selling a stack of vintage Time magazines", true, ""},
		{"gunnison false positive guard", "Cabin rental in Gunnison Colorado", true, ""},
		{"methuen place name", "Pickup near Methuen MA only", true, ""},
		{"cannabis not banned v1", "Homegrown cannabis accessories decorative", true, ""},
		{"review praise", "Great communication and on-time work!", true, ""},

		// ── Weapons ──────────────────────────────────────────────────
		{"gun bare", "Selling a gun", false, ReasonProhibitedWeapons},
		{"guns plural", "Two guns available", false, ReasonProhibitedWeapons},
		{"firearm", "Used firearm in good condition", false, ReasonProhibitedWeapons},
		{"ar-15", "AR-15 complete upper", false, ReasonProhibitedWeapons},
		{"ar15 no hyphen", "ar15 for local pickup", false, ReasonProhibitedWeapons},
		{"glock", "Glock 19 gen5", false, ReasonProhibitedWeapons},
		{"ammo", "9mm ammo box unopened", false, ReasonProhibitedWeapons},
		{"ammunition", "ammunition for target practice", false, ReasonProhibitedWeapons},
		{"assault rifle", "assault rifle parts kit", false, ReasonProhibitedWeapons},
		{"case insensitive", "SELLING A HANDGUN TODAY", false, ReasonProhibitedWeapons},
		{"embedded punctuation", "Looking for a (shotgun) trade", false, ReasonProhibitedWeapons},

		// ── Tobacco / vape ───────────────────────────────────────────
		{"cigarettes", "Carton of cigarettes", false, ReasonProhibitedSubstances},
		{"vape", "Disposable vape pens", false, ReasonProhibitedSubstances},
		{"nicotine", "Nicotine pouches bulk", false, ReasonProhibitedSubstances},
		{"chewing tobacco", "Chewing tobacco unopened", false, ReasonProhibitedSubstances},
		{"e-cigarette", "e-cigarette starter kit", false, ReasonProhibitedSubstances},

		// ── Controlled substances ────────────────────────────────────
		{"cocaine", "pure cocaine available", false, ReasonProhibitedSubstances},
		{"heroin", "heroin for sale", false, ReasonProhibitedSubstances},
		{"meth", "crystal meth", false, ReasonProhibitedSubstances},
		{"fentanyl", "fentanyl powder", false, ReasonProhibitedSubstances},
		{"mdma", "MDMA tablets", false, ReasonProhibitedSubstances},

		// ── Sexual ───────────────────────────────────────────────────
		{"porn", "collection of porn DVDs", false, ReasonSexualContent},
		{"prostitution", "prostitution services downtown", false, ReasonSexualContent},
		{"sex trafficking", "sex trafficking ring contacts", false, ReasonSexualContent},
		{"child porn", "child porn links", false, ReasonSexualContent},
		{"escort services", "escort services hourly", false, ReasonSexualContent},

		// ── Hate ─────────────────────────────────────────────────────
		{"extreme slur", "you are a nigger", false, ReasonHateOrAbuse},
		{"slur plural", "kill all faggots", false, ReasonHateOrAbuse},
	}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got := CheckUserText(tc.text)
			if got.Allowed != tc.wantAllow {
				t.Fatalf("Allowed=%v want %v (reason=%q matched=%q text=%q)",
					got.Allowed, tc.wantAllow, got.Reason, got.Matched, tc.text)
			}
			if !tc.wantAllow {
				if got.Reason != tc.wantReason {
					t.Errorf("Reason=%q want %q (matched=%q)", got.Reason, tc.wantReason, got.Matched)
				}
				if strings.TrimSpace(got.Matched) == "" {
					t.Errorf("Matched should be non-empty on deny")
				}
			} else if got.Reason != "" {
				t.Errorf("Reason should be empty on allow, got %q", got.Reason)
			}
		})
	}
}

func TestCheckUserTexts_CombinesFields(t *testing.T) {
	t.Parallel()
	// Phrase split across title + description still matches when joined.
	got := CheckUserTexts("Chewing", "tobacco unopened tin")
	if got.Allowed {
		t.Fatalf("expected deny when phrase spans fields, got allow")
	}
	if got.Reason != ReasonProhibitedSubstances {
		t.Errorf("reason=%q want %s", got.Reason, ReasonProhibitedSubstances)
	}
}

func TestCheckUserText_DoesNotLeakInternalEmptyReasonOnAllow(t *testing.T) {
	t.Parallel()
	// ReasonEmpty is reserved for explicit empty-content policy decisions
	// by callers; the baseline CheckUserText allows empty without that code.
	got := CheckUserText("")
	if !got.Allowed {
		t.Fatal("empty must be allowed at filter layer")
	}
	if got.Reason == ReasonEmpty {
		t.Fatal("filter must not set ReasonEmpty on allow-empty")
	}
}
