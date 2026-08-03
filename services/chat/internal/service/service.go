package service

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"regexp"
	"strings"
	"time"

	"github.com/nomarkup/nomarkup/services/chat/internal/domain"
)

// Service implements chat business logic.
type Service struct {
	repo       domain.ChannelRepository
	pubsub     *PubSub
	bidChecker domain.BidChecker
	// relay rewrites contact info in cold-open messages so the sender's
	// real email/phone never leak before the recipient has replied. Set
	// via SetRelay; nil means "rewrite disabled" (dev-mode default).
	relay AliasLookup
	// termsBinder binds accepted local terms onto contracts.payment_timing /
	// terms_json when a live contract exists for the channel job (FR-5.4).
	// Nil = consent-only path (tests / degraded).
	termsBinder LocalTermsBinder
}

// New creates a new chat service.
func New(repo domain.ChannelRepository, pubsub *PubSub) *Service {
	return &Service{repo: repo, pubsub: pubsub}
}

// SetBidChecker sets the bid checker for chat access validation.
func (s *Service) SetBidChecker(bc domain.BidChecker) {
	s.bidChecker = bc
}

// SetLocalTermsBinder wires FR-5.4 contract override application on Accept.
func (s *Service) SetLocalTermsBinder(b LocalTermsBinder) {
	s.termsBinder = b
}

// normalizeChannelType maps wire/proto aliases onto DB CHECK values
// (inquiry | bid | contract). Proto "pre_award" and legacy empty → "bid".
func normalizeChannelType(channelType string) string {
	switch strings.TrimSpace(strings.ToLower(channelType)) {
	case "", "pre_award":
		return "bid"
	case "inquiry":
		return "inquiry"
	case "contract":
		return "contract"
	case "bid":
		return "bid"
	case "support":
		// No support table value; store as contract-scoped support chat under contract.
		return "contract"
	default:
		return "bid"
	}
}

// CreateChannel validates inputs, enforces chat access rules (FR-8.1),
// and creates a new channel.
//
// Access rules (FR-8.1):
//   - channel_type "inquiry" — pre-bid Q&A; no active bid required
//   - channel_type "bid" / "pre_award" — post-bid chat; requires active bid
//   - channel_type "contract" — post-award; no bid check here (callers award-path)
func (s *Service) CreateChannel(ctx context.Context, jobID, customerID, providerID, channelType string) (*domain.Channel, error) {
	if jobID == "" {
		return nil, fmt.Errorf("create channel: job_id is required")
	}
	if customerID == "" {
		return nil, fmt.Errorf("create channel: customer_id is required")
	}
	if providerID == "" {
		return nil, fmt.Errorf("create channel: provider_id is required")
	}
	channelType = normalizeChannelType(channelType)

	// FR-8.1: post-bid ("bid") requires an active bid. Inquiry is the
	// intentional pre-bid exception. Fail closed when the bid checker is missing
	// for bid channels — a nil checker must never open post-bid chat.
	if channelType == "bid" {
		if s.bidChecker == nil {
			slog.Error("bid checker is not configured; refusing bid chat access",
				"job_id", jobID,
				"provider_id", providerID,
			)
			return nil, fmt.Errorf("create channel: bid verification unavailable")
		}
		hasBid, err := s.bidChecker.HasActiveBid(ctx, jobID, providerID)
		if err != nil {
			slog.Error("failed to check bid status for chat access",
				"job_id", jobID,
				"provider_id", providerID,
				"error", err,
			)
			return nil, fmt.Errorf("create channel: bid verification unavailable: %w", err)
		}
		if !hasBid {
			return nil, fmt.Errorf("create channel: %w", domain.ErrNoBidForChat)
		}
	}

	ch := &domain.Channel{
		JobID:       jobID,
		CustomerID:  customerID,
		ProviderID:  providerID,
		ChannelType: channelType,
		Status:      "active",
	}

	return s.repo.CreateChannel(ctx, ch)
}

