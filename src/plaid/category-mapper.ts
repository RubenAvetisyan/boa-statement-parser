/**
 * Plaid category to project category mapping.
 * Maps Plaid's personal_finance_category to our Category/Subcategory system.
 */

import type { Category, Subcategory } from '../types/output.js';

export interface PlaidCategoryMapping {
  category: Category;
  subcategory: Subcategory;
  confidence: number;
}

/**
 * Map Plaid primary category to our category system.
 * Based on Plaid's personal_finance_category taxonomy.
 * @see https://plaid.com/documents/transactions-personal-finance-category-taxonomy.csv
 */
const PRIMARY_CATEGORY_MAP: Record<string, PlaidCategoryMapping> = {
  // Income
  'INCOME': { category: 'Income', subcategory: 'Salary', confidence: 0.9 },
  
  // Transfers
  'TRANSFER_IN': { category: 'Transfer', subcategory: 'Transfer', confidence: 0.95 },
  'TRANSFER_OUT': { category: 'Transfer', subcategory: 'Transfer', confidence: 0.95 },
  
  // Loan Payments
  'LOAN_PAYMENTS': { category: 'Financial', subcategory: 'Loan Payment', confidence: 0.9 },
  
  // Bank Fees
  'BANK_FEES': { category: 'Fees', subcategory: 'Fees', confidence: 0.95 },
  
  // Entertainment
  'ENTERTAINMENT': { category: 'Entertainment', subcategory: null, confidence: 0.85 },
  
  // Food and Drink
  'FOOD_AND_DRINK': { category: 'Food & Dining', subcategory: null, confidence: 0.85 },
  
  // General Merchandise
  'GENERAL_MERCHANDISE': { category: 'Shopping', subcategory: 'General Merchandise', confidence: 0.8 },
  
  // Home Improvement
  'HOME_IMPROVEMENT': { category: 'Shopping', subcategory: 'Home Improvement', confidence: 0.85 },
  
  // Medical
  'MEDICAL': { category: 'Health', subcategory: 'Medical', confidence: 0.9 },
  
  // Personal Care
  'PERSONAL_CARE': { category: 'Personal Care', subcategory: null, confidence: 0.85 },
  
  // General Services
  'GENERAL_SERVICES': { category: 'Uncategorized', subcategory: null, confidence: 0.5 },
  
  // Government and Non-Profit
  'GOVERNMENT_AND_NON_PROFIT': { category: 'Taxes', subcategory: null, confidence: 0.7 },
  
  // Transportation
  'TRANSPORTATION': { category: 'Transportation', subcategory: null, confidence: 0.85 },
  
  // Travel
  'TRAVEL': { category: 'Travel', subcategory: null, confidence: 0.85 },
  
  // Rent and Utilities
  'RENT_AND_UTILITIES': { category: 'Housing', subcategory: 'Rent', confidence: 0.85 },
};

/**
 * Map Plaid detailed category to our category system.
 * More specific mappings that override primary categories.
 */
