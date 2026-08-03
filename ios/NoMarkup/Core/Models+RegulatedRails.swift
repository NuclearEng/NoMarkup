import Foundation

// MARK: - BNPL

struct InstallmentPlan: Decodable, Sendable, Hashable, Identifiable {
    let id: String
    var contractId: String?
    var installmentCount: Int?
    var totalAmountCents: Int64?
    var status: String?
    var installments: [InstallmentScheduleRow]?

    enum CodingKeys: String, CodingKey {
        case id, contractId, installmentCount, totalAmountCents, status, installments
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        if let raw = try c.decodeIfPresent(String.self, forKey: .id), !raw.isEmpty {
            id = raw
        } else {
            throw DecodingError.dataCorruptedError(forKey: .id, in: c, debugDescription: "plan id required")
        }
        contractId = try c.decodeIfPresent(String.self, forKey: .contractId)
        installmentCount = try c.decodeIfPresent(Int.self, forKey: .installmentCount)
        if let v = try? c.decodeIfPresent(Int64.self, forKey: .totalAmountCents) {
            totalAmountCents = v
        } else if let v = try? c.decodeIfPresent(Int.self, forKey: .totalAmountCents) {
            totalAmountCents = Int64(v)
        } else {
            totalAmountCents = nil
        }
        status = try c.decodeIfPresent(String.self, forKey: .status)
        installments = try c.decodeIfPresent([InstallmentScheduleRow].self, forKey: .installments)
    }

    var displayStatus: String { StatusChipStyle.displayLabel(status ?? "unknown") }
    var displayTotal: String { MoneyFormat.usd(cents: totalAmountCents ?? 0) }
}

struct InstallmentScheduleRow: Decodable, Sendable, Hashable, Identifiable {
    var installmentNumber: Int?
    var amountCents: Int64?
    var status: String?
    var dueDate: String?
    var paidAt: String?

    var id: String { "\(installmentNumber ?? 0)-\(dueDate ?? "")" }

    enum CodingKeys: String, CodingKey {
        case installmentNumber, amountCents, status, dueDate, paidAt
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        installmentNumber = try c.decodeIfPresent(Int.self, forKey: .installmentNumber)
        if let v = try? c.decodeIfPresent(Int64.self, forKey: .amountCents) {
            amountCents = v
        } else if let v = try? c.decodeIfPresent(Int.self, forKey: .amountCents) {
            amountCents = Int64(v)
        } else {
            amountCents = nil
        }
        status = try c.decodeIfPresent(String.self, forKey: .status)
        dueDate = try c.decodeIfPresent(String.self, forKey: .dueDate)
        paidAt = try c.decodeIfPresent(String.self, forKey: .paidAt)
    }

    var displayAmount: String { MoneyFormat.usd(cents: amountCents ?? 0) }
}

struct InstallmentPlansResponse: Decodable, Sendable {
    var plans: [InstallmentPlan]
    enum CodingKeys: String, CodingKey { case plans }
    init(from decoder: Decoder) throws {
        if var arr = try? decoder.unkeyedContainer() {
            var list: [InstallmentPlan] = []
            while !arr.isAtEnd { list.append(try arr.decode(InstallmentPlan.self)) }
            plans = list
            return
        }
        let c = try decoder.container(keyedBy: CodingKeys.self)
        plans = try c.decodeIfPresent([InstallmentPlan].self, forKey: .plans) ?? []
    }
}

struct InstallmentPlanEnvelope: Decodable, Sendable {
    var plan: InstallmentPlan?
}

// MARK: - Insurance

struct InsuranceProduct: Decodable, Sendable, Hashable, Identifiable {
    let id: String
    var name: String?
    var description: String?
    var coverageCents: Int64?
    var premiumCents: Int64?

    enum CodingKeys: String, CodingKey {
        case id, name, description, coverageCents, premiumCents
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeIfPresent(String.self, forKey: .id) ?? UUID().uuidString
        name = try c.decodeIfPresent(String.self, forKey: .name)
        description = try c.decodeIfPresent(String.self, forKey: .description)
        coverageCents = Self.int64(c, .coverageCents)
        premiumCents = Self.int64(c, .premiumCents)
    }

    private static func int64(_ c: KeyedDecodingContainer<CodingKeys>, _ k: CodingKeys) -> Int64? {
        if let v = try? c.decodeIfPresent(Int64.self, forKey: k) { return v }
        if let v = try? c.decodeIfPresent(Int.self, forKey: k) { return Int64(v) }
        return nil
    }

