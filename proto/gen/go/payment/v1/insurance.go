// Hand-written proto-compatible types for insurance RPCs.
// These supplement the generated payment.pb.go until protoc is re-run.
package paymentv1

import (
	"google.golang.org/protobuf/types/known/timestamppb"
)

// --- Insurance Message Types ---

type InsuranceProduct struct {
	Id                  string                 `protobuf:"bytes,1,opt,name=id,proto3" json:"id,omitempty"`
	Name                string                 `protobuf:"bytes,2,opt,name=name,proto3" json:"name,omitempty"`
	Slug                string                 `protobuf:"bytes,3,opt,name=slug,proto3" json:"slug,omitempty"`
	Description         string                 `protobuf:"bytes,4,opt,name=description,proto3" json:"description,omitempty"`
	CoverageType        string                 `protobuf:"bytes,5,opt,name=coverage_type,json=coverageType,proto3" json:"coverage_type,omitempty"`
	BaseRateBps         int32                  `protobuf:"varint,6,opt,name=base_rate_bps,json=baseRateBps,proto3" json:"base_rate_bps,omitempty"`
	MinPremiumCents     int64                  `protobuf:"varint,7,opt,name=min_premium_cents,json=minPremiumCents,proto3" json:"min_premium_cents,omitempty"`
	MaxCoverageCents    int64                  `protobuf:"varint,8,opt,name=max_coverage_cents,json=maxCoverageCents,proto3" json:"max_coverage_cents,omitempty"`
	CoverageDurationDays int32                 `protobuf:"varint,9,opt,name=coverage_duration_days,json=coverageDurationDays,proto3" json:"coverage_duration_days,omitempty"`
	DeductibleCents     int64                  `protobuf:"varint,10,opt,name=deductible_cents,json=deductibleCents,proto3" json:"deductible_cents,omitempty"`
	TermsMarkdown       string                 `protobuf:"bytes,11,opt,name=terms_markdown,json=termsMarkdown,proto3" json:"terms_markdown,omitempty"`
	Active              bool                   `protobuf:"varint,12,opt,name=active,proto3" json:"active,omitempty"`
	CreatedAt           *timestamppb.Timestamp `protobuf:"bytes,13,opt,name=created_at,json=createdAt,proto3" json:"created_at,omitempty"`
	UpdatedAt           *timestamppb.Timestamp `protobuf:"bytes,14,opt,name=updated_at,json=updatedAt,proto3" json:"updated_at,omitempty"`
}

func (x *InsuranceProduct) GetId() string                        { if x != nil { return x.Id }; return "" }
func (x *InsuranceProduct) GetName() string                      { if x != nil { return x.Name }; return "" }
func (x *InsuranceProduct) GetSlug() string                      { if x != nil { return x.Slug }; return "" }
func (x *InsuranceProduct) GetDescription() string               { if x != nil { return x.Description }; return "" }
func (x *InsuranceProduct) GetCoverageType() string              { if x != nil { return x.CoverageType }; return "" }
func (x *InsuranceProduct) GetBaseRateBps() int32                { if x != nil { return x.BaseRateBps }; return 0 }
func (x *InsuranceProduct) GetMinPremiumCents() int64            { if x != nil { return x.MinPremiumCents }; return 0 }
func (x *InsuranceProduct) GetMaxCoverageCents() int64           { if x != nil { return x.MaxCoverageCents }; return 0 }
func (x *InsuranceProduct) GetCoverageDurationDays() int32       { if x != nil { return x.CoverageDurationDays }; return 0 }
func (x *InsuranceProduct) GetDeductibleCents() int64            { if x != nil { return x.DeductibleCents }; return 0 }
func (x *InsuranceProduct) GetTermsMarkdown() string             { if x != nil { return x.TermsMarkdown }; return "" }
func (x *InsuranceProduct) GetActive() bool                      { if x != nil { return x.Active }; return false }
func (x *InsuranceProduct) GetCreatedAt() *timestamppb.Timestamp { if x != nil { return x.CreatedAt }; return nil }
func (x *InsuranceProduct) GetUpdatedAt() *timestamppb.Timestamp { if x != nil { return x.UpdatedAt }; return nil }

