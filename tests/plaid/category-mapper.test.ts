import { describe, it, expect } from 'vitest';
import {
  mapPlaidCategory,
  getAllCategoryMappings,
  isCategoryMapped,
} from '../../src/plaid/category-mapper.js';

describe('Category Mapper', () => {
  describe('mapPlaidCategory', () => {
    it('should map primary income category', () => {
      const result = mapPlaidCategory('INCOME');
      expect(result).not.toBeNull();
      expect(result!.category).toBe('Income');
      expect(result!.subcategory).toBe('Salary');
      expect(result!.confidence).toBeGreaterThan(0.8);
    });

    it('should map detailed income category', () => {
      const result = mapPlaidCategory('INCOME', 'INCOME_DIVIDENDS');
      expect(result).not.toBeNull();
      expect(result!.category).toBe('Income');
      expect(result!.subcategory).toBe('Dividends');
      expect(result!.confidence).toBe(0.95);
    });

    it('should map food and drink categories', () => {
      const groceries = mapPlaidCategory('FOOD_AND_DRINK', 'FOOD_AND_DRINK_GROCERIES');
      expect(groceries).not.toBeNull();
      expect(groceries!.category).toBe('Food & Dining');
      expect(groceries!.subcategory).toBe('Groceries');

      const restaurant = mapPlaidCategory('FOOD_AND_DRINK', 'FOOD_AND_DRINK_RESTAURANT');
      expect(restaurant).not.toBeNull();
      expect(restaurant!.category).toBe('Food & Dining');
      expect(restaurant!.subcategory).toBe('Restaurants');

      const coffee = mapPlaidCategory('FOOD_AND_DRINK', 'FOOD_AND_DRINK_COFFEE');
      expect(coffee).not.toBeNull();
      expect(coffee!.category).toBe('Food & Dining');
      expect(coffee!.subcategory).toBe('Restaurants');
    });

    it('should map transportation categories', () => {
      const rideshare = mapPlaidCategory('TRANSPORTATION', 'TRANSPORTATION_TAXIS_AND_RIDE_SHARES');
      expect(rideshare).not.toBeNull();
      expect(rideshare!.category).toBe('Transportation');
      expect(rideshare!.subcategory).toBe('Rideshare');

      const publicTransit = mapPlaidCategory('TRANSPORTATION', 'TRANSPORTATION_PUBLIC_TRANSIT');
      expect(publicTransit).not.toBeNull();
      expect(publicTransit!.category).toBe('Transportation');
      expect(publicTransit!.subcategory).toBe('Public Transit');

      const parking = mapPlaidCategory('TRANSPORTATION', 'TRANSPORTATION_PARKING');
      expect(parking).not.toBeNull();
      expect(parking!.category).toBe('Transportation');
      expect(parking!.subcategory).toBe('Parking');
    });

    it('should map transfer categories', () => {
      const transferIn = mapPlaidCategory('TRANSFER_IN', 'TRANSFER_IN_DEPOSIT');
      expect(transferIn).not.toBeNull();
      expect(transferIn!.category).toBe('Transfer');
      expect(transferIn!.subcategory).toBe('Deposit');

      const transferOut = mapPlaidCategory('TRANSFER_OUT', 'TRANSFER_OUT_WITHDRAWAL');
      expect(transferOut).not.toBeNull();
      expect(transferOut!.category).toBe('Transfer');
      expect(transferOut!.subcategory).toBe('ATM');
    });

    it('should map bank fees', () => {
      const atmFee = mapPlaidCategory('BANK_FEES', 'BANK_FEES_ATM_FEES');
      expect(atmFee).not.toBeNull();
      expect(atmFee!.category).toBe('Fees');
      expect(atmFee!.subcategory).toBe('Fees');

      const overdraft = mapPlaidCategory('BANK_FEES', 'BANK_FEES_OVERDRAFT_FEES');
      expect(overdraft).not.toBeNull();
      expect(overdraft!.category).toBe('Fees');
    });

    it('should map entertainment categories', () => {
      const streaming = mapPlaidCategory('ENTERTAINMENT', 'ENTERTAINMENT_TV_AND_MOVIES');
      expect(streaming).not.toBeNull();
      expect(streaming!.category).toBe('Entertainment');
      expect(streaming!.subcategory).toBe('Streaming');

      const gaming = mapPlaidCategory('ENTERTAINMENT', 'ENTERTAINMENT_VIDEO_GAMES');
      expect(gaming).not.toBeNull();
      expect(gaming!.category).toBe('Entertainment');
      expect(gaming!.subcategory).toBe('Gaming');
    });

    it('should map shopping categories', () => {
      const clothing = mapPlaidCategory('GENERAL_MERCHANDISE', 'GENERAL_MERCHANDISE_CLOTHING_AND_ACCESSORIES');
      expect(clothing).not.toBeNull();
      expect(clothing!.category).toBe('Shopping');
      expect(clothing!.subcategory).toBe('Clothing');

      const electronics = mapPlaidCategory('GENERAL_MERCHANDISE', 'GENERAL_MERCHANDISE_ELECTRONICS');
      expect(electronics).not.toBeNull();
      expect(electronics!.category).toBe('Shopping');
      expect(electronics!.subcategory).toBe('Electronics');

      const online = mapPlaidCategory('GENERAL_MERCHANDISE', 'GENERAL_MERCHANDISE_ONLINE_MARKETPLACES');
      expect(online).not.toBeNull();
      expect(online!.category).toBe('Shopping');
      expect(online!.subcategory).toBe('Online');
    });

    it('should map travel categories', () => {
      const flights = mapPlaidCategory('TRAVEL', 'TRAVEL_FLIGHTS');
      expect(flights).not.toBeNull();
      expect(flights!.category).toBe('Travel');
      expect(flights!.subcategory).toBe('Flights');

      const lodging = mapPlaidCategory('TRAVEL', 'TRAVEL_LODGING');
      expect(lodging).not.toBeNull();
      expect(lodging!.category).toBe('Travel');
      expect(lodging!.subcategory).toBe('Lodging');

      const carRental = mapPlaidCategory('TRAVEL', 'TRAVEL_RENTAL_CARS');
      expect(carRental).not.toBeNull();
      expect(carRental!.category).toBe('Travel');
      expect(carRental!.subcategory).toBe('Car Rental');
    });

    it('should map utilities categories', () => {
      const electric = mapPlaidCategory('RENT_AND_UTILITIES', 'RENT_AND_UTILITIES_GAS_AND_ELECTRICITY');
      expect(electric).not.toBeNull();
      expect(electric!.category).toBe('Utilities');
      expect(electric!.subcategory).toBe('Electric');

      const internet = mapPlaidCategory('RENT_AND_UTILITIES', 'RENT_AND_UTILITIES_INTERNET_AND_CABLE');
      expect(internet).not.toBeNull();
      expect(internet!.category).toBe('Utilities');
      expect(internet!.subcategory).toBe('Internet');

      const rent = mapPlaidCategory('RENT_AND_UTILITIES', 'RENT_AND_UTILITIES_RENT');
      expect(rent).not.toBeNull();
      expect(rent!.category).toBe('Housing');
      expect(rent!.subcategory).toBe('Rent');
    });

    it('should map health categories', () => {
      const pharmacy = mapPlaidCategory('MEDICAL', 'MEDICAL_PHARMACIES_AND_SUPPLEMENTS');
      expect(pharmacy).not.toBeNull();
      expect(pharmacy!.category).toBe('Health');
      expect(pharmacy!.subcategory).toBe('Pharmacy');

      const dental = mapPlaidCategory('MEDICAL', 'MEDICAL_DENTAL_CARE');
      expect(dental).not.toBeNull();
      expect(dental!.category).toBe('Health');
      expect(dental!.subcategory).toBe('Dental');

      const gym = mapPlaidCategory('PERSONAL_CARE', 'PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS');
      expect(gym).not.toBeNull();
      expect(gym!.category).toBe('Health');
      expect(gym!.subcategory).toBe('Fitness');
    });

    it('should map loan payments', () => {
      const creditCard = mapPlaidCategory('LOAN_PAYMENTS', 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT');
      expect(creditCard).not.toBeNull();
      expect(creditCard!.category).toBe('Financial');
      expect(creditCard!.subcategory).toBe('Credit Card Payment');

      const mortgage = mapPlaidCategory('LOAN_PAYMENTS', 'LOAN_PAYMENTS_MORTGAGE_PAYMENT');
      expect(mortgage).not.toBeNull();
      expect(mortgage!.category).toBe('Housing');
      expect(mortgage!.subcategory).toBe('Mortgage');
    });

    it('should fall back to primary category when detailed is unknown', () => {
      const result = mapPlaidCategory('FOOD_AND_DRINK', 'FOOD_AND_DRINK_UNKNOWN_SUBCATEGORY');
      expect(result).not.toBeNull();
      expect(result!.category).toBe('Food & Dining');
      expect(result!.subcategory).toBeNull();
    });

    it('should return null for unknown categories', () => {
      const result = mapPlaidCategory('UNKNOWN_CATEGORY');
      expect(result).toBeNull();
    });

    it('should prefer detailed category over primary', () => {
      // RENT_AND_UTILITIES primary maps to Housing/Rent
      // But RENT_AND_UTILITIES_WATER detailed maps to Utilities/Water
      const water = mapPlaidCategory('RENT_AND_UTILITIES', 'RENT_AND_UTILITIES_WATER');
      expect(water).not.toBeNull();
      expect(water!.category).toBe('Utilities');
      expect(water!.subcategory).toBe('Water');
    });
  });

  describe('getAllCategoryMappings', () => {
    it('should return all category mappings', () => {
      const mappings = getAllCategoryMappings();
      expect(mappings).toBeDefined();
      expect(mappings.primary).toBeDefined();
      expect(mappings.detailed).toBeDefined();
    });

    it('should include both primary and detailed mappings', () => {
      const mappings = getAllCategoryMappings();
      expect(mappings.primary['INCOME']).toBeDefined();
      expect(mappings.detailed['INCOME_WAGES']).toBeDefined();
      expect(mappings.primary['FOOD_AND_DRINK']).toBeDefined();
      expect(mappings.detailed['FOOD_AND_DRINK_GROCERIES']).toBeDefined();
    });
  });

  describe('isCategoryMapped', () => {
    it('should return true for mapped primary categories', () => {
      expect(isCategoryMapped('INCOME')).toBe(true);
      expect(isCategoryMapped('FOOD_AND_DRINK')).toBe(true);
      expect(isCategoryMapped('TRANSPORTATION')).toBe(true);
    });

    it('should return true for mapped detailed categories', () => {
      expect(isCategoryMapped('INCOME', 'INCOME_WAGES')).toBe(true);
      expect(isCategoryMapped('FOOD_AND_DRINK', 'FOOD_AND_DRINK_GROCERIES')).toBe(true);
      expect(isCategoryMapped('TRANSPORTATION', 'TRANSPORTATION_TAXIS_AND_RIDE_SHARES')).toBe(true);
    });

    it('should return false for unmapped categories', () => {
      expect(isCategoryMapped('UNKNOWN_CATEGORY')).toBe(false);
      expect(isCategoryMapped('RANDOM_STRING')).toBe(false);
    });
  });
});