    var displayName: String { name ?? "Insurance product" }
    var displayPremium: String { MoneyFormat.usd(cents: premiumCents ?? 0) }
}

struct InsuranceProductsResponse: Decodable, Sendable {
    var products: [InsuranceProduct]
    init(from decoder: Decoder) throws {
        if let arr = try? decoder.singleValueContainer().decode([InsuranceProduct].self) {
            products = arr
            return
        }
        let c = try decoder.container(keyedBy: CodingKeys.self)
        products = try c.decodeIfPresent([InsuranceProduct].self, forKey: .products) ?? []
    }
    enum CodingKeys: String, CodingKey { case products }
}

struct InsuranceQuote: Decodable, Sendable, Hashable {
    var productId: String?
    var premiumCents: Int64?
    var coverageCents: Int64?
    var quoteId: String?

    var displayPremium: String { MoneyFormat.usd(cents: premiumCents ?? 0) }
}

struct InsurancePolicy: Decodable, Sendable, Hashable, Identifiable {
    let id: String
    var contractId: String?
    var productId: String?
    var status: String?
    var premiumCents: Int64?
    var coverageCents: Int64?
    var clientSecret: String?

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeIfPresent(String.self, forKey: .id) ?? UUID().uuidString
        contractId = try c.decodeIfPresent(String.self, forKey: .contractId)
        productId = try c.decodeIfPresent(String.self, forKey: .productId)
        status = try c.decodeIfPresent(String.self, forKey: .status)
        premiumCents = Self.i64(c, .premiumCents)
        coverageCents = Self.i64(c, .coverageCents)
        clientSecret = try c.decodeIfPresent(String.self, forKey: .clientSecret)
    }

    enum CodingKeys: String, CodingKey {
        case id, contractId, productId, status, premiumCents, coverageCents, clientSecret
    }

    private static func i64(_ c: KeyedDecodingContainer<CodingKeys>, _ k: CodingKeys) -> Int64? {
        if let v = try? c.decodeIfPresent(Int64.self, forKey: k) { return v }
        if let v = try? c.decodeIfPresent(Int.self, forKey: k) { return Int64(v) }
        return nil
    }

    var displayStatus: String { StatusChipStyle.displayLabel(status ?? "unknown") }
}

struct InsurancePoliciesResponse: Decodable, Sendable {
    var policies: [InsurancePolicy]
    init(from decoder: Decoder) throws {
        if let arr = try? decoder.singleValueContainer().decode([InsurancePolicy].self) {
            policies = arr
            return
        }
        let c = try decoder.container(keyedBy: CodingKeys.self)
        policies = try c.decodeIfPresent([InsurancePolicy].self, forKey: .policies) ?? []
    }
    enum CodingKeys: String, CodingKey { case policies }
}

struct InsuranceClaim: Decodable, Sendable, Hashable, Identifiable {
    let id: String
    var policyId: String?
    var status: String?
    var amountCents: Int64?

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeIfPresent(String.self, forKey: .id) ?? UUID().uuidString
        policyId = try c.decodeIfPresent(String.self, forKey: .policyId)
        status = try c.decodeIfPresent(String.self, forKey: .status)
        if let v = try? c.decodeIfPresent(Int64.self, forKey: .amountCents) {
            amountCents = v
        } else if let v = try? c.decodeIfPresent(Int.self, forKey: .amountCents) {
            amountCents = Int64(v)
        } else {
            amountCents = nil
        }
    }
    enum CodingKeys: String, CodingKey { case id, policyId, status, amountCents }
}

// MARK: - Advances

struct WorkingCapitalAdvance: Decodable, Sendable, Hashable, Identifiable {
    let id: String
    var contractId: String?
    var advanceAmountCents: Int64?
    var feeCents: Int64?
    var repaidCents: Int64?
    var status: String?

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeIfPresent(String.self, forKey: .id) ?? UUID().uuidString
        contractId = try c.decodeIfPresent(String.self, forKey: .contractId)
        advanceAmountCents = Self.i64(c, .advanceAmountCents) ?? Self.i64(c, .amountCents)
        feeCents = Self.i64(c, .feeCents)
        repaidCents = Self.i64(c, .repaidCents)
        status = try c.decodeIfPresent(String.self, forKey: .status)
    }

    enum CodingKeys: String, CodingKey {
        case id, contractId, advanceAmountCents, amountCents, feeCents, repaidCents, status
    }

    private static func i64(_ c: KeyedDecodingContainer<CodingKeys>, _ k: CodingKeys) -> Int64? {
        if let v = try? c.decodeIfPresent(Int64.self, forKey: k) { return v }
        if let v = try? c.decodeIfPresent(Int.self, forKey: k) { return Int64(v) }
        return nil
    }

    var displayAmount: String { MoneyFormat.usd(cents: advanceAmountCents ?? 0) }
    var displayStatus: String { StatusChipStyle.displayLabel(status ?? "unknown") }
    var outstandingCents: Int64 {
        max(0, (advanceAmountCents ?? 0) + (feeCents ?? 0) - (repaidCents ?? 0))
    }
}

