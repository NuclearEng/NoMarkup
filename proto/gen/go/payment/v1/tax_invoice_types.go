package paymentv1

import (
	"google.golang.org/protobuf/types/known/timestamppb"
)

// TaxForm represents a tax form record (1099-NEC or 1099-K).
type TaxForm struct {
	Id                       string                 `protobuf:"bytes,1,opt,name=id,proto3" json:"id,omitempty"`
	ProviderId               string                 `protobuf:"bytes,2,opt,name=provider_id,json=providerId,proto3" json:"provider_id,omitempty"`
	TaxYear                  int32                  `protobuf:"varint,3,opt,name=tax_year,json=taxYear,proto3" json:"tax_year,omitempty"`
	FormType                 string                 `protobuf:"bytes,4,opt,name=form_type,json=formType,proto3" json:"form_type,omitempty"`
	ProviderLegalName        string                 `protobuf:"bytes,5,opt,name=provider_legal_name,json=providerLegalName,proto3" json:"provider_legal_name,omitempty"`
	ProviderTaxIdLast4       string                 `protobuf:"bytes,6,opt,name=provider_tax_id_last4,json=providerTaxIdLast4,proto3" json:"provider_tax_id_last4,omitempty"`
	ProviderAddress          string                 `protobuf:"bytes,7,opt,name=provider_address,json=providerAddress,proto3" json:"provider_address,omitempty"`
	TotalCompensationCents   int64                  `protobuf:"varint,8,opt,name=total_compensation_cents,json=totalCompensationCents,proto3" json:"total_compensation_cents,omitempty"`
	FederalTaxWithheldCents  int64                  `protobuf:"varint,9,opt,name=federal_tax_withheld_cents,json=federalTaxWithheldCents,proto3" json:"federal_tax_withheld_cents,omitempty"`
	StateTaxWithheldCents    int64                  `protobuf:"varint,10,opt,name=state_tax_withheld_cents,json=stateTaxWithheldCents,proto3" json:"state_tax_withheld_cents,omitempty"`
	PlatformEin              string                 `protobuf:"bytes,11,opt,name=platform_ein,json=platformEin,proto3" json:"platform_ein,omitempty"`
	PlatformName             string                 `protobuf:"bytes,12,opt,name=platform_name,json=platformName,proto3" json:"platform_name,omitempty"`
	PdfUrl                   string                 `protobuf:"bytes,13,opt,name=pdf_url,json=pdfUrl,proto3" json:"pdf_url,omitempty"`
	Status                   string                 `protobuf:"bytes,14,opt,name=status,proto3" json:"status,omitempty"`
	DeliveredAt              *timestamppb.Timestamp `protobuf:"bytes,15,opt,name=delivered_at,json=deliveredAt,proto3" json:"delivered_at,omitempty"`
	FiledAt                  *timestamppb.Timestamp `protobuf:"bytes,16,opt,name=filed_at,json=filedAt,proto3" json:"filed_at,omitempty"`
	CreatedAt                *timestamppb.Timestamp `protobuf:"bytes,17,opt,name=created_at,json=createdAt,proto3" json:"created_at,omitempty"`
	UpdatedAt                *timestamppb.Timestamp `protobuf:"bytes,18,opt,name=updated_at,json=updatedAt,proto3" json:"updated_at,omitempty"`
}

func (x *TaxForm) GetId() string {
	if x != nil {
		return x.Id
	}
	return ""
}

func (x *TaxForm) GetProviderId() string {
	if x != nil {
		return x.ProviderId
	}
	return ""
}

func (x *TaxForm) GetTaxYear() int32 {
	if x != nil {
		return x.TaxYear
	}
	return 0
}

func (x *TaxForm) GetFormType() string {
	if x != nil {
		return x.FormType
	}
	return ""
}

func (x *TaxForm) GetProviderLegalName() string {
	if x != nil {
		return x.ProviderLegalName
	}
	return ""
}

func (x *TaxForm) GetProviderTaxIdLast4() string {
	if x != nil {
		return x.ProviderTaxIdLast4
	}
	return ""
}

func (x *TaxForm) GetProviderAddress() string {
	if x != nil {
		return x.ProviderAddress
	}
	return ""
}

func (x *TaxForm) GetTotalCompensationCents() int64 {
	if x != nil {
		return x.TotalCompensationCents
	}
	return 0
}

func (x *TaxForm) GetFederalTaxWithheldCents() int64 {
	if x != nil {
		return x.FederalTaxWithheldCents
	}
	return 0
}

func (x *TaxForm) GetStateTaxWithheldCents() int64 {
	if x != nil {
		return x.StateTaxWithheldCents
	}
	return 0
}

func (x *TaxForm) GetPlatformEin() string {
	if x != nil {
		return x.PlatformEin
	}
	return ""
}

func (x *TaxForm) GetPlatformName() string {
	if x != nil {
		return x.PlatformName
	}
	return ""
}

func (x *TaxForm) GetPdfUrl() string {
	if x != nil {
		return x.PdfUrl
	}
	return ""
}

func (x *TaxForm) GetStatus() string {
	if x != nil {
		return x.Status
	}
	return ""
}

func (x *TaxForm) GetDeliveredAt() *timestamppb.Timestamp {
	if x != nil {
		return x.DeliveredAt
	}
	return nil
}

func (x *TaxForm) GetFiledAt() *timestamppb.Timestamp {
	if x != nil {
		return x.FiledAt
	}
	return nil
}

func (x *TaxForm) GetCreatedAt() *timestamppb.Timestamp {
	if x != nil {
		return x.CreatedAt
	}
	return nil
}

func (x *TaxForm) GetUpdatedAt() *timestamppb.Timestamp {
	if x != nil {
		return x.UpdatedAt
	}
	return nil
}

