// validations — the form schemas validations.test.ts does not reach: legal
// intake, goods listing posting (incl. the buy-now >= starting-price rule),
// employees, properties, the password flows and MFA, plus the conditional
// "required" messages (custom text only when the field is missing, zod's own
// text when a wrong value is supplied) and the 0 -> undefined money transforms.
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';

import {
  LEGAL_CONTACT_PREFERENCE,
  LEGAL_URGENCY,
  addEmployeeSchema,
  businessInfoSchema,
  changePasswordSchema,
  forgotPasswordSchema,
  globalTermsSchema,
  jobPostingSchema,
  legalIntakeSchema,
  listingDescriptionSchema,
  listingPostingSchema,
  listingTitleSchema,
  listingZipSchema,
  mfaCodeSchema,
  propertySchema,
  resetPasswordSchema,
} from '@/lib/validations';

interface IssueLike {
  path: PropertyKey[];
  message: string;
  errors?: IssueLike[][];
}

/** Every message reported at `field`, including ones nested inside a union. */
function messagesAt(schema: z.ZodType, input: unknown, field: string): string[] {
  const result = schema.safeParse(input);
  if (result.success) return [];
  const out: string[] = [];
  const visit = (issues: IssueLike[], inherited: boolean): void => {
    for (const issue of issues) {
      const here = inherited || issue.path[0] === field;
      if (here) out.push(issue.message);
      for (const branch of issue.errors ?? []) visit(branch, here);
    }
  };
  visit(result.error.issues as IssueLike[], false);
  return out;
}

function failingFields(schema: z.ZodType, input: unknown): string[] {
  const result = schema.safeParse(input);
  if (result.success) return [];
  return [...new Set(result.error.issues.map((issue) => String(issue.path[0])))].sort();
}

const STRONG_PASSWORD = 'Sup3r$ecret';

describe('legalIntakeSchema', () => {
  const valid = {
    matterCategoryId: 'cat-legal-1',
    title: 'Need help reviewing a commercial lease',
    description:
      'Our landlord sent a renewal with new terms and we need counsel to review it this month.',
    jurisdiction: 'WA',
    urgency: 'soon',
    contactPreference: 'platform',
  };

  it('accepts a complete intake and leaves an absent budget undefined', () => {
    const parsed = legalIntakeSchema.parse(valid);
    expect(parsed.budgetDollars).toBeUndefined();
    expect(parsed.urgency).toBe('soon');
  });

  it.each(LEGAL_URGENCY)('accepts urgency %s', (urgency) => {
    expect(legalIntakeSchema.safeParse({ ...valid, urgency }).success).toBe(true);
  });

  it.each(LEGAL_CONTACT_PREFERENCE)('accepts contact preference %s', (contactPreference) => {
    expect(legalIntakeSchema.safeParse({ ...valid, contactPreference }).success).toBe(true);
  });

  it('keeps a positive budget and normalises a zero budget to undefined', () => {
    expect(legalIntakeSchema.parse({ ...valid, budgetDollars: 2500 }).budgetDollars).toBe(2500);
    expect(legalIntakeSchema.parse({ ...valid, budgetDollars: 0 }).budgetDollars).toBeUndefined();
  });

  it.each<[string, unknown, string]>([
    ['a negative budget', -5, 'Budget must be greater than $0'],
    ['a budget above the cap', 1_000_001, 'Budget is too large'],
    ['a non-numeric budget', 'lots', 'Enter a number'],
  ])('rejects %s', (_label, budgetDollars, message) => {
    expect(messagesAt(legalIntakeSchema, { ...valid, budgetDollars }, 'budgetDollars')).toContain(
      message,
    );
  });

  it('asks for a timeline / contact preference only when they are missing', () => {
    const { urgency: _u, contactPreference: _c, ...missing } = valid;
    expect(messagesAt(legalIntakeSchema, missing, 'urgency')).toEqual(['Choose a timeline']);
    expect(messagesAt(legalIntakeSchema, missing, 'contactPreference')).toEqual([
      'Choose a contact preference',
    ]);
  });

  it('falls back to the generic enum message for an unknown urgency / contact preference', () => {
    const wrong = { ...valid, urgency: 'yesterday', contactPreference: 'fax' };
    const urgency = messagesAt(legalIntakeSchema, wrong, 'urgency');
    const contact = messagesAt(legalIntakeSchema, wrong, 'contactPreference');
    expect(urgency).toHaveLength(1);
    expect(urgency).not.toContain('Choose a timeline');
    expect(contact).toHaveLength(1);
    expect(contact).not.toContain('Choose a contact preference');
  });

  it.each<[string, string, string]>([
    ['', 'jurisdiction', 'Select the state your matter is in'],
    ['Washington', 'jurisdiction', 'Use the 2-letter state code'],
  ])('rejects jurisdiction %j', (jurisdiction, field, message) => {
    expect(messagesAt(legalIntakeSchema, { ...valid, jurisdiction }, field)).toEqual([message]);
  });

  it('requires a matter type and enforces the shared title/description lengths', () => {
    const bad = { ...valid, matterCategoryId: '', title: 'Too short', description: 'Brief.' };
    expect(messagesAt(legalIntakeSchema, bad, 'matterCategoryId')).toEqual([
      'Select the type of legal help you need',
    ]);
    expect(messagesAt(legalIntakeSchema, bad, 'title')).toEqual([
      'Title must be at least 10 characters',
    ]);
    expect(messagesAt(legalIntakeSchema, bad, 'description')).toEqual([
      'Description must be at least 50 characters',
    ]);
  });
});