type InsurancePolicy struct {
	Id                    string                 `protobuf:"bytes,1,opt,name=id,proto3" json:"id,omitempty"`
	PolicyNumber          string                 `protobuf:"bytes,2,opt,name=policy_number,json=policyNumber,proto3" json:"policy_number,omitempty"`
	ProductId             string                 `protobuf:"bytes,3,opt,name=product_id,json=productId,proto3" json:"product_id,omitempty"`
	ContractId            string                 `protobuf:"bytes,4,opt,name=contract_id,json=contractId,proto3" json:"contract_id,omitempty"`
	CustomerId            string                 `protobuf:"bytes,5,opt,name=customer_id,json=customerId,proto3" json:"customer_id,omitempty"`
	ProviderId            string                 `protobuf:"bytes,6,opt,name=provider_id,json=providerId,proto3" json:"provider_id,omitempty"`
	CoverageAmountCents   int64                  `protobuf:"varint,7,opt,name=coverage_amount_cents,json=coverageAmountCents,proto3" json:"coverage_amount_cents,omitempty"`
	PremiumCents          int64                  `protobuf:"varint,8,opt,name=premium_cents,json=premiumCents,proto3" json:"premium_cents,omitempty"`
	DeductibleCents       int64                  `protobuf:"varint,9,opt,name=deductible_cents,json=deductibleCents,proto3" json:"deductible_cents,omitempty"`
	StripePaymentIntentId string                 `protobuf:"bytes,10,opt,name=stripe_payment_intent_id,json=stripePaymentIntentId,proto3" json:"stripe_payment_intent_id,omitempty"`
	EffectiveDate         string                 `protobuf:"bytes,11,opt,name=effective_date,json=effectiveDate,proto3" json:"effective_date,omitempty"`
	ExpirationDate        string                 `protobuf:"bytes,12,opt,name=expiration_date,json=expirationDate,proto3" json:"expiration_date,omitempty"`
	Status                string                 `protobuf:"bytes,13,opt,name=status,proto3" json:"status,omitempty"`
	PaidAt                *timestamppb.Timestamp `protobuf:"bytes,14,opt,name=paid_at,json=paidAt,proto3" json:"paid_at,omitempty"`
	CancelledAt           *timestamppb.Timestamp `protobuf:"bytes,15,opt,name=cancelled_at,json=cancelledAt,proto3" json:"cancelled_at,omitempty"`
	CancellationReason    string                 `protobuf:"bytes,16,opt,name=cancellation_reason,json=cancellationReason,proto3" json:"cancellation_reason,omitempty"`
	CreatedAt             *timestamppb.Timestamp `protobuf:"bytes,17,opt,name=created_at,json=createdAt,proto3" json:"created_at,omitempty"`
	UpdatedAt             *timestamppb.Timestamp `protobuf:"bytes,18,opt,name=updated_at,json=updatedAt,proto3" json:"updated_at,omitempty"`
}

func (x *InsurancePolicy) GetId() string                        { if x != nil { return x.Id }; return "" }
func (x *InsurancePolicy) GetPolicyNumber() string              { if x != nil { return x.PolicyNumber }; return "" }
func (x *InsurancePolicy) GetProductId() string                 { if x != nil { return x.ProductId }; return "" }
func (x *InsurancePolicy) GetContractId() string                { if x != nil { return x.ContractId }; return "" }
func (x *InsurancePolicy) GetCustomerId() string                { if x != nil { return x.CustomerId }; return "" }
func (x *InsurancePolicy) GetProviderId() string                { if x != nil { return x.ProviderId }; return "" }
func (x *InsurancePolicy) GetCoverageAmountCents() int64        { if x != nil { return x.CoverageAmountCents }; return 0 }
func (x *InsurancePolicy) GetPremiumCents() int64               { if x != nil { return x.PremiumCents }; return 0 }
func (x *InsurancePolicy) GetDeductibleCents() int64            { if x != nil { return x.DeductibleCents }; return 0 }
func (x *InsurancePolicy) GetStripePaymentIntentId() string     { if x != nil { return x.StripePaymentIntentId }; return "" }
func (x *InsurancePolicy) GetEffectiveDate() string             { if x != nil { return x.EffectiveDate }; return "" }
func (x *InsurancePolicy) GetExpirationDate() string            { if x != nil { return x.ExpirationDate }; return "" }
func (x *InsurancePolicy) GetStatus() string                    { if x != nil { return x.Status }; return "" }
func (x *InsurancePolicy) GetPaidAt() *timestamppb.Timestamp    { if x != nil { return x.PaidAt }; return nil }
func (x *InsurancePolicy) GetCancelledAt() *timestamppb.Timestamp { if x != nil { return x.CancelledAt }; return nil }
func (x *InsurancePolicy) GetCancellationReason() string        { if x != nil { return x.CancellationReason }; return "" }
func (x *InsurancePolicy) GetCreatedAt() *timestamppb.Timestamp { if x != nil { return x.CreatedAt }; return nil }
func (x *InsurancePolicy) GetUpdatedAt() *timestamppb.Timestamp { if x != nil { return x.UpdatedAt }; return nil }

