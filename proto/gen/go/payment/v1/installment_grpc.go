package paymentv1

// Hand-written gRPC client/server extensions for BNPL installment plan RPCs.
// These will be replaced by auto-generated code when protoc is next run.

import (
	context "context"
	grpc "google.golang.org/grpc"
	codes "google.golang.org/grpc/codes"
	status "google.golang.org/grpc/status"
)

const (
	PaymentService_CreateInstallmentPlan_FullMethodName = "/nomarkup.payment.v1.PaymentService/CreateInstallmentPlan"
	PaymentService_GetInstallmentPlan_FullMethodName    = "/nomarkup.payment.v1.PaymentService/GetInstallmentPlan"
	PaymentService_ListInstallmentPlans_FullMethodName  = "/nomarkup.payment.v1.PaymentService/ListInstallmentPlans"
)

// InstallmentPlanServiceClient extends PaymentServiceClient with BNPL methods.
type InstallmentPlanServiceClient interface {
	CreateInstallmentPlan(ctx context.Context, in *CreateInstallmentPlanRequest, opts ...grpc.CallOption) (*CreateInstallmentPlanResponse, error)
	GetInstallmentPlan(ctx context.Context, in *GetInstallmentPlanRequest, opts ...grpc.CallOption) (*GetInstallmentPlanResponse, error)
	ListInstallmentPlans(ctx context.Context, in *ListInstallmentPlansRequest, opts ...grpc.CallOption) (*ListInstallmentPlansResponse, error)
}

type installmentPlanServiceClient struct {
	cc grpc.ClientConnInterface
}

// NewInstallmentPlanServiceClient creates a new client for installment plan RPCs.
func NewInstallmentPlanServiceClient(cc grpc.ClientConnInterface) InstallmentPlanServiceClient {
	return &installmentPlanServiceClient{cc}
}

func (c *installmentPlanServiceClient) CreateInstallmentPlan(ctx context.Context, in *CreateInstallmentPlanRequest, opts ...grpc.CallOption) (*CreateInstallmentPlanResponse, error) {
	cOpts := append([]grpc.CallOption{grpc.StaticMethod()}, opts...)
	out := new(CreateInstallmentPlanResponse)
	err := c.cc.Invoke(ctx, PaymentService_CreateInstallmentPlan_FullMethodName, in, out, cOpts...)
	if err != nil {
		return nil, err
	}
	return out, nil
}

func (c *installmentPlanServiceClient) GetInstallmentPlan(ctx context.Context, in *GetInstallmentPlanRequest, opts ...grpc.CallOption) (*GetInstallmentPlanResponse, error) {
	cOpts := append([]grpc.CallOption{grpc.StaticMethod()}, opts...)
	out := new(GetInstallmentPlanResponse)
	err := c.cc.Invoke(ctx, PaymentService_GetInstallmentPlan_FullMethodName, in, out, cOpts...)
	if err != nil {
		return nil, err
	}
	return out, nil
}

func (c *installmentPlanServiceClient) ListInstallmentPlans(ctx context.Context, in *ListInstallmentPlansRequest, opts ...grpc.CallOption) (*ListInstallmentPlansResponse, error) {
	cOpts := append([]grpc.CallOption{grpc.StaticMethod()}, opts...)
	out := new(ListInstallmentPlansResponse)
	err := c.cc.Invoke(ctx, PaymentService_ListInstallmentPlans_FullMethodName, in, out, cOpts...)
	if err != nil {
		return nil, err
	}
	return out, nil
}

// InstallmentPlanServiceServer is the server API for installment plan RPCs.
type InstallmentPlanServiceServer interface {
	CreateInstallmentPlan(context.Context, *CreateInstallmentPlanRequest) (*CreateInstallmentPlanResponse, error)
	GetInstallmentPlan(context.Context, *GetInstallmentPlanRequest) (*GetInstallmentPlanResponse, error)
	ListInstallmentPlans(context.Context, *ListInstallmentPlansRequest) (*ListInstallmentPlansResponse, error)
}

// UnimplementedInstallmentPlanServiceServer provides default unimplemented stubs.
type UnimplementedInstallmentPlanServiceServer struct{}

