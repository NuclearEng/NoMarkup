// Hand-written gRPC client/server stubs for insurance RPCs.
// These supplement the generated payment_grpc.pb.go until protoc is re-run.
package paymentv1

import (
	context "context"
	grpc "google.golang.org/grpc"
)

const (
	PaymentService_ListInsuranceProducts_FullMethodName   = "/nomarkup.payment.v1.PaymentService/ListInsuranceProducts"
	PaymentService_GetInsuranceQuote_FullMethodName        = "/nomarkup.payment.v1.PaymentService/GetInsuranceQuote"
	PaymentService_PurchaseInsurance_FullMethodName        = "/nomarkup.payment.v1.PaymentService/PurchaseInsurance"
	PaymentService_GetInsurancePolicy_FullMethodName       = "/nomarkup.payment.v1.PaymentService/GetInsurancePolicy"
	PaymentService_ListInsurancePolicies_FullMethodName    = "/nomarkup.payment.v1.PaymentService/ListInsurancePolicies"
	PaymentService_FileInsuranceClaim_FullMethodName       = "/nomarkup.payment.v1.PaymentService/FileInsuranceClaim"
	PaymentService_GetInsuranceClaim_FullMethodName        = "/nomarkup.payment.v1.PaymentService/GetInsuranceClaim"
	PaymentService_ReviewInsuranceClaim_FullMethodName     = "/nomarkup.payment.v1.PaymentService/ReviewInsuranceClaim"
	PaymentService_AdminListInsuranceClaims_FullMethodName = "/nomarkup.payment.v1.PaymentService/AdminListInsuranceClaims"
)

// InsuranceServiceClient provides insurance RPC methods on the PaymentService client.
// This is an extension interface — the methods are added via wrapper functions
// rather than modifying the generated PaymentServiceClient interface.
type InsuranceServiceClient interface {
	ListInsuranceProducts(ctx context.Context, in *ListInsuranceProductsRequest, opts ...grpc.CallOption) (*ListInsuranceProductsResponse, error)
	GetInsuranceQuote(ctx context.Context, in *GetInsuranceQuoteRequest, opts ...grpc.CallOption) (*GetInsuranceQuoteResponse, error)
	PurchaseInsurance(ctx context.Context, in *PurchaseInsuranceRequest, opts ...grpc.CallOption) (*PurchaseInsuranceResponse, error)
	GetInsurancePolicy(ctx context.Context, in *GetInsurancePolicyRequest, opts ...grpc.CallOption) (*GetInsurancePolicyResponse, error)
	ListInsurancePolicies(ctx context.Context, in *ListInsurancePoliciesRequest, opts ...grpc.CallOption) (*ListInsurancePoliciesResponse, error)
	FileInsuranceClaim(ctx context.Context, in *FileInsuranceClaimRequest, opts ...grpc.CallOption) (*FileInsuranceClaimResponse, error)
	GetInsuranceClaim(ctx context.Context, in *GetInsuranceClaimRequest, opts ...grpc.CallOption) (*GetInsuranceClaimResponse, error)
	ReviewInsuranceClaim(ctx context.Context, in *ReviewInsuranceClaimRequest, opts ...grpc.CallOption) (*ReviewInsuranceClaimResponse, error)
	AdminListInsuranceClaims(ctx context.Context, in *AdminListInsuranceClaimsRequest, opts ...grpc.CallOption) (*AdminListInsuranceClaimsResponse, error)
}

type insuranceServiceClient struct {
	cc grpc.ClientConnInterface
}

// NewInsuranceServiceClient creates a client for insurance RPCs using an existing gRPC connection.
func NewInsuranceServiceClient(cc grpc.ClientConnInterface) InsuranceServiceClient {
	return &insuranceServiceClient{cc}
}

func (c *insuranceServiceClient) ListInsuranceProducts(ctx context.Context, in *ListInsuranceProductsRequest, opts ...grpc.CallOption) (*ListInsuranceProductsResponse, error) {
	cOpts := append([]grpc.CallOption{grpc.StaticMethod()}, opts...)
	out := new(ListInsuranceProductsResponse)
	err := c.cc.Invoke(ctx, PaymentService_ListInsuranceProducts_FullMethodName, in, out, cOpts...)
	if err != nil {
		return nil, err
	}
	return out, nil
}

func (c *insuranceServiceClient) GetInsuranceQuote(ctx context.Context, in *GetInsuranceQuoteRequest, opts ...grpc.CallOption) (*GetInsuranceQuoteResponse, error) {
	cOpts := append([]grpc.CallOption{grpc.StaticMethod()}, opts...)
	out := new(GetInsuranceQuoteResponse)
	err := c.cc.Invoke(ctx, PaymentService_GetInsuranceQuote_FullMethodName, in, out, cOpts...)
	if err != nil {
		return nil, err
	}
	return out, nil
}