// GenerateTaxFormRequest is the request for GenerateTaxForm RPC.
type GenerateTaxFormRequest struct {
	ProviderId string `protobuf:"bytes,1,opt,name=provider_id,json=providerId,proto3" json:"provider_id,omitempty"`
	TaxYear    int32  `protobuf:"varint,2,opt,name=tax_year,json=taxYear,proto3" json:"tax_year,omitempty"`
}

func (x *GenerateTaxFormRequest) GetProviderId() string {
	if x != nil {
		return x.ProviderId
	}
	return ""
}

func (x *GenerateTaxFormRequest) GetTaxYear() int32 {
	if x != nil {
		return x.TaxYear
	}
	return 0
}

// GenerateTaxFormResponse is the response for GenerateTaxForm RPC.
type GenerateTaxFormResponse struct {
	TaxForm *TaxForm `protobuf:"bytes,1,opt,name=tax_form,json=taxForm,proto3" json:"tax_form,omitempty"`
}

func (x *GenerateTaxFormResponse) GetTaxForm() *TaxForm {
	if x != nil {
		return x.TaxForm
	}
	return nil
}

// GetTaxFormRequest is the request for GetTaxForm RPC.
type GetTaxFormRequest struct {
	ProviderId string `protobuf:"bytes,1,opt,name=provider_id,json=providerId,proto3" json:"provider_id,omitempty"`
	TaxYear    int32  `protobuf:"varint,2,opt,name=tax_year,json=taxYear,proto3" json:"tax_year,omitempty"`
}

func (x *GetTaxFormRequest) GetProviderId() string {
	if x != nil {
		return x.ProviderId
	}
	return ""
}

func (x *GetTaxFormRequest) GetTaxYear() int32 {
	if x != nil {
		return x.TaxYear
	}
	return 0
}

// GetTaxFormResponse is the response for GetTaxForm RPC.
type GetTaxFormResponse struct {
	TaxForm *TaxForm `protobuf:"bytes,1,opt,name=tax_form,json=taxForm,proto3" json:"tax_form,omitempty"`
}

func (x *GetTaxFormResponse) GetTaxForm() *TaxForm {
	if x != nil {
		return x.TaxForm
	}
	return nil
}

// ListTaxFormsRequest is the request for ListTaxForms RPC.
type ListTaxFormsRequest struct {
	ProviderId string `protobuf:"bytes,1,opt,name=provider_id,json=providerId,proto3" json:"provider_id,omitempty"`
}

func (x *ListTaxFormsRequest) GetProviderId() string {
	if x != nil {
		return x.ProviderId
	}
	return ""
}

// ListTaxFormsResponse is the response for ListTaxForms RPC.
type ListTaxFormsResponse struct {
	Forms []*TaxForm `protobuf:"bytes,1,rep,name=forms,proto3" json:"forms,omitempty"`
}

func (x *ListTaxFormsResponse) GetForms() []*TaxForm {
	if x != nil {
		return x.Forms
	}
	return nil
}

// GenerateInvoiceRequest is the request for GenerateInvoice RPC.
type GenerateInvoiceRequest struct {
	ContractId string `protobuf:"bytes,1,opt,name=contract_id,json=contractId,proto3" json:"contract_id,omitempty"`
}

func (x *GenerateInvoiceRequest) GetContractId() string {
	if x != nil {
		return x.ContractId
	}
	return ""
}

// GenerateInvoiceResponse is the response for GenerateInvoice RPC.
type GenerateInvoiceResponse struct {
	InvoiceUrl string `protobuf:"bytes,1,opt,name=invoice_url,json=invoiceUrl,proto3" json:"invoice_url,omitempty"`
}

func (x *GenerateInvoiceResponse) GetInvoiceUrl() string {
	if x != nil {
		return x.InvoiceUrl
	}
	return ""
}

// GetTaxFormHTMLRequest is the request for GetTaxFormHTML RPC.
type GetTaxFormHTMLRequest struct {
	ProviderId string `protobuf:"bytes,1,opt,name=provider_id,json=providerId,proto3" json:"provider_id,omitempty"`
	TaxYear    int32  `protobuf:"varint,2,opt,name=tax_year,json=taxYear,proto3" json:"tax_year,omitempty"`
}

func (x *GetTaxFormHTMLRequest) GetProviderId() string {
	if x != nil {
		return x.ProviderId
	}
	return ""
}

func (x *GetTaxFormHTMLRequest) GetTaxYear() int32 {
	if x != nil {
		return x.TaxYear
	}
	return 0
}

// GetTaxFormHTMLResponse is the response for GetTaxFormHTML RPC.
type GetTaxFormHTMLResponse struct {
	Html string `protobuf:"bytes,1,opt,name=html,proto3" json:"html,omitempty"`
}

func (x *GetTaxFormHTMLResponse) GetHtml() string {
	if x != nil {
		return x.Html
	}
	return ""
}

// GetInvoiceHTMLRequest is the request for GetInvoiceHTML RPC.
type GetInvoiceHTMLRequest struct {
	ContractId string `protobuf:"bytes,1,opt,name=contract_id,json=contractId,proto3" json:"contract_id,omitempty"`
}

func (x *GetInvoiceHTMLRequest) GetContractId() string {
	if x != nil {
		return x.ContractId
	}
	return ""
}

// GetInvoiceHTMLResponse is the response for GetInvoiceHTML RPC.
type GetInvoiceHTMLResponse struct {
	Html string `protobuf:"bytes,1,opt,name=html,proto3" json:"html,omitempty"`
}

func (x *GetInvoiceHTMLResponse) GetHtml() string {
	if x != nil {
		return x.Html
	}
	return ""
}