type InsuranceClaim struct {
	Id                  string                 `protobuf:"bytes,1,opt,name=id,proto3" json:"id,omitempty"`
	ClaimNumber         string                 `protobuf:"bytes,2,opt,name=claim_number,json=claimNumber,proto3" json:"claim_number,omitempty"`
	PolicyId            string                 `protobuf:"bytes,3,opt,name=policy_id,json=policyId,proto3" json:"policy_id,omitempty"`
	ClaimantId          string                 `protobuf:"bytes,4,opt,name=claimant_id,json=claimantId,proto3" json:"claimant_id,omitempty"`
	ClaimType           string                 `protobuf:"bytes,5,opt,name=claim_type,json=claimType,proto3" json:"claim_type,omitempty"`
	Description         string                 `protobuf:"bytes,6,opt,name=description,proto3" json:"description,omitempty"`
	EvidenceUrls        []string               `protobuf:"bytes,7,rep,name=evidence_urls,json=evidenceUrls,proto3" json:"evidence_urls,omitempty"`
	ClaimedAmountCents  int64                  `protobuf:"varint,8,opt,name=claimed_amount_cents,json=claimedAmountCents,proto3" json:"claimed_amount_cents,omitempty"`
	AssessedAmountCents int64                  `protobuf:"varint,9,opt,name=assessed_amount_cents,json=assessedAmountCents,proto3" json:"assessed_amount_cents,omitempty"`
	AssessorNotes       string                 `protobuf:"bytes,10,opt,name=assessor_notes,json=assessorNotes,proto3" json:"assessor_notes,omitempty"`
	ApprovedAmountCents int64                  `protobuf:"varint,11,opt,name=approved_amount_cents,json=approvedAmountCents,proto3" json:"approved_amount_cents,omitempty"`
	PayoutCents         int64                  `protobuf:"varint,12,opt,name=payout_cents,json=payoutCents,proto3" json:"payout_cents,omitempty"`
	StripeTransferId    string                 `protobuf:"bytes,13,opt,name=stripe_transfer_id,json=stripeTransferId,proto3" json:"stripe_transfer_id,omitempty"`
	Status              string                 `protobuf:"bytes,14,opt,name=status,proto3" json:"status,omitempty"`
	DenialReason        string                 `protobuf:"bytes,15,opt,name=denial_reason,json=denialReason,proto3" json:"denial_reason,omitempty"`
	ReviewedBy          string                 `protobuf:"bytes,16,opt,name=reviewed_by,json=reviewedBy,proto3" json:"reviewed_by,omitempty"`
	ReviewedAt          *timestamppb.Timestamp `protobuf:"bytes,17,opt,name=reviewed_at,json=reviewedAt,proto3" json:"reviewed_at,omitempty"`
	PaidAt              *timestamppb.Timestamp `protobuf:"bytes,18,opt,name=paid_at,json=paidAt,proto3" json:"paid_at,omitempty"`
	CreatedAt           *timestamppb.Timestamp `protobuf:"bytes,19,opt,name=created_at,json=createdAt,proto3" json:"created_at,omitempty"`
	UpdatedAt           *timestamppb.Timestamp `protobuf:"bytes,20,opt,name=updated_at,json=updatedAt,proto3" json:"updated_at,omitempty"`
}