const DETAILED_CATEGORY_MAP: Record<string, PlaidCategoryMapping> = {
  // Income - detailed
  'INCOME_DIVIDENDS': { category: 'Income', subcategory: 'Dividends', confidence: 0.95 },
  'INCOME_INTEREST_EARNED': { category: 'Income', subcategory: 'Interest', confidence: 0.95 },
  'INCOME_RETIREMENT_PENSION': { category: 'Income', subcategory: null, confidence: 0.9 },
  'INCOME_TAX_REFUND': { category: 'Income', subcategory: 'Refund', confidence: 0.95 },
  'INCOME_UNEMPLOYMENT': { category: 'Income', subcategory: null, confidence: 0.9 },
  'INCOME_WAGES': { category: 'Income', subcategory: 'Salary', confidence: 0.95 },
  'INCOME_OTHER_INCOME': { category: 'Income', subcategory: null, confidence: 0.8 },

  // Transfer - detailed
  'TRANSFER_IN_CASH_ADVANCES_AND_LOANS': { category: 'Financial', subcategory: 'Cash Advance', confidence: 0.9 },
  'TRANSFER_IN_DEPOSIT': { category: 'Transfer', subcategory: 'Deposit', confidence: 0.95 },
  'TRANSFER_IN_INVESTMENT_AND_RETIREMENT_FUNDS': { category: 'Financial', subcategory: 'Investment', confidence: 0.9 },
  'TRANSFER_IN_SAVINGS': { category: 'Transfer', subcategory: 'Bank', confidence: 0.95 },
  'TRANSFER_IN_ACCOUNT_TRANSFER': { category: 'Transfer', subcategory: 'Transfer', confidence: 0.95 },
  'TRANSFER_IN_OTHER_TRANSFER_IN': { category: 'Transfer', subcategory: 'Transfer', confidence: 0.8 },
  
  'TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS': { category: 'Financial', subcategory: 'Investment', confidence: 0.9 },
  'TRANSFER_OUT_SAVINGS': { category: 'Transfer', subcategory: 'Bank', confidence: 0.95 },
  'TRANSFER_OUT_WITHDRAWAL': { category: 'Transfer', subcategory: 'ATM', confidence: 0.95 },
  'TRANSFER_OUT_ACCOUNT_TRANSFER': { category: 'Transfer', subcategory: 'Transfer', confidence: 0.95 },
  'TRANSFER_OUT_OTHER_TRANSFER_OUT': { category: 'Transfer', subcategory: 'Transfer', confidence: 0.8 },

  // Loan Payments - detailed
  'LOAN_PAYMENTS_CAR_PAYMENT': { category: 'Transportation', subcategory: 'Insurance', confidence: 0.9 },
  'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT': { category: 'Financial', subcategory: 'Credit Card Payment', confidence: 0.95 },
  'LOAN_PAYMENTS_PERSONAL_LOAN_PAYMENT': { category: 'Financial', subcategory: 'Loan Payment', confidence: 0.95 },
  'LOAN_PAYMENTS_MORTGAGE_PAYMENT': { category: 'Housing', subcategory: 'Mortgage', confidence: 0.95 },
  'LOAN_PAYMENTS_STUDENT_LOAN_PAYMENT': { category: 'Education', subcategory: 'Tuition', confidence: 0.9 },
  'LOAN_PAYMENTS_OTHER_PAYMENT': { category: 'Financial', subcategory: 'Loan Payment', confidence: 0.8 },

  // Bank Fees - detailed
  'BANK_FEES_ATM_FEES': { category: 'Fees', subcategory: 'Fees', confidence: 0.95 },
  'BANK_FEES_FOREIGN_TRANSACTION_FEES': { category: 'Fees', subcategory: 'Fees', confidence: 0.95 },
  'BANK_FEES_INSUFFICIENT_FUNDS': { category: 'Fees', subcategory: 'Fees', confidence: 0.95 },
  'BANK_FEES_INTEREST_CHARGE': { category: 'Fees', subcategory: 'Fees', confidence: 0.95 },
  'BANK_FEES_OVERDRAFT_FEES': { category: 'Fees', subcategory: 'Fees', confidence: 0.95 },
  'BANK_FEES_OTHER_BANK_FEES': { category: 'Fees', subcategory: 'Fees', confidence: 0.8 },

  // Entertainment - detailed
  'ENTERTAINMENT_CASINOS_AND_GAMBLING': { category: 'Entertainment', subcategory: 'Gaming', confidence: 0.9 },
  'ENTERTAINMENT_MUSIC_AND_AUDIO': { category: 'Entertainment', subcategory: 'Streaming', confidence: 0.9 },
  'ENTERTAINMENT_SPORTING_EVENTS_AMUSEMENT_PARKS_AND_MUSEUMS': { category: 'Entertainment', subcategory: 'Events', confidence: 0.9 },
  'ENTERTAINMENT_TV_AND_MOVIES': { category: 'Entertainment', subcategory: 'Streaming', confidence: 0.9 },
  'ENTERTAINMENT_VIDEO_GAMES': { category: 'Entertainment', subcategory: 'Gaming', confidence: 0.9 },
  'ENTERTAINMENT_OTHER_ENTERTAINMENT': { category: 'Entertainment', subcategory: null, confidence: 0.7 },

  // Food and Drink - detailed
  'FOOD_AND_DRINK_BEER_WINE_AND_LIQUOR': { category: 'Food & Dining', subcategory: 'Alcohol', confidence: 0.9 },
  'FOOD_AND_DRINK_COFFEE': { category: 'Food & Dining', subcategory: 'Restaurants', confidence: 0.9 },
  'FOOD_AND_DRINK_FAST_FOOD': { category: 'Food & Dining', subcategory: 'Restaurants', confidence: 0.95 },
  'FOOD_AND_DRINK_GROCERIES': { category: 'Food & Dining', subcategory: 'Groceries', confidence: 0.95 },
  'FOOD_AND_DRINK_RESTAURANT': { category: 'Food & Dining', subcategory: 'Restaurants', confidence: 0.95 },
  'FOOD_AND_DRINK_VENDING_MACHINES': { category: 'Food & Dining', subcategory: null, confidence: 0.8 },
  'FOOD_AND_DRINK_OTHER_FOOD_AND_DRINK': { category: 'Food & Dining', subcategory: null, confidence: 0.7 },

  // General Merchandise - detailed
  'GENERAL_MERCHANDISE_BOOKSTORES_AND_NEWSSTANDS': { category: 'Shopping', subcategory: 'General Merchandise', confidence: 0.9 },
  'GENERAL_MERCHANDISE_CLOTHING_AND_ACCESSORIES': { category: 'Shopping', subcategory: 'Clothing', confidence: 0.9 },
  'GENERAL_MERCHANDISE_CONVENIENCE_STORES': { category: 'Shopping', subcategory: 'Convenience Store', confidence: 0.9 },
  'GENERAL_MERCHANDISE_DEPARTMENT_STORES': { category: 'Shopping', subcategory: 'General Merchandise', confidence: 0.9 },
  'GENERAL_MERCHANDISE_DISCOUNT_STORES': { category: 'Shopping', subcategory: 'General Merchandise', confidence: 0.9 },
  'GENERAL_MERCHANDISE_ELECTRONICS': { category: 'Shopping', subcategory: 'Electronics', confidence: 0.9 },
  'GENERAL_MERCHANDISE_GIFTS_AND_NOVELTIES': { category: 'Shopping', subcategory: 'General Merchandise', confidence: 0.85 },
  'GENERAL_MERCHANDISE_OFFICE_SUPPLIES': { category: 'Shopping', subcategory: 'General Merchandise', confidence: 0.9 },
  'GENERAL_MERCHANDISE_ONLINE_MARKETPLACES': { category: 'Shopping', subcategory: 'Online', confidence: 0.85 },
  'GENERAL_MERCHANDISE_PET_SUPPLIES': { category: 'Pets', subcategory: 'Pet Care', confidence: 0.9 },
  'GENERAL_MERCHANDISE_SPORTING_GOODS': { category: 'Shopping', subcategory: 'General Merchandise', confidence: 0.9 },
  'GENERAL_MERCHANDISE_SUPERSTORES': { category: 'Shopping', subcategory: 'General Merchandise', confidence: 0.9 },
  'GENERAL_MERCHANDISE_TOBACCO_AND_VAPE': { category: 'Shopping', subcategory: 'General Merchandise', confidence: 0.9 },
  'GENERAL_MERCHANDISE_OTHER_GENERAL_MERCHANDISE': { category: 'Shopping', subcategory: 'General Merchandise', confidence: 0.7 },

  // Home Improvement - detailed
  'HOME_IMPROVEMENT_FURNITURE': { category: 'Shopping', subcategory: 'Home Improvement', confidence: 0.9 },
  'HOME_IMPROVEMENT_HARDWARE': { category: 'Shopping', subcategory: 'Home Improvement', confidence: 0.9 },
  'HOME_IMPROVEMENT_REPAIR_AND_MAINTENANCE': { category: 'Housing', subcategory: null, confidence: 0.9 },
  'HOME_IMPROVEMENT_SECURITY': { category: 'Housing', subcategory: 'Security', confidence: 0.9 },
  'HOME_IMPROVEMENT_OTHER_HOME_IMPROVEMENT': { category: 'Shopping', subcategory: 'Home Improvement', confidence: 0.7 },

  // Medical - detailed
  'MEDICAL_DENTAL_CARE': { category: 'Health', subcategory: 'Dental', confidence: 0.95 },
  'MEDICAL_EYE_CARE': { category: 'Health', subcategory: 'Vision', confidence: 0.95 },
  'MEDICAL_NURSING_CARE': { category: 'Health', subcategory: 'Medical', confidence: 0.9 },
  'MEDICAL_PHARMACIES_AND_SUPPLEMENTS': { category: 'Health', subcategory: 'Pharmacy', confidence: 0.95 },
  'MEDICAL_PRIMARY_CARE': { category: 'Health', subcategory: 'Medical', confidence: 0.95 },
  'MEDICAL_VETERINARY_SERVICES': { category: 'Pets', subcategory: 'Pet Care', confidence: 0.95 },
  'MEDICAL_OTHER_MEDICAL': { category: 'Health', subcategory: 'Medical', confidence: 0.8 },

  // Personal Care - detailed
  'PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS': { category: 'Health', subcategory: 'Fitness', confidence: 0.95 },
  'PERSONAL_CARE_HAIR_AND_BEAUTY': { category: 'Personal Care', subcategory: 'Beauty', confidence: 0.9 },
  'PERSONAL_CARE_LAUNDRY_AND_DRY_CLEANING': { category: 'Personal Care', subcategory: 'Grooming', confidence: 0.9 },
  'PERSONAL_CARE_OTHER_PERSONAL_CARE': { category: 'Personal Care', subcategory: null, confidence: 0.7 },

  // Government and Non-Profit - detailed
  'GOVERNMENT_AND_NON_PROFIT_DONATIONS': { category: 'Charity', subcategory: 'Donation', confidence: 0.95 },
  'GOVERNMENT_AND_NON_PROFIT_GOVERNMENT_DEPARTMENTS_AND_AGENCIES': { category: 'Taxes', subcategory: null, confidence: 0.85 },
  'GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT': { category: 'Taxes', subcategory: 'Tax Payment', confidence: 0.95 },
  'GOVERNMENT_AND_NON_PROFIT_OTHER_GOVERNMENT_AND_NON_PROFIT': { category: 'Uncategorized', subcategory: null, confidence: 0.5 },

  // Transportation - detailed
  'TRANSPORTATION_BIKES_AND_SCOOTERS': { category: 'Transportation', subcategory: 'Rideshare', confidence: 0.9 },
  'TRANSPORTATION_GAS': { category: 'Transportation', subcategory: null, confidence: 0.95 },
  'TRANSPORTATION_PARKING': { category: 'Transportation', subcategory: 'Parking', confidence: 0.95 },
  'TRANSPORTATION_PUBLIC_TRANSIT': { category: 'Transportation', subcategory: 'Public Transit', confidence: 0.95 },
  'TRANSPORTATION_TAXIS_AND_RIDE_SHARES': { category: 'Transportation', subcategory: 'Rideshare', confidence: 0.95 },
  'TRANSPORTATION_TOLLS': { category: 'Transportation', subcategory: 'Tolls', confidence: 0.95 },
  'TRANSPORTATION_OTHER_TRANSPORTATION': { category: 'Transportation', subcategory: null, confidence: 0.7 },

  // Travel - detailed
  'TRAVEL_FLIGHTS': { category: 'Travel', subcategory: 'Flights', confidence: 0.95 },
  'TRAVEL_LODGING': { category: 'Travel', subcategory: 'Lodging', confidence: 0.95 },
  'TRAVEL_RENTAL_CARS': { category: 'Travel', subcategory: 'Car Rental', confidence: 0.95 },
  'TRAVEL_OTHER_TRAVEL': { category: 'Travel', subcategory: null, confidence: 0.7 },

  // Rent and Utilities - detailed
  'RENT_AND_UTILITIES_GAS_AND_ELECTRICITY': { category: 'Utilities', subcategory: 'Electric', confidence: 0.95 },
  'RENT_AND_UTILITIES_INTERNET_AND_CABLE': { category: 'Utilities', subcategory: 'Internet', confidence: 0.95 },
  'RENT_AND_UTILITIES_RENT': { category: 'Housing', subcategory: 'Rent', confidence: 0.95 },
  'RENT_AND_UTILITIES_SEWAGE_AND_WASTE_MANAGEMENT': { category: 'Utilities', subcategory: 'Water', confidence: 0.9 },
  'RENT_AND_UTILITIES_TELEPHONE': { category: 'Utilities', subcategory: 'Phone', confidence: 0.95 },
  'RENT_AND_UTILITIES_WATER': { category: 'Utilities', subcategory: 'Water', confidence: 0.95 },
  'RENT_AND_UTILITIES_OTHER_UTILITIES': { category: 'Utilities', subcategory: null, confidence: 0.8 },
};

