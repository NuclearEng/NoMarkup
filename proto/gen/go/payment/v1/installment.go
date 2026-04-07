package paymentv1

// Hand-written BNPL protobuf message types.
// These mirror the proto definitions in payment.proto for installment plans.
// They will be replaced by auto-generated code when protoc is next run.

import (
	timestamppb "google.golang.org/protobuf/types/known/timestamppb"
)

// ScheduledInstallment represents a single installment in a plan.
type ScheduledInstallment struct {
	Id                string                 `protobuf:"bytes,1,opt,name=id,proto3" json:"id,omitempty"`
	InstallmentNumber int32                  `protobuf:"varint,2,opt,name=installment_number,json=installmentNumber,proto3" json:"installment_number,omitempty"`
	AmountCents       int64                  `protobuf:"varint,3,opt,name=amount_cents,json=amountCents,proto3" json:"amount_cents,omitempty"`
	DueDate           string                 `protobuf:"bytes,4,opt,name=due_date,json=dueDate,proto3" json:"due_date,omitempty"`
	Status            string                 `protobuf:"bytes,5,opt,name=status,proto3" json:"status,omitempty"`
	PaymentId         string                 `protobuf:"bytes,6,opt,name=payment_id,json=paymentId,proto3" json:"payment_id,omitempty"`
	PaidAt            *timestamppb.Timestamp `protobuf:"bytes,7,opt,name=paid_at,json=paidAt,proto3" json:"paid_at,omitempty"`
}

func (x *ScheduledInstallment) GetId() string {
	if x != nil {
		return x.Id
	}
	return ""
}

func (x *ScheduledInstallment) GetInstallmentNumber() int32 {
	if x != nil {
		return x.InstallmentNumber
	}
	return 0
}

func (x *ScheduledInstallment) GetAmountCents() int64 {
	if x != nil {
		return x.AmountCents
	}
	return 0
}

func (x *ScheduledInstallment) GetDueDate() string {
	if x != nil {
		return x.DueDate
	}
	return ""
}

func (x *ScheduledInstallment) GetStatus() string {
	if x != nil {
		return x.Status
	}
	return ""
}

func (x *ScheduledInstallment) GetPaymentId() string {
	if x != nil {
		return x.PaymentId
	}
	return ""
}

func (x *ScheduledInstallment) GetPaidAt() *timestamppb.Timestamp {
	if x != nil {
		return x.PaidAt
	}
	return nil
}

// InstallmentPlan represents a BNPL installment plan.
type InstallmentPlan struct {
	Id                       string                   `protobuf:"bytes,1,opt,name=id,proto3" json:"id,omitempty"`
	ContractId               string                   `protobuf:"bytes,2,opt,name=contract_id,json=contractId,proto3" json:"contract_id,omitempty"`
	CustomerId               string                   `protobuf:"bytes,3,opt,name=customer_id,json=customerId,proto3" json:"customer_id,omitempty"`
	ProviderId               string                   `protobuf:"bytes,4,opt,name=provider_id,json=providerId,proto3" json:"provider_id,omitempty"`
	TotalAmountCents         int64                    `protobuf:"varint,5,opt,name=total_amount_cents,json=totalAmountCents,proto3" json:"total_amount_cents,omitempty"`
	BnplFeeCents             int64                    `protobuf:"varint,6,opt,name=bnpl_fee_cents,json=bnplFeeCents,proto3" json:"bnpl_fee_cents,omitempty"`
	TotalWithFeeCents        int64                    `protobuf:"varint,7,opt,name=total_with_fee_cents,json=totalWithFeeCents,proto3" json:"total_with_fee_cents,omitempty"`
	InstallmentCount         int32                    `protobuf:"varint,8,opt,name=installment_count,json=installmentCount,proto3" json:"installment_count,omitempty"`
	PerInstallmentCents      int64                    `protobuf:"varint,9,opt,name=per_installment_cents,json=perInstallmentCents,proto3" json:"per_installment_cents,omitempty"`
	FeeRate                  float64                  `protobuf:"fixed64,10,opt,name=fee_rate,json=feeRate,proto3" json:"fee_rate,omitempty"`
	Status                   string                   `protobuf:"bytes,11,opt,name=status,proto3" json:"status,omitempty"`
	ProviderPaidAt           *timestamppb.Timestamp   `protobuf:"bytes,12,opt,name=provider_paid_at,json=providerPaidAt,proto3" json:"provider_paid_at,omitempty"`
	StripeProviderTransferId string                   `protobuf:"bytes,13,opt,name=stripe_provider_transfer_id,json=stripeProviderTransferId,proto3" json:"stripe_provider_transfer_id,omitempty"`
	Installments             []*ScheduledInstallment  `protobuf:"bytes,14,rep,name=installments,proto3" json:"installments,omitempty"`
	CreatedAt                *timestamppb.Timestamp   `protobuf:"bytes,15,opt,name=created_at,json=createdAt,proto3" json:"created_at,omitempty"`
	UpdatedAt                *timestamppb.Timestamp   `protobuf:"bytes,16,opt,name=updated_at,json=updatedAt,proto3" json:"updated_at,omitempty"`
}