describe('listing field schemas', () => {
  it.each<[string, z.ZodType, string, string]>([
    ['a 4-char title', listingTitleSchema, 'Bike', 'Title must be at least 5 characters'],
    ['a 121-char title', listingTitleSchema, 'x'.repeat(121), 'Title must be at most 120 characters'],
    [
      'a 19-char description',
      listingDescriptionSchema,
      'x'.repeat(19),
      'Description must be at least 20 characters',
    ],
    [
      'a 5001-char description',
      listingDescriptionSchema,
      'x'.repeat(5001),
      'Description must be at most 5000 characters',
    ],
    ['a 4-digit zip', listingZipSchema, '9810', 'Pickup zip must be a valid 5-digit zip code'],
    ['a zip with letters', listingZipSchema, '9810A', 'Pickup zip must be a valid 5-digit zip code'],
    ['a malformed zip+4', listingZipSchema, '98101-12', 'Pickup zip must be a valid 5-digit zip code'],
  ])('rejects %s', (_label, schema, input, message) => {
    const result = schema.safeParse(input);
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((i) => i.message)).toEqual([message]);
  });

  it('accepts boundary lengths and both zip forms', () => {
    expect(listingTitleSchema.safeParse('x'.repeat(5)).success).toBe(true);
    expect(listingTitleSchema.safeParse('x'.repeat(120)).success).toBe(true);
    expect(listingDescriptionSchema.safeParse('x'.repeat(20)).success).toBe(true);
    expect(listingZipSchema.safeParse('98101').success).toBe(true);
    expect(listingZipSchema.safeParse('98101-1234').success).toBe(true);
  });
});

