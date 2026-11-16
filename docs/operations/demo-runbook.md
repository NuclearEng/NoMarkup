# NoMarkup — Live Demo Runbook

> Operational doc for running a live VC walkthrough. Pairs with
> `docs/demo-script.md` (narrative). This file is for *running* the
> demo, not selling it.
>
> Before the demo, read this end-to-end. During the demo, only
> Sections 4 and 5 matter — keep this open in a side window.

---

## 1. Pre-Demo Setup (T-60 minutes)

```bash
cd /Users/nuclearisotope/Projects/NoMarkup

# 1. Pull latest
git fetch origin
git status                           # confirm clean tree
git log --oneline -5                 # confirm you're on the demo commit

# 2. Boot infra + apply migrations + load demo seed
make demo-up

# 3. Boot the rest of the stack (separate terminals or screen/tmux)
make dev                             # web app on :3000
# In separate panes:
cd gateway      && go run ./cmd/server
cd services/user    && go run ./cmd/server
cd services/job     && go run ./cmd/server
cd services/payment && go run ./cmd/server
cd services/chat    && go run ./cmd/server
cd engines/bidding  && cargo run --release
cd engines/trust    && cargo run --release

# 4. Verify health
curl -sf http://localhost:8080/api/v1/health
curl -sf http://localhost:3000/marketplace | grep -q "Live Marketplace" && echo OK
```

If `make demo-up` fails, see Section 5: Recovery.

## 2. Pre-Demo Verification (T-30 minutes)

Walk this checklist with the demo open in a browser. Fail fast — if
any of these are off, you have time to fix or rotate to backup.

- [ ] `/marketplace` loads in <2 seconds
- [ ] Header reads "The **Live** Marketplace" with gold "Live"
- [ ] Subtitle present: "Auctions are watched, not posted"
- [ ] UrgencyStrip shows non-zero CLOSING <1H count
- [ ] At least 6 cards visible in the "Closing Now" section with red ribbon
- [ ] At least 8 cards visible in the "Closing Soon" section with gold ribbon
- [ ] Countdown clocks visibly tick (1Hz refresh)
- [ ] No console errors in dev tools
- [ ] No 4xx/5xx in the network panel
- [ ] Login as `customer@nomarkup.com` / `Password123!` works
- [ ] Place a bid on one closing-soon listing — bid succeeds, listing updates

## 3. Backup Demo Environments

In priority order. Switch via `BASE_URL` env var or by changing the
browser tab.

| Environment | URL | When to use |
|-------------|-----|-------------|
| **Local** (primary) | http://localhost:3000 | Default — fastest, fully controlled |
| Staging | [staging URL] | If local can't boot |
| Recorded video | docs/assets/demo-walkthrough.mp4 | If neither local nor staging works |
| Slide-deck fallback | docs/assets/scoreboard-screenshot.png | Internet/projector dies |

Always have at least 2 environments ready.

## 4. During the Demo (cheat sheet)

Keep this visible. The narrative is in `docs/demo-script.md`. This
section is just the keystrokes and recovery moves.

| Time | What you do | Keys / commands |
|------|-------------|-----------------|
| 0:00 | Open `/marketplace` in primary browser | `Cmd+T` then paste URL |
| 0:30 | Scroll to show closing-now ribbons | `Space` or scroll wheel |
| 2:00 | Click into a closing-soon listing | Click the card |
| 2:30 | Place a bid from the second window | Pre-typed amount in form |
| 4:00 | Switch to `/jobs` | Click nav link |
| 5:30 | Open a provider profile to show trust | Click provider name |
| 6:30 | Brief stack tour | Open `/api/v1/health` JSON |
| 7:30 | Close on the ask | Switch to deck or pitch.md |

### Live-bid demo: pre-flight (T-2 min)

In a private window, log in as `provider@nomarkup.com`. Navigate to
the listing you'll demo. Pre-fill the bid amount field with a value
above the current bid. **Don't submit.** When you say "watch the
scoreboard tab," click submit. The bid will propagate in <500ms.

If the WebSocket bid stream isn't shipped yet (audit will tell you):
just refresh the scoreboard tab manually — the audience won't notice.

## 5. Recovery — Common Failure Modes

### 5.1 Docker won't start
```bash
docker compose ps                    # see what's actually up
docker compose logs postgres | tail -50
docker compose down -v && docker compose up -d  # nuke and restart
```
**Mitigation:** rotate to staging URL or recorded video.

