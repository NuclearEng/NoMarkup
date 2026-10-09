import Foundation

// MARK: - BNPL installments · insurance · advances · instant payout · expenses · tax
// Full web parity for provider/customer money rails (server flag gated).

extension APIClient {
    // MARK: Installments (customer BNPL)

    /// GET `/api/v1/payments/installment-plans`
    func fetchInstallmentPlans() async throws -> [InstallmentPlan] {
        let response: InstallmentPlansResponse = try await getJSON(
            pathComponents: ["api", "v1", "payments", "installment-plans"],
            authorized: true
        )
        return response.plans
    }

    /// GET `/api/v1/payments/installment-plans/{id}`
    func fetchInstallmentPlan(id: String) async throws -> InstallmentPlan {
        try await getJSON(
            pathComponents: ["api", "v1", "payments", "installment-plans", id],
            authorized: true
        )
    }

    /// POST `/api/v1/payments/installment-plans` + Idempotency-Key
    @discardableResult
    func createInstallmentPlan(
        contractId: String,
        installmentCount: Int,
        idempotencyKey: String? = nil
    ) async throws -> InstallmentPlan {
        let opKey = idempotencyKey ?? "installment:\(contractId):\(installmentCount)"
        let headers = idempotencyHeader(for: opKey)
        let body = CreateInstallmentPlanBody(
            contractId: contractId,
            installmentCount: installmentCount,
            idempotencyKey: opKey
        )
        do {
            // Gateway may return { plan: {...} } or a flat plan object.
            let data = try await postData(
                pathComponents: ["api", "v1", "payments", "installment-plans"],
                body: body,
                authorized: .required,
                headers: headers
            )
            clearIdempotencyKey(opKey)
            let decoder = JSONDecoder()
            decoder.keyDecodingStrategy = .convertFromSnakeCase
            if let env = try? decoder.decode(InstallmentPlanEnvelope.self, from: data), let plan = env.plan {
                return plan
            }
            return try decoder.decode(InstallmentPlan.self, from: data)
        } catch {
            throw error
        }
    }

    // MARK: Insurance

    /// GET `/api/v1/insurance/products`
    func fetchInsuranceProducts() async throws -> [InsuranceProduct] {
        let response: InsuranceProductsResponse = try await getJSON(
            pathComponents: ["api", "v1", "insurance", "products"],
            authorized: true
        )
        return response.products
    }

    /// POST `/api/v1/insurance/quote`
    func quoteInsurance(contractId: String, productId: String) async throws -> InsuranceQuote {
        try await postJSON(
            pathComponents: ["api", "v1", "insurance", "quote"],
            body: InsuranceQuoteBody(contractId: contractId, productId: productId),
            authorized: .required
        )
    }

    /// POST `/api/v1/insurance/purchase` + Idempotency-Key
    @discardableResult
    func purchaseInsurance(
        contractId: String,
        productId: String,
        paymentMethodId: String
    ) async throws -> InsurancePolicy {
        let opKey = "insurance-purchase:\(contractId):\(productId)"
        let headers = idempotencyHeader(for: opKey)
        do {
            let policy: InsurancePolicy = try await postJSON(
                pathComponents: ["api", "v1", "insurance", "purchase"],
                body: InsurancePurchaseBody(
                    contractId: contractId,
                    productId: productId,
                    paymentMethodId: paymentMethodId
                ),
                authorized: .required,
                headers: headers
            )
            clearIdempotencyKey(opKey)
            return policy
        } catch {
            throw error
        }
    }

    /// GET `/api/v1/insurance/policies`
    func fetchInsurancePolicies() async throws -> [InsurancePolicy] {
        let response: InsurancePoliciesResponse = try await getJSON(
            pathComponents: ["api", "v1", "insurance", "policies"],
            authorized: true
        )
        return response.policies
    }