func (c *insuranceServiceClient) PurchaseInsurance(ctx context.Context, in *PurchaseInsuranceRequest, opts ...grpc.CallOption) (*PurchaseInsuranceResponse, error) {
	cOpts := append([]grpc.CallOption{grpc.StaticMethod()}, opts...)
	out := new(PurchaseInsuranceResponse)
	err := c.cc.Invoke(ctx, PaymentService_PurchaseInsurance_FullMethodName, in, out, cOpts...)
	if err != nil {
		return nil, err
	}
	return out, nil
}

func (c *insuranceServiceClient) GetInsurancePolicy(ctx context.Context, in *GetInsurancePolicyRequest, opts ...grpc.CallOption) (*GetInsurancePolicyResponse, error) {
	cOpts := append([]grpc.CallOption{grpc.StaticMethod()}, opts...)
	out := new(GetInsurancePolicyResponse)
	err := c.cc.Invoke(ctx, PaymentService_GetInsurancePolicy_FullMethodName, in, out, cOpts...)
	if err != nil {
		return nil, err
	}
	return out, nil
}

func (c *insuranceServiceClient) ListInsurancePolicies(ctx context.Context, in *ListInsurancePoliciesRequest, opts ...grpc.CallOption) (*ListInsurancePoliciesResponse, error) {
	cOpts := append([]grpc.CallOption{grpc.StaticMethod()}, opts...)
	out := new(ListInsurancePoliciesResponse)
	err := c.cc.Invoke(ctx, PaymentService_ListInsurancePolicies_FullMethodName, in, out, cOpts...)
	if err != nil {
		return nil, err
	}
	return out, nil
}

func (c *insuranceServiceClient) FileInsuranceClaim(ctx context.Context, in *FileInsuranceClaimRequest, opts ...grpc.CallOption) (*FileInsuranceClaimResponse, error) {
	cOpts := append([]grpc.CallOption{grpc.StaticMethod()}, opts...)
	out := new(FileInsuranceClaimResponse)
	err := c.cc.Invoke(ctx, PaymentService_FileInsuranceClaim_FullMethodName, in, out, cOpts...)
	if err != nil {
		return nil, err
	}
	return out, nil
}

func (c *insuranceServiceClient) GetInsuranceClaim(ctx context.Context, in *GetInsuranceClaimRequest, opts ...grpc.CallOption) (*GetInsuranceClaimResponse, error) {
	cOpts := append([]grpc.CallOption{grpc.StaticMethod()}, opts...)
	out := new(GetInsuranceClaimResponse)
	err := c.cc.Invoke(ctx, PaymentService_GetInsuranceClaim_FullMethodName, in, out, cOpts...)
	if err != nil {
		return nil, err
	}
	return out, nil
}

func (c *insuranceServiceClient) ReviewInsuranceClaim(ctx context.Context, in *ReviewInsuranceClaimRequest, opts ...grpc.CallOption) (*ReviewInsuranceClaimResponse, error) {
	cOpts := append([]grpc.CallOption{grpc.StaticMethod()}, opts...)
	out := new(ReviewInsuranceClaimResponse)
	err := c.cc.Invoke(ctx, PaymentService_ReviewInsuranceClaim_FullMethodName, in, out, cOpts...)
	if err != nil {
		return nil, err
	}
	return out, nil
}

func (c *insuranceServiceClient) AdminListInsuranceClaims(ctx context.Context, in *AdminListInsuranceClaimsRequest, opts ...grpc.CallOption) (*AdminListInsuranceClaimsResponse, error) {
	cOpts := append([]grpc.CallOption{grpc.StaticMethod()}, opts...)
	out := new(AdminListInsuranceClaimsResponse)
	err := c.cc.Invoke(ctx, PaymentService_AdminListInsuranceClaims_FullMethodName, in, out, cOpts...)
	if err != nil {
		return nil, err
	}
	return out, nil
}

// InsuranceServiceServer is the server interface for insurance RPCs.
type InsuranceServiceServer interface {
	ListInsuranceProducts(context.Context, *ListInsuranceProductsRequest) (*ListInsuranceProductsResponse, error)
	GetInsuranceQuote(context.Context, *GetInsuranceQuoteRequest) (*GetInsuranceQuoteResponse, error)
	PurchaseInsurance(context.Context, *PurchaseInsuranceRequest) (*PurchaseInsuranceResponse, error)
	GetInsurancePolicy(context.Context, *GetInsurancePolicyRequest) (*GetInsurancePolicyResponse, error)
	ListInsurancePolicies(context.Context, *ListInsurancePoliciesRequest) (*ListInsurancePoliciesResponse, error)
	FileInsuranceClaim(context.Context, *FileInsuranceClaimRequest) (*FileInsuranceClaimResponse, error)
	GetInsuranceClaim(context.Context, *GetInsuranceClaimRequest) (*GetInsuranceClaimResponse, error)
	ReviewInsuranceClaim(context.Context, *ReviewInsuranceClaimRequest) (*ReviewInsuranceClaimResponse, error)
	AdminListInsuranceClaims(context.Context, *AdminListInsuranceClaimsRequest) (*AdminListInsuranceClaimsResponse, error)
}