describe('listingPostingSchema', () => {
  const valid = {
    categoryId: 'cat-tools',
    title: 'DeWalt 20V drill kit',
    description: 'Lightly used drill with two batteries and a charger.',
    photoUrls: ['https://cdn.example.com/p/1.jpg'],
    pickupZip: '98101',
    startingPriceDollars: 40,
    auctionDurationHours: 48,
  };

  it('accepts a minimal listing with no buy-now price or condition', () => {
    const parsed = listingPostingSchema.parse(valid);
    expect(parsed.buyNowDollars).toBeUndefined();
    expect(parsed.condition).toBeUndefined();
  });

  it.each([24, 48, 168])('accepts a %d hour auction', (auctionDurationHours) => {
    expect(listingPostingSchema.safeParse({ ...valid, auctionDurationHours }).success).toBe(true);
  });

  it('asks for a duration only when it is missing, not when it is an unsupported value', () => {
    const { auctionDurationHours: _d, ...missing } = valid;
    expect(messagesAt(listingPostingSchema, missing, 'auctionDurationHours')).toContain(
      'Pick an auction duration',
    );

    const unsupported = messagesAt(
      listingPostingSchema,
      { ...valid, auctionDurationHours: 72 },
      'auctionDurationHours',
    );
    expect(unsupported.length).toBeGreaterThan(0);
    expect(unsupported).not.toContain('Pick an auction duration');
  });

  it.each([
    ['equal to the starting price', 40, 40],
    ['above the starting price', 40, 55.5],
    // 19.999 and 20 round to the same number of cents — not a violation.
    ['a sub-cent below the starting price', 20, 19.999],
  ])('accepts a buy-now price %s', (_label, startingPriceDollars, buyNowDollars) => {
    expect(
      listingPostingSchema.safeParse({ ...valid, startingPriceDollars, buyNowDollars }).success,
    ).toBe(true);
  });

  it('rejects a buy-now price below the starting price, on the buy-now field', () => {
    const input = { ...valid, startingPriceDollars: 40, buyNowDollars: 39.99 };
    expect(failingFields(listingPostingSchema, input)).toEqual(['buyNowDollars']);
    expect(messagesAt(listingPostingSchema, input, 'buyNowDollars')).toEqual([
      'Buy now must be at least the starting price.',
    ]);
  });

  it.each<[string, Record<string, unknown>, string, string]>([
    ['no photos', { photoUrls: [] }, 'photoUrls', 'At least one photo is required'],
    [
      'eleven photos',
      { photoUrls: Array.from({ length: 11 }, (_, i) => `https://cdn.example.com/p/${String(i)}.jpg`) },
      'photoUrls',
      'You can upload up to 10 photos',
    ],
    ['a non-URL photo', { photoUrls: ['not a url'] }, 'photoUrls', 'Each photo must be a valid URL'],
    ['a zero starting price', { startingPriceDollars: 0 }, 'startingPriceDollars', 'Starting price must be greater than $0'],
    ['a starting price over the cap', { startingPriceDollars: 1_000_001 }, 'startingPriceDollars', 'Starting price is too large'],
    ['a negative buy-now price', { buyNowDollars: -1 }, 'buyNowDollars', 'Buy now must be greater than $0'],
    ['a buy-now price over the cap', { buyNowDollars: 2_000_000 }, 'buyNowDollars', 'Buy now price is too large'],
    ['an empty category', { categoryId: '' }, 'categoryId', 'Category is required'],
    ['a bad pickup zip', { pickupZip: 'abcde' }, 'pickupZip', 'Pickup zip must be a valid 5-digit zip code'],
  ])('rejects %s', (_label, override, field, message) => {
    expect(messagesAt(listingPostingSchema, { ...valid, ...override }, field)).toContain(message);
  });

  it('accepts an empty or known condition and rejects an unknown one', () => {
    expect(listingPostingSchema.safeParse({ ...valid, condition: '' }).success).toBe(true);
    expect(listingPostingSchema.safeParse({ ...valid, condition: 'like_new' }).success).toBe(true);
    expect(failingFields(listingPostingSchema, { ...valid, condition: 'mint' })).toEqual([
      'condition',
    ]);
  });

  it('accepts an empty pickup address and rejects one over 200 characters', () => {
    expect(listingPostingSchema.safeParse({ ...valid, pickupAddress: '' }).success).toBe(true);
    expect(
      failingFields(listingPostingSchema, { ...valid, pickupAddress: 'x'.repeat(201) }),
    ).toEqual(['pickupAddress']);
  });
});

