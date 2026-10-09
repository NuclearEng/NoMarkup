package grpc

import (
	"fmt"
	"testing"
	"time"

	"github.com/nomarkup/nomarkup/services/payment/internal/domain"
	"github.com/nomarkup/nomarkup/services/payment/internal/service"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestCreateInstallmentPlan_InFlightReturnsPlanAndSecret(t *testing.T) {
	t.Parallel()

	plan := &domain.InstallmentPlan{
		ID:         "plan-1",
		Status:     "active",
		CustomerID: "cust-1",
		ProviderID: "prov-1",
		Installments: []domain.ScheduledInstallment{{
			ID:                "inst-1",
			InstallmentNumber: 1,
			AmountCents:       10300,
			DueDate:           time.Date(2026, 10, 8, 0, 0, 0, 0, time.UTC),
			Status:            "processing",
		}},
	}
	secret := "needs-confirm"
	err := fmt.Errorf("create installment plan first charge: %w", service.ErrOffSessionInFlight)

	resp, gotErr := createInstallmentPlanResult(plan, secret, err)
	require.NoError(t, gotErr)
	require.NotNil(t, resp)
	require.NotNil(t, resp.GetPlan())
	assert.Equal(t, "plan-1", resp.GetPlan().GetId())
	assert.Equal(t, "active", resp.GetPlan().GetStatus())
	assert.Empty(t, resp.GetPlan().GetStripeProviderTransferId())
	assert.Nil(t, resp.GetPlan().GetProviderPaidAt())
	require.Len(t, resp.GetPlan().GetInstallments(), 1)
	assert.Equal(t, "processing", resp.GetPlan().GetInstallments()[0].GetStatus())
	assert.Equal(t, secret, resp.GetFirstInstallmentClientSecret())
}

func TestCreateInstallmentPlan_InFlightWithoutSecretIsStatus(t *testing.T) {
	t.Parallel()

	plan := &domain.InstallmentPlan{ID: "plan-1", Status: "active"}
	err := fmt.Errorf("create installment plan first charge: %w", service.ErrOffSessionInFlight)

	resp, gotErr := createInstallmentPlanResult(plan, "", err)
	require.Nil(t, resp)
	st, ok := status.FromError(gotErr)
	require.True(t, ok)
	assert.Equal(t, codes.FailedPrecondition, st.Code())
	assert.Equal(t, "the charge is still processing; do not start another charge", st.Message())

	resp, gotErr = createInstallmentPlanResult(nil, "needs-confirm", err)
	require.Nil(t, resp)
	assert.Equal(t, codes.FailedPrecondition, status.Code(gotErr))
}

func TestCreateInstallmentPlan_OtherErrorOmitsSecret(t *testing.T) {
	t.Parallel()

	resp, err := createInstallmentPlanResult(nil, "needs-confirm", fmt.Errorf("create installment plan: %w", domain.ErrInstallmentPlanExists))
	require.Nil(t, resp)
	assert.Equal(t, codes.AlreadyExists, status.Code(err))

	resp, err = createInstallmentPlanResult(&domain.InstallmentPlan{ID: "plan-1"}, "", fmt.Errorf("boom"))
	require.Nil(t, resp)
	assert.Equal(t, codes.Internal, status.Code(err))
}

func TestMapInstallmentError_OffSessionInFlight(t *testing.T) {
	t.Parallel()

	got := mapInstallmentError(fmt.Errorf("park: %w", service.ErrOffSessionInFlight))
	st, ok := status.FromError(got)
	require.True(t, ok)
	assert.Equal(t, codes.FailedPrecondition, st.Code())
	assert.Equal(t, "the charge is still processing; do not start another charge", st.Message())
}