func (x *InstallmentPlan) GetId() string {
	if x != nil {
		return x.Id
	}
	return ""
}

func (x *InstallmentPlan) GetContractId() string {
	if x != nil {
		return x.ContractId
	}
	return ""
}

func (x *InstallmentPlan) GetCustomerId() string {
	if x != nil {
		return x.CustomerId
	}
	return ""
}

func (x *InstallmentPlan) GetProviderId() string {
	if x != nil {
		return x.ProviderId
	}
	return ""
}

func (x *InstallmentPlan) GetTotalAmountCents() int64 {
	if x != nil {
		return x.TotalAmountCents
	}
	return 0
}

func (x *InstallmentPlan) GetBnplFeeCents() int64 {
	if x != nil {
		return x.BnplFeeCents
	}
	return 0
}

func (x *InstallmentPlan) GetTotalWithFeeCents() int64 {
	if x != nil {
		return x.TotalWithFeeCents
	}
	return 0
}

func (x *InstallmentPlan) GetInstallmentCount() int32 {
	if x != nil {
		return x.InstallmentCount
	}
	return 0
}

func (x *InstallmentPlan) GetPerInstallmentCents() int64 {
	if x != nil {
		return x.PerInstallmentCents
	}
	return 0
}

func (x *InstallmentPlan) GetFeeRate() float64 {
	if x != nil {
		return x.FeeRate
	}
	return 0
}

func (x *InstallmentPlan) GetStatus() string {
	if x != nil {
		return x.Status
	}
	return ""
}

func (x *InstallmentPlan) GetProviderPaidAt() *timestamppb.Timestamp {
	if x != nil {
		return x.ProviderPaidAt
	}
	return nil
}

func (x *InstallmentPlan) GetStripeProviderTransferId() string {
	if x != nil {
		return x.StripeProviderTransferId
	}
	return ""
}

func (x *InstallmentPlan) GetInstallments() []*ScheduledInstallment {
	if x != nil {
		return x.Installments
	}
	return nil
}

func (x *InstallmentPlan) GetCreatedAt() *timestamppb.Timestamp {
	if x != nil {
		return x.CreatedAt
	}
	return nil
}

func (x *InstallmentPlan) GetUpdatedAt() *timestamppb.Timestamp {
	if x != nil {
		return x.UpdatedAt
	}
	return nil
}

// CreateInstallmentPlanRequest is the request for CreateInstallmentPlan.
type CreateInstallmentPlanRequest struct {
	ContractId       string `protobuf:"bytes,1,opt,name=contract_id,json=contractId,proto3" json:"contract_id,omitempty"`
	CustomerId       string `protobuf:"bytes,2,opt,name=customer_id,json=customerId,proto3" json:"customer_id,omitempty"`
	ProviderId       string `protobuf:"bytes,3,opt,name=provider_id,json=providerId,proto3" json:"provider_id,omitempty"`
	TotalAmountCents int64  `protobuf:"varint,4,opt,name=total_amount_cents,json=totalAmountCents,proto3" json:"total_amount_cents,omitempty"`
	InstallmentCount int32  `protobuf:"varint,5,opt,name=installment_count,json=installmentCount,proto3" json:"installment_count,omitempty"`
	PaymentMethodId  string `protobuf:"bytes,6,opt,name=payment_method_id,json=paymentMethodId,proto3" json:"payment_method_id,omitempty"`
	IdempotencyKey   string `protobuf:"bytes,7,opt,name=idempotency_key,json=idempotencyKey,proto3" json:"idempotency_key,omitempty"`
}

func (x *CreateInstallmentPlanRequest) GetContractId() string {
	if x != nil {
		return x.ContractId
	}
	return ""
}

func (x *CreateInstallmentPlanRequest) GetCustomerId() string {
	if x != nil {
		return x.CustomerId
	}
	return ""
}

func (x *CreateInstallmentPlanRequest) GetProviderId() string {
	if x != nil {
		return x.ProviderId
	}
	return ""
}

func (x *CreateInstallmentPlanRequest) GetTotalAmountCents() int64 {
	if x != nil {
		return x.TotalAmountCents
	}
	return 0
}

func (x *CreateInstallmentPlanRequest) GetInstallmentCount() int32 {
	if x != nil {
		return x.InstallmentCount
	}
	return 0
}

