package main

import (
	"strings"
	"testing"
)

func TestNPSPromptChannelsExcludePush(t *testing.T) {
	t.Parallel()

	channels := npsPromptChannels()
	sawInApp := false
	for _, ch := range channels {
		if ch == "push" {
			t.Fatalf("nps channels include push: %v", channels)
		}
		if ch == "in_app" {
			sawInApp = true
		}
	}
	if !sawInApp {
		t.Fatalf("nps channels = %v, want in_app", channels)
	}
	if npsPromptTitle == "" || !strings.Contains(npsPromptBody, "recommend NoMarkup to a friend") {
		t.Fatalf("in-app NPS copy changed: %q / %q", npsPromptTitle, npsPromptBody)
	}
}