// InsuranceServiceDesc is the grpc.ServiceDesc for the insurance RPCs.
// It is registered as a separate gRPC service from the main PaymentService.
var InsuranceServiceDesc = grpc.ServiceDesc{
	ServiceName: "nomarkup.payment.v1.InsuranceService",
	HandlerType: (*InsuranceServiceServer)(nil),
	Methods: []grpc.MethodDesc{
		{
			MethodName: "ListInsuranceProducts",
			Handler:    _InsuranceService_ListInsuranceProducts_Handler,
		},
		{
			MethodName: "GetInsuranceQuote",
			Handler:    _InsuranceService_GetInsuranceQuote_Handler,
		},
		{
			MethodName: "PurchaseInsurance",
			Handler:    _InsuranceService_PurchaseInsurance_Handler,
		},
		{
			MethodName: "GetInsurancePolicy",
			Handler:    _InsuranceService_GetInsurancePolicy_Handler,
		},
		{
			MethodName: "ListInsurancePolicies",
			Handler:    _InsuranceService_ListInsurancePolicies_Handler,
		},
		{
			MethodName: "FileInsuranceClaim",
			Handler:    _InsuranceService_FileInsuranceClaim_Handler,
		},
		{
			MethodName: "GetInsuranceClaim",
			Handler:    _InsuranceService_GetInsuranceClaim_Handler,
		},
		{
			MethodName: "ReviewInsuranceClaim",
			Handler:    _InsuranceService_ReviewInsuranceClaim_Handler,
		},
		{
			MethodName: "AdminListInsuranceClaims",
			Handler:    _InsuranceService_AdminListInsuranceClaims_Handler,
		},
	},
	Streams:  []grpc.StreamDesc{},
	Metadata: "payment/v1/payment.proto",
}

func RegisterInsuranceServiceServer(s grpc.ServiceRegistrar, srv InsuranceServiceServer) {
	s.RegisterService(&InsuranceServiceDesc, srv)
}

func _InsuranceService_ListInsuranceProducts_Handler(srv interface{}, ctx context.Context, dec func(interface{}) error, interceptor grpc.UnaryServerInterceptor) (interface{}, error) {
	in := new(ListInsuranceProductsRequest)
	if err := dec(in); err != nil { return nil, err }
	if interceptor == nil { return srv.(InsuranceServiceServer).ListInsuranceProducts(ctx, in) }
	info := &grpc.UnaryServerInfo{Server: srv, FullMethod: PaymentService_ListInsuranceProducts_FullMethodName}
	return interceptor(ctx, in, info, func(ctx context.Context, req interface{}) (interface{}, error) { return srv.(InsuranceServiceServer).ListInsuranceProducts(ctx, req.(*ListInsuranceProductsRequest)) })
}

func _InsuranceService_GetInsuranceQuote_Handler(srv interface{}, ctx context.Context, dec func(interface{}) error, interceptor grpc.UnaryServerInterceptor) (interface{}, error) {
	in := new(GetInsuranceQuoteRequest)
	if err := dec(in); err != nil { return nil, err }
	if interceptor == nil { return srv.(InsuranceServiceServer).GetInsuranceQuote(ctx, in) }
	info := &grpc.UnaryServerInfo{Server: srv, FullMethod: PaymentService_GetInsuranceQuote_FullMethodName}
	return interceptor(ctx, in, info, func(ctx context.Context, req interface{}) (interface{}, error) { return srv.(InsuranceServiceServer).GetInsuranceQuote(ctx, req.(*GetInsuranceQuoteRequest)) })
}

func _InsuranceService_PurchaseInsurance_Handler(srv interface{}, ctx context.Context, dec func(interface{}) error, interceptor grpc.UnaryServerInterceptor) (interface{}, error) {
	in := new(PurchaseInsuranceRequest)
	if err := dec(in); err != nil { return nil, err }
	if interceptor == nil { return srv.(InsuranceServiceServer).PurchaseInsurance(ctx, in) }
	info := &grpc.UnaryServerInfo{Server: srv, FullMethod: PaymentService_PurchaseInsurance_FullMethodName}
	return interceptor(ctx, in, info, func(ctx context.Context, req interface{}) (interface{}, error) { return srv.(InsuranceServiceServer).PurchaseInsurance(ctx, req.(*PurchaseInsuranceRequest)) })
}