    /// POST `/api/v1/insurance/claims`
    @discardableResult
    func fileInsuranceClaim(
        policyId: String,
        description: String,
        amountCents: Int64
    ) async throws -> InsuranceClaim {
        try await postJSON(
            pathComponents: ["api", "v1", "insurance", "claims"],
            body: InsuranceClaimBody(
                policyId: policyId,
                description: description,
                amountCents: amountCents
            ),
            authorized: .required
        )
    }

    // MARK: Working capital advances

    /// GET `/api/v1/providers/me/advances`
    func fetchMyAdvances() async throws -> [WorkingCapitalAdvance] {
        let response: AdvancesResponse = try await getJSON(
            pathComponents: ["api", "v1", "providers", "me", "advances"],
            authorized: true
        )
        return response.advances
    }

    /// GET `/api/v1/providers/me/credit-limit`
    func fetchCreditLimit() async throws -> CreditLimit {
        let response: CreditLimitEnvelope = try await getJSON(
            pathComponents: ["api", "v1", "providers", "me", "credit-limit"],
            authorized: true
        )
        return response.creditLimit ?? response.asLimit
    }

    /// POST `/api/v1/providers/me/advances` + Idempotency-Key
    @discardableResult
    func requestAdvance(contractId: String, amountCents: Int64) async throws -> WorkingCapitalAdvance {
        let opKey = "advance:\(contractId):\(amountCents)"
        let headers = idempotencyHeader(for: opKey)
        do {
            let data = try await postData(
                pathComponents: ["api", "v1", "providers", "me", "advances"],
                body: RequestAdvanceBody(contractId: contractId, amountCents: amountCents),
                authorized: .required,
                headers: headers
            )
            clearIdempotencyKey(opKey)
            return try decodeAdvancePayload(data)
        } catch {
            throw error
        }
    }

    /// POST `/api/v1/providers/me/advances/{id}/repay` + Idempotency-Key
    @discardableResult
    func repayAdvance(id: String, amountCents: Int64) async throws -> WorkingCapitalAdvance {
        let opKey = "advance-repay:\(id):\(amountCents)"
        let headers = idempotencyHeader(for: opKey)
        do {
            let data = try await postData(
                pathComponents: ["api", "v1", "providers", "me", "advances", id, "repay"],
                body: AmountCentsBody(amountCents: amountCents),
                authorized: .required,
                headers: headers
            )
            clearIdempotencyKey(opKey)
            return try decodeAdvancePayload(data)
        } catch {
            throw error
        }
    }

    private func decodeAdvancePayload(_ data: Data) throws -> WorkingCapitalAdvance {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        if let env = try? decoder.decode(AdvanceEnvelope.self, from: data), let advance = env.advance {
            return advance
        }
        return try decoder.decode(WorkingCapitalAdvance.self, from: data)
    }

    // MARK: Instant payout

    /// GET `/api/v1/payments/instant-payout/summary`
    func fetchInstantPayoutSummary() async throws -> InstantPayoutSummary {
        try await getJSON(
            pathComponents: ["api", "v1", "payments", "instant-payout", "summary"],
            authorized: true
        )
    }

    /// POST `/api/v1/payments/instant-payout` + Idempotency-Key
    @discardableResult
    func requestInstantPayout(amountCents: Int64) async throws -> InstantPayoutResult {
        let opKey = "instant-payout:\(amountCents):\(UUID().uuidString.prefix(8))"
        // Sticky per logical request: use amount only for retries of same attempt
        let sticky = "instant-payout:\(amountCents)"
        let headers = idempotencyHeader(for: sticky)
        do {
            let result: InstantPayoutResult = try await postJSON(
                pathComponents: ["api", "v1", "payments", "instant-payout"],
                body: AmountCentsBody(amountCents: amountCents),
                authorized: .required,
                headers: headers
            )
            clearIdempotencyKey(sticky)
            return result
        } catch {
            throw error
        }
    }

    // MARK: Expenses