// ShareContactInfo posts an explicit contact_share message after the caller
// confirms. FR-8.8 — opt-in only; does not relax auto contact detection on text.
func (s *Service) ShareContactInfo(ctx context.Context, channelID, userID, phone, email string) (*domain.SharedContact, error) {
	ch, err := s.repo.GetChannel(ctx, channelID, userID)
	if err != nil {
		return nil, err
	}
	if ch.CustomerID != userID && ch.ProviderID != userID {
		return nil, fmt.Errorf("share contact: %w", domain.ErrNotChannelMember)
	}
	if ch.Status == "closed" || ch.Status == "read_only" {
		return nil, fmt.Errorf("share contact: %w", domain.ErrChannelClosed)
	}

	phone = strings.TrimSpace(phone)
	email = strings.TrimSpace(email)
	if phone == "" && email == "" {
		return nil, fmt.Errorf("share contact: phone or email is required")
	}

	// Persist as a structured contact_share message (content is display text;
	// clients already decode message_type=contact_share).
	var parts []string
	if phone != "" {
		parts = append(parts, "Phone: "+phone)
	}
	if email != "" {
		parts = append(parts, "Email: "+email)
	}
	content := "Contact shared\n" + strings.Join(parts, "\n")

	msg := &domain.Message{
		ChannelID:   channelID,
		SenderID:    userID,
		MessageType: domain.MessageTypeContactShare,
		Content:     content,
	}
	if _, err := s.repo.SendMessage(ctx, msg); err != nil {
		return nil, fmt.Errorf("share contact: %w", err)
	}

	return &domain.SharedContact{
		UserID:   userID,
		Phone:    phone,
		Email:    email,
		SharedAt: time.Now().UTC(),
	}, nil
}

// GetChannel validates user membership and returns a channel.
func (s *Service) GetChannel(ctx context.Context, channelID string, userID string) (*domain.Channel, error) {
	ch, err := s.repo.GetChannel(ctx, channelID, userID)
	if err != nil {
		return nil, err
	}

	if ch.CustomerID != userID && ch.ProviderID != userID {
		return nil, fmt.Errorf("get channel: %w", domain.ErrNotChannelMember)
	}

	return ch, nil
}

// IsChannelMember reports whether the user is a participant (customer or
// provider) of the channel. Used by the WebSocket subscribe path to authorize
// a live subscription before streaming any messages.
func (s *Service) IsChannelMember(ctx context.Context, channelID, userID string) (bool, error) {
	return s.repo.IsChannelMember(ctx, channelID, userID)
}

// IsJobParticipant reports whether the user is a party to the job (owner or
// bidder). Used by the live-auction WebSocket subscribe path to authorize
// access to the privileged real-time bid feed.
func (s *Service) IsJobParticipant(ctx context.Context, jobID, userID string) (bool, error) {
	return s.repo.IsJobParticipant(ctx, jobID, userID)
}

// ListChannels returns paginated channels for a user.
func (s *Service) ListChannels(ctx context.Context, userID string, page, pageSize int) ([]*domain.Channel, int, error) {
	return s.repo.ListChannels(ctx, userID, page, pageSize)
}

// SendMessage validates the sender is a channel member, detects contact info,
// persists the message, publishes to Redis pub/sub, and returns the message.
func (s *Service) SendMessage(ctx context.Context, channelID, senderID, messageType, content string) (*domain.Message, error) {
	// Validate channel access and status.
	ch, err := s.repo.GetChannel(ctx, channelID, senderID)
	if err != nil {
		return nil, err
	}

	if ch.CustomerID != senderID && ch.ProviderID != senderID {
		return nil, fmt.Errorf("send message: %w", domain.ErrNotChannelMember)
	}

	if ch.Status == "closed" || ch.Status == "read_only" {
		return nil, fmt.Errorf("send message: %w", domain.ErrChannelClosed)
	}

	if strings.TrimSpace(content) == "" && messageType == "text" {
		return nil, fmt.Errorf("send message: %w", domain.ErrEmptyMessage)
	}

	if messageType == "" {
		messageType = "text"
	}

	flagged := DetectContactInfo(content)

	// Cold-open relay rewrite: if the recipient hasn't replied yet, swap
	// real email/phone for the alias values. No-op when s.relay is nil.
	rewritten := content
	if flagged && s.relay != nil {
		recipientID := ch.CustomerID
		if senderID == ch.CustomerID {
			recipientID = ch.ProviderID
		}
		rewritten = maybeRewriteForRelay(ctx, s.relay, channelID, recipientID, content)
	}

	msg := &domain.Message{
		ChannelID:          channelID,
		SenderID:           senderID,
		MessageType:        messageType,
		Content:            rewritten,
		FlaggedContactInfo: flagged,
	}

	result, err := s.repo.SendMessage(ctx, msg)
	if err != nil {
		return nil, err
	}

	// Publish to Redis for real-time delivery (best effort).
	if s.pubsub != nil {
		if err := s.pubsub.Publish(ctx, channelID, *result); err != nil {
			slog.Error("failed to publish message to pubsub",
				"channel_id", channelID,
				"message_id", result.ID,
				"error", err,
			)
		}
	}

	return result, nil
}

