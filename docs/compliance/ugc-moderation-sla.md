# UGC moderation SLA

**As of:** 2026-10-03  
**Status:** Runbook only. This does not mean a review queue is staffed today, and it does not mean Apple’s review host is up. `no-markup.com` was NXDOMAIN on 2026-10-03.

Related: [`app-review-notes.md`](./app-review-notes.md)

## Target

While a review host is staffed, take a first look at a new open job report or listing report within 24 hours. That target applies only while someone is actually watching the queue.

## What an actioned report changes

**Job.** An actioned job report sets `jobs.deleted_at`. Jobs have no `is_hidden` column. Public browse keeps a job only when `deleted_at IS NULL` and `status` is `active`.

**Listing.** An actioned listing report sets `listings.is_hidden = true`. The public list, similar listings, and autocomplete each re-check that flag, so a hidden listing does not stay on those surfaces from a stale search hit.

Dismissing or marking a report reviewed does not by itself apply those hides.

## Other reports

Reports also exist for users, chat, and reviews. A chat report is a user report that includes the conversation (`channel_id` and, when present, `message_id`). Reviews are flagged on their own path and resolved from the admin review-flag queue. This page does not set a first-look target for those queues.

## What this file is not

Do not cite this page as evidence that moderators are on duty, that App Review can reach a live host, or that `no-markup.com` resolves.