func (x *CreateInstallmentPlanRequest) GetPaymentMethodId() string {
	if x != nil {
		return x.PaymentMethodId
	}
	return ""
}

func (x *CreateInstallmentPlanRequest) GetIdempotencyKey() string {
	if x != nil {
		return x.IdempotencyKey
	}
	return ""
}

// CreateInstallmentPlanResponse is the response for CreateInstallmentPlan.
type CreateInstallmentPlanResponse struct {
	Plan                        *InstallmentPlan `protobuf:"bytes,1,opt,name=plan,proto3" json:"plan,omitempty"`
	FirstInstallmentClientSecret string          `protobuf:"bytes,2,opt,name=first_installment_client_secret,json=firstInstallmentClientSecret,proto3" json:"first_installment_client_secret,omitempty"`
}

func (x *CreateInstallmentPlanResponse) GetPlan() *InstallmentPlan {
	if x != nil {
		return x.Plan
	}
	return nil
}

func (x *CreateInstallmentPlanResponse) GetFirstInstallmentClientSecret() string {
	if x != nil {
		return x.FirstInstallmentClientSecret
	}
	return ""
}

// GetInstallmentPlanRequest is the request for GetInstallmentPlan.
type GetInstallmentPlanRequest struct {
	PlanId string `protobuf:"bytes,1,opt,name=plan_id,json=planId,proto3" json:"plan_id,omitempty"`
}

func (x *GetInstallmentPlanRequest) GetPlanId() string {
	if x != nil {
		return x.PlanId
	}
	return ""
}

// GetInstallmentPlanResponse is the response for GetInstallmentPlan.
type GetInstallmentPlanResponse struct {
	Plan *InstallmentPlan `protobuf:"bytes,1,opt,name=plan,proto3" json:"plan,omitempty"`
}

func (x *GetInstallmentPlanResponse) GetPlan() *InstallmentPlan {
	if x != nil {
		return x.Plan
	}
	return nil
}

// ListInstallmentPlansRequest is the request for ListInstallmentPlans.
type ListInstallmentPlansRequest struct {
	UserId       string  `protobuf:"bytes,1,opt,name=user_id,json=userId,proto3" json:"user_id,omitempty"`
	StatusFilter *string `protobuf:"bytes,2,opt,name=status_filter,json=statusFilter,proto3,oneof" json:"status_filter,omitempty"`
}

func (x *ListInstallmentPlansRequest) GetUserId() string {
	if x != nil {
		return x.UserId
	}
	return ""
}

func (x *ListInstallmentPlansRequest) GetStatusFilter() string {
	if x != nil && x.StatusFilter != nil {
		return *x.StatusFilter
	}
	return ""
}

// ListInstallmentPlansResponse is the response for ListInstallmentPlans.
type ListInstallmentPlansResponse struct {
	Plans []*InstallmentPlan `protobuf:"bytes,1,rep,name=plans,proto3" json:"plans,omitempty"`
}

func (x *ListInstallmentPlansResponse) GetPlans() []*InstallmentPlan {
	if x != nil {
		return x.Plans
	}
	return nil
}

// ProtoMessage, ProtoReflect, Reset stubs for protobuf compatibility.
func (*ScheduledInstallment) ProtoMessage()             {}
func (*ScheduledInstallment) Reset()                    {}
func (*ScheduledInstallment) String() string            { return "" }

func (*InstallmentPlan) ProtoMessage()             {}
func (*InstallmentPlan) Reset()                    {}
func (*InstallmentPlan) String() string            { return "" }

func (*CreateInstallmentPlanRequest) ProtoMessage()  {}
func (*CreateInstallmentPlanRequest) Reset()         {}
func (*CreateInstallmentPlanRequest) String() string { return "" }

func (*CreateInstallmentPlanResponse) ProtoMessage()  {}
func (*CreateInstallmentPlanResponse) Reset()         {}
func (*CreateInstallmentPlanResponse) String() string { return "" }

func (*GetInstallmentPlanRequest) ProtoMessage()  {}
func (*GetInstallmentPlanRequest) Reset()         {}
func (*GetInstallmentPlanRequest) String() string { return "" }

func (*GetInstallmentPlanResponse) ProtoMessage()  {}
func (*GetInstallmentPlanResponse) Reset()         {}
func (*GetInstallmentPlanResponse) String() string { return "" }

func (*ListInstallmentPlansRequest) ProtoMessage()  {}
func (*ListInstallmentPlansRequest) Reset()         {}
func (*ListInstallmentPlansRequest) String() string { return "" }

func (*ListInstallmentPlansResponse) ProtoMessage()  {}
func (*ListInstallmentPlansResponse) Reset()         {}
func (*ListInstallmentPlansResponse) String() string { return "" }
