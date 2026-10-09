package handler

import "testing"

func TestFilterChannelsByQuery_NamesAndLastMessage(t *testing.T) {
	channels := []map[string]interface{}{
		{
			"id":            "1",
			"customer_name": "Alice Homeowner",
			"provider_name": "Bob Plumbing",
			"last_message": map[string]interface{}{
				"content": "See you Tuesday at 9",
			},
		},
		{
			"id":            "2",
			"customer_name": "Carol",
			"provider_name": "Dave Electric",
			"last_message": map[string]interface{}{
				"content": "Invoice attached",
			},
		},
		{
			"id": "3",
			// no names
			"last_message": map[string]interface{}{
				"content": "Thanks!",
			},
		},
	}

	got := filterChannelsByQuery(channels, "plumbing")
	if len(got) != 1 || got[0]["id"] != "1" {
		t.Fatalf("name match: got %#v", got)
	}

	got = filterChannelsByQuery(channels, "tuesday")
	if len(got) != 1 || got[0]["id"] != "1" {
		t.Fatalf("last message match: got %#v", got)
	}

	got = filterChannelsByQuery(channels, "INVOICE")
	if len(got) != 1 || got[0]["id"] != "2" {
		t.Fatalf("case-insensitive: got %#v", got)
	}

	got = filterChannelsByQuery(channels, "no-such-text")
	if len(got) != 0 {
		t.Fatalf("expected empty, got %#v", got)
	}

	// Empty needle returns all
	got = filterChannelsByQuery(channels, "  ")
	if len(got) != 3 {
		t.Fatalf("empty needle: got %d", len(got))
	}
}

func TestChannelMapMatchesQuery_NilSafe(t *testing.T) {
	if channelMapMatchesQuery(nil, "x") {
		t.Fatal("nil channel should not match")
	}
	if channelMapMatchesQuery(map[string]interface{}{}, "x") {
		t.Fatal("empty channel should not match")
	}
}