func _InsuranceService_GetInsurancePolicy_Handler(srv interface{}, ctx context.Context, dec func(interface{}) error, interceptor grpc.UnaryServerInterceptor) (interface{}, error) {
	in := new(GetInsurancePolicyRequest)
	if err := dec(in); err != nil { return nil, err }
	if interceptor == nil { return srv.(InsuranceServiceServer).GetInsurancePolicy(ctx, in) }
	info := &grpc.UnaryServerInfo{Server: srv, FullMethod: PaymentService_GetInsurancePolicy_FullMethodName}
	return interceptor(ctx, in, info, func(ctx context.Context, req interface{}) (interface{}, error) { return srv.(InsuranceServiceServer).GetInsurancePolicy(ctx, req.(*GetInsurancePolicyRequest)) })
}

func _InsuranceService_ListInsurancePolicies_Handler(srv interface{}, ctx context.Context, dec func(interface{}) error, interceptor grpc.UnaryServerInterceptor) (interface{}, error) {
	in := new(ListInsurancePoliciesRequest)
	if err := dec(in); err != nil { return nil, err }
	if interceptor == nil { return srv.(InsuranceServiceServer).ListInsurancePolicies(ctx, in) }
	info := &grpc.UnaryServerInfo{Server: srv, FullMethod: PaymentService_ListInsurancePolicies_FullMethodName}
	return interceptor(ctx, in, info, func(ctx context.Context, req interface{}) (interface{}, error) { return srv.(InsuranceServiceServer).ListInsurancePolicies(ctx, req.(*ListInsurancePoliciesRequest)) })
}

func _InsuranceService_FileInsuranceClaim_Handler(srv interface{}, ctx context.Context, dec func(interface{}) error, interceptor grpc.UnaryServerInterceptor) (interface{}, error) {
	in := new(FileInsuranceClaimRequest)
	if err := dec(in); err != nil { return nil, err }
	if interceptor == nil { return srv.(InsuranceServiceServer).FileInsuranceClaim(ctx, in) }
	info := &grpc.UnaryServerInfo{Server: srv, FullMethod: PaymentService_FileInsuranceClaim_FullMethodName}
	return interceptor(ctx, in, info, func(ctx context.Context, req interface{}) (interface{}, error) { return srv.(InsuranceServiceServer).FileInsuranceClaim(ctx, req.(*FileInsuranceClaimRequest)) })
}

func _InsuranceService_GetInsuranceClaim_Handler(srv interface{}, ctx context.Context, dec func(interface{}) error, interceptor grpc.UnaryServerInterceptor) (interface{}, error) {
	in := new(GetInsuranceClaimRequest)
	if err := dec(in); err != nil { return nil, err }
	if interceptor == nil { return srv.(InsuranceServiceServer).GetInsuranceClaim(ctx, in) }
	info := &grpc.UnaryServerInfo{Server: srv, FullMethod: PaymentService_GetInsuranceClaim_FullMethodName}
	return interceptor(ctx, in, info, func(ctx context.Context, req interface{}) (interface{}, error) { return srv.(InsuranceServiceServer).GetInsuranceClaim(ctx, req.(*GetInsuranceClaimRequest)) })
}

func _InsuranceService_ReviewInsuranceClaim_Handler(srv interface{}, ctx context.Context, dec func(interface{}) error, interceptor grpc.UnaryServerInterceptor) (interface{}, error) {
	in := new(ReviewInsuranceClaimRequest)
	if err := dec(in); err != nil { return nil, err }
	if interceptor == nil { return srv.(InsuranceServiceServer).ReviewInsuranceClaim(ctx, in) }
	info := &grpc.UnaryServerInfo{Server: srv, FullMethod: PaymentService_ReviewInsuranceClaim_FullMethodName}
	return interceptor(ctx, in, info, func(ctx context.Context, req interface{}) (interface{}, error) { return srv.(InsuranceServiceServer).ReviewInsuranceClaim(ctx, req.(*ReviewInsuranceClaimRequest)) })
}

func _InsuranceService_AdminListInsuranceClaims_Handler(srv interface{}, ctx context.Context, dec func(interface{}) error, interceptor grpc.UnaryServerInterceptor) (interface{}, error) {
	in := new(AdminListInsuranceClaimsRequest)
	if err := dec(in); err != nil { return nil, err }
	if interceptor == nil { return srv.(InsuranceServiceServer).AdminListInsuranceClaims(ctx, in) }
	info := &grpc.UnaryServerInfo{Server: srv, FullMethod: PaymentService_AdminListInsuranceClaims_FullMethodName}
	return interceptor(ctx, in, info, func(ctx context.Context, req interface{}) (interface{}, error) { return srv.(InsuranceServiceServer).AdminListInsuranceClaims(ctx, req.(*AdminListInsuranceClaimsRequest)) })
}