/**
 * Map a Plaid personal_finance_category to our category system.
 * Tries detailed category first, then falls back to primary category.
 */
export function mapPlaidCategory(
  primary: string,
  detailed?: string
): PlaidCategoryMapping | null {
  // Try detailed mapping first (more specific)
  if (detailed !== undefined) {
    const detailedMapping = DETAILED_CATEGORY_MAP[detailed];
    if (detailedMapping !== undefined) {
      return detailedMapping;
    }
  }

  // Fall back to primary mapping
  const primaryMapping = PRIMARY_CATEGORY_MAP[primary];
  if (primaryMapping !== undefined) {
    return primaryMapping;
  }

  return null;
}

/**
 * Get all available Plaid category mappings.
 * Useful for debugging and documentation.
 */
export function getAllCategoryMappings(): {
  primary: Record<string, PlaidCategoryMapping>;
  detailed: Record<string, PlaidCategoryMapping>;
} {
  return {
    primary: { ...PRIMARY_CATEGORY_MAP },
    detailed: { ...DETAILED_CATEGORY_MAP },
  };
}

/**
 * Check if a Plaid category is mapped.
 */
export function isCategoryMapped(primary: string, detailed?: string): boolean {
  if (detailed !== undefined && DETAILED_CATEGORY_MAP[detailed] !== undefined) {
    return true;
  }
  return PRIMARY_CATEGORY_MAP[primary] !== undefined;
}