struct AdvancesResponse: Decodable, Sendable {
    var advances: [WorkingCapitalAdvance]
    init(from decoder: Decoder) throws {
        if let arr = try? decoder.singleValueContainer().decode([WorkingCapitalAdvance].self) {
            advances = arr
            return
        }
        let c = try decoder.container(keyedBy: CodingKeys.self)
        advances = try c.decodeIfPresent([WorkingCapitalAdvance].self, forKey: .advances) ?? []
    }
    enum CodingKeys: String, CodingKey { case advances }
}

struct AdvanceEnvelope: Decodable, Sendable {
    var advance: WorkingCapitalAdvance?
}

struct CreditLimit: Decodable, Sendable, Hashable {
    var maxCreditCents: Int64?
    var availableCreditCents: Int64?
    var approved: Bool?

    var displayAvailable: String { MoneyFormat.usd(cents: availableCreditCents ?? 0) }
}

struct CreditLimitEnvelope: Decodable, Sendable {
    var creditLimit: CreditLimit?
    var maxCreditCents: Int64?
    var availableCreditCents: Int64?
    var approved: Bool?

    var asLimit: CreditLimit {
        if let creditLimit { return creditLimit }
        return CreditLimit(
            maxCreditCents: maxCreditCents,
            availableCreditCents: availableCreditCents,
            approved: approved
        )
    }
}

// MARK: - Instant payout

struct InstantPayoutSummary: Decodable, Sendable, Hashable {
    var availableCents: Int64?
    var dailyRemainingCents: Int64?
    var feeBps: Int64?

    var displayAvailable: String { MoneyFormat.usd(cents: availableCents ?? 0) }
}

struct InstantPayoutResult: Decodable, Sendable, Hashable {
    var id: String?
    var amountCents: Int64?
    var status: String?
    var netCents: Int64?
}

// MARK: - Expenses

struct ProviderExpense: Decodable, Sendable, Hashable, Identifiable {
    let id: String
    var category: String?
    var amountCents: Int64?
    var description: String?
    var expenseDate: String?

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeIfPresent(String.self, forKey: .id) ?? UUID().uuidString
        category = try c.decodeIfPresent(String.self, forKey: .category)
        if let v = try? c.decodeIfPresent(Int64.self, forKey: .amountCents) {
            amountCents = v
        } else if let v = try? c.decodeIfPresent(Int.self, forKey: .amountCents) {
            amountCents = Int64(v)
        } else {
            amountCents = nil
        }
        description = try c.decodeIfPresent(String.self, forKey: .description)
        expenseDate = try c.decodeIfPresent(String.self, forKey: .expenseDate)
    }
    enum CodingKeys: String, CodingKey {
        case id, category, amountCents, description, expenseDate
    }

    var displayAmount: String { MoneyFormat.usd(cents: amountCents ?? 0) }
}

struct ExpensesResponse: Decodable, Sendable {
    var expenses: [ProviderExpense]
    init(from decoder: Decoder) throws {
        if let arr = try? decoder.singleValueContainer().decode([ProviderExpense].self) {
            expenses = arr
            return
        }
        let c = try decoder.container(keyedBy: CodingKeys.self)
        expenses = try c.decodeIfPresent([ProviderExpense].self, forKey: .expenses) ?? []
    }
    enum CodingKeys: String, CodingKey { case expenses }
}

struct ExpenseEnvelope: Decodable, Sendable {
    var expense: ProviderExpense?
}

// MARK: - Tax

/// 1099-NEC row from `GET/POST /api/v1/providers/me/tax-forms…`
/// Gateway fields: tax_year, form_type, total_compensation_cents, status, pdf_url.
struct TaxForm: Decodable, Sendable, Hashable, Identifiable {
    let id: String
    /// Prefer `tax_year` from the gateway; `year` accepted as a soft alias.
    var taxYear: Int?
    var formType: String?
    var status: String?
    var totalCompensationCents: Int64?
    var pdfUrl: String?