describe('jobPostingSchema — conditional messages and money transforms', () => {
  const valid = {
    categoryId: 'cat-1',
    title: 'Fix a leaking kitchen faucet',
    description: 'The kitchen faucet drips constantly and the handle is loose; needs repair soon.',
    scheduleType: 'flexible',
    isRecurring: false,
    auctionDurationHours: 72,
  };

  it('normalises a zero starting bid / accepted offer to undefined and keeps positive ones', () => {
    const zero = jobPostingSchema.parse({ ...valid, startingBidDollars: 0, offerAcceptedDollars: 0 });
    expect(zero.startingBidDollars).toBeUndefined();
    expect(zero.offerAcceptedDollars).toBeUndefined();

    const set = jobPostingSchema.parse({ ...valid, startingBidDollars: 300, offerAcceptedDollars: 250 });
    expect(set.startingBidDollars).toBe(300);
    expect(set.offerAcceptedDollars).toBe(250);
  });

  it.each<[string, string]>([
    ['startingBidDollars', 'Starting bid must be positive'],
    ['offerAcceptedDollars', 'Accepted offer must be positive'],
  ])('rejects a negative %s', (field, message) => {
    expect(messagesAt(jobPostingSchema, { ...valid, [field]: -10 }, field)).toContain(message);
  });

  it('asks for a schedule type only when it is missing', () => {
    const { scheduleType: _s, ...missing } = valid;
    expect(messagesAt(jobPostingSchema, missing, 'scheduleType')).toContain(
      'Schedule type is required',
    );

    const wrong = messagesAt(jobPostingSchema, { ...valid, scheduleType: 'someday' }, 'scheduleType');
    expect(wrong.length).toBeGreaterThan(0);
    expect(wrong).not.toContain('Schedule type is required');
  });

  it('rejects a fractional auction duration', () => {
    expect(
      messagesAt(jobPostingSchema, { ...valid, auctionDurationHours: 36.5 }, 'auctionDurationHours'),
    ).toEqual(['Duration must be a whole number']);
  });

  it('does not require a date for a date range, and treats an empty date as missing', () => {
    expect(jobPostingSchema.safeParse({ ...valid, scheduleType: 'date_range' }).success).toBe(true);
    expect(
      messagesAt(
        jobPostingSchema,
        { ...valid, scheduleType: 'specific_date', scheduledDate: '' },
        'scheduledDate',
      ),
    ).toEqual(['Scheduled date is required for specific date jobs']);
  });

  it('rejects an unknown auction type and a non-URL photo', () => {
    expect(
      failingFields(jobPostingSchema, { ...valid, auctionType: 'dutch', photoUrls: ['nope'] }),
    ).toEqual(['auctionType', 'photoUrls']);
  });
});

describe('globalTermsSchema — conditional messages', () => {
  it('asks for payment timing only when it is missing', () => {
    expect(messagesAt(globalTermsSchema, {}, 'paymentTiming')).toEqual([
      'Payment timing is required',
    ]);

    const wrong = messagesAt(globalTermsSchema, { paymentTiming: 'barter' }, 'paymentTiming');
    expect(wrong).toHaveLength(1);
    expect(wrong).not.toContain('Payment timing is required');
  });

  it('rejects an empty milestone list and out-of-range milestone rows', () => {
    expect(
      messagesAt(globalTermsSchema, { paymentTiming: 'milestone', milestones: [] }, 'milestones'),
    ).toEqual(['Milestone percentages must sum to 100']);

    const rows = messagesAt(
      globalTermsSchema,
      {
        paymentTiming: 'upfront',
        milestones: [
          { description: '', percentage: 0 },
          { description: 'Final', percentage: 101 },
        ],
      },
      'milestones',
    );
    expect(rows).toEqual(['Description is required', 'Must be at least 1%', 'Must be at most 100%']);
  });

  it('ignores milestone sums for non-milestone timings', () => {
    const result = globalTermsSchema.safeParse({
      paymentTiming: 'completion',
      milestones: [{ description: 'Deposit', percentage: 30 }],
    });
    expect(result.success).toBe(true);
  });
});