// ListMessages validates user membership and returns paginated messages.
// query is an optional FR-8.6 content filter (case-insensitive substring);
// empty means no filter.
func (s *Service) ListMessages(ctx context.Context, channelID, userID string, before *time.Time, pageSize int, query string) ([]*domain.Message, error) {
	ch, err := s.repo.GetChannel(ctx, channelID, userID)
	if err != nil {
		return nil, err
	}

	if ch.CustomerID != userID && ch.ProviderID != userID {
		return nil, fmt.Errorf("list messages: %w", domain.ErrNotChannelMember)
	}

	return s.repo.ListMessages(ctx, channelID, before, pageSize, query)
}

// MarkRead validates user membership and marks messages as read.
// On success, publishes a live read_receipt so the peer can flip Sent → Seen
// without waiting for a REST poll (FR-8 receipts polish).
func (s *Service) MarkRead(ctx context.Context, channelID, userID string) error {
	if err := s.repo.MarkRead(ctx, channelID, userID); err != nil {
		return err
	}
	if s.pubsub == nil {
		return nil
	}
	// Repo stamps now(); publish the same wall-clock so peer watermark compares work.
	lastReadAt := time.Now().UTC().Format(time.RFC3339Nano)
	if err := s.pubsub.PublishReadReceipt(ctx, channelID, userID, lastReadAt); err != nil {
		// Fail-soft: durable MarkRead already succeeded; peer falls back to poll.
		slog.ErrorContext(ctx, "failed to publish read_receipt after MarkRead",
			"channel_id", channelID,
			"user_id", userID,
			"error", err,
		)
	}
	return nil
}

// GetUnreadCounts returns unread message counts per channel for a user.
func (s *Service) GetUnreadCounts(ctx context.Context, userID string) ([]domain.ChannelUnread, error) {
	return s.repo.GetUnreadCounts(ctx, userID)
}

// SendTypingIndicator publishes a typing indicator via Redis pub/sub.
// SEC-10: the caller must be a channel member — otherwise any authenticated
// user could spam typing events into conversations they are not part of.
func (s *Service) SendTypingIndicator(ctx context.Context, channelID, userID string) error {
	ok, err := s.repo.IsChannelMember(ctx, channelID, userID)
	if err != nil {
		return fmt.Errorf("send typing: %w", err)
	}
	if !ok {
		return fmt.Errorf("send typing: %w", domain.ErrNotChannelMember)
	}
	if s.pubsub == nil {
		return nil
	}
	return s.pubsub.PublishTyping(ctx, channelID, userID)
}

// Contact info detection patterns (FR-8.8).
var (
	phoneRegex = regexp.MustCompile(
		`(?:(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})`,
	)
	emailRegex = regexp.MustCompile(
		`\b[\w.+-]+@[\w.-]+\.\w{2,}\b`,
	)
	socialHandleRegex = regexp.MustCompile(
		`(?i)(?:^|[\s(])@[a-zA-Z0-9_.]{2,30}\b`,
	)
)

// DetectContactInfo checks if the content contains phone numbers, email addresses,
// or social media handles that could facilitate off-platform communication.
func DetectContactInfo(content string) bool {
	if phoneRegex.MatchString(content) {
		return true
	}
	if emailRegex.MatchString(content) {
		return true
	}
	if socialHandleRegex.MatchString(content) {
		return true
	}
	return false
}

