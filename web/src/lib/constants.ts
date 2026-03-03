export const APP_NAME = 'NoMarkup' as const;

export const API_BASE_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:8080';

export const AUCTION_DURATION_OPTIONS = [24, 48, 72] as const;
export const MAX_BID_PHOTOS = 10;
export const MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
export const MAX_DOCUMENT_SIZE_BYTES = 25 * 1024 * 1024; // 25MB

export const REVIEW_MIN_COMMENT_LENGTH = 50;
export const REVIEW_WINDOW_DAYS = 14;
export const REVISION_MIN_NOTES_LENGTH = 200;

export const MIN_TOUCH_TARGET_PX = 44; // WCAG 2.2 AA