    /// GET `/api/v1/providers/me/expenses`
    func fetchExpenses() async throws -> [ProviderExpense] {
        let response: ExpensesResponse = try await getJSON(
            pathComponents: ["api", "v1", "providers", "me", "expenses"],
            authorized: true
        )
        return response.expenses
    }

    /// POST `/api/v1/providers/me/expenses`
    @discardableResult
    func createExpense(
        category: String,
        amountCents: Int64,
        description: String,
        expenseDate: String
    ) async throws -> ProviderExpense {
        let data = try await postData(
            pathComponents: ["api", "v1", "providers", "me", "expenses"],
            body: CreateExpenseBody(
                category: category,
                amountCents: amountCents,
                description: description,
                expenseDate: expenseDate
            ),
            authorized: .required
        )
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        if let env = try? decoder.decode(ExpenseEnvelope.self, from: data), let expense = env.expense {
            return expense
        }
        return try decoder.decode(ProviderExpense.self, from: data)
    }

    /// DELETE `/api/v1/providers/me/expenses/{id}`
    func deleteExpense(id: String) async throws {
        try await deleteEmpty(
            pathComponents: ["api", "v1", "providers", "me", "expenses", id],
            authorized: .required
        )
    }

    // MARK: Tax forms

    /// GET `/api/v1/providers/me/tax-forms`
    func fetchTaxForms() async throws -> [TaxForm] {
        let response: TaxFormsResponse = try await getJSON(
            pathComponents: ["api", "v1", "providers", "me", "tax-forms"],
            authorized: true
        )
        return response.forms
    }

    /// GET `/api/v1/providers/me/tax-estimate?year=` → unwrapped `tax_estimate` map.
    func fetchTaxEstimate(year: Int) async throws -> TaxEstimate {
        let response: TaxEstimateResponse = try await getJSON(
            pathComponents: ["api", "v1", "providers", "me", "tax-estimate"],
            query: [URLQueryItem(name: "year", value: String(year))],
            authorized: true
        )
        guard let estimate = response.taxEstimate else {
            throw APIClientError.httpStatus(502, detail: "Tax estimate missing from response.")
        }
        return estimate
    }

    /// POST `/api/v1/providers/me/tax-forms/{year}/generate` → created 1099-NEC row.
    @discardableResult
    func generateTaxForm(year: Int) async throws -> TaxForm {
        guard year >= 2020, year <= 2100 else {
            throw APIClientError.httpStatus(400, detail: "Invalid tax year.")
        }
        let response: TaxFormEnvelope = try await postJSON(
            pathComponents: ["api", "v1", "providers", "me", "tax-forms", String(year), "generate"],
            body: EmptyJSONObject(),
            authorized: .required
        )
        guard let form = response.taxForm else {
            throw APIClientError.httpStatus(502, detail: "Tax form missing from generate response.")
        }
        return form
    }

    /// GET `/api/v1/providers/me/tax-forms/{year}/download` — HTML 1099-NEC attachment bytes.
    func downloadTaxForm(year: Int) async throws -> Data {
        guard year >= 2020, year <= 2100 else {
            throw APIClientError.httpStatus(400, detail: "Invalid tax year.")
        }
        return try await getData(
            pathComponents: ["api", "v1", "providers", "me", "tax-forms", String(year), "download"],
            authorized: .required
        )
    }
}

// MARK: - Bodies

private struct CreateInstallmentPlanBody: Encodable {
    let contractId: String
    let installmentCount: Int
    let idempotencyKey: String
}

private struct InsuranceQuoteBody: Encodable {
    let contractId: String
    let productId: String
}

private struct InsurancePurchaseBody: Encodable {
    let contractId: String
    let productId: String
    let paymentMethodId: String
}

private struct InsuranceClaimBody: Encodable {
    let policyId: String
    let description: String
    let amountCents: Int64
}

private struct RequestAdvanceBody: Encodable {
    let contractId: String
    let amountCents: Int64
}

private struct CreateExpenseBody: Encodable {
    let category: String
    let amountCents: Int64
    let description: String
    let expenseDate: String
}
