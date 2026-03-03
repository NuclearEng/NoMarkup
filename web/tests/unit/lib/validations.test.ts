import { describe, expect, it } from 'vitest';

import {
  emailSchema,
  passwordSchema,
  displayNameSchema,
  phoneSchema,
  loginSchema,
  registerSchema,
  jobTitleSchema,
  jobDescriptionSchema,
  bidAmountSchema,
  reviewCommentSchema,
  ratingSchema,
  profileSchema,
  businessInfoSchema,
  globalTermsSchema,
  jobPostingSchema,
  bidSchema,
  revisionNotesSchema,
  reviewSchema,
  reviewResponseSchema,
  chatMessageSchema,
} from '@/lib/validations';

describe('emailSchema', () => {
  it('accepts valid email addresses', () => {
    expect(emailSchema.safeParse('user@example.com').success).toBe(true);
    expect(emailSchema.safeParse('test.name@domain.co.uk').success).toBe(true);
  });

  it('rejects invalid email addresses', () => {
    const result = emailSchema.safeParse('not-an-email');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe('Invalid email address');
    }
  });

  it('rejects empty string', () => {
    expect(emailSchema.safeParse('').success).toBe(false);
  });
});

describe('passwordSchema', () => {
  const validPassword = 'StrongP@ss1';

  it('accepts a valid password', () => {
    expect(passwordSchema.safeParse(validPassword).success).toBe(true);
  });

  it('rejects passwords shorter than 8 characters', () => {
    const result = passwordSchema.safeParse('Ab1!');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(
        'Password must be at least 8 characters',
      );
    }
  });

  it('rejects passwords longer than 128 characters', () => {
    const longPassword = 'Aa1!' + 'a'.repeat(125);
    const result = passwordSchema.safeParse(longPassword);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(
        'Password must be at most 128 characters',
      );
    }
  });

  it('rejects passwords without uppercase', () => {
    const result = passwordSchema.safeParse('lowercase1!');
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages).toContain(
        'Password must contain at least one uppercase letter',
      );
    }
  });

  it('rejects passwords without lowercase', () => {
    const result = passwordSchema.safeParse('UPPERCASE1!');
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages).toContain(
        'Password must contain at least one lowercase letter',
      );
    }
  });

  it('rejects passwords without a number', () => {
    const result = passwordSchema.safeParse('NoNumbers!@');
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages).toContain(
        'Password must contain at least one number',
      );
    }
  });

  it('rejects passwords without a special character', () => {
    const result = passwordSchema.safeParse('NoSpecial1A');
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages).toContain(
        'Password must contain at least one special character',
      );
    }
  });
});

describe('displayNameSchema', () => {
  it('accepts valid display names', () => {
    expect(displayNameSchema.safeParse('Jo').success).toBe(true);
    expect(displayNameSchema.safeParse('John Doe').success).toBe(true);
  });

  it('rejects names shorter than 2 characters', () => {
    const result = displayNameSchema.safeParse('J');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(
        'Display name must be at least 2 characters',
      );
    }
  });

  it('rejects names longer than 100 characters', () => {
    const result = displayNameSchema.safeParse('A'.repeat(101));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(
        'Display name must be at most 100 characters',
      );
    }
  });
});

describe('phoneSchema', () => {
  it('accepts valid phone numbers', () => {
    expect(phoneSchema.safeParse('+12125551234').success).toBe(true);
    expect(phoneSchema.safeParse('12125551234').success).toBe(true);
  });

  it('rejects invalid phone numbers', () => {
    const result = phoneSchema.safeParse('not-a-phone');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe('Invalid phone number');
    }
  });

  it('rejects numbers starting with 0', () => {
    expect(phoneSchema.safeParse('0123456789').success).toBe(false);
  });
});