// SendProposedTerms sends a PROPOSED_TERMS message type with structured data
// (FR-8.9 / FR-5.4). Provider-only. Terms JSON is stored in metadata; content
// uses the web-compatible `[Proposed Terms]` body so clients can parse fields.
// This does NOT bind contract local terms — binding requires an explicit
// customer Accept via RespondToTerms (which applies payment_timing / terms_json
// on the live contract for the channel job when one exists).
func (s *Service) SendProposedTerms(ctx context.Context, channelID, senderID string, terms map[string]interface{}) (*domain.Message, error) {
	ch, err := s.repo.GetChannel(ctx, channelID, senderID)
	if err != nil {
		return nil, err
	}

	if ch.CustomerID != senderID && ch.ProviderID != senderID {
		return nil, fmt.Errorf("send proposed terms: %w", domain.ErrNotChannelMember)
	}
	if ch.ProviderID != senderID {
		return nil, fmt.Errorf("send proposed terms: %w", domain.ErrOnlyProviderCanPropose)
	}

	if ch.Status == "closed" || ch.Status == "read_only" {
		return nil, fmt.Errorf("send proposed terms: %w", domain.ErrChannelClosed)
	}

	if terms == nil {
		terms = map[string]interface{}{}
	}

	metadataJSON, err := json.Marshal(terms)
	if err != nil {
		return nil, fmt.Errorf("send proposed terms: marshal terms: %w", err)
	}

	content := formatProposedTermsContent(terms)
	flagged := DetectContactInfo(content)

	msg := &domain.Message{
		ChannelID:          channelID,
		SenderID:           senderID,
		MessageType:        domain.MessageTypeProposedTerms,
		Content:            content,
		MetadataJSON:       metadataJSON,
		FlaggedContactInfo: flagged,
	}

	result, err := s.repo.SendMessage(ctx, msg)
	if err != nil {
		return nil, fmt.Errorf("send proposed terms: %w", err)
	}

	if s.pubsub != nil {
		if err := s.pubsub.Publish(ctx, channelID, *result); err != nil {
			slog.ErrorContext(ctx, "failed to publish proposed terms to pubsub",
				"channel_id", channelID,
				"message_id", result.ID,
				"sender_id", senderID,
				"error", err,
			)
		}
	}

	slog.InfoContext(ctx, "proposed terms sent",
		"channel_id", channelID,
		"sender_id", senderID,
		"message_id", result.ID,
		"flagged_contact_info", flagged,
		// Explicit: proposal alone never binds local terms on a contract.
		"binding", false,
	)

	return result, nil
}

// RespondToTerms records the customer's explicit Accept or Reject of proposed
// local terms (FR-8.9 / FR-5.4). Customer-only; party membership required.
// Posts terms_accepted / terms_rejected — this is the explicit consent signal.
//
// On accepted=true, when a LocalTermsBinder is wired and the channel has a
// job_id, attempts to bind the latest proposed terms onto the live contract
// (payment_timing + terms_json). Pre-award channels with no contract record
// consent with override skipped (no_live_contract); job CreateContractFromAward
// re-applies via PendingLocalTermsApplier. Binder failures are logged and
// stamped on message metadata but do not fail Accept (consent is the primary
// product signal).
func (s *Service) RespondToTerms(ctx context.Context, channelID, customerID string, accepted bool) (*domain.Message, error) {
	ch, err := s.repo.GetChannel(ctx, channelID, customerID)
	if err != nil {
		return nil, err
	}

	if ch.CustomerID != customerID && ch.ProviderID != customerID {
		return nil, fmt.Errorf("respond to terms: %w", domain.ErrNotChannelMember)
	}
	if ch.CustomerID != customerID {
		return nil, fmt.Errorf("respond to terms: %w", domain.ErrOnlyCustomerCanRespond)
	}

	if ch.Status == "closed" || ch.Status == "read_only" {
		return nil, fmt.Errorf("respond to terms: %w", domain.ErrChannelClosed)
	}

	action := "rejected"
	msgType := domain.MessageTypeTermsRejected
	if accepted {
		action = "accepted"
		msgType = domain.MessageTypeTermsAccepted
	}

	meta := map[string]interface{}{
		"action":       action,
		"responded_by": customerID,
		// Consent is explicit Accept/Reject only — never inferred from read/silence.
		"explicit_consent": true,
	}

	// FR-5.4: on Accept, bind local terms to the live contract when possible.
	overrideApplied := false
	var boundContractID string
	if accepted {
		boundContractID, overrideApplied = s.tryApplyLocalTerms(ctx, ch, customerID, meta)
	} else {
		meta["contract_override_applied"] = false
	}

	content := fmt.Sprintf("Customer %s the proposed terms.", action)
	metadata, err := json.Marshal(meta)
	if err != nil {
		return nil, fmt.Errorf("respond to terms: marshal metadata: %w", err)
	}

	msg := &domain.Message{
		ChannelID:    channelID,
		SenderID:     customerID,
		MessageType:  msgType,
		Content:      content,
		MetadataJSON: metadata,
	}

	result, err := s.repo.SendMessage(ctx, msg)
	if err != nil {
		return nil, fmt.Errorf("respond to terms: %w", err)
	}

	if s.pubsub != nil {
		if err := s.pubsub.Publish(ctx, channelID, *result); err != nil {
			slog.ErrorContext(ctx, "failed to publish terms response to pubsub",
				"channel_id", channelID,
				"message_id", result.ID,
				"customer_id", customerID,
				"action", action,
				"error", err,
			)
		}
	}

	slog.InfoContext(ctx, "proposed terms response",
		"channel_id", channelID,
		"customer_id", customerID,
		"message_id", result.ID,
		"action", action,
		"accepted", accepted,
		"job_id", ch.JobID,
		"contract_id", boundContractID,
		"contract_override_applied", overrideApplied,
	)

	return result, nil
}

