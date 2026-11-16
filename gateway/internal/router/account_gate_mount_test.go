package router

import (
	"strings"
	"testing"
)

func TestAccountGateMounted(t *testing.T) {
	t.Parallel()

	src := readRouterSource(t)
	if !strings.Contains(src, "ageVerified := middleware.RequireAgeVerified(dbPool)") {
		t.Fatal("ageVerified middleware is not constructed in router.New")
	}
	if !strings.Contains(src, "termsAccepted := middleware.RequireCurrentTerms(dbPool)") {
		t.Fatal("termsAccepted middleware is not constructed in router.New")
	}
	if !strings.Contains(src, "r.Use(ageVerified)") {
		t.Fatal("ageVerified is not mounted with r.Use")
	}
	if !strings.Contains(src, "r.Use(termsAccepted)") {
		t.Fatal("termsAccepted is not mounted with r.Use")
	}

	mustMount := []string{
		"jobHandler.Create",
		"jobHandler.Update",
		"jobHandler.Publish",
		"jobHandler.Repost",
		"bidHandler.PlaceBid",
		"bidHandler.AcceptOffer",
		"bidHandler.AwardBid",
		"instantMatchHandler.CreateInstantMatch",
		"categoryQuestionsHandler.SubmitAnswers",
	}
	for _, handler := range mustMount {
		if !handlerHasMiddleware(src, handler, "ageVerified") {
			t.Errorf("%s is not wrapped with ageVerified", handler)
		}
		if !handlerHasMiddleware(src, handler, "termsAccepted") {
			t.Errorf("%s is not wrapped with termsAccepted", handler)
		}
	}

	mustNotMount := []string{
		"jobHandler.Search",
		"jobHandler.Close",
		"jobHandler.Cancel",
		"jobHandler.Delete",
		"complianceHandler.SetDOB",
		"complianceHandler.AcceptToS",
		"authHandler.VerifyPhone",
		"userHandler.RequestMyDeletion",
	}
	for _, handler := range mustNotMount {
		if handlerHasMiddleware(src, handler, "ageVerified") {
			t.Errorf("%s must not wrap ageVerified on its registration", handler)
		}
	}

	if !handlerHasMiddleware(src, "bidHandler.PlaceBid", "phoneVerified") {
		t.Error("PlaceBid must still include phoneVerified")
	}
}