    /// UI convenience — same as taxYear when present.
    var year: Int? { taxYear }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeIfPresent(String.self, forKey: .id) ?? UUID().uuidString
        if let y = try c.decodeIfPresent(Int.self, forKey: .taxYear) {
            taxYear = y
        } else {
            taxYear = try c.decodeIfPresent(Int.self, forKey: .year)
        }
        formType = try c.decodeIfPresent(String.self, forKey: .formType)
        status = try c.decodeIfPresent(String.self, forKey: .status)
        if let v = try? c.decodeIfPresent(Int64.self, forKey: .totalCompensationCents) {
            totalCompensationCents = v
        } else if let v = try? c.decodeIfPresent(Int.self, forKey: .totalCompensationCents) {
            totalCompensationCents = Int64(v)
        } else {
            totalCompensationCents = nil
        }
        pdfUrl = try c.decodeIfPresent(String.self, forKey: .pdfUrl)
    }

    enum CodingKeys: String, CodingKey {
        case id, taxYear, year, formType, status, totalCompensationCents, pdfUrl
    }

    var displayCompensation: String {
        MoneyFormat.usd(cents: totalCompensationCents ?? 0)
    }

    var displayStatus: String {
        StatusChipStyle.displayLabel(status ?? "draft")
    }
}

struct TaxFormsResponse: Decodable, Sendable {
    var forms: [TaxForm]
    init(from decoder: Decoder) throws {
        if let arr = try? decoder.singleValueContainer().decode([TaxForm].self) {
            forms = arr
            return
        }
        let c = try decoder.container(keyedBy: CodingKeys.self)
        forms = try c.decodeIfPresent([TaxForm].self, forKey: .forms)
            ?? c.decodeIfPresent([TaxForm].self, forKey: .taxForms)
            ?? []
    }
    enum CodingKeys: String, CodingKey { case forms, taxForms }
}

/// Nested body from `GET /api/v1/providers/me/tax-estimate` (`tax_estimate` map).
/// All figures are server-side integer cents — never recompute client-side.
struct TaxEstimate: Decodable, Sendable, Hashable {
    var taxYear: Int?
    var netEarningsCents: Int64?
    var totalTaxCents: Int64?
    var federalIncomeTaxCents: Int64?
    var seTaxCents: Int64?
    var stateIncomeTaxCents: Int64?
    var effectiveRate: Double?
    var stateCode: String?
    var hasStateData: Bool?

    /// Soft aliases for older partial decodes.
    var year: Int? { taxYear }
    var estimatedTaxCents: Int64? { totalTaxCents }
    var grossIncomeCents: Int64? { netEarningsCents }

    var displayEstimate: String { MoneyFormat.usd(cents: totalTaxCents ?? 0) }
    var displayNetEarnings: String { MoneyFormat.usd(cents: netEarningsCents ?? 0) }

    var displayEffectiveRate: String? {
        guard let effectiveRate else { return nil }
        return String(format: "%.1f%%", effectiveRate * 100)
    }
}

/// Envelope `{ "tax_estimate": { … } }` from the tax-estimate endpoint.
struct TaxEstimateResponse: Decodable, Sendable, Hashable {
    var taxEstimate: TaxEstimate?

    init(from decoder: Decoder) throws {
        // Accept either nested envelope or flat TaxEstimate body.
        if let flat = try? TaxEstimate(from: decoder), flat.totalTaxCents != nil || flat.taxYear != nil {
            taxEstimate = flat
            return
        }
        let c = try decoder.container(keyedBy: CodingKeys.self)
        taxEstimate = try c.decodeIfPresent(TaxEstimate.self, forKey: .taxEstimate)
    }

    enum CodingKeys: String, CodingKey { case taxEstimate }
}

/// Envelope `{ "tax_form": { … } }` from generate/get tax form.
struct TaxFormEnvelope: Decodable, Sendable, Hashable {
    var taxForm: TaxForm?

    init(from decoder: Decoder) throws {
        if let flat = try? TaxForm(from: decoder) {
            taxForm = flat
            return
        }
        let c = try decoder.container(keyedBy: CodingKeys.self)
        taxForm = try c.decodeIfPresent(TaxForm.self, forKey: .taxForm)
    }

    enum CodingKeys: String, CodingKey { case taxForm }
}
