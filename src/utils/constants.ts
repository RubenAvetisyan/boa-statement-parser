export const PARSER_VERSION = '1.1.1';

export const BOA_INSTITUTION_NAME = 'Bank of America';

export const DATE_FORMATS = {
  ISO: 'YYYY-MM-DD',
  US_SHORT: 'MM/DD/YY',
  US_LONG: 'MM/DD/YYYY',
} as const;

export const ACCOUNT_NUMBER_MASK_LENGTH = 4;

export const CONFIDENCE_THRESHOLDS = {
  HIGH: 0.9,
  MEDIUM: 0.7,
  LOW: 0.5,
} as const;