describe('businessInfoSchema — optional identifiers', () => {
  const valid = { businessName: 'Acme Plumbing' };

  it.each(['12-3456789', '123456789', ''])('accepts EIN/TIN %j', (einTin) => {
    expect(businessInfoSchema.safeParse({ ...valid, einTin }).success).toBe(true);
  });

  it.each(['12-345678', '1-23456789', 'AB-1234567'])('rejects EIN/TIN %j', (einTin) => {
    expect(messagesAt(businessInfoSchema, { ...valid, einTin }, 'einTin')).toContain(
      'EIN/TIN must be in XX-XXXXXXX format',
    );
  });

  it('rejects non-positive coverage and over-long insurance fields', () => {
    expect(
      messagesAt(businessInfoSchema, { ...valid, insuranceCoverageDollars: 0 }, 'insuranceCoverageDollars'),
    ).toEqual(['Coverage must be positive']);
    expect(
      failingFields(businessInfoSchema, {
        ...valid,
        insuranceProvider: 'x'.repeat(201),
        insurancePolicyNumber: 'x'.repeat(101),
      }),
    ).toEqual(['insurancePolicyNumber', 'insuranceProvider']);
  });
});

describe('addEmployeeSchema', () => {
  const valid = { firstName: 'Sam', lastName: 'Rivera', role: 'technician' };

  it('accepts the minimum and blank optional fields', () => {
    expect(addEmployeeSchema.safeParse(valid).success).toBe(true);
    expect(
      addEmployeeSchema.safeParse({ ...valid, email: '', phone: '', ssnLastFour: '', licenseNumber: '' })
        .success,
    ).toBe(true);
  });

  it.each(['technician', 'lead', 'manager', 'apprentice'])('accepts role %s', (role) => {
    expect(addEmployeeSchema.safeParse({ ...valid, role }).success).toBe(true);
  });

  it('asks for a role only when it is missing', () => {
    const { role: _r, ...missing } = valid;
    expect(messagesAt(addEmployeeSchema, missing, 'role')).toEqual(['Role is required']);

    const wrong = messagesAt(addEmployeeSchema, { ...valid, role: 'owner' }, 'role');
    expect(wrong).toHaveLength(1);
    expect(wrong).not.toContain('Role is required');
  });

  it.each<[string, Record<string, unknown>, string, string]>([
    ['an empty first name', { firstName: '' }, 'firstName', 'First name is required'],
    ['an empty last name', { lastName: '' }, 'lastName', 'Last name is required'],
    ['a malformed email', { email: 'sam@' }, 'email', 'Invalid email'],
    ['a 3-digit SSN suffix', { ssnLastFour: '123' }, 'ssnLastFour', 'Must be exactly 4 digits'],
    ['a non-numeric SSN suffix', { ssnLastFour: '12a4' }, 'ssnLastFour', 'Must be exactly 4 digits'],
  ])('rejects %s', (_label, override, field, message) => {
    expect(messagesAt(addEmployeeSchema, { ...valid, ...override }, field)).toContain(message);
  });

  it('accepts a valid email and SSN suffix', () => {
    expect(
      addEmployeeSchema.safeParse({ ...valid, email: 'sam@example.com', ssnLastFour: '0412' }).success,
    ).toBe(true);
  });
});