func (x *InsuranceClaim) GetId() string                        { if x != nil { return x.Id }; return "" }
func (x *InsuranceClaim) GetClaimNumber() string               { if x != nil { return x.ClaimNumber }; return "" }
func (x *InsuranceClaim) GetPolicyId() string                  { if x != nil { return x.PolicyId }; return "" }
func (x *InsuranceClaim) GetClaimantId() string                { if x != nil { return x.ClaimantId }; return "" }
func (x *InsuranceClaim) GetClaimType() string                 { if x != nil { return x.ClaimType }; return "" }
func (x *InsuranceClaim) GetDescription() string               { if x != nil { return x.Description }; return "" }
func (x *InsuranceClaim) GetEvidenceUrls() []string            { if x != nil { return x.EvidenceUrls }; return nil }
func (x *InsuranceClaim) GetClaimedAmountCents() int64         { if x != nil { return x.ClaimedAmountCents }; return 0 }
func (x *InsuranceClaim) GetAssessedAmountCents() int64        { if x != nil { return x.AssessedAmountCents }; return 0 }
func (x *InsuranceClaim) GetAssessorNotes() string             { if x != nil { return x.AssessorNotes }; return "" }
func (x *InsuranceClaim) GetApprovedAmountCents() int64        { if x != nil { return x.ApprovedAmountCents }; return 0 }
func (x *InsuranceClaim) GetPayoutCents() int64                { if x != nil { return x.PayoutCents }; return 0 }
func (x *InsuranceClaim) GetStripeTransferId() string          { if x != nil { return x.StripeTransferId }; return "" }
func (x *InsuranceClaim) GetStatus() string                    { if x != nil { return x.Status }; return "" }
func (x *InsuranceClaim) GetDenialReason() string              { if x != nil { return x.DenialReason }; return "" }
func (x *InsuranceClaim) GetReviewedBy() string                { if x != nil { return x.ReviewedBy }; return "" }
func (x *InsuranceClaim) GetReviewedAt() *timestamppb.Timestamp { if x != nil { return x.ReviewedAt }; return nil }
func (x *InsuranceClaim) GetPaidAt() *timestamppb.Timestamp    { if x != nil { return x.PaidAt }; return nil }
func (x *InsuranceClaim) GetCreatedAt() *timestamppb.Timestamp { if x != nil { return x.CreatedAt }; return nil }
func (x *InsuranceClaim) GetUpdatedAt() *timestamppb.Timestamp { if x != nil { return x.UpdatedAt }; return nil }

type InsuranceQuote struct {
	ProductId            string `protobuf:"bytes,1,opt,name=product_id,json=productId,proto3" json:"product_id,omitempty"`
	ProductName          string `protobuf:"bytes,2,opt,name=product_name,json=productName,proto3" json:"product_name,omitempty"`
	CoverageType         string `protobuf:"bytes,3,opt,name=coverage_type,json=coverageType,proto3" json:"coverage_type,omitempty"`
	PremiumCents         int64  `protobuf:"varint,4,opt,name=premium_cents,json=premiumCents,proto3" json:"premium_cents,omitempty"`
	CoverageAmountCents  int64  `protobuf:"varint,5,opt,name=coverage_amount_cents,json=coverageAmountCents,proto3" json:"coverage_amount_cents,omitempty"`
	DeductibleCents      int64  `protobuf:"varint,6,opt,name=deductible_cents,json=deductibleCents,proto3" json:"deductible_cents,omitempty"`
	CoverageDurationDays int32  `protobuf:"varint,7,opt,name=coverage_duration_days,json=coverageDurationDays,proto3" json:"coverage_duration_days,omitempty"`
	EffectiveDate        string `protobuf:"bytes,8,opt,name=effective_date,json=effectiveDate,proto3" json:"effective_date,omitempty"`
	ExpirationDate       string `protobuf:"bytes,9,opt,name=expiration_date,json=expirationDate,proto3" json:"expiration_date,omitempty"`
}

func (x *InsuranceQuote) GetProductId() string            { if x != nil { return x.ProductId }; return "" }
func (x *InsuranceQuote) GetProductName() string          { if x != nil { return x.ProductName }; return "" }
func (x *InsuranceQuote) GetCoverageType() string         { if x != nil { return x.CoverageType }; return "" }
func (x *InsuranceQuote) GetPremiumCents() int64          { if x != nil { return x.PremiumCents }; return 0 }
func (x *InsuranceQuote) GetCoverageAmountCents() int64   { if x != nil { return x.CoverageAmountCents }; return 0 }
func (x *InsuranceQuote) GetDeductibleCents() int64       { if x != nil { return x.DeductibleCents }; return 0 }
func (x *InsuranceQuote) GetCoverageDurationDays() int32  { if x != nil { return x.CoverageDurationDays }; return 0 }
func (x *InsuranceQuote) GetEffectiveDate() string        { if x != nil { return x.EffectiveDate }; return "" }
func (x *InsuranceQuote) GetExpirationDate() string       { if x != nil { return x.ExpirationDate }; return "" }