describe('loginSchema', () => {
  it('accepts valid login input', () => {
    const result = loginSchema.safeParse({
      email: 'user@example.com',
      password: 'StrongP@ss1',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid email in login', () => {
    const result = loginSchema.safeParse({
      email: 'bad',
      password: 'StrongP@ss1',
    });
    expect(result.success).toBe(false);
  });

  it('rejects weak password in login', () => {
    const result = loginSchema.safeParse({
      email: 'user@example.com',
      password: 'weak',
    });
    expect(result.success).toBe(false);
  });
});

describe('registerSchema', () => {
  const validInput = {
    email: 'user@example.com',
    password: 'StrongP@ss1',
    confirmPassword: 'StrongP@ss1',
    displayName: 'Test User',
  };

  it('accepts valid registration input', () => {
    expect(registerSchema.safeParse(validInput).success).toBe(true);
  });

  it('rejects mismatched passwords', () => {
    const result = registerSchema.safeParse({
      ...validInput,
      confirmPassword: 'DifferentP@ss1',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages).toContain('Passwords do not match');
    }
  });

  it('rejects short display name', () => {
    const result = registerSchema.safeParse({
      ...validInput,
      displayName: 'A',
    });
    expect(result.success).toBe(false);
  });
});

describe('jobTitleSchema', () => {
  it('accepts valid titles', () => {
    expect(jobTitleSchema.safeParse('Fix my kitchen sink plumbing').success).toBe(true);
  });

  it('rejects titles shorter than 10 characters', () => {
    const result = jobTitleSchema.safeParse('Short');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(
        'Title must be at least 10 characters',
      );
    }
  });

  it('rejects titles longer than 200 characters', () => {
    const result = jobTitleSchema.safeParse('A'.repeat(201));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(
        'Title must be at most 200 characters',
      );
    }
  });
});

describe('jobDescriptionSchema', () => {
  it('accepts valid descriptions', () => {
    const desc = 'A'.repeat(50);
    expect(jobDescriptionSchema.safeParse(desc).success).toBe(true);
  });

  it('rejects descriptions shorter than 50 characters', () => {
    const result = jobDescriptionSchema.safeParse('Too short');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(
        'Description must be at least 50 characters',
      );
    }
  });

  it('rejects descriptions longer than 5000 characters', () => {
    const result = jobDescriptionSchema.safeParse('A'.repeat(5001));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(
        'Description must be at most 5000 characters',
      );
    }
  });
});

describe('bidAmountSchema', () => {
  it('accepts positive integer amounts', () => {
    expect(bidAmountSchema.safeParse(100).success).toBe(true);
    expect(bidAmountSchema.safeParse(1).success).toBe(true);
  });

  it('rejects zero', () => {
    const result = bidAmountSchema.safeParse(0);
    expect(result.success).toBe(false);
  });

  it('rejects negative amounts', () => {
    const result = bidAmountSchema.safeParse(-100);
    expect(result.success).toBe(false);
  });

  it('rejects non-integer amounts', () => {
    const result = bidAmountSchema.safeParse(10.5);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe('Amount must be in whole cents');
    }
  });
});

describe('reviewCommentSchema', () => {
  it('accepts valid review comments', () => {
    expect(reviewCommentSchema.safeParse('A'.repeat(50)).success).toBe(true);
  });

  it('rejects comments shorter than 50 characters', () => {
    const result = reviewCommentSchema.safeParse('Too short');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(
        'Review must be at least 50 characters',
      );
    }
  });

  it('rejects comments longer than 2000 characters', () => {
    const result = reviewCommentSchema.safeParse('A'.repeat(2001));
    expect(result.success).toBe(false);
  });
});

describe('ratingSchema', () => {
  it('accepts ratings 1 through 5', () => {
    for (let i = 1; i <= 5; i++) {
      expect(ratingSchema.safeParse(i).success).toBe(true);
    }
  });

  it('rejects 0', () => {
    expect(ratingSchema.safeParse(0).success).toBe(false);
  });

  it('rejects 6', () => {
    expect(ratingSchema.safeParse(6).success).toBe(false);
  });

  it('rejects non-integers', () => {
    expect(ratingSchema.safeParse(3.5).success).toBe(false);
  });
});