describe('propertySchema', () => {
  const valid = {
    nickname: 'Lake house',
    street: '12 Shore Rd',
    city: 'Seattle',
    state: 'WA',
    zip_code: '98101',
  };

  it('accepts 5-digit and zip+4 codes', () => {
    expect(propertySchema.safeParse(valid).success).toBe(true);
    expect(propertySchema.safeParse({ ...valid, zip_code: '98101-0042' }).success).toBe(true);
  });

  it.each<[string, Record<string, unknown>, string, string | null]>([
    ['an empty nickname', { nickname: '' }, 'nickname', 'Nickname is required'],
    ['an empty street', { street: '' }, 'street', 'Street is required'],
    ['an empty city', { city: '' }, 'city', 'City is required'],
    ['an empty state', { state: '' }, 'state', 'State is required'],
    ['a spelled-out state', { state: 'Washington' }, 'state', null],
    ['a short zip', { zip_code: '9810' }, 'zip_code', 'Invalid zip code'],
    ['notes over 500 characters', { notes: 'x'.repeat(501) }, 'notes', null],
  ])('rejects %s', (_label, override, field, message) => {
    const input = { ...valid, ...override };
    expect(failingFields(propertySchema, input)).toEqual([field]);
    if (message !== null) {
      expect(messagesAt(propertySchema, input, field)).toEqual([message]);
    }
  });
});

describe('password flows', () => {
  it('forgotPassword requires a well-formed email', () => {
    expect(forgotPasswordSchema.safeParse({ email: 'a@b.co' }).success).toBe(true);
    expect(messagesAt(forgotPasswordSchema, { email: 'a@b' }, 'email')).toEqual([
      'Invalid email address',
    ]);
  });

  it('resetPassword accepts matching strong passwords', () => {
    expect(
      resetPasswordSchema.safeParse({ password: STRONG_PASSWORD, confirmPassword: STRONG_PASSWORD })
        .success,
    ).toBe(true);
  });

  it('resetPassword reports a mismatch on the confirmation field', () => {
    const input = { password: STRONG_PASSWORD, confirmPassword: `${STRONG_PASSWORD}!` };
    expect(failingFields(resetPasswordSchema, input)).toEqual(['confirmPassword']);
    expect(messagesAt(resetPasswordSchema, input, 'confirmPassword')).toEqual([
      'Passwords do not match',
    ]);
  });

  it('resetPassword reports a weak password by its rule', () => {
    expect(
      messagesAt(resetPasswordSchema, { password: 'weakpass', confirmPassword: 'weakpass' }, 'password'),
    ).toEqual([
      'Password must contain at least one uppercase letter',
      'Password must contain at least one number',
      'Password must contain at least one special character',
    ]);
  });

  it('changePassword accepts a current password plus a matching strong new one', () => {
    expect(
      changePasswordSchema.safeParse({
        currentPassword: 'old',
        newPassword: STRONG_PASSWORD,
        confirmNewPassword: STRONG_PASSWORD,
      }).success,
    ).toBe(true);
  });

  it('changePassword requires the current password and a matching confirmation', () => {
    const input = {
      currentPassword: '',
      newPassword: STRONG_PASSWORD,
      confirmNewPassword: 'different',
    };
    expect(messagesAt(changePasswordSchema, input, 'currentPassword')).toEqual([
      'Current password is required',
    ]);
    expect(
      messagesAt(changePasswordSchema, { ...input, currentPassword: 'old' }, 'confirmNewPassword'),
    ).toEqual(['Passwords do not match']);
  });
});

describe('mfaCodeSchema', () => {
  it.each(['123456', '1234567', 'ABCD1234'])('accepts %s', (code) => {
    expect(mfaCodeSchema.safeParse(code).success).toBe(true);
  });

  it.each<[string, string]>([
    ['12345', 'Code must be at least 6 characters'],
    ['123456789', 'Code must be at most 8 characters'],
  ])('rejects %s', (code, message) => {
    const result = mfaCodeSchema.safeParse(code);
    expect(result.error?.issues.map((i) => i.message)).toEqual([message]);
  });
});