// --- Request/Response Types ---

type ListInsuranceProductsRequest struct{}
type ListInsuranceProductsResponse struct {
	Products []*InsuranceProduct `protobuf:"bytes,1,rep,name=products,proto3" json:"products,omitempty"`
}
func (x *ListInsuranceProductsResponse) GetProducts() []*InsuranceProduct { if x != nil { return x.Products }; return nil }

type GetInsuranceQuoteRequest struct {
	ProductId           string `protobuf:"bytes,1,opt,name=product_id,json=productId,proto3" json:"product_id,omitempty"`
	ContractId          string `protobuf:"bytes,2,opt,name=contract_id,json=contractId,proto3" json:"contract_id,omitempty"`
	ContractAmountCents int64  `protobuf:"varint,3,opt,name=contract_amount_cents,json=contractAmountCents,proto3" json:"contract_amount_cents,omitempty"`
	CategorySlug        string `protobuf:"bytes,4,opt,name=category_slug,json=categorySlug,proto3" json:"category_slug,omitempty"`
}
func (x *GetInsuranceQuoteRequest) GetProductId() string           { if x != nil { return x.ProductId }; return "" }
func (x *GetInsuranceQuoteRequest) GetContractId() string          { if x != nil { return x.ContractId }; return "" }
func (x *GetInsuranceQuoteRequest) GetContractAmountCents() int64  { if x != nil { return x.ContractAmountCents }; return 0 }
func (x *GetInsuranceQuoteRequest) GetCategorySlug() string        { if x != nil { return x.CategorySlug }; return "" }

type GetInsuranceQuoteResponse struct {
	Quote *InsuranceQuote `protobuf:"bytes,1,opt,name=quote,proto3" json:"quote,omitempty"`
}
func (x *GetInsuranceQuoteResponse) GetQuote() *InsuranceQuote { if x != nil { return x.Quote }; return nil }

type PurchaseInsuranceRequest struct {
	ProductId           string `protobuf:"bytes,1,opt,name=product_id,json=productId,proto3" json:"product_id,omitempty"`
	ContractId          string `protobuf:"bytes,2,opt,name=contract_id,json=contractId,proto3" json:"contract_id,omitempty"`
	CustomerId          string `protobuf:"bytes,3,opt,name=customer_id,json=customerId,proto3" json:"customer_id,omitempty"`
	ProviderId          string `protobuf:"bytes,4,opt,name=provider_id,json=providerId,proto3" json:"provider_id,omitempty"`
	ContractAmountCents int64  `protobuf:"varint,5,opt,name=contract_amount_cents,json=contractAmountCents,proto3" json:"contract_amount_cents,omitempty"`
}
func (x *PurchaseInsuranceRequest) GetProductId() string           { if x != nil { return x.ProductId }; return "" }
func (x *PurchaseInsuranceRequest) GetContractId() string          { if x != nil { return x.ContractId }; return "" }
func (x *PurchaseInsuranceRequest) GetCustomerId() string          { if x != nil { return x.CustomerId }; return "" }
func (x *PurchaseInsuranceRequest) GetProviderId() string          { if x != nil { return x.ProviderId }; return "" }
func (x *PurchaseInsuranceRequest) GetContractAmountCents() int64  { if x != nil { return x.ContractAmountCents }; return 0 }

type PurchaseInsuranceResponse struct {
	Policy       *InsurancePolicy `protobuf:"bytes,1,opt,name=policy,proto3" json:"policy,omitempty"`
	ClientSecret string           `protobuf:"bytes,2,opt,name=client_secret,json=clientSecret,proto3" json:"client_secret,omitempty"`
}
func (x *PurchaseInsuranceResponse) GetPolicy() *InsurancePolicy { if x != nil { return x.Policy }; return nil }
func (x *PurchaseInsuranceResponse) GetClientSecret() string     { if x != nil { return x.ClientSecret }; return "" }

type GetInsurancePolicyRequest struct {
	PolicyId string `protobuf:"bytes,1,opt,name=policy_id,json=policyId,proto3" json:"policy_id,omitempty"`
}
func (x *GetInsurancePolicyRequest) GetPolicyId() string { if x != nil { return x.PolicyId }; return "" }

type GetInsurancePolicyResponse struct {
	Policy *InsurancePolicy `protobuf:"bytes,1,opt,name=policy,proto3" json:"policy,omitempty"`
}
func (x *GetInsurancePolicyResponse) GetPolicy() *InsurancePolicy { if x != nil { return x.Policy }; return nil }

