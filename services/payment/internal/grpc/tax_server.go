package grpc

import (
	"context"
	"errors"
	"fmt"

	paymentv1 "github.com/nomarkup/nomarkup/proto/payment/v1"
	"github.com/nomarkup/nomarkup/services/payment/internal/domain"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// GenerateTaxForm generates a 1099-NEC tax form for a provider.
func (s *Server) GenerateTaxForm(ctx context.Context, req *paymentv1.GenerateTaxFormRequest) (*paymentv1.GenerateTaxFormResponse, error) {
	if req.GetProviderId() == "" {
		return nil, status.Error(codes.InvalidArgument, "provider_id is required")
	}
	if req.GetTaxYear() <= 0 {
		return nil, status.Error(codes.InvalidArgument, "tax_year is required")
	}

	tf, err := s.svc.GenerateTaxForm(ctx, req.GetProviderId(), int(req.GetTaxYear()))
	if err != nil {
		return nil, mapTaxError(err)
	}

	return &paymentv1.GenerateTaxFormResponse{
		TaxForm: domainTaxFormToProto(tf),
	}, nil
}

// GetTaxForm retrieves a tax form by provider ID and year.
func (s *Server) GetTaxForm(ctx context.Context, req *paymentv1.GetTaxFormRequest) (*paymentv1.GetTaxFormResponse, error) {
	if req.GetProviderId() == "" {
		return nil, status.Error(codes.InvalidArgument, "provider_id is required")
	}
	if req.GetTaxYear() <= 0 {
		return nil, status.Error(codes.InvalidArgument, "tax_year is required")
	}

	tf, err := s.svc.GetTaxForm(ctx, req.GetProviderId(), int(req.GetTaxYear()))
	if err != nil {
		return nil, mapTaxError(err)
	}

	return &paymentv1.GetTaxFormResponse{
		TaxForm: domainTaxFormToProto(tf),
	}, nil
}

// ListTaxForms returns all tax forms for a provider.
func (s *Server) ListTaxForms(ctx context.Context, req *paymentv1.ListTaxFormsRequest) (*paymentv1.ListTaxFormsResponse, error) {
	if req.GetProviderId() == "" {
		return nil, status.Error(codes.InvalidArgument, "provider_id is required")
	}

	forms, err := s.svc.ListTaxForms(ctx, req.GetProviderId())
	if err != nil {
		return nil, mapTaxError(err)
	}

	protoForms := make([]*paymentv1.TaxForm, 0, len(forms))
	for _, tf := range forms {
		protoForms = append(protoForms, domainTaxFormToProto(tf))
	}

	return &paymentv1.ListTaxFormsResponse{
		Forms: protoForms,
	}, nil
}

// GenerateInvoice generates an invoice URL for a contract.
func (s *Server) GenerateInvoice(ctx context.Context, req *paymentv1.GenerateInvoiceRequest) (*paymentv1.GenerateInvoiceResponse, error) {
	if req.GetContractId() == "" {
		return nil, status.Error(codes.InvalidArgument, "contract_id is required")
	}

	// Verify the contract exists by generating the invoice HTML.
	// The actual HTML is served via the download endpoint; here we just validate and return the URL.
	_, err := s.svc.GenerateInvoice(ctx, req.GetContractId())
	if err != nil {
		return nil, mapTaxError(err)
	}

	invoiceURL := fmt.Sprintf("/api/v1/contracts/%s/invoice/download", req.GetContractId())

	return &paymentv1.GenerateInvoiceResponse{
		InvoiceUrl: invoiceURL,
	}, nil
}

// GetTaxFormHTML returns the HTML content for a tax form.
func (s *Server) GetTaxFormHTML(ctx context.Context, req *paymentv1.GetTaxFormHTMLRequest) (*paymentv1.GetTaxFormHTMLResponse, error) {
	if req.GetProviderId() == "" {
		return nil, status.Error(codes.InvalidArgument, "provider_id is required")
	}
	if req.GetTaxYear() <= 0 {
		return nil, status.Error(codes.InvalidArgument, "tax_year is required")
	}

	html, err := s.svc.GenerateTaxFormHTML(ctx, req.GetProviderId(), int(req.GetTaxYear()))
	if err != nil {
		return nil, mapTaxError(err)
	}

	return &paymentv1.GetTaxFormHTMLResponse{Html: html}, nil
}

// GetInvoiceHTML returns the HTML content for a contract invoice.
func (s *Server) GetInvoiceHTML(ctx context.Context, req *paymentv1.GetInvoiceHTMLRequest) (*paymentv1.GetInvoiceHTMLResponse, error) {
	if req.GetContractId() == "" {
		return nil, status.Error(codes.InvalidArgument, "contract_id is required")
	}

	html, err := s.svc.GenerateInvoice(ctx, req.GetContractId())
	if err != nil {
		return nil, mapTaxError(err)
	}

	return &paymentv1.GetInvoiceHTMLResponse{Html: html}, nil
}

// --- Conversion helpers ---

func domainTaxFormToProto(tf *domain.TaxForm) *paymentv1.TaxForm {
	if tf == nil {
		return nil
	}

	pb := &paymentv1.TaxForm{
		Id:                      tf.ID,
		ProviderId:              tf.ProviderID,
		TaxYear:                 int32(tf.TaxYear),
		FormType:                tf.FormType,
		ProviderLegalName:       tf.ProviderLegalName,
		ProviderAddress:         tf.ProviderAddress,
		TotalCompensationCents:  tf.TotalCompensationCents,
		FederalTaxWithheldCents: tf.FederalTaxWithheldCents,
		StateTaxWithheldCents:   tf.StateTaxWithheldCents,
		PlatformEin:             tf.PlatformEIN,
		PlatformName:            tf.PlatformName,
		Status:                  tf.Status,
		CreatedAt:               timestamppb.New(tf.CreatedAt),
		UpdatedAt:               timestamppb.New(tf.UpdatedAt),
	}

	if tf.ProviderTaxIDLast4 != nil {
		pb.ProviderTaxIdLast4 = *tf.ProviderTaxIDLast4
	}
	if tf.PDFURL != nil {
		pb.PdfUrl = *tf.PDFURL
	}
	if tf.DeliveredAt != nil {
		pb.DeliveredAt = timestamppb.New(*tf.DeliveredAt)
	}
	if tf.FiledAt != nil {
		pb.FiledAt = timestamppb.New(*tf.FiledAt)
	}

	return pb
}

func mapTaxError(err error) error {
	switch {
	case errors.Is(err, domain.ErrTaxFormNotFound):
		return status.Error(codes.NotFound, "tax form not found")
	case errors.Is(err, domain.ErrContractNotFound):
		return status.Error(codes.NotFound, "contract not found")
	case errors.Is(err, domain.ErrInvalidAmount):
		return status.Error(codes.InvalidArgument, "invalid amount")
	default:
		return status.Error(codes.Internal, "internal error")
	}
}
