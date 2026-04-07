package paymentv1

import (
	context "context"
	grpc "google.golang.org/grpc"
)

// Full method name constants for tax/invoice RPCs.
const (
	PaymentService_GenerateTaxForm_FullMethodName = "/nomarkup.payment.v1.PaymentService/GenerateTaxForm"
	PaymentService_GetTaxForm_FullMethodName      = "/nomarkup.payment.v1.PaymentService/GetTaxForm"
	PaymentService_ListTaxForms_FullMethodName    = "/nomarkup.payment.v1.PaymentService/ListTaxForms"
	PaymentService_GenerateInvoice_FullMethodName = "/nomarkup.payment.v1.PaymentService/GenerateInvoice"
	PaymentService_GetTaxFormHTML_FullMethodName   = "/nomarkup.payment.v1.PaymentService/GetTaxFormHTML"
	PaymentService_GetInvoiceHTML_FullMethodName   = "/nomarkup.payment.v1.PaymentService/GetInvoiceHTML"
)

// TaxInvoiceServiceClient is the client API for tax/invoice RPCs.
// It is satisfied by PaymentServiceClient since the methods are added there.
type TaxInvoiceServiceClient interface {
	GenerateTaxForm(ctx context.Context, in *GenerateTaxFormRequest, opts ...grpc.CallOption) (*GenerateTaxFormResponse, error)
	GetTaxForm(ctx context.Context, in *GetTaxFormRequest, opts ...grpc.CallOption) (*GetTaxFormResponse, error)
	ListTaxForms(ctx context.Context, in *ListTaxFormsRequest, opts ...grpc.CallOption) (*ListTaxFormsResponse, error)
	GenerateInvoice(ctx context.Context, in *GenerateInvoiceRequest, opts ...grpc.CallOption) (*GenerateInvoiceResponse, error)
	GetTaxFormHTML(ctx context.Context, in *GetTaxFormHTMLRequest, opts ...grpc.CallOption) (*GetTaxFormHTMLResponse, error)
	GetInvoiceHTML(ctx context.Context, in *GetInvoiceHTMLRequest, opts ...grpc.CallOption) (*GetInvoiceHTMLResponse, error)
}

// NewTaxInvoiceServiceClient creates a client for tax/invoice RPCs using the same connection.
// Returns a PaymentServiceClient which satisfies TaxInvoiceServiceClient.
func NewTaxInvoiceServiceClient(cc grpc.ClientConnInterface) TaxInvoiceServiceClient {
	return NewPaymentServiceClient(cc)
}