func (UnimplementedInstallmentPlanServiceServer) CreateInstallmentPlan(context.Context, *CreateInstallmentPlanRequest) (*CreateInstallmentPlanResponse, error) {
	return nil, status.Error(codes.Unimplemented, "method CreateInstallmentPlan not implemented")
}
func (UnimplementedInstallmentPlanServiceServer) GetInstallmentPlan(context.Context, *GetInstallmentPlanRequest) (*GetInstallmentPlanResponse, error) {
	return nil, status.Error(codes.Unimplemented, "method GetInstallmentPlan not implemented")
}
func (UnimplementedInstallmentPlanServiceServer) ListInstallmentPlans(context.Context, *ListInstallmentPlansRequest) (*ListInstallmentPlansResponse, error) {
	return nil, status.Error(codes.Unimplemented, "method ListInstallmentPlans not implemented")
}

// RegisterInstallmentPlanServiceServer registers the installment plan service.
func RegisterInstallmentPlanServiceServer(s grpc.ServiceRegistrar, srv InstallmentPlanServiceServer) {
	s.RegisterService(&InstallmentPlanService_ServiceDesc, srv)
}

func _InstallmentPlanService_CreateInstallmentPlan_Handler(srv interface{}, ctx context.Context, dec func(interface{}) error, interceptor grpc.UnaryServerInterceptor) (interface{}, error) {
	in := new(CreateInstallmentPlanRequest)
	if err := dec(in); err != nil {
		return nil, err
	}
	if interceptor == nil {
		return srv.(InstallmentPlanServiceServer).CreateInstallmentPlan(ctx, in)
	}
	info := &grpc.UnaryServerInfo{
		Server:     srv,
		FullMethod: PaymentService_CreateInstallmentPlan_FullMethodName,
	}
	handler := func(ctx context.Context, req interface{}) (interface{}, error) {
		return srv.(InstallmentPlanServiceServer).CreateInstallmentPlan(ctx, req.(*CreateInstallmentPlanRequest))
	}
	return interceptor(ctx, in, info, handler)
}

func _InstallmentPlanService_GetInstallmentPlan_Handler(srv interface{}, ctx context.Context, dec func(interface{}) error, interceptor grpc.UnaryServerInterceptor) (interface{}, error) {
	in := new(GetInstallmentPlanRequest)
	if err := dec(in); err != nil {
		return nil, err
	}
	if interceptor == nil {
		return srv.(InstallmentPlanServiceServer).GetInstallmentPlan(ctx, in)
	}
	info := &grpc.UnaryServerInfo{
		Server:     srv,
		FullMethod: PaymentService_GetInstallmentPlan_FullMethodName,
	}
	handler := func(ctx context.Context, req interface{}) (interface{}, error) {
		return srv.(InstallmentPlanServiceServer).GetInstallmentPlan(ctx, req.(*GetInstallmentPlanRequest))
	}
	return interceptor(ctx, in, info, handler)
}

func _InstallmentPlanService_ListInstallmentPlans_Handler(srv interface{}, ctx context.Context, dec func(interface{}) error, interceptor grpc.UnaryServerInterceptor) (interface{}, error) {
	in := new(ListInstallmentPlansRequest)
	if err := dec(in); err != nil {
		return nil, err
	}
	if interceptor == nil {
		return srv.(InstallmentPlanServiceServer).ListInstallmentPlans(ctx, in)
	}
	info := &grpc.UnaryServerInfo{
		Server:     srv,
		FullMethod: PaymentService_ListInstallmentPlans_FullMethodName,
	}
	handler := func(ctx context.Context, req interface{}) (interface{}, error) {
		return srv.(InstallmentPlanServiceServer).ListInstallmentPlans(ctx, req.(*ListInstallmentPlansRequest))
	}
	return interceptor(ctx, in, info, handler)
}

// InstallmentPlanService_ServiceDesc is the service descriptor for the installment plan service.
var InstallmentPlanService_ServiceDesc = grpc.ServiceDesc{
	ServiceName: "nomarkup.payment.v1.PaymentService",
	HandlerType: (*InstallmentPlanServiceServer)(nil),
	Methods: []grpc.MethodDesc{
		{
			MethodName: "CreateInstallmentPlan",
			Handler:    _InstallmentPlanService_CreateInstallmentPlan_Handler,
		},
		{
			MethodName: "GetInstallmentPlan",
			Handler:    _InstallmentPlanService_GetInstallmentPlan_Handler,
		},
		{
			MethodName: "ListInstallmentPlans",
			Handler:    _InstallmentPlanService_ListInstallmentPlans_Handler,
		},
	},
	Streams: []grpc.StreamDesc{},
}