### 5.2 Migrations fail
```bash
psql $DATABASE_URL -c "select max(version), dirty from schema_migrations"
# If dirty=t, fix and force version:
migrate -path database/migrations -database "$DATABASE_URL" force <last_clean_version>
make migrate-up
```

### 5.3 Seed didn't load
```bash
psql $DATABASE_URL -c "select count(*) from listings where status='active'"
# Expect ≥40 with demo seed loaded. If <40, re-run:
make seed-demo
```

### 5.4 /marketplace shows "Failed to load auctions"
- Gateway is down: `curl -sf http://localhost:8080/api/v1/health` — restart gateway
- Job service is down: gateway logs will show gRPC connection errors — restart job service
- DB cleared: re-run `make seed-demo`
- Stale Next dev server (production build cached): `pkill -f "next dev" && cd web && bun run dev`

### 5.5 Countdowns frozen
- Browser tab in background: tabs throttle setInterval. Bring tab to foreground.
- React strict-mode double-render confusion: full page refresh.
- System clock skew: `date -u` and confirm within 5 seconds of NTP.

### 5.6 Bid placement fails with 401
- Token expired: log out and back in. Access tokens are 15-minute TTL.
- Cookie blocked: third-party cookies enabled in browser settings.

### 5.7 Bid placement fails with 409 / "outbid"
- Someone else (or you, in another tab) already bid. Refresh and try again.

### 5.8 The audience asks "is the bid real?"
Answer yes — show the dev tools network panel with the POST to
`/api/v1/listings/{id}/bid`, the 200 response, and the bid amount.
That's authentic and removes any "is this a click-through demo" doubt.

## 6. Post-Demo Cleanup

```bash
# Reset the demo state for the next run
make seed-demo                       # re-applies fixed-UUID seed (idempotent)

# Or full clean rebuild
docker compose down -v
make demo-up
```

If the demo created real bids in the dev DB and you want to wipe them:

```bash
psql $DATABASE_URL -c "
  DELETE FROM listing_bids
  WHERE listing_id IN (
    SELECT id FROM listings WHERE id::text LIKE '%9000%'
  )"
make seed-demo                       # re-creates the canonical bid trail
```

## 7. Metrics to Capture During the Demo

If you have time and presence of mind, capture these. Useful in the
follow-up email to the VC.

- Cold-load p95 of `/marketplace` (Network panel, hard reload)
- Bid-to-update latency (Network panel, time from POST to /listings refetch)
- Largest Contentful Paint (Lighthouse run after the demo)
- Number of WebSocket events received during the demo (when shipped)

Record them in `/tmp/demo-metrics-{date}.txt`.

## 8. Two-Person Demo (recommended)

| Role | Watches |
|------|---------|
| Presenter (narrating) | Browser, demo flow, audience |
| Operator (silent) | Logs, terminal, recovery — ready to switch tabs to staging if local breaks |

The operator should have:
- A second browser open to staging
- A terminal showing all service logs in `tail -f` panes
- This runbook open

If the presenter says any of the failure-mode hot phrases ("looks
broken", "loading", "huh", "let me try again") more than twice, the
operator silently switches the projected screen to staging.

## 9. Hard Pause Phrases (presenter)

If something goes wrong during the demo, do NOT say:
- "It's not working"
- "That shouldn't happen"
- "Let me debug this"

Instead, use a pivot:
- "Quick context switch — let me show you the data model behind this..."
- "While that loads — here's the unit-economics math..."
- "Actually, this is a good moment to look at the architecture..."

Pivot to deck slides or `pitch.md` content. Recover the live demo only
if the operator confirms via signal (text/glance) that it's stable.

## 10. Specific VC Likely Questions — Have Tabs Ready

Open these tabs before the demo so you can switch instantly:

1. `docs/investor-faq.md` — for any "what about X" question
2. `docs/marketplace.md` — for architecture deep-dives
3. `docs/operations/scaling-blockers.md` — for "how does this scale?"
4. `docs/operations/marketplace-escrow.md` — for "what about chargebacks?"
5. `docs/operations/abuse-defense.md` — for "what about fraud?"
6. `docs/operations/gdpr-delete.md` — for "what about privacy?"

If you don't have an answer, say so. "I haven't priced that yet — let
me follow up by Friday" beats every form of made-up answer.