type ListInsurancePoliciesRequest struct {
	UserId     string                       `protobuf:"bytes,1,opt,name=user_id,json=userId,proto3" json:"user_id,omitempty"`
	Pagination *InsurancePaginationRequest   `protobuf:"bytes,2,opt,name=pagination,proto3" json:"pagination,omitempty"`
}
func (x *ListInsurancePoliciesRequest) GetUserId() string { if x != nil { return x.UserId }; return "" }
func (x *ListInsurancePoliciesRequest) GetPagination() *InsurancePaginationRequest { if x != nil { return x.Pagination }; return nil }

// InsurancePaginationRequest is a pagination request type for insurance RPCs.
type InsurancePaginationRequest struct {
	Page     int32 `protobuf:"varint,1,opt,name=page,proto3" json:"page,omitempty"`
	PageSize int32 `protobuf:"varint,2,opt,name=page_size,json=pageSize,proto3" json:"page_size,omitempty"`
}
func (x *InsurancePaginationRequest) GetPage() int32     { if x != nil { return x.Page }; return 0 }
func (x *InsurancePaginationRequest) GetPageSize() int32 { if x != nil { return x.PageSize }; return 0 }

// InsurancePaginationResponse is a pagination response type for insurance RPCs.
type InsurancePaginationResponse struct {
	TotalCount int32 `protobuf:"varint,1,opt,name=total_count,json=totalCount,proto3" json:"total_count,omitempty"`
	Page       int32 `protobuf:"varint,2,opt,name=page,proto3" json:"page,omitempty"`
	PageSize   int32 `protobuf:"varint,3,opt,name=page_size,json=pageSize,proto3" json:"page_size,omitempty"`
	TotalPages int32 `protobuf:"varint,4,opt,name=total_pages,json=totalPages,proto3" json:"total_pages,omitempty"`
	HasNext    bool  `protobuf:"varint,5,opt,name=has_next,json=hasNext,proto3" json:"has_next,omitempty"`
}

type ListInsurancePoliciesResponse struct {
	Policies   []*InsurancePolicy          `protobuf:"bytes,1,rep,name=policies,proto3" json:"policies,omitempty"`
	Pagination *InsurancePaginationResponse `protobuf:"bytes,2,opt,name=pagination,proto3" json:"pagination,omitempty"`
}
func (x *ListInsurancePoliciesResponse) GetPolicies() []*InsurancePolicy { if x != nil { return x.Policies }; return nil }
func (x *ListInsurancePoliciesResponse) GetPagination() *InsurancePaginationResponse { if x != nil { return x.Pagination }; return nil }

type FileInsuranceClaimRequest struct {
	PolicyId           string   `protobuf:"bytes,1,opt,name=policy_id,json=policyId,proto3" json:"policy_id,omitempty"`
	ClaimantId         string   `protobuf:"bytes,2,opt,name=claimant_id,json=claimantId,proto3" json:"claimant_id,omitempty"`
	ClaimType          string   `protobuf:"bytes,3,opt,name=claim_type,json=claimType,proto3" json:"claim_type,omitempty"`
	Description        string   `protobuf:"bytes,4,opt,name=description,proto3" json:"description,omitempty"`
	EvidenceUrls       []string `protobuf:"bytes,5,rep,name=evidence_urls,json=evidenceUrls,proto3" json:"evidence_urls,omitempty"`
	ClaimedAmountCents int64    `protobuf:"varint,6,opt,name=claimed_amount_cents,json=claimedAmountCents,proto3" json:"claimed_amount_cents,omitempty"`
}
func (x *FileInsuranceClaimRequest) GetPolicyId() string           { if x != nil { return x.PolicyId }; return "" }
func (x *FileInsuranceClaimRequest) GetClaimantId() string         { if x != nil { return x.ClaimantId }; return "" }
func (x *FileInsuranceClaimRequest) GetClaimType() string          { if x != nil { return x.ClaimType }; return "" }
func (x *FileInsuranceClaimRequest) GetDescription() string        { if x != nil { return x.Description }; return "" }
func (x *FileInsuranceClaimRequest) GetEvidenceUrls() []string     { if x != nil { return x.EvidenceUrls }; return nil }
func (x *FileInsuranceClaimRequest) GetClaimedAmountCents() int64  { if x != nil { return x.ClaimedAmountCents }; return 0 }