// tryApplyLocalTerms loads the latest proposal and writes it onto the live
// contract for the channel job. Always stamps meta["contract_override_applied"].
// Returns (contractID, applied).
func (s *Service) tryApplyLocalTerms(
	ctx context.Context,
	ch *domain.Channel,
	customerID string,
	meta map[string]interface{},
) (string, bool) {
	if s.termsBinder == nil {
		// Residual: binder not wired — consent only.
		meta["contract_override_applied"] = false
		meta["contract_override_reason"] = "binder_unavailable"
		return "", false
	}
	if ch.JobID == "" {
		// Residual: channel has no job link (should not happen for normal job chat).
		meta["contract_override_applied"] = false
		meta["contract_override_reason"] = "no_job_id"
		return "", false
	}

	metaJSON, proposedMsgID, err := s.termsBinder.LatestProposedTerms(ctx, ch.ID)
	if err != nil {
		slog.ErrorContext(ctx, "local terms: failed to load latest proposal",
			"channel_id", ch.ID, "job_id", ch.JobID, "error", err)
		meta["contract_override_applied"] = false
		meta["contract_override_reason"] = "proposal_lookup_failed"
		return "", false
	}
	if proposedMsgID == "" {
		// Accept with no prior proposal — still record consent; nothing to bind.
		meta["contract_override_applied"] = false
		meta["contract_override_reason"] = "no_proposed_terms"
		return "", false
	}

	proposed := map[string]interface{}{}
	if len(metaJSON) > 0 {
		if err := json.Unmarshal(metaJSON, &proposed); err != nil {
			slog.ErrorContext(ctx, "local terms: invalid proposal metadata",
				"channel_id", ch.ID, "proposed_message_id", proposedMsgID, "error", err)
			meta["contract_override_applied"] = false
			meta["contract_override_reason"] = "proposal_metadata_invalid"
			return "", false
		}
	}

	paymentTiming := extractPaymentTiming(proposed)
	patch, err := buildLocalTermsPatch(proposed, customerID, ch.ID, proposedMsgID, paymentTiming)
	if err != nil {
		slog.ErrorContext(ctx, "local terms: failed to build terms_json patch",
			"channel_id", ch.ID, "error", err)
		meta["contract_override_applied"] = false
		meta["contract_override_reason"] = "patch_build_failed"
		return "", false
	}

	contractID, err := s.termsBinder.ApplyLocalTerms(
		ctx, ch.JobID, ch.CustomerID, ch.ProviderID, paymentTiming, patch,
	)
	if err != nil {
		slog.ErrorContext(ctx, "local terms: failed to apply contract override",
			"channel_id", ch.ID, "job_id", ch.JobID, "error", err)
		meta["contract_override_applied"] = false
		meta["contract_override_reason"] = "apply_failed"
		return "", false
	}
	if contractID == "" {
		// Residual: no live pending_acceptance/active contract for this job+parties.
		meta["contract_override_applied"] = false
		meta["contract_override_reason"] = "no_live_contract"
		return "", false
	}

	meta["contract_override_applied"] = true
	meta["contract_id"] = contractID
	if paymentTiming != nil {
		meta["payment_timing_applied"] = *paymentTiming
	}
	return contractID, true
}

// formatProposedTermsContent builds the web-compatible body so iOS/web parsers
// (prefix `[Proposed Terms]`) can render structured cards.
func formatProposedTermsContent(terms map[string]interface{}) string {
	var b strings.Builder
	b.WriteString("[Proposed Terms]")
	writeTermLine := func(label string, keys ...string) {
		s := termString(terms, keys...)
		if s == "" {
			return
		}
		b.WriteByte('\n')
		b.WriteString(label)
		b.WriteString(": ")
		b.WriteString(s)
	}
	// Accept both snake_case (API) and camelCase (web-shaped) keys.
	writeTermLine("Payment Type", "payment_type", "paymentType")
	writeTermLine("Amount", "amount")
	writeTermLine("Milestones", "milestones")
	writeTermLine("Description", "description")
	return b.String()
}

func termString(m map[string]interface{}, keys ...string) string {
	for _, k := range keys {
		if v, ok := m[k]; ok && v != nil {
			s := strings.TrimSpace(fmt.Sprint(v))
			if s != "" && s != "<nil>" {
				return s
			}
		}
	}
	return ""
}