describe('profileSchema', () => {
  it('accepts valid profile data', () => {
    const result = profileSchema.safeParse({
      displayName: 'John Doe',
      timezone: 'America/New_York',
    });
    expect(result.success).toBe(true);
  });

  it('accepts profile with optional fields', () => {
    const result = profileSchema.safeParse({
      displayName: 'John Doe',
      phone: '+12125551234',
      timezone: 'America/New_York',
      avatarUrl: 'https://example.com/avatar.png',
    });
    expect(result.success).toBe(true);
  });

  it('accepts empty string for optional phone', () => {
    const result = profileSchema.safeParse({
      displayName: 'John Doe',
      phone: '',
      timezone: 'America/New_York',
    });
    expect(result.success).toBe(true);
  });

  it('accepts empty string for optional avatarUrl', () => {
    const result = profileSchema.safeParse({
      displayName: 'John Doe',
      timezone: 'America/New_York',
      avatarUrl: '',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing timezone', () => {
    const result = profileSchema.safeParse({
      displayName: 'John Doe',
      timezone: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid avatar URL', () => {
    const result = profileSchema.safeParse({
      displayName: 'John Doe',
      timezone: 'America/New_York',
      avatarUrl: 'not-a-url',
    });
    expect(result.success).toBe(false);
  });
});

describe('businessInfoSchema', () => {
  it('accepts valid business info', () => {
    const result = businessInfoSchema.safeParse({
      businessName: 'Acme Corp',
    });
    expect(result.success).toBe(true);
  });

  it('accepts business info with optional fields', () => {
    const result = businessInfoSchema.safeParse({
      businessName: 'Acme Corp',
      bio: 'We do great work.',
      serviceAddress: '123 Main St',
    });
    expect(result.success).toBe(true);
  });

  it('rejects business name shorter than 2 characters', () => {
    const result = businessInfoSchema.safeParse({ businessName: 'A' });
    expect(result.success).toBe(false);
  });

  it('rejects bio longer than 500 characters', () => {
    const result = businessInfoSchema.safeParse({
      businessName: 'Acme',
      bio: 'B'.repeat(501),
    });
    expect(result.success).toBe(false);
  });
});

describe('globalTermsSchema', () => {
  it('accepts valid terms with non-milestone payment timing', () => {
    const result = globalTermsSchema.safeParse({
      paymentTiming: 'upfront',
    });
    expect(result.success).toBe(true);
  });

  it('accepts milestone timing with milestones summing to 100', () => {
    const result = globalTermsSchema.safeParse({
      paymentTiming: 'milestone',
      milestones: [
        { description: 'Phase 1', percentage: 50 },
        { description: 'Phase 2', percentage: 50 },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects milestone timing without milestones', () => {
    const result = globalTermsSchema.safeParse({
      paymentTiming: 'milestone',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages).toContain('Milestone percentages must sum to 100');
    }
  });

  it('rejects milestone timing with percentages not summing to 100', () => {
    const result = globalTermsSchema.safeParse({
      paymentTiming: 'milestone',
      milestones: [
        { description: 'Phase 1', percentage: 40 },
        { description: 'Phase 2', percentage: 40 },
      ],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages).toContain('Milestone percentages must sum to 100');
    }
  });

  it('rejects invalid payment timing value', () => {
    const result = globalTermsSchema.safeParse({
      paymentTiming: 'invalid',
    });
    expect(result.success).toBe(false);
  });

  it('accepts all valid payment timing values', () => {
    const timings = ['upfront', 'milestone', 'completion', 'payment_plan', 'recurring'];
    for (const timing of timings) {
      if (timing === 'milestone') continue;
      const result = globalTermsSchema.safeParse({ paymentTiming: timing });
      expect(result.success).toBe(true);
    }
  });
});

describe('jobPostingSchema', () => {
  const validJob = {
    categoryId: 'cat-123',
    title: 'Fix my kitchen sink plumbing issue',
    description: 'A'.repeat(50),
    scheduleType: 'flexible' as const,
    isRecurring: false,
    auctionDurationHours: 48,
  };

  it('accepts valid job posting', () => {
    expect(jobPostingSchema.safeParse(validJob).success).toBe(true);
  });

  it('requires scheduledDate when scheduleType is specific_date', () => {
    const result = jobPostingSchema.safeParse({
      ...validJob,
      scheduleType: 'specific_date',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages).toContain(
        'Scheduled date is required for specific date jobs',
      );
    }
  });

  it('accepts specific_date with scheduledDate', () => {
    const result = jobPostingSchema.safeParse({
      ...validJob,
      scheduleType: 'specific_date',
      scheduledDate: '2026-04-01',
    });
    expect(result.success).toBe(true);
  });

  it('requires recurrenceFrequency when isRecurring is true', () => {
    const result = jobPostingSchema.safeParse({
      ...validJob,
      isRecurring: true,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages).toContain(
        'Recurrence frequency is required for recurring jobs',
      );
    }
  });

  it('accepts recurring with frequency', () => {
    const result = jobPostingSchema.safeParse({
      ...validJob,
      isRecurring: true,
      recurrenceFrequency: 'weekly',
    });
    expect(result.success).toBe(true);
  });

  it('rejects auction duration less than 24 hours', () => {
    const result = jobPostingSchema.safeParse({
      ...validJob,
      auctionDurationHours: 12,
    });
    expect(result.success).toBe(false);
  });

  it('rejects auction duration more than 168 hours', () => {
    const result = jobPostingSchema.safeParse({
      ...validJob,
      auctionDurationHours: 200,
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing categoryId', () => {
    const result = jobPostingSchema.safeParse({
      ...validJob,
      categoryId: '',
    });
    expect(result.success).toBe(false);
  });
});

describe('bidSchema', () => {
  it('accepts a positive bid amount', () => {
    expect(bidSchema.safeParse({ amountDollars: 50 }).success).toBe(true);
  });

  it('rejects zero bid amount', () => {
    const result = bidSchema.safeParse({ amountDollars: 0 });
    expect(result.success).toBe(false);
  });

  it('rejects negative bid amount', () => {
    const result = bidSchema.safeParse({ amountDollars: -10 });
    expect(result.success).toBe(false);
  });
});

describe('revisionNotesSchema', () => {
  it('accepts notes with at least 10 characters', () => {
    expect(revisionNotesSchema.safeParse('A'.repeat(10)).success).toBe(true);
  });

  it('rejects notes shorter than 10 characters', () => {
    const result = revisionNotesSchema.safeParse('Short');
    expect(result.success).toBe(false);
  });

  it('rejects notes longer than 2000 characters', () => {
    const result = revisionNotesSchema.safeParse('A'.repeat(2001));
    expect(result.success).toBe(false);
  });
});

describe('reviewSchema', () => {
  const validReview = {
    overallRating: 4,
    comment: 'A'.repeat(50),
  };

  it('accepts a valid review', () => {
    expect(reviewSchema.safeParse(validReview).success).toBe(true);
  });

  it('accepts a review with all optional ratings', () => {
    const result = reviewSchema.safeParse({
      ...validReview,
      qualityRating: 5,
      communicationRating: 4,
      timelinessRating: 3,
      valueRating: 5,
    });
    expect(result.success).toBe(true);
  });

  it('rejects overall rating outside 1-5', () => {
    expect(
      reviewSchema.safeParse({ ...validReview, overallRating: 0 }).success,
    ).toBe(false);
    expect(
      reviewSchema.safeParse({ ...validReview, overallRating: 6 }).success,
    ).toBe(false);
  });

  it('rejects comment shorter than 50 characters', () => {
    const result = reviewSchema.safeParse({
      ...validReview,
      comment: 'Short',
    });
    expect(result.success).toBe(false);
  });

  it('rejects comment longer than 2000 characters', () => {
    const result = reviewSchema.safeParse({
      ...validReview,
      comment: 'A'.repeat(2001),
    });
    expect(result.success).toBe(false);
  });
});

describe('reviewResponseSchema', () => {
  it('accepts a valid response', () => {
    expect(reviewResponseSchema.safeParse('A'.repeat(10)).success).toBe(true);
  });

  it('rejects response shorter than 10 characters', () => {
    const result = reviewResponseSchema.safeParse('Short');
    expect(result.success).toBe(false);
  });

  it('rejects response longer than 2000 characters', () => {
    const result = reviewResponseSchema.safeParse('A'.repeat(2001));
    expect(result.success).toBe(false);
  });
});

describe('chatMessageSchema', () => {
  it('accepts a valid message', () => {
    expect(chatMessageSchema.safeParse('Hello!').success).toBe(true);
  });

  it('rejects empty message', () => {
    const result = chatMessageSchema.safeParse('');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe('Message cannot be empty');
    }
  });

  it('rejects message longer than 2000 characters', () => {
    const result = chatMessageSchema.safeParse('A'.repeat(2001));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe('Message too long');
    }
  });
});