type FileInsuranceClaimResponse struct {
	Claim *InsuranceClaim `protobuf:"bytes,1,opt,name=claim,proto3" json:"claim,omitempty"`
}
func (x *FileInsuranceClaimResponse) GetClaim() *InsuranceClaim { if x != nil { return x.Claim }; return nil }

type GetInsuranceClaimRequest struct {
	ClaimId string `protobuf:"bytes,1,opt,name=claim_id,json=claimId,proto3" json:"claim_id,omitempty"`
}
func (x *GetInsuranceClaimRequest) GetClaimId() string { if x != nil { return x.ClaimId }; return "" }

type GetInsuranceClaimResponse struct {
	Claim *InsuranceClaim `protobuf:"bytes,1,opt,name=claim,proto3" json:"claim,omitempty"`
}
func (x *GetInsuranceClaimResponse) GetClaim() *InsuranceClaim { if x != nil { return x.Claim }; return nil }

type ReviewInsuranceClaimRequest struct {
	ClaimId             string `protobuf:"bytes,1,opt,name=claim_id,json=claimId,proto3" json:"claim_id,omitempty"`
	ReviewerId          string `protobuf:"bytes,2,opt,name=reviewer_id,json=reviewerId,proto3" json:"reviewer_id,omitempty"`
	Approved            bool   `protobuf:"varint,3,opt,name=approved,proto3" json:"approved,omitempty"`
	ApprovedAmountCents int64  `protobuf:"varint,4,opt,name=approved_amount_cents,json=approvedAmountCents,proto3" json:"approved_amount_cents,omitempty"`
	AssessorNotes       string `protobuf:"bytes,5,opt,name=assessor_notes,json=assessorNotes,proto3" json:"assessor_notes,omitempty"`
	DenialReason        string `protobuf:"bytes,6,opt,name=denial_reason,json=denialReason,proto3" json:"denial_reason,omitempty"`
}
func (x *ReviewInsuranceClaimRequest) GetClaimId() string             { if x != nil { return x.ClaimId }; return "" }
func (x *ReviewInsuranceClaimRequest) GetReviewerId() string          { if x != nil { return x.ReviewerId }; return "" }
func (x *ReviewInsuranceClaimRequest) GetApproved() bool              { if x != nil { return x.Approved }; return false }
func (x *ReviewInsuranceClaimRequest) GetApprovedAmountCents() int64  { if x != nil { return x.ApprovedAmountCents }; return 0 }
func (x *ReviewInsuranceClaimRequest) GetAssessorNotes() string       { if x != nil { return x.AssessorNotes }; return "" }
func (x *ReviewInsuranceClaimRequest) GetDenialReason() string        { if x != nil { return x.DenialReason }; return "" }

type ReviewInsuranceClaimResponse struct {
	Claim *InsuranceClaim `protobuf:"bytes,1,opt,name=claim,proto3" json:"claim,omitempty"`
}
func (x *ReviewInsuranceClaimResponse) GetClaim() *InsuranceClaim { if x != nil { return x.Claim }; return nil }

type AdminListInsuranceClaimsRequest struct {
	StatusFilter *string                    `protobuf:"bytes,1,opt,name=status_filter,json=statusFilter,proto3,oneof" json:"status_filter,omitempty"`
	Pagination   *InsurancePaginationRequest `protobuf:"bytes,2,opt,name=pagination,proto3" json:"pagination,omitempty"`
}
func (x *AdminListInsuranceClaimsRequest) GetStatusFilter() string { if x != nil && x.StatusFilter != nil { return *x.StatusFilter }; return "" }
func (x *AdminListInsuranceClaimsRequest) GetPagination() *InsurancePaginationRequest { if x != nil { return x.Pagination }; return nil }

type AdminListInsuranceClaimsResponse struct {
	Claims     []*InsuranceClaim           `protobuf:"bytes,1,rep,name=claims,proto3" json:"claims,omitempty"`
	Pagination *InsurancePaginationResponse `protobuf:"bytes,2,opt,name=pagination,proto3" json:"pagination,omitempty"`
}
func (x *AdminListInsuranceClaimsResponse) GetClaims() []*InsuranceClaim { if x != nil { return x.Claims }; return nil }
func (x *AdminListInsuranceClaimsResponse) GetPagination() *InsurancePaginationResponse { if x != nil { return x.Pagination }; return nil }
